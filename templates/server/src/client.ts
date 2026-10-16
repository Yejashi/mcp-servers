// The only module that knows Example's HTTP routes. It returns only the
// fields the tools use, and never puts a credential into an error message.

import { baseUrl } from "./config.js";

const TIMEOUT_MS = 60_000;

export class ExampleError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
  }
}

export interface Item {
  id: string | number;
  name: string;
  updated_at?: string;
}

export interface Page<T> {
  items: T[];
  total?: number;
}

/** Without undefined values, so they cannot override defaults when spread. */
export function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export class ExampleClient {
  constructor(
    private readonly creds: { token?: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = baseUrl(),
  ) {}

  private async request(method: string, path: string, query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<{ data: unknown; headers: Headers }> {
    if (!this.creds.token) throw new ExampleError(401, "Not set up yet: run `example-mcp set-token` (or set EXAMPLE_TOKEN).");
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(defined(query))) url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.creds.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    if (res.status === 401) throw new ExampleError(401, "Example rejected the token. Run `example-mcp set-token` again.", data);
    if (!res.ok) throw new ExampleError(res.status, `${method} ${path} failed: HTTP ${res.status}`, data);
    return { data, headers: res.headers };
  }

  async listItems(params: { query?: string; page?: number; per_page?: number }): Promise<Page<Item>> {
    const { data, headers } = await this.request("GET", "/items", { q: params.query, page: params.page, per_page: params.per_page });
    const total = Number(headers.get("x-total-count"));
    return { items: Array.isArray(data) ? (data as Item[]) : [], total: Number.isFinite(total) && headers.has("x-total-count") ? total : undefined };
  }
}
