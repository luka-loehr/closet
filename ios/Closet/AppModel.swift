import SwiftUI

@MainActor
@Observable
final class AppModel {
  enum Phase: Equatable { case loading, signedOut, signedIn, failed(String) }

  struct Toast: Equatable, Identifiable {
    let id = UUID()
    let message: String
    let isError: Bool
  }

  var phase: Phase = .loading
  var me: Me?
  var settings: ServerSettings?
  var looks: [Garment] = []
  var wardrobe: [Garment] = []
  var tab: AppTab = .home
  var addOwn = false
  var toast: Toast?
  /// The login screen offers the passkey sheet on its own, except right after a deliberate logout.
  var autoPasskey = true

  private var pollTask: Task<Void, Never>?

  init() {
    API.onUnauthorized = { [weak self] in
      guard let self, self.phase == .signedIn else { return }
      self.signedOut()
      self.show("Your session has expired. Sign in again.", error: true)
    }
  }

  var heroes: [Hero] { settings?.heroes ?? [] }
  var coverHeroes: [Hero] { heroes.filter(\.isDone) }

  var anyPending: Bool {
    looks.contains { $0.pending > 0 } || wardrobe.contains { $0.pending > 0 } || heroes.contains { $0.status == "pending" || $0.portraitStatus == "pending" }
  }

  // MARK: session

  func boot() async {
    if phase != .signedIn { phase = .loading }
    do {
      let m: Me = try await API.get("/api/me")
      me = m
      if m.authenticated {
        phase = .signedIn
        await refreshAll()
      } else {
        phase = .signedOut
      }
    } catch is CancellationError {
    } catch {
      phase = .failed(error.localizedDescription)
    }
  }

  func didSignIn() async {
    me = try? await API.get("/api/me")
    phase = .signedIn
    tab = .home
    await refreshAll()
  }

  func logout() async {
    try? await API.call("POST", "/api/auth/logout")
    API.clearSession()
    autoPasskey = false
    signedOut()
  }

  private func signedOut() {
    pollTask?.cancel(); pollTask = nil
    settings = nil; looks = []; wardrobe = []
    phase = .signedOut
  }

  // MARK: data

  func refreshAll() async {
    async let s: Void = reloadSettings()
    async let l: Void = refreshLists()
    _ = await (s, l)
    watch()
  }

  func reloadSettings() async {
    do {
      let s: ServerSettings = try await API.get("/api/settings")
      Tax.load(s.taxonomy)
      settings = s
    } catch { fail(error) }
  }

  func refreshLists() async {
    do {
      async let a: [Garment] = API.get("/api/garments?limit=300&owned=0")
      async let b: [Garment] = API.get("/api/garments?limit=300&owned=1")
      let (tryOns, owned) = try await (a, b)
      if tryOns != looks { looks = tryOns }
      if owned != wardrobe { wardrobe = owned }
    } catch { fail(error) }
  }

  func resume() {
    guard phase == .signedIn else { return }
    Task { await refreshLists(); watch() }
  }

  /// While anything generates, refresh in place: 4 s, backing off to 12 s while nothing changes.
  func watch() {
    guard pollTask == nil, anyPending else { return }
    pollTask = Task { [weak self] in
      var delay = 4.0
      let started = Date()
      while !Task.isCancelled, Date().timeIntervalSince(started) < 20 * 60 {
        try? await Task.sleep(for: .seconds(delay))
        guard let self, !Task.isCancelled else { return }
        let before = self.signature
        let heroesPending = self.heroes.contains { $0.status == "pending" || $0.portraitStatus == "pending" }
        await self.refreshLists()
        if heroesPending { await self.reloadSettings() }
        if !self.anyPending { break }
        delay = before == self.signature ? min(12, delay + 1.5) : 4
      }
      // A cancelled loop must not clear the handle of the loop that replaced it.
      if !Task.isCancelled { self?.pollTask = nil }
    }
  }

  private var signature: String {
    (looks + wardrobe).map { "\($0.id)\($0.pending)\($0.errors)\($0.studioKey ?? "")\($0.covers.keys.sorted())" }.joined()
      + heroes.map { "\($0.id)\($0.status)\($0.portraitStatus ?? "")" }.joined()
  }

  // MARK: feedback

  func show(_ message: String, error: Bool = false) {
    let t = Toast(message: message, isError: error)
    withAnimation(.spring(duration: 0.4)) { toast = t }
    Task {
      try? await Task.sleep(for: .seconds(error ? 4.5 : 3.2))
      if toast?.id == t.id { withAnimation(.easeOut(duration: 0.3)) { toast = nil } }
    }
  }

  func fail(_ error: Error) {
    if error is CancellationError { return }
    if let e = error as? APIError, e.status == 401 { return }
    show(error.localizedDescription, error: true)
  }
}
