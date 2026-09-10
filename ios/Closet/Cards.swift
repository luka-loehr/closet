import SwiftUI

/// Try-on card: the white look, the dark one crossfades in while pressed (the web's hover).
struct LookCard: View {
  let g: Garment
  let source: String
  @Environment(\.zoomNS) private var ns
  @State private var pressed = false

  var body: some View {
    VStack(spacing: 0) {
      ZStack(alignment: .bottom) {
        Theme.tile
        if let main = g.mainCover {
          RemoteImage(key: main.thumbKey ?? main.r2Key)
          if let alt = g.altCover {
            RemoteImage(key: alt.thumbKey ?? alt.r2Key).opacity(pressed ? 1 : 0)
          }
        } else {
          if g.pending > 0 { Shimmer() }
          RemoteImage(key: g.thumbKey ?? g.r2Key, mode: .fit).padding(28)
          Text(g.pending > 0 ? "Generating…" : g.errors > 0 ? "Generation failed · open for details" : "Not generated")
            .caps(10, weight: .bold, tracking: g.errors > 0 ? 0.3 : 1.4)
            .foregroundStyle(g.errors > 0 && g.pending == 0 ? Theme.danger : Color(hex: 0x666666))
            .multilineTextAlignment(.center)
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(g.errors > 0 && g.pending == 0 ? Color.white.opacity(0.9) : .clear)
        }
      }
      .aspectRatio(3 / 4, contentMode: .fit)
      .clipShape(RoundedRectangle(cornerRadius: 2))
      .zoomSource(source, ns)
      .animation(.easeInOut(duration: 0.5), value: pressed)

      VStack(spacing: 4) {
        Text(g.name).caps(11.5, weight: .bold, tracking: 0.7).multilineTextAlignment(.center).lineLimit(2)
        if !g.meta.isEmpty { Text(g.meta).caps(10.5, weight: .regular, tracking: 0.8).foregroundStyle(Theme.muted).lineLimit(1) }
        HStack(spacing: 6) { ForEach(Variants.all, id: \.self) { VariantDot(variant: $0, off: g.covers[$0] == nil) } }.padding(.top, 5)
      }
      .padding(.top, 12)
      .padding(.horizontal, 4)
    }
    .contentShape(Rectangle())
    .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 12, perform: {}, onPressingChanged: { pressed = $0 })
  }
}

/// Wardrobe card: the piece itself on white, like a shop listing.
struct PieceCard: View {
  let g: Garment
  let source: String
  @Environment(\.zoomNS) private var ns

  var body: some View {
    let generating = g.studioStatus == "pending"
    let main = g.pieceKey()
    VStack(spacing: 0) {
      ZStack(alignment: .bottom) {
        Color.white
        if generating || main == nil { Shimmer() }
        if let main { RemoteImage(key: main, mode: .fit).padding(6) }
        if generating || main == nil {
          Text(generating ? "Studio shots…" : g.studioStatus == "error" ? "Studio shot failed · open to retry" : "No studio shot")
            .caps(10, weight: .bold, tracking: 1.2)
            .foregroundStyle(g.studioStatus == "error" && !generating ? Theme.danger : Color(hex: 0x666666))
            .multilineTextAlignment(.center)
            .padding(10)
        }
      }
      .aspectRatio(3 / 4, contentMode: .fit)
      .overlay(RoundedRectangle(cornerRadius: 2).stroke(Theme.line))
      .clipShape(RoundedRectangle(cornerRadius: 2))
      .zoomSource(source, ns)

      VStack(spacing: 4) {
        Text(g.name).caps(11.5, weight: .bold, tracking: 0.7).multilineTextAlignment(.center).lineLimit(2)
        if !g.meta.isEmpty { Text(g.meta).caps(10.5, weight: .regular, tracking: 0.8).foregroundStyle(Theme.muted).lineLimit(1) }
        Swatches(colors: g.colors).padding(.top, 5)
      }
      .padding(.top, 12)
      .padding(.horizontal, 4)
    }
    .contentShape(Rectangle())
  }
}

struct LookGrid: View {
  let items: [Garment]
  let context: String

  var body: some View {
    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 26) {
      ForEach(items) { g in
        NavigationLink(value: Route.look(id: g.id, source: "\(context)-\(g.id)")) {
          LookCard(g: g, source: "\(context)-\(g.id)")
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 16)
  }
}
