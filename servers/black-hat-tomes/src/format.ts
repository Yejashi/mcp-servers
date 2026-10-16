// LibGen records as short text for a model: one line per book, the id first,
// because everything a tool returns lands in the model's context. Pure, so it
// is unit-tested.

import type { Book } from "./client.js";

/** A content type to the extension the file gets. */
const EXT_BY_TYPE: Record<string, string> = {
  "application/epub+zip": "epub",
  "application/x-mobipocket-ebook": "mobi",
  "application/pdf": "pdf",
  "application/vnd.amazon.ebook": "azw3",
  "application/fb2+zip": "fb2",
  "application/x-fictionbook+xml": "fb2",
  "application/zip": "zip",
  "application/x-cbz": "cbz",
  "application/octet-stream": "bin",
};

/** The extension a content type maps to, or undefined when it is not one we know. */
export function extensionFor(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  return EXT_BY_TYPE[contentType.split(";")[0].trim().toLowerCase()];
}

/** A zip/epub local-file-header magic, the bytes every real EPUB starts with. */
export const PK_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** An extension from the first bytes when the content type is missing or generic. */
export function extFromMagic(head: Buffer): string | undefined {
  if (head.length >= 4 && head.subarray(0, 4).equals(PK_MAGIC)) return "epub";
  if (head.length >= 4 && head.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (head.length >= 4 && head.subarray(0, 4).toString("ascii") === "Book") return "mobi";
  return undefined;
}

/** "Brown, Pierce " (LibGen's "Last, First " with a trailing space) → "Pierce Brown". */
export function displayAuthor(author: string[]): string {
  return author
    .map((a) => {
      const t = (a ?? "").trim();
      const i = t.indexOf(",");
      if (i > 0) {
        const last = t.slice(0, i).trim();
        const first = t.slice(i + 1).trim();
        return first ? `${first} ${last}` : last;
      }
      return t;
    })
    .filter(Boolean)
    .join("; ");
}

export function formatSize(bytes: number | undefined): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** One line per book: what a model needs to pick one, and the id to act on it. */
export function bookLine(b: Book): string {
  const author = displayAuthor(b.author ?? []);
  const size = formatSize(b.fileSize);
  return `[${b.id}] ${b.title || "Untitled"}${author ? ` — ${author}` : ""} · ${b.language} ${b.fileExtension}${size ? ` ${size}` : ""}`;
}

/** A filename that is safe on every filesystem, capped so it stays readable. */
export function safeFilename(name: string, ext?: string): string {
  const stem = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "book";
  return ext ? `${stem}.${ext.replace(/^\./, "")}` : stem;
}
