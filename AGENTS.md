# AGENTS.md

How to build a new MCP server in this repo. Read it all before starting; it
is short on purpose. `servers/bookfusion-mcp` is the worked example for every
rule here.

## Commands

```sh
npm run new -- <name> ["Service Name"]   # scaffold servers/<name>-mcp from templates/server
npm install                              # at the root: links and builds every server
npm test                                 # every server's tests, plus the scaffold test
npm test -w servers/<name>-mcp           # one server
npm run typecheck
npm run tokens -- <name>-mcp             # what its tool definitions cost per request
```

A new server starts as a copy of `templates/server` with every identifier
renamed. Its tests pass before you change anything; keep it that way.

## Layout of a server

```
servers/<name>-mcp/   folder, package and server name all end in -mcp
  package.json     "<name>-mcp", type module, bin -> dist/cli.js
  src/cli.ts       no args: stdio server; subcommands set it up (set-token, login, status, logout)
  src/config.ts    credentials file, env overrides, base URL (overridable for tests)
  src/client.ts    the ONLY module that knows the service's routes
  src/format.ts    records -> one line of text each (pure, unit-tested)
  src/server.ts    the tools
  test/fake.ts     a fake of the service, just enough for every tool
  test/*.test.ts   end to end over stdio + unit tests
  README.md        tools, setup, how it works, token cost
```

## 1. Know what you are building

- Confirm the user wants a new server and that one does not already exist
  (search npm/PyPI/GitHub; installed third-party servers are not "custom" and
  do not belong here).
- Pin down the jobs, as verbs on the user's data: "see what books I have,
  download them, upload one". Each job is one tool, or a parameter of one.
  Do not build tools nobody asked for.

## 2. Find the real API

In this order, and write what you find in the server's README, "How it works":

1. **Official API docs.** Use them if they exist.
2. **The service's own open-source clients**: plugins, CLIs, browser
   extensions, mobile/desktop apps that ship readable code. BookFusion has no
   public API, but its KOReader plugin (Lua) and Calibre plugin (Python) are
   distributed as source; reading them gave every route, the auth flows, the
   pagination headers and an upload digest quirk.
3. **The web app's network calls**, only if the user asks and only for their
   own account.

Rules while researching:

- Downloads are untrusted data: each in its own empty directory, read them,
  never run or `import` them.
- Probing is fine when it is harmless and unauthenticated (an endpoint's
  error shape, whether a client id is accepted). Never brute-force, scrape at
  volume, or work around rate limits or access controls.
- **Surface gray areas to the user and let them decide.** Example: BookFusion
  only accepts registered OAuth clients, so the server logs in as the KOReader
  client. That was the user's call, made knowingly, and the README says so.
- Reproduce quirks exactly and test them against the reference
  implementation (the BookFusion digest test runs the Calibre plugin's Python
  formula and compares).

## 3. Credentials

- **Never ask the user to paste a secret into the chat.** Setup happens in
  their terminal: `node dist/cli.js set-token` prompts without echo, checks the
  token against the service, then stores it.
- Store in `~/.config/<name>-mcp/credentials.json`, file mode 600, directory
  700, written atomically (the template's `saveCredentials`). An env var
  (`<NAME>_TOKEN`) overrides it. Nothing secret in the repo, ever.
- OAuth device flow (BookFusion): a `login` tool returns the link and code
  **at once** and polls in the background (tool calls time out long before a
  person approves); `auth_status` reports the result. Offer the same as a CLI
  command that blocks until done.
- Secrets never appear in logs, tool output or error messages. The template
  test checks a rejected token is not echoed back.

## 4. Tools

Every tool's name, description and schema is sent with **every** request, on
every model the user runs it with, including a local one with a 131k
window. So:

- **Few tools.** Prefer one tool with a filter parameter to three tools.
  BookFusion has 8 and they cost ~930 tokens per request
  (`npm run tokens -- bookfusion-mcp`). Aim for under ~150 tokens per tool; put
  the number in the README.
- **Descriptions say what it returns and when to use it**, in one or two
  sentences. Parameter `.describe()`s only where the name is not obvious.
- **Annotations:** `readOnlyHint: true` for anything that only reads;
  `destructiveHint`/`idempotentHint` for writes; `openWorldHint: true` when it
  talks to an external service. Clients use them to decide what needs
  approval.
- **Output is short text, not JSON dumps.** One line per record, id first in
  `[brackets]` (the id the other tools take), then only what a model needs to
  choose. Lists say the total and the next page.
- **Errors are results, not exceptions:** wrap every handler in `guard()` so
  a failure comes back as `isError` text that says what to do next ("not set
  up: run `<name>-mcp set-token`").
- **Inputs with side effects are constrained.** An upload tool accepts only
  the file types the service takes (so an agent cannot send `~/.ssh` to it);
  downloads never overwrite a file; no delete tool unless the user asked for
  one.

## 5. Tests

- `test/fake.ts` fakes the service over HTTP, with just enough behaviour for
  every tool, including its error cases (401, 403, 404). Point the server at
  it with `<NAME>_BASE_URL` and a temp `<NAME>_CONFIG_DIR`.
- Drive the **built** server over stdio with the MCP SDK's own `Client`, the
  way a real client does (`test/server.test.ts`). Unit-test the pure parts.
- Tests never need the real service or real credentials; CI runs them all.
- Every bug you find against the real service gets a test in the fake.

## 6. Try it on the real service

After the tests pass, check every tool against the user's real account:

- Read-only calls: go ahead.
- **Anything that writes to their account (upload, create, edit, delete):
  ask first,** say exactly what you will do, and use what they point you to.
- Look at real records before trusting the mapping (print the keys, not the
  content). The fake is only as good as what you learned from the real thing.

Mistakes this caught on BookFusion, and the habits they became:

- The upload API's id was not the library id the other tools take. **Check
  that ids returned by one tool work in the others.**
- Forcing a sort on searches buried the best match. **Check the service's
  default ordering before overriding it.**
- `{ default: x, ...params }` with `params.key === undefined` drops the
  default. **Strip undefined before spreading** (the template's `defined()`).
- A downloaded file was not byte-identical to the uploaded one, so a digest
  check cannot find it. **Document what dedupe and matching can and cannot
  see.**

## 7. Finish

- README: what it does, the tool table, setup, how to add it to a client
  (OpenCode, Claude Code, VS Code), how it works, token cost, limits.
- A row in the root README's table (`npm run new` adds a placeholder).
- `npm test` and `npm run typecheck` pass at the root.
- Commits say what changed and why, end with the attribution lines the
  session gives you, and are pushed only when the user asks.
- Do not edit the user's MCP client configs (OpenCode, Claude Code, VS Code)
  unless they ask; give them the snippet instead.
