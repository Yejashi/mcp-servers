# mcp-servers

My own [MCP](https://modelcontextprotocol.io) servers, one folder each under
`servers/`. Each is a self-contained package with its own README, tests and
CLI; the root is an npm workspace so one install builds them all.

| Server | What it does |
|---|---|
| [bookfusion](servers/bookfusion) | Your BookFusion ebook library: list, search, download and upload books, read highlights. |

## Install

```sh
git clone git@github.com:Yejashi/mcp-servers.git
cd mcp-servers
npm install      # installs and builds every server
npm test
```

Then follow each server's README for its credentials, and point your MCP
client at `servers/<name>/dist/cli.js`, e.g. in
`~/.config/opencode/opencode.json`:

```json
{ "mcp": { "bookfusion": { "type": "local", "command": ["node", "/path/to/mcp-servers/servers/bookfusion/dist/cli.js"] } } }
```

## Adding a server

1. `servers/<name>/` with a `package.json` (`"type": "module"`, a `bin`, and
   `build` / `typecheck` / `test` scripts), `src/`, `test/` and a README.
2. Keep secrets out of the repo: read them from the environment or a mode 600
   file under `~/.config/<name>/`, never from a tracked file.
3. Keep the tool list short and its descriptions tight: every tool's schema is
   sent with every request and costs context.
4. Tests must not need the real service or credentials; drive the server over
   stdio against a fake, as `servers/bookfusion/test` does.
5. Add a row to the table above. CI runs every workspace's typecheck and tests.

## License

MIT, unless a server's folder says otherwise.
