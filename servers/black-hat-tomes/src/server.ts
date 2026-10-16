// The MCP server: find a book on LibGen and download it. Output is short text,
// one line per book, because every token of it lands in the model's context.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LibGenClient, LibGenError, MIN_BYTES } from "./client.js";
import { downloadDir } from "./config.js";
import { bookLine, formatSize } from "./format.js";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Text => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Text => ({ content: [{ type: "text", text: t }], isError: true });

/** Any error becomes a readable tool error the model can act on, never a protocol failure. */
function guard<A>(fn: (args: A) => Promise<Text>): (args: A) => Promise<Text> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export function createServer(opts: { version: string; fetchImpl?: typeof fetch } = { version: "0.0.0" }) {
  const client = () => new LibGenClient(opts.fetchImpl);
  const server = new McpServer(
    { name: "black-hat-tomes", version: opts.version },
    {
      instructions:
        "LibGen ebook downloads. Use search_books to find a book (ids are in [brackets]); pick an eng/epub candidate, then download_book by id. If a download fails, pick another id for the same title from search.",
    },
  );

  server.registerTool(
    "search_books",
    {
      title: "Search LibGen",
      description:
        "Search LibGen by title or author. One line per candidate: [id], language, format, size; exact matches come first. Defaults to English EPUBs.",
      inputSchema: {
        query: z.string().describe("Title or author"),
        language: z.string().optional().describe("Language to keep, default eng"),
        format: z.string().optional().describe("Format to keep, default epub"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const language = a.language || "eng";
      const format = a.format || "epub";
      const page = a.page ?? 1;
      const limit = a.limit ?? 10;
      const { books } = await client().searchBooks({ query: a.query, from: (page - 1) * 100 });
      // Local filter per the validated method: right language, format and a
      // real size. Fall back to the raw page if that would hide everything.
      const filtered = books.filter((b) => b.language === language && b.fileExtension === format && (b.fileSize ?? 0) >= MIN_BYTES);
      const pool = filtered.length ? filtered : books;
      const shown = pool.slice(0, limit);
      if (!shown.length) return text(`No books match "${a.query}".`);
      const more = pool.length > shown.length ? ` (more on this page${page < 10 ? "; page " + (page + 1) + " for more" : ""})` : "";
      return text([`LibGen candidates for "${a.query}" (${language}/${format}), page ${page}${more}`, ...shown.map(bookLine)].join("\n"));
    }),
  );

  server.registerTool(
    "download_book",
    {
      title: "Download a book",
      description:
        "Download a book by its search id and save it as an ebook file, named from the title and author. Verifies the file before reporting success.",
      inputSchema: {
        id: z.string().describe("Book id from search_books"),
        title: z.string().optional().describe("Title, for the file name"),
        author: z.string().optional().describe("Author, for the file name"),
        directory: z.string().optional().describe("Folder to save into"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const r = await client().download(a.id, { title: a.title, author: a.author, dir: a.directory || downloadDir() });
      return text(`Saved ${r.path} (${formatSize(r.bytes) ?? `${r.bytes} B`}, ${r.ext.toUpperCase()}).`);
    }),
  );

  server.registerTool(
    "status",
    {
      title: "LibGen connection status",
      description: "Whether LibGen search and download are reachable, and where books are saved.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      try {
        await client().searchBooks({ query: "the" });
        return text(`Connected to LibGen. Books save to ${downloadDir()}.`);
      } catch (err) {
        return fail(err instanceof LibGenError ? err.message : "LibGen search is not reachable.");
      }
    }),
  );

  return { server };
}
