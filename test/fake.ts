// A fake BookFusion for tests: the user API, the Calibre API and a storage
// endpoint, with just enough behaviour to drive every tool.

import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export const BOOKS = [
  { id: 101, title: "Dune", authors: [{ name: "Frank Herbert" }], formats: [{ content_type: "application/epub+zip", download_size: 1_200_000 }, { content_type: "application/pdf", download_size: 9_000_000 }], series: [{ title: "Dune", index: 1 }], reading_position: { percentage: 42.4 } },
  { id: 102, title: "A Store Book", authors: ["Someone"], formats: [{ content_type: "application/epub+zip" }] },
];

export async function startFake(opts: { token?: string; apiKey?: string; approveAfter?: number } = {}) {
  const token = opts.token ?? "tok-123";
  const apiKey = opts.apiKey ?? "key-abc";
  const calls: Recorded[] = [];
  const uploads = new Map<string, { id: number; title: string }>();
  let polls = 0;
  let base = "";
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, "http://x");
    calls.push({ method: req.method!, path: url.pathname + url.search, headers: req.headers, body });
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    const p = url.pathname;
    if (p === "/api/user/auth/device") return json(200, { device_code: "dev-1", user_code: "ABCD-1234", verification_uri: base + "/device", expires_in: 60, interval: 0.05 });
    if (p === "/api/user/auth/token") return ++polls > (opts.approveAfter ?? 1) ? json(200, { access_token: token }) : json(400, { error: "authorization_pending" });
    if (p.startsWith("/api/user/")) {
      if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: "invalid_token" });
      const b = body.length ? JSON.parse(body.toString()) : {};
      if (p === "/api/user/books/search") {
        const items = BOOKS.filter((x) => !b.query || x.title.toLowerCase().includes(String(b.query).toLowerCase()));
        return json(200, items, { "current-page": String(b.page ?? 1), "current-per-page": String(b.per_page ?? 25), "total-count": String(items.length) });
      }
      if (p === "/api/user/bookshelves/search") return json(200, [{ id: 7, name: "Sci-Fi", books_count: 1 }]);
      if (p === "/api/user/series/search") return json(200, [{ id: 3, title: "Dune", books_count: 1 }]);
      if (p === "/api/user/highlights/search") return json(200, [{ id: 1, quote_text: "Fear is the mind-killer.", note: "classic", color: "yellow", chapter_index: 0 }]);
      const dl = /^\/api\/user\/books\/(\d+)\/download$/.exec(p);
      if (dl) {
        if (dl[1] === "102") return json(403, { error: "forbidden" });
        if (!BOOKS.some((x) => String(x.id) === dl[1])) return json(404, { error: "not_found" });
        return json(200, { url: `${base}/storage/books/${dl[1]}/dune.epub?X-Amz-Signature=s`, content_type: b.content_type ?? "application/epub+zip" });
      }
    }
    if (p.startsWith("/storage/books/")) {
      res.writeHead(200, { "content-type": "application/epub+zip" });
      return res.end("EPUB-BYTES");
    }
    if (p.startsWith("/calibre-api/v1/")) {
      if (req.headers.authorization !== "Basic " + Buffer.from(`${apiKey}:`).toString("base64")) return json(401, { error: "unauthorized" });
      const q = p.slice("/calibre-api/v1".length);
      if (q === "/limits") return json(200, { uploads: { used: 3, limit: 10 } });
      if (q === "/uploads/init") return json(200, { url: base + "/storage/upload", params: { key: "uploads/abc", policy: "p" } });
      if (q === "/uploads/finalize") {
        const digest = /name="digest"\r\n\r\n([0-9a-f]+)/.exec(body.toString())?.[1] ?? "";
        const title = /name="metadata\[title\]"\r\n\r\n([^\r]*)/.exec(body.toString())?.[1] ?? "";
        const rec = { id: 900 + uploads.size, title };
        uploads.set(digest, rec);
        return json(200, rec);
      }
      if (q === "/uploads") return json(200, url.searchParams.get("isbn") === "9780441013593" ? [{ id: 555, title: "Dune" }] : []);
      const check = /^\/uploads\/([0-9a-f]{64})$/.exec(q);
      if (check) return uploads.has(check[1]) ? json(200, { ...uploads.get(check[1]), calibre_metadata_digest: "x" }) : json(404, { error: "not_found" });
    }
    if (p === "/storage/upload") {
      res.writeHead(204);
      return res.end();
    }
    json(404, { error: "no route" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, uploads, token, apiKey, close: () => new Promise<void>((r) => server.close(() => r())) };
}
