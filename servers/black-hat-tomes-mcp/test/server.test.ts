// End to end: the built server over stdio, driven by the MCP SDK's own
// client, against the fake. `npm test` builds first (pretest).

import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { displayAuthor, extFromMagic, formatSize, safeFilename } from "../src/format";
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

describe("black-hat-tomes-mcp over stdio", () => {
  let fake: Fake;
  const dir = mkdtempSync(join(tmpdir(), "black-hat-tomes-dl-"));

  beforeAll(async () => {
    fake = await startFake();
  });
  afterAll(() => fake?.close());

  it("offers its tools, read-only ones marked", async () => {
    const s = await connect({ BLACK_HAT_TOMES_SEARCH_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_DIR: dir });
    try {
      const { tools } = await s.client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["download_book", "search_books", "status"]);
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(byName.search_books.annotations?.readOnlyHint).toBe(true);
      expect(byName.status.annotations?.readOnlyHint).toBe(true);
      expect(byName.download_book.annotations?.readOnlyHint).toBe(false);
    } finally {
      await s.client.close();
    }
  });

  it("searches and filters to eng/epub candidates", async () => {
    const s = await connect({ BLACK_HAT_TOMES_SEARCH_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_DIR: dir });
    try {
      const r = await s.call("search_books", { query: "golden son" });
      expect(r.isError).toBe(false);
      expect(r.text).toBe(
        [
          'LibGen candidates for "golden son" (eng/epub), page 1',
          "[100] Golden Son — Pierce Brown · eng epub 98 KB",
          "[300] Golden Son — Pierce Brown · eng epub 98 KB",
        ].join("\n"),
      );
      expect(r.text).not.toContain("[200]"); // the mobi is filtered out
      expect(r.text).not.toContain("[400]"); // the 1 KB stub is filtered out
      expect((await s.call("search_books", { query: "zzz" })).text).toBe('No books match "zzz".');
    } finally {
      await s.client.close();
    }
  });

  it("downloads a valid EPUB and verifies it", async () => {
    const s = await connect({ BLACK_HAT_TOMES_SEARCH_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_DIR: dir });
    try {
      const r = await s.call("download_book", { id: "100", title: "Golden Son", author: "Pierce Brown" });
      expect(r.isError).toBe(false);
      const path = join(dir, "Golden Son - Pierce Brown.epub");
      expect(r.text).toBe(`Saved ${path} (98 KB, EPUB).`);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBe(100_000);
      expect(readFileSync(path).subarray(0, 4).toString("ascii")).toBe("PK\x03\x04");
    } finally {
      await s.client.close();
    }
  });

  it("saves a MOBI with the right extension", async () => {
    const s = await connect({ BLACK_HAT_TOMES_SEARCH_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_DIR: dir });
    try {
      const r = await s.call("download_book", { id: "200", title: "Golden Son", author: "Pierce Brown" });
      expect(r.isError).toBe(false);
      const path = join(dir, "Golden Son - Pierce Brown.mobi");
      expect(r.text).toBe(`Saved ${path} (98 KB, MOBI).`);
      expect(readFileSync(path).subarray(0, 4).toString("ascii")).toBe("Book");
    } finally {
      await s.client.close();
    }
  });

  it("rejects an HTML ADS page, a stub, and a missing id", async () => {
    const s = await connect({ BLACK_HAT_TOMES_SEARCH_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_DIR: dir });
    try {
      const html = await s.call("download_book", { id: "300" });
      expect(html.isError).toBe(true);
      expect(html.text).toMatch(/HTML page/);
      const stub = await s.call("download_book", { id: "400" });
      expect(stub.isError).toBe(true);
      expect(stub.text).toMatch(/only 1000 bytes/);
      const missing = await s.call("download_book", { id: "999" });
      expect(missing.isError).toBe(true);
      expect(missing.text).toMatch(/HTTP 404/);
    } finally {
      await s.client.close();
    }
  });

  it("reports connection status", async () => {
    const s = await connect({ BLACK_HAT_TOMES_SEARCH_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_URL: fake.base, BLACK_HAT_TOMES_DOWNLOAD_DIR: dir });
    try {
      const r = await s.call("status");
      expect(r.isError).toBe(false);
      expect(r.text).toMatch(/Connected to LibGen/);
    } finally {
      await s.client.close();
    }
  });
});

describe("format", () => {
  it("turns LibGen's 'Last, First ' into 'First Last'", () => {
    expect(displayAuthor(["Brown, Pierce "])).toBe("Pierce Brown");
    expect(displayAuthor(["Asimov, Isaac", "Clarke, Arthur "])).toBe("Isaac Asimov; Arthur Clarke");
    expect(displayAuthor(["A Single Name"])).toBe("A Single Name");
  });

  it("sizes and filenames", () => {
    expect(formatSize(60_000)).toBe("59 KB");
    expect(formatSize(1_000)).toBe("1000 B");
    expect(formatSize(0)).toBeUndefined();
    expect(safeFilename('a/b: c*?d', "epub")).toBe("a b c d.epub");
    expect(safeFilename("x", "epub")).toBe("x.epub");
  });

  it("sniffs extensions from magic bytes", () => {
    expect(extFromMagic(Buffer.from("PK\x03\x04", "ascii"))).toBe("epub");
    expect(extFromMagic(Buffer.from("%PDF", "ascii"))).toBe("pdf");
    expect(extFromMagic(Buffer.from("Book", "ascii"))).toBe("mobi");
    expect(extFromMagic(Buffer.from("<htm", "ascii"))).toBeUndefined();
  });
});
