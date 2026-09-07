import { startAuthentication, startRegistration, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";

// ---------- types ----------
type Look = { id: string; garment_id: string; variant: string; pose: string; model: string; status: string; r2_key: string | null; thumb_key: string | null; error: string | null; duration_ms: number | null; created_at: number };
type Garment = { id: string; name: string; brand: string | null; category: string | null; color: string | null; notes: string | null; source_url: string | null; r2_key: string; thumb_key: string | null; created_at: number; covers?: Record<string, Look>; looks?: Look[]; pending?: number };
type Hero = { id: string; r2_key: string | null; garment_ids: string[]; style: string; model: string; status: string; error: string | null; created_at: number };
type Settings = { model: string; look_quality: string; hero_quality: string; qualities: string[]; variants: string[]; hero_styles: string[]; base_ref: string | null; heroes: Hero[] };

const VARIANTS = ["white", "dark", "nature"] as const;
const VARIANT_LABEL: Record<string, string> = { white: "Studio", dark: "Dark", nature: "Nature" };
const QUALITY_LABEL: Record<string, string> = { medium: "Medium · ~40 s", high: "High · ~90 s" };
const STYLE_LABEL: Record<string, string> = { nyc: "New York", beach: "Volcanic beach", wheel: "Ferris wheel", wall: "White wall", rooftop: "Rooftop", garage: "Garage", studio: "Studio" };
const NAV = [{ href: "/", label: "New in", key: "home" }, { href: "/closet", label: "Closet", key: "closet" }, { href: "/settings", label: "Settings", key: "settings" }];

// ---------- utils ----------
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const img = (key: string | null | undefined) => (key ? `/img/${key}` : "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
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
function watchPending(garments: Garment[], redraw: (list: Garment[]) => void) {
  if (!garments.some((g) => g.pending)) return;
  const signal = viewAbort.signal;
  const tick = async () => {
    if (signal.aborted) return;
    try {
      const list = await api<Garment[]>("/api/garments?limit=200");
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
  const [settings, garments] = await Promise.all([getSettings(), api<Garment[]>("/api/garments?limit=200")]);
  const heroes = (settings.heroes ?? []).filter((h) => h.status === "done" && h.r2_key);
  const cats = Array.from(new Set(garments.map((g) => g.category).filter(Boolean))) as string[];
  const coverFor = (cat: string | null) => { const g = garments.find((x) => (cat ? x.category === cat : true) && x.covers?.white); return g ? img(g.covers!.white.r2_key) : ""; };
  const brands = Array.from(new Set(garments.map((g) => g.brand).filter(Boolean))) as string[];
  const brandCover = (b: string) => { const g = garments.find((x) => x.brand === b && x.covers?.white); return g ? img(g.covers!.white.r2_key) : ""; };
  const flowItems = [
    { href: "/closet", text: "Everything", count: String(garments.length), image: coverFor(null) },
    ...cats.slice(0, 5).map((c) => ({ href: `/closet?cat=${encodeURIComponent(c)}`, text: c + (c.endsWith("s") ? "" : "s"), count: String(garments.filter((g) => g.category === c).length), image: coverFor(c) })),
    ...brands.slice(0, 4).map((b) => ({ href: `/closet?brand=${encodeURIComponent(b)}`, text: b, count: String(garments.filter((g) => g.brand === b).length), image: brandCover(b) })),
    { href: "/add", text: "Add a piece", count: "paste · drop · url", image: garments[0] ? img(garments[0].r2_key) : "" },
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
      <div class="section-head"><h2>New in</h2><a href="/closet">View all</a></div>
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

// ---------- closet ----------
async function viewCloset() {
  const garments = await api<Garment[]>("/api/garments?limit=200");
  const cats = Array.from(new Set(garments.map((g) => g.category).filter(Boolean))) as string[];
  const params = new URLSearchParams(location.search);
  let filter = params.get("cat") ?? "";
  if (filter && !cats.includes(filter)) filter = "";
  const brand = params.get("brand") ?? "";
  setHeader("closet", false);
  await swap(`<main class="page">
    <div class="section-head"><h2>Closet · ${brand ? esc(brand) + " · " : ""}${garments.length}</h2><a href="/add">+ Add</a></div>
    <div class="filters"><button class="chip ${filter ? "" : "on"}" data-cat="">All</button>${cats.map((c) => `<button class="chip ${c === filter ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="grid" id="closet-grid"></div></main>`);
  const draw = () => {
    const list = garments.filter((g) => (!filter || g.category === filter) && (!brand || g.brand === brand));
    $("#closet-grid")!.innerHTML = list.length ? list.map(card).join("") : `<div class="empty-state" style="grid-column:1/-1"><h3>Empty</h3></div>`;
    $$(".filters .chip").forEach((c) => c.classList.toggle("on", (c as HTMLElement).dataset.cat === filter));
  };
  $$(".filters .chip").forEach((c) => c.addEventListener("click", () => { filter = (c as HTMLElement).dataset.cat!; history.replaceState(null, "", filter ? `/closet?cat=${encodeURIComponent(filter)}` : "/closet"); draw(); }));
  draw();
  watchPending(garments, (list) => { garments.splice(0, garments.length, ...list); draw(); });
}

// ---------- add flow ----------
let pendingImage: { file?: File; url?: string; dataUrl?: string } | null = null;

async function viewAdd() {
  const settings = await getSettings();
  setHeader("", false);
  await swap(`<main class="page">
    <div class="section-head"><h2>Add a piece</h2><span class="muted caps">${esc(settings.model)} · ${esc(settings.look_quality)}</span></div>
    <div id="add-stage">
      <div class="drop" id="drop" tabindex="0">
        <div><h3>Drop a product photo</h3><p>Paste with <kbd>⌘V</kbd> anywhere, drag an image here, or click to pick a file. A direct image URL works too.</p>
        <div class="urlrow" onclick="event.stopPropagation()"><input class="input" id="url" placeholder="https://…/jacket.jpg" /><button class="btn" id="url-go">Try on</button></div></div>
      </div>
      <input type="file" id="file" accept="image/*" hidden />
    </div></main>`);
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
  if (location.pathname !== "/add") { pendingImage = src; return navigate("/add"); }
  const stage = $("#add-stage")!;
  const preview = src.file ? URL.createObjectURL(src.file) : src.dataUrl ?? src.url ?? "";
  stage.innerHTML = `<div class="addwrap">
    <div><div class="source-tile"><img src="${esc(preview)}" alt="" /></div><div class="caps muted" style="margin-top:10px" id="add-name">Cataloguing…</div></div>
    <div><div class="gen-grid" id="gen-grid">${VARIANTS.map((v, i) => `<div class="card" style="--i:${i}"><div class="tile skeleton" data-v="${v}"><div class="status">${VARIANT_LABEL[v]} · generating</div></div><div class="info"><div class="name">${VARIANT_LABEL[v]}</div></div></div>`).join("")}</div>
      <div class="row" style="margin-top:20px" id="add-actions"></div></div>
  </div>`;
  let garment: Garment;
  try {
    if (src.file) { const fd = new FormData(); fd.append("file", src.file); garment = await api("/api/garments", { method: "POST", body: fd }); }
    else garment = await api("/api/garments", { method: "POST", body: JSON.stringify(src.url ? { url: src.url } : { data: src.dataUrl }) });
  } catch (err: any) {
    toast(err.message, true, 6000);
    stage.innerHTML = `<div class="empty-state"><h3>Could not read that image</h3><p>${esc(err.message)}</p><a class="btn" href="/add">Try again</a></div>`;
    return;
  }
  $("#add-name")!.textContent = [garment.brand, garment.name].filter(Boolean).join(" · ");
  $("#add-actions")!.innerHTML = `<a class="btn ghost" href="/closet">Open closet</a><a class="btn" href="/add">Add another</a><span class="muted" style="font-size:12px">Generation continues in the background; you can leave this page.</span>`;
  const queued = await Promise.all(VARIANTS.map((v) => api<Look>(`/api/garments/${garment.id}/looks`, { method: "POST", body: JSON.stringify({ variant: v }) }).catch((err) => { const t = $(`[data-v=${v}]`); if (t) { t.classList.remove("skeleton"); t.innerHTML = `<div class="status error">${esc(err.message)}</div>`; } return null; })));
  const ids = new Map(queued.filter(Boolean).map((l) => [l!.id, l!.variant]));
  const t0 = Date.now();
  const tiles = VARIANTS.map((v) => $(`[data-v=${v}]`)!);
  const tick = window.setInterval(() => tiles.forEach((t) => { const st = $(".status", t); if (st && t.classList.contains("skeleton")) st.textContent = `${VARIANT_LABEL[t.dataset.v!]} · generating · ${Math.round((Date.now() - t0) / 1000)} s`; }), 1000);
  while (ids.size && document.contains(tiles[0])) {
    await wait(3000);
    let g: Garment;
    try { g = await api<Garment>(`/api/garments/${garment.id}`); } catch { break; }
    for (const l of g.looks ?? []) {
      if (!ids.has(l.id) || l.status === "pending") continue;
      const tile = $(`[data-v=${l.variant}]`); ids.delete(l.id);
      if (!tile) continue;
      tile.classList.remove("skeleton");
      tile.innerHTML = l.status === "done" ? `<img class="reveal" src="${img(l.thumb_key ?? l.r2_key)}" alt="" />` : `<div class="status error">${esc(l.error || "failed")}</div>`;
    }
  }
  clearInterval(tick);
  if (document.contains(tiles[0]) && !ids.size) toast("Done. Saved to your closet.");
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
    else history.replaceState(null, "", "/closet");
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
    <div class="v-foot"><img class="srcmini" src="${img(g.thumb_key ?? g.r2_key)}" alt="" /><button class="v-del">Delete garment</button></div>
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
  $(".v-nav.prev", el)?.addEventListener("click", () => goTo(pos - 1));
  $(".v-nav.next", el)?.addEventListener("click", () => goTo(pos + 1));
  (el as any)._nav = (d: number) => goTo(pos + d);
  el.addEventListener("click", (e) => { if (e.target === el || (e.target as HTMLElement).classList.contains("v-row")) closeViewer(); });
  $(".v-del", el)!.addEventListener("click", async () => {
    if (!confirm(`Delete "${g.name}" and its looks?`)) return;
    await api(`/api/garments/${g.id}`, { method: "DELETE" });
    viewerId = null; closeViewer(false);
    navigate("/closet", true);
  });
}
document.addEventListener("keydown", (e) => {
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
      <p class="lead">Model: ${esc(settings.model)}. Every image is an edit of your base photo, stored as WebP.</p>
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
    if (m) { if (!$("#closet-grid")) await viewCloset(); return openViewer(m[1], undefined, false); }
    if (viewerEl) closeViewer(false);
    if (path === "/") return viewHome();
    if (path === "/closet") return viewCloset();
    if (path === "/add") return viewAdd();
    if (path === "/settings") return viewSettings();
    navigate("/", true);
  } catch (err: any) {
    if (err.message !== "unauthorized") { console.error(err); toast(err.message, true); }
  }
}
render();
