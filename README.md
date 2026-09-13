![closet banner](docs/assets/banner.png)

# closet – Your own virtual try-on store

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20iOS-green?style=flat)](#features)
[![OpenAI](https://img.shields.io/badge/OpenAI-gpt--image--2.5-000000?style=flat&logo=openai&logoColor=white)](https://platform.openai.com/docs/guides/image-generation)
[![License](https://img.shields.io/badge/License-AGPL--3.0-orange?style=flat)](LICENSE)

**closet** is a self-hosted virtual try-on store. Paste, drop, or photograph a product and get a photorealistic image of yourself wearing it. Runs as one Cloudflare Worker with a native SwiftUI iPhone app.

---

## Features

- **Try-on looks** of every garment in a white and a dark studio, generated from your own base photo
- **Your wardrobe** as clean studio shots, so new pieces can be tried on with things you already own
- **Automatic cataloguing**: name, brand, category and colours pre-filled from the photo
- **Campaign covers** on location, with a 9:16 version for the phone
- **Passkey login** for a single allowed e-mail, with e-mail codes as a fallback
- **Hard spend caps** per hour and day, so a stuck queue never runs up a bill
- **Native iPhone app** on the same API and session

---

## Deploy your own

You need a [Cloudflare](https://dash.cloudflare.com/sign-up) account (the free plan is enough; enable R2 once), an [OpenAI API key](https://platform.openai.com/api-keys), a [Dairo](https://dairo.app) API key and inbox for the login e-mail, and optionally a [Gemini API key](https://aistudio.google.com/apikey) for faster cataloguing.

```bash
git clone https://github.com/luka-loehr/closet.git && cd closet
npm install
npx wrangler login
npm run setup      # creates D1, R2 and the queue, writes wrangler.jsonc, applies migrations
npm run deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put DAIRO_API_KEY
npx wrangler secret put GEMINI_API_KEY     # optional
```

Open your hostname, sign in with the e-mail code, upload a full-body photo under **Settings → References**, and add a garment.

**iPhone app** (optional, needs Xcode 26, [XcodeGen](https://github.com/yonaskolb/XcodeGen) and an Apple Developer account): copy `ios/Config.example.xcconfig` to `ios/Config.xcconfig`, fill it in, run `xcodegen generate` in `ios/`, and set `APPLE_APP_ID` in `wrangler.jsonc` to `<team id>.<bundle id>`.

**Local development**: `cp .dev.vars.example .dev.vars`, then `npm run migrate:local && npm run dev`.

---

## License

GNU Affero General Public License v3.0 - [View License](LICENSE)  
The photos in `docs/assets/` and the app icon are not licensed for reuse.

---

## Support

- [Report bugs](https://github.com/luka-loehr/closet/issues)  
- Security issues: report privately via [GitHub security advisories](https://github.com/luka-loehr/closet/security/advisories/new)

---

Developed by [Luka Löhr](https://github.com/luka-loehr)
