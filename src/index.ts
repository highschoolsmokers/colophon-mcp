import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

const server = new McpServer({
  name: "colophon",
  version: "1.0.0",
});

// --- Tool: search_books ---
// Look up books by title, author, keywords, ISBN/EAN, or any combination.
server.tool(
  "search_books",
  "Search for books by title, author, keywords, ISBN/EAN, or any combination",
  {
    title: z.string().optional().describe("Book title or partial title"),
    author: z.string().optional().describe("Author name"),
    keywords: z
      .array(z.string())
      .optional()
      .describe("Subject keywords to search for"),
    isbn: z
      .string()
      .optional()
      .describe("ISBN-10, ISBN-13, or EAN identifier"),
  },
  async ({ title, author, keywords, isbn }) => {
    // TODO: wire up to a real book search API (e.g. Open Library, Google Books)
    const query = buildSearchQuery({ title, author, keywords, isbn });
    const results = await searchBooks(query);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }
);

// --- Tool: find_retailers ---
// Given a book (by ISBN or title+author), return retailers that sell it.
server.tool(
  "find_retailers",
  "Find retailers selling a specific book",
  {
    isbn: z.string().optional().describe("ISBN/EAN of the book"),
    title: z.string().optional().describe("Book title (used if ISBN not provided)"),
    author: z.string().optional().describe("Author name (used with title)"),
  },
  async ({ isbn, title, author }) => {
    const retailers = await findRetailers({ isbn, title, author });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(retailers, null, 2),
        },
      ],
    };
  }
);

// --- Tool: check_library_availability ---
// Check availability of a book in library systems.
server.tool(
  "check_library_availability",
  "Check if a book is available in library systems (e.g. Libby, OverDrive, local libraries)",
  {
    isbn: z.string().optional().describe("ISBN/EAN of the book"),
    title: z.string().optional().describe("Book title"),
    author: z.string().optional().describe("Author name"),
  },
  async ({ isbn, title, author }) => {
    const availability = await checkLibraryAvailability({ isbn, title, author });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(availability, null, 2),
        },
      ],
    };
  }
);

// --- Tool: check_electronic_availability ---
// Check if a book is available electronically (ebook, audiobook).
server.tool(
  "check_electronic_availability",
  "Check electronic availability of a book (ebook, audiobook) across platforms",
  {
    isbn: z.string().optional().describe("ISBN/EAN of the book"),
    title: z.string().optional().describe("Book title"),
    author: z.string().optional().describe("Author name"),
  },
  async ({ isbn, title, author }) => {
    const availability = await checkElectronicAvailability({
      isbn,
      title,
      author,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(availability, null, 2),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Stub implementations — these will be replaced with real API integrations
// ---------------------------------------------------------------------------

interface BookQuery {
  title?: string;
  author?: string;
  keywords?: string[];
  isbn?: string;
}

function buildSearchQuery(params: BookQuery): string {
  const parts: string[] = [];
  if (params.isbn) parts.push(`isbn:${params.isbn}`);
  if (params.title) parts.push(`title:${params.title}`);
  if (params.author) parts.push(`author:${params.author}`);
  if (params.keywords?.length) parts.push(`subject:${params.keywords.join("+")}`);
  return parts.join(" ");
}

async function searchBooks(query: string) {
  // TODO: integrate with Open Library Search API, Google Books API, etc.
  return {
    query,
    results: [],
    message:
      "Book search not yet implemented. Wire up an API in src/index.ts → searchBooks().",
  };
}

async function findRetailers(_params: {
  isbn?: string;
  title?: string;
  author?: string;
}) {
  // TODO: integrate with retailer APIs / affiliate links
  // e.g. Amazon Product Advertising API, Bookshop.org, IndieBound, etc.
  return {
    retailers: [],
    message:
      "Retailer lookup not yet implemented. Wire up APIs in src/index.ts → findRetailers().",
  };
}

async function checkLibraryAvailability(_params: {
  isbn?: string;
  title?: string;
  author?: string;
}) {
  // TODO: integrate with OverDrive/Libby API, WorldCat, local library OPAC
  return {
    libraries: [],
    message:
      "Library availability not yet implemented. Wire up APIs in src/index.ts → checkLibraryAvailability().",
  };
}

async function checkElectronicAvailability(_params: {
  isbn?: string;
  title?: string;
  author?: string;
}) {
  // TODO: integrate with Kindle, Apple Books, Google Play Books, Kobo, Audible, etc.
  return {
    platforms: [],
    message:
      "Electronic availability not yet implemented. Wire up APIs in src/index.ts → checkElectronicAvailability().",
  };
}

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Colophon MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
