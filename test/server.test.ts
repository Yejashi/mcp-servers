// End to end: the built server over stdio, driven by the MCP SDK's own
// client, against the fake BookFusion. Run `npm run build` first (npm test
// does it through pretest).

import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFake } from "./fake";

type Fake = Awaited<ReturnType<typeof startFake>>;

async function connect(env: Record<string, string>) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(__dirname, "..", "dist", "cli.js")], env: { PATH: process.env.PATH ?? "", ...env } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { text: r.content.map((c: any) => c.text).join("\n") as string, isError: Boolean(r.isError) };
  };
  return { client, call };
}

describe("bookfusion-mcp over stdio", () => {
  let fake: Fake;
  let cfg: string;
  let downloads: string;
  let s: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    fake = await startFake();
    cfg = mkdtempSync(join(tmpdir(), "bf-cfg-"));
    downloads = mkdtempSync(join(tmpdir(), "bf-dl-"));
    s = await connect({ BOOKFUSION_BASE_URL: fake.base, BOOKFUSION_CONFIG_DIR: cfg, BOOKFUSION_DOWNLOAD_DIR: downloads });
  });
  afterAll(async () => {
    await s?.client.close();
    await fake?.close();
  });

  it("offers the tools, with read-only ones marked", async () => {
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["auth_status", "download_book", "get_highlights", "list_books", "list_series", "list_shelves", "login", "upload_book"]);
    expect(tools.find((t) => t.name === "list_books")!.annotations?.readOnlyHint).toBe(true);
  });

  it("says how to log in before it is, then logs in with the device code", async () => {
    const before = await s.call("list_books");
    expect(before.isError).toBe(true);
    expect(before.text).toMatch(/Not logged in/);
    const started = await s.call("login");
    expect(started.text).toContain("ABCD-1234");
    let status = "";
    for (let i = 0; i < 50 && !/Library: logged in/.test(status); i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await s.call("auth_status")).text;
    }
    expect(status).toMatch(/Library: logged in/);
    const saved = JSON.parse(readFileSync(join(cfg, "credentials.json"), "utf8"));
    expect(saved.token).toBe(fake.token);
    expect(statSync(join(cfg, "credentials.json")).mode & 0o777).toBe(0o600);
  });

  it("lists, searches and filters books", async () => {
    const all = await s.call("list_books");
    expect(all.text.split("\n")).toEqual(["2 books; page 1", "[101] Dune — Frank Herbert · EPUB 1.1 MB, PDF 8.6 MB · Dune #1 · 42% read", "[102] A Store Book — Someone · EPUB"]);
    expect((await s.call("list_books", { query: "nothing" })).text).toBe('No books match "nothing".');
    // A query is ranked by relevance: no sort is forced on it.
    expect(JSON.parse(fake.calls.filter((c) => c.path === "/api/user/books/search").at(-1)!.body.toString()).sort).toBeUndefined();
    await s.call("list_books", { shelf: "sci" });
    const sent = JSON.parse(fake.calls.filter((c) => c.path === "/api/user/books/search").at(-1)!.body.toString());
    expect(sent).toMatchObject({ bookshelf_id: 7, page: 1, per_page: 25, sort: "added_at-desc" });
    expect((await s.call("list_shelves")).text).toBe("[7] Sci-Fi (1)");
    expect((await s.call("list_series")).text).toBe("[3] Dune (1)");
  });

  it("downloads a book without overwriting, and explains a store book", async () => {
    const a = await s.call("download_book", { book_id: 101, title: "Dune" });
    expect(a.text).toBe(`Saved ${join(downloads, "Dune.epub")} (10 B, EPUB).`);
    expect(readFileSync(join(downloads, "Dune.epub"), "utf8")).toBe("EPUB-BYTES");
    const b = await s.call("download_book", { book_id: 101, title: "Dune", format: "pdf" });
    expect(b.text).toBe(`Saved ${join(downloads, "Dune.pdf")} (10 B, PDF).`);
    expect(JSON.parse(fake.calls.filter((c) => c.path.endsWith("/download")).at(-1)!.body.toString())).toEqual({ content_type: "application/pdf" });
    const c = await s.call("download_book", { book_id: 101, title: "Dune" });
    expect(c.text).toContain(join(downloads, "Dune (2).epub"));
    const store = await s.call("download_book", { book_id: 102 });
    expect(store.isError).toBe(true);
    expect(store.text).toMatch(/not available for download/);
  });

  it("reads highlights", async () => {
    expect((await s.call("get_highlights", { book_id: 101 })).text).toBe("1 highlight\n\n> Fear is the mind-killer.\n  Note: classic\n  (ch. 1, yellow)");
  });

  it("needs the API key to upload, then uploads once and dedupes the second time", async () => {
    const book = join(downloads, "My Book.epub");
    writeFileSync(book, "a real epub, honestly");
    const noKey = await s.call("upload_book", { path: book });
    expect(noKey.isError).toBe(true);
    expect(noKey.text).toMatch(/Calibre API key/);

    // Logged in (token saved by the login test) and with the upload key.
    const s2 = await connect({ BOOKFUSION_BASE_URL: fake.base, BOOKFUSION_CONFIG_DIR: cfg, BOOKFUSION_API_KEY: fake.apiKey });
    try {
      const up = await s2.call("upload_book", { path: book, authors: ["Me"], bookshelves: ["Sci-Fi"] });
      expect(up.text).toBe("Uploaded: [5001] My Book is in the library.");
      const storage = fake.calls.find((c) => c.path === "/storage/upload")!;
      expect(storage.body.toString()).toMatch(/name="key"\r\n\r\nuploads\/abc[\s\S]*name="file"; filename="My Book.epub"[\s\S]*a real epub, honestly/);
      const fin = fake.calls.find((c) => c.path === "/calibre-api/v1/uploads/finalize")!.body.toString();
      expect(fin).toMatch(/name="metadata\[author_list\]\[\]"\r\n\r\nMe/);
      const again = await s2.call("upload_book", { path: book });
      expect(again.text).toBe("Already in the library as [5001] My Book; not uploaded again.");
      const other = join(downloads, "Other Dune.epub");
      writeFileSync(other, "different bytes, same book");
      expect((await s2.call("upload_book", { path: other, isbn: "9780441013593" })).text).toBe("Already in the library as [101] Dune; not uploaded again.");
      const nope = await s2.call("upload_book", { path: join(cfg, "credentials.json") });
      expect(nope.isError).toBe(true);
      expect(nope.text).toMatch(/Only ebook files/);
      expect((await s2.call("auth_status")).text).toMatch(/Uploads: API key works/);
    } finally {
      await s2.client.close();
    }
  });
});
