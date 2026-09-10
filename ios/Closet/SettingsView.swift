import PhotosUI
import SwiftUI

struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var passkeys: [Passkey] = []
  @State private var portraitFor: Hero?
  @State private var askAllPortraits = false
  @State private var askLogout = false
  @State private var addingPasskey = false

  private var needPortraits: [Hero] { model.heroes.filter(\.needsPortrait) }

  var body: some View {
    List {
      Section("Campaign") {
        if !model.heroes.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
              ForEach(model.heroes) { h in
                HeroTile(hero: h, onPortrait: { portraitFor = h }, onDelete: { Task { await deleteHero(h) } })
              }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
          }
          .listRowInsets(EdgeInsets())
        }
        if !needPortraits.isEmpty {
          Button(needPortraits.count == 1 ? "Make phone cover" : "Make \(needPortraits.count) phone covers") { askAllPortraits = true }
        }
        NavigationLink("New cover", value: Route.newCover)
      }

      Section("You") {
        NavigationLink("Reference photos", value: Route.references)
      }

      if let s = model.settings {
        Section {
          QualityPicker(title: "Look quality", key: "look_quality", value: s.lookQuality, options: s.qualities)
          QualityPicker(title: "Cover quality", key: "hero_quality", value: s.heroQuality, options: s.qualities)
          if let b = s.budget {
            LabeledContent("Images today", value: "\(b.image.day) / \(b.image.limits.day)")
            LabeledContent("Covers today", value: "\(b.hero.day) / \(b.hero.limits.day)")
            LabeledContent("Analyses today", value: "\(b.analysis.day) / \(b.analysis.limits.day)")
          }
        } header: {
          Text("Generation")
        } footer: {
          Text(s.model)
        }
      }

      Section("Passkeys") {
        ForEach(passkeys) { p in
          LabeledContent(p.name ?? "Passkey", value: Date(timeIntervalSince1970: TimeInterval(p.createdAt)).formatted(date: .abbreviated, time: .omitted))
            .swipeActions {
              Button("Remove", role: .destructive) { Task { await removePasskey(p) } }
            }
        }
        Button {
          Task { await addPasskey() }
        } label: {
          HStack {
            Text("Add passkey")
            if addingPasskey { Spacer(); ProgressView() }
          }
        }
        .disabled(addingPasskey)
      }

      Section {
        LabeledContent("Signed in", value: model.me?.email ?? "")
        Button("Log out", role: .destructive) { askLogout = true }
      }
    }
    .navigationTitle("Settings")
    .refreshable { await model.reloadSettings(); await loadPasskeys() }
    .task { await model.reloadSettings(); await loadPasskeys() }
    .confirmationDialog("Make the phone cover? One image generation at cover quality, counted toward today's cover limit.", isPresented: Binding(get: { portraitFor != nil }, set: { if !$0 { portraitFor = nil } }), titleVisibility: .visible, presenting: portraitFor) { h in
      Button("Generate") { Task { await makePortraits([h]) } }
    }
    .confirmationDialog("Make \(needPortraits.count) phone covers? \(needPortraits.count) image generations, counted toward today's cover limit.", isPresented: $askAllPortraits, titleVisibility: .visible) {
      Button("Generate") { Task { await makePortraits(needPortraits) } }
    }
    .confirmationDialog("Log out?", isPresented: $askLogout, titleVisibility: .visible) {
      Button("Log out", role: .destructive) { Task { await model.logout() } }
    }
  }

  private func makePortraits(_ heroes: [Hero]) async {
    var queued = 0
    for h in heroes {
      do {
        let _: Hero = try await API.send("POST", "/api/hero/\(h.id)/portrait")
        queued += 1
      } catch {
        model.fail(error)
        break
      }
    }
    if queued > 0 { model.show(queued == 1 ? "Phone cover queued." : "\(queued) phone covers queued.") }
    await model.reloadSettings()
    model.watch()
  }

  private func deleteHero(_ h: Hero) async {
    do {
      try await API.call("DELETE", "/api/hero/\(h.id)")
      await model.reloadSettings()
    } catch { model.fail(error) }
  }

  private func loadPasskeys() async {
    do { passkeys = try await API.get("/api/auth/passkeys") } catch { model.fail(error) }
  }

  private func addPasskey() async {
    addingPasskey = true
    defer { addingPasskey = false }
    do {
      try await Passkeys.register(existing: passkeys.map(\.id))
      model.show("Passkey added")
      await loadPasskeys()
      model.me = try? await API.get("/api/me")
    } catch {
      if Passkeys.isCancel(error) { return }
      model.show((error as? APIError)?.message ?? "Could not add passkey", error: true)
    }
  }

  private func removePasskey(_ p: Passkey) async {
    guard let escaped = p.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return }
    do {
      try await API.call("DELETE", "/api/auth/passkeys/\(escaped)")
      await loadPasskeys()
    } catch { model.fail(error) }
  }
}

private struct QualityPicker: View {
  let title: String
  let key: String
  let options: [String]
  @Environment(AppModel.self) private var model
  @State private var value: String

  init(title: String, key: String, value: String, options: [String]) {
    self.title = title
    self.key = key
    self.options = options
    _value = State(initialValue: value)
  }

  var body: some View {
    Picker(title, selection: $value) {
      ForEach(options, id: \.self) { Text($0.capitalized).tag($0) }
    }
    .onChange(of: value) { old, new in
      // Reverting after a failed save changes `value` again; only a real change is sent.
      let saved = key == "look_quality" ? model.settings?.lookQuality : model.settings?.heroQuality
      guard new != saved else { return }
      Task {
        do {
          try await API.call("PATCH", "/api/settings", [key: new])
          await model.reloadSettings()
        } catch {
          model.fail(error)
          value = old
        }
      }
    }
  }
}

private struct HeroTile: View {
  let hero: Hero
  let onPortrait: () -> Void
  let onDelete: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .bottom, spacing: 8) {
        ZStack {
          Theme.tile
          if hero.isDone {
            RemoteImage(key: hero.r2Key)
          } else if hero.status == "pending" {
            Shimmer()
          } else {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.danger)
          }
        }
        .frame(width: 180, height: 101)
        .clipShape(RoundedRectangle(cornerRadius: 6))

        ZStack {
          Theme.tile
          if let k = hero.portraitKey { RemoteImage(key: k) }
          if hero.portraitStatus == "pending" { Shimmer() }
        }
        .frame(width: 57, height: 101)
        .clipShape(RoundedRectangle(cornerRadius: 6))
      }

      Text(Styles.name(hero.style)).font(.subheadline.weight(.semibold))
      if hero.status == "error" || hero.portraitStatus == "error" {
        Text(errorText).font(.caption).foregroundStyle(Theme.danger).lineLimit(2).frame(width: 245, alignment: .leading)
      }
      if hero.portraitStatus == "pending" || hero.status == "pending" {
        Text("Generating…").font(.caption).foregroundStyle(.secondary)
      } else if hero.needsPortrait {
        Button(hero.portraitStatus == "error" ? "Retry phone cover" : "Make phone cover", action: onPortrait)
          .font(.caption.weight(.semibold))
          .buttonStyle(.borderless)
      }
    }
    .contextMenu {
      Button("Remove cover", systemImage: "trash", role: .destructive, action: onDelete)
    }
  }

  private var errorText: String {
    let e = (hero.status == "error" ? hero.error : hero.portraitError) ?? "Failed"
    return e.hasPrefix("skipped:") ? String(e.dropFirst(9)) : e
  }
}

struct NewCoverView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var style = "nyc"
  @State private var picked: [String] = []
  @State private var askGenerate = false
  @State private var sending = false

  private var finished: [Garment] { model.looks.filter { $0.mainCover != nil } }
  private var inflight: Bool { model.heroes.contains { $0.status == "pending" } }

  var body: some View {
    Form {
      Section {
        Picker("Location", selection: $style) {
          ForEach(model.settings?.heroStyles ?? Array(Styles.label.keys).sorted(), id: \.self) { Text(Styles.name($0)).tag($0) }
        }
      }

      Section {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
          ForEach(finished) { g in
            let n = picked.firstIndex(of: g.id)
            Button {
              if let n { picked.remove(at: n) } else if picked.count < 3 { picked.append(g.id) }
            } label: {
              ZStack(alignment: .topLeading) {
                Theme.tile
                RemoteImage(key: g.mainCover.flatMap { $0.thumbKey ?? $0.r2Key })
                if let n {
                  Text("\(n + 1)").font(.caption.weight(.bold)).foregroundStyle(.white)
                    .frame(width: 22, height: 22).background(Color.accentColor, in: Circle()).padding(5)
                }
              }
              .aspectRatio(3 / 4, contentMode: .fit)
              .clipShape(RoundedRectangle(cornerRadius: 6))
              .overlay(RoundedRectangle(cornerRadius: 6).stroke(n != nil ? Color.accentColor : .clear, lineWidth: 2))
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: n)
          }
        }
        .padding(.vertical, 6)
      } header: {
        Text("Looks · \(picked.count) of 3")
      } footer: {
        if inflight { Text("A cover is already generating.") }
      }
    }
    .navigationTitle("New cover")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        if sending {
          ProgressView()
        } else {
          Button("Generate") { askGenerate = true }.disabled(picked.count < 2 || inflight)
        }
      }
    }
    .onAppear {
      if let styles = model.settings?.heroStyles, !styles.contains(style), let first = styles.first { style = first }
    }
    .confirmationDialog("Generate a \(Styles.name(style)) cover? One high-quality image generation.", isPresented: $askGenerate, titleVisibility: .visible) {
      Button("Generate") { Task { await generate() } }
    }
  }

  private func generate() async {
    sending = true
    defer { sending = false }
    do {
      let _: Hero = try await API.send("POST", "/api/hero", ["garment_ids": picked, "style": style])
      model.show("Cover queued.")
      await model.reloadSettings()
      model.watch()
      dismiss()
    } catch { model.fail(error) }
  }
}

struct ReferencesView: View {
  @Environment(AppModel.self) private var model
  @State private var refs: [RefPhoto] = []
  @State private var items: [PhotosPickerItem] = []
  @State private var uploading = false
  @State private var toDelete: RefPhoto?

  var body: some View {
    ScrollView {
      if refs.isEmpty && !uploading {
        ContentUnavailableView("No reference photos", systemImage: "person.crop.rectangle", description: Text("Add a full-body photo of you to use as base."))
          .padding(.top, 80)
      }
      LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
        ForEach(refs) { r in
          ZStack(alignment: .topLeading) {
            Theme.tile
            RemoteImage(key: r.r2Key)
            if r.isBase == true {
              Text("Base").font(.caption2.weight(.bold)).foregroundStyle(.white)
                .padding(.horizontal, 7).padding(.vertical, 3).background(Theme.fg, in: Capsule()).padding(6)
            }
          }
          .aspectRatio(3 / 4, contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: 6))
          .contextMenu {
            if r.isBase != true { Button("Use as base", systemImage: "checkmark.circle") { Task { await setBase(r) } } }
            Button("Delete", systemImage: "trash", role: .destructive) { toDelete = r }
          }
        }
      }
      .padding(16)
    }
    .navigationTitle("Reference photos")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if uploading {
          ProgressView()
        } else {
          PhotosPicker(selection: $items, maxSelectionCount: 6, matching: .images) { Image(systemName: "plus") }
        }
      }
    }
    .task { await load() }
    .onChange(of: items) { _, picked in
      guard !picked.isEmpty else { return }
      items = []
      Task { await upload(picked) }
    }
    .confirmationDialog("Delete this photo?", isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible, presenting: toDelete) { r in
      Button("Delete", role: .destructive) { Task { await delete(r) } }
    }
  }

  private func load() async {
    do { refs = try await API.get("/api/refs") } catch { model.fail(error) }
  }

  private func upload(_ picked: [PhotosPickerItem]) async {
    uploading = true
    defer { uploading = false }
    for item in picked {
      guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
      let jpeg = await Task.detached { image.uploadJPEG(maxEdge: 2048, quality: 0.95) }.value
      do {
        let _: RefPhoto = try await API.upload("/api/refs", image: jpeg)
      } catch { model.fail(error) }
    }
    await load()
  }

  private func setBase(_ r: RefPhoto) async {
    do {
      try await API.call("PATCH", "/api/settings", ["base_ref": r.id])
      await load()
      await model.reloadSettings()
    } catch { model.fail(error) }
  }

  private func delete(_ r: RefPhoto) async {
    do {
      try await API.call("DELETE", "/api/refs/\(r.id)")
      await load()
    } catch { model.fail(error) }
  }
}
