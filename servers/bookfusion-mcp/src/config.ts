// Where bookfusion-mcp keeps its credentials, and how the environment can
// override them. Credentials live in one file, mode 600, in a mode 700
// directory: the library token from the device login, and the Calibre API
// key that uploads need.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  /** Bearer token for /api/user/*, from the device login. */
  token?: string;
  /** Calibre integration key for /calibre-api/v1, for uploads. */
  apiKey?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOOKFUSION_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "bookfusion-mcp");
}

export function credentialsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "credentials.json");
}

export function downloadDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOOKFUSION_DOWNLOAD_DIR || join(homedir(), "Downloads", "BookFusion");
}

/** BookFusion only accepts registered OAuth clients; KOReader's is the one that works. */
export function clientId(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOOKFUSION_CLIENT_ID || "koreader";
}

export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BOOKFUSION_BASE_URL || "https://www.bookfusion.com").replace(/\/+$/, "");
}

/** Stored credentials, with BOOKFUSION_TOKEN / BOOKFUSION_API_KEY taking precedence. */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  let stored: Credentials = {};
  try {
    stored = JSON.parse(readFileSync(credentialsFile(env), "utf8"));
  } catch {
    stored = {};
  }
  return {
    token: env.BOOKFUSION_TOKEN || stored.token || undefined,
    apiKey: env.BOOKFUSION_API_KEY || stored.apiKey || undefined,
  };
}

/** Merges into the stored credentials; written atomically with mode 600. */
export function saveCredentials(patch: Credentials, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = credentialsFile(env);
  let current: Credentials = {};
  try {
    current = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    current = {};
  }
  const next: Credentials = { ...current, ...patch };
  for (const k of Object.keys(next) as (keyof Credentials)[]) if (!next[k]) delete next[k];
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return file;
}
