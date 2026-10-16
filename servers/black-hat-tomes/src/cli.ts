#!/usr/bin/env node
// black-hat-tomes-mcp: with no arguments, the MCP server on stdio. LibGen is anonymous,
// so there is nothing to set up — `status` just checks the hosts are reachable.

import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LibGenClient } from "./client.js";
import { downloadDir, downloadUrl, searchUrl } from "./config.js";
import { createServer } from "./server.js";

const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `black-hat-tomes-mcp ${version} -- an MCP server for LibGen ebook downloads

Usage:
  black-hat-tomes-mcp        run the MCP server (stdio)
  black-hat-tomes-mcp status check that LibGen is reachable
  black-hat-tomes-mcp help   show this help

No credentials: LibGen is anonymous.
Environment: BLACK_HAT_TOMES_DOWNLOAD_DIR, BLACK_HAT_TOMES_SEARCH_URL, BLACK_HAT_TOMES_DOWNLOAD_URL`;

async function main(argv: string[]) {
  const cmd = argv[0];
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return console.log(HELP);
  if (cmd === "--version" || cmd === "-v") return console.log(version);
  if (!cmd) {
    const { server } = createServer({ version });
    await server.connect(new StdioServerTransport());
    return;
  }
  if (cmd === "status") {
    const client = new LibGenClient();
    try {
      await client.searchBooks({ query: "the" });
      console.log(`Connected to LibGen (${searchUrl()} / ${downloadUrl()}).`);
      console.log(`Books save to ${downloadDir()}.`);
    } catch (err) {
      console.error(`LibGen not reachable: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exitCode = 2;
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
