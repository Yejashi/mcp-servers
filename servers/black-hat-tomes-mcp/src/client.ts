// The only module that knows LibGen's HTTP routes. It returns only the fields
// the tools use, and never puts a credential into an error message (there is
// none — LibGen is anonymous).

import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadUrl, searchUrl, USER_AGENT } from "./config.js";
import { extFromMagic, extensionFor, PK_MAGIC, safeFilename } from "./format.js";

const SEARCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
/** Below this a "book" is a stub or an ADS page, not a real file. */
export const MIN_BYTES = 50_000;

export class LibGenError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface Book {
  id: string;
  title: string;
  author: string[];
  year?: number;
  language: string;
  fileExtension: string;
  fileSize: number;
}

export interface SearchResult {
  books: Book[];
  total?: number;
}

export interface Downloaded {
  path: string;
  bytes: number;
  ext: string;
}

/** A path in `dir` that does not exist yet: "Title.epub", "Title (2).epub", … */
function freePath(dir: string, filename: string): string {
  const ext = extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let n = 1; ; n++) {
    const p = join(dir, n === 1 ? filename : `${stem} (${n})${ext}`);
    if (!existsSync(p)) return p;
  }
}

export class LibGenClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly searchBase = searchUrl(),
    private readonly downloadBase = downloadUrl(),
  ) {}

  /**
   * LibGen's search. `query` is fuzzy and ranks exact matches first; `from`
   * is a 0-based offset into a fixed 100-per-page result set.
   */
  async searchBooks(params: { query: string; from?: number }): Promise<SearchResult> {
    const url = new URL(this.searchBase + "/api/search/by-params");
    url.searchParams.set("query", params.query);
    url.searchParams.set("collection", "books");
    if (params.from) url.searchParams.set("from", String(params.from));
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new LibGenError(res.status, `LibGen search failed: HTTP ${res.status}. Try again, or try a different query.`);
    const data = (await res.json()) as any;
    const books: Book[] = Array.isArray(data?.result?.books) ? data.result.books : [];
    return { books, total: typeof data?.result?.total === "number" ? data.result.total : undefined };
  }

  /**
   * Streams the book to `dir` and verifies it before it counts as a success.
   * The listed extension can lie, so the file's real bytes decide: a zip/epub
   * must start with the PK magic, and nothing under MIN_BYTES is a book.
   */
  async download(id: string, opts: { title?: string; author?: string; dir: string }): Promise<Downloaded> {
    const url = new URL(this.downloadBase + "/api/download");
    url.searchParams.set("id", id);
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) throw new LibGenError(res.status, `Download failed: HTTP ${res.status}. Pick another id from search.`);

    const dir = resolve(opts.dir);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.black-hat-tomes-${id}-${process.pid}.part`);
    try {
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp, { flags: "wx" }));
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }

    const bytes = statSync(tmp).size;
    const fd = openSync(tmp, "r");
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    closeSync(fd);

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("text/html")) {
      rmSync(tmp, { force: true });
      throw new LibGenError(0, `id ${id} returned an HTML page (ADS or error), not a book. Pick another id from search.`);
    }
    const ext = extensionFor(contentType) ?? extFromMagic(head) ?? "bin";
    // A file that claims to be a zip/epub but does not start with PK is an
    // ADS page or a corrupt stream, not a book.
    if (ext === "epub" && !head.subarray(0, 4).equals(PK_MAGIC)) {
      rmSync(tmp, { force: true });
      throw new LibGenError(0, `id ${id} is not a valid EPUB (no zip header); the entry is an ADS page or corrupt. Pick another id from search.`);
    }
    if (bytes < MIN_BYTES) {
      rmSync(tmp, { force: true });
      throw new LibGenError(0, `id ${id} is only ${bytes} bytes; likely a stub or ADS page. Pick another id from search.`);
    }

    const name = opts.title
      ? safeFilename(opts.author ? `${opts.title} - ${opts.author}` : opts.title, ext)
      : safeFilename(`black-hat-tomes-${id}`, ext);
    const path = freePath(dir, name);
    renameSync(tmp, path);
    return { path, bytes, ext };
  }
}
