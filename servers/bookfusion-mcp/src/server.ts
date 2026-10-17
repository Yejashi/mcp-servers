// The MCP server: tools over a BookFusion library. Output is short text, one
// line per item, because every token of it lands in the model's context.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BookFusion, BookFusionError } from "./client.js";
import { downloadDir, loadCredentials, saveCredentials } from "./config.js";
import { bookLine, contentTypeFor, extensionFor, formatSize, highlightText } from "./library.js";
import { describeLoginFailure, DeviceLogin } from "./login.js";
import { downloadBook, uploadBook } from "./transfer.js";

const LISTS = ["currently_reading", "favorites", "planned_to_read", "completed"] as const;
const SORTS = ["added_at-desc", "added_at-asc", "title-asc", "title-desc", "last_read_at-desc"] as const;

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Text => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Text => ({ content: [{ type: "text", text: t }], isError: true });

/** Any error becomes a readable tool error, never a protocol failure. */
function guard<A>(fn: (args: A) => Promise<Text>): (args: A) => Promise<Text> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof BookFusionError && err.status === 401 && /Bearer|logged in|credentials for POST/.test(err.message))
        return fail(`${err.message}\nIf the token was revoked, run the login tool again.`);
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export function createServer(opts: { version: string; fetchImpl?: typeof fetch } = { version: "0.0.0" }) {
  let creds = loadCredentials();
  const client = () => new BookFusion(creds, opts.fetchImpl);
  const login = new DeviceLogin(client, (token) => (creds = { ...creds, token }));
  const server = new McpServer(
    { name: "bookfusion-mcp", version: opts.version },
    {
      instructions:
        "Your BookFusion ebook library. Find books with list_books (ids are in [brackets]), then download_book or get_highlights by id. upload_book adds a local ebook file. If a tool says you are not logged in, call login and give the user the link and code it returns.",
    },
  );

  /** A shelf id from an id or a (case-insensitive) name. */
  const shelfId = async (shelf: string): Promise<string | number> => {
    if (/^\d+$/.test(shelf)) return shelf;
    const shelves = await client().bookshelves();
    const hit = shelves.find((s) => s.name.toLowerCase() === shelf.toLowerCase()) ?? shelves.find((s) => s.name.toLowerCase().includes(shelf.toLowerCase()));
    if (!hit) throw new BookFusionError(404, `No shelf called "${shelf}". Shelves: ${shelves.map((s) => s.name).join(", ") || "none"}.`);
    return hit.id;
  };

  server.registerTool(
    "list_books",
    {
      title: "List or search books",
      description:
        "Books in the user's BookFusion library, newest first: search by title/author, or filter by reading list, shelf or series. Returns one line per book with its [id], formats and progress.",
      inputSchema: {
        query: z.string().optional().describe("Title or author to search for"),
        list: z.enum(LISTS).optional().describe("A reading list"),
        shelf: z.string().optional().describe("Bookshelf name or id"),
        series_id: z.union([z.string(), z.number()]).optional().describe("Series id from list_series"),
        sort: z.enum(SORTS).optional(),
        page: z.number().int().min(1).optional(),
        per_page: z.number().int().min(1).max(100).optional().describe("Default 25"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const page = await client().searchBooks({
        query: a.query || undefined,
        list: a.list,
        bookshelf_id: a.shelf ? await shelfId(a.shelf) : undefined,
        series_id: a.series_id,
        sort: a.sort ?? (a.list === "currently_reading" ? "last_read_at-desc" : undefined),
        page: a.page ?? 1,
        per_page: a.per_page ?? 25,
      });
      if (!page.items.length) return text(a.query ? `No books match "${a.query}".` : "No books found.");
      const n = page.page ?? a.page ?? 1;
      const per = page.perPage ?? a.per_page ?? 25;
      const more = page.total !== undefined && n * per < page.total;
      const head = page.total !== undefined ? `${page.total} book${page.total === 1 ? "" : "s"}; page ${n}${more ? ` (next: page ${n + 1})` : ""}` : `page ${n}`;
      return text([head, ...page.items.map(bookLine)].join("\n"));
    }),
  );

  server.registerTool(
    "list_shelves",
    {
      title: "List bookshelves",
      description: "The user's BookFusion bookshelves, with ids.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const shelves = await client().bookshelves();
      return text(shelves.length ? shelves.map((s) => `[${s.id}] ${s.name}${typeof s.books_count === "number" ? ` (${s.books_count})` : ""}`).join("\n") : "No bookshelves.");
    }),
  );

  server.registerTool(
    "list_series",
    {
      title: "List series",
      description: "Series in the user's library, with ids for list_books.",
      inputSchema: { query: z.string().optional(), page: z.number().int().min(1).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const page = await client().series({ query: a.query || undefined, page: a.page ?? 1, per_page: 50 });
      return text(page.items.length ? page.items.map((s) => `[${s.id}] ${s.title}${typeof s.books_count === "number" ? ` (${s.books_count})` : ""}`).join("\n") : "No series.");
    }),
  );

  server.registerTool(
    "download_book",
    {
      title: "Download a book",
      description: "Downloads a book from the library to a local folder and returns the file path. Uploaded books can be downloaded; BookFusion store purchases usually cannot.",
      inputSchema: {
        book_id: z.union([z.string(), z.number()]).describe("The [id] from list_books"),
        format: z.string().optional().describe("epub, pdf, mobi, azw3, cbz, cbr…; default: EPUB if the book has it"),
        directory: z.string().optional().describe(`Folder to save into; default ${downloadDir()}`),
        title: z.string().optional().describe("Name the file after this title (pass the title from list_books)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async (a) => {
      const wanted = a.format ? contentTypeFor(a.format) : undefined;
      if (a.format && !wanted) return fail(`Unknown format "${a.format}".`);
      const r = await downloadBook(client(), { bookId: a.book_id, contentType: wanted, title: a.title, dir: a.directory || downloadDir() }, opts.fetchImpl);
      return text(`Saved ${r.path} (${formatSize(r.bytes) ?? `${r.bytes} B`}${extensionFor(r.contentType) ? `, ${extensionFor(r.contentType)!.toUpperCase()}` : ""}).`);
    }),
  );

  server.registerTool(
    "upload_book",
    {
      title: "Upload a book",
      description:
        "Uploads a local ebook file (EPUB, PDF, MOBI, AZW3, CBZ, CBR, FB2…) to the library, with optional metadata. Skips the upload if the same file is already there. Needs the Calibre API key.",
      inputSchema: {
        path: z.string().describe("Absolute path to the ebook file"),
        title: z.string().optional().describe("Default: the file name"),
        authors: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        bookshelves: z.array(z.string()).optional().describe("Shelf names to put it on"),
        series: z.string().optional(),
        series_index: z.number().optional(),
        summary: z.string().optional(),
        language: z.string().optional().describe("e.g. en"),
        isbn: z.string().optional(),
        cover_path: z.string().optional().describe("Image file to use as the cover"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const r = await uploadBook(client(), a.path, {
        title: a.title,
        authors: a.authors,
        tags: a.tags,
        bookshelves: a.bookshelves,
        series: a.series ? [{ title: a.series, index: a.series_index }] : undefined,
        summary: a.summary,
        language: a.language,
        isbn: a.isbn,
        coverPath: a.cover_path,
      });
      const where = r.bookId !== undefined ? `[${r.bookId}]${r.title ? ` ${r.title}` : ""}` : r.title ? `"${r.title}"` : "a book";
      if (r.status === "exists") return text(`Already in the library as ${where}; not uploaded again.`);
      return text(
        r.bookId !== undefined
          ? `Uploaded: ${where} is in the library.`
          : `Uploaded "${r.title}". BookFusion is still processing it; it will appear in list_books in a minute or two.`,
      );
    }),
  );

  server.registerTool(
    "get_highlights",
    {
      title: "Get highlights",
      description: "The user's highlights and notes in one book.",
      inputSchema: { book_id: z.union([z.string(), z.number()]) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const hs = await client().highlights(a.book_id);
      return text(hs.length ? `${hs.length} highlight${hs.length === 1 ? "" : "s"}\n\n${hs.map(highlightText).join("\n\n")}` : "No highlights in this book.");
    }),
  );

  server.registerTool(
    "login",
    {
      title: "Log in to BookFusion",
      description:
        "Starts linking this server to the user's BookFusion account. Returns a link and a code for the user to approve; it finishes by itself once they do (check with auth_status). Not needed if already logged in.",
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    guard(async () => {
      const code = await login.start();
      const link = code.verification_uri_complete ?? code.verification_uri;
      return text(
        `Ask the user to open ${link} and approve the code ${code.user_code} (valid ${Math.round(code.expires_in / 60)} minutes). BookFusion shows it as a KOReader device. The login completes automatically; call auth_status to confirm.`,
      );
    }),
  );

  server.registerTool(
    "auth_status",
    {
      title: "BookFusion connection status",
      description: "Whether the library login and the upload key are set up, and the upload quota.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      creds = { ...loadCredentials(), ...(creds.token ? { token: creds.token } : {}) };
      const lines: string[] = [];
      const st = login.state;
      if (st.kind === "waiting") lines.push(`Login pending: waiting for code ${st.code.user_code} to be approved at ${st.code.verification_uri}.`);
      else if (st.kind === "failed") lines.push(describeLoginFailure(st.reason));
      if (creds.token) {
        try {
          await client().bookshelves();
          lines.push("Library: logged in.");
        } catch (err) {
          lines.push(`Library: the saved login does not work (${(err as Error).message}). Call login again.`);
        }
      } else if (st.kind !== "waiting") lines.push("Library: not logged in. Call login.");
      if (creds.apiKey) {
        try {
          const l = await client().limits();
          lines.push(`Uploads: API key works. Limits: ${JSON.stringify(l)}`);
        } catch (err) {
          lines.push(`Uploads: ${(err as Error).message}`);
        }
      } else lines.push("Uploads: no Calibre API key. The user creates one at bookfusion.com → Settings → Integrations → Calibre, then runs `bookfusion-mcp set-api-key`.");
      return text(lines.join("\n"));
    }),
  );

  return { server, login, setApiKey: (apiKey: string) => ((creds = { ...creds, apiKey }), saveCredentials({ apiKey })) };
}
