// One-time setup for your own Cloudflare account: creates the D1 database, R2 bucket and queue,
// writes wrangler.jsonc (gitignored) from wrangler.example.jsonc and applies the migrations.
// usage: npx wrangler login && npm run setup
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = "") => (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def;
const wrangler = (args, opts = {}) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, CI: "true" }, ...opts });
// Wrangler can print status lines before --json output, so parse from the first bracket.
const wranglerJson = (args) => { const out = wrangler(args); return JSON.parse(out.slice(out.search(/[[{]/))); };
const tryWrangler = (args) => {
  try { return { ok: true, out: wrangler(args) }; } catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
};

if (existsSync("wrangler.jsonc") && (await ask("wrangler.jsonc already exists. Overwrite? (y/N)", "n")).toLowerCase() !== "y") {
  console.log("Keeping the existing wrangler.jsonc.");
  process.exit(0);
}

const who = tryWrangler(["whoami"]);
if (!who.ok || /not authenticated/i.test(who.out)) {
  console.error("Wrangler is not logged in. Run `npx wrangler login` first.");
  process.exit(1);
}

const config = JSON.parse(readFileSync("wrangler.example.jsonc", "utf8"));
const email = await ask("The one e-mail address allowed to sign in");
if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("that is not an e-mail address");
const host = (await ask("Hostname to serve on (a custom domain on your Cloudflare zone, or <name>.<subdomain>.workers.dev)")).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!host.includes(".")) throw new Error("that is not a hostname");
const inbox = await ask("Dairo inbox id for the login e-mail");
const appleAppId = await ask("Apple app id for iOS passkeys, <TEAMID>.<bundle id> (leave empty without the iPhone app)");

if (host.endsWith(".workers.dev")) {
  delete config.routes;
  config.workers_dev = true;
} else {
  config.routes = [{ pattern: host, custom_domain: true }];
}
Object.assign(config.vars, { ALLOWED_EMAIL: email, RP_ID: host, ORIGIN: `https://${host}`, DAIRO_INBOX_ID: inbox, APPLE_APP_ID: appleAppId });

// D1: reuse a database named closet, or create it.
const dbName = config.d1_databases[0].database_name;
let db = wranglerJson(["d1", "list", "--json"]).find((d) => d.name === dbName);
if (!db) {
  console.log(`Creating D1 database ${dbName} …`);
  wrangler(["d1", "create", dbName]);
  db = wranglerJson(["d1", "list", "--json"]).find((d) => d.name === dbName);
}
if (!db?.uuid) throw new Error(`could not find the D1 database ${dbName}`);
config.d1_databases[0].database_id = db.uuid;

for (const [what, args] of [
  ["R2 bucket", ["r2", "bucket", "create", config.r2_buckets[0].bucket_name]],
  ["queue", ["queues", "create", config.queues.producers[0].queue]],
]) {
  const r = tryWrangler(args);
  if (r.ok) console.log(`Created ${what} ${args.at(-1)}.`);
  else if (/already exists|already taken|code: 10004|11009/i.test(r.out)) console.log(`${what} ${args.at(-1)} already exists.`);
  else throw new Error(`creating the ${what} failed:\n${r.out}`);
}

writeFileSync("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
console.log("Wrote wrangler.jsonc.");

console.log("Applying D1 migrations …");
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", dbName, "--remote"], { stdio: "inherit" });
rl.close();

console.log(`
Done. Next:
  npm run deploy
  npx wrangler secret put OPENAI_API_KEY
  npx wrangler secret put DAIRO_API_KEY
  npx wrangler secret put GEMINI_API_KEY     # optional, the analysis pass

Then open https://${host}, sign in with the e-mail code, and upload your base full-body photo under Settings → References.`);
