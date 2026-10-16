#!/usr/bin/env node
// example-mcp: with no arguments, the MCP server on stdio. The other commands
// set it up from a terminal, so secrets never pass through a chat.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ExampleClient } from "./client.js";
import { credentialsFile, loadCredentials, saveCredentials } from "./config.js";
import { createServer } from "./server.js";

const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `example-mcp ${version} -- an MCP server for Example

Usage:
  example-mcp             run the MCP server (stdio)
  example-mcp set-token   store the API token (prompts without echo)
  example-mcp status      check the token
  example-mcp logout      forget the token

Credentials: ${credentialsFile()} (mode 600)
Environment: EXAMPLE_TOKEN, EXAMPLE_CONFIG_DIR, EXAMPLE_BASE_URL`;

async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").trim();
  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, terminal: true });
  (rl as any)._writeToOutput = () => {};
  const answer = await new Promise<string>((r) => rl.question("", r));
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

async function main(argv: string[]) {
  const cmd = argv[0];
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return console.log(HELP);
  if (cmd === "--version" || cmd === "-v") return console.log(version);
  if (!cmd) {
    const { server } = createServer({ version });
    await server.connect(new StdioServerTransport());
    return;
  }
  if (cmd === "set-token") {
    const token = argv[1] ?? (await promptSecret("Example API token: "));
    if (!token) throw new Error("No token given.");
    await new ExampleClient({ token }).listItems({ per_page: 1 });
    return console.log(`The token works. Saved to ${saveCredentials({ token })}.`);
  }
  if (cmd === "status") {
    const c = loadCredentials();
    if (!c.token) return console.log("Not set up (example-mcp set-token).");
    await new ExampleClient(c).listItems({ per_page: 1 }).then(
      () => console.log("Connected."),
      (e) => console.log(`Not working: ${e.message}`),
    );
    return;
  }
  if (cmd === "logout") {
    saveCredentials({ token: undefined });
    return console.log("Forgot the token.");
  }
  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exitCode = 2;
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
