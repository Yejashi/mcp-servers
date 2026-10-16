// The two BookFusion APIs this server talks to, and nothing else:
//
// - the user API (/api/user/*) the official KOReader plugin uses: library
//   search, shelves, series, highlights, download links. Bearer token from
//   the OAuth device login.
// - the Calibre API (/calibre-api/v1/*) the official Calibre plugin uses:
//   uploads and "is this file already there?". HTTP Basic with the user's
//   Calibre integration key.
//
// Neither is publicly documented; shapes follow those two plugins.

import { baseUrl, clientId } from "./config.js";

const ACCEPT = "application/json; api_version=10";
const TIMEOUT_MS = 60_000;
const USER_AGENT = "bookfusion-mcp";

export class BookFusionError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
  }
}

export interface Author {
  name?: string;
}

export interface BookFormat {
  content_type: string;
  download_size?: number;
}

export interface Book {
  id: number | string;
  title?: string;
  authors?: (string | Author)[];
  format?: string;
  formats?: BookFormat[];
  download_size?: number;
  language?: string;
  published_at?: string;
  summary?: string;
  series?: { title?: string; index?: number | string }[];
  reading_position?: { percentage?: number | string };
  cover?: { url?: string };
  tags?: (string | { name?: string })[];
  /** What the user may do with it; `export: false` means it cannot be downloaded. */
  permissions?: { export?: boolean; [k: string]: unknown };
  [key: string]: unknown;
}

export interface Page<T> {
  items: T[];
  page?: number;
  perPage?: number;
  total?: number;
}

export interface SearchParams {
  query?: string;
  list?: "currently_reading" | "favorites" | "planned_to_read" | "completed";
  bookshelf_id?: number | string;
  series_id?: number | string;
  sort?: string;
  page?: number;
  per_page?: number;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export type TokenPoll = { token: string } | { pending: "authorization_pending" | "slow_down" } | { failed: string };

/** Without undefined values, so they cannot override defaults when spread. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown, what: string): string {
  const detail = typeof body === "object" && body ? ((body as any).error_description ?? (body as any).error ?? (body as any).message) : typeof body === "string" ? body.slice(0, 200) : undefined;
  if (status === 401) return `BookFusion rejected the credentials for ${what} (401)${detail ? `: ${detail}` : ""}.`;
  return `${what} failed: HTTP ${status}${detail ? ` ${detail}` : ""}`;
}

export class BookFusion {
  constructor(
    private readonly creds: { token?: string; apiKey?: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = baseUrl(),
  ) {}

  get hasToken(): boolean {
    return Boolean(this.creds.token);
  }

  get hasApiKey(): boolean {
    return Boolean(this.creds.apiKey);
  }

  // ---------- user API ----------

  private async user(method: string, path: string, body?: unknown, auth = true): Promise<{ data: unknown; headers: Headers }> {
    if (auth && !this.creds.token) throw new BookFusionError(401, "Not logged in to BookFusion. Run the login tool (or `bookfusion-mcp login`) first.");
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        Accept: ACCEPT,
        "User-Agent": USER_AGENT,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(auth ? { Authorization: `Bearer ${this.creds.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await readBody(res);
    if (!res.ok) throw new BookFusionError(res.status, errorMessage(res.status, data, `${method} ${path}`), data);
    return { data, headers: res.headers };
  }

  private page<T>(data: unknown, headers: Headers): Page<T> {
    const num = (h: string) => {
      const v = Number(headers.get(h));
      return Number.isFinite(v) && headers.get(h) !== null ? v : undefined;
    };
    return { items: Array.isArray(data) ? (data as T[]) : [], page: num("current-page"), perPage: num("current-per-page"), total: num("total-count") };
  }

  async searchBooks(params: SearchParams): Promise<Page<Book>> {
    const { data, headers } = await this.user("POST", "/api/user/books/search", { sort: "added_at-desc", ...defined(params) });
    return this.page<Book>(data, headers);
  }

  async bookshelves(): Promise<{ id: number | string; name: string; [k: string]: unknown }[]> {
    const { data } = await this.user("POST", "/api/user/bookshelves/search", {});
    return Array.isArray(data) ? (data as any[]) : [];
  }

  async series(params: { query?: string; page?: number; per_page?: number } = {}): Promise<Page<{ id: number | string; title: string; [k: string]: unknown }>> {
    const { data, headers } = await this.user("POST", "/api/user/series/search", { sort: "title-asc", ...defined(params) });
    return this.page(data, headers);
  }

  async highlights(bookId: number | string): Promise<{ id: number | string; quote_text?: string; note?: string; color?: string; chapter_index?: number; [k: string]: unknown }[]> {
    const { data } = await this.user("POST", "/api/user/highlights/search", { book_id: bookId });
    return Array.isArray(data) ? (data as any[]) : [];
  }

  /** A short-lived, pre-signed link to the book file. */
  async downloadLink(bookId: number | string, contentType?: string): Promise<{ url: string; content_type?: string }> {
    try {
      const { data } = await this.user("POST", `/api/user/books/${encodeURIComponent(String(bookId))}/download`, contentType ? { content_type: contentType } : {});
      const d = data as any;
      if (!d?.url) throw new BookFusionError(502, "BookFusion returned no download link.");
      return { url: String(d.url), content_type: d.content_type ?? contentType };
    } catch (err) {
      if (err instanceof BookFusionError && err.status === 403) throw new BookFusionError(403, "This book is not available for download (BookFusion store books are read in their apps only).");
      if (err instanceof BookFusionError && err.status === 404) throw new BookFusionError(404, `Book ${bookId} is not in your library.`);
      throw err;
    }
  }

  // ---------- device login ----------

  async startDeviceLogin(): Promise<DeviceCode> {
    const { data } = await this.user("POST", "/api/user/auth/device", { client_id: clientId() }, false);
    return data as DeviceCode;
  }

  async pollDeviceLogin(deviceCode: string): Promise<TokenPoll> {
    try {
      const { data } = await this.user(
        "POST",
        "/api/user/auth/token",
        { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId(), device_code: deviceCode },
        false,
      );
      const token = (data as any)?.access_token;
      return token ? { token: String(token) } : { failed: "no access token in the response" };
    } catch (err) {
      const e = (err as BookFusionError).body as any;
      if (e?.error === "authorization_pending" || e?.error === "slow_down") return { pending: e.error };
      return { failed: String(e?.error ?? (err as Error).message) };
    }
  }

  // ---------- Calibre API (uploads) ----------

  private calibreAuth(): string {
    if (!this.creds.apiKey)
      throw new BookFusionError(401, "Uploading needs your BookFusion Calibre API key: Settings → Integrations → Calibre on bookfusion.com, then `bookfusion-mcp set-api-key` (or BOOKFUSION_API_KEY).");
    return "Basic " + Buffer.from(`${this.creds.apiKey}:`).toString("base64");
  }

  private async calibre(method: string, path: string, body?: FormData, query?: Record<string, string>): Promise<{ status: number; data: unknown }> {
    const url = new URL(this.base + "/calibre-api/v1" + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: this.calibreAuth(), "User-Agent": USER_AGENT, Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10 * TIMEOUT_MS),
    });
    const data = await readBody(res);
    return { status: res.status, data };
  }

  private fail(status: number, data: unknown, what: string): never {
    if (status === 401) throw new BookFusionError(401, "BookFusion rejected the Calibre API key. Create a new one under Settings → Integrations → Calibre and run `bookfusion-mcp set-api-key`.", data);
    if (status === 422) throw new BookFusionError(422, `${what}: ${(data as any)?.error ?? "rejected"}`, data);
    throw new BookFusionError(status, errorMessage(status, data, what), data);
  }

  /** The book already uploaded with this digest, if any. */
  async findUpload(digest: string): Promise<{ id: number | string; [k: string]: unknown } | undefined> {
    const { status, data } = await this.calibre("GET", `/uploads/${digest}`);
    if (status === 404) return undefined;
    if (status >= 300) this.fail(status, data, "Upload check");
    return data as any;
  }

  /** Books already uploaded with this ISBN. */
  async findUploadsByIsbn(isbn: string): Promise<{ id: number | string; title?: string }[]> {
    const { status, data } = await this.calibre("GET", "/uploads", undefined, { isbn });
    if (status === 404) return [];
    if (status >= 300) this.fail(status, data, "Upload check");
    return Array.isArray(data) ? (data as any[]) : [];
  }

  /** Upload quota and usage, as BookFusion reports it. */
  async limits(): Promise<Record<string, unknown>> {
    const { status, data } = await this.calibre("GET", "/limits");
    if (status >= 300) this.fail(status, data, "Limits");
    return (data ?? {}) as Record<string, unknown>;
  }

  async initUpload(filename: string, digest: string): Promise<{ url: string; params: Record<string, string> }> {
    const form = new FormData();
    form.append("filename", filename);
    form.append("digest", digest);
    const { status, data } = await this.calibre("POST", "/uploads/init", form);
    if (status >= 300) this.fail(status, data, "Upload init");
    const d = data as any;
    if (!d?.url || !d?.params) throw new BookFusionError(502, "BookFusion returned no upload target.");
    return { url: String(d.url), params: d.params };
  }

  /** POSTs the file to the storage URL from initUpload, with its signed fields first. */
  async putFile(target: { url: string; params: Record<string, string> }, file: Blob, filename: string): Promise<void> {
    const form = new FormData();
    for (const [k, v] of Object.entries(target.params)) form.append(k, String(v));
    form.append("file", file, filename);
    const res = await this.fetchImpl(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(30 * TIMEOUT_MS) });
    if (!res.ok) throw new BookFusionError(res.status, `Uploading the file to storage failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async finalizeUpload(key: string, digest: string, metadata: FormData): Promise<{ id: number | string; [k: string]: unknown }> {
    metadata.append("key", key);
    metadata.append("digest", digest);
    const { status, data } = await this.calibre("POST", "/uploads/finalize", metadata);
    if (status >= 300) this.fail(status, data, "Upload finalize");
    return data as any;
  }
}
