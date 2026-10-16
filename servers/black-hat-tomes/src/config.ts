// Where black-hat-tomes-mcp looks. LibGen is anonymous — there is no token to store —
// so configuration is just the two hostnames and the download folder, each
// overridable by an env var so tests can point the server at a fake.

import { homedir } from "node:os";
import { join } from "node:path";

/** The search API host (libgen.me). */
export function searchUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BLACK_HAT_TOMES_SEARCH_URL || "https://libgen.me").replace(/\/+$/, "");
}

/** The file host (libgen.download) that streams the actual bytes. */
export function downloadUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BLACK_HAT_TOMES_DOWNLOAD_URL || "https://libgen.download").replace(/\/+$/, "");
}

/** Where downloaded books land. */
export function downloadDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.BLACK_HAT_TOMES_DOWNLOAD_DIR || join(homedir(), "Documents", "ebooks");
}

/** The browser user agent LibGen expects; a bare curl/Node UA gets a different (worse) response. */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
