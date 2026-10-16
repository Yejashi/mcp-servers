// Where example-mcp keeps its credentials and how the environment overrides
// them. One file, mode 600, in a mode 700 directory under ~/.config. Never
// read secrets from a file inside the repo.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  token?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.EXAMPLE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "example-mcp");
}

export function credentialsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "credentials.json");
}

/** Overridable so tests can point the server at a fake. */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.EXAMPLE_BASE_URL || "https://api.example.com").replace(/\/+$/, "");
}

/** Stored credentials, with EXAMPLE_TOKEN taking precedence. */
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  let stored: Credentials = {};
  try {
    stored = JSON.parse(readFileSync(credentialsFile(env), "utf8"));
  } catch {
    stored = {};
  }
  return { token: env.EXAMPLE_TOKEN || stored.token || undefined };
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
