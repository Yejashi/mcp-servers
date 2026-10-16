// Downloading a book to disk and uploading one from disk.

import { createWriteStream, existsSync, mkdirSync, openAsBlob, renameSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { BookFusion, BookFusionError } from "./client.js";
import { bookDigest } from "./digest.js";
import { extensionFor, filenameFromUrl, safeFilename, UPLOADABLE } from "./library.js";

/** A path in `dir` that does not exist yet: "Title.epub", "Title (2).epub", ... */
export function freePath(dir: string, filename: string): string {
  const ext = extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let n = 1; ; n++) {
    const p = join(dir, n === 1 ? filename : `${stem} (${n})${ext}`);
    if (!existsSync(p) && !existsSync(p + ".part")) return p;
  }
}

export async function downloadBook(
  bf: BookFusion,
  opts: { bookId: string | number; contentType?: string; title?: string; dir: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ path: string; bytes: number; contentType?: string }> {
  const link = await bf.downloadLink(opts.bookId, opts.contentType);
  const res = await fetchImpl(link.url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new BookFusionError(res.status, `Downloading the file failed: HTTP ${res.status}.`);
  const type = link.content_type ?? res.headers.get("content-type") ?? undefined;
  const ext = extensionFor(type);
  const fromUrl = filenameFromUrl(link.url);
  const name = opts.title ? safeFilename(opts.title, ext ?? (fromUrl ? extname(fromUrl).slice(1) : undefined)) : fromUrl ? safeFilename(fromUrl.replace(/\.[^.]+$/, ""), extname(fromUrl).slice(1)) : safeFilename(`bookfusion-${opts.bookId}`, ext);
  mkdirSync(opts.dir, { recursive: true });
  const path = freePath(resolve(opts.dir), name);
  const part = path + ".part";
  try {
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(part, { flags: "wx" }));
    renameSync(part, path);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
  return { path, bytes: statSync(path).size, contentType: type };
}

export interface UploadMeta {
  title?: string;
  authors?: string[];
  tags?: string[];
  bookshelves?: string[];
  series?: { title: string; index?: number }[];
  summary?: string;
  language?: string;
  isbn?: string;
  issuedOn?: string;
  coverPath?: string;
}

/** The multipart metadata fields, as the Calibre plugin sends them. */
export function metadataForm(meta: UploadMeta & { title: string }): FormData {
  const form = new FormData();
  // The plugin's digest of the metadata, so a later identical sync is a no-op.
  const digest = createHash("sha256").update(JSON.stringify({ ...meta, coverPath: undefined })).digest("hex");
  form.append("metadata[calibre_metadata_digest]", digest);
  form.append("metadata[title]", meta.title);
  if (meta.summary) form.append("metadata[summary]", meta.summary);
  if (meta.language) form.append("metadata[language]", meta.language);
  if (meta.isbn) form.append("metadata[isbn]", meta.isbn);
  if (meta.issuedOn) form.append("metadata[issued_on]", meta.issuedOn);
  for (const s of meta.series ?? []) {
    form.append("metadata[series][][title]", s.title);
    if (s.index !== undefined) form.append("metadata[series][][index]", String(s.index));
  }
  for (const a of meta.authors ?? []) form.append("metadata[author_list][]", a);
  for (const t of meta.tags ?? []) form.append("metadata[tag_list][]", t);
  if (meta.bookshelves) {
    // An empty first entry, as the plugin sends: the list replaces the book's shelves.
    form.append("metadata[bookshelves][]", "");
    for (const b of meta.bookshelves) form.append("metadata[bookshelves][]", b);
  }
  return form;
}

/**
 * `uploadId` is the Calibre API's record; `bookId`, once BookFusion has
 * processed the file, is the library id the other tools take.
 */
export type UploadResult = { status: "uploaded" | "exists"; uploadId: string | number; bookId?: string | number; title?: string };

/** The library book a just-finished upload became, found by title among the newest books. */
export async function findUploadedBook(bf: BookFusion, title: string, tries = 4, waitMs = 4000): Promise<string | number | undefined> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (let i = 0; i < tries; i++) {
    const page = await bf.searchBooks({ query: title, per_page: 10, sort: "added_at-desc" }).catch(() => undefined);
    const hit = page?.items.find((b) => norm(b.title ?? "") === norm(title));
    if (hit) return hit.id;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return undefined;
}

export async function uploadBook(bf: BookFusion, path: string, meta: UploadMeta = {}): Promise<UploadResult> {
  const abs = resolve(path);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isFile()) throw new BookFusionError(400, `${abs} is not a file.`);
  const ext = extname(abs).slice(1).toLowerCase();
  if (!UPLOADABLE.has(ext)) throw new BookFusionError(400, `Only ebook files can be uploaded (${[...UPLOADABLE].join(", ")}); ${basename(abs)} is not one.`);
  const digest = await bookDigest(abs);
  // The same file uploaded before, or (like the Calibre plugin) the same ISBN.
  const existing = (await bf.findUpload(digest)) ?? (meta.isbn ? (await bf.findUploadsByIsbn(meta.isbn))[0] : undefined);
  if (existing) {
    const title = (existing as any).title ?? meta.title;
    return { status: "exists", uploadId: existing.id, title, bookId: title && bf.hasToken ? await findUploadedBook(bf, title, 1) : undefined };
  }
  const filename = basename(abs);
  const target = await bf.initUpload(filename, digest);
  await bf.putFile(target, await openAsBlob(abs), filename);
  const title = meta.title?.trim() || filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
  const form = metadataForm({ ...meta, title });
  if (meta.coverPath) form.append("metadata[cover]", await openAsBlob(resolve(meta.coverPath)), basename(meta.coverPath));
  const key = target.params.key;
  if (!key) throw new BookFusionError(502, "BookFusion's upload target had no key to finalize with.");
  const done = await bf.finalizeUpload(key, digest, form);
  return { status: "uploaded", uploadId: done.id, title, bookId: bf.hasToken ? await findUploadedBook(bf, title) : undefined };
}
