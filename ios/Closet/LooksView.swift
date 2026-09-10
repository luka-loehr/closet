import SwiftUI

struct LooksView: View {
  @Environment(AppModel.self) private var model
  @State private var cat: String?
  @State private var brand: String?

  init(cat: String?, brand: String?) {
    _cat = State(initialValue: cat)
    _brand = State(initialValue: brand)
  }

  private var cats: [String] {
    var out: [String] = []
    for g in model.looks { if let c = g.category, !out.contains(c) { out.append(c) } }
    return out
  }

  private var visible: [Garment] {
    model.looks.filter { (cat == nil || $0.category == cat) && (brand == nil || $0.brand == brand) }
  }

  var body: some View {
    ScrollView {
      if visible.isEmpty {
        ContentUnavailableView {
          Label(model.looks.isEmpty ? "No looks yet" : "No looks match", systemImage: "sparkles")
        } actions: {
          if model.looks.isEmpty {
            Button("Try on a piece") { model.addOwn = false; model.tab = .add }.buttonStyle(.glassProminent)
          } else {
            Button("Show all") { withAnimation { cat = nil; brand = nil } }.buttonStyle(.glass)
          }
        }
        .padding(.top, 80)
      } else {
        LookGrid(items: visible, context: "looks").padding(.vertical, 12)
      }
    }
    .background(Color.white)
    .navigationTitle(brand ?? cat.map { Tax.label($0) } ?? "Looks")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Picker("Category", selection: $cat) {
            Text("All").tag(String?.none)
            ForEach(cats, id: \.self) { Text(Tax.label($0)).tag(Optional($0)) }
          }
          if let b = brand {
            Button("Clear \(b)", systemImage: "xmark") { brand = nil }
          }
        } label: {
          Image(systemName: cat == nil && brand == nil ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
        }
      }
    }
    .refreshable { await model.refreshLists() }
  }
}

struct ClosetView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 40) {
        if model.wardrobe.isEmpty {
          ContentUnavailableView {
            Label("Your closet is empty", systemImage: "hanger")
          } description: {
            Text("Add what you already own to complete fits.")
          } actions: {
            Button("Add a piece") { model.addOwn = true; model.tab = .add }.buttonStyle(.glassProminent)
          }
          .padding(.top, 80)
        }
        ForEach(Tax.familyOrder, id: \.self) { fam in
          let list = model.wardrobe.filter { Tax.family($0.category) == fam }
          if !list.isEmpty {
            VStack(alignment: .leading, spacing: 18) {
              SectionHead(title: "\(Tax.familyLabel[fam] ?? fam) · \(list.count)") { EmptyView() }.padding(.horizontal, 16)
              LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 26) {
                ForEach(list) { g in
                  NavigationLink(value: Route.piece(id: g.id, source: "closet-\(g.id)")) {
                    PieceCard(g: g, source: "closet-\(g.id)")
                  }
                  .buttonStyle(.plain)
                }
              }
              .padding(.horizontal, 16)
            }
          }
        }
      }
      .padding(.top, 12)
      .padding(.bottom, 40)
    }
    .background(Color.white)
    .navigationTitle("Closet")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Add", systemImage: "plus") { model.addOwn = true; model.tab = .add }
      }
    }
    .refreshable { await model.refreshLists() }
  }
}
