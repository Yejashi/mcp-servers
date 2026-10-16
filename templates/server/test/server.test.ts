// End to end: the built server over stdio, driven by the MCP SDK's own
// client, against the fake. `npm test` builds first (pretest).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { itemLine } from "../src/format";
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

describe("example-mcp over stdio", () => {
  let fake: Fake;
  const cfg = mkdtempSync(join(tmpdir(), "example-cfg-"));

  beforeAll(async () => {
    fake = await startFake();
  });
  afterAll(() => fake?.close());

  it("offers its tools, read-only ones marked", async () => {
    const s = await connect({ EXAMPLE_BASE_URL: fake.base, EXAMPLE_CONFIG_DIR: cfg });
    try {
      const { tools } = await s.client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["auth_status", "list_items"]);
      expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    } finally {
      await s.client.close();
    }
  });

  it("explains how to set up when there is no token", async () => {
    const s = await connect({ EXAMPLE_BASE_URL: fake.base, EXAMPLE_CONFIG_DIR: cfg });
    try {
      const r = await s.call("list_items");
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/set-token/);
    } finally {
      await s.client.close();
    }
  });

  it("lists and searches items with the token", async () => {
    const s = await connect({ EXAMPLE_BASE_URL: fake.base, EXAMPLE_CONFIG_DIR: cfg, EXAMPLE_TOKEN: fake.token });
    try {
      expect((await s.call("list_items")).text).toBe("2 items; page 1\n[1] First item · updated 2026-10-01\n[2] Second item");
      expect((await s.call("list_items", { query: "second" })).text).toBe("1 item; page 1\n[2] Second item");
      expect((await s.call("list_items", { query: "zzz" })).text).toBe('No items match "zzz".');
      expect(fake.calls.at(-1)!.path).toBe("/items?q=zzz&page=1&per_page=25");
      expect((await s.call("auth_status")).text).toBe("Connected.");
    } finally {
      await s.client.close();
    }
  });

  it("says when the token is rejected", async () => {
    const s = await connect({ EXAMPLE_BASE_URL: fake.base, EXAMPLE_CONFIG_DIR: cfg, EXAMPLE_TOKEN: "wrong" });
    try {
      const r = await s.call("list_items");
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/rejected the token/);
      expect(r.text).not.toContain("wrong");
    } finally {
      await s.client.close();
    }
  });
});

describe("format", () => {
  it("puts the id first", () => {
    expect(itemLine({ id: 7, name: "" })).toBe("[7] Untitled");
  });
});
