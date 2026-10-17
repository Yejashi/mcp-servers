// npm run tokens -- <name>-mcp   (or just <name>)
//
// Starts servers/<name>/dist/cli.js, lists its tools the way an MCP client
// does, and estimates what their definitions cost on every request (JSON
// characters / 4). Needs no credentials: tools are listed before any call.

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] && (process.argv[2].endsWith("-mcp") ? process.argv[2] : `${process.argv[2]}-mcp`);
if (!name) {
  console.error("Usage: npm run tokens -- <name>-mcp");
  process.exit(2);
}
const client = new Client({ name: "tool-tokens", version: "1" });
// An empty config home, so the server starts as if never set up.
const home = mkdtempSync(join(tmpdir(), "tool-tokens-"));
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "servers", name, "dist", "cli.js")], env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: home } }));
const { tools } = await client.listTools();
await client.close();
let total = 0;
for (const t of tools) {
  const n = Math.ceil(JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length / 4);
  total += n;
  console.log(`${String(n).padStart(5)}  ${t.name}`);
}
console.log(`${String(total).padStart(5)}  total for ${tools.length} tools, per request`);
