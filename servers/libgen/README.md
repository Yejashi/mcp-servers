# libgen-mcp

An [MCP](https://modelcontextprotocol.io) server for downloading ebooks from
[LibGen](https://libgen.me). It searches LibGen by title or author and
downloads the book you pick, verifying the file before it counts as a
success. No account, no token — LibGen is anonymous.

## Tools

| Tool | What it does |
| --- | --- |
| `search_books` | Search LibGen by title or author. One line per candidate with its `[id]`, language, format and size; exact matches first. Filters to English EPUBs by default. |
| `download_book` | Download a book by its search `id` and save it as an ebook file, named from the title and author. Verifies the file before reporting success. |
| `status` | Whether LibGen is reachable and where books are saved. |

Typical flow: `search_books` → pick an `eng`/`epub` candidate →
`download_book` with that id (and the title/author from the line). If a
download fails, pick another id for the same title.

## Setup

Nothing to configure. The server runs as-is:

```sh
node dist/cli.js            # run the MCP server (stdio)
node dist/cli.js status     # check LibGen is reachable
```

Books save to `~/Documents/ebooks` by default. Override with:

| Env var | Default | Meaning |
| --- | --- | --- |
| `LIBGEN_DOWNLOAD_DIR` | `~/Documents/ebooks` | Where books are saved |
| `LIBGEN_SEARCH_URL` | `https://libgen.me` | Search API host |
| `LIBGEN_DOWNLOAD_URL` | `https://libgen.download` | File host |

## Add it to a client

Point your MCP client at `dist/cli.js`, e.g. OpenCode / Claude Code /
VS Code:

```json
{ "mcp": { "libgen": { "type": "local", "command": ["node", "/path/to/mcp-servers/servers/libgen/dist/cli.js"] } } }
```

## How it works

LibGen has no official API docs, so the routes come from its own web app's
network calls, which are stable and unauthenticated:

- **Search** — `GET {search}/api/search/by-params?query=…&collection=books`.
  Returns `result.books[]`, each with `id`, `title`, `author[]`, `language`,
  `fileExtension`, `fileSize`, `year`, plus a fuzzy `result.total`. It ranks
  exact matches first and pages 100 at a time via the `from` offset. The
  `query` is fuzzy, so the server also filters locally to the requested
  language, format and a real size (≥ 80 KB), falling back to the raw page if
  that would hide everything.
- **Download** — `GET {download}/api/download?id=<id>` streams the file
  directly (HTTP 200, no redirect, no auth). The listed `fileExtension` can
  lie — one id listed as `epub` streamed a MOBI — so the file's real bytes
  decide: a zip/epub must start with the `PK` magic, an HTML content type is
  an ADS page, and nothing under 50 KB is a book. The extension is taken from
  the response content type, falling back to the magic bytes.

Both hosts are overridable by env var so the tests run against a fake.

## Token cost

The three tool definitions cost **337 tokens per request**
(`npm run tokens -- libgen`).

## Limits

- LibGen is anonymous and rate-sensitive; the server makes one request per
  tool call and does not retry aggressively.
- A listed `epub` can actually be a MOBI or an ADS page; the PK/size check
  rejects the bad ones, so prefer a different id for the same title.
- Only the formats LibGen serves are produced (EPUB, MOBI, PDF, AZW3, FB2);
  there is no local format conversion.
