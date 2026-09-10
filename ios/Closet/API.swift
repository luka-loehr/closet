import Foundation
import UIKit

struct APIError: LocalizedError {
  let message: String
  let status: Int
  var errorDescription: String? { message }
}

private struct ErrorBody: Decodable { let error: String? }

/// The closet Worker API. The session is the same HttpOnly cookie the website uses, kept in the shared cookie store.
enum API {
  static let host = "closet.lukaloehr.com"
  static let base = "https://closet.lukaloehr.com"

  static let session: URLSession = {
    let c = URLSessionConfiguration.default
    c.httpCookieStorage = .shared
    c.httpCookieAcceptPolicy = .always
    c.httpShouldSetCookies = true
    // /img/* is immutable, so the disk cache makes every image a one-time download.
    c.urlCache = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
    c.timeoutIntervalForRequest = 90
    return URLSession(configuration: c)
  }()

  static let decoder: JSONDecoder = {
    let d = JSONDecoder()
    d.keyDecodingStrategy = .convertFromSnakeCase
    return d
  }()

  /// Called when an authenticated request comes back 401: the session expired under us.
  @MainActor static var onUnauthorized: (() -> Void)?

  static func imageURL(_ key: String) -> URL? {
    key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed).flatMap { URL(string: "\(base)/img/\($0)") }
  }

  private static func url(_ path: String) throws -> URL {
    guard let u = URL(string: base + path) else { throw APIError(message: "Invalid request.", status: 0) }
    return u
  }

  static func get<T: Decodable>(_ path: String) async throws -> T {
    try decode(try await call("GET", path))
  }

  static func send<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any]? = nil) async throws -> T {
    try decode(try await call(method, path, body))
  }

  @discardableResult
  static func call(_ method: String, _ path: String, _ body: [String: Any]? = nil) async throws -> Data {
    var req = URLRequest(url: try url(path))
    req.httpMethod = method
    req.cachePolicy = .reloadIgnoringLocalCacheData
    if let body {
      req.httpBody = try JSONSerialization.data(withJSONObject: body)
      req.setValue("application/json", forHTTPHeaderField: "content-type")
    }
    return try await perform(req, path: path)
  }

  /// Multipart upload of one image as `file`, plus plain text fields.
  static func upload<T: Decodable>(_ path: String, image: Data, fields: [String: String] = [:]) async throws -> T {
    let boundary = "closet-\(UUID().uuidString)"
    var d = Data()
    for (k, v) in fields {
      d.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(k)\"\r\n\r\n\(v)\r\n")
    }
    d.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
    d.append(image)
    d.append("\r\n--\(boundary)--\r\n")
    var req = URLRequest(url: try url(path))
    req.httpMethod = "POST"
    req.httpBody = d
    req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
    return try decode(try await perform(req, path: path))
  }

  private static func perform(_ req: URLRequest, path: String) async throws -> Data {
    let data: Data
    let res: URLResponse
    do {
      (data, res) = try await session.data(for: req)
    } catch {
      if (error as? URLError)?.code == .cancelled || error is CancellationError { throw CancellationError() }
      throw APIError(message: "You seem to be offline. Check the connection and try again.", status: 0)
    }
    let status = (res as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 && !path.hasPrefix("/api/auth") && path != "/api/me" {
      await MainActor.run { onUnauthorized?() }
      throw APIError(message: "Your session has expired. Sign in again.", status: 401)
    }
    guard (200..<300).contains(status) else {
      let raw = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
      let fallback = status == 429 ? "Too many requests, try again later." : status >= 500 ? "Something went wrong, please try again." : "Request failed (\(status))"
      throw APIError(message: raw.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? fallback, status: status)
    }
    return data
  }

  private static func decode<T: Decodable>(_ data: Data) throws -> T {
    do { return try decoder.decode(T.self, from: data) } catch {
      #if DEBUG
      print("decode \(T.self) failed:", error)
      #endif
      throw APIError(message: "Unexpected response from the server.", status: 0)
    }
  }

  static func clearSession() {
    for c in HTTPCookieStorage.shared.cookies ?? [] where c.domain.contains(host) { HTTPCookieStorage.shared.deleteCookie(c) }
  }
}

extension Data {
  mutating func append(_ s: String) { append(s.data(using: .utf8)!) }

  init?(base64URL s: String) {
    var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while b.count % 4 != 0 { b += "=" }
    self.init(base64Encoded: b)
  }

  var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}

extension UIImage {
  /// JPEG for upload: longest edge at most `maxEdge`, well under the 12 MB cap.
  func uploadJPEG(maxEdge: CGFloat = 2048, quality: CGFloat = 0.9) -> Data {
    let longest = max(size.width, size.height)
    let scale = longest > maxEdge ? maxEdge / longest : 1
    let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let out = UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    return out.jpegData(compressionQuality: quality) ?? Data()
  }
}
