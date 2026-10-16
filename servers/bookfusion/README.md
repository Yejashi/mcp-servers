# bookfusion-mcp

An MCP server for your [BookFusion](https://www.bookfusion.com) library: see
what books you have, search them, download them, upload new ones, and read
your highlights -- from OpenCode, Claude Code, VS Code or any MCP client.

| Tool | |
|---|---|
| `list_books` | Your library, newest first. Search by title/author, or filter by reading list (`currently_reading`, `favorites`, `planned_to_read`, `completed`), shelf or series. One line per book: `[id] Title — Author · EPUB 1.1 MB · Series #1 · 42% read`. |
| `list_shelves`, `list_series` | Your bookshelves and series, with ids. |
| `download_book` | Saves a book to disk (default `~/Downloads/BookFusion`) and returns the path. EPUB unless you ask for another format; never overwrites a file. |
| `upload_book` | Uploads a local ebook (EPUB, PDF, MOBI, AZW3, CBZ, CBR, FB2…) with optional title, authors, tags, shelves, series, cover. Skips it if the same file, or a book with the same ISBN, is already there. |
| `get_highlights` | Your highlights and notes in a book. |
| `login`, `auth_status` | Link your account from inside the chat, and check the setup. |

The eight tool descriptions cost about 925 tokens per request.

## Install

Part of [mcp-servers](../..):

```sh
git clone git@github.com:Yejashi/mcp-servers.git && cd mcp-servers
npm install            # builds every server, this one into servers/bookfusion/dist/
cd servers/bookfusion
npm test
```

Needs Node 20 or later. The commands below run from `servers/bookfusion`.

## Set up

Two credentials, both stored in `~/.config/bookfusion-mcp/credentials.json`
(mode 600):

1. **Library login** (list, search, download, highlights):

   ```sh
   node dist/cli.js login
   ```

   Open the link it prints and approve the code. BookFusion lists the
   connection as a **KOReader** device: its library API only accepts
   registered clients, and this server uses the one BookFusion's own KOReader
   plugin uses. Remove the device on bookfusion.com to revoke it. The `login`
   tool does the same from inside a chat.

2. **Upload key** (upload): on bookfusion.com, *Settings → Integrations →
   Calibre → Create API Key*, then

   ```sh
   node dist/cli.js set-api-key     # prompts without echo, checks the key
   ```

`node dist/cli.js status` checks both. `logout` forgets them.

Environment variables override the file: `BOOKFUSION_TOKEN`,
`BOOKFUSION_API_KEY`; `BOOKFUSION_DOWNLOAD_DIR` changes where downloads go.

## Add it to a client

**OpenCode** (also Tellico sessions), `~/.config/opencode/opencode.json`:

```json
{ "mcp": { "bookfusion": { "type": "local", "command": ["node", "/path/to/mcp-servers/servers/bookfusion/dist/cli.js"] } } }
```

**Claude Code**:

```sh
claude mcp add bookfusion -- node /path/to/mcp-servers/servers/bookfusion/dist/cli.js
```

**VS Code** (`.vscode/mcp.json` or your user `mcp.json`):

```json
{ "servers": { "bookfusion": { "type": "stdio", "command": "node", "args": ["/path/to/mcp-servers/servers/bookfusion/dist/cli.js"] } } }
```

## How it works

BookFusion has no public API. This server speaks the two private APIs its
own open-source plugins use, as read from their source:

- **`/api/user/*`** from the KOReader plugin (`bf_api.lua`): OAuth device
  login, `books/search` (paginated by `total-count` headers),
  `bookshelves/search`, `series/search`, `highlights/search`, and
  `books/{id}/download`, which returns a short-lived pre-signed link.
- **`/calibre-api/v1/*`** from the Calibre plugin (`upload_worker.py`):
  `uploads/{digest}` to find a file already uploaded, `uploads/init` for a
  pre-signed storage target, the file POSTed there, and `uploads/finalize`
  with the metadata. The digest is the plugin's own -- sha256 over *size*
  zero bytes, a NUL, then the file -- so a book uploaded from Calibre is
  recognised here too.

Because the APIs are private, BookFusion may change them. Store purchases
usually cannot be downloaded (the listing marks them `no download`).

## Notes

- Only ebook files can be uploaded, so an agent cannot send arbitrary local
  files to BookFusion. The upload size limit is BookFusion's (100 MB at the
  time of writing; `auth_status` shows it).
- Duplicate detection only knows files uploaded through this API: a book you
  added in the web app, or the EPUB BookFusion gives back on download, has a
  different digest. Pass `isbn` to catch those.
- `npm test` drives the built server over stdio with the MCP SDK's client,
  against a fake BookFusion (`test/fake.ts`); nothing touches your account.

## License

MIT. Not affiliated with BookFusion.
