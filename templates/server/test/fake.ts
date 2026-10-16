// A fake Example API: just enough to drive every tool. Tests never touch the
// real service or real credentials.

import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";

export const ITEMS = [
  { id: 1, name: "First item", updated_at: "2026-10-01T12:00:00Z" },
  { id: 2, name: "Second item" },
];

export async function startFake(opts: { token?: string } = {}) {
  const token = opts.token ?? "tok-test";
  const calls: { method: string; path: string; headers: IncomingMessage["headers"] }[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    calls.push({ method: req.method!, path: url.pathname + url.search, headers: req.headers });
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: "unauthorized" });
    if (url.pathname === "/items") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = ITEMS.filter((i) => !q || i.name.toLowerCase().includes(q));
      return json(200, items, { "x-total-count": String(items.length) });
    }
    json(404, { error: "no route" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, token, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
