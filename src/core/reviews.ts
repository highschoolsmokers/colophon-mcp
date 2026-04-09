// ---------------------------------------------------------------------------
// Reviews and ratings aggregation
// ---------------------------------------------------------------------------

import { cached } from "./cache.js";

// ---------------------------------------------------------------------------
// Review/rating link generators (no API key needed)
// ---------------------------------------------------------------------------

export function nytReviewUrl(title: string, author?: string): string {
  const q = author ? `${title} ${author}` : title;
  return `https://www.nytimes.com/search?query=${encodeURIComponent(q)}&sort=best&sections=Books`;
}

export function goodreadsUrl(isbn: string): string {
  return `https://www.goodreads.com/search?q=${isbn}`;
}

export function storygraphUrl(isbn: string): string {
  return `https://app.thestorygraph.com/browse?search_term=${isbn}`;
}

export function librarythingUrl(isbn: string): string {
  return `https://www.librarything.com/isbn/${isbn}`;
}

// ---------------------------------------------------------------------------
// Open Library ratings (no auth required)
// ---------------------------------------------------------------------------

interface OLRatingsResponse {
  summary?: {
    average?: number;
    count?: number;
  };
}

interface OLBookshelvesResponse {
  counts?: {
    want_to_read?: number;
    currently_reading?: number;
    already_read?: number;
  };
}

export interface BookRatings {
  average?: number;
  count?: number;
  wantToRead?: number;
  currentlyReading?: number;
  alreadyRead?: number;
}

export async function getOpenLibraryRatings(
  workKey: string,
): Promise<BookRatings | null> {
  const key = `ol:ratings:${workKey}`;
  return cached(key, () => _getOpenLibraryRatings(workKey));
}

async function _getOpenLibraryRatings(
  workKey: string,
): Promise<BookRatings | null> {
  try {
    const [ratingsRes, shelvesRes] = await Promise.allSettled([
      fetch(`https://openlibrary.org/works/${workKey}/ratings.json`, {
        headers: { "User-Agent": "ColophonMCP/1.0" },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`https://openlibrary.org/works/${workKey}/bookshelves.json`, {
        headers: { "User-Agent": "ColophonMCP/1.0" },
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    let average: number | undefined;
    let count: number | undefined;
    let wantToRead: number | undefined;
    let currentlyReading: number | undefined;
    let alreadyRead: number | undefined;

    if (ratingsRes.status === "fulfilled" && ratingsRes.value.ok) {
      const data = (await ratingsRes.value.json()) as OLRatingsResponse;
      average = data.summary?.average;
      count = data.summary?.count;
    }

    if (shelvesRes.status === "fulfilled" && shelvesRes.value.ok) {
      const data = (await shelvesRes.value.json()) as OLBookshelvesResponse;
      wantToRead = data.counts?.want_to_read;
      currentlyReading = data.counts?.currently_reading;
      alreadyRead = data.counts?.already_read;
    }

    if (
      average === undefined &&
      count === undefined &&
      wantToRead === undefined
    ) {
      return null;
    }

    return { average, count, wantToRead, currentlyReading, alreadyRead };
  } catch (err) {
    console.error("Open Library ratings fetch failed:", workKey, err);
    return null;
  }
}

/**
 * Try to find an Open Library work key for a given ISBN.
 */
export async function getWorkKeyByIsbn(isbn: string): Promise<string | null> {
  const key = `ol:workkey:${isbn}`;
  return cached(key, async () => {
    try {
      const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
        headers: { "User-Agent": "ColophonMCP/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { works?: Array<{ key: string }> };
      const workPath = data.works?.[0]?.key;
      return workPath ? workPath.replace("/works/", "") : null;
    } catch (err) {
      console.error("Work key lookup failed:", isbn, err);
      return null;
    }
  });
}

/**
 * Get all review/rating links for a book.
 */
export interface ReviewLinks {
  ratings?: BookRatings;
  links: Array<{ name: string; url: string }>;
}

export async function getReviewLinks(params: {
  isbn?: string;
  title: string;
  author?: string;
}): Promise<ReviewLinks> {
  const links: Array<{ name: string; url: string }> = [
    { name: "NYT Books", url: nytReviewUrl(params.title, params.author) },
  ];

  if (params.isbn) {
    links.push(
      { name: "Goodreads", url: goodreadsUrl(params.isbn) },
      { name: "The StoryGraph", url: storygraphUrl(params.isbn) },
      { name: "LibraryThing", url: librarythingUrl(params.isbn) },
    );
  }

  // Try to get Open Library ratings
  let ratings: BookRatings | null = null;
  if (params.isbn) {
    const workKey = await getWorkKeyByIsbn(params.isbn);
    if (workKey) {
      ratings = await getOpenLibraryRatings(workKey);
    }
  }

  return { ratings: ratings ?? undefined, links };
}
