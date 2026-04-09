// ---------------------------------------------------------------------------
// Google Books API client
// Docs: https://developers.google.com/books/docs/v1/using
// No auth required for public volume searches. Rate limited.
// ---------------------------------------------------------------------------

import type {
  BookResult,
  Edition,
  TitleMatch,
  AuthorTitle,
  BookQuery,
  KeywordMatch,
  PurchaseListing,
} from "./types.js";
import { cached } from "./cache.js";

const BASE = "https://www.googleapis.com/books/v1";

// ---------------------------------------------------------------------------
// Raw API response types (what Google Books actually returns)
// ---------------------------------------------------------------------------

interface GBImageLinks {
  smallThumbnail?: string;
  thumbnail?: string;
  small?: string;
  medium?: string;
  large?: string;
}

interface GBIndustryIdentifier {
  type: string; // "ISBN_10" | "ISBN_13" | "OTHER"
  identifier: string;
}

interface GBVolumeInfo {
  title: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  industryIdentifiers?: GBIndustryIdentifier[];
  pageCount?: number;
  categories?: string[];
  imageLinks?: GBImageLinks;
  language?: string;
  printType?: string; // "BOOK" | "MAGAZINE"
  previewLink?: string;
  infoLink?: string;
  canonicalVolumeLink?: string;
}

interface GBSaleInfo {
  listPrice?: { amount: number; currencyCode: string };
  retailPrice?: { amount: number; currencyCode: string };
  buyLink?: string;
  saleability?: string;
}

interface GBAccessInfo {
  epub?: { isAvailable: boolean; acsTokenLink?: string };
  pdf?: { isAvailable: boolean; acsTokenLink?: string };
}

interface GBVolume {
  id: string;
  volumeInfo: GBVolumeInfo;
  saleInfo?: GBSaleInfo;
  accessInfo?: GBAccessInfo;
}

interface GBSearchResponse {
  totalItems: number;
  items?: GBVolume[];
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function gbFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(path, BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "ColophonMCP/1.0 (book-lookup-mcp-server)" },
  });
  if (!res.ok) {
    throw new Error(
      `Google Books ${res.status}: ${res.statusText} (${url.pathname})`,
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function getIsbn(identifiers?: GBIndustryIdentifier[]): {
  isbn10?: string;
  isbn13?: string;
} {
  if (!identifiers) return {};
  const isbn10 = identifiers.find((id) => id.type === "ISBN_10")?.identifier;
  const isbn13 = identifiers.find((id) => id.type === "ISBN_13")?.identifier;
  return { isbn10, isbn13 };
}

function volumeToEdition(vol: GBVolume): Edition {
  const info = vol.volumeInfo;
  const { isbn10, isbn13 } = getIsbn(info.industryIdentifiers);

  return {
    isbn: isbn10 ?? isbn13,
    isbn13,
    format: info.printType?.toLowerCase() === "magazine" ? "magazine" : "book",
    title: info.title + (info.subtitle ? `: ${info.subtitle}` : ""),
    authors: info.authors ?? [],
    publisher: info.publisher ?? "unknown",
    publishDate: info.publishedDate ?? "unknown",
    language: info.language ?? "unknown",
    pageCount: info.pageCount,
    coverImageUrl: info.imageLinks?.thumbnail,
  };
}

function buildKeywordMatches(
  vol: GBVolume,
  keywords: string[],
): KeywordMatch[] {
  if (!keywords.length) return [];
  const matches: KeywordMatch[] = [];
  const info = vol.volumeInfo;

  for (const kw of keywords) {
    const lower = kw.toLowerCase();

    // Check categories (subjects)
    const catHit = info.categories?.find((c) =>
      c.toLowerCase().includes(lower),
    );
    if (catHit) {
      matches.push({ keyword: kw, matchedIn: "subject", snippet: catHit });
    }

    // Check description
    if (info.description) {
      const descLower = info.description.toLowerCase();
      const idx = descLower.indexOf(lower);
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(info.description.length, idx + kw.length + 60);
        matches.push({
          keyword: kw,
          matchedIn: "description",
          snippet: `…${info.description.slice(start, end)}…`,
        });
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Build search query string
// ---------------------------------------------------------------------------

function buildQuery(params: BookQuery): string {
  const parts: string[] = [];

  if (params.isbn) {
    parts.push(`isbn:${params.isbn}`);
  }
  if (params.title) {
    parts.push(`intitle:${params.title}`);
  }
  if (params.author) {
    parts.push(`inauthor:${params.author}`);
  }
  if (params.keywords?.length) {
    parts.push(params.keywords.join(" "));
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Public API: search
// ---------------------------------------------------------------------------

export function search(params: BookQuery): Promise<{
  results: BookResult[];
}> {
  const key = `gb:search:${JSON.stringify(params)}`;
  return cached(key, () => _search(params));
}

async function _search(params: BookQuery): Promise<{
  results: BookResult[];
}> {
  const q = buildQuery(params);
  if (!q) return { results: [] };

  const data = await gbFetch<GBSearchResponse>("/volumes", {
    q,
    maxResults: "20",
    printType: "books",
  });

  if (!data.items?.length) return { results: [] };

  const results: BookResult[] = data.items.map((vol) => {
    const info = vol.volumeInfo;

    let keywordMatches: KeywordMatch[] | undefined;
    if (params.keywords?.length) {
      const matches = buildKeywordMatches(vol, params.keywords);
      if (matches.length) keywordMatches = matches;
    }

    return {
      title: info.title + (info.subtitle ? `: ${info.subtitle}` : ""),
      authors: info.authors ?? [],
      description: info.description,
      subjects: info.categories,
      editions: [volumeToEdition(vol)],
      keywordMatches,
      buyNew: [],
      buyUsed: [],
      libraries: [],
    } satisfies BookResult;
  });

  return { results };
}

// ---------------------------------------------------------------------------
// Public API: search by title (fuzzy)
// ---------------------------------------------------------------------------

export function searchByTitle(params: {
  title: string;
  limit: number;
}): Promise<{ query: string; results: TitleMatch[] }> {
  const key = `gb:title:${params.title}:${params.limit}`;
  return cached(key, () => _searchByTitle(params));
}

async function _searchByTitle(params: {
  title: string;
  limit: number;
}): Promise<{ query: string; results: TitleMatch[] }> {
  const data = await gbFetch<GBSearchResponse>("/volumes", {
    q: `intitle:${params.title}`,
    maxResults: Math.min(params.limit, 40).toString(),
    printType: "books",
  });

  if (!data.items?.length) return { query: params.title, results: [] };

  const queryLower = params.title.toLowerCase();

  const results: TitleMatch[] = data.items.map((vol, index) => {
    const info = vol.volumeInfo;
    const titleLower = info.title.toLowerCase();
    const exactMatch = titleLower === queryLower ? 1.0 : 0;
    const containsMatch = titleLower.includes(queryLower) ? 0.8 : 0;
    const positionScore = Math.max(0, 1 - index / data.items!.length) * 0.6;
    const confidence = Math.min(
      1,
      Math.max(exactMatch, containsMatch, positionScore),
    );

    return {
      title: info.title,
      subtitle: info.subtitle,
      authors: info.authors ?? [],
      firstPublished: info.publishedDate,
      editions: [volumeToEdition(vol)],
      confidence: Math.round(confidence * 100) / 100,
    };
  });

  results.sort((a, b) => b.confidence - a.confidence);

  return { query: params.title, results };
}

// ---------------------------------------------------------------------------
// Public API: search by author
// ---------------------------------------------------------------------------

export function searchByAuthor(params: {
  author: string;
  sortBy: "date" | "title";
  limit: number;
}): Promise<{ author: string; totalTitles?: number; titles: AuthorTitle[] }> {
  const key = `gb:author:${params.author}:${params.sortBy}:${params.limit}`;
  return cached(key, () => _searchByAuthor(params));
}

async function _searchByAuthor(params: {
  author: string;
  sortBy: "date" | "title";
  limit: number;
}): Promise<{ author: string; totalTitles?: number; titles: AuthorTitle[] }> {
  const data = await gbFetch<GBSearchResponse>("/volumes", {
    q: `inauthor:${params.author}`,
    maxResults: Math.min(params.limit, 40).toString(),
    orderBy: params.sortBy === "title" ? "relevance" : "newest",
    printType: "books",
  });

  if (!data.items?.length) {
    return { author: params.author, totalTitles: 0, titles: [] };
  }

  // Deduplicate by title (Google Books returns multiple editions as separate volumes)
  const seenTitles = new Map<string, AuthorTitle>();

  for (const vol of data.items) {
    const info = vol.volumeInfo;
    const titleKey = info.title.toLowerCase();

    if (seenTitles.has(titleKey)) {
      // Add as an additional edition
      seenTitles.get(titleKey)!.editions.push(volumeToEdition(vol));
    } else {
      seenTitles.set(titleKey, {
        title: info.title,
        authors: info.authors ?? [params.author],
        firstPublished: info.publishedDate,
        editions: [volumeToEdition(vol)],
      });
    }
  }

  const titles = Array.from(seenTitles.values());

  if (params.sortBy === "date") {
    titles.sort((a, b) => {
      const yearA = parseInt(a.firstPublished ?? "9999");
      const yearB = parseInt(b.firstPublished ?? "9999");
      return yearA - yearB;
    });
  }

  return {
    author: params.author,
    totalTitles: data.totalItems,
    titles,
  };
}

// ---------------------------------------------------------------------------
// Public API: check ebook/audiobook availability
// ---------------------------------------------------------------------------

export function checkEbookAvailability(params: {
  isbn?: string;
  title?: string;
  author?: string;
}): Promise<{ ebooks: PurchaseListing[]; audiobooks: PurchaseListing[] }> {
  const key = `gb:ebook:${JSON.stringify(params)}`;
  return cached(key, () => _checkEbookAvailability(params));
}

async function _checkEbookAvailability(params: {
  isbn?: string;
  title?: string;
  author?: string;
}): Promise<{
  ebooks: PurchaseListing[];
  audiobooks: PurchaseListing[];
}> {
  // Build query — prefer ISBN for precision
  let q: string;
  if (params.isbn) {
    q = `isbn:${params.isbn}`;
  } else if (params.title) {
    q =
      `intitle:${params.title}` +
      (params.author ? ` inauthor:${params.author}` : "");
  } else {
    return { ebooks: [], audiobooks: [] };
  }

  let data: GBSearchResponse;
  try {
    data = await gbFetch<GBSearchResponse>("/volumes", {
      q,
      maxResults: "5",
    });
  } catch (err) {
    console.error("Google Books ebook check failed:", err);
    return { ebooks: [], audiobooks: [] };
  }

  if (!data.items?.length) return { ebooks: [], audiobooks: [] };

  const ebooks: PurchaseListing[] = [];
  const audiobooks: PurchaseListing[] = [];

  for (const vol of data.items) {
    const info = vol.volumeInfo;
    const sale = vol.saleInfo;
    const access = vol.accessInfo;
    const title = info.title + (info.subtitle ? `: ${info.subtitle}` : "");
    const authors = info.authors ?? [];
    const { isbn13, isbn10 } = getIsbn(info.industryIdentifiers);

    const hasEpub = access?.epub?.isAvailable ?? false;
    const hasPdf = access?.pdf?.isAvailable ?? false;
    const saleability = sale?.saleability ?? "";

    if (
      hasEpub ||
      hasPdf ||
      saleability === "FOR_SALE" ||
      saleability === "FREE"
    ) {
      const price = sale?.retailPrice
        ? `${sale.retailPrice.currencyCode} ${sale.retailPrice.amount.toFixed(2)}`
        : saleability === "FREE"
          ? "Free"
          : "See link";

      const formats: string[] = [];
      if (hasEpub) formats.push("EPUB");
      if (hasPdf) formats.push("PDF");

      ebooks.push({
        title,
        authors,
        isbn: isbn13 ?? isbn10,
        seller: "Google Play Books",
        condition: "new",
        price,
        currency: sale?.retailPrice?.currencyCode ?? "USD",
        url:
          sale?.buyLink ??
          info.canonicalVolumeLink ??
          `https://play.google.com/store/books/details?id=${vol.id}`,
        shippingNote: formats.length
          ? `Formats: ${formats.join(", ")}`
          : undefined,
      });
    }
  }

  return { ebooks, audiobooks };
}
