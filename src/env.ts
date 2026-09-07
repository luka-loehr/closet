export type Job = { kind: "look"; id: string } | { kind: "hero"; id: string };

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
  // secrets
  OPENAI_API_KEY: string;
  DAIRO_API_KEY: string;
};
