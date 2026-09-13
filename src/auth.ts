import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import type { Env } from "./env";
import { reserve } from "./budget";

const SESSION_COOKIE = "closet_session";
const SESSION_TTL = 60 * 60 * 24 * 60; // 60 days
const CODE_TTL = 10 * 60; // 10 minutes
const CHALLENGE_TTL = 5 * 60;

export const now = () => Math.floor(Date.now() / 1000);

export function randomId(bytes = 24): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return b64url(new Uint8Array(d));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- sessions ----------

export async function createSession(c: Context<{ Bindings: Env }>): Promise<string> {
  const id = randomId(32);
  const t = now();
  // Opportunistic cleanup of expired rows.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    c.env.DB.prepare("DELETE FROM email_codes WHERE expires_at < ?").bind(t),
    c.env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(t),
  ]);
  await c.env.DB.prepare("INSERT INTO sessions (id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)")
    .bind(id, t, t + SESSION_TTL, c.req.header("user-agent") ?? null)
    .run();
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: c.env.ORIGIN.startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return id;
}

export async function getSession(c: Context<{ Bindings: Env }>): Promise<{ id: string } | null> {
  const id = getCookie(c, SESSION_COOKIE);
  if (!id) return null;
  const row = await c.env.DB.prepare("SELECT id, expires_at FROM sessions WHERE id = ?").bind(id).first<{ id: string; expires_at: number }>();
  if (!row || row.expires_at < now()) return null;
  return { id: row.id };
}

export async function destroySession(c: Context<{ Bindings: Env }>): Promise<void> {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const s = await getSession(c);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  await next();
};

// ---------- email code ----------

export async function startEmailCode(c: Context<{ Bindings: Env }>, emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  if (email !== c.env.ALLOWED_EMAIL.toLowerCase()) {
    // Deliberately silent: only the owner gets a code, nobody learns which address is valid.
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    return;
  }
  // Throttle: at most one email per minute, so nobody can flood the inbox by hammering the endpoint.
  const recent = await c.env.DB.prepare("SELECT expires_at FROM email_codes WHERE email = ?").bind(email).first<{ expires_at: number }>();
  if (recent && recent.expires_at - CODE_TTL > now() - 60) return;
  // A global cap on sends, whatever the client address: rotating IPs cannot flood the inbox.
  await reserve(c.env, "mail", 1);
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const hash = await sha256(`${email}:${code}`);
  // A new code keeps the failed attempts of a still-valid previous one, so re-requesting never resets the guess budget.
  await c.env.DB.prepare(
    "INSERT INTO email_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = CASE WHEN email_codes.expires_at >= ? THEN email_codes.attempts ELSE 0 END",
  )
    .bind(email, hash, now() + CODE_TTL, now())
    .run();

  const res = await fetch("https://api.dairo.app/v1/messages", {
    method: "POST",
    headers: { authorization: `Bearer ${c.env.DAIRO_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      inboxId: c.env.DAIRO_INBOX_ID,
      to: [email],
      subject: `${code} is your closet login code`,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px 24px;color:#111">
<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#888;margin:0 0 24px">${c.env.RP_ID}</p>
<p style="font-size:15px;margin:0 0 12px">Your login code</p>
<p style="font-size:40px;font-weight:600;letter-spacing:.18em;margin:0 0 24px;font-variant-numeric:tabular-nums">${code}</p>
<p style="font-size:13px;color:#666;margin:0">Expires in 10 minutes. If you did not request this, ignore it.</p></div>`,
      tags: { app: "closet", kind: "login-code" },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`dairo send failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

export async function verifyEmailCode(c: Context<{ Bindings: Env }>, emailRaw: string, code: string): Promise<boolean> {
  const email = emailRaw.trim().toLowerCase();
  // Claim one attempt atomically: parallel requests cannot all read attempts = 0 and each get a guess.
  const row = await c.env.DB.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND attempts < 5 AND expires_at >= ? RETURNING code_hash")
    .bind(email, now())
    .first<{ code_hash: string }>();
  if (!row) return false;
  const ok = timingSafeEqual(await sha256(`${email}:${String(code ?? "").trim()}`), row.code_hash);
  if (ok) await c.env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(email).run();
  return ok;
}

// ---------- passkeys ----------

async function putChallenge(env: Env, kind: string, value: string): Promise<string> {
  const id = randomId(16);
  await env.DB.prepare("INSERT INTO challenges (id, kind, value, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, kind, value, now() + CHALLENGE_TTL)
    .run();
  return id;
}
async function takeChallenge(env: Env, id: string, kind: string): Promise<string | null> {
  // Take and delete in one statement, so a replayed response racing the first one finds nothing.
  const row = await env.DB.prepare("DELETE FROM challenges WHERE id = ? AND kind = ? RETURNING value, expires_at")
    .bind(id, kind)
    .first<{ value: string; expires_at: number }>();
  await env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(now()).run();
  if (!row || row.expires_at < now()) return null;
  return row.value;
}

type PasskeyRow = {
  id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number | null;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
};

export async function listPasskeys(env: Env): Promise<PasskeyRow[]> {
  const r = await env.DB.prepare("SELECT * FROM passkeys ORDER BY created_at DESC").all<PasskeyRow>();
  return r.results;
}

function ownerId(): Uint8Array<ArrayBuffer> {
  const u = new Uint8Array(new ArrayBuffer(5));
  u.set(new TextEncoder().encode("owner"));
  return u;
}

export async function passkeyRegistrationOptions(env: Env) {
  const existing = await listPasskeys(env);
  const options = await generateRegistrationOptions({
    rpName: "closet",
    rpID: env.RP_ID,
    userName: env.ALLOWED_EMAIL,
    userDisplayName: env.ALLOWED_EMAIL,
    userID: ownerId(),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? (JSON.parse(p.transports) as any) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = await putChallenge(env, "reg", options.challenge);
  return { options, challengeId };
}

export async function passkeyRegistrationVerify(env: Env, challengeId: string, response: any, name: string | null) {
  const expected = await takeChallenge(env, challengeId, "reg");
  if (!expected) throw new Error("challenge expired");
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: expected,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new Error("registration not verified");
  const cred = v.registrationInfo.credential;
  await env.DB.prepare(
    "INSERT INTO passkeys (id, public_key, counter, transports, device_type, backed_up, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      cred.id,
      b64url(cred.publicKey),
      cred.counter,
      cred.transports ? JSON.stringify(cred.transports) : null,
      v.registrationInfo.credentialDeviceType,
      v.registrationInfo.credentialBackedUp ? 1 : 0,
      name,
      now(),
    )
    .run();
  return { id: cred.id };
}

export async function passkeyAuthenticationOptions(env: Env) {
  const options = await generateAuthenticationOptions({ rpID: env.RP_ID, userVerification: "required" });
  const challengeId = await putChallenge(env, "auth", options.challenge);
  return { options, challengeId };
}

export async function passkeyAuthenticationVerify(env: Env, challengeId: string, response: any): Promise<boolean> {
  const expected = await takeChallenge(env, challengeId, "auth");
  if (!expected) throw new Error("challenge expired");
  const row = await env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(response.id).first<PasskeyRow>();
  if (!row) throw new Error("unknown passkey");
  const credential: WebAuthnCredential = {
    id: row.id,
    publicKey: fromB64url(row.public_key),
    counter: row.counter,
    transports: row.transports ? JSON.parse(row.transports) : undefined,
  };
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: expected,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    credential,
    requireUserVerification: true,
  });
  if (!v.verified) return false;
  await env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(v.authenticationInfo.newCounter, now(), row.id)
    .run();
  return true;
}
