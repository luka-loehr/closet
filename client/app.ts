import { startAuthentication, startRegistration, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";
import { CATEGORIES_BY_FAMILY, FAMILY_LABEL, FAMILY_ORDER, detailFills, familyOf, labelOf, missingSlots, slotsOf as taxSlots } from "../src/taxonomy";

// ---------- types ----------
type Look = { id: string; garment_id: string; variant: string; pose: string; model: string; status: string; r2_key: string | null; thumb_key: string | null; error: string | null; duration_ms: number | null; created_at: number; pairing?: string[] };
type Garment = {
  id: string; name: string; brand: string | null; category: string | null; color: string | null; notes: string | null; source_url: string | null; r2_key: string; thumb_key: string | null; created_at: number;
  owned: number; draft: number; colors: string[]; description: string | null; missing: string[]; studio_key: string | null; studio_alt_key: string | null; studio_status: string | null; family?: string; category_label?: string; detail_fill?: boolean;
  covers?: Record<string, Look>; looks?: Look[]; paired?: Garment[]; pending?: number; slots?: string[];
  analysis?: { model: string | null; ms: number; found_brand: boolean; found_name: boolean; clean_product_shot: boolean };
};
type Hero = { id: string; r2_key: string | null; garment_ids: string[]; style: string; model: string; status: string; error: string | null; created_at: number };
type Settings = { model: string; look_quality: string; hero_quality: string; qualities: string[]; variants: string[]; hero_styles: string[]; base_ref: string | null; heroes: Hero[]; analysis_model: string | null; categories: string[]; slots: string[] };

const VARIANTS = ["white", "dark", "nature"] as const;
const VARIANT_LABEL: Record<string, string> = { white: "Studio", dark: "Dark", nature: "Nature" };
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

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (init.body && !(init.body instanceof FormData) && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401 && !path.startsWith("/api/auth") && path !== "/api/me") {
    me = { authenticated: false };
    navigate("/login", true);
    throw new Error("unauthorized");
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `request failed (${res.status})`), { data, status: res.status });
  return data as T;
}

function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  render();
}
window.addEventListener("popstate", () => {
  if (viewerEl && !location.pathname.startsWith("/g/")) { closeViewer(false); return; }
  if (pieceEl && !location.pathname.startsWith("/p/")) { closePiece(false); return; }
  render();
});

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
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

/** While any garment is still generating, refresh the grid every few seconds. */
function watchPending(garments: Garment[], redraw: (list: Garment[]) => void, query = "owned=0") {
  if (!garments.some((g) => g.pending)) return;
  const signal = viewAbort.signal;
  const tick = async () => {
    if (signal.aborted) return;
    try {
      const list = await api<Garment[]>(`/api/garments?limit=200&${query}`);
      if (signal.aborted) return;
      redraw(list);
      if (list.some((g) => g.pending)) setTimeout(tick, 4000);
    } catch { /* stop */ }
  };
  setTimeout(tick, 4000);
}

function card(g: Garment, i = 0): string {
  const c = g.covers ?? {};
  const main = c.white ?? c.nature ?? c.dark;
  const alt = [c.dark, c.white, c.nature].find((x) => x && x !== main);
  const meta = [g.brand, g.category].filter(Boolean).join(" · ");
  const thumb = (l: Look) => img(l.thumb_key ?? l.r2_key);
  const tile = main
    ? `<img src="${thumb(main)}" alt="" loading="lazy" decoding="async" />${alt ? `<img class="alt" src="${thumb(alt)}" alt="" loading="lazy" decoding="async" />` : ""}`
    : `<img class="source" src="${img(g.thumb_key ?? g.r2_key)}" alt="" loading="lazy" /><div class="status">${g.pending ? "Generating…" : "Not generated"}</div>`;
  return `<a class="card" href="/g/${g.id}" data-id="${g.id}" style="--i:${i}">
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
  return `<a class="card piece" href="/p/${g.id}" data-pid="${g.id}" style="--i:${i}">
    <div class="tile ${generating || !main ? "skeleton" : ""}">${main ? `<img class="product" src="${main}" alt="" loading="lazy" decoding="async" />` : ""}${alt ? `<img class="product alt ${detailFills(g.category) ? "fill" : ""}" src="${alt}" alt="" loading="lazy" decoding="async" />` : ""}${generating ? `<div class="status">Studio shots…</div>` : !main ? `<div class="status">No studio shot</div>` : ""}</div>
    <div class="info"><div class="name">${esc(g.name)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}<div class="variants">${swatches(g.colors)}</div></div>
  </a>`;
}

// ---------- login ----------
async function viewLogin() {
  stopHero();
  mainEl = null; headerEl = null;
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
  let email = localStorage.getItem("closet_email") ?? "";
  (emailForm.elements.namedItem("email") as HTMLInputElement).value = email;

  emailForm.onsubmit = async (e) => {
    e.preventDefault();
    email = (emailForm.elements.namedItem("email") as HTMLInputElement).value.trim();
    const btn = $<HTMLButtonElement>("button", emailForm)!;
    btn.disabled = true;
    try {
      await api("/api/auth/email/start", { method: "POST", body: JSON.stringify({ email }) });
      localStorage.setItem("closet_email", email);
      codeForm.hidden = false;
      ($("input", codeForm) as HTMLInputElement).focus();
      toast("If that address is allowed, a code is on its way.");
    } catch (err: any) { toast(err.message, true); } finally { btn.disabled = false; }
  };
  codeForm.onsubmit = async (e) => {
    e.preventDefault();
    const code = (codeForm.elements.namedItem("code") as HTMLInputElement).value.trim();
    try {
      await api("/api/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code }) });
      me = await api("/api/me");
      navigate("/", true);
      if (browserSupportsWebAuthn() && !me.passkeys) toast("Tip: add a passkey in settings for one-tap login.", false, 6000);
    } catch (err: any) { toast(err.message, true); }
  };
  const passkeyLogin = async (autofill = false) => {
    try {
      const { options, challengeId } = await api("/api/auth/passkey/login/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
      await api("/api/auth/passkey/login/verify", { method: "POST", body: JSON.stringify({ challengeId, response }) });
      me = await api("/api/me");
      navigate("/", true);
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") return;
      toast(err.message || "Passkey sign-in failed", true);
    }
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
      : `<div class="empty"><div><div class="wordmark">closet</div><p>No campaign image yet. Add a few garments, then generate one in settings.</p><a class="btn" href="/settings">Generate campaign</a></div></div>`}
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
  watchPending(garments, (list) => { const grid = $(".page .grid"); if (grid) grid.innerHTML = list.slice(0, 8).map(card).join(""); });
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

// ---------- looks: every try-on, filterable ----------
async function viewLooks() {
  const garments = await api<Garment[]>("/api/garments?limit=200&owned=0");
  const cats = Array.from(new Set(garments.map((g) => g.category).filter(Boolean))) as string[];
  const params = new URLSearchParams(location.search);
  let filter = params.get("cat") ?? "";
  if (filter && !cats.includes(filter)) filter = "";
  const brand = params.get("brand") ?? "";
  setHeader("home", false);
  await swap(`<main class="page">
    <div class="section-head"><h2>Looks · ${brand ? esc(brand) + " · " : ""}${garments.length}</h2><a href="/add">+ Try on</a></div>
    <div class="filters"><button class="chip ${filter ? "" : "on"}" data-cat="">All</button>${cats.map((c) => `<button class="chip ${c === filter ? "on" : ""}" data-cat="${esc(c)}">${esc(CAT_LABEL[c] ?? c)}</button>`).join("")}</div>
    <div class="grid" id="closet-grid"></div></main>`);
  const draw = () => {
    const list = garments.filter((g) => (!filter || g.category === filter) && (!brand || g.brand === brand));
    $("#closet-grid")!.innerHTML = list.length ? list.map(card).join("") : `<div class="empty-state" style="grid-column:1/-1"><h3>Empty</h3></div>`;
    $$(".filters .chip").forEach((c) => c.classList.toggle("on", (c as HTMLElement).dataset.cat === filter));
  };
  $$(".filters .chip").forEach((c) => c.addEventListener("click", () => { filter = (c as HTMLElement).dataset.cat!; history.replaceState(null, "", filter ? `/looks?cat=${encodeURIComponent(filter)}` : "/looks"); draw(); }));
  draw();
  watchPending(garments, (list) => { garments.splice(0, garments.length, ...list); draw(); });
}

// ---------- closet: the pieces you own, grouped like a shop ----------
async function viewWardrobe() {
  const pieces = await api<Garment[]>("/api/garments?limit=300&owned=1");
  setHeader("closet", false);
  const draw = () => {
    const sections = FAMILY_ORDER.map((f) => {
      const list = pieces.filter((g) => familyOf(g.category) === f);
      if (!list.length) return "";
      return `<section class="wsection" id="fam-${f}"><div class="section-head"><h2>${esc(FAMILY_LABEL[f])} · ${list.length}</h2></div><div class="grid wgrid">${list.map(pieceCard).join("")}</div></section>`;
    }).join("");
    $("#wardrobe")!.innerHTML = sections || `<div class="empty-state"><h3>Your closet is empty</h3><p>Add the shoes, jeans and tees you already own. When you try on a new piece, you can complete the fit with them.</p><a class="btn" href="/add?own=1">Add what you own</a></div>`;
  };
  await swap(`<main class="page">
    <div class="section-head"><h2>Closet · ${pieces.length} pieces</h2><a href="/add?own=1">+ Add a piece you own</a></div>
    <div id="wardrobe"></div></main>`);
  draw();
  watchPending(pieces, (list) => { pieces.splice(0, pieces.length, ...list); draw(); }, "owned=1");
}

// ---------- add flow: upload → fast analysis → review form (+ complete the fit) → submit ----------
let pendingImage: { file?: File; url?: string; dataUrl?: string } | null = null;
let addOwn = false;

async function viewAdd() {
  const settings = await getSettings();
  addOwn = new URLSearchParams(location.search).get("own") === "1";
  setHeader("", false);
  await swap(`<main class="page">
    <div class="section-head"><h2>Add a piece</h2><span class="muted caps">${esc(settings.analysis_model ? settings.analysis_model + " · " : "")}${esc(settings.model)} · ${esc(settings.look_quality)}</span></div>
    <div class="mode" id="mode" role="tablist">
      <button class="chip ${addOwn ? "" : "on"}" data-own="0" role="tab">Try on</button>
      <button class="chip ${addOwn ? "on" : ""}" data-own="1" role="tab">I own this</button>
      <span class="muted" id="mode-hint">${addOwn ? "Goes into your closet as a studio product shot; use it to complete fits." : "Generates you wearing it in three studio setups."}</span>
    </div>
    <div id="add-stage">
      <div class="drop" id="drop" tabindex="0">
        <div><h3>Drop a product photo</h3><p>Paste with <kbd>⌘V</kbd> anywhere, drag an image here, or click to pick a file. A direct image URL works too.</p>
        <div class="urlrow" onclick="event.stopPropagation()"><input class="input" id="url" placeholder="https://…/jacket.jpg" /><button class="btn" id="url-go">Add</button></div></div>
      </div>
      <input type="file" id="file" accept="image/*" hidden />
    </div></main>`);
  $$("#mode .chip").forEach((c) => c.addEventListener("click", () => {
    addOwn = (c as HTMLElement).dataset.own === "1";
    $$("#mode .chip").forEach((x) => x.classList.toggle("on", x === c));
    $("#mode-hint")!.textContent = addOwn ? "Goes into your closet as a studio product shot; use it to complete fits." : "Generates you wearing it in three studio setups.";
    history.replaceState(null, "", addOwn ? "/add?own=1" : "/add");
  }));
  const drop = $("#drop")!;
  const file = $<HTMLInputElement>("#file")!;
  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", () => file.files?.[0] && startAdd({ file: file.files[0] }));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith("image/")) return startAdd({ file: f });
    const url = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    if (url && /^https?:\/\//.test(url)) startAdd({ url: url.trim() });
  });
  $("#url-go")!.addEventListener("click", () => { const u = $<HTMLInputElement>("#url")!.value.trim(); if (u) startAdd({ url: u }); });
  $<HTMLInputElement>("#url")!.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#url-go")!.click(); });
  if (pendingImage) { const p = pendingImage; pendingImage = null; startAdd(p); }
}

async function startAdd(src: { file?: File; url?: string; dataUrl?: string }) {
  if (location.pathname !== "/add") { pendingImage = src; return navigate(addOwn ? "/add?own=1" : "/add"); }
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
    toast(err.message, true, 6000);
    stage.innerHTML = `<div class="empty-state"><h3>Could not read that image</h3><p>${esc(err.message)}</p><a class="btn" href="${own ? "/add?own=1" : "/add"}">Try again</a></div>`;
    return;
  }
  const a = g.analysis;
  $("#add-name")!.innerHTML = a?.model ? `${esc(a.model)} · ${(a.ms / 1000).toFixed(1)} s${a.found_brand ? "" : " · brand not recognised"}` : "Fill in the details";
  $("#add-name")!.classList.remove("analysing");
  const wardrobe = own ? [] : await api<Garment[]>("/api/garments?limit=300&owned=1");
  const settings = await getSettings();
  const slotsToPick: string[] = own ? [] : settings.slots;
  const pick: Record<string, string | null> = {};
  const pickerRow = (slot: string) => {
    const options = wardrobe.filter((w) => slotsOf(w.category).includes(slot));
    return `<div class="slotrow" data-slot="${slot}" ${(missingSlots(g.category) as string[]).includes(slot) ? "" : "hidden"}>
      <div class="slothead"><span class="caps">${SLOT_LABEL[slot] ?? slot}</span><span class="tag-missing">Missing from this fit</span></div>
      <div class="slotpick">
        <button type="button" class="pick none on" data-slot="${slot}" data-id="" title="Keep what the base photo wears"><span>Keep<br>base</span></button>
        ${options.map((w) => `<button type="button" class="pick" data-slot="${slot}" data-id="${w.id}" title="${esc(w.name)}">${pieceImg(w) ? `<img src="${pieceImg(w)}" alt="" />` : `<span>${esc(w.name.split(" ").slice(0, 2).join(" "))}</span>`}</button>`).join("")}
        ${options.length ? "" : `<a class="pick add" href="/add?own=1" title="Add a piece you own">+ Add<br>yours</a>`}
      </div></div>`;
  };
  const form = $(".review", stage)!;
  form.className = "review";
  form.innerHTML = `
    <div class="fields">
      <div class="field"><label>Name</label><input class="input" name="name" value="${esc(g.name)}" maxlength="120" /></div>
      <div class="fields2">
        <div class="field"><label>Brand${a && !a.found_brand ? ' <em class="muted">· not recognised, type it</em>' : ""}</label><input class="input ${a && !a.found_brand ? "attn" : ""}" name="brand" value="${esc(g.brand ?? "")}" placeholder="Brand" maxlength="60" /></div>
        <div class="field"><label>Category</label><select class="input" name="category">${CATEGORIES_BY_FAMILY.map((f) => `<optgroup label="${esc(f.label)}">${f.categories.map((c) => `<option value="${c.id}" ${c.id === g.category ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</optgroup>`).join("")}</select></div>
      </div>
      <div class="field"><label>Colours <em class="muted">· up to three, comma separated</em></label><div class="colorrow"><input class="input" name="colors" value="${esc(g.colors.join(", "))}" placeholder="navy, white" /><span class="swatches" id="sw">${g.colors.map((c) => `<i style="background:${esc(swatch(c))}"></i>`).join("")}</span></div></div>
      <div class="field"><label>Description</label><textarea class="input" name="description" maxlength="300" rows="2">${esc(g.description ?? "")}</textarea></div>
      <div class="field"><label>Product link <em class="muted">· where to buy it, optional</em></label><input class="input" name="source_url" type="url" value="${esc(g.source_url ?? "")}" placeholder="https://…" /></div>
    </div>
    ${slotsToPick.length ? `<div class="complete" ${missingSlots(g.category).length ? "" : "hidden"}><div class="section-head" style="margin:6px 0 10px"><h2>Complete the fit</h2><span class="muted" style="font-size:11px">Pieces from your closet are worn with it; the base tee, jeans and sneakers fill the rest</span></div>${slotsToPick.map(pickerRow).join("")}</div>` : ""}
    <div class="row" style="margin-top:22px"><button class="btn" id="submit">${own ? "Add to closet" : "Generate looks"}</button><button class="btn ghost" id="cancel" type="button">Discard</button><span class="muted" style="font-size:12px">${own ? "Two studio views on white are generated from your photo in the background (~40 s): the piece and a detail shot, or for shoes the side and three-quarter view. Your photo itself is never shown." : "Three looks are generated in the background (~40 s each). You can leave right away."}</span></div>`;
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
  $("#cancel", form)!.addEventListener("click", async () => { await api(`/api/garments/${g.id}`, { method: "DELETE" }).catch(() => {}); navigate(own ? "/add?own=1" : "/add", true); });
  $("#submit", form)!.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("#submit", form)!;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Saving`;
    const val = (n: string) => ($(`[name=${n}]`, form) as HTMLInputElement).value.trim();
    try {
      await api(`/api/garments/${g.id}/commit`, { method: "POST", body: JSON.stringify({
        name: val("name"), brand: val("brand") || null, category: val("category"), colors: val("colors").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3),
        description: val("description") || null, owned: own, pairing: pick, source_url: val("source_url") || null,
      }) });
      toast(own ? "Added to your closet." : "Generating your looks in the background.");
      navigate(own ? "/closet" : "/", true);
    } catch (err: any) { toast(err.message, true, 6000); btn.disabled = false; btn.textContent = own ? "Add to closet" : "Generate looks"; }
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
    try {
      const u = await api<Garment>(`/api/garments/${g.id}`, { method: "PATCH", body: JSON.stringify({ source_url: input.value.trim() || null }) });
      g.source_url = u.source_url;
      wrap.outerHTML = linkBlock(g); bindLink(el, g); toast(g.source_url ? "Link saved" : "Link removed");
    } catch (err: any) { toast(err.message, true); }
  };
  $("[data-save]", row)!.addEventListener("click", save);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
}

// ---------- piece viewer: one wardrobe piece, large ----------
let pieceEl: HTMLElement | null = null;
function closePiece(pop = true) {
  if (!pieceEl) return;
  const el = pieceEl; pieceEl = null;
  el.classList.add("closing"); document.body.classList.remove("noscroll");
  setTimeout(() => el.remove(), 320);
  if (pop && location.pathname.startsWith("/p/")) { if (viewerPushed) history.back(); else history.replaceState(null, "", "/closet"); }
  viewerPushed = false;
}
async function openPiece(id: string, push = true) {
  let g: Garment;
  try { g = await api<Garment>(`/api/garments/${id}`); } catch { return toast("Not found", true); }
  if (pieceEl) { pieceEl.remove(); pieceEl = null; }
  if (push && location.pathname !== `/p/${id}`) { history.pushState({ piece: id }, "", `/p/${id}`); viewerPushed = true; }
  else if (!push && location.pathname !== `/p/${id}`) history.replaceState({ piece: id }, "", `/p/${id}`);
  const el = document.createElement("div");
  el.className = "viewer piece";
  const pending = g.studio_status === "pending";
  const shoes = familyOf(g.category) === "shoes";
  el.innerHTML = `
    <div class="v-head">
      <div><div class="v-name">${esc(g.name)}</div><div class="v-meta">${esc([g.brand, CAT_LABEL[g.category ?? ""] ?? g.category].filter(Boolean).join(" · "))} ${swatches(g.colors)}</div>${g.description ? `<p class="v-desc">${esc(g.description)}</p>` : ""}</div>
      <button class="v-close" aria-label="Close">×</button>
    </div>
    <div class="v-row one">
      <figure class="v-panel" style="--i:0"><div class="v-tile product ${pending || !pieceImg(g) ? "skeleton" : ""}">${pieceImg(g) ? `<img src="${pieceImg(g, false)}" alt="" />` : `<div class="v-missing">${pending ? "Studio shot<br><span>generating…</span>" : "Studio shot<br><span>" + (g.studio_status === "error" ? "failed" : "not generated") + "</span>"}</div>`}</div><figcaption>${shoes ? "Side view" : "Studio shot"}</figcaption></figure>
      <figure class="v-panel" style="--i:1"><div class="v-tile product ${pending || !pieceAlt(g) ? "skeleton" : ""}">${pieceAlt(g) ? `<img src="${pieceAlt(g, false)}" alt="" class="${detailFills(g.category) ? "fill" : ""}" />` : `<div class="v-missing">${shoes ? "Three-quarter" : "Detail"}<br><span>${pending ? "generating…" : "not generated"}</span></div>`}</div><figcaption>${shoes ? "Three-quarter view" : "Detail"}</figcaption></figure>
    </div>
    <div class="v-foot"><div class="row">${linkBlock(g)}${g.studio_status !== "pending" ? `<button class="v-re" title="Render both studio views again from your photo">Re-render</button>` : ""}</div><button class="v-del">Remove from closet</button></div>`;
  document.body.appendChild(el); document.body.classList.add("noscroll"); pieceEl = el;
  void el.offsetWidth; setTimeout(() => el.classList.add("open"), 10);
  $(".v-close", el)!.addEventListener("click", () => closePiece());
  bindLink(el, g);
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).classList.contains("v-row")) closePiece(); });
  $(".v-re", el)?.addEventListener("click", async () => {
    try { await api(`/api/garments/${g.id}/studio`, { method: "POST" }); toast("Re-rendering both views in the background."); closePiece(false); navigate("/closet", true); }
    catch (err: any) { toast(err.message, true); }
  });
  $(".v-del", el)!.addEventListener("click", async () => {
    if (!confirm(`Remove "${g.name}" from your closet?`)) return;
    await api(`/api/garments/${g.id}`, { method: "DELETE" });
    closePiece(false); navigate("/closet", true);
  });
}

// ---------- viewer: a card expands in place into the three variants ----------
let viewerEl: HTMLElement | null = null;
let viewerId: string | null = null;
let viewerPushed = false;

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
  const first = $<HTMLImageElement>(".v-panel img", el);
  const card = id ? $<HTMLImageElement>(`.card[data-id="${id}"] .tile img:not(.alt)`) : null;
  if (first && card && !reduced()) { flyImage(first.getBoundingClientRect(), card.getBoundingClientRect(), first.src, 460); first.style.opacity = "0"; }
  el.classList.add("closing");
  document.body.classList.remove("noscroll");
  setTimeout(() => el.remove(), 320);
  if (pop && location.pathname.startsWith("/g/")) {
    if (viewerPushed) history.back();
    else history.replaceState(null, "", "/looks");
  }
  viewerPushed = false;
}

async function openViewer(id: string, fromCard?: HTMLElement, push = true) {
  let g: Garment;
  try { g = await api<Garment>(`/api/garments/${id}`); } catch { return toast("Not found", true); }
  if (viewerEl) { viewerEl.remove(); viewerEl = null; }
  if (push && location.pathname !== `/g/${id}`) { history.pushState({ viewer: id }, "", `/g/${id}`); viewerPushed = true; }
  else if (!push && location.pathname !== `/g/${id}`) history.replaceState({ viewer: id }, "", `/g/${id}`);
  viewerId = id;
  const done = (g.looks ?? []).filter((l) => l.status === "done");
  const pendingV = new Set((g.looks ?? []).filter((l) => l.status === "pending").map((l) => l.variant));
  const byVariant = (v: string) => done.find((l) => l.variant === v);
  const slug = g.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const ids = $$(".card[data-id]").map((c) => (c as HTMLElement).dataset.id!);
  const pos = ids.indexOf(id);
  const el = document.createElement("div");
  el.className = "viewer" + (fromCard ? "" : " instant");
  el.innerHTML = `
    <div class="v-head">
      <div><div class="v-name">${esc(g.name)}</div><div class="v-meta">${esc([g.brand, g.category, g.color].filter(Boolean).join(" · "))}</div></div>
      <button class="v-close" aria-label="Close">×</button>
    </div>
    <div class="v-row">${VARIANTS.map((v, i) => { const l = byVariant(v); return `<figure class="v-panel" style="--i:${i}" data-v="${v}">
        <div class="v-tile ${!l && pendingV.has(v) ? "skeleton" : ""}">${l ? `<img src="${img(l.r2_key)}" alt="" />` : `<div class="v-missing">${VARIANT_LABEL[v]}<br><span>${pendingV.has(v) ? "generating…" : "not generated"}</span></div>`}</div>
        <figcaption><span class="dot ${v}"></span>${VARIANT_LABEL[v]}${l ? `<a class="v-dl" href="${img(l.r2_key)}" download="${slug}-${v}.webp">Download</a>` : ""}</figcaption>
      </figure>`; }).join("")}</div>
    <div class="v-foot"><div class="row"><img class="srcmini" src="${img(g.thumb_key ?? g.r2_key)}" alt="" />${(g.paired ?? []).length ? `<span class="caps muted" style="margin-left:6px">Worn with</span>${g.paired!.map((p) => `<a class="srcmini paired" href="/p/${p.id}" title="${esc(p.name)}"><img src="${pieceImg(p)}" alt="" /></a>`).join("")}` : ""}${linkBlock(g)}</div><button class="v-del">Delete garment</button></div>
    ${pos > 0 ? `<button class="v-nav prev" aria-label="Previous">‹</button>` : ""}${pos >= 0 && pos < ids.length - 1 ? `<button class="v-nav next" aria-label="Next">›</button>` : ""}`;
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

  const goTo = (n: number) => { const nid = ids[n]; if (!nid) return; const c = $(`.card[data-id="${nid}"]`); viewerId = null; el.remove(); document.body.classList.remove("noscroll"); openViewer(nid, undefined, false); if (c) c.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }); };
  $(".v-close", el)!.addEventListener("click", () => closeViewer());
  bindLink(el, g);
  $(".v-nav.prev", el)?.addEventListener("click", () => goTo(pos - 1));
  $(".v-nav.next", el)?.addEventListener("click", () => goTo(pos + 1));
  (el as any)._nav = (d: number) => goTo(pos + d);
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).classList.contains("v-row")) closeViewer(); });
  $(".v-del", el)!.addEventListener("click", async () => {
    if (!confirm(`Delete "${g.name}" and its looks?`)) return;
    await api(`/api/garments/${g.id}`, { method: "DELETE" });
    viewerId = null; closeViewer(false);
    navigate("/looks", true);
  });
}
document.addEventListener("keydown", (e) => {
  if (pieceEl) { if (e.key === "Escape") closePiece(); return; }
  if (!viewerEl) return;
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") (viewerEl as any)._nav?.(-1);
  if (e.key === "ArrowRight") (viewerEl as any)._nav?.(1);
});

// ---------- settings ----------
function heroTile(h: Hero): string {
  if (h.status === "pending") return `<div class="h skeleton" data-id="${h.id}">${esc(STYLE_LABEL[h.style] ?? h.style)} · generating<button class="x" data-delhero="${h.id}" title="Cancel">×</button></div>`;
  if (h.status !== "done" || !h.r2_key) return `<div class="h" data-id="${h.id}"><span class="tag">${esc(STYLE_LABEL[h.style] ?? h.style)} · failed</span><div class="v-missing" style="padding:12px;font-size:10px">${esc(h.error || "failed")}</div><button class="x" data-delhero="${h.id}" title="Remove">×</button></div>`;
  return `<div class="h" data-id="${h.id}"><img src="${img(h.r2_key)}" alt="" /><span class="tag">${esc(STYLE_LABEL[h.style] ?? h.style)}</span><button class="x" data-delhero="${h.id}" title="Remove">×</button></div>`;
}
function watchHeroes() {
  const signal = viewAbort.signal;
  const tick = async () => {
    if (signal.aborted) return;
    try {
      const { heroes } = await api<{ heroes: Hero[] }>("/api/heroes");
      if (signal.aborted) return;
      for (const h of heroes) { const el = $(`#heroes .h[data-id="${h.id}"]`); if (el && el.classList.contains("skeleton") && h.status !== "pending") el.outerHTML = heroTile(h); }
      bindHeroDelete();
      settingsCache = null;
      if (heroes.some((h) => h.status === "pending")) setTimeout(tick, 5000);
    } catch { /* stop */ }
  };
  setTimeout(tick, 5000);
}
let bindHeroDelete = () => {};
async function viewSettings() {
  const [settings, refs, passkeys, garments] = await Promise.all([getSettings(true), api<any[]>("/api/refs"), api<any[]>("/api/auth/passkeys"), api<Garment[]>("/api/garments?limit=200")]);
  let heroPick: string[] = [];
  let heroStyle = settings.hero_styles?.[0] ?? "nyc";
  setHeader("settings", false);
  await swap(`<main class="page"><div class="settings">
    <section id="hero"><h2>Campaign</h2>
      <p class="lead">Campaign covers rotate on the landing page every 10 seconds. Pick 2–3 garments and a location, then generate (about 90 seconds), or upload a finished cover.</p>
      <div class="heroes" id="heroes">${(settings.heroes ?? []).map(heroTile).join("")}</div>
      <div class="chips" id="styles" style="margin-bottom:12px">${(settings.hero_styles ?? []).map((s) => `<button class="chip ${s === heroStyle ? "on" : ""}" data-style="${s}">${esc(STYLE_LABEL[s] ?? s)}</button>`).join("")}</div>
      <div class="picker" id="picker">${garments.map((g) => `<div class="pick" data-id="${g.id}"><img src="${img(g.covers?.white?.thumb_key ?? g.covers?.white?.r2_key ?? g.thumb_key ?? g.r2_key)}" alt="" /></div>`).join("") || `<span class="muted">No garments yet.</span>`}</div>
      <div class="row" style="margin-top:12px"><button class="btn" id="hero-go" disabled>Generate campaign</button><label class="btn ghost" for="hero-file">Upload cover<input type="file" id="hero-file" accept="image/*" hidden /></label><span class="muted" style="font-size:12px" id="hero-hint">Pick 2–3 garments</span></div>
    </section>
    <section><h2>Reference photos of you</h2>
      <p class="lead">The base photo is the one image every look and cover is edited from: a clean full-body studio shot of you, arms relaxed, plain t-shirt and jeans. Mark it with “Base”. Other photos are kept for reference only.</p>
      <div class="refgrid" id="refs">${refs.map((r) => `<div class="ref ${r.is_base ? "base" : ""}" data-id="${r.id}"><img src="${img(r.r2_key)}" alt="" />${r.is_base ? `<span class="tag">Base</span>` : ""}<div class="acts"><button data-base="${r.id}">${r.is_base ? "Base ✓" : "Use as base"}</button><button data-delref="${r.id}">Delete</button></div></div>`).join("")}
        <label class="ref upload">+ Add<input type="file" accept="image/*" multiple hidden id="ref-file" /></label></div>
    </section>
    <section><h2>Generation</h2>
      <p class="lead">Images: ${esc(settings.model)}, every look an edit of your base photo, stored as WebP. Analysis: ${settings.analysis_model ? esc(settings.analysis_model) + " fills the form and spots what a fit is missing (thinking off)." : "not configured — set the GEMINI_API_KEY secret; the form falls back to gpt-5-mini."}</p>
      <div class="row"><div class="field" style="min-width:240px"><label>Look quality</label><select class="input" id="look-quality">${settings.qualities.map((q) => `<option value="${q}" ${q === settings.look_quality ? "selected" : ""}>${esc(QUALITY_LABEL[q] ?? q)}</option>`).join("")}</select></div>
      <div class="field" style="min-width:240px"><label>Cover quality</label><select class="input" id="hero-quality">${settings.qualities.map((q) => `<option value="${q}" ${q === settings.hero_quality ? "selected" : ""}>${esc(QUALITY_LABEL[q] ?? q)}</option>`).join("")}</select></div></div>
    </section>
    <section><h2>Passkeys</h2>
      <div class="list">${passkeys.map((p) => `<div class="item"><div><strong>${esc(p.name || "Passkey")}</strong> <span class="muted" style="font-size:12px">· ${p.device_type === "multiDevice" ? "synced" : "this device"} · added ${new Date(p.created_at * 1000).toLocaleDateString()}</span></div><button class="btn danger sm" data-delpk="${esc(p.id)}">Remove</button></div>`).join("") || `<div class="item muted">No passkeys yet.</div>`}</div>
      <div class="row" style="margin-top:12px"><button class="btn ghost" id="add-pk" ${browserSupportsWebAuthn() ? "" : "disabled"}>Add passkey for this device</button></div>
    </section>
    <section><h2>Session</h2><div class="row"><span class="muted" style="font-size:12px">${esc(me.email ?? "")}</span><button class="btn ghost sm" data-action="logout">Log out</button></div></section>
  </div></main>`);

  const drawPick = () => { $$("#picker .pick").forEach((p) => { const i = heroPick.indexOf((p as HTMLElement).dataset.id!); p.classList.toggle("on", i >= 0); $(".n", p)?.remove(); if (i >= 0) p.insertAdjacentHTML("beforeend", `<span class="n">${i + 1}</span>`); }); $<HTMLButtonElement>("#hero-go")!.disabled = heroPick.length < 2; $("#hero-hint")!.textContent = heroPick.length < 2 ? "Pick 2–3 garments" : `${STYLE_LABEL[heroStyle]} · ${heroPick.length} fits`; };
  $$("#picker .pick").forEach((p) => p.addEventListener("click", () => { const id = (p as HTMLElement).dataset.id!; const i = heroPick.indexOf(id); if (i >= 0) heroPick.splice(i, 1); else if (heroPick.length < 3) heroPick.push(id); drawPick(); }));
  $$("#styles .chip").forEach((c) => c.addEventListener("click", () => { heroStyle = (c as HTMLElement).dataset.style!; $$("#styles .chip").forEach((x) => x.classList.toggle("on", x === c)); drawPick(); }));
  drawPick();
  $("#hero-go")!.addEventListener("click", async () => {
    const b = $<HTMLButtonElement>("#hero-go")!; b.disabled = true; b.innerHTML = `<span class="spinner"></span> Generating`;
    try {
      const h: Hero = await api("/api/hero", { method: "POST", body: JSON.stringify({ garment_ids: heroPick, style: heroStyle }) });
      $("#heroes")!.insertAdjacentHTML("afterbegin", heroTile(h));
      bindHeroDelete(); watchHeroes(); toast("Cover queued, about 90 seconds. You can leave this page.");
    } catch (err: any) { toast(err.message, true, 6000); }
    finally { b.disabled = heroPick.length < 2; b.textContent = "Generate campaign"; }
  });
  bindHeroDelete = () => $$("[data-delhero]").forEach((x) => { (x as HTMLElement).onclick = async () => { if (!confirm("Remove this campaign image?")) return; await api(`/api/hero/${(x as HTMLElement).dataset.delhero}`, { method: "DELETE" }); x.closest(".h")!.remove(); settingsCache = null; }; });
  bindHeroDelete();
  if ((settings.heroes ?? []).some((h) => h.status === "pending")) watchHeroes();
  $<HTMLInputElement>("#ref-file")!.addEventListener("change", async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    for (const f of files) { const fd = new FormData(); fd.append("file", f); try { await api("/api/refs", { method: "POST", body: fd }); } catch (err: any) { toast(err.message, true); } }
    render();
  });
  $$("[data-base]").forEach((b) => b.addEventListener("click", async () => { await api("/api/settings", { method: "PATCH", body: JSON.stringify({ base_ref: (b as HTMLElement).dataset.base }) }); settingsCache = null; toast("Base photo set"); render(); }));
  $<HTMLInputElement>("#hero-file")!.addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f); fd.append("style", heroStyle);
    try { const h: Hero = await api("/api/heroes/upload", { method: "POST", body: fd }); $("#heroes")!.insertAdjacentHTML("afterbegin", heroTile(h)); bindHeroDelete(); settingsCache = null; toast("Cover uploaded"); }
    catch (err: any) { toast(err.message, true); }
  });
  $$("[data-delref]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Delete this reference photo?")) return; await api(`/api/refs/${(b as HTMLElement).dataset.delref}`, { method: "DELETE" }); b.closest(".ref")!.remove(); }));
  $<HTMLSelectElement>("#look-quality")!.addEventListener("change", async (e) => { await api("/api/settings", { method: "PATCH", body: JSON.stringify({ look_quality: (e.target as HTMLSelectElement).value }) }); settingsCache = null; toast("Look quality updated"); });
  $<HTMLSelectElement>("#hero-quality")!.addEventListener("change", async (e) => { await api("/api/settings", { method: "PATCH", body: JSON.stringify({ hero_quality: (e.target as HTMLSelectElement).value }) }); settingsCache = null; toast("Cover quality updated"); });
  $$("[data-delpk]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Remove this passkey?")) return; await api(`/api/auth/passkeys/${encodeURIComponent((b as HTMLElement).dataset.delpk!)}`, { method: "DELETE" }); render(); }));
  $("#add-pk")!.addEventListener("click", async () => {
    try {
      const { options, challengeId } = await api("/api/auth/passkey/register/options", { method: "POST" });
      const response = await startRegistration({ optionsJSON: options });
      const name = navigator.userAgent.includes("iPhone") ? "iPhone" : navigator.userAgent.includes("Mac") ? "Mac" : navigator.userAgent.includes("Android") ? "Android" : "Device";
      await api("/api/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ challengeId, response, name }) });
      toast("Passkey added"); render();
    } catch (err: any) { if (err?.name !== "NotAllowedError") toast(err.message || "Could not add passkey", true); }
  });
}

// ---------- global handlers ----------
document.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("[data-action=logout]")) { await api("/api/auth/logout", { method: "POST" }); me = { authenticated: false }; settingsCache = null; navigate("/login", true); return; }
  const a = t.closest("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank" || a.hasAttribute("download") || a.origin !== location.origin) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const card = a.closest(".card[data-id]") as HTMLElement | null;
  if (card) return openViewer(card.dataset.id!, card);
  const piece = a.closest(".card[data-pid], a.paired") as HTMLElement | null;
  if (piece) { if (viewerEl) closeViewer(false); return openPiece(piece.dataset.pid ?? piece.getAttribute("href")!.slice(3)); }
  const href = a.getAttribute("href")!;
  if (href === location.pathname + location.search) return render();
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
  try {
    me = await api("/api/me");
    if (seq !== renderSeq) return;
    if (!me.authenticated) return path === "/login" ? viewLogin() : navigate("/login", true);
    if (path === "/login") return navigate("/", true);
    const m = path.match(/^\/g\/([A-Za-z0-9_-]+)$/);
    if (m) { if (!$("#closet-grid")) await viewLooks(); return openViewer(m[1], undefined, false); }
    const pm = path.match(/^\/p\/([A-Za-z0-9_-]+)$/);
    if (pm) { if (!$("#wardrobe")) await viewWardrobe(); return openPiece(pm[1], false); }
    if (viewerEl) closeViewer(false);
    if (pieceEl) closePiece(false);
    if (path === "/") return viewHome();
    if (path === "/looks") return viewLooks();
    if (path === "/closet") return viewWardrobe();
    if (path === "/add") return viewAdd();
    if (path === "/settings") return viewSettings();
    navigate("/", true);
  } catch (err: any) {
    if (err.message !== "unauthorized") { console.error(err); toast(err.message, true); }
  }
}
render();
