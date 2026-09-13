import AuthenticationServices
import UIKit

/// Native passkeys for the configured host (webcredentials associated domain), talking to the same
/// @simplewebauthn endpoints as the website. Responses are encoded as the WebAuthn JSON the server expects.
@MainActor
final class Passkeys: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private var continuation: CheckedContinuation<ASAuthorization, Error>?
  private var controller: ASAuthorizationController?

  static func isCancel(_ error: Error) -> Bool {
    (error as? ASAuthorizationError)?.code == .canceled
  }

  static func signIn() async throws {
    let data = try await API.call("POST", "/api/auth/passkey/login/options")
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let options = obj["options"] as? [String: Any], let challengeId = obj["challengeId"] as? String,
          let challenge = (options["challenge"] as? String).flatMap({ Data(base64URL: $0) }) else {
      throw APIError(message: "Passkey sign-in failed", status: 0)
    }
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: API.host)
    let request = provider.createCredentialAssertionRequest(challenge: challenge)
    let auth = try await Passkeys().perform(request)
    guard let cred = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
      throw APIError(message: "Passkey sign-in failed", status: 0)
    }
    let response: [String: Any] = [
      "id": cred.credentialID.base64URL,
      "rawId": cred.credentialID.base64URL,
      "type": "public-key",
      "authenticatorAttachment": "platform",
      "clientExtensionResults": [String: Any](),
      "response": [
        "clientDataJSON": cred.rawClientDataJSON.base64URL,
        "authenticatorData": cred.rawAuthenticatorData.base64URL,
        "signature": cred.signature.base64URL,
        "userHandle": (cred.userID ?? Data()).base64URL,
      ],
    ]
    try await API.call("POST", "/api/auth/passkey/login/verify", ["challengeId": challengeId, "response": response])
  }

  static func register(existing: [String]) async throws {
    let data = try await API.call("POST", "/api/auth/passkey/register/options")
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let options = obj["options"] as? [String: Any], let challengeId = obj["challengeId"] as? String,
          let challenge = (options["challenge"] as? String).flatMap({ Data(base64URL: $0) }),
          let user = options["user"] as? [String: Any],
          let userID = (user["id"] as? String).flatMap({ Data(base64URL: $0) }) else {
      throw APIError(message: "Could not add passkey", status: 0)
    }
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: API.host)
    let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: user["name"] as? String ?? "closet", userID: userID)
    request.excludedCredentials = existing.compactMap { Data(base64URL: $0) }.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
    let auth = try await Passkeys().perform(request)
    guard let cred = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration, let attestation = cred.rawAttestationObject else {
      throw APIError(message: "Could not add passkey", status: 0)
    }
    let response: [String: Any] = [
      "id": cred.credentialID.base64URL,
      "rawId": cred.credentialID.base64URL,
      "type": "public-key",
      "authenticatorAttachment": "platform",
      "clientExtensionResults": [String: Any](),
      "response": [
        "clientDataJSON": cred.rawClientDataJSON.base64URL,
        "attestationObject": attestation.base64URL,
        "transports": ["internal", "hybrid"],
      ],
    ]
    try await API.call("POST", "/api/auth/passkey/register/verify", ["challengeId": challengeId, "response": response, "name": "iPhone app"])
  }

  private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
    try await withCheckedThrowingContinuation { c in
      continuation = c
      let ctl = ASAuthorizationController(authorizationRequests: [request])
      ctl.delegate = self
      ctl.presentationContextProvider = self
      controller = ctl
      ctl.performRequests()
    }
  }

  nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    MainActor.assumeIsolated {
      continuation?.resume(returning: authorization)
      continuation = nil
      self.controller = nil
    }
  }

  nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    MainActor.assumeIsolated {
      continuation?.resume(throwing: error)
      continuation = nil
      self.controller = nil
    }
  }

  nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    MainActor.assumeIsolated {
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
  }
}
