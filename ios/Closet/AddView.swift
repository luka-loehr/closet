import PhotosUI
import SwiftUI
import UIKit

/// Add a piece: pick a photo → fast analysis → review form → commit.
struct AddView: View {
  @Environment(AppModel.self) private var model
  @State private var stage: Stage = .pick
  @State private var photo: PhotosPickerItem?
  @State private var camera = false

  enum Stage {
    case pick
    case uploading(UIImage?)
    case review(Garment, UIImage?, own: Bool)
  }

  var body: some View {
    @Bindable var model = model
    Group {
      switch stage {
      case .pick:
        Form {
          Section {
            Picker("Mode", selection: $model.addOwn) {
              Text("Try on").tag(false)
              Text("I own this").tag(true)
            }
            .pickerStyle(.segmented)
          }
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())

          Section {
            PhotosPicker("Choose photo", selection: $photo, matching: .images)
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
              Button("Take photo") { camera = true }
            }
            Button("Paste") { Task { await paste() } }
          }
        }
        .navigationTitle("Add")

      case .uploading(let image):
        Form {
          Section { PhotoPreview(image: image, key: nil) }
            .listRowBackground(Color.clear)
          Section {
            HStack(spacing: 10) {
              ProgressView()
              Text("Analysing").foregroundStyle(.secondary)
            }
          }
        }
        .navigationTitle("Add")

      case .review(let g, let image, let own):
        ReviewForm(garment: g, preview: image, own: own) { withAnimation { stage = .pick } }
          .id(g.id)
      }
    }
    .onChange(of: photo) { _, item in
      guard let item else { return }
      photo = nil
      Task {
        if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
          await upload(image: image)
        } else {
          model.show("Could not read that photo.", error: true)
        }
      }
    }
    .fullScreenCover(isPresented: $camera) {
      CameraPicker { image in
        camera = false
        if let image { Task { await upload(image: image) } }
      }
      .ignoresSafeArea()
    }
  }

  private func upload(image: UIImage) async {
    let own = model.addOwn
    withAnimation { stage = .uploading(image) }
    do {
      let data = await Task.detached(priority: .userInitiated) { image.uploadJPEG() }.value
      let g: Garment = try await API.upload("/api/garments" + (own ? "?owned=1" : ""), image: data)
      withAnimation { stage = .review(g, image, own: own) }
    } catch {
      model.fail(error)
      withAnimation { stage = .pick }
    }
  }

  private func paste() async {
    if let image = UIPasteboard.general.image {
      await upload(image: image)
    } else {
      model.show("No image to paste.", error: true)
    }
  }
}

private struct PhotoPreview: View {
  let image: UIImage?
  let key: String?

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().scaledToFit()
      } else if let key {
        RemoteImage(key: key, mode: .fit)
      } else {
        ProgressView()
      }
    }
    .frame(maxWidth: .infinity)
    .frame(height: 200)
  }
}

struct ReviewForm: View {
  let garment: Garment
  let preview: UIImage?
  let own: Bool
  let onDone: () -> Void

  @Environment(AppModel.self) private var model
  @State private var name: String
  @State private var brand: String
  @State private var category: String
  @State private var colors: String
  @State private var details: String
  @State private var link: String
  @State private var pick: [String: String] = [:]
  @State private var saving = false

  init(garment: Garment, preview: UIImage?, own: Bool, onDone: @escaping () -> Void) {
    self.garment = garment
    self.preview = preview
    self.own = own
    self.onDone = onDone
    _name = State(initialValue: garment.name)
    _brand = State(initialValue: garment.brand ?? "")
    _category = State(initialValue: garment.category ?? "other")
    _colors = State(initialValue: garment.colors.joined(separator: ", "))
    _details = State(initialValue: garment.description ?? "")
    _link = State(initialValue: garment.sourceUrl ?? "")
  }

  private var colorList: [String] { Array(colors.split(separator: ",").map { String($0).trimmed }.filter { !$0.isEmpty }.prefix(3)) }
  private var missing: [String] { own ? [] : Tax.missing(category) }
  private var brandMissing: Bool { garment.analysis.map { !$0.foundBrand } ?? false }

  /// Slots this fit lacks for which the closet has something to offer.
  private var pickable: [(slot: String, options: [Garment])] {
    (model.settings?.slots ?? ["top", "bottom", "shoes", "outerwear"])
      .filter { missing.contains($0) }
      .map { slot in (slot, model.wardrobe.filter { Tax.slots($0.category).contains(slot) && $0.pieceKey() != nil }) }
      .filter { !$0.options.isEmpty }
  }

  var body: some View {
    Form {
      Section { PhotoPreview(image: preview, key: garment.thumbKey ?? garment.r2Key) }
        .listRowBackground(Color.clear)

      Section {
        TextField("Name", text: $name)
        TextField(brandMissing ? "Brand (not recognised)" : "Brand", text: $brand)
          .textInputAutocapitalization(.words)
        Picker("Category", selection: $category) {
          ForEach(Tax.families) { f in
            Section(f.label) {
              ForEach(f.categories) { c in Text(c.label).tag(c.id) }
            }
          }
        }
        HStack {
          TextField("Colours", text: $colors).textInputAutocapitalization(.never)
          Swatches(colors: colorList, size: 14)
        }
      }

      Section {
        TextField("Description", text: $details, axis: .vertical).lineLimit(1...4)
        TextField("Product link", text: $link)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }

      if !pickable.isEmpty {
        Section("Complete the fit") {
          ForEach(pickable, id: \.slot) { row in
            slotRow(row.slot, options: row.options)
          }
        }
      }
    }
    .navigationTitle(own ? "Add to closet" : "Try on")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Discard", role: .destructive) { Task { await discard() } }.disabled(saving)
      }
      ToolbarItem(placement: .confirmationAction) {
        if saving {
          ProgressView()
        } else {
          Button(own ? "Add" : "Generate") { Task { await submit() } }
            .disabled(name.trimmed.isEmpty)
        }
      }
    }
    .onChange(of: category) { _, c in
      let need = Set(own ? [] : Tax.missing(c))
      pick = pick.filter { need.contains($0.key) }
    }
  }

  private func slotRow(_ slot: String, options: [Garment]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(Tax.slotLabel[slot] ?? slot).font(.subheadline.weight(.semibold))
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          tile(selected: pick[slot] == nil) {
            Text("Base").font(.caption).foregroundStyle(.secondary)
          } action: { pick[slot] = nil }
          ForEach(options) { w in
            tile(selected: pick[slot] == w.id) {
              RemoteImage(key: w.pieceKey(), mode: .fit).padding(4)
            } action: { pick[slot] = w.id }
          }
        }
        .padding(2)
      }
    }
    .padding(.vertical, 4)
  }

  private func tile<Content: View>(selected: Bool, @ViewBuilder content: () -> Content, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      ZStack {
        Color.white
        content()
      }
      .frame(width: 72, height: 96)
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? Color.accentColor : Theme.line, lineWidth: selected ? 2 : 1))
    }
    .buttonStyle(.plain)
    .sensoryFeedback(.selection, trigger: selected)
  }

  private func submit() async {
    guard !saving else { return }
    saving = true
    defer { saving = false }
    var body: [String: Any] = [
      "name": name.trimmed,
      "brand": brand.nilIfEmpty ?? NSNull(),
      "category": category,
      "colors": colorList,
      "description": details.nilIfEmpty ?? NSNull(),
      "owned": own,
      "source_url": link.nilIfEmpty ?? NSNull(),
    ]
    if !own {
      var pairing: [String: Any] = [:]
      for slot in missing { pairing[slot] = pick[slot] ?? NSNull() }
      body["pairing"] = pairing
    }
    do {
      try await API.call("POST", "/api/garments/\(garment.id)/commit", body)
      model.show(own ? "Added. Studio shots are on their way." : "Generating your looks.")
      await model.refreshLists()
      model.watch()
      model.tab = own ? .closet : .home
      onDone()
    } catch { model.fail(error) }
  }

  private func discard() async {
    try? await API.call("DELETE", "/api/garments/\(garment.id)")
    onDone()
  }
}

struct CameraPicker: UIViewControllerRepresentable {
  let onFinish: (UIImage?) -> Void

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let c = UIImagePickerController()
    c.sourceType = .camera
    c.delegate = context.coordinator
    return c
  }

  func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let onFinish: (UIImage?) -> Void
    init(onFinish: @escaping (UIImage?) -> Void) { self.onFinish = onFinish }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
      onFinish(info[.originalImage] as? UIImage)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
  }
}
