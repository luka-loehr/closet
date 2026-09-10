import Foundation

struct Me: Decodable {
  let authenticated: Bool
  let email: String?
  let passkeys: Int?
}

struct Look: Decodable, Identifiable, Hashable {
  let id: String
  let garmentId: String
  let variant: String
  let status: String
  let r2Key: String?
  let thumbKey: String?
  let error: String?
  let createdAt: Int
}

struct Analysis: Decodable, Hashable {
  let model: String?
  let ms: Double
  let foundBrand: Bool
}

struct Garment: Decodable, Identifiable, Hashable {
  let id: String
  let name: String
  let brand: String?
  let category: String?
  let color: String?
  let notes: String?
  var sourceUrl: String?
  let r2Key: String
  let thumbKey: String?
  let createdAt: Int
  let owned: Int
  let colors: [String]
  let description: String?
  let studioKey: String?
  let studioAltKey: String?
  let studioStatus: String?
  /// Newest finished look per variant (list endpoint only).
  let covers: [String: Look]
  let looks: [Look]?
  let paired: [Garment]?
  let pending: Int
  let errors: Int
  let analysis: Analysis?

  enum CodingKeys: String, CodingKey {
    case id, name, brand, category, color, notes, sourceUrl, r2Key, thumbKey, createdAt, owned, colors, description, studioKey, studioAltKey, studioStatus, covers, looks, paired, pending, errors, analysis
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    brand = try c.decodeIfPresent(String.self, forKey: .brand)
    category = try c.decodeIfPresent(String.self, forKey: .category)
    color = try c.decodeIfPresent(String.self, forKey: .color)
    notes = try c.decodeIfPresent(String.self, forKey: .notes)
    sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
    r2Key = try c.decode(String.self, forKey: .r2Key)
    thumbKey = try c.decodeIfPresent(String.self, forKey: .thumbKey)
    createdAt = try c.decodeIfPresent(Int.self, forKey: .createdAt) ?? 0
    owned = try c.decodeIfPresent(Int.self, forKey: .owned) ?? 0
    colors = (try? c.decode([String].self, forKey: .colors)) ?? []
    description = try c.decodeIfPresent(String.self, forKey: .description)
    studioKey = try c.decodeIfPresent(String.self, forKey: .studioKey)
    studioAltKey = try c.decodeIfPresent(String.self, forKey: .studioAltKey)
    studioStatus = try c.decodeIfPresent(String.self, forKey: .studioStatus)
    // The single-garment endpoint sends `covers` as the list of slots; only the list endpoint sends looks by variant.
    covers = (try? c.decode([String: Look].self, forKey: .covers)) ?? [:]
    looks = try c.decodeIfPresent([Look].self, forKey: .looks)
    paired = try c.decodeIfPresent([Garment].self, forKey: .paired)
    pending = (try? c.decode(Int.self, forKey: .pending)) ?? 0
    errors = (try? c.decode(Int.self, forKey: .errors)) ?? 0
    analysis = try? c.decode(Analysis.self, forKey: .analysis)
  }
}

extension Garment {
  var mainCover: Look? { covers["white"] ?? covers["dark"] }
  var altCover: Look? { mainCover?.variant == "white" ? covers["dark"] : nil }
  var meta: String { [brand, category.map { Tax.label($0) }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }

  static func thumb(_ key: String, _ thumb: Bool) -> String {
    thumb && key.hasSuffix(".webp") ? String(key.dropLast(5)) + ".t.webp" : key
  }
  /// Only generated studio views are shown for owned pieces; the uploaded photo stays private model input.
  func pieceKey(thumb: Bool = true) -> String? {
    guard let s = studioKey, s != r2Key else { return nil }
    return Garment.thumb(s, thumb)
  }
  func pieceAltKey(thumb: Bool = true) -> String? { studioAltKey.map { Garment.thumb($0, thumb) } }

  func look(_ v: String) -> Look? { looks?.first { $0.variant == v && $0.status == "done" } }
  func lookPending(_ v: String) -> Bool { look(v) == nil && (looks ?? []).contains { $0.variant == v && $0.status == "pending" } }
  func lookFailed(_ v: String) -> Look? { look(v) == nil && !lookPending(v) ? looks?.first { $0.variant == v && $0.status == "error" } : nil }
  var anyLookPending: Bool { (looks ?? []).contains { $0.status == "pending" } }
}

struct Hero: Decodable, Identifiable, Hashable {
  let id: String
  let r2Key: String?
  let garmentIds: [String]
  let style: String
  let model: String
  let status: String
  let error: String?
  let createdAt: Int
  let portraitKey: String?
  let portraitStatus: String?
  let portraitError: String?

  var isDone: Bool { status == "done" && r2Key != nil }
  /// Only generated covers (not uploads) can be recomposed as a phone cover.
  var needsPortrait: Bool { isDone && model != "upload" && garmentIds.count >= 2 && portraitStatus != "pending" && (portraitKey == nil || portraitStatus == "error") }
}

struct TaxCategory: Decodable, Hashable, Identifiable { let id: String; let label: String }
struct TaxFamily: Decodable, Hashable, Identifiable {
  let family: String
  let label: String
  let categories: [TaxCategory]
  var id: String { family }
}

struct Budget: Decodable, Hashable {
  struct Limits: Decodable, Hashable { let hour: Int; let day: Int }
  let hour: Int
  let day: Int
  let limits: Limits
}

struct Budgets: Decodable, Hashable { let analysis: Budget; let image: Budget; let hero: Budget }

struct ServerSettings: Decodable {
  let model: String
  let lookQuality: String
  let heroQuality: String
  let qualities: [String]
  let heroStyles: [String]
  let baseRef: String?
  let heroes: [Hero]
  let analysisModel: String?
  let taxonomy: [TaxFamily]
  let slots: [String]
  let budget: Budgets?
}

struct RefPhoto: Decodable, Identifiable, Hashable {
  let id: String
  let r2Key: String
  /// Absent on the upload response.
  let isBase: Bool?
}

struct Passkey: Decodable, Identifiable, Hashable {
  let id: String
  let name: String?
  let createdAt: Int
}

enum Variants {
  static let all = ["white", "dark"]
  static func label(_ v: String) -> String { v == "dark" ? "Dark" : "Studio" }
}

enum Styles {
  static let label: [String: String] = ["nyc": "New York", "beach": "Volcanic beach", "wheel": "Ferris wheel", "wall": "White wall", "rooftop": "Rooftop", "garage": "Garage", "studio": "Studio"]
  static func name(_ s: String) -> String { label[s] ?? s.capitalized }
}

enum Route: Hashable {
  case look(id: String, source: String)
  case piece(id: String, source: String)
  case looks(cat: String?, brand: String?)
  case newCover
  case references
}

enum AppTab: Hashable { case home, closet, add, settings }
