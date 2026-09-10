import SwiftUI
import UIKit

enum Theme {
  static let fg = Color(hex: 0x111111)
  static let muted = Color(hex: 0x7A7A7A)
  static let line = Color(hex: 0xE8E8E8)
  static let tile = Color(hex: 0xF4F4F3)
  static let danger = Color(hex: 0xB3261E)
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}

extension View {
  /// The site's small uppercase letter-spaced label, used on cards and the home screen.
  func caps(_ size: CGFloat = 11, weight: Font.Weight = .semibold, tracking: CGFloat = 1.3) -> some View {
    font(.system(size: size, weight: weight)).tracking(tracking).textCase(.uppercase)
  }

  @ViewBuilder func zoomSource(_ id: String, _ ns: Namespace.ID?) -> some View {
    if let ns { matchedTransitionSource(id: id, in: ns) } else { self }
  }

  @ViewBuilder func zoomDestination(_ id: String, _ ns: Namespace.ID?) -> some View {
    if let ns { navigationTransition(.zoom(sourceID: id, in: ns)) } else { self }
  }

  func routes() -> some View { modifier(RouteHost()) }

  func productLinkEditor(isPresented: Binding<Bool>, garment: Garment?, onUpdate: @escaping (Garment) -> Void) -> some View {
    modifier(ProductLinkEditor(isPresented: isPresented, garment: garment, onUpdate: onUpdate))
  }
}

extension EnvironmentValues {
  @Entry var zoomNS: Namespace.ID? = nil
}

/// One destination table per tab stack; the namespace lets a card zoom into its viewer.
struct RouteHost: ViewModifier {
  @Namespace private var ns

  func body(content: Content) -> some View {
    content
      .environment(\.zoomNS, ns)
      .navigationDestination(for: Route.self) { route in
        Group {
          switch route {
          // An empty source means the link has no card to zoom out of.
          case .look(let id, let source): LookViewer(id: id).zoomDestination(source, source.isEmpty ? nil : ns)
          case .piece(let id, let source): PieceViewer(id: id).zoomDestination(source, source.isEmpty ? nil : ns)
          case .looks(let cat, let brand): LooksView(cat: cat, brand: brand)
          case .newCover: NewCoverView()
          case .references: ReferencesView()
          }
        }
        .environment(\.zoomNS, ns)
      }
  }
}

struct Wordmark: View {
  var size: CGFloat = 27
  var color: Color = Theme.fg

  var body: some View {
    Text("closet")
      .font(.system(size: size, weight: .heavy))
      .italic()
      .tracking(-size * 0.05)
      .foregroundStyle(color)
  }
}

struct SectionHead<Trailing: View>: View {
  let title: String
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).caps(12, weight: .bold, tracking: 1.9)
      Spacer()
      trailing.caps(11, tracking: 1.3).foregroundStyle(Theme.muted)
    }
  }
}

struct Swatches: View {
  let colors: [String]
  var size: CGFloat = 11

  var body: some View {
    HStack(spacing: 5) {
      ForEach(Array(colors.enumerated()), id: \.offset) { _, c in
        Circle().fill(Tax.swatchColor(c)).frame(width: size, height: size)
          .overlay(Circle().stroke(Color.black.opacity(0.18), lineWidth: 1))
      }
    }
  }
}

struct VariantDot: View {
  let variant: String
  var off = false

  var body: some View {
    RoundedRectangle(cornerRadius: 2)
      .fill(variant == "dark" ? Color(hex: 0x1A1A1A) : .white)
      .frame(width: 9, height: 9)
      .overlay(RoundedRectangle(cornerRadius: 2).stroke(variant == "dark" ? Color(hex: 0x1A1A1A) : Color(hex: 0xBBBBBB), lineWidth: 1))
      .opacity(off ? 0.25 : 1)
  }
}

struct Shimmer: View {
  @State private var move = false

  var body: some View {
    GeometryReader { geo in
      LinearGradient(colors: [Color(hex: 0xF1F1F0), Color(hex: 0xE6E6E4), Color(hex: 0xF1F1F0)], startPoint: .leading, endPoint: .trailing)
        .frame(width: geo.size.width * 3)
        .offset(x: move ? -geo.size.width * 2 : 0)
    }
    .clipped()
    .allowsHitTesting(false)
    .onAppear { withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) { move = true } }
  }
}

struct ToastView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let t = model.toast {
      Text(t.message)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.white)
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
        .background(t.isError ? Theme.danger : Theme.fg, in: Capsule())
        .shadow(color: .black.opacity(0.2), radius: 16, y: 10)
        .padding(.horizontal, 20)
        .padding(.bottom, 96)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .id(t.id)
        .onTapGesture { withAnimation { model.toast = nil } }
    }
  }
}

/// Add, edit or remove where to buy a piece.
struct ProductLinkEditor: ViewModifier {
  @Binding var isPresented: Bool
  let garment: Garment?
  let onUpdate: (Garment) -> Void
  @Environment(AppModel.self) private var model
  @State private var draft = ""

  func body(content: Content) -> some View {
    content
      .onChange(of: isPresented) { _, open in if open { draft = garment?.sourceUrl ?? "" } }
      .alert("Product link", isPresented: $isPresented) {
        TextField("https://…", text: $draft)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
        Button("Save") { Task { await save() } }
        Button("Cancel", role: .cancel) {}
      }
  }

  private func save() async {
    guard let garment else { return }
    do {
      let body: [String: Any] = ["source_url": draft.nilIfEmpty ?? NSNull()]
      let updated: Garment = try await API.send("PATCH", "/api/garments/\(garment.id)", body)
      onUpdate(updated)
      model.show(updated.sourceUrl == nil ? "Link removed" : "Link saved")
    } catch { model.fail(error) }
  }
}

// MARK: images

enum ImageStore {
  static let cache: NSCache<NSString, UIImage> = {
    let c = NSCache<NSString, UIImage>()
    c.totalCostLimit = 300 << 20
    return c
  }()
}

actor ImageLoader {
  static let shared = ImageLoader()
  private var tasks: [String: Task<UIImage?, Never>] = [:]

  func image(_ key: String) async -> UIImage? {
    if let hit = ImageStore.cache.object(forKey: key as NSString) { return hit }
    if let running = tasks[key] { return await running.value }
    let task = Task<UIImage?, Never> {
      guard let url = API.imageURL(key),
            let (data, res) = try? await API.session.data(from: url),
            (res as? HTTPURLResponse)?.statusCode == 200,
            let img = UIImage(data: data) else { return nil }
      let ready = await img.byPreparingForDisplay() ?? img
      ImageStore.cache.setObject(ready, forKey: key as NSString, cost: data.count * 4)
      return ready
    }
    tasks[key] = task
    let value = await task.value
    tasks[key] = nil
    return value
  }
}

/// An /img/* key loaded with the session cookie, cached in memory and on disk, faded in once decoded.
struct RemoteImage: View {
  let key: String?
  var mode: ContentMode = .fill
  @State private var image: UIImage?

  init(key: String?, mode: ContentMode = .fill) {
    self.key = key
    self.mode = mode
    _image = State(initialValue: key.flatMap { ImageStore.cache.object(forKey: $0 as NSString) })
  }

  var body: some View {
    Color.clear
      .overlay {
        if let image {
          Image(uiImage: image).resizable().aspectRatio(contentMode: mode).transition(.opacity)
        }
      }
      .clipped()
      .task(id: key) {
        guard let key else { image = nil; return }
        if let hit = ImageStore.cache.object(forKey: key as NSString) { image = hit; return }
        let loaded = await ImageLoader.shared.image(key)
        withAnimation(.easeOut(duration: 0.45)) { image = loaded }
      }
  }
}

struct ShareImageButton: View {
  let key: String
  let name: String
  @State private var image: UIImage?

  var body: some View {
    if let image {
      ShareLink(item: Image(uiImage: image), preview: SharePreview(name, image: Image(uiImage: image)))
    } else {
      Image(systemName: "square.and.arrow.up")
        .foregroundStyle(.tertiary)
        .task(id: key) { image = await ImageLoader.shared.image(key) }
    }
  }
}

extension String {
  var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
  var nilIfEmpty: String? { trimmed.isEmpty ? nil : trimmed }
}
