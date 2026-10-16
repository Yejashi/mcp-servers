#!/usr/bin/env node
// bookfusion-mcp: with no arguments, the MCP server on stdio. The other
// commands set it up from a terminal.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BookFusion } from "./client.js";
import { credentialsFile, loadCredentials, saveCredentials } from "./config.js";
import { describeLoginFailure, DeviceLogin } from "./login.js";
import { createServer } from "./server.js";

const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `bookfusion-mcp ${version} -- an MCP server for your BookFusion library

Usage:
  bookfusion-mcp              run the MCP server (stdio)
  bookfusion-mcp login        link your BookFusion account (device code)
  bookfusion-mcp set-api-key  store the Calibre API key that uploads need
  bookfusion-mcp status       check the login and the key
  bookfusion-mcp logout       forget the login and the key

Credentials: ${credentialsFile()} (mode 600)
Environment: BOOKFUSION_TOKEN, BOOKFUSION_API_KEY, BOOKFUSION_DOWNLOAD_DIR,
             BOOKFUSION_CONFIG_DIR, BOOKFUSION_CLIENT_ID`;

async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").trim();
  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, terminal: true });
  // Swallow the echo: the key never shows on screen.
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
    const { server, login } = createServer({ version });
    await server.connect(new StdioServerTransport());
    const stop = () => (login.stop(), process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  if (cmd === "login") {
    const login = new DeviceLogin(() => new BookFusion(loadCredentials()), () => {});
    const code = await login.start();
    console.log(`Open ${code.verification_uri_complete ?? code.verification_uri}\nand approve the code: ${code.user_code}\n(BookFusion lists this as a KOReader device.)\nWaiting…`);
    const st = login.state.kind === "waiting" ? await login.poll(code, login.state.expiresAt) : login.state;
    if (st.kind === "done") return console.log(`Logged in. Saved to ${credentialsFile()}.`);
    console.error(describeLoginFailure(st.kind === "failed" ? st.reason : "unknown"));
    process.exitCode = 1;
    return;
  }

  if (cmd === "set-api-key") {
    const key = argv[1] ?? (await promptSecret("BookFusion Calibre API key (Settings → Integrations → Calibre): "));
    if (!key) throw new Error("No key given.");
    const bf = new BookFusion({ apiKey: key });
    await bf.limits();
    console.log(`The key works. Saved to ${saveCredentials({ apiKey: key })}.`);
    return;
  }

  if (cmd === "status") {
    const c = loadCredentials();
    const bf = new BookFusion(c);
    if (!c.token) console.log("Library: not logged in (bookfusion-mcp login).");
    else
      await bf.searchBooks({ per_page: 1 }).then(
        (p) => console.log(`Library: logged in${p.total !== undefined ? `, ${p.total} books` : ""}.`),
        (e) => console.log(`Library: login not working: ${e.message}`),
      );
    if (!c.apiKey) console.log("Uploads: no API key (bookfusion-mcp set-api-key).");
    else await bf.limits().then((l) => console.log(`Uploads: key works. ${JSON.stringify(l)}`), (e) => console.log(`Uploads: ${e.message}`));
    return;
  }

  if (cmd === "logout") {
    saveCredentials({ token: undefined, apiKey: undefined });
    console.log("Forgot the BookFusion login and API key. Remove the KOReader device under Settings on bookfusion.com to revoke it there too.");
    return;
  }

  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exitCode = 2;
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
