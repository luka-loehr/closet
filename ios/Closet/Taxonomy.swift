import SwiftUI

/// Port of src/taxonomy.ts rules. Category ids, labels and families come from /api/settings.
enum Tax {
  static var families: [TaxFamily] = []
  private static var familyById: [String: String] = [:]
  private static var labelById: [String: String] = [:]

  static let familyOrder = ["shoes", "bottoms", "tops", "outerwear", "sets", "dresses", "accessories", "other"]
  static let familyLabel = ["tops": "Tops", "outerwear": "Outerwear", "bottoms": "Bottoms", "sets": "Sets", "dresses": "Dresses & one-pieces", "shoes": "Shoes", "accessories": "Accessories", "other": "Other"]
  static let slotLabel = ["top": "Top", "bottom": "Bottom", "shoes": "Shoes", "outerwear": "Jacket", "accessory": "Accessory"]

  static func load(_ list: [TaxFamily]) {
    families = list
    for f in list {
      for c in f.categories { familyById[c.id] = f.family; labelById[c.id] = c.label }
    }
  }

  static func family(_ id: String?) -> String { id.flatMap { familyById[$0] } ?? "other" }
  static func label(_ id: String?) -> String { id.flatMap { labelById[$0] } ?? (id ?? "") }

  static func slots(_ id: String?) -> [String] {
    if id == "suit" { return ["top", "bottom", "outerwear"] }
    if id == "swimwear" { return ["bottom"] }
    switch family(id) {
    case "tops": return ["top"]
    case "outerwear": return ["outerwear"]
    case "bottoms": return ["bottom"]
    case "sets", "dresses": return ["top", "bottom"]
    case "shoes": return ["shoes"]
    case "accessories": return ["accessory"]
    default: return []
    }
  }

  /// Which slots a full fit still needs when the piece is worn over the base outfit.
  static func missing(_ id: String?) -> [String] {
    switch family(id) {
    case "tops", "outerwear": return ["bottom", "shoes"]
    case "bottoms": return ["top", "shoes"]
    case "shoes": return ["top", "bottom"]
    case "sets", "dresses": return ["shoes"]
    default: return []
    }
  }

  static func detailFills(_ id: String?) -> Bool { ["tops", "outerwear", "bottoms", "sets", "dresses"].contains(family(id)) }

  private static let swatch: [String: UInt32] = ["black": 0x111111, "white": 0xFFFFFF, "off-white": 0xF3EFE6, "cream": 0xF1E9D2, "ivory": 0xF4F0E4, "grey": 0x8A8A8A, "gray": 0x8A8A8A, "light grey": 0xC9C9C9, "light gray": 0xC9C9C9, "dark grey": 0x4A4A4A, "dark gray": 0x4A4A4A, "heather": 0xB9B9B9, "heather grey": 0xB9B9B9, "charcoal": 0x3A3A3A, "anthracite": 0x3D3F42, "silver": 0xC0C0C0, "navy": 0x1C2A4A, "blue": 0x2F5FB3, "light blue": 0x9DBDE3, "sky blue": 0x8CC4EC, "royal blue": 0x2B4BD4, "denim": 0x4F6D9C, "indigo": 0x2E3A7A, "teal": 0x227A7A, "green": 0x2F7A3A, "olive": 0x6B6F3A, "forest green": 0x1F5230, "khaki": 0xB8A877, "sage": 0x9AA98A, "mint": 0xB6E3C6, "beige": 0xD9C9A8, "sand": 0xD8C39A, "tan": 0xC9A575, "camel": 0xB98A52, "brown": 0x6B4A2E, "dark brown": 0x40291A, "chocolate": 0x3F2415, "burgundy": 0x6B1E2B, "maroon": 0x6B1E2B, "red": 0xC8202A, "orange": 0xE57A1F, "yellow": 0xE8C53A, "mustard": 0xC7A12A, "pink": 0xE9A6B9, "purple": 0x6A3FA0, "lavender": 0xB7A4D8, "gold": 0xC9A63C]

  static func swatchColor(_ name: String) -> Color {
    let n = name.lowercased().trimmingCharacters(in: .whitespaces)
    if let h = swatch[n] { return Color(hex: h) }
    let last = n.split(whereSeparator: { $0 == " " || $0 == "-" }).last.map(String.init) ?? n
    return Color(hex: swatch[last] ?? 0xC8C8C8)
  }
}
