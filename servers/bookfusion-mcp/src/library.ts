// Turning BookFusion records into compact text for a model, and the file
// formats both sides understand. Pure, so it is unit-tested.

import type { Book, BookFormat } from "./client.js";

/** Content types BookFusion stores, by the extension a file gets. */
export const FORMATS: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
  fb2: "application/x-fictionbook+xml",
  djvu: "image/vnd.djvu",
};

const EXT_BY_TYPE = Object.fromEntries(Object.entries(FORMATS).map(([ext, type]) => [type, ext]));

/** What upload_book accepts: ebook files only, never arbitrary local files. */
export const UPLOADABLE = new Set([...Object.keys(FORMATS), "azw", "cb7", "txt", "rtf", "docx"]);

export function extensionFor(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  return EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()];
}

/** A content type from "epub", ".epub" or a content type itself. */
export function contentTypeFor(format: string | undefined): string | undefined {
  if (!format) return undefined;
  const f = format.trim().toLowerCase().replace(/^\./, "");
  return FORMATS[f] ?? (f.includes("/") ? f : undefined);
}

export function authorNames(book: Book): string[] {
  return (book.authors ?? []).map((a) => (typeof a === "string" ? a : a?.name ?? "")).filter(Boolean);
}

export function formatSize(bytes: number | undefined): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatsOf(book: Book): BookFormat[] {
  return book.formats?.length ? book.formats : book.format ? [{ content_type: contentTypeFor(book.format) ?? book.format, download_size: book.download_size }] : [];
}

/** One line per book: what a model needs to pick one, and the id to act on it. */
export function bookLine(book: Book): string {
  const parts: string[] = [];
  const authors = authorNames(book);
  parts.push(`[${book.id}] ${book.title || "Untitled"}${authors.length ? ` — ${authors.join(", ")}` : ""}`);
  const formats = formatsOf(book)
    .map((f) => [extensionFor(f.content_type)?.toUpperCase() ?? f.content_type, formatSize(f.download_size)].filter(Boolean).join(" "))
    .filter(Boolean);
  if (formats.length) parts.push(formats.join(", "));
  const series = (book.series ?? []).filter((s) => s.title).map((s) => (s.index !== undefined && s.index !== null ? `${s.title} #${Number(s.index) || s.index}` : s.title!));
  if (series.length) parts.push(series.join("; "));
  const pct = Number(book.reading_position?.percentage);
  if (Number.isFinite(pct) && pct > 0) parts.push(`${Math.round(pct)}% read`);
  if (book.published_at) parts.push(String(book.published_at).slice(0, 4));
  if (book.language) parts.push(book.language);
  const tags = (book.tags ?? []).map((t) => (typeof t === "string" ? t : t?.name ?? "")).filter(Boolean);
  if (tags.length) parts.push(`tags: ${tags.slice(0, 4).join(", ")}${tags.length > 4 ? ` +${tags.length - 4}` : ""}`);
  if (book.permissions?.export === false) parts.push("no download");
  return parts.join(" · ");
}

/**
 * The format to download: the one asked for if the book has it, else EPUB,
 * else whatever the book has first.
 */
export function pickFormat(book: Book | undefined, wanted?: string): string | undefined {
  const want = contentTypeFor(wanted);
  const have = book ? formatsOf(book).map((f) => f.content_type) : [];
  if (want && (!have.length || have.includes(want))) return want;
  if (want && have.length) return undefined;
  return have.includes(FORMATS.epub) ? FORMATS.epub : have[0];
}

/** A filename that is safe on every OS and keeps the title readable. */
export function safeFilename(title: string, ext: string | undefined): string {
  const base =
    title
      .normalize("NFC")
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .slice(0, 150)
      .trim() || "book";
  return ext ? `${base}.${ext}` : base;
}

/** The filename a pre-signed storage URL carries, if it carries one. */
export function filenameFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const disp = u.searchParams.get("response-content-disposition");
    const m = disp && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
    if (m) return decodeURIComponent(m[1]);
    const last = decodeURIComponent(u.pathname.split("/").pop() ?? "");
    return /\.[a-z0-9]{2,5}$/i.test(last) ? last : undefined;
  } catch {
    return undefined;
  }
}

export interface Highlight {
  quote_text?: string;
  note?: string;
  color?: string;
  chapter_index?: number;
}

export function highlightText(h: Highlight): string {
  const quote = (h.quote_text ?? "").trim();
  const note = (h.note ?? "").trim();
  const where = typeof h.chapter_index === "number" ? `ch. ${h.chapter_index + 1}` : undefined;
  return [`> ${quote.replace(/\n+/g, " ") || "(image or area highlight)"}`, note ? `  Note: ${note}` : undefined, where || h.color ? `  (${[where, h.color].filter(Boolean).join(", ")})` : undefined]
    .filter(Boolean)
    .join("\n");
}
