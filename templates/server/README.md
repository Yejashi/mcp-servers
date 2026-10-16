# example-mcp

An MCP server for Example: _one sentence on what it lets an agent do._

| Tool | |
|---|---|
| `list_items` | _What it returns, one line._ |
| `auth_status` | Whether the server is set up and its credentials work. |

_The tool descriptions cost about N tokens per request (measure it; see
AGENTS.md at the repo root)._

## Set up

```sh
node dist/cli.js set-token   # prompts without echo, checks it, stores it mode 600
node dist/cli.js status
```

_Where the user gets the token._ It is stored in
`~/.config/example-mcp/credentials.json`; `EXAMPLE_TOKEN` overrides it.

## Add it to a client

```json
{ "mcp": { "example": { "type": "local", "command": ["node", "/path/to/mcp-servers/servers/example/dist/cli.js"] } } }
```

## How it works

_Which API it talks to, how you learned its shape (docs, an official
client's source), and anything surprising about it._

## Tests

`npm test` drives the built server over stdio against a fake
(`test/fake.ts`); it never touches the real service.
