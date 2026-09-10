import SwiftUI

struct LoginView: View {
  @Environment(AppModel.self) private var model
  @AppStorage("closet_email") private var email = ""
  @State private var code = ""
  @State private var codeSent = false
  @State private var sending = false
  @State private var verifying = false
  @State private var passkeyBusy = false
  @FocusState private var codeFocused: Bool

  private var hasPasskey: Bool { (model.me?.passkeys ?? 0) > 0 }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Wordmark(size: 64).frame(maxWidth: .infinity).padding(.vertical, 24)
        }
        .listRowBackground(Color.clear)

        if hasPasskey {
          Section {
            Button {
              Task { await passkey() }
            } label: {
              HStack {
                Label("Sign in with passkey", systemImage: "person.badge.key")
                if passkeyBusy { Spacer(); ProgressView() }
              }
            }
            .disabled(passkeyBusy)
          }
        }

        Section {
          TextField("Email", text: $email)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.send)
            .onSubmit { Task { await sendCode() } }
          Button {
            Task { await sendCode() }
          } label: {
            HStack {
              Text(codeSent ? "Send a new code" : "Send login code")
              if sending { Spacer(); ProgressView() }
            }
          }
          .disabled(sending || email.trimmed.isEmpty)
        }

        if codeSent {
          Section {
            TextField("Code", text: $code)
              .textContentType(.oneTimeCode)
              .keyboardType(.numberPad)
              .font(.title2.monospacedDigit())
              .focused($codeFocused)
              .onChange(of: code) { _, v in
                let digits = String(v.filter(\.isNumber).prefix(6))
                if digits != v { code = digits }
                if digits.count == 6 { Task { await verify() } }
              }
            if verifying { ProgressView().frame(maxWidth: .infinity) }
          } footer: {
            Text("Valid for 10 minutes.")
          }
        }
      }
      .tint(Theme.fg)
    }
    .task {
      if hasPasskey && model.autoPasskey { await passkey() }
    }
  }

  private func passkey() async {
    guard !passkeyBusy else { return }
    passkeyBusy = true
    defer { passkeyBusy = false }
    do {
      try await Passkeys.signIn()
      await model.didSignIn()
    } catch {
      if Passkeys.isCancel(error) { return }
      model.show((error as? APIError)?.message ?? "Passkey sign-in failed", error: true)
    }
  }

  private func sendCode() async {
    let e = email.trimmed
    guard !e.isEmpty, !sending else { return }
    sending = true
    defer { sending = false }
    do {
      try await API.call("POST", "/api/auth/email/start", ["email": e])
      email = e
      withAnimation { codeSent = true }
      code = ""
      codeFocused = true
      model.show("If that address is allowed, a code is on its way.")
    } catch { model.fail(error) }
  }

  private func verify() async {
    guard !verifying, code.count == 6 else { return }
    verifying = true
    defer { verifying = false }
    do {
      try await API.call("POST", "/api/auth/email/verify", ["email": email.trimmed, "code": code])
      await model.didSignIn()
    } catch {
      model.fail(error)
      code = ""
    }
  }
}
