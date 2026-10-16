# mcp-servers

My own [MCP](https://modelcontextprotocol.io) servers, one folder each under
`servers/`. Each is a self-contained package with its own README, tests and
CLI; the root is an npm workspace so one install builds them all.

| Server | What it does |
|---|---|
| [bookfusion](servers/bookfusion) | Your BookFusion ebook library: list, search, download and upload books, read highlights. |
| [black-hat-tomes](servers/black-hat-tomes) | LibGen ebook downloads: search by title/author and download verified EPUBs. |

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

```sh
npm run new -- <name> ["Service Name"]   # scaffolds servers/<name> from templates/server
npm install
npm test -w servers/<name>               # passes before you change anything
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
