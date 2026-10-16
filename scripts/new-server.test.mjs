// The scaffold produces a server that builds and passes its own tests, with
// nothing left named after the template.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("npm run new scaffolds a working server", () => {
  // Inside the repo, so the root node_modules resolve; outside the workspaces.
  const dir = join(root, ".scaffold-test", "home-lab");
  rmSync(join(root, ".scaffold-test"), { recursive: true, force: true });
  try {
    execFileSync(process.execPath, [join(root, "scripts", "new-server.mjs"), "home-lab", "Home Lab", "--dest", dir], { stdio: "pipe" });
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    for (const f of walk(dir)) assert.doesNotMatch(readFileSync(f, "utf8"), /example/i, `${f} still mentions the template`);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    assert.equal(pkg.name, "home-lab-mcp");
    assert.deepEqual(Object.keys(pkg.bin), ["home-lab-mcp"]);
    assert.match(readFileSync(join(dir, "src", "config.ts"), "utf8"), /HOME_LAB_TOKEN/);
    const tsc = join(root, "node_modules", ".bin", "tsc");
    const vitest = join(root, "node_modules", ".bin", "vitest");
    execFileSync(tsc, ["-p", dir], { stdio: "pipe" });
    const out = execFileSync(vitest, ["run", "--root", dir], { encoding: "utf8", stdio: "pipe" });
    assert.match(out, /5 passed/);
  } finally {
    rmSync(join(root, ".scaffold-test"), { recursive: true, force: true });
  }
});
