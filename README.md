![closet banner](docs/assets/banner.png)

[![Runtime](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Framework](https://img.shields.io/badge/Hono-4-E36002?style=flat&logo=hono&logoColor=white)](https://hono.dev)
[![Language](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![iOS](https://img.shields.io/badge/iOS-26%20·%20SwiftUI-000000?style=flat&logo=swift&logoColor=white)](#3-ios-app)
[![Generator](https://img.shields.io/badge/OpenAI-gpt--image--2.5--flare-000000?style=flat&logo=openai&logoColor=white)](https://platform.openai.com/docs/guides/image-generation)
[![Analysis](https://img.shields.io/badge/Gemini-3.8%20Flash-4285F4?style=flat&logo=google&logoColor=white)](https://ai.google.dev/gemini-api/docs/structured-output)
[![Auth](https://img.shields.io/badge/auth-passkeys%20(WebAuthn)-1f6feb?style=flat)](https://simplewebauthn.dev)
[![Visibility](https://img.shields.io/badge/repo-private-6e7681?style=flat)](#10-security-and-license)

A private virtual try-on store at
[closet.lukaloehr.com](https://closet.lukaloehr.com) and on my iPhone.
Paste, drop, or photograph a product and the store answers with a
photorealistic image of me wearing that exact garment — in a white
cyclorama and in a dark studio. Campaign
covers on location (New York, a black-sand beach, a rooftop, …) rotate
on the landing page, with a 9:16 cut of each for the phone.

The closet also holds what I already own — shoes, jeans, tees — as
clean studio product shots, so a new piece can be tried on together
with my own sneakers instead of the base photo's.

I built the backend as one Cloudflare Worker: the Hono API, the
queue consumer that talks to OpenAI, the Gemini vision pass that fills
the form, WebP conversion through the Images binding, passkey and
email-code login, and a dependency-free TypeScript single-page client
served from the same Worker. Next to it sits a native SwiftUI iPhone
app that speaks the same API with the same session and passkeys. There
is no framework on the web client, no build step beyond one `esbuild`
bundle, and nothing runs outside Cloudflare except the image model.

## 1. What it does

Every garment you add becomes two **looks**, in a white studio and a dark studio. Each look is a single
`images/edits` call: the approved base full-body photo is the first
input, the garment photo the second, and the model is told to dress the
person in the garment and change only the background. Nothing about the
face is ever described in words — the base photo carries the identity.

| output | inputs | size | quality | wall time |
| --- | --- | ---: | --- | ---: |
| analysis (form + what is missing) | garment photo | — | Gemini 3.8 Flash, thinking off | ≈ 3 s |
| look (white · dark) | base photo + garment + paired pieces | 1152×1536 (3:4) | medium | ≈ 18 s each |
| studio shots of an owned piece (two views) | my phone photo | 1152×1536 | medium | ≈ 18 s each |
| campaign cover | base photo + 2–3 garments | 1920×1088 (16:9) | high | ≈ 30 s |
| phone cover | base photo + finished cover + its garments | 1088×1920 (9:16) | cover quality | ≈ 30 s |

Every image comes from `gpt-image-2.5-flare`. Times are from the
2026-09-10 benchmark of the look edit; covers scale with quality.

Adding a piece is two steps. The upload runs the analysis first: it
fills name, brand, category, up to three colours and a one-line
description, and lists which slots a complete fit still lacks (a tracksuit lacks
shoes; a hoodie lacks bottom and shoes). The form comes back
pre-filled; what the model could not recognise (usually the brand) is
left for me to type. For a try-on, each missing slot offers the pieces
I own in that slot, and the chosen ones are worn in every generated
look. Submit returns immediately and the grid shows skeleton cards
until the queue delivers.

> **Status: live since 2026-09-06; iPhone app since 2026-09-10.**
> Generation runs on a Cloudflare Queue, so a closed tab or a locked
> phone can no longer strand a look. Looks are generated once and never
> regenerated; a garment is the unit of work.

## 2. System

- One Worker serves the API under `/api/*`, images under `/img/*`, and
  the static client from `public/` with SPA fallback
  ([`wrangler.jsonc`](wrangler.jsonc)).
- Generation runs on the `closet-jobs` queue consumer in the same
  Worker ([`src/jobs.ts`](src/jobs.ts)): the HTTP layer inserts a
  `pending` row, enqueues `{ kind, id }`, returns `202`, and the client
  polls. Max concurrency 8, one message per batch, no retries — a failed
  look records its error instead of burning another call.
- The analysis pass ([`src/gemini.ts`](src/gemini.ts)) is one
  `generateContent` call with a response schema and `thinkingBudget: 0`,
  so it returns typed JSON in about three seconds. Without a
  `GEMINI_API_KEY` the form falls back to `gpt-5-mini` naming.
- Owned pieces live in the same `garments` table with `owned = 1`.
  They are photographed with the phone; the photo is never the product
  image. A `studio` job renders the piece alone on pure white: ghost
  mannequin for tops, flat lay for trousers and accessories, and for
  shoes two perspectives — an exact side profile and a three-quarter
  view of the pair. Looks store the `pairing` they were generated with.
- Campaign covers get an optional **phone cover**: `POST
  /api/hero/:id/portrait` recomposes a finished generated cover as 9:16
  from the base photo, the cover itself and its garments. Every render
  gets a new versioned key, so a retry never shows a cached old image.
  The iPhone home screen and narrow web screens prefer it.
- Every stored image is WebP: full size up to 2048 px at quality 86 plus
  a 640 px thumbnail for grids, converted at write time with the Images
  binding so serving is a plain R2 read with immutable cache headers
  ([`src/images.ts`](src/images.ts)). A 2.5 MB PNG cover becomes
  ~250 KB.
- Login is WebAuthn passkeys (`@simplewebauthn` v14, resident keys, user
  verification required) or a six-digit code e-mailed through Dairo from
  `closet@dairo.app`. Only `ALLOWED_EMAIL` gets a code; every other
  address is a silent no-op. A passkey can only be registered from an
  already authenticated session ([`src/auth.ts`](src/auth.ts)).
- Sessions are D1 rows behind an `HttpOnly`, `SameSite=Lax` cookie,
  60 days. Codes expire after 10 minutes, allow five guesses claimed
  atomically, and are capped globally (20 e-mails and 30 checks a day)
  as well as per client IP. Every browser mutation must carry this
  site's `Origin`; the static client ships a CSP,
  `frame-ancestors 'none'`, `nosniff` and a referrer policy
  (`public/_headers`).
- Spending is capped ([`src/budget.ts`](src/budget.ts)): analysis
  passes, image calls and covers are counted per UTC hour and day
  in the `spend` table. The API pre-checks before it enqueues and answers
  `429` with the reason; the queue consumer reserves right before the
  OpenAI call and marks a job over budget as `skipped` instead of
  calling out. Defaults: 60 image calls a day (24 an hour), 6 covers a
  day, 60 analyses a day. A `settings` row `limit_<kind>_<hour|day>`
  overrides a cap without a deploy.
- Nothing runs twice: a job is claimed with one conditional `UPDATE`
  (`started_at`), a commit flips `draft` with one conditional `UPDATE`
  so a double submit enqueues once, a variant exists at most once per
  garment and only one cover is pending at a time (both enforced by
  conditional `INSERT`s), and a studio re-render or phone cover is
  refused while one is in flight. The bulk wardrobe re-render needs
  `{ "confirm": "re-render all" }` and does at most 20 pieces.
- An hourly cron (`scheduled` in [`src/index.ts`](src/index.ts)) deletes
  abandoned drafts older than a day with their R2 objects, expired auth
  rows and stale counters, and marks jobs that never came back (looks,
  covers, studio shots, phone covers); the same sweep rides along on
  every upload.
- Garment ingestion accepts multipart upload, a data URL, or a public
  `https` URL (hostname checked against private ranges, redirects
  followed by hand, body capped at 12 MB while streaming). The image
  type is read from the bytes: only JPEG, PNG, WebP, GIF, HEIC and AVIF
  are stored.
- The web client is ~1100 lines of plain TypeScript
  ([`client/app.ts`](client/app.ts)): history-based routing with scroll
  restoration per entry (list pages stay alive under the viewers, back
  lands on the same card), a card grid that crossfades studio → dark on
  hover, a full-screen viewer that expands from the clicked card with a
  FLIP animation (`/g/:id`), and a flowing menu band for categories,
  brands, add, and campaign. While something generates, the grid is
  polled with backoff (4 → 12 s, paused while the tab is hidden, at most
  20 minutes) and reconciled in place: only a card whose state changed
  is replaced, without re-running the entrance animation.

## 3. iOS app

A native SwiftUI app in [`ios/`](ios/) for iOS 26, built from an
XcodeGen [`project.yml`](ios/project.yml) (bundle
`com.lukaloehr.closet`). It is a second client of the same Worker, not
a second backend: every screen calls `/api/*`, every image is an
`/img/*` read.

| tab | what it shows |
| --- | --- |
| Looks | Full-bleed phone covers crossfading every 10 s (swipe or tap the bars), New in, and a black browse band for categories, brands, the closet and campaign. A card zooms into its viewer: the two looks as pages with a segmented picker, what it was worn with, share, product link and delete in the toolbar menu. Press and hold a card to see the dark look. |
| Closet | Owned pieces grouped by family; the viewer pages between studio shot and detail (side and three-quarter for shoes), with re-render and remove. |
| Add | A plain form: Try on or I own this, then Choose photo, Take photo or Paste. The review form is pre-filled by the analysis, with category, colours, product link and complete-the-fit pickers from the closet; Generate or Discard in the toolbar. |
| Settings | Covers with their phone covers (make one, or all missing at once), new cover, reference photos and base photo, look and cover quality, today's budget, passkeys, log out. |

How it fits the backend:

- **Session.** The app keeps the same `closet_session` cookie in the
  shared cookie store. Native requests send no `Origin`, which the
  Worker's mutation check allows, while browsers still always send one.
- **Passkeys.** Native `ASAuthorization` passkeys for
  `closet.lukaloehr.com`, through the `webcredentials:` associated
  domain and
  [`public/.well-known/apple-app-site-association`](public/.well-known/apple-app-site-association).
  The assertion's origin is the website's, so the existing
  `@simplewebauthn` verification accepts it unchanged, and a passkey
  saved in Safari works in the app.
- **Images.** One `URLSession` with a 512 MB disk cache plus an
  in-memory `NSCache`; `/img/*` is immutable, so every image downloads
  once.
- **Polling.** While anything generates, the app refreshes in place with
  the web's backoff (4 → 12 s, at most 20 minutes) and resumes when it
  comes back to the foreground.

| File | Contents |
| --- | --- |
| `ClosetApp.swift` | App entry, root phases (loading, signed out, signed in), the four tabs. |
| `AppModel.swift` | Observable app state: session, settings, lists, polling, toasts. |
| `API.swift` | JSON and multipart requests, error mapping, the image cache session, base64url helpers. |
| `Models.swift` · `Taxonomy.swift` | Decodable API models and the Swift port of the slot and family rules. |
| `HomeView.swift` · `LooksView.swift` · `Viewers.swift` | Cover carousel, grids, look and piece viewers. |
| `AddView.swift` · `SettingsView.swift` | The add and review forms, camera; settings, new cover, references. |
| `Passkeys.swift` · `LoginView.swift` | Native passkey sign-in and registration; e-mail code login. |
| `Cards.swift` · `Components.swift` | Cards, cached remote images, navigation routes with zoom transitions. |

## 4. Architecture

```text
browser (client/app.ts, no framework)      iPhone (ios/, SwiftUI)
    |                                          |
    +-------------------+----------------------+
                        | same API, same session cookie, same passkeys
                        v
Cloudflare Worker — Hono router (src/index.ts)
    |
    +--> /api/auth/*       passkeys + email code, D1 sessions (src/auth.ts)
    |
    +--> /api/garments     upload / fetch / catalogue, enqueue 2 looks
    +--> /api/hero         enqueue a campaign cover or its phone cover
    |          |
    |          `--> Queue closet-jobs --> consumer (src/jobs.ts)
    |                                        |
    |                                        +--> OpenAI images/edits (src/openai.ts, src/prompts.ts)
    |                                        `--> WebP via Images binding --> R2 closet-images (src/images.ts)
    |
    +--> /img/*            R2 read, immutable cache, sandboxed
    `--> /*                static assets from public/ (SPA fallback, .well-known)
```

| Path | Contents |
| --- | --- |
| `src/index.ts` | Hono app: routing, origin check, garment ingestion, settings, references, looks, heroes and phone covers, image serving, hourly sweep. |
| `src/budget.ts` | Spend counters per UTC hour/day, `precheck`/`reserve`, the housekeeping sweep and the dead-job marker. |
| `src/auth.ts` | Email codes via Dairo, WebAuthn registration and login, session cookie, `requireAuth`. |
| `src/jobs.ts` | Queue consumer: `runLook`, `runStudio`, `runHero`, `runHeroPortrait`, base-reference resolution, R2 image loading. |
| `src/openai.ts` | `images/edits` client (multipart, base64 decode) and the `gpt-5-mini` fallback cataloguing call. |
| `src/gemini.ts` | The analysis pass: response schema, thinking off, slot logic for what a fit is missing. |
| `src/prompts.ts` | The prompt library: categories and slots, look prompt with pairing phrases, studio-shot prompt, seven campaign scenes, phone cover prompt. |
| `src/images.ts` | Image type sniffing, WebP conversion and thumbnailing through the Images binding; key bookkeeping for deletes. |
| `client/` | The single-page web client, bundled by `esbuild` into `public/app.js`. |
| `public/` | `index.html`, `styles.css`, `_headers`, the passkey association file, and the built bundle (ignored). |
| `ios/` | The SwiftUI iPhone app (see [section 3](#3-ios-app)). |
| `migrations/` | D1 schema: sessions, codes, challenges, passkeys, reference photos, garments, looks, heroes and phone covers, settings, spend. |
| `lab/` | The prompt experiments that produced the recipe (Node scripts). Never part of the runtime. |

## 5. Quickstart

Requires Node 20+, a Cloudflare account with Workers, D1, R2, Queues and
Images enabled, an OpenAI key with image access, and a Dairo API key for
the login e-mail. The iPhone app needs Xcode 26, XcodeGen and an Apple
developer team.

### Local

```bash
npm install
cp .dev.vars.example .dev.vars      # OPENAI_API_KEY, DAIRO_API_KEY, RP_ID=localhost, ORIGIN=http://localhost:8787
npm run migrate:local
npm run dev                          # esbuild bundle + wrangler dev on :8787
```

### Deploy

```bash
npm run typecheck
npm run migrate                      # apply new D1 migrations remotely
npm run deploy                       # bundle + wrangler deploy to closet.lukaloehr.com
```

### iPhone app

```bash
cd ios
xcodegen generate
xcodebuild -project Closet.xcodeproj -scheme Closet -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates -derivedDataPath build build
xcrun devicectl list devices         # find the connected iPhone
xcrun devicectl device install app --device <id> build/Build/Products/Debug-iphoneos/Closet.app
```

The team ID in `project.yml` must match the app ID in
`public/.well-known/apple-app-site-association`, or native passkeys will
not be offered. The app always talks to production
(`closet.lukaloehr.com`).

Secrets live in Wrangler, not in the config: `OPENAI_API_KEY`,
`DAIRO_API_KEY` (secret) and
`GEMINI_API_KEY` (an API key of the `google-cloud-project` Google Cloud project;
`gcloud services api-keys get-key-string` recovers it). The analysis
model is the plain var `GEMINI_MODEL`. Plain vars
(`ALLOWED_EMAIL`, `RP_ID`, `ORIGIN`, `DAIRO_INBOX_ID`) are in
[`wrangler.jsonc`](wrangler.jsonc).

First run: sign in with the e-mail code, upload the base full-body
photo under Settings → References, then add a garment.

## 6. HTTP API

All routes except login and `/img/*` require a session cookie.

| Method and path | Purpose |
| --- | --- |
| `GET /api/me` | Current session. |
| `POST /api/auth/email/start` · `…/verify` | Six-digit code login. |
| `POST /api/auth/passkey/login/options` · `…/verify` | Passkey login. |
| `POST /api/auth/passkey/register/options` · `…/verify` | Add a passkey to the signed-in account. |
| `GET` · `DELETE /api/auth/passkeys[/:id]` | List and remove passkeys. |
| `POST /api/auth/logout` | End the session. |
| `GET` · `PATCH /api/settings` | Base reference, image model/quality, taxonomy, budget. |
| `GET` · `POST` · `PATCH` · `DELETE /api/refs[/:id]` | Reference photos of the person. |
| `GET /api/garments?owned=0|1` | Try-on pieces or the wardrobe; drafts never list. |
| `POST /api/garments[?owned=1]` | Step 1: store the image, run the analysis, return a pre-filled draft. |
| `POST /api/garments/:id/commit` | Step 2: the reviewed form plus `pairing` per slot → two looks queued (`202`), or a wardrobe piece with its studio shot queued. |
| `GET` · `PATCH` · `DELETE /api/garments/:id` | One garment with its looks and paired pieces; edit metadata; delete with images (also discards a draft). |
| `POST /api/garments/:id/looks` | Enqueue a missing variant for a garment (`409` if it exists or is in flight), optionally with a `pairing`. |
| `POST /api/garments/:id/studio` · `POST /api/wardrobe/studio` | Re-render the studio views of one owned piece, or of every owned piece (needs `{ "confirm": "re-render all" }`, max 20). |
| `DELETE /api/looks/:id` | Remove one look. |
| `GET /api/heroes` · `POST /api/hero` · `DELETE /api/hero/:id` | Campaign covers: list, generate from 2–3 garments in a scene, delete. |
| `POST /api/heroes/upload` | Store a cover made elsewhere. |
| `POST /api/hero/:id/portrait` | Queue the 9:16 phone version of a generated cover (iPhone home screen, narrow web screens). |
| `GET /img/*` | Immutable image read from R2. |

## 7. The generation recipe

The recipe was settled on 2026-09-06 after a day in `lab/` and is the
only thing the model is asked to do:

1. **Identity comes from a photo, not from text.** The first input is
   always the approved base full-body photo. Face, hair, skin, pose,
   hands, framing are instructed to stay exactly as in that image.
2. **Garments are reproduced, not interpreted.** Colour, fabric, logos,
   cut are to be copied from the second image; a full outfit replaces
   top and trousers, a top replaces only the tee, trousers only the
   jeans, shoes only the shoes. Paired pieces from the wardrobe follow
   as images three onwards, each with a one-line slot instruction
   ("image 3 shows shoes: replace his shoes with exactly these shoes").
3. **The variant changes only the environment.** White keeps the studio
   as is; dark relights him in a charcoal studio with a rim light.
4. **Covers are the same person two or three times in one frame**, each
   in one garment, in one of seven scenes (NYC, beach, wheel, wall,
   rooftop, garage, studio), full bodies, wide landscape.
5. **A phone cover is the same shoot, recomposed.** The finished cover
   is an input next to the base photo and the garments; the figures are
   staggered in depth to fit 9:16, with a calm top and a face-free
   bottom for the wordmark.

Gemini was the first generator and was retired the same day: it could
not hold identity across variants without describing the face, and
describing the face drifted. The retired scripts stay in `lab/` for
history. The model moved from `gpt-image-2` to `gpt-image-2.5-flare`
on 2026-09-10 with the recipe unchanged.

## 8. Data and storage

| Store | Name | Holds |
| --- | --- | --- |
| D1 | `closet` | `garments`, `looks`, `heroes` (with phone cover columns), `reference_photos`, `settings`, `spend`, plus `sessions`, `email_codes`, `challenges`, `passkeys`. |
| R2 | `closet-images` | `garments/<id>.webp`, `studio/<id>.webp` (+ `-alt`), `looks/<id>.webp`, `hero/<id>.webp`, `hero/<id>-portrait-<t>.webp`, `refs/<id>` and their `.t.webp` thumbnails. |
| Queue | `closet-jobs` | `{ kind: "look" \| "studio" \| "hero" \| "hero_portrait", id }` messages, consumed in-Worker. |
| Images | binding `IMG` | Write-time WebP conversion; serving never touches it. |

A look row records its variant, model and quality tag, status
(`pending` → `done` / `error`), the exact prompt, and the generation
time in milliseconds, so every image on the site can be traced back to
the call that made it. Deleting a garment cascades to its looks and
removes every R2 object of theirs.

## 9. Decision record

Choices that shaped the current build, with the reason they stuck.

| decision | why |
| --- | --- |
| OpenAI `gpt-image-2` edits instead of Gemini generation | only path that kept identity without describing the face |
| `gpt-image-2.5-flare` for every image, looks at medium (2026-09-10) | benchmarked on the look edit: 17 s vs 21 s (Sunburst) and 35 s (gpt-image-2), half the cost of gpt-image-2, identity kept; preferred by eye, and medium over the five other quality modes |
| generation on a Queue, not in the request | a closed tab or a 30 s browser timeout used to strand looks mid-flight |
| no regenerate, no detail page | a card expands in place into its variants; looks are made once |
| WebP everywhere at write time | 10× smaller covers, grid thumbnails at 640 px, zero serving cost |
| hover crossfades studio → dark, no zoom | the zoom fought the FLIP expansion and looked like a stock template |
| plain uppercase text nav with a sliding underline | replaced a gooey-nav port that added weight without adding clarity |
| passkeys first, e-mail code as the bootstrap | one allowed address, no passwords to store, works from the phone |
| native SwiftUI app on the same API, not a second backend | one source of truth for sessions, budget and generation; the app is only a client |
| native iOS controls over the web's custom styles | forms, segmented pickers and toolbar menus read as an iPhone app; the custom buttons and chips made the add flow noisy |
| phone covers as a separate 9:16 render, on request | cropping a 16:9 cover to a phone cuts people out; generating one per cover only when asked keeps the cover cap intact |
| `max_retries: 0` on the queue | a failed edit costs real money; record the error and let a human decide |
| analysis before generation, Gemini Flash with thinking off | the form is filled and the missing slots known in ~3 s; nothing is generated until I have reviewed it |
| draft rows instead of holding the upload client-side | the image is uploaded once, and a discarded draft is a plain delete |
| one wardrobe table, not a second entity | an owned piece and a try-on piece share cataloguing, images and deletion; `owned` is a flag |
| hard spend caps in D1, checked twice | the API refuses early with a clear `429`; the consumer refuses again right before the call, so a stuck queue or a retry can never run up a bill |
| conditional `UPDATE`s and `INSERT`s instead of locks | a claim, a commit, a re-render, a new variant and a new cover each change one row with one statement; D1 has no transactions across requests, but a single statement is atomic |
| reconcile the grid, never replace it | replacing `innerHTML` every poll re-ran the card animation and made the page jump; keyed patching touches only what changed |
| scroll state in `history.state` | the viewers are overlays over a live list; closing one is a `popstate` onto the same route, which restores the scroll instead of re-rendering |

## 10. Security and license

The service is single-tenant by design: one allowed e-mail, resident
passkeys bound to `closet.lukaloehr.com` with user verification
required, `HttpOnly` `SameSite=Lax` sessions, an `Origin` check on
every browser mutation, login codes with atomically counted attempts
and global caps on e-mails and checks, login traffic capped per IP, a
CSP with `frame-ancestors 'none'` on the client, `noindex` on every
page, ids validated before they reach the database, and public-URL
fetches blocked from private address ranges with redirects followed by
hand. Uploads are typed by their bytes and only raster images are
stored; `/img/*` answers with a raster content type inside a
`sandbox` CSP. Error responses never carry internals. The iPhone app
uses HTTPS only, with no transport exceptions. Reference photos of the
person are stored only in R2 and are deliberately kept out of this
repository (`refs/` is ignored), as are the experiment outputs in
`lab/out/`.

This repository is private. All rights reserved; no license is granted
for reuse.
