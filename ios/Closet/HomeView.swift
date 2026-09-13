import SwiftUI

struct HomeView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        CoverCarousel(heroes: model.coverHeroes, pieces: model.looks.count)
          .containerRelativeFrame(.vertical) { h, _ in h * 0.88 }

        VStack(spacing: 22) {
          SectionHead(title: "New in") {
            NavigationLink("View all", value: Route.looks(cat: nil, brand: nil))
          }
          .padding(.horizontal, 16)

          if model.looks.isEmpty {
            ContentUnavailableView {
              Label("Nothing here yet", systemImage: "sparkles")
            } actions: {
              Button("Add a piece") { model.addOwn = false; model.tab = .add }.buttonStyle(.glassProminent)
            }
          } else {
            LookGrid(items: Array(model.looks.prefix(8)), context: "home")
          }
        }
        .padding(.top, 30)
        .padding(.bottom, 56)

        if !model.looks.isEmpty { BrowseBand() }

        HStack {
          Text("closet · private")
          Spacer()
          Text(String(Calendar.current.component(.year, from: .now)))
        }
        .caps(10.5, tracking: 1.4)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 16)
        .padding(.vertical, 26)
        .padding(.bottom, 20)
      }
    }
    .ignoresSafeArea(edges: .top)
    .background(Color.white)
    .toolbar(.hidden, for: .navigationBar)
    .refreshable { await model.refreshAll() }
  }
}

/// Campaign covers, full-bleed: the phone (9:16) version when it exists, crossfading every 10 seconds.
struct CoverCarousel: View {
  let heroes: [Hero]
  let pieces: Int
  @Environment(AppModel.self) private var model
  @State private var index = 0
  @State private var cycle = 0
  @State private var rise = false

  var body: some View {
    ZStack(alignment: .bottom) {
      if heroes.isEmpty {
        LinearGradient(colors: [Color(hex: 0xECECEC), Color(hex: 0xCFCFCF)], startPoint: .topLeading, endPoint: .bottomTrailing)
        VStack(spacing: 16) {
          Wordmark(size: 88)
          Button(pieces > 0 ? "Make a cover" : "Add a piece") { model.tab = pieces > 0 ? .settings : .add }
            .buttonStyle(.glassProminent)
        }
        .padding(32)
        .frame(maxHeight: .infinity)
      } else {
        ForEach(Array(heroes.enumerated()), id: \.element.id) { i, h in
          RemoteImage(key: h.portraitKey ?? h.r2Key)
            .opacity(i == index ? 1 : 0)
            .animation(.easeInOut(duration: 1.4), value: index)
        }
        LinearGradient(stops: [.init(color: .black.opacity(0.22), location: 0), .init(color: .clear, location: 0.22), .init(color: .clear, location: 0.5), .init(color: .black.opacity(0.38), location: 1)], startPoint: .top, endPoint: .bottom)
          .allowsHitTesting(false)

        VStack(spacing: 14) {
          Wordmark(size: 96, color: .white)
            .offset(y: rise ? 0 : 110)
            .clipped()
          Text("\(pieces) pieces")
            .caps(11, tracking: 3.5)
            .foregroundStyle(.white)
            .opacity(rise ? 1 : 0)
          if heroes.count > 1 {
            HStack(spacing: 8) {
              ForEach(heroes.indices, id: \.self) { i in
                SlideBar(active: i == index, cycle: cycle)
                  .onTapGesture { go(i) }
              }
            }
            .padding(.top, 14)
          }
        }
        .padding(.bottom, 44)
      }
    }
    .clipped()
    .contentShape(Rectangle())
    .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { v in
      guard abs(v.translation.width) > abs(v.translation.height), abs(v.translation.width) > 40 else { return }
      go(index + (v.translation.width < 0 ? 1 : -1))
    })
    .task(id: "\(cycle)-\(heroes.count)") {
      try? await Task.sleep(for: .seconds(10))
      if !Task.isCancelled { go(index + 1) }
    }
    .onAppear { withAnimation(.spring(duration: 1.1, bounce: 0.1).delay(0.2)) { rise = true } }
    .onChange(of: heroes.count) { _, n in if index >= n { index = 0 } }
  }

  private func go(_ n: Int) {
    guard heroes.count > 1 else { return }
    index = (n + heroes.count) % heroes.count
    cycle += 1
  }
}

private struct SlideBar: View {
  let active: Bool
  let cycle: Int
  @State private var progress: CGFloat = 0

  var body: some View {
    ZStack(alignment: .leading) {
      Capsule().fill(.white.opacity(0.35))
      Capsule().fill(.white).scaleEffect(x: progress, anchor: .leading)
    }
    .frame(width: 34, height: 2)
    .padding(.vertical, 8)
    .contentShape(Rectangle())
    .onChange(of: cycle, initial: true) { _, _ in
      progress = 0
      if active { withAnimation(.linear(duration: 10)) { progress = 1 } }
    }
  }
}

/// The web's flowing menu band, as tappable rows: all looks, categories, brands, the closet, add, campaign.
private struct BrowseBand: View {
  @Environment(AppModel.self) private var model

  private struct Item: Identifiable {
    let id: String
    let text: String
    let count: String
    let image: String?
    let route: Route?
    let tab: AppTab?
  }

  private var items: [Item] {
    let looks = model.looks
    let cover = { (g: Garment?) in g?.covers["white"].flatMap { $0.thumbKey ?? $0.r2Key } }
    var cats: [String] = []
    for g in looks { if let c = g.category, !cats.contains(c) { cats.append(c) } }
    var brands: [String] = []
    for g in looks { if let b = g.brand, !b.isEmpty, !brands.contains(b) { brands.append(b) } }
    var out = [Item(id: "all", text: "All looks", count: "\(looks.count)", image: cover(looks.first { $0.covers["white"] != nil }), route: .looks(cat: nil, brand: nil), tab: nil)]
    out += cats.prefix(4).map { c in Item(id: "c-\(c)", text: Tax.label(c), count: "\(looks.filter { $0.category == c }.count)", image: cover(looks.first { $0.category == c && $0.covers["white"] != nil }), route: .looks(cat: c, brand: nil), tab: nil) }
    out += brands.prefix(3).map { b in Item(id: "b-\(b)", text: b, count: "\(looks.filter { $0.brand == b }.count)", image: cover(looks.first { $0.brand == b && $0.covers["white"] != nil }), route: .looks(cat: nil, brand: b), tab: nil) }
    out.append(Item(id: "closet", text: "My closet", count: "\(model.wardrobe.count) pieces", image: model.wardrobe.first?.pieceKey(), route: nil, tab: .closet))
    out.append(Item(id: "add", text: "Try on", count: "photo · camera · link", image: nil, route: nil, tab: .add))
    out.append(Item(id: "campaign", text: "Campaign", count: "\(model.coverHeroes.count) shots", image: model.coverHeroes.first.flatMap { $0.portraitKey ?? $0.r2Key }, route: nil, tab: .settings))
    return out
  }

  var body: some View {
    VStack(spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
        Group {
          if let route = item.route {
            NavigationLink(value: route) { row(item) }
          } else {
            Button { if item.tab == .add { model.addOwn = false }; model.tab = item.tab ?? .home } label: { row(item) }
          }
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(.white.opacity(0.22)).frame(height: 1) } }
      }
    }
    .background(Theme.fg)
  }

  private func row(_ item: Item) -> some View {
    HStack(spacing: 14) {
      Text(item.text)
        .font(.system(size: 21, weight: .heavy)).italic()
        .tracking(-0.4)
        .textCase(.uppercase)
        .lineLimit(1)
      Text(item.count).caps(9.5, tracking: 1.8).opacity(0.5).lineLimit(1)
      Spacer(minLength: 8)
      if let image = item.image {
        RemoteImage(key: image).frame(width: 84, height: 34).clipShape(Capsule())
      }
      Image(systemName: "arrow.right").font(.system(size: 13, weight: .semibold)).opacity(0.6)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 18)
    .frame(height: 64)
    .contentShape(Rectangle())
  }
}
