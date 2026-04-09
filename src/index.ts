import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import type { PurchaseListing, LibraryListing } from "./core/types.js";
import * as openLibrary from "./core/openlibrary.js";
import * as googleBooks from "./core/googlebooks.js";
import * as abebooks from "./core/abebooks.js";
import * as olAvailability from "./core/openlibrary-availability.js";
import { dedup } from "./core/dedup.js";

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** Fetch an image URL and return it as a base64 MCP image content block. */
async function fetchImage(
  url: string,
): Promise<{ type: "image"; data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { type: "image" as const, data: base64, mimeType: contentType };
  } catch (err) {
    console.error("Failed to fetch image:", url, err);
    return null;
  }
}

/**
 * Fetch cover images for a list of titles in parallel.
 * Returns image content blocks (up to 10) for clients that render them.
 */
async function fetchCoverImages(
  titles: Array<{ editions: Array<{ coverImageUrl?: string }> }>,
): Promise<ContentBlock[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const url = findCoverUrl(t.editions);
    if (url && !seen.has(url)) {
      seen.add(url);
      const sizes = coverSizes(url);
      urls.push(sizes.thumbnail);
    }
  }
  const fetches = urls.slice(0, 10).map((u) => fetchImage(u));
  const results = await Promise.all(fetches);
  return results.filter((img): img is NonNullable<typeof img> => img !== null);
}

/** Find the first available cover URL from an array of editions. */
function findCoverUrl(
  editions: Array<{ coverImageUrl?: string }>,
): string | undefined {
  return editions.find((e) => e.coverImageUrl)?.coverImageUrl;
}

/**
 * Convert a cover URL to small thumbnail and full-size variants.
 * Open Library: replace -M.jpg with -S.jpg (thumb) / -L.jpg (full)
 * Google Books: use zoom=1 (thumb) / zoom=3 (full) if applicable
 */
function coverSizes(url: string): { thumbnail: string; full: string } {
  // Open Library pattern: /b/id/{id}-{S|M|L}.jpg
  if (url.includes("covers.openlibrary.org")) {
    return {
      thumbnail: url.replace(/-[SML]\.jpg/, "-S.jpg"),
      full: url.replace(/-[SML]\.jpg/, "-L.jpg"),
    };
  }
  // Google Books pattern: ...&zoom=1
  if (url.includes("books.google")) {
    return {
      thumbnail: url.replace(/zoom=\d/, "zoom=1"),
      full: url.replace(/zoom=\d/, "zoom=3"),
    };
  }
  return { thumbnail: url, full: url };
}

interface TitleWithEditions {
  title: string;
  authors?: string[];
  firstPublished?: string;
  editions: Array<{
    isbn?: string;
    isbn13?: string;
    publisher?: string;
    publishDate?: string;
    coverImageUrl?: string;
  }>;
}

/**
 * Build a text summary for each title with inline markdown cover images.
 */
function buildTitleText(titles: TitleWithEditions[]): string {
  const lines: string[] = [];

  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    const isbn = t.editions[0]?.isbn13 ?? t.editions[0]?.isbn ?? "—";
    const publisher = t.editions[0]?.publisher ?? "unknown";
    const year = t.firstPublished ?? t.editions[0]?.publishDate ?? "—";
    const authors = t.authors?.join(", ") ?? "unknown";
    const coverUrl = findCoverUrl(t.editions);
    const sizes = coverUrl ? coverSizes(coverUrl) : null;

    let line = "";
    if (sizes) {
      line += `![${t.title} cover](${sizes.thumbnail})\n`;
    }
    line += `${i + 1}. **${t.title}**\n`;
    line += `   ${authors} | ${publisher}, ${year} | ISBN: ${isbn} | ${t.editions.length} edition(s)`;
    if (sizes) {
      line += `\n   [Full cover](${sizes.full})`;
    }
    lines.push(line);
  }

  return lines.join("\n\n");
}

const server = new McpServer({
  name: "colophon",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// --- Tool: search_books ---
server.tool(
  "search_books",
  "Search for books and return all available editions, where to buy new and used (with prices and links), and which libraries have it",
  {
    title: z
      .string()
      .optional()
      .describe("Book title — supports fuzzy/partial matching"),
    author: z.string().optional().describe("Author name"),
    keywords: z
      .union([
        z.array(z.string()),
        z.string().transform((s) => s.split(",").map((k) => k.trim())),
      ])
      .optional()
      .describe(
        "Keywords to search across descriptions, summaries, subjects, table of contents, and other metadata",
      ),
    isbn: z.string().optional().describe("ISBN-10, ISBN-13, or EAN identifier"),
  },
  async ({ title, author, keywords, isbn }) => {
    const [olResults, gbResults] = await Promise.allSettled([
      openLibrary.search({ title, author, keywords, isbn }),
      googleBooks.search({ title, author, keywords, isbn }),
    ]);

    const results = dedup([
      ...(olResults.status === "fulfilled" ? olResults.value.results : []),
      ...(gbResults.status === "fulfilled" ? gbResults.value.results : []),
    ]);

    const covers = await fetchCoverImages(results);

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${results.length} results.\n\n${buildTitleText(results)}`,
        },
        ...covers,
      ],
    };
  },
);

// --- Tool: search_by_title ---
server.tool(
  "search_by_title",
  "Fuzzy search for books by title — handles partial titles, misspellings, and subtitle matching. Returns all matching works with editions and ISBNs",
  {
    title: z.string().describe("Full or partial book title (fuzzy matching)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 20)"),
  },
  async ({ title, limit }) => {
    const effectiveLimit = limit ?? 20;
    const [olResults, gbResults] = await Promise.allSettled([
      openLibrary.searchByTitle({ title, limit: effectiveLimit }),
      googleBooks.searchByTitle({ title, limit: effectiveLimit }),
    ]);

    const combined = dedup([
      ...(olResults.status === "fulfilled" ? olResults.value.results : []),
      ...(gbResults.status === "fulfilled" ? gbResults.value.results : []),
    ]);
    combined.sort((a, b) => b.confidence - a.confidence);

    const covers = await fetchCoverImages(combined);

    return {
      content: [
        {
          type: "text" as const,
          text: `Title search: "${title}" — ${combined.length} results.\n\n${buildTitleText(combined)}`,
        },
        ...covers,
      ],
    };
  },
);

// --- Tool: search_by_author ---
server.tool(
  "search_by_author",
  "Find all titles by an author — returns every known work with title, ISBNs/EANs, editions, publication dates, and publishers",
  {
    author: z.string().describe("Author name"),
    sortBy: z
      .enum(["date", "title"])
      .optional()
      .describe("Sort results by publication date or title (default: date)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of titles to return (default: 20)"),
  },
  async ({ author, sortBy, limit }) => {
    const effectiveSortBy = sortBy ?? "date";
    const effectiveLimit = limit ?? 20;
    const [olResults, gbResults] = await Promise.allSettled([
      openLibrary.searchByAuthor({
        author,
        sortBy: effectiveSortBy,
        limit: effectiveLimit,
      }),
      googleBooks.searchByAuthor({
        author,
        sortBy: effectiveSortBy,
        limit: effectiveLimit,
      }),
    ]);

    const olData = olResults.status === "fulfilled" ? olResults.value : null;
    const gbData = gbResults.status === "fulfilled" ? gbResults.value : null;

    const titles = dedup([
      ...(olData?.titles ?? []),
      ...(gbData?.titles ?? []),
    ]);

    const authorName = olData?.author ?? gbData?.author ?? author;
    const totalTitles = (olData?.totalTitles ?? 0) + (gbData?.totalTitles ?? 0);
    const bio = olData?.bio;

    // Build author header with bio
    let header = "";
    if (bio?.photoUrl) {
      header += `![${authorName} photo](${bio.photoUrl})\n\n`;
    }
    header += `**${authorName}**`;
    if (bio?.birthDate || bio?.deathDate) {
      header += ` (${bio.birthDate ?? "?"}–${bio.deathDate ?? "present"})`;
    }
    header += ` — ${totalTitles} titles found.\n`;
    if (bio?.bio) {
      header += `\n${bio.bio}\n`;
    }

    header += `\n${buildTitleText(titles)}`;

    // Fetch author photo + cover images for clients that render them
    const imageBlocks: ContentBlock[] = [];
    if (bio?.photoUrl) {
      const photo = await fetchImage(bio.photoUrl);
      if (photo) imageBlocks.push(photo);
    }
    const covers = await fetchCoverImages(titles);
    imageBlocks.push(...covers);

    return {
      content: [
        {
          type: "text" as const,
          text: header,
        },
        ...imageBlocks,
      ],
    };
  },
);

// --- Tool: find_retailers ---
server.tool(
  "find_retailers",
  "Find where to buy a specific book — returns new and used listings with prices and direct purchase links",
  {
    isbn: z.string().optional().describe("ISBN/EAN of the book"),
    title: z
      .string()
      .optional()
      .describe("Book title (used if ISBN not provided)"),
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
  },
);

// --- Tool: check_library_availability ---
server.tool(
  "check_library_availability",
  "Check which libraries have a book — returns availability, format, waitlist info, and links/app deep links to check it out",
  {
    isbn: z.string().optional().describe("ISBN/EAN of the book"),
    title: z.string().optional().describe("Book title"),
    author: z.string().optional().describe("Author name"),
  },
  async ({ isbn, title, author }) => {
    const availability = await checkLibraryAvailability({
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
  },
);

// --- Tool: check_electronic_availability ---
server.tool(
  "check_electronic_availability",
  "Check electronic availability of a book (ebook, audiobook) across platforms — returns prices and links",
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
  },
);

// ---------------------------------------------------------------------------
// API implementations
// ---------------------------------------------------------------------------

async function findRetailers(params: {
  isbn?: string;
  title?: string;
  author?: string;
}): Promise<{
  title?: string;
  authors?: string[];
  isbn?: string;
  buyNew: PurchaseListing[];
  buyUsed: PurchaseListing[];
  message?: string;
}> {
  // Need an ISBN for AbeBooks lookup
  let isbn = params.isbn;

  // If no ISBN provided, try to find one via search
  if (!isbn && params.title) {
    const search = await googleBooks.search({
      title: params.title,
      author: params.author,
    });
    const firstEdition = search.results[0]?.editions[0];
    isbn = firstEdition?.isbn13 ?? firstEdition?.isbn;
  }

  if (!isbn) {
    return {
      buyNew: [],
      buyUsed: [],
      message: "No ISBN available — provide an ISBN for retailer pricing.",
    };
  }

  const result = await abebooks.lookupByIsbn(isbn);

  return {
    isbn,
    buyNew: result.buyNew,
    buyUsed: result.buyUsed,
    message:
      result.buyNew.length || result.buyUsed.length
        ? `Found pricing on AbeBooks for ISBN ${isbn}.`
        : `No AbeBooks listings found for ISBN ${isbn}.`,
  };
}

async function checkLibraryAvailability(params: {
  isbn?: string;
  title?: string;
  author?: string;
}): Promise<{
  title?: string;
  authors?: string[];
  isbn?: string;
  libraries: LibraryListing[];
  message?: string;
}> {
  let isbn = params.isbn;

  // If no ISBN provided, try to find one via search
  if (!isbn && params.title) {
    const search = await googleBooks.search({
      title: params.title,
      author: params.author,
    });
    const firstEdition = search.results[0]?.editions[0];
    isbn = firstEdition?.isbn13 ?? firstEdition?.isbn;
  }

  if (!isbn) {
    return {
      libraries: [],
      message: "No ISBN available — provide an ISBN for library lookup.",
    };
  }

  const result = await olAvailability.checkAvailabilityByIsbn(isbn);

  return {
    isbn,
    libraries: result.libraries,
    message: result.libraries.length
      ? `Found ${result.libraries.length} lending option(s) on Open Library for ISBN ${isbn}.`
      : `No lending availability found on Open Library for ISBN ${isbn}. Try checking your local library catalog directly.`,
  };
}

async function checkElectronicAvailability(params: {
  isbn?: string;
  title?: string;
  author?: string;
}): Promise<{
  title?: string;
  authors?: string[];
  isbn?: string;
  ebooks: PurchaseListing[];
  audiobooks: PurchaseListing[];
  message?: string;
}> {
  const result = await googleBooks.checkEbookAvailability(params);

  return {
    isbn: params.isbn,
    ebooks: result.ebooks,
    audiobooks: result.audiobooks,
    message: result.ebooks.length
      ? `Found ${result.ebooks.length} ebook listing(s) on Google Play Books.`
      : "No ebook listings found on Google Play Books.",
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
