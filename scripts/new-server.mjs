// npm run new -- <name> ["Service Name"]
//
// Copies templates/server to servers/<name>-mcp, renaming every identifier the
// template uses (example-mcp, EXAMPLE_*, ExampleClient, Example, example),
// and adds a row for it to the README. --dest <dir> writes elsewhere and
// leaves the README alone (used by the test).

import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const destFlag = args.indexOf("--dest");
const dest = destFlag >= 0 ? resolve(args.splice(destFlag, 2)[1]) : undefined;
const [typed, titleArg] = args;
// "readwise" and "readwise-mcp" both mean the readwise-mcp server.
const name = typed?.replace(/-mcp$/, "");

if (!name || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
  console.error('Usage: npm run new -- <name> ["Service Name"]\n  <name>: lowercase letters, digits and dashes, e.g. "readwise" or "home-assistant"');
  process.exit(2);
}

const words = name.split("-");
const title = titleArg || words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const env = name.toUpperCase().replace(/-/g, "_");
const target = dest ?? join(root, "servers", `${name}-mcp`);
if (existsSync(target)) {
  console.error(`${target} already exists.`);
  process.exit(1);
}

// Longest first, so "example-mcp" is not half-renamed by "example".
const renames = [
  ["example-mcp", `${name}-mcp`],
  ["EXAMPLE_", `${env}_`],
  ["ExampleClient", `${pascal}Client`],
  ["ExampleError", `${pascal}Error`],
  ["Example", title],
  ["example", name],
];

cpSync(join(root, "templates", "server"), target, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(src.slice(join(root, "templates", "server").length)),
});

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(target)) {
  let text = readFileSync(file, "utf8");
  for (const [from, to] of renames) text = text.split(from).join(to);
  writeFileSync(file, text);
}

if (!dest) {
  const readme = join(root, "README.md");
  const lines = readFileSync(readme, "utf8").split("\n");
  const last = lines.findLastIndex((l) => /^\| \[[^\]]+\]\(servers\//.test(l));
  lines.splice(last + 1, 0, `| [${name}-mcp](servers/${name}-mcp) | _What it does._ |`);
  writeFileSync(readme, lines.join("\n"));
}

console.log(`Created ${target}.

Next:
  npm install                      # at the repo root: links and builds it
  npm test -w servers/${name}-mcp  # the template's tests pass as they are
Then follow AGENTS.md: find the real API, replace list_items, keep the
fake in test/fake.ts in step, measure the tool tokens, fill in the README.`);
