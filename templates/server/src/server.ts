// The MCP server: a few tools, short descriptions, short text results.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ExampleClient } from "./client.js";
import { loadCredentials } from "./config.js";
import { itemLine } from "./format.js";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Text => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Text => ({ content: [{ type: "text", text: t }], isError: true });

/** Any error becomes a readable tool error the model can act on, never a protocol failure. */
function guard<A>(fn: (args: A) => Promise<Text>): (args: A) => Promise<Text> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export function createServer(opts: { version: string; fetchImpl?: typeof fetch } = { version: "0.0.0" }) {
  // Read per call, so `example-mcp set-token` takes effect without a restart.
  const client = () => new ExampleClient(loadCredentials(), opts.fetchImpl);
  const server = new McpServer(
    { name: "example", version: opts.version },
    { instructions: "Example items. Use list_items to find one; ids are in [brackets]." },
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description: "The user's Example items, optionally filtered by a search query. One line per item with its [id].",
      inputSchema: {
        query: z.string().optional().describe("Text to search for"),
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().min(1).max(100).optional().describe("Default 25"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const page = await client().listItems({ query: a.query || undefined, page: a.page ?? 1, per_page: a.per_page ?? 25 });
      if (!page.items.length) return text(a.query ? `No items match "${a.query}".` : "No items.");
      const head = page.total !== undefined ? `${page.total} item${page.total === 1 ? "" : "s"}; page ${a.page ?? 1}` : `page ${a.page ?? 1}`;
      return text([head, ...page.items.map(itemLine)].join("\n"));
    }),
  );

  server.registerTool(
    "auth_status",
    {
      title: "Example connection status",
      description: "Whether the server is set up and its credentials work.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      if (!loadCredentials().token) return text("Not set up: the user runs `example-mcp set-token`.");
      await client().listItems({ per_page: 1 });
      return text("Connected.");
    }),
  );

  return { server };
}
