# mcp-servers

My own [MCP](https://modelcontextprotocol.io) servers, one folder each under
`servers/`, named `<name>-mcp` like the package inside it. Each is a self-contained package with its own README, tests and
CLI; the root is an npm workspace so one install builds them all.

| Server | What it does |
|---|---|
| [bookfusion-mcp](servers/bookfusion-mcp) | Your BookFusion ebook library: list, search, download and upload books, read highlights. |
| [black-hat-tomes-mcp](servers/black-hat-tomes-mcp) | LibGen ebook downloads: search by title/author and download verified EPUBs. |

## Install

```sh
git clone git@github.com:Yejashi/mcp-servers.git
cd mcp-servers
npm install      # installs and builds every server
npm test
```

Then follow each server's README for its credentials, and point your MCP
client at `servers/<name>-mcp/dist/cli.js`, e.g. in
`~/.config/opencode/opencode.json`:

```json
{ "mcp": { "servers": { "bookfusion-mcp": { "type": "local", "command": ["node", "/path/to/mcp-servers/servers/bookfusion-mcp/dist/cli.js"] } } } }
```

## Adding a server

```sh
npm run new -- <name> ["Service Name"]   # scaffolds servers/<name>-mcp from templates/server
npm install
npm test -w servers/<name>-mcp           # passes before you change anything
```

Then follow [AGENTS.md](AGENTS.md), the guide for building one: finding the
real API, credentials, tool design and token budget, tests against a fake,
and checking against the real service. It is written for coding agents
(`CLAUDE.md` imports it) and reads fine for people too.

`templates/server` is a complete, tested server for an imaginary service;
CI builds and tests it, and checks that a freshly scaffolded copy passes its
own tests. `npm run tokens -- <name>` shows what a server's tool definitions
cost per request.

## License

MIT, unless a server's folder says otherwise.
