import SwiftUI

/// A try-on piece: its two looks as pages, what it was worn with; actions live in the toolbar.
struct LookViewer: View {
  let id: String
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var g: Garment?
  @State private var loadError: String?
  @State private var variant = "white"
  @State private var askDelete = false
  @State private var editLink = false

  var body: some View {
    ScrollView {
      if let g {
        content(g)
      } else if let loadError {
        ContentUnavailableView("Could not load", systemImage: "exclamationmark.triangle", description: Text(loadError)).padding(.top, 120)
      } else {
        ProgressView().padding(.top, 220)
      }
    }
    .background(Color.white)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let g {
        ToolbarItemGroup(placement: .topBarTrailing) {
          if let key = g.look(variant)?.r2Key { ShareImageButton(key: key, name: g.name) }
          Menu {
            if let s = g.sourceUrl, let url = URL(string: s) {
              Link(destination: url) { Label("Open product", systemImage: "arrow.up.right") }
            }
            Button(g.sourceUrl == nil ? "Add product link" : "Edit product link", systemImage: "link") { editLink = true }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { askDelete = true }
          } label: {
            Image(systemName: "ellipsis")
          }
        }
      }
    }
    .productLinkEditor(isPresented: $editLink, garment: g) { g = $0 }
    .task {
      await load()
      while !Task.isCancelled, g?.anyLookPending == true {
        try? await Task.sleep(for: .seconds(5))
        if Task.isCancelled { break }
        let before = g
        await load()
        if before != g { await model.refreshLists() }
      }
    }
    .confirmationDialog("Delete \(g?.name ?? "this piece") and its looks?", isPresented: $askDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await delete() } }
    }
  }

  @ViewBuilder
  private func content(_ g: Garment) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text(g.name).font(.title2.weight(.bold))
        if !g.meta.isEmpty { Text(g.meta).font(.subheadline).foregroundStyle(.secondary) }
      }
      .padding(.horizontal, 16)

      TabView(selection: $variant) {
        ForEach(Variants.all, id: \.self) { v in
          panel(g, v).padding(.horizontal, 16).tag(v)
        }
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
      .aspectRatio(0.75, contentMode: .fit)

      Picker("Variant", selection: $variant.animation()) {
        ForEach(Variants.all, id: \.self) { Text(Variants.label($0)).tag($0) }
      }
      .pickerStyle(.segmented)
      .padding(.horizontal, 16)

      if let paired = g.paired, !paired.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("Worn with").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
              ForEach(paired) { p in
                NavigationLink(value: Route.piece(id: p.id, source: "")) {
                  RemoteImage(key: p.pieceKey(), mode: .fit)
                    .padding(4).frame(width: 72, height: 72)
                    .background(Theme.tile, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
              }
            }
          }
        }
        .padding(.horizontal, 16)
      }
    }
    .padding(.bottom, 40)
  }

  private func panel(_ g: Garment, _ v: String) -> some View {
    ZStack {
      Theme.tile
      if let l = g.look(v), let key = l.r2Key {
        if let t = l.thumbKey { RemoteImage(key: t) }
        RemoteImage(key: key)
      } else {
        if g.lookPending(v) { Shimmer() }
        Text(g.lookPending(v) ? "Generating…" : g.lookFailed(v).map { failure($0.error) } ?? "Not generated")
          .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(20)
      }
    }
    .aspectRatio(3 / 4, contentMode: .fit)
    .clipShape(RoundedRectangle(cornerRadius: 4))
  }

  private func failure(_ e: String?) -> String {
    guard let e, e.hasPrefix("skipped:") else { return "Generation failed" }
    return String(e.dropFirst(9))
  }

  private func load() async {
    do {
      g = try await API.get("/api/garments/\(id)")
    } catch {
      if let e = error as? APIError, e.status == 404 {
        model.show("That look is gone.", error: true)
        dismiss()
      } else if g == nil {
        loadError = error.localizedDescription
      }
    }
  }

  private func delete() async {
    do {
      try await API.call("DELETE", "/api/garments/\(id)")
      model.show("Deleted.")
      dismiss()
      await model.refreshLists()
    } catch { model.fail(error) }
  }
}

/// One owned piece: studio shot and detail (shoes: side and three-quarter view).
struct PieceViewer: View {
  let id: String
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var g: Garment?
  @State private var loadError: String?
  @State private var page = 0
  @State private var askDelete = false
  @State private var askRerender = false
  @State private var editLink = false

  var body: some View {
    ScrollView {
      if let g {
        content(g)
      } else if let loadError {
        ContentUnavailableView("Could not load", systemImage: "exclamationmark.triangle", description: Text(loadError)).padding(.top, 120)
      } else {
        ProgressView().padding(.top, 220)
      }
    }
    .background(Color.white)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let g {
        ToolbarItemGroup(placement: .topBarTrailing) {
          if let key = page == 0 ? g.pieceKey(thumb: false) : g.pieceAltKey(thumb: false) { ShareImageButton(key: key, name: g.name) }
          Menu {
            if let s = g.sourceUrl, let url = URL(string: s) {
              Link(destination: url) { Label("Open product", systemImage: "arrow.up.right") }
            }
            Button(g.sourceUrl == nil ? "Add product link" : "Edit product link", systemImage: "link") { editLink = true }
            if g.studioStatus != "pending" {
              Button(g.studioStatus == "error" ? "Retry studio shots" : "Re-render studio shots", systemImage: "arrow.clockwise") { askRerender = true }
            }
            Divider()
            Button("Remove from closet", systemImage: "trash", role: .destructive) { askDelete = true }
          } label: {
            Image(systemName: "ellipsis")
          }
        }
      }
    }
    .productLinkEditor(isPresented: $editLink, garment: g) { g = $0 }
    // Restarts when rendering starts or ends; cancelled with the view.
    .task(id: g?.studioStatus == "pending") { await watch() }
    .confirmationDialog("Remove \(g?.name ?? "this piece") from your closet?", isPresented: $askDelete, titleVisibility: .visible) {
      Button("Remove", role: .destructive) { Task { await delete() } }
    }
    .confirmationDialog("Re-render both studio shots? This uses two image generations.", isPresented: $askRerender, titleVisibility: .visible) {
      Button("Re-render") { Task { await rerender() } }
    }
  }

  @ViewBuilder
  private func content(_ g: Garment) -> some View {
    let shoes = Tax.family(g.category) == "shoes"
    let pending = g.studioStatus == "pending"
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 6) {
        Text(g.name).font(.title2.weight(.bold))
        HStack(spacing: 8) {
          if !g.meta.isEmpty { Text(g.meta).font(.subheadline).foregroundStyle(.secondary) }
          Swatches(colors: g.colors)
        }
        if let d = g.description, !d.isEmpty {
          Text(d).font(.subheadline).foregroundStyle(.secondary)
        }
        if g.studioStatus == "error", let err = studioError(g) {
          Text(err).font(.footnote).foregroundStyle(Theme.danger)
        }
      }
      .padding(.horizontal, 16)

      TabView(selection: $page) {
        shot(key: g.pieceKey(thumb: false), thumb: g.pieceKey(), fill: false, pending: pending, status: g.studioStatus).tag(0).padding(.horizontal, 16)
        shot(key: g.pieceAltKey(thumb: false), thumb: g.pieceAltKey(), fill: Tax.detailFills(g.category), pending: pending, status: g.studioStatus).tag(1).padding(.horizontal, 16)
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
      .aspectRatio(0.75, contentMode: .fit)

      Picker("View", selection: $page.animation()) {
        Text(shoes ? "Side" : "Studio").tag(0)
        Text(shoes ? "Three-quarter" : "Detail").tag(1)
      }
      .pickerStyle(.segmented)
      .padding(.horizontal, 16)
    }
    .padding(.bottom, 40)
  }

  private func shot(key: String?, thumb: String?, fill: Bool, pending: Bool, status: String?) -> some View {
    ZStack {
      Color.white
      if let key {
        if let thumb { RemoteImage(key: thumb, mode: fill ? .fill : .fit).padding(fill ? 0 : 8) }
        RemoteImage(key: key, mode: fill ? .fill : .fit).padding(fill ? 0 : 8)
      } else {
        if pending { Shimmer() }
        Text(pending ? "Generating…" : status == "error" ? "Failed" : "Not generated").font(.footnote).foregroundStyle(.secondary)
      }
    }
    .aspectRatio(3 / 4, contentMode: .fit)
    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Theme.line))
    .clipShape(RoundedRectangle(cornerRadius: 4))
  }

  private func studioError(_ g: Garment) -> String? {
    (g.notes ?? "").split(separator: "\n").reversed().first { $0.hasPrefix("[studio shot") }.map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "[]")) }
  }

  private func watch() async {
    await load()
    while !Task.isCancelled, g?.studioStatus == "pending" {
      try? await Task.sleep(for: .seconds(5))
      if Task.isCancelled { break }
      await load()
      if g?.studioStatus != "pending" {
        if g?.studioStatus == "error" { model.show("The studio shots failed.", error: true) }
        await model.refreshLists()
      }
    }
  }

  private func load() async {
    do {
      g = try await API.get("/api/garments/\(id)")
    } catch {
      if let e = error as? APIError, e.status == 404 {
        model.show("That piece is gone.", error: true)
        dismiss()
      } else if g == nil {
        loadError = error.localizedDescription
      }
    }
  }

  private func rerender() async {
    do {
      g = try await API.send("POST", "/api/garments/\(id)/studio")
      model.show("Re-rendering in the background.")
      await model.refreshLists()
    } catch { model.fail(error) }
  }

  private func delete() async {
    do {
      try await API.call("DELETE", "/api/garments/\(id)")
      model.show("Removed.")
      dismiss()
      await model.refreshLists()
    } catch { model.fail(error) }
  }
}
