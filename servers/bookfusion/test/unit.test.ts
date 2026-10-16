import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bookDigest } from "../src/digest";
import { bookLine, contentTypeFor, filenameFromUrl, highlightText, pickFormat, safeFilename } from "../src/library";
import { freePath, metadataForm } from "../src/transfer";
import { BOOKS } from "./fake";

describe("upload digest", () => {
  it("matches the Calibre plugin's Python formula byte for byte", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-digest-"));
    for (const [name, data] of [["empty.epub", Buffer.alloc(0)], ["small.epub", Buffer.from("hello epub")], ["big.epub", Buffer.alloc(3 * 1024 * 1024 + 17, 7)]] as const) {
      const f = join(dir, name);
      writeFileSync(f, data);
      // calculate_digest() from the plugin's upload_worker.py, verbatim in spirit.
      const py = `import sys,os\nfrom hashlib import sha256\nh=sha256()\nh.update(bytes(os.path.getsize(sys.argv[1])))\nh.update(b'\\0')\nh.update(open(sys.argv[1],'rb').read())\nprint(h.hexdigest())`;
      const want = execFileSync("python3", ["-I", "-c", py, f], { encoding: "utf8" }).trim();
      expect(await bookDigest(f)).toBe(want);
    }
  });
});

describe("library text", () => {
  it("puts the id, authors, formats, series and progress on one line", () => {
    expect(bookLine(BOOKS[0] as any)).toBe("[101] Dune — Frank Herbert · EPUB 1.1 MB, PDF 8.6 MB · Dune #1 · 42% read");
    expect(bookLine({ id: 5 })).toBe("[5] Untitled");
    expect(bookLine({ id: 6, title: "M", series: [{ title: "Mistborn", index: "1.0" }], tags: ["a", "b", "c", "d", "e", "f"], permissions: { export: false } })).toBe(
      "[6] M · Mistborn #1 · tags: a, b, c, d +2 · no download",
    );
  });

  it("picks the asked format if the book has it, else EPUB", () => {
    expect(pickFormat(BOOKS[0] as any, "pdf")).toBe("application/pdf");
    expect(pickFormat(BOOKS[0] as any)).toBe("application/epub+zip");
    expect(pickFormat(BOOKS[0] as any, "cbz")).toBeUndefined();
    expect(contentTypeFor(".EPUB")).toBe("application/epub+zip");
  });

  it("makes safe file names and reads them from storage URLs", () => {
    expect(safeFilename('Dune: Messiah / "2"?', "epub")).toBe("Dune Messiah 2.epub");
    expect(safeFilename("...", "pdf")).toBe("book.pdf");
    expect(filenameFromUrl("https://s3/x/dune.epub?X-Amz-Signature=1")).toBe("dune.epub");
    expect(filenameFromUrl("https://s3/x/abc?response-content-disposition=attachment%3B%20filename%3D%22Dune%20Messiah.epub%22")).toBe("Dune Messiah.epub");
    expect(filenameFromUrl("https://s3/x/abcdef")).toBeUndefined();
  });

  it("never overwrites a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-free-"));
    writeFileSync(join(dir, "a.epub"), "");
    expect(freePath(dir, "a.epub")).toBe(join(dir, "a (2).epub"));
  });

  it("formats highlights with their note and place", () => {
    expect(highlightText({ quote_text: "Fear is\nthe mind-killer.", note: "classic", chapter_index: 2, color: "yellow" })).toBe("> Fear is the mind-killer.\n  Note: classic\n  (ch. 3, yellow)");
  });

  it("sends metadata the way the Calibre plugin does", () => {
    const f = metadataForm({ title: "T", authors: ["A", "B"], tags: ["x"], bookshelves: ["Sci-Fi"], series: [{ title: "S", index: 2 }] });
    expect([...f.entries()].map(([k, v]) => `${k}=${v}`).slice(1)).toEqual([
      "metadata[title]=T",
      "metadata[series][][title]=S",
      "metadata[series][][index]=2",
      "metadata[author_list][]=A",
      "metadata[author_list][]=B",
      "metadata[tag_list][]=x",
      "metadata[bookshelves][]=",
      "metadata[bookshelves][]=Sci-Fi",
    ]);
  });
});
