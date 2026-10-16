// A fake LibGen: just enough to drive every tool, including the quirks the
// real service has — a listed "epub" that streams an HTML ADS page, a stub
// under the size floor, and a MOBI. Tests never touch the real service.

import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";

export interface FakeBook {
  id: string;
  title: string;
  author: string[];
  language: string;
  fileExtension: string;
  fileSize: number;
}

export const BOOKS: FakeBook[] = [
  { id: "100", title: "Golden Son", author: ["Brown, Pierce "], language: "eng", fileExtension: "epub", fileSize: 100_000 },
  { id: "200", title: "Golden Son", author: ["Brown, Pierce "], language: "eng", fileExtension: "mobi", fileSize: 100_000 },
  { id: "300", title: "Golden Son", author: ["Brown, Pierce "], language: "eng", fileExtension: "epub", fileSize: 100_000 },
  { id: "400", title: "Golden Son", author: ["Brown, Pierce "], language: "eng", fileExtension: "epub", fileSize: 1_000 },
];

function withMagic(magic: string, n: number): Buffer {
  const b = Buffer.alloc(n);
  b.write(magic, 0);
  return b;
}

/** The bytes each id streams, and the content type it is served as. */
const FILES: Record<string, { body: Buffer; type: string }> = {
  "100": { body: withMagic("PK\x03\x04", 100_000), type: "application/epub+zip" },
  "200": { body: withMagic("BookMobi", 100_000), type: "application/x-mobipocket-ebook" },
  "300": { body: Buffer.from("<html><body>ADS</body></html>"), type: "text/html" },
  "400": { body: withMagic("PK\x03\x04", 1_000), type: "application/epub+zip" },
};

export async function startFake() {
  const calls: { method: string; path: string }[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    calls.push({ method: req.method!, path: url.pathname + url.search });
    if (url.pathname === "/api/search/by-params") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      const matches = BOOKS.filter(
        (b) => !q || b.title.toLowerCase().includes(q) || b.author.some((a) => a.toLowerCase().includes(q)),
      );
      const from = parseInt(url.searchParams.get("from") ?? "0", 10) || 0;
      const books = matches.slice(from, from + 100);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ result: { books, total: matches.length } }));
    }
    if (url.pathname === "/api/download") {
      const id = url.searchParams.get("id") ?? "";
      const file = FILES[id];
      if (!file) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "not found" }));
      }
      res.writeHead(200, { "content-type": file.type, "content-length": String(file.body.length) });
      return res.end(file.body);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no route" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
