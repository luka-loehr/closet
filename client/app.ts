import { startAuthentication, startRegistration, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { CATEGORIES_BY_FAMILY, FAMILY_LABEL, FAMILY_ORDER, detailFills, familyOf, labelOf, missingSlots, slotsOf as taxSlots } from "../src/taxonomy";

// ---------- types ----------
type Look = { id: string; garment_id: string; variant: string; pose: string; model: string; status: string; r2_key: string | null; thumb_key: string | null; error: string | null; duration_ms: number | null; created_at: number; pairing?: string[] };
type Garment = {
  id: string; name: string; brand: string | null; category: string | null; color: string | null; notes: string | null; source_url: string | null; r2_key: string; thumb_key: string | null; created_at: number;
  owned: number; draft: number; colors: string[]; description: string | null; missing: string[]; studio_key: string | null; studio_alt_key: string | null; studio_status: string | null; family?: string; category_label?: string; detail_fill?: boolean;
  covers?: Record<string, Look>; looks?: Look[]; paired?: Garment[]; pending?: number; errors?: number; slots?: string[];
  analysis?: { model: string | null; fallback?: string | null; ms: number; found_brand: boolean; found_name: boolean; clean_product_shot: boolean };
};
type Hero = { id: string; r2_key: string | null; garment_ids: string[]; style: string; model: string; status: string; error: string | null; created_at: number };
type Budget = { hour: number; day: number; limits: { hour: number; day: number } };
type Settings = { model: string; look_quality: string; hero_quality: string; qualities: string[]; variants: string[]; hero_styles: string[]; base_ref: string | null; heroes: Hero[]; analysis_model: string | null; categories: string[]; slots: string[]; budget?: { analysis: Budget; image: Budget; hero: Budget } };

const VARIANTS = ["white", "dark"] as const;
const VARIANT_LABEL: Record<string, string> = { white: "Studio", dark: "Dark" };
const QUALITY_LABEL: Record<string, string> = { medium: "Medium · ~40 s", high: "High · ~90 s" };
const STYLE_LABEL: Record<string, string> = { nyc: "New York", beach: "Volcanic beach", wheel: "Ferris wheel", wall: "White wall", rooftop: "Rooftop", garage: "Garage", studio: "Studio" };
const NAV = [{ href: "/", label: "Looks", key: "home" }, { href: "/closet", label: "Closet", key: "closet" }, { href: "/settings", label: "Settings", key: "settings" }];
const SLOT_LABEL: Record<string, string> = { top: "Top", bottom: "Bottom", shoes: "Shoes", outerwear: "Jacket", accessory: "Accessory" };
const CAT_LABEL = new Proxy({} as Record<string, string>, { get: (_t, k: string) => labelOf(k) });
const SWATCH: Record<string, string> = { black: "#111", white: "#fff", "off-white": "#f3efe6", cream: "#f1e9d2", ivory: "#f4f0e4", grey: "#8a8a8a", gray: "#8a8a8a", "light grey": "#c9c9c9", "light gray": "#c9c9c9", "dark grey": "#4a4a4a", "dark gray": "#4a4a4a", heather: "#b9b9b9", "heather grey": "#b9b9b9", charcoal: "#3a3a3a", anthracite: "#3d3f42", silver: "#c0c0c0", navy: "#1c2a4a", blue: "#2f5fb3", "light blue": "#9dbde3", "sky blue": "#8cc4ec", "royal blue": "#2b4bd4", denim: "#4f6d9c", indigo: "#2e3a7a", teal: "#227a7a", green: "#2f7a3a", olive: "#6b6f3a", "forest green": "#1f5230", khaki: "#b8a877", sage: "#9aa98a", mint: "#b6e3c6", beige: "#d9c9a8", sand: "#d8c39a", tan: "#c9a575", camel: "#b98a52", brown: "#6b4a2e", "dark brown": "#40291a", chocolate: "#3f2415", burgundy: "#6b1e2b", maroon: "#6b1e2b", red: "#c8202a", orange: "#e57a1f", yellow: "#e8c53a", mustard: "#c7a12a", pink: "#e9a6b9", purple: "#6a3fa0", lavender: "#b7a4d8", gold: "#c9a63c" };

// ---------- utils ----------
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const img = (key: string | null | undefined) => (key ? `/img/${key}` : "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const swatch = (name: string) => { const n = name.toLowerCase().trim(); if (SWATCH[n]) return SWATCH[n]; const last = n.split(/[\s-]+/).pop() ?? n; if (SWATCH[last]) return SWATCH[last]; return CSS.supports("color", n) ? n : "#c8c8c8"; };
const swatches = (colors: string[] | undefined) => (colors?.length ? `<span class="swatches">${colors.map((c) => `<i style="background:${esc(swatch(c))}" title="${esc(c)}"></i>`).join("")}</span>` : "");
/** The wardrobe image of a piece: the studio shot once it exists, else the upload. */
const thumbOf = (key: string, thumb: boolean) => img(thumb && key.endsWith(".webp") ? key.replace(/\.webp$/, ".t.webp") : key);
/** Only generated studio views are ever shown; the uploaded photo is model input and stays private. */
const pieceImg = (g: Garment, thumb = true) => (g.studio_key && g.studio_key !== g.r2_key ? thumbOf(g.studio_key, thumb) : "");
const pieceAlt = (g: Garment, thumb = true) => (g.studio_alt_key ? thumbOf(g.studio_alt_key, thumb) : "");
const slotsOf = (cat: string | null | undefined): string[] => taxSlots(cat);
const app = $("#app")!;
let me: { authenticated: boolean; email?: string; passkeys?: number } = { authenticated: false };
let settingsCache: Settings | null = null;

function toast(msg: string, error = false, ms = 3200) {
  const t = $("#toast")!;
  t.textContent = msg;
  t.className = error ? "error" : "";
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout((t as any)._t);
  (t as any)._t = setTimeout(() => (t.hidden = true), ms);
}
/** Error toast for a failed request; a lost session already redirected to login and says so itself. */
const fail = (err: any, ms = 4000) => { if (err?.name !== "AuthError") toast(err?.message || "Something went wrong, please try again.", true, ms); };

// A thin progress line while a route or viewer is loading, so a slow network never looks like a dead click.
let busyCount = 0;
function busy(on: boolean) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  let bar = $("#progress");
  if (!bar) { bar = document.createElement("div"); bar.id = "progress"; document.body.appendChild(bar); }
  bar.classList.toggle("on", busyCount > 0);
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (init.body && !(init.body instanceof FormData) && !headers["content-type"]) headers["content-type"] = "application/json";
  let res: Response;
  try { res = await fetch(path, { ...init, headers, credentials: "same-origin" }); }
  catch { throw new Error("You seem to be offline. Check the connection and try again."); }
  if (res.status === 401 && !path.startsWith("/api/auth") && path !== "/api/me") {
    // The session expired under us: back to login, once, with a word about why.
    const wasIn = me.authenticated;
    me = { authenticated: false }; settingsCache = null;
    if (wasIn) { toast("Your session has expired. Sign in again.", true, 5000); navigate("/login", true); }
    throw Object.assign(new Error("unauthorized"), { name: "AuthError", status: 401 });
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || (res.status === 429 ? "Too many requests, try again later." : res.status >= 500 ? "Something went wrong, please try again." : `Request failed (${res.status})`);
    throw Object.assign(new Error(msg), { data, status: res.status });
  }
  return data as T;
}

// ---------- history: scroll restoration per entry, list pages stay alive under the viewers ----------
history.scrollRestoration = "manual";
const routeKey = () => location.pathname + location.search;
/** The list route currently rendered in #main (path + search), so a popstate back onto it restores scroll instead of re-rendering. */
let renderedKey = "";
let pendingScroll: number | null = null;
const saveScroll = () => history.replaceState({ ...(history.state ?? {}), scroll: window.scrollY }, "", location.href);
const scrollTo = (y: number) => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });

function navigate(path: string, replace = false) {
  if (replace) history.replaceState({}, "", path);
  else { saveScroll(); history.pushState({}, "", path); }
  pendingScroll = 0;
  render();
}
window.addEventListener("popstate", () => {
  const st = (history.state ?? {}) as { scroll?: number };
  const path = location.pathname;
  if (viewerEl && !path.startsWith("/g/")) closeViewer(false);
  if (pieceEl && !path.startsWith("/p/")) closePiece(false);
  const m = path.match(/^\/g\/([A-Za-z0-9_-]+)$/), pm = path.match(/^\/p\/([A-Za-z0-9_-]+)$/);
  if (m && (renderedKey === "/looks" || renderedKey.startsWith("/looks?") || renderedKey === "/")) return void openViewer(m[1], undefined, false);
  if (pm && renderedKey === "/closet") return void openPiece(pm[1], false);
  if (!m && !pm && routeKey() === renderedKey && mainEl && document.contains(mainEl)) { scrollTo(st.scroll ?? 0); return; }
  pendingScroll = st.scroll ?? 0;
  render();
});
window.addEventListener("pagehide", saveScroll);

async function getSettings(force = false): Promise<Settings> {
  if (!settingsCache || force) settingsCache = await api<Settings>("/api/settings");
  return settingsCache;
}

// ---------- persistent shell: header + main ----------
let mainEl: HTMLElement | null = null;
let headerEl: HTMLElement | null = null;

function ensureShell() {
  if (mainEl && headerEl && document.contains(mainEl)) return;
  app.innerHTML = `<header class="header" id="hdr">
    <nav class="nav">${NAV.map((n) => `<a href="${n.href}" data-key="${n.key}">${n.label}</a>`).join("")}</nav>
    <a class="brand" href="/">closet</a>
    <div class="tools"><a class="add" href="/add">+ Add</a><button data-action="logout" title="Log out">Out</button></div>
  </header><div id="main"></div>`;
  headerEl = $("#hdr")!;
  mainEl = $("#main")!;
}

function setHeader(active: string, over: boolean) {
  ensureShell();
  $$(".nav a", headerEl!).forEach((a) => a.classList.toggle("active", (a as HTMLElement).dataset.key === active));
  headerEl!.classList.toggle("over", over);
  headerEl!.classList.remove("solid");
  headerEl!.hidden = false;
}

// header turns solid once the hero is scrolled past (scroll listener + observer so it also works on layout jumps)
function syncHeaderSolid() {
  if (!headerEl?.classList.contains("over")) return;
  const hero = $(".hero");
  const solid = !hero || hero.getBoundingClientRect().bottom < 60;
  headerEl.classList.toggle("solid", solid);
}
window.addEventListener("scroll", syncHeaderSolid, { passive: true });
window.addEventListener("resize", syncHeaderSolid, { passive: true });
const heroObserver = new IntersectionObserver(syncHeaderSolid, { rootMargin: "-60px 0px 0px 0px", threshold: [0, 0.01, 0.05] });

let viewAbort = new AbortController();
async function swap(html: string) {
  ensureShell();
  if (mainEl!.innerHTML && !reduced()) { mainEl!.classList.add("leave"); await wait(220); }
  stopHero();
  viewAbort.abort();
  viewAbort = new AbortController();
  mainEl!.innerHTML = html;
  mainEl!.classList.remove("leave");
  renderedKey = routeKey();
  scrollTo(pendingScroll ?? 0);
  pendingScroll = null;
}

// ---------- polling: backoff, pauses while the tab is hidden, gives up after 20 minutes ----------
/** Call `tick` until it returns false. Starts at 4 s, backs off to 12 s while nothing changes, and stops with the view. */
function poll(tick: () => Promise<boolean | "changed">, signal: AbortSignal, first = 4000) {
  const started = Date.now();
  let delay = first;
  let timer: number | null = null;
  const schedule = (ms: number) => { if (timer) clearTimeout(timer); timer = window.setTimeout(run, ms); };
  const run = async () => {
    timer = null;
    if (signal.aborted || Date.now() - started > 20 * 60_000) return;
    if (document.hidden) return; // resumed by visibilitychange below
    let r: boolean | "changed" = false;
    try { r = await tick(); } catch { r = true; }
    if (signal.aborted || !r) return;
    delay = r === "changed" ? first : Math.min(12000, delay + 1500);
    schedule(delay);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !timer) run(); }, { signal });
  signal.addEventListener("abort", () => { if (timer) clearTimeout(timer); });
  schedule(first);
}

/**
 * Reconcile a card grid in place: cards are keyed by id, an existing card is only replaced when its state
 * signature changed (and then without the entrance animation), new cards are inserted where they belong,
 * gone cards are removed. Nothing else moves, so a polling refresh never makes the page jump.
 */
function patchCards(container: HTMLElement, html: string, key: "data-id" | "data-pid"): void {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const fresh = Array.from(tmp.children) as HTMLElement[];
  const existing = new Map($$<HTMLElement>(`.card[${key}]`, container).map((el) => [el.getAttribute(key)!, el]));
  const freshIds = new Set(fresh.map((el) => el.getAttribute(key)!));
  for (const [id, el] of existing) if (!freshIds.has(id)) { el.remove(); existing.delete(id); }
  fresh.forEach((el, i) => {
    const id = el.getAttribute(key)!;
    const cur = existing.get(id);
    if (cur) {
      if (cur.dataset.sig !== el.dataset.sig) {
        el.classList.add("settled");
        const before = new Set($$<HTMLImageElement>("img", cur).map((x) => x.getAttribute("src")));
        $$<HTMLImageElement>(".tile img:not(.alt)", el).forEach((x) => { if (!before.has(x.getAttribute("src"))) x.classList.add("reveal"); });
        cur.replaceWith(el); existing.set(id, el);
      }
      return;
    }
    const next = fresh.slice(i + 1).map((f) => existing.get(f.getAttribute(key)!)).find(Boolean);
    el.style.setProperty("--i", "0");
    if (next) container.insertBefore(el, next); else container.appendChild(el);
    existing.set(id, el);
  });
}

/** While any garment is still generating, refresh the list in place until nothing is pending. */
function watchPending(garments: Garment[], apply: (list: Garment[]) => void, query = "owned=0") {
  if (!garments.some((g) => g.pending)) return;
  let last = JSON.stringify(garments.map((g) => [g.id, g.pending, g.errors, g.studio_key, Object.keys(g.covers ?? {})]));
  poll(async () => {
    const list = await api<Garment[]>(`/api/garments?limit=300&${query}`);
    const sig = JSON.stringify(list.map((g) => [g.id, g.pending, g.errors, g.studio_key, Object.keys(g.covers ?? {})]));
    const changed = sig !== last; last = sig;
    if (changed) apply(list);
    return list.some((g) => g.pending) ? (changed ? "changed" : true) : false;
  }, viewAbort.signal);
}

function card(g: Garment, i = 0): string {
  const c = g.covers ?? {};
  const main = c.white ?? c.dark;
  const alt = [c.dark, c.white].find((x) => x && x !== main);
  const meta = [g.brand, CAT_LABEL[g.category ?? ""] ?? g.category].filter(Boolean).join(" · ");
  const thumb = (l: Look) => img(l.thumb_key ?? l.r2_key);
  const status = g.pending ? `<div class="status">Generating…</div>` : g.errors ? `<div class="status error">Generation failed · open for details</div>` : `<div class="status">Not generated</div>`;
  const tile = main
    ? `<img src="${thumb(main)}" alt="" loading="lazy" decoding="async" />${alt ? `<img class="alt" src="${thumb(alt)}" alt="" loading="lazy" decoding="async" />` : ""}`
    : `<img class="source" src="${img(g.thumb_key ?? g.r2_key)}" alt="" loading="lazy" />${status}`;
  const sig = [main?.id, alt?.id, g.pending, g.errors, g.name, meta].join("|");
  return `<a class="card" href="/g/${g.id}" data-id="${g.id}" data-sig="${esc(sig)}" style="--i:${i}">
    <div class="tile ${!main && g.pending ? "skeleton" : ""}">${tile}</div>
    <div class="info"><div class="name">${esc(g.name)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}
      <div class="variants">${VARIANTS.map((v) => `<span class="dot ${v} ${c[v] ? "" : "off"}" title="${VARIANT_LABEL[v]}"></span>`).join("")}</div></div>
  </a>`;
}

/** Wardrobe card: the piece itself in the studio, like a shop listing. */
function pieceCard(g: Garment, i = 0): string {
  const generating = g.studio_status === "pending";
  const meta = [g.brand, CAT_LABEL[g.category ?? ""] ?? g.category].filter(Boolean).join(" · ");
  const alt = pieceAlt(g), main = pieceImg(g);
  const status = generating ? `<div class="status">Studio shots…</div>` : !main ? `<div class="status ${g.studio_status === "error" ? "error" : ""}">${g.studio_status === "error" ? "Studio shot failed · open to retry" : "No studio shot"}</div>` : "";
  const sig = [main, alt, g.studio_status, g.name, meta, g.colors.join(",")].join("|");
  return `<a class="card piece" href="/p/${g.id}" data-pid="${g.id}" data-sig="${esc(sig)}" style="--i:${i}">
    <div class="tile ${generating || !main ? "skeleton" : ""}">${main ? `<img class="product" src="${main}" alt="" loading="lazy" decoding="async" />` : ""}${alt ? `<img class="product alt ${detailFills(g.category) ? "fill" : ""}" src="${alt}" alt="" loading="lazy" decoding="async" />` : ""}${status}</div>
    <div class="info"><div class="name">${esc(g.name)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}<div class="variants">${swatches(g.colors)}</div></div>
  </a>`;
}

// ---------- login ----------
async function viewLogin() {
  stopHero();
  viewAbort.abort(); viewAbort = new AbortController();
  mainEl = null; headerEl = null; renderedKey = "";
  app.innerHTML = `<div class="login"><div class="box">
    <div class="brand">closet</div>
    <button class="btn" data-action="passkey" ${browserSupportsWebAuthn() && me.passkeys ? "" : "disabled"}>Sign in with passkey</button>
    ${me.passkeys ? "" : `<div class="hint">No passkey registered yet. Sign in with an email code once, then add one under Settings → Passkeys.</div>`}
    <div class="divider">or</div>
    <form data-form="email" class="box" style="gap:10px">
      <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username webauthn" placeholder="you@example.com" required /></div>
      <button class="btn ghost" type="submit">Send login code</button>
    </form>
    <form data-form="code" class="box" style="gap:10px" hidden>
      <div class="field"><label>Code from your inbox</label><input class="input code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="••••••" required /></div>
      <button class="btn" type="submit">Verify</button>
      <div class="hint">Valid for 10 minutes. Requesting a new code replaces the old one.</div>
    </form>
    <div class="hint">Private closet. Only the owner can sign in.</div>
  </div></div>`;

  const emailForm = $<HTMLFormElement>("[data-form=email]")!;
  const codeForm = $<HTMLFormElement>("[data-form=code]")!;
  const emailIn = emailForm.elements.namedItem("email") as HTMLInputElement;
  const codeIn = codeForm.elements.namedItem("code") as HTMLInputElement;
  let email = localStorage.getItem("closet_email") ?? "";
  emailIn.value = email;
  if (!email) emailIn.focus();

  emailForm.onsubmit = async (e) => {
    e.preventDefault();
    email = emailIn.value.trim();
    const btn = $<HTMLButtonElement>("button", emailForm)!;
    btn.disabled = true;
    try {
      await api("/api/auth/email/start", { method: "POST", body: JSON.stringify({ email }) });
      localStorage.setItem("closet_email", email);
      codeForm.hidden = false;
      codeIn.value = ""; codeIn.focus();
      btn.textContent = "Send a new code";
      toast("If that address is allowed, a code is on its way.");
    } catch (err: any) { fail(err); } finally { btn.disabled = false; }
  };
  let verifying = false;
  const verify = async () => {
    if (verifying) return;
    const code = codeIn.value.trim();
    if (!/^\d{6}$/.test(code)) { codeIn.focus(); return; }
    const btn = $<HTMLButtonElement>("button", codeForm)!;
    verifying = true; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Verifying`;
    try {
      await api("/api/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code }) });
      me = await api("/api/me");
      navigate("/", true);
      if (browserSupportsWebAuthn() && !me.passkeys) toast("Tip: add a passkey in settings for one-tap login.", false, 6000);
    } catch (err: any) { fail(err); codeIn.select(); }
    finally { verifying = false; btn.disabled = false; btn.textContent = "Verify"; }
  };
  codeForm.onsubmit = (e) => { e.preventDefault(); verify(); };
  codeIn.addEventListener("input", () => { if (/^\d{6}$/.test(codeIn.value.trim())) verify(); });
  const passkeyLogin = async (autofill = false) => {
    const btn = $<HTMLButtonElement>("[data-action=passkey]")!;
    if (!autofill) btn.disabled = true;
    try {
      const { options, challengeId } = await api("/api/auth/passkey/login/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
      await api("/api/auth/passkey/login/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) });
      me = await api("/api/me");
      navigate("/", true);
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") return;
      toast(err.message || "Passkey sign-in failed", true);
    } finally { if (!autofill) btn.disabled = !(browserSupportsWebAuthn() && me.passkeys); }
  };
  $("[data-action=passkey]")!.addEventListener("click", () => passkeyLogin(false));
  if (me.passkeys && browserSupportsWebAuthn() && (await browserSupportsWebAuthnAutofill().catch(() => false))) passkeyLogin(true);
}

// ---------- hero slideshow ----------
let heroTimer: number | null = null;
function stopHero() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }
function startHero(hero: HTMLElement, count: number) {
  stopHero();
  if (count < 2) return;
  let i = 0;
  const go = (n: number) => {
    i = (n + count) % count;
    $$(".slide", hero).forEach((s, k) => s.classList.toggle("on", k === i));
    $$(".dots button", hero).forEach((d, k) => { d.classList.remove("on"); void (d as HTMLElement).offsetWidth; if (k === i) d.classList.add("on"); });
  };
  const arm = () => { stopHero(); heroTimer = window.setInterval(() => go(i + 1), 10000); };
  $$(".dots button", hero).forEach((d, k) => d.addEventListener("click", () => { go(k); arm(); }));
  document.addEventListener("visibilitychange", () => { if (!document.contains(hero)) return; hero.classList.toggle("paused", document.hidden); if (document.hidden) stopHero(); else arm(); }, { signal: viewAbort.signal });
  arm();
}

// ---------- home ----------
async function viewHome() {
  const [settings, garments, wardrobe] = await Promise.all([getSettings(), api<Garment[]>("/api/garments?limit=200&owned=0"), api<Garment[]>("/api/garments?limit=300&owned=1")]);
  const heroes = (settings.heroes ?? []).filter((h) => h.status === "done" && h.r2_key);
  const cats = Array.from(new Set(garments.map((g) => g.category).filter(Boolean))) as string[];
  const coverFor = (cat: string | null) => { const g = garments.find((x) => (cat ? x.category === cat : true) && x.covers?.white); return g ? img(g.covers!.white.r2_key) : ""; };
  const brands = Array.from(new Set(garments.map((g) => g.brand).filter(Boolean))) as string[];
  const brandCover = (b: string) => { const g = garments.find((x) => x.brand === b && x.covers?.white); return g ? img(g.covers!.white.r2_key) : ""; };
  const flowItems = [
    { href: "/looks", text: "All looks", count: String(garments.length), image: coverFor(null) },
    ...cats.slice(0, 4).map((c) => ({ href: `/looks?cat=${encodeURIComponent(c)}`, text: CAT_LABEL[c] ?? c, count: String(garments.filter((g) => g.category === c).length), image: coverFor(c) })),
    ...brands.slice(0, 3).map((b) => ({ href: `/looks?brand=${encodeURIComponent(b)}`, text: b, count: String(garments.filter((g) => g.brand === b).length), image: brandCover(b) })),
    { href: "/closet", text: "My closet", count: `${wardrobe.length} pieces`, image: wardrobe[0] ? pieceImg(wardrobe[0]) : "" },
    { href: "/add", text: "Try on", count: "paste · drop · url", image: garments[0] ? img(garments[0].r2_key) : "" },
    { href: "/settings", text: "Campaign", count: `${heroes.length} shots`, image: heroes[0] ? img(heroes[0].r2_key) : "" },
  ];
  setHeader("home", heroes.length > 0);
  await swap(`
    <section class="hero ${heroes.length ? "" : "no-slides"}">
      ${heroes.length ? `<div class="slides">${heroes.map((h, i) => `<div class="slide ${i === 0 ? "on" : ""}"><img src="${img(h.r2_key)}" alt="" ${i > 1 ? 'loading="lazy"' : ""} /></div>`).join("")}</div><div class="shade"></div>
        <div class="overlay"><div class="wordmark"><span>closet</span></div><div class="sub">Luka · FW26 · ${garments.length} pieces</div></div>
        <div class="scroll-hint"><i></i>Scroll</div>
        <div class="dots">${heroes.map((_, i) => `<button class="${i === 0 ? "on" : ""}" aria-label="Slide ${i + 1}"></button>`).join("")}</div>`
      : `<div class="empty"><div><div class="wordmark">closet</div><p>${garments.length ? "No campaign cover yet. Pick two or three finished looks in settings and generate one." : "No campaign image yet. Add a few garments, then generate one in settings."}</p><a class="btn" href="${garments.length ? "/settings" : "/add"}">${garments.length ? "Generate campaign" : "Add the first piece"}</a></div></div>`}
    </section>
    <div class="ticker">Every fit on this site is generated on you · nothing here is for sale</div>
    <main class="page">
      <div class="section-head"><h2>New in</h2><a href="/looks">View all</a></div>
      ${garments.length ? `<div class="grid">${garments.slice(0, 8).map(card).join("")}</div>` : `<div class="empty-state"><h3>Nothing here yet</h3><p>Paste a product photo anywhere on this page to try it on.</p><a class="btn" href="/add">Add the first piece</a></div>`}
    </main>
    ${garments.length ? flowingMenu(flowItems) : ""}
    <footer class="foot"><span>closet · private</span><span>${new Date().getFullYear()}</span></footer>`);
  const hero = $(".hero");
  if (hero) { heroObserver.disconnect(); heroObserver.observe(hero); }
  if (hero && heroes.length) startHero(hero, heroes.length);
  syncHeaderSolid();
  initFlowingMenu();
  watchPending(garments, (list) => { const grid = $(".page .grid"); if (grid) patchCards(grid, list.slice(0, 8).map(card).join(""), "data-id"); });
}

// FlowingMenu, ported to vanilla (react-bits): rows that reveal a scrolling marquee from the edge the cursor enters.
function flowingMenu(items: { href: string; text: string; count: string; image: string }[]) {
  return `<section class="flow" aria-label="Browse">${items.map((it) => `
    <div class="flow-item"><a class="flow-link" href="${it.href}">${esc(it.text)}<small>${it.count}</small></a>
      <div class="flow-marquee"><div class="flow-inner" data-text="${esc(it.text)}" data-image="${esc(it.image)}"></div></div></div>`).join("")}</section>`;
}
function initFlowingMenu() {
  const flow = $(".flow"); if (!flow) return;
  $$(".flow-item", flow).forEach((item) => {
    const link = $(".flow-link", item)!, marquee = $(".flow-marquee", item)!, inner = $(".flow-inner", item)!;
    const part = () => `<div class="flow-part"><span>${esc(inner.dataset.text)}</span><div class="flow-img" style="background-image:url('${esc(inner.dataset.image)}')"></div></div>`;
    const build = () => {
      inner.innerHTML = part();
      const w = (inner.firstElementChild as HTMLElement).offsetWidth || 600;
      const reps = Math.max(4, Math.ceil(window.innerWidth / w) + 2);
      inner.innerHTML = Array.from({ length: reps }, part).join("");
      inner.style.setProperty("--w", `${w}px`);
      inner.style.setProperty("--speed", "15s");
    };
    build();
    window.addEventListener("resize", build, { passive: true, signal: viewAbort.signal });
    const edge = (ev: MouseEvent) => { const r = item.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top; const top = (x - r.width / 2) ** 2 + y ** 2, bottom = (x - r.width / 2) ** 2 + (y - r.height) ** 2; return top < bottom ? "top" : "bottom"; };
    link.addEventListener("mouseenter", (ev) => {
      const e = edge(ev);
      marquee.style.transition = "none"; inner.style.transition = "none";
      marquee.style.transform = `translateY(${e === "top" ? "-101%" : "101%"})`;
      inner.style.setProperty("--y", e === "top" ? "101%" : "-101%");
      inner.style.transform = `translateY(${e === "top" ? "101%" : "-101%"})`;
      void marquee.offsetWidth;
      marquee.style.transition = ""; inner.style.transition = "";
      marquee.style.transform = "translateY(0)"; inner.style.transform = "translateY(0)"; inner.style.setProperty("--y", "0");
      item.classList.add("hover");
    });
    link.addEventListener("mouseleave", (ev) => {
      const e = edge(ev);
      marquee.style.transform = `translateY(${e === "top" ? "-101%" : "101%"})`;
      inner.style.transform = `translateY(${e === "top" ? "101%" : "-101%"})`;
      inner.style.setProperty("--y", e === "top" ? "101%" : "-101%");
      item.classList.remove("hover");
    });
  });
}

// ---------- list refresh hook: viewers refresh the list under them in place instead of re-rendering the route ----------
let refreshList: (() => Promise<void>) | null = null;

// ---------- looks: every try-on, filterable ----------
async function viewLooks() {
  const garments = await api<Garment[]>("/api/garments?limit=300&owned=0");
  const cats = Array.from(new Set(garments.map((g) => g.category).filter(Boolean))) as string[];
  const params = new URLSearchParams(location.search);
  let filter = params.get("cat") ?? "";
  if (filter && !cats.includes(filter)) filter = "";
  let brand = params.get("brand") ?? "";
  if (brand && !garments.some((g) => g.brand === brand)) brand = "";
  setHeader("home", false);
  await swap(`<main class="page">
    <div class="section-head"><h2>Looks · <span id="looks-count">${garments.length}</span></h2><a href="/add">+ Try on</a></div>
    <div class="filters"><button class="chip ${filter ? "" : "on"}" data-cat="">All</button>${cats.map((c) => `<button class="chip ${c === filter ? "on" : ""}" data-cat="${esc(c)}">${esc(CAT_LABEL[c] ?? c)}</button>`).join("")}${brand ? `<button class="chip on" data-brand="${esc(brand)}" title="Clear brand filter">${esc(brand)} ×</button>` : ""}</div>
    <div class="grid" id="closet-grid"></div></main>`);
  const url = () => { const p = new URLSearchParams(); if (filter) p.set("cat", filter); if (brand) p.set("brand", brand); const q = p.toString(); return q ? `/looks?${q}` : "/looks"; };
  const visible = () => garments.filter((g) => (!filter || g.category === filter) && (!brand || g.brand === brand));
  const draw = (patch = false) => {
    const list = visible();
    const grid = $("#closet-grid")!;
    const html = list.map(card).join("");
    if (patch && list.length && !$(".empty-state", grid)) patchCards(grid, html, "data-id");
    else grid.innerHTML = list.length ? html : `<div class="empty-state" style="grid-column:1/-1"><h3>${garments.length ? "No looks match" : "No looks yet"}</h3><p>${garments.length ? "Try another category, or clear the filters." : "Paste a product photo anywhere to try it on."}</p>${garments.length ? `<button class="btn ghost" data-clear>Show all</button>` : `<a class="btn" href="/add">Try on a piece</a>`}</div>`;
    $("#looks-count")!.textContent = String(list.length);
    $$(".filters .chip[data-cat]").forEach((c) => c.classList.toggle("on", (c as HTMLElement).dataset.cat === filter));
    $("[data-clear]", grid)?.addEventListener("click", () => { filter = ""; brand = ""; $(".filters .chip[data-brand]")?.remove(); history.replaceState(history.state, "", url()); renderedKey = routeKey(); draw(); });
  };
  $$(".filters .chip[data-cat]").forEach((c) => c.addEventListener("click", () => { filter = (c as HTMLElement).dataset.cat!; history.replaceState(history.state, "", url()); renderedKey = routeKey(); draw(); }));
  $(".filters .chip[data-brand]")?.addEventListener("click", (e) => { brand = ""; (e.currentTarget as HTMLElement).remove(); history.replaceState(history.state, "", url()); renderedKey = routeKey(); draw(); });
  draw();
  const apply = (list: Garment[]) => { garments.splice(0, garments.length, ...list); draw(true); };
  refreshList = async () => apply(await api<Garment[]>("/api/garments?limit=300&owned=0"));
  watchPending(garments, apply);
}

// ---------- closet: the pieces you own, grouped like a shop ----------
async function viewWardrobe() {
  const pieces = await api<Garment[]>("/api/garments?limit=300&owned=1");
  setHeader("closet", false);
  const sectionsHtml = () => FAMILY_ORDER.map((f) => {
    const list = pieces.filter((g) => familyOf(g.category) === f);
    if (!list.length) return "";
    return `<section class="wsection" id="fam-${f}"><div class="section-head"><h2>${esc(FAMILY_LABEL[f])} · ${list.length}</h2></div><div class="grid wgrid">${list.map(pieceCard).join("")}</div></section>`;
  }).join("");
  const draw = (patch = false) => {
    const root = $("#wardrobe")!;
    const have = $$(".card[data-pid]", root).map((c) => c.getAttribute("data-pid")).sort().join(",");
    const want = pieces.map((g) => g.id).sort().join(",");
    if (patch && have === want && have) {
      // Same pieces, same sections: patch every card where it stands.
      for (const f of FAMILY_ORDER) { const grid = $(`#fam-${f} .grid`, root); const list = pieces.filter((g) => familyOf(g.category) === f); if (grid && list.length) patchCards(grid, list.map(pieceCard).join(""), "data-pid"); }
      return;
    }
    root.innerHTML = sectionsHtml() || `<div class="empty-state"><h3>Your closet is empty</h3><p>Add the shoes, jeans and tees you already own. When you try on a new piece, you can complete the fit with them.</p><a class="btn" href="/add?own=1">Add what you own</a></div>`;
    $("#closet-count")!.textContent = String(pieces.length);
  };
  await swap(`<main class="page">
    <div class="section-head"><h2>Closet · <span id="closet-count">${pieces.length}</span> pieces</h2><a href="/add?own=1">+ Add a piece you own</a></div>
    <div id="wardrobe"></div></main>`);
  draw();
  const apply = (list: Garment[]) => { pieces.splice(0, pieces.length, ...list); draw(true); };
  refreshList = async () => apply(await api<Garment[]>("/api/garments?limit=300&owned=1"));
  watchPending(pieces, apply, "owned=1");
}

// ---------- add flow: upload → fast analysis → review form (+ complete the fit) → submit ----------
let pendingImage: { file?: File; url?: string; dataUrl?: string } | null = null;
let addOwn = false;
const MODE_HINT = { own: "Goes into your closet as two studio views; use it to complete fits.", tryon: "Generates you wearing it in the white and the dark studio." };

async function viewAdd() {
  const settings = await getSettings();
  addOwn = new URLSearchParams(location.search).get("own") === "1";
  const b = settings.budget;
  const left = b ? Math.max(0, Math.min(b.image.limits.day - b.image.day, b.image.limits.hour - b.image.hour)) : null;
  setHeader("", false);
  await swap(`<main class="page">
    <div class="section-head"><h2>Add a piece</h2><span class="muted caps">${esc(settings.analysis_model ? settings.analysis_model + " · " : "")}${esc(settings.model)} · ${esc(settings.look_quality)}${left !== null ? ` · ${left} generations left today` : ""}</span></div>
    <div class="mode" id="mode" role="tablist">
      <button class="chip ${addOwn ? "" : "on"}" data-own="0" role="tab">Try on</button>
      <button class="chip ${addOwn ? "on" : ""}" data-own="1" role="tab">I own this</button>
      <span class="muted" id="mode-hint">${addOwn ? MODE_HINT.own : MODE_HINT.tryon}</span>
    </div>
    <div id="add-stage">
      <div class="drop" id="drop" tabindex="0" role="button" aria-label="Pick a product photo">
        <div><h3>Drop a product photo</h3><p>Paste with <kbd>⌘V</kbd> anywhere, drag an image here, or click to pick a file. A direct image URL works too.</p>
        <div class="urlrow" id="urlrow"><input class="input" id="url" type="url" placeholder="https://…/jacket.jpg" /><button class="btn" id="url-go">Add</button></div></div>
      </div>
      <input type="file" id="file" accept="image/*" hidden />
    </div></main>`);
  $$("#mode .chip").forEach((c) => c.addEventListener("click", () => {
    addOwn = (c as HTMLElement).dataset.own === "1";
    $$("#mode .chip").forEach((x) => x.classList.toggle("on", x === c));
    $("#mode-hint")!.textContent = addOwn ? MODE_HINT.own : MODE_HINT.tryon;
    history.replaceState(history.state, "", addOwn ? "/add?own=1" : "/add");
    renderedKey = routeKey();
  }));
  const drop = $("#drop")!;
  const file = $<HTMLInputElement>("#file")!;
  $("#urlrow")!.addEventListener("click", (e) => e.stopPropagation());
  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  file.addEventListener("change", () => file.files?.[0] && startAdd({ file: file.files[0] }));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith("image/")) return startAdd({ file: f });
    const url = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    if (url && /^https?:\/\//.test(url)) startAdd({ url: url.trim() });
    else toast("Drop an image file or an image link.", true);
  });
  const goUrl = () => { const u = $<HTMLInputElement>("#url")!.value.trim(); if (!u) return; if (!/^https?:\/\/\S+$/.test(u)) return toast("That does not look like a link.", true); startAdd({ url: u }); };
  $("#url-go")!.addEventListener("click", goUrl);
  $<HTMLInputElement>("#url")!.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); goUrl(); } });
  if (pendingImage) { const p = pendingImage; pendingImage = null; startAdd(p); }
}

let adding = false;
async function startAdd(src: { file?: File; url?: string; dataUrl?: string }) {
  if (location.pathname !== "/add") { pendingImage = src; addOwn = location.pathname === "/closet"; return navigate(addOwn ? "/add?own=1" : "/add"); }
  if (adding) return toast("One at a time: a piece is still being analysed.", true);
  if (src.file && src.file.size > 12 * 1024 * 1024) return toast("That image is larger than 12 MB.", true);
  adding = true;
  const own = addOwn;
  const stage = $("#add-stage")!;
  const preview = src.file ? URL.createObjectURL(src.file) : src.dataUrl ?? src.url ?? "";
  $("#mode")!.hidden = true;
  stage.innerHTML = `<div class="addwrap">
    <div><div class="source-tile"><img src="${esc(preview)}" alt="" /></div><div class="caps muted analysing" style="margin-top:10px" id="add-name"><span class="spinner dark"></span> Looking at it…</div></div>
    <div class="review skeleton-form"><div class="sk"></div><div class="sk"></div><div class="sk short"></div><div class="sk"></div></div>
  </div>`;
  let g: Garment;
  try {
    const path = `/api/garments${own ? "?owned=1" : ""}`;
    if (src.file) { const fd = new FormData(); fd.append("file", src.file); g = await api(path, { method: "POST", body: fd }); }
    else g = await api(path, { method: "POST", body: JSON.stringify(src.url ? { url: src.url } : { data: src.dataUrl }) });
  } catch (err: any) {
    adding = false;
    fail(err, 6000);
    if (!document.contains(stage)) return;
    stage.innerHTML = `<div class="empty-state"><h3>Could not read that image</h3><p>${esc(err?.name === "AuthError" ? "You were signed out." : err.message)}</p><a class="btn" href="${own ? "/add?own=1" : "/add"}">Try again</a></div>`;
    return;
  } finally { if (src.file) URL.revokeObjectURL(preview); }
  adding = false;
  if (!document.contains(stage)) {
    // The page was left while the upload ran: nothing to review, so the draft goes straight away.
    api(`/api/garments/${g.id}`, { method: "DELETE" }).catch(() => {});
    return;
  }
  const a = g.analysis;
  $("#add-name")!.innerHTML = a?.model ? `${esc(a.model)} · ${(a.ms / 1000).toFixed(1)} s${a.found_brand ? "" : " · brand not recognised"}` : a?.fallback ? `<span style="color:var(--danger)">Analysis failed</span> · filled by ${esc(a.fallback)} · check every field` : "Fill in the details";
  $("#add-name")!.classList.remove("analysing");
  const wardrobe = own ? [] : await api<Garment[]>("/api/garments?limit=300&owned=1").catch(() => [] as Garment[]);
  const settings = await getSettings();
  const slotsToPick: string[] = own ? [] : settings.slots;
  const pick: Record<string, string | null> = {};
  const pickerRow = (slot: string) => {
    const options = wardrobe.filter((w) => slotsOf(w.category).includes(slot) && pieceImg(w));
    return `<div class="slotrow" data-slot="${slot}" ${(missingSlots(g.category) as string[]).includes(slot) ? "" : "hidden"}>
      <div class="slothead"><span class="caps">${SLOT_LABEL[slot] ?? slot}</span><span class="tag-missing">Missing from this fit</span></div>
      <div class="slotpick">
        <button type="button" class="pick none on" data-slot="${slot}" data-id="" title="Keep what the base photo wears"><span>Keep<br>base</span></button>
        ${options.map((w) => `<button type="button" class="pick" data-slot="${slot}" data-id="${w.id}" title="${esc(w.name)}"><img src="${pieceImg(w)}" alt="" /></button>`).join("")}
        ${options.length ? "" : `<a class="pick add" href="/add?own=1" title="Add a piece you own">+ Add<br>yours</a>`}
      </div></div>`;
  };
  const form = $(".review", stage)!;
  form.className = "review";
  form.innerHTML = `
    <div class="fields">
      <div class="field"><label>Name</label><input class="input" name="name" value="${esc(g.name)}" maxlength="120" required /></div>
      <div class="fields2">
        <div class="field"><label>Brand${a && !a.found_brand ? ' <em class="muted">· not recognised, type it</em>' : ""}</label><input class="input ${a && !a.found_brand ? "attn" : ""}" name="brand" value="${esc(g.brand ?? "")}" placeholder="Brand" maxlength="60" /></div>
        <div class="field"><label>Category</label><select class="input" name="category">${CATEGORIES_BY_FAMILY.map((f) => `<optgroup label="${esc(f.label)}">${f.categories.map((c) => `<option value="${c.id}" ${c.id === g.category ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</optgroup>`).join("")}</select></div>
      </div>
      <div class="field"><label>Colours <em class="muted">· up to three, comma separated</em></label><div class="colorrow"><input class="input" name="colors" value="${esc(g.colors.join(", "))}" placeholder="navy, white" /><span class="swatches" id="sw">${g.colors.map((c) => `<i style="background:${esc(swatch(c))}"></i>`).join("")}</span></div></div>
      <div class="field"><label>Description</label><textarea class="input" name="description" maxlength="300" rows="2">${esc(g.description ?? "")}</textarea></div>
      <div class="field"><label>Product link <em class="muted">· where to buy it, optional</em></label><input class="input" name="source_url" type="url" value="${esc(g.source_url ?? "")}" placeholder="https://…" /></div>
    </div>
    ${slotsToPick.length ? `<div class="complete" ${missingSlots(g.category).length ? "" : "hidden"}><div class="section-head" style="margin:6px 0 10px"><h2>Complete the fit</h2><span class="muted" style="font-size:11px">Pieces from your closet are worn with it; the base tee, jeans and sneakers fill the rest</span></div>${slotsToPick.map(pickerRow).join("")}</div>` : ""}
    <div class="row" style="margin-top:22px"><button class="btn" id="submit">${own ? "Add to closet" : "Generate looks"}</button><button class="btn ghost" id="cancel" type="button">Discard</button><span class="muted" style="font-size:12px">${own ? "Two studio views on white are generated from your photo in the background (~40 s): the piece and a detail shot, or for shoes the side and three-quarter view. Your photo itself is never shown." : "Two looks are generated in the background (~40 s each). You can leave right away."}</span></div>`;
  const colorsIn = $<HTMLInputElement>("[name=colors]", form)!;
  colorsIn.addEventListener("input", () => { const cs = colorsIn.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3); $("#sw")!.innerHTML = cs.map((c) => `<i style="background:${esc(swatch(c))}"></i>`).join(""); });
  $$(".pick[data-slot]", form).forEach((b) => b.addEventListener("click", () => {
    const slot = (b as HTMLElement).dataset.slot!, id = (b as HTMLElement).dataset.id || null;
    pick[slot] = id;
    $$(`.pick[data-slot="${slot}"]`, form).forEach((x) => x.classList.toggle("on", x === b));
  }));
  $<HTMLSelectElement>("[name=category]", form)!.addEventListener("change", (e) => {
    // Changing the category changes which slots a full fit still needs; show exactly those pickers.
    const need = new Set<string>(missingSlots((e.target as HTMLSelectElement).value));
    $$(".slotrow", form).forEach((r) => { const sl = (r as HTMLElement).dataset.slot!; r.hidden = !need.has(sl); if (!need.has(sl)) { pick[sl] = null; $$(`.pick[data-slot="${sl}"]`, form).forEach((x, i) => x.classList.toggle("on", i === 0)); } });
    const c = $(".complete", form); if (c) c.hidden = need.size === 0;
  });
  let done = false;
  $("#cancel", form)!.addEventListener("click", async () => {
    if (done) return; done = true;
    $$<HTMLButtonElement>("button", form).forEach((x) => (x.disabled = true));
    await api(`/api/garments/${g.id}`, { method: "DELETE" }).catch(() => {});
    navigate(own ? "/add?own=1" : "/add", true);
  });
  $("#submit", form)!.addEventListener("click", async () => {
    if (done) return;
    const btn = $<HTMLButtonElement>("#submit", form)!;
    const val = (n: string) => ($(`[name=${n}]`, form) as HTMLInputElement).value.trim();
    if (!val("name")) { ($("[name=name]", form) as HTMLInputElement).focus(); return toast("Give the piece a name.", true); }
    done = true;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Saving`;
    try {
      await api(`/api/garments/${g.id}/commit`, { method: "POST", body: JSON.stringify({
        name: val("name"), brand: val("brand") || null, category: val("category"), colors: val("colors").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3),
        description: val("description") || null, owned: own, pairing: pick, source_url: val("source_url") || null,
      }) });
      toast(own ? "Added to your closet. Studio views are on their way." : "Generating your looks in the background.");
      navigate(own ? "/closet" : "/", true);
    } catch (err: any) { done = false; fail(err, 6000); btn.disabled = false; btn.textContent = own ? "Add to closet" : "Generate looks"; }
  });
  ($("[name=name]", form) as HTMLInputElement).focus();
}

// ---------- product link (where to buy it), shown and editable in both viewers ----------
function linkBlock(g: Garment): string {
  return `<span class="linkwrap" style="margin-left:14px"><span class="linkview">${g.source_url ? `<a class="v-link" href="${esc(g.source_url)}" target="_blank" rel="noopener" title="${esc(g.source_url)}">Product ↗</a> ` : ""}<button class="v-link edit">${g.source_url ? "Edit link" : "Add link"}</button></span>
    <span class="linkrow" hidden><input class="input" type="url" value="${esc(g.source_url ?? "")}" placeholder="https://…" /><button class="btn sm" data-save>Save</button><button class="btn ghost sm" data-cancel>Cancel</button></span></span>`;
}
function bindLink(el: HTMLElement, g: Garment) {
  const wrap = $(".linkwrap", el); if (!wrap) return;
  const view = $(".linkview", wrap)!, row = $(".linkrow", wrap)!, input = $<HTMLInputElement>("input", row)!;
  $(".edit", view)!.addEventListener("click", () => { view.hidden = true; row.hidden = false; input.focus(); });
  $("[data-cancel]", row)!.addEventListener("click", () => { row.hidden = true; view.hidden = false; });
  const save = async () => {
    const btn = $<HTMLButtonElement>("[data-save]", row)!; btn.disabled = true;
    try {
      const u = await api<Garment>(`/api/garments/${g.id}`, { method: "PATCH", body: JSON.stringify({ source_url: input.value.trim() || null }) });
      g.source_url = u.source_url;
      wrap.outerHTML = linkBlock(g); bindLink(el, g); toast(g.source_url ? "Link saved" : "Link removed");
    } catch (err: any) { fail(err); btn.disabled = false; }
  };
  $("[data-save]", row)!.addEventListener("click", save);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.stopPropagation(); row.hidden = true; view.hidden = false; } });
}

// ---------- piece viewer: one wardrobe piece, large ----------
let pieceEl: HTMLElement | null = null;
let pieceScroll = 0;
function closePiece(pop = true) {
  if (!pieceEl) return;
  const el = pieceEl; pieceEl = null;
  el.classList.add("closing"); document.body.classList.remove("noscroll");
  scrollTo(pieceScroll);
  setTimeout(() => el.remove(), 320);
  if (pop && location.pathname.startsWith("/p/")) { if (viewerPushed) history.back(); else { history.replaceState({}, "", "/closet"); renderedKey = routeKey(); } }
  viewerPushed = false;
}
function pieceTiles(g: Garment): string {
  const pending = g.studio_status === "pending";
  const shoes = familyOf(g.category) === "shoes";
  return `<figure class="v-panel" style="--i:0"><div class="v-tile product ${pending || !pieceImg(g) ? "skeleton" : ""}">${pieceImg(g) ? `<img src="${pieceImg(g, false)}" alt="" />` : `<div class="v-missing">Studio shot<br><span>${pending ? "generating…" : g.studio_status === "error" ? "failed" : "not generated"}</span></div>`}</div><figcaption>${shoes ? "Side view" : "Studio shot"}</figcaption></figure>
      <figure class="v-panel" style="--i:1"><div class="v-tile product ${pending || !pieceAlt(g) ? "skeleton" : ""}">${pieceAlt(g) ? `<img src="${pieceAlt(g, false)}" alt="" class="${detailFills(g.category) ? "fill" : ""}" />` : `<div class="v-missing">${shoes ? "Three-quarter" : "Detail"}<br><span>${pending ? "generating…" : g.studio_status === "error" ? "failed" : "not generated"}</span></div>`}</div><figcaption>${shoes ? "Three-quarter view" : "Detail"}</figcaption></figure>`;
}
async function openPiece(id: string, push = true) {
  let g: Garment;
  busy(true);
  try { g = await api<Garment>(`/api/garments/${id}`); } catch (err: any) { busy(false); if (err?.status === 404) { toast("That piece is gone.", true); if (location.pathname.startsWith("/p/")) navigate("/closet", true); } else fail(err); return; }
  busy(false);
  if (pieceEl) { pieceEl.remove(); pieceEl = null; }
  if (!viewerPushed) pieceScroll = window.scrollY;
  if (push && location.pathname !== `/p/${id}`) { saveScroll(); history.pushState({ piece: id }, "", `/p/${id}`); viewerPushed = true; }
  else if (!push && location.pathname !== `/p/${id}`) history.replaceState({ piece: id }, "", `/p/${id}`);
  const el = document.createElement("div");
  el.className = "viewer piece" + (push ? "" : " instant");
  const studioError = (g.notes ?? "").split("\n").reverse().find((l) => l.startsWith("[studio shot"))?.replace(/^\[|\]$/g, "");
  el.innerHTML = `
    <div class="v-head">
      <div><div class="v-name">${esc(g.name)}</div><div class="v-meta">${esc([g.brand, CAT_LABEL[g.category ?? ""] ?? g.category].filter(Boolean).join(" · "))} ${swatches(g.colors)}</div>${g.description ? `<p class="v-desc">${esc(g.description)}</p>` : ""}${g.studio_status === "error" && studioError ? `<p class="v-desc" style="color:var(--danger)">${esc(studioError)}</p>` : ""}</div>
      <button class="v-close" aria-label="Close">×</button>
    </div>
    <div class="v-row one">${pieceTiles(g)}</div>
    <div class="v-foot"><div class="row">${linkBlock(g)}<button class="v-re" title="Render both studio views again from your photo (two image generations)" ${g.studio_status === "pending" ? "hidden" : ""}>${g.studio_status === "error" ? "Retry studio views" : "Re-render"}</button></div><button class="v-del">Remove from closet</button></div>`;
  document.body.appendChild(el); document.body.classList.add("noscroll"); pieceEl = el;
  void el.offsetWidth; setTimeout(() => el.classList.add("open"), 10);
  $(".v-close", el)!.addEventListener("click", () => closePiece());
  bindLink(el, g);
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).classList.contains("v-row")) closePiece(); });
  const watch = () => poll(async () => {
    if (pieceEl !== el) return false;
    const u = await api<Garment>(`/api/garments/${id}`);
    if (u.studio_status === "pending") return true;
    $(".v-row", el)!.innerHTML = pieceTiles(u);
    $$<HTMLImageElement>(".v-tile img", el).forEach((x) => x.classList.add("reveal"));
    $(".v-re", el)!.hidden = false; $(".v-re", el)!.textContent = u.studio_status === "error" ? "Retry studio views" : "Re-render";
    if (u.studio_status === "error") toast("The studio views failed. Open the piece for details or retry.", true);
    refreshList?.().catch(() => {});
    return false;
  }, viewAbort.signal, 5000);
  if (g.studio_status === "pending") watch();
  $(".v-re", el)!.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>(".v-re", el)!;
    if (!confirm("Render both studio views again from your photo? This spends two image generations.")) return;
    btn.disabled = true;
    try {
      const u = await api<Garment>(`/api/garments/${g.id}/studio`, { method: "POST" });
      toast("Re-rendering both views in the background.");
      $(".v-row", el)!.innerHTML = pieceTiles(u); btn.hidden = true;
      refreshList?.().catch(() => {});
      watch();
    } catch (err: any) { fail(err, 6000); btn.disabled = false; }
  });
  $(".v-del", el)!.addEventListener("click", async () => {
    if (!confirm(`Remove "${g.name}" from your closet?`)) return;
    const btn = $<HTMLButtonElement>(".v-del", el)!; btn.disabled = true;
    try { await api(`/api/garments/${g.id}`, { method: "DELETE" }); } catch (err: any) { fail(err); btn.disabled = false; return; }
    closePiece();
    toast("Removed.");
    refreshList?.().catch(() => {});
  });
}

// ---------- viewer: a card expands in place into the three variants ----------
let viewerEl: HTMLElement | null = null;
let viewerId: string | null = null;
let viewerPushed = false;
let viewerScroll = 0;

function flyImage(from: DOMRect, to: DOMRect, src: string, ms = 500) {
  const ghost = document.createElement("img");
  ghost.src = src; ghost.className = "v-ghost";
  Object.assign(ghost.style, { left: from.left + "px", top: from.top + "px", width: from.width + "px", height: from.height + "px" });
  document.body.appendChild(ghost);
  void ghost.offsetWidth;
  Object.assign(ghost.style, { left: to.left + "px", top: to.top + "px", width: to.width + "px", height: to.height + "px" });
  setTimeout(() => ghost.remove(), ms + 40);
}

function closeViewer(pop = true) {
  if (!viewerEl) return;
  const el = viewerEl, id = viewerId; viewerEl = null; viewerId = null;
  document.body.classList.remove("noscroll");
  scrollTo(viewerScroll);
  const first = $<HTMLImageElement>(".v-panel img", el);
  const card = id ? $<HTMLImageElement>(`.card[data-id="${id}"] .tile img:not(.alt)`) : null;
  if (first && card && !reduced()) { flyImage(first.getBoundingClientRect(), card.getBoundingClientRect(), first.src, 460); first.style.opacity = "0"; }
  el.classList.add("closing");
  setTimeout(() => el.remove(), 320);
  if (pop && location.pathname.startsWith("/g/")) {
    if (viewerPushed) history.back();
    else { history.replaceState({}, "", renderedKey || "/looks"); renderedKey = routeKey(); }
  }
  viewerPushed = false;
}

function lookPanel(g: Garment, v: string, i: number): string {
  const looks = g.looks ?? [];
  const l = looks.find((x) => x.variant === v && x.status === "done");
  const pending = !l && looks.some((x) => x.variant === v && x.status === "pending");
  const failed = !l && !pending ? looks.find((x) => x.variant === v && x.status === "error") : undefined;
  const slug = g.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `<figure class="v-panel" style="--i:${i}" data-v="${v}" data-state="${l ? "done" : pending ? "pending" : failed ? "error" : "none"}">
    <div class="v-tile ${pending ? "skeleton" : ""}">${l ? `<img src="${img(l.r2_key)}" alt="" />` : `<div class="v-missing">${VARIANT_LABEL[v]}<br><span>${pending ? "generating…" : failed ? esc(failed.error?.startsWith("skipped:") ? failed.error.slice(9) : "generation failed") : "not generated"}</span></div>`}</div>
    <figcaption><span class="dot ${v}"></span>${VARIANT_LABEL[v]}${l ? `<a class="v-dl" href="${img(l.r2_key)}" download="${slug}-${v}.webp">Download</a>` : ""}</figcaption>
  </figure>`;
}

async function openViewer(id: string, fromCard?: HTMLElement, push = true) {
  let g: Garment;
  busy(true);
  try { g = await api<Garment>(`/api/garments/${id}`); } catch (err: any) { busy(false); if (err?.status === 404) { toast("That look is gone.", true); if (location.pathname.startsWith("/g/")) navigate("/looks", true); } else fail(err); return; }
  busy(false);
  if (viewerEl) { viewerEl.remove(); viewerEl = null; }
  if (!viewerPushed) viewerScroll = window.scrollY;
  if (push && location.pathname !== `/g/${id}`) { saveScroll(); history.pushState({ viewer: id }, "", `/g/${id}`); viewerPushed = true; }
  else if (!push && location.pathname !== `/g/${id}`) history.replaceState({ viewer: id }, "", `/g/${id}`);
  viewerId = id;
  const el = document.createElement("div");
  el.className = "viewer" + (fromCard ? "" : " instant");
  el.innerHTML = `
    <div class="v-head">
      <div><div class="v-name">${esc(g.name)}</div><div class="v-meta">${esc([g.brand, CAT_LABEL[g.category ?? ""] ?? g.category, g.color].filter(Boolean).join(" · "))}</div></div>
      <button class="v-close" aria-label="Close">×</button>
    </div>
    <div class="v-row">${VARIANTS.map((v, i) => lookPanel(g, v, i)).join("")}</div>
    <div class="v-foot"><div class="row"><img class="srcmini" src="${img(g.thumb_key ?? g.r2_key)}" alt="" />${(g.paired ?? []).length ? `<span class="caps muted" style="margin-left:6px">Worn with</span>${g.paired!.map((p) => `<a class="srcmini paired" href="/p/${p.id}" title="${esc(p.name)}"><img src="${pieceImg(p)}" alt="" /></a>`).join("")}` : ""}${linkBlock(g)}</div><button class="v-del">Delete garment</button></div>
    <button class="v-nav prev" aria-label="Previous" hidden>‹</button><button class="v-nav next" aria-label="Next" hidden>›</button>`;
  document.body.appendChild(el);
  document.body.classList.add("noscroll");
  viewerEl = el;

  const first = $<HTMLImageElement>(".v-panel img", el);
  const cardImg = fromCard?.querySelector<HTMLImageElement>(".tile img:not(.alt)");
  if (first && cardImg && !reduced()) {
    const from = cardImg.getBoundingClientRect();
    first.style.opacity = "0";
    setTimeout(() => {
      flyImage(from, first.getBoundingClientRect(), cardImg.currentSrc || cardImg.src, 500);
      setTimeout(() => { first.style.opacity = ""; }, 480);
    }, 10);
  }
  void el.offsetWidth; setTimeout(() => el.classList.add("open"), 10);

  // Prev/next follow the list under the viewer; the list may render after the viewer on a cold deep link.
  const listIds = () => $$(".card[data-id]").map((c) => (c as HTMLElement).dataset.id!);
  const refreshNav = () => { const ids = listIds(), pos = ids.indexOf(id); $(".v-nav.prev", el)!.hidden = pos <= 0; $(".v-nav.next", el)!.hidden = pos < 0 || pos >= ids.length - 1; };
  refreshNav();
  const goTo = (d: number) => {
    const ids = listIds(), pos = ids.indexOf(id), nid = ids[pos + d]; if (pos < 0 || !nid) return;
    const c = $(`.card[data-id="${nid}"]`);
    viewerId = null; el.remove(); document.body.classList.remove("noscroll");
    if (c) { c.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }); viewerScroll = window.scrollY; }
    openViewer(nid, undefined, false);
  };
  $(".v-close", el)!.addEventListener("click", () => closeViewer());
  bindLink(el, g);
  $(".v-nav.prev", el)!.addEventListener("click", () => goTo(-1));
  $(".v-nav.next", el)!.addEventListener("click", () => goTo(1));
  (el as any)._nav = goTo;
  (el as any)._refreshNav = refreshNav;
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).classList.contains("v-row")) closeViewer(); });
  $(".v-del", el)!.addEventListener("click", async () => {
    if (!confirm(`Delete "${g.name}" and its looks?`)) return;
    const btn = $<HTMLButtonElement>(".v-del", el)!; btn.disabled = true;
    try { await api(`/api/garments/${g.id}`, { method: "DELETE" }); } catch (err: any) { fail(err); btn.disabled = false; return; }
    viewerId = null; closeViewer();
    toast("Deleted.");
    refreshList?.().catch(() => {});
  });
  // Looks still in flight: swap each panel in as soon as it lands, without touching the others.
  if ((g.looks ?? []).some((l) => l.status === "pending")) poll(async () => {
    if (viewerEl !== el) return false;
    const u = await api<Garment>(`/api/garments/${id}`);
    let changed = false;
    VARIANTS.forEach((v, i) => {
      const panel = $(`.v-panel[data-v="${v}"]`, el)!;
      const fresh = document.createElement("div"); fresh.innerHTML = lookPanel(u, v, i);
      const next = fresh.firstElementChild as HTMLElement;
      if (panel.dataset.state !== next.dataset.state) { next.style.animation = "none"; next.style.opacity = "1"; next.style.transform = "none"; $$<HTMLImageElement>("img", next).forEach((x) => x.classList.add("reveal")); panel.replaceWith(next); changed = true; }
    });
    if (changed) refreshList?.().catch(() => {});
    const still = (u.looks ?? []).some((l) => l.status === "pending");
    return still ? (changed ? "changed" : true) : false;
  }, viewAbort.signal, 5000);
}
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  if (pieceEl) { if (e.key === "Escape") closePiece(); return; }
  if (!viewerEl) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") (viewerEl as any)._nav?.(-1);
  if (e.key === "ArrowRight") (viewerEl as any)._nav?.(1);
});

// ---------- settings ----------
function heroTile(h: Hero): string {
  if (h.status === "pending") return `<div class="h skeleton" data-id="${h.id}">${esc(STYLE_LABEL[h.style] ?? h.style)} · generating<button class="x" data-delhero="${h.id}" title="Cancel">×</button></div>`;
  if (h.status !== "done" || !h.r2_key) return `<div class="h" data-id="${h.id}"><span class="tag">${esc(STYLE_LABEL[h.style] ?? h.style)} · failed</span><div class="v-missing" style="padding:12px;font-size:10px">${esc(h.error?.startsWith("skipped:") ? h.error.slice(9) : h.error || "failed")}</div><button class="x" data-delhero="${h.id}" title="Remove">×</button></div>`;
  return `<div class="h" data-id="${h.id}"><img src="${img(h.r2_key)}" alt="" /><span class="tag">${esc(STYLE_LABEL[h.style] ?? h.style)}</span><button class="x" data-delhero="${h.id}" title="Remove">×</button></div>`;
}
function watchHeroes() {
  poll(async () => {
    const { heroes } = await api<{ heroes: Hero[] }>("/api/heroes");
    let changed = false;
    for (const h of heroes) { const el = $(`#heroes .h[data-id="${h.id}"]`); if (el && el.classList.contains("skeleton") && h.status !== "pending") { el.outerHTML = heroTile(h); changed = true; } }
    if (changed) { bindHeroDelete(); settingsCache = null; toast(heroes.some((h) => h.status === "error") ? "A cover failed; see the tile for the reason." : "Campaign cover is ready.", heroes.some((h) => h.status === "error")); }
    const still = heroes.some((h) => h.status === "pending");
    $<HTMLButtonElement>("#hero-go")?.toggleAttribute("data-inflight", still);
    return still ? (changed ? "changed" : true) : false;
  }, viewAbort.signal, 5000);
}
let bindHeroDelete = () => {};
async function viewSettings() {
  const [settings, refs, passkeys, allTryOns] = await Promise.all([getSettings(true), api<any[]>("/api/refs"), api<any[]>("/api/auth/passkeys"), api<Garment[]>("/api/garments?limit=200&owned=0")]);
  // A cover is built from finished looks only: pieces with a studio look, never owned pieces or raw uploads.
  const garments = allTryOns.filter((g) => g.covers?.white || g.covers?.dark);
  let heroPick: string[] = [];
  let heroStyle = settings.hero_styles?.[0] ?? "nyc";
  const b = settings.budget;
  const usage = (x: Budget) => `${x.day} of ${x.limits.day} today · ${x.hour} of ${x.limits.hour} this hour`;
  setHeader("settings", false);
  await swap(`<main class="page"><div class="settings">
    <section id="hero"><h2>Campaign</h2>
      <p class="lead">Campaign covers rotate on the landing page every 10 seconds. Pick 2–3 of your finished looks and a location, then generate (about 90 seconds), or upload a finished cover.</p>
      <div class="heroes" id="heroes">${(settings.heroes ?? []).map(heroTile).join("")}</div>
      <div class="chips" id="styles" style="margin-bottom:12px">${(settings.hero_styles ?? []).map((s) => `<button class="chip ${s === heroStyle ? "on" : ""}" data-style="${s}">${esc(STYLE_LABEL[s] ?? s)}</button>`).join("")}</div>
      <div class="picker" id="picker">${garments.map((g) => { const l = (g.covers?.white ?? g.covers?.dark)!; return `<div class="pick" data-id="${g.id}" title="${esc(g.name)}" role="button" tabindex="0"><img src="${img(l.thumb_key ?? l.r2_key)}" alt="" /></div>`; }).join("") || `<span class="muted">No finished looks yet. Try on a piece first.</span>`}</div>
      <div class="row" style="margin-top:12px"><button class="btn" id="hero-go" disabled ${(settings.heroes ?? []).some((h) => h.status === "pending") ? "data-inflight" : ""}>Generate campaign</button><label class="btn ghost" for="hero-file">Upload cover<input type="file" id="hero-file" accept="image/*" hidden /></label><span class="muted" style="font-size:12px" id="hero-hint">Pick 2–3 garments</span></div>
    </section>
    <section><h2>Reference photos of you</h2>
      <p class="lead">The base photo is the one image every look and cover is edited from: a clean full-body studio shot of you, arms relaxed, plain t-shirt and jeans. Mark it with “Base”. Other photos are kept for reference only.</p>
      <div class="refgrid" id="refs">${refs.map((r) => `<div class="ref ${r.is_base ? "base" : ""}" data-id="${r.id}"><img src="${img(r.r2_key)}" alt="" />${r.is_base ? `<span class="tag">Base</span>` : ""}<div class="acts"><button data-base="${r.id}" ${r.is_base ? "disabled" : ""}>${r.is_base ? "Base ✓" : "Use as base"}</button><button data-delref="${r.id}">Delete</button></div></div>`).join("")}
        <label class="ref upload">+ Add<input type="file" accept="image/*" multiple hidden id="ref-file" /></label></div>
      ${refs.length && !refs.some((r) => r.is_base) ? `<p class="lead" style="color:var(--danger)">No base photo marked: the first active photo is used. Mark one with “Use as base”.</p>` : ""}
    </section>
    <section><h2>Generation</h2>
      <p class="lead">Images: ${esc(settings.model)}, every look an edit of your base photo, stored as WebP. Analysis: ${settings.analysis_model ? esc(settings.analysis_model) + " fills the form and spots what a fit is missing (thinking off)." : "not configured — set the GEMINI_API_KEY secret; the form falls back to gpt-5-mini."}</p>
      <div class="row"><div class="field" style="min-width:240px"><label>Look quality</label><select class="input" id="look-quality">${settings.qualities.map((q) => `<option value="${q}" ${q === settings.look_quality ? "selected" : ""}>${esc(QUALITY_LABEL[q] ?? q)}</option>`).join("")}</select></div>
      <div class="field" style="min-width:240px"><label>Cover quality</label><select class="input" id="hero-quality">${settings.qualities.map((q) => `<option value="${q}" ${q === settings.hero_quality ? "selected" : ""}>${esc(QUALITY_LABEL[q] ?? q)}</option>`).join("")}</select></div></div>
      ${b ? `<div class="list" style="margin-top:18px"><div class="item"><div><strong>Image generations</strong> <span class="muted" style="font-size:12px">· ${usage(b.image)}</span></div></div><div class="item"><div><strong>Covers</strong> <span class="muted" style="font-size:12px">· ${usage(b.hero)}</span></div></div><div class="item"><div><strong>Analysis passes</strong> <span class="muted" style="font-size:12px">· ${usage(b.analysis)}</span></div></div></div><p class="lead" style="margin-top:8px">Hard caps on spending, counted per UTC hour and day. Anything over the cap is refused, also inside the queue.</p>` : ""}
    </section>
    <section><h2>Passkeys</h2>
      <div class="list">${passkeys.map((p) => `<div class="item"><div><strong>${esc(p.name || "Passkey")}</strong> <span class="muted" style="font-size:12px">· ${p.device_type === "multiDevice" ? "synced" : "this device"} · added ${new Date(p.created_at * 1000).toLocaleDateString()}${p.last_used_at ? ` · last used ${new Date(p.last_used_at * 1000).toLocaleDateString()}` : ""}</span></div><button class="btn danger sm" data-delpk="${esc(p.id)}">Remove</button></div>`).join("") || `<div class="item muted">No passkeys yet.</div>`}</div>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="add-pk" ${browserSupportsWebAuthn() ? "" : "disabled"}>Add passkey for this device</button></div>
    </section>
    <section><h2>Session</h2><div class="row"><span class="muted" style="font-size:12px">${esc(me.email ?? "")}</span><button class="btn ghost sm" data-action="logout">Log out</button></div></section>
  </div></main>`);

  const drawPick = () => {
    $$("#picker .pick").forEach((p) => { const i = heroPick.indexOf((p as HTMLElement).dataset.id!); p.classList.toggle("on", i >= 0); $(".n", p)?.remove(); if (i >= 0) p.insertAdjacentHTML("beforeend", `<span class="n">${i + 1}</span>`); });
    const go = $<HTMLButtonElement>("#hero-go")!;
    const inflight = go.hasAttribute("data-inflight");
    go.disabled = heroPick.length < 2 || inflight;
    $("#hero-hint")!.textContent = inflight ? "A cover is being generated; wait for it before starting another." : heroPick.length < 2 ? "Pick 2–3 looks" : `${STYLE_LABEL[heroStyle]} · ${heroPick.length} fits · one high-quality generation`;
  };
  const togglePick = (p: HTMLElement) => { const id = p.dataset.id!; const i = heroPick.indexOf(id); if (i >= 0) heroPick.splice(i, 1); else if (heroPick.length < 3) heroPick.push(id); else toast("Three at most.", true); drawPick(); };
  $$("#picker .pick").forEach((p) => { p.addEventListener("click", () => togglePick(p as HTMLElement)); p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePick(p as HTMLElement); } }); });
  $$("#styles .chip").forEach((c) => c.addEventListener("click", () => { heroStyle = (c as HTMLElement).dataset.style!; $$("#styles .chip").forEach((x) => x.classList.toggle("on", x === c)); drawPick(); }));
  new MutationObserver(drawPick).observe($("#hero-go")!, { attributes: true, attributeFilter: ["data-inflight"] });
  drawPick();
  $("#hero-go")!.addEventListener("click", async () => {
    const bt = $<HTMLButtonElement>("#hero-go")!;
    if (!confirm(`Generate a ${STYLE_LABEL[heroStyle]} cover with ${heroPick.length} looks? One high-quality image generation, about 90 seconds.`)) return;
    bt.disabled = true; bt.innerHTML = `<span class="spinner"></span> Queuing`;
    try {
      const h: Hero = await api("/api/hero", { method: "POST", body: JSON.stringify({ garment_ids: heroPick, style: heroStyle }) });
      $("#heroes")!.insertAdjacentHTML("afterbegin", heroTile(h));
      bt.setAttribute("data-inflight", "");
      bindHeroDelete(); watchHeroes(); toast("Cover queued, about 90 seconds. You can leave this page.");
    } catch (err: any) { fail(err, 6000); }
    finally { bt.textContent = "Generate campaign"; drawPick(); }
  });
  bindHeroDelete = () => $$("[data-delhero]").forEach((x) => { (x as HTMLElement).onclick = async () => { const tile = x.closest(".h")!; if (!confirm(tile.classList.contains("skeleton") ? "Cancel this cover? If the generation already started, it still completes in the background and is discarded." : "Remove this campaign image?")) return; try { await api(`/api/hero/${(x as HTMLElement).dataset.delhero}`, { method: "DELETE" }); tile.remove(); settingsCache = null; if (!$("#heroes .h.skeleton")) $("#hero-go")!.removeAttribute("data-inflight"); } catch (err: any) { fail(err); } }; });
  bindHeroDelete();
  if ((settings.heroes ?? []).some((h) => h.status === "pending")) watchHeroes();
  $<HTMLInputElement>("#ref-file")!.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    input.disabled = true; busy(true);
    let ok = 0;
    for (const f of files) { const fd = new FormData(); fd.append("file", f); try { await api("/api/refs", { method: "POST", body: fd }); ok++; } catch (err: any) { fail(err); } }
    busy(false);
    if (ok) toast(ok === 1 ? "Reference photo added." : `${ok} reference photos added.`);
    render();
  });
  $$("[data-base]").forEach((b) => b.addEventListener("click", async () => { (b as HTMLButtonElement).disabled = true; try { await api("/api/settings", { method: "PATCH", body: JSON.stringify({ base_ref: (b as HTMLElement).dataset.base }) }); settingsCache = null; toast("Base photo set"); render(); } catch (err: any) { fail(err); (b as HTMLButtonElement).disabled = false; } }));
  $<HTMLInputElement>("#hero-file")!.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f); fd.append("style", heroStyle);
    input.disabled = true; busy(true);
    try { const h: Hero = await api("/api/heroes/upload", { method: "POST", body: fd }); $("#heroes")!.insertAdjacentHTML("afterbegin", heroTile(h)); bindHeroDelete(); settingsCache = null; toast("Cover uploaded"); }
    catch (err: any) { fail(err); }
    finally { input.disabled = false; input.value = ""; busy(false); }
  });
  $$("[data-delref]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Delete this reference photo?")) return; (b as HTMLButtonElement).disabled = true; try { await api(`/api/refs/${(b as HTMLElement).dataset.delref}`, { method: "DELETE" }); settingsCache = null; render(); } catch (err: any) { fail(err); (b as HTMLButtonElement).disabled = false; } }));
  const quality = (id: string, key: string, label: string) => $<HTMLSelectElement>(id)!.addEventListener("change", async (e) => { const s = e.target as HTMLSelectElement; const prev = settings[key as "look_quality" | "hero_quality"]; s.disabled = true; try { await api("/api/settings", { method: "PATCH", body: JSON.stringify({ [key]: s.value }) }); settingsCache = null; toast(`${label} updated`); } catch (err: any) { fail(err); s.value = prev; } finally { s.disabled = false; } });
  quality("#look-quality", "look_quality", "Look quality");
  quality("#hero-quality", "hero_quality", "Cover quality");
  $$("[data-delpk]").forEach((b) => b.addEventListener("click", async () => { if (!confirm(passkeys.length === 1 ? "Remove your only passkey? You will need an email code to sign in next time." : "Remove this passkey?")) return; (b as HTMLButtonElement).disabled = true; try { await api(`/api/auth/passkeys/${encodeURIComponent((b as HTMLElement).dataset.delpk!)}`, { method: "DELETE" }); me.passkeys = Math.max(0, (me.passkeys ?? 1) - 1); render(); } catch (err: any) { fail(err); (b as HTMLButtonElement).disabled = false; } }));
  $("#add-pk")!.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("#add-pk")!; btn.disabled = true;
    try {
      const { options, challengeId } = await api("/api/auth/passkey/register/options", { method: "POST" });
      const response = await startRegistration({ optionsJSON: options });
      const name = navigator.userAgent.includes("iPhone") ? "iPhone" : navigator.userAgent.includes("iPad") ? "iPad" : navigator.userAgent.includes("Mac") ? "Mac" : navigator.userAgent.includes("Android") ? "Android" : "Device";
      await api("/api/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ challengeId, response, name }) });
      toast("Passkey added"); me.passkeys = (me.passkeys ?? 0) + 1; render();
    } catch (err: any) { if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") toast(err?.name === "InvalidStateError" ? "This device already has a passkey for closet." : err.message || "Could not add passkey", true); btn.disabled = false; }
  });
}

// ---------- global handlers ----------
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("[data-action=logout]")) {
    const b = t.closest("[data-action=logout]") as HTMLButtonElement; b.disabled = true;
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* the cookie is gone either way */ }
    me = { authenticated: false }; settingsCache = null; navigate("/login", true); return;
  }
  const a = t.closest("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank" || a.hasAttribute("download") || a.origin !== location.origin) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const card = a.closest(".card[data-id]") as HTMLElement | null;
  if (card) return openViewer(card.dataset.id!, card);
  const piece = a.closest(".card[data-pid], a.paired") as HTMLElement | null;
  if (piece) { if (viewerEl) closeViewer(false); return openPiece(piece.dataset.pid ?? piece.getAttribute("href")!.slice(3)); }
  const href = a.getAttribute("href")!;
  if (viewerEl || pieceEl) { if (viewerEl) closeViewer(false); if (pieceEl) closePiece(false); return navigate(href, true); }
  if (href === location.pathname + location.search) { pendingScroll = 0; return render(); }
  navigate(href);
});
document.addEventListener("paste", (e) => {
  if (!me.authenticated) return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) && !(t.id === "url")) return;
  const items = Array.from(e.clipboardData?.items ?? []);
  const it = items.find((i) => i.type.startsWith("image/"));
  if (it) { const f = it.getAsFile(); if (f) { e.preventDefault(); startAdd({ file: f }); } return; }
  const text = e.clipboardData?.getData("text/plain")?.trim();
  if (text && /^https?:\/\/\S+$/.test(text)) { e.preventDefault(); startAdd({ url: text }); }
});
document.addEventListener("dragover", (e) => { if (me.authenticated && location.pathname !== "/add" && e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
document.addEventListener("drop", (e) => { if (me.authenticated && location.pathname !== "/add") { const f = e.dataTransfer?.files?.[0]; if (f && f.type.startsWith("image/")) { e.preventDefault(); startAdd({ file: f }); } } });

// ---------- router ----------
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const path = location.pathname;
  busy(true);
  try {
    me = await api("/api/me");
    if (seq !== renderSeq) return;
    if (!me.authenticated) return path === "/login" ? viewLogin() : navigate("/login", true);
    if (path === "/login") return navigate("/", true);
    const m = path.match(/^\/g\/([A-Za-z0-9_-]+)$/);
    if (m) {
      // Deep link: the viewer first (it covers the screen at once, no flash), then the list underneath it.
      const haveList = renderedKey === "/looks" || renderedKey.startsWith("/looks?") || renderedKey === "/";
      await openViewer(m[1], undefined, false);
      if (!haveList || !$(".card[data-id]")) { history.replaceState(history.state, "", "/looks"); await viewLooks(); history.replaceState({ viewer: m[1] }, "", `/g/${m[1]}`); }
      (viewerEl as any)?._refreshNav?.();
      return;
    }
    const pm = path.match(/^\/p\/([A-Za-z0-9_-]+)$/);
    if (pm) {
      await openPiece(pm[1], false);
      if (renderedKey !== "/closet" || !$("#wardrobe")) { history.replaceState(history.state, "", "/closet"); await viewWardrobe(); history.replaceState({ piece: pm[1] }, "", `/p/${pm[1]}`); }
      return;
    }
    if (viewerEl) closeViewer(false);
    if (pieceEl) closePiece(false);
    refreshList = null;
    if (path === "/") return viewHome();
    if (path === "/looks") return viewLooks();
    if (path === "/closet") return viewWardrobe();
    if (path === "/add") return viewAdd();
    if (path === "/settings") return viewSettings();
    navigate("/", true);
  } catch (err: any) {
    if (err?.name !== "AuthError") { console.error(err); fail(err); }
  } finally { busy(false); }
}
render();
