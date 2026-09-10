import SwiftUI

@main
struct ClosetApp: App {
  @State private var model = AppModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .task { await model.boot() }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { model.resume() }
        }
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ZStack {
      switch model.phase {
      case .loading:
        Color.white.ignoresSafeArea()
        Wordmark(size: 60)
      case .failed(let message):
        ContentUnavailableView {
          Wordmark(size: 60)
        } description: {
          Text(message)
        } actions: {
          Button("Try again") { Task { await model.boot() } }.buttonStyle(.glassProminent)
        }
      case .signedOut:
        LoginView()
      case .signedIn:
        MainTabs()
      }
    }
    .overlay(alignment: .bottom) { ToastView() }
  }
}

struct MainTabs: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    TabView(selection: $model.tab) {
      Tab("Looks", systemImage: "sparkles.rectangle.stack", value: AppTab.home) {
        NavigationStack { HomeView().routes() }
      }
      Tab("Closet", systemImage: "hanger", value: AppTab.closet) {
        NavigationStack { ClosetView().routes() }
      }
      Tab("Add", systemImage: "plus", value: AppTab.add) {
        NavigationStack { AddView().routes() }
      }
      Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
        NavigationStack { SettingsView().routes() }
      }
    }
    .tint(Theme.fg)
  }
}
