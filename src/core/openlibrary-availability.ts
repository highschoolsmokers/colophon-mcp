// ---------------------------------------------------------------------------
// Open Library Read API — check borrow/lending availability
// Docs: https://openlibrary.org/dev/docs/api/read
// No auth required. Rate limit: ~1 req/sec.
// ---------------------------------------------------------------------------

import type { LibraryListing } from "./types.js";

const BASE = "https://openlibrary.org";

interface OLAvailabilityRecord {
  status: string; // "full access" | "lendable" | "checked out" | "restricted" | "borrow_available" | "error"
  identifier?: string;
  itemURL?: string;
  openlibrary_work?: string;
  openlibrary_edition?: string;
  publishDate?: string;
  title?: string;
  author?: string;
  cover?: { small?: string; medium?: string; large?: string };
  publishers?: string[];
  num_waitlist?: number;
  last_waitlist_timestamp?: string;
}

interface OLReadResponse {
  [key: string]: {
    records: Record<string, OLAvailabilityRecord>;
    items: Array<{
      status: string;
      itemURL?: string;
      borrowUrl?: string;
      fromRecord?: string;
    }>;
  };
}

/**
 * Check lending/borrow availability on Open Library (Internet Archive)
 * for a given ISBN.
 */
export async function checkAvailabilityByIsbn(isbn: string): Promise<{
  libraries: LibraryListing[];
}> {
  try {
    const url = `${BASE}/api/volumes/brief/isbn/${isbn}.json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ColophonMCP/1.0 (book-lookup-mcp-server)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return { libraries: [] };

    const data = (await res.json()) as OLReadResponse;

    const libraries: LibraryListing[] = [];

    for (const key of Object.keys(data)) {
      const entry = data[key];

      // Process items for availability
      for (const item of entry.items ?? []) {
        const status = item.status?.toLowerCase() ?? "";
        const available =
          status.includes("full access") ||
          status.includes("lendable") ||
          status.includes("borrow_available");
        const checkedOut = status.includes("checked out");

        if (available || checkedOut) {
          libraries.push({
            title: "",
            authors: [],
            isbn,
            library: "Internet Archive / Open Library",
            system: "Open Library Lending",
            format: "digital",
            available,
            url:
              item.itemURL ??
              item.borrowUrl ??
              `https://openlibrary.org/isbn/${isbn}`,
            appDeepLink: `https://openlibrary.org/isbn/${isbn}`,
          });
          break; // One entry per record is enough
        }
      }

      // If no items, check records directly
      if (libraries.length === 0) {
        for (const recKey of Object.keys(entry.records ?? {})) {
          const rec = entry.records[recKey];
          const status = rec.status?.toLowerCase() ?? "";
          const available =
            status.includes("full access") ||
            status.includes("lendable") ||
            status.includes("borrow_available");
          const checkedOut = status.includes("checked out");

          if (available || checkedOut) {
            libraries.push({
              title: rec.title ?? "",
              authors: rec.author ? [rec.author] : [],
              isbn,
              library: "Internet Archive / Open Library",
              system: "Open Library Lending",
              format: "digital",
              available,
              waitlist: rec.num_waitlist,
              url: rec.itemURL ?? `https://openlibrary.org/isbn/${isbn}`,
              appDeepLink: `https://openlibrary.org/isbn/${isbn}`,
            });
            break;
          }
        }
      }
    }

    // If nothing found in the Read API, check the availability endpoint directly
    if (libraries.length === 0) {
      const avail = await checkAvailabilityEndpoint(isbn);
      if (avail) libraries.push(avail);
    }

    return { libraries };
  } catch (err) {
    console.error("Open Library availability check failed:", isbn, err);
    return { libraries: [] };
  }
}

/**
 * Fallback: use the Open Library availability API v2.
 */
async function checkAvailabilityEndpoint(
  isbn: string,
): Promise<LibraryListing | null> {
  try {
    const url = `${BASE}/isbn/${isbn}.json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ColophonMCP/1.0 (book-lookup-mcp-server)" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const edition = (await res.json()) as {
      title?: string;
      authors?: Array<{ key: string }>;
      ocaid?: string;
    };

    if (edition.ocaid) {
      return {
        title: edition.title ?? "",
        authors: [],
        isbn,
        library: "Internet Archive / Open Library",
        system: "Open Library Lending",
        format: "digital",
        available: true,
        url: `https://archive.org/details/${edition.ocaid}`,
        appDeepLink: `https://openlibrary.org/isbn/${isbn}`,
      };
    }

    return null;
  } catch (err) {
    console.error("Open Library edition lookup failed:", err);
    return null;
  }
}
