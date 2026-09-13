export type Job = { kind: "look"; id: string } | { kind: "hero"; id: string } | { kind: "studio"; id: string } | { kind: "hero_portrait"; id: string };

export type Env = {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  IMG?: ImagesBinding;
  JOBS: Queue<Job>;
  ALLOWED_EMAIL: string;
  RP_ID: string;
  ORIGIN: string;
  DAIRO_INBOX_ID: string;
  /** <team id>.<bundle id> of the iOS app, for native passkeys; empty without the app. */
  APPLE_APP_ID?: string;
  GEMINI_MODEL?: string;
  // secrets
  OPENAI_API_KEY: string;
  DAIRO_API_KEY: string;
  GEMINI_API_KEY?: string;
};
