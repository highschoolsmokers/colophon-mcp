// ---------------------------------------------------------------------------
// Open Library API client
// Docs: https://openlibrary.org/developers/api
// No auth required. Rate limit: ~100 req/5min (be polite).
// ---------------------------------------------------------------------------

import type {
  BookResult,
  Edition,
  TitleMatch,
  AuthorTitle,
  AuthorBio,
  BookQuery,
  KeywordMatch,
} from "./types.js";
import { cached } from "./cache.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { withCircuitBreaker } from "./circuit-breaker.js";

const BASE = "https://openlibrary.org";
const COVERS = "https://covers.openlibrary.org";

// ---------------------------------------------------------------------------
// Raw API response types (what Open Library actually returns)
// ---------------------------------------------------------------------------

interface OLSearchDoc {
  key: string; // e.g. "/works/OL123W"
  title: string;
  subtitle?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  publish_year?: number[];
  publisher?: string[];
  publish_date?: string[];
  isbn?: string[];
  subject?: string[];
  language?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  cover_edition_key?: string;
  edition_count?: number;
  edition_key?: string[];
  first_sentence?: string[];
  ebook_access?: string;
  id_amazon?: string[];
  id_goodreads?: string[];
}

interface OLSearchResponse {
  numFound: number;
  start: number;
  docs: OLSearchDoc[];
}

interface OLEdition {
  key: string;
  title: string;
  publishers?: string[];
  publish_date?: string;
  isbn_10?: string[];
  isbn_13?: string[];
  physical_format?: string;
  number_of_pages?: number;
  languages?: Array<{ key: string }>; // e.g. { key: "/languages/eng" }
  covers?: number[];
  authors?: Array<{ key: string }>;
}

interface OLEditionsResponse {
  entries: OLEdition[];
  size: number;
}

interface OLWork {
  title: string;
  description?: string | { value: string };
  subjects?: string[];
  subject_places?: string[];
  subject_times?: string[];
  subject_people?: string[];
  table_of_contents?: Array<{ title: string; level?: number }>;
  authors?: Array<{ author: { key: string }; type?: { key: string } }>;
}

interface OLAuthorSearchDoc {
  key: string; // e.g. "/authors/OL123A"
  name: string;
  alternate_names?: string[];
  work_count?: number;
  top_work?: string;
  top_subjects?: string[];
}

interface OLAuthorDetail {
  name?: string;
  personal_name?: string;
  bio?: string | { value: string };
  birth_date?: string;
  death_date?: string;
  photos?: number[];
  links?: Array<{ url: string; title: string }>;
}

interface OLAuthorSearchResponse {
  numFound: number;
  docs: OLAuthorSearchDoc[];
}

interface OLAuthorWork {
  title: string;
  key: string;
  authors?: Array<{ author: { key: string } }>;
  first_publish_date?: string;
  covers?: number[];
}

interface OLAuthorWorksResponse {
  entries: OLAuthorWork[];
  size: number;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function olFetch<T>(
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
    headers: { "User-Agent": config.userAgent },
    signal: AbortSignal.timeout(config.apiTimeout),
  });
  if (!res.ok) {
    throw new Error(
      `Open Library ${res.status}: ${res.statusText} (${url.pathname})`,
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Cover URL helper
// ---------------------------------------------------------------------------

function coverUrl(
  coverId?: number,
  size: "S" | "M" | "L" = "M",
): string | undefined {
  if (!coverId) return undefined;
  return `${COVERS}/b/id/${coverId}-${size}.jpg`;
}

function langFromKey(key?: string): string {
  if (!key) return "unknown";
  // "/languages/eng" → "eng"
  return key.split("/").pop() ?? "unknown";
}

// ---------------------------------------------------------------------------
// Parse helpers — convert OL responses to our types
// ---------------------------------------------------------------------------

function parseDescription(
  desc?: string | { value: string },
): string | undefined {
  if (!desc) return undefined;
  return typeof desc === "string" ? desc : desc.value;
}

function searchDocToEditions(doc: OLSearchDoc): Edition[] {
  // The search endpoint doesn't return per-edition detail, so we create
  // a single representative edition from the aggregate fields.
  // For full edition detail, use fetchEditions() with the work key.
  const isbns = doc.isbn ?? [];
  const edition: Edition = {
    isbn: isbns[0],
    isbn13: isbns.find((i) => i.length === 13),
    format: "unknown",
    title: doc.title,
    authors: doc.author_name ?? [],
    publisher: doc.publisher?.[0] ?? "unknown",
    publishDate: doc.first_publish_year?.toString() ?? "unknown",
    language: doc.language?.[0] ?? "unknown",
    pageCount: doc.number_of_pages_median,
    coverImageUrl: coverUrl(doc.cover_i),
  };
  return [edition];
}

function olEditionToEdition(ed: OLEdition, authorNames: string[]): Edition {
  const isbn13 = ed.isbn_13?.[0];
  const isbn10 = ed.isbn_10?.[0];
  return {
    isbn: isbn10 ?? isbn13,
    isbn13,
    format: ed.physical_format?.toLowerCase() ?? "unknown",
    title: ed.title,
    authors: authorNames,
    publisher: ed.publishers?.[0] ?? "unknown",
    publishDate: ed.publish_date ?? "unknown",
    language: langFromKey(ed.languages?.[0]?.key),
    pageCount: ed.number_of_pages,
    coverImageUrl: coverUrl(ed.covers?.[0]),
  };
}

function buildKeywordMatches(
  doc: OLSearchDoc,
  keywords: string[],
): KeywordMatch[] {
  if (!keywords.length) return [];
  const matches: KeywordMatch[] = [];

  for (const kw of keywords) {
    const lower = kw.toLowerCase();

    // Check subjects
    const subjectHit = doc.subject?.find((s) =>
      s.toLowerCase().includes(lower),
    );
    if (subjectHit) {
      matches.push({ keyword: kw, matchedIn: "subject", snippet: subjectHit });
    }

    // Check first sentence
    const sentenceHit = doc.first_sentence?.find((s) =>
      s.toLowerCase().includes(lower),
    );
    if (sentenceHit) {
      matches.push({
        keyword: kw,
        matchedIn: "first_sentence",
        snippet: sentenceHit,
      });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Public API: search
// ---------------------------------------------------------------------------

export function search(params: BookQuery): Promise<{
  results: BookResult[];
}> {
  const key = `ol:search:${JSON.stringify(params)}`;
  return cached(key, () =>
    withCircuitBreaker("openlibrary", () => _search(params), { results: [] }),
  );
}

async function _search(params: BookQuery): Promise<{
  results: BookResult[];
}> {
  const qParts: string[] = [];
  if (params.isbn) qParts.push(params.isbn);
  if (params.title) qParts.push(params.title);
  if (params.author) qParts.push(params.author);
  if (params.keywords?.length) qParts.push(params.keywords.join(" "));

  if (!qParts.length) {
    return { results: [] };
  }

  const searchParams: Record<string, string> = {
    q: qParts.join(" "),
    limit: params.isbn && !params.title ? "5" : "20",
    fields: [
      "key",
      "title",
      "subtitle",
      "author_name",
      "author_key",
      "first_publish_year",
      "publish_year",
      "publisher",
      "isbn",
      "subject",
      "language",
      "number_of_pages_median",
      "cover_i",
      "edition_count",
      "first_sentence",
      "ebook_access",
    ].join(","),
  };

  // Use field-specific params when available for better relevance
  if (params.isbn) {
    searchParams.isbn = params.isbn;
  }
  if (params.title && !params.isbn) {
    searchParams.title = params.title;
  }
  if (params.author) {
    searchParams.author = params.author;
  }

  const data = await olFetch<OLSearchResponse>("/search.json", searchParams);

  const results: BookResult[] = await Promise.all(
    data.docs.map(async (doc) => {
      // Fetch work details for description, TOC, and richer subjects
      let description: string | undefined;
      let tableOfContents: string[] | undefined;
      let fullSubjects: string[] | undefined;
      try {
        const work = await olFetch<OLWork>(`${doc.key}.json`);
        description = parseDescription(work.description);
        if (work.table_of_contents?.length) {
          tableOfContents = work.table_of_contents.map((c) => c.title);
        }
        fullSubjects = [
          ...(work.subjects ?? []),
          ...(work.subject_places ?? []),
          ...(work.subject_times ?? []),
          ...(work.subject_people ?? []),
        ];
      } catch (err) {
        logger.warn({ err, key: doc.key }, "Work detail fetch failed");
      }

      const subjects = fullSubjects?.length ? fullSubjects : doc.subject;

      // Build keyword matches against all available metadata
      let keywordMatches: KeywordMatch[] | undefined;
      if (params.keywords?.length) {
        const matches = buildKeywordMatches(doc, params.keywords);

        // Also check description
        if (description) {
          for (const kw of params.keywords) {
            const lower = kw.toLowerCase();
            if (description.toLowerCase().includes(lower)) {
              const idx = description.toLowerCase().indexOf(lower);
              const start = Math.max(0, idx - 60);
              const end = Math.min(description.length, idx + kw.length + 60);
              matches.push({
                keyword: kw,
                matchedIn: "description",
                snippet: `…${description.slice(start, end)}…`,
              });
            }
          }
        }

        // Check TOC
        if (tableOfContents) {
          for (const kw of params.keywords) {
            const lower = kw.toLowerCase();
            const tocHit = tableOfContents.find((c) =>
              c.toLowerCase().includes(lower),
            );
            if (tocHit) {
              matches.push({ keyword: kw, matchedIn: "toc", snippet: tocHit });
            }
          }
        }

        if (matches.length) keywordMatches = matches;
      }

      return {
        title: doc.title,
        authors: doc.author_name ?? [],
        description,
        subjects,
        tableOfContents,
        keywordMatches,
        editions: searchDocToEditions(doc),
        buyNew: [],
        buyUsed: [],
        libraries: [],
      } satisfies BookResult;
    }),
  );

  return { results };
}

// ---------------------------------------------------------------------------
// Public API: search by title (fuzzy)
// ---------------------------------------------------------------------------

export function searchByTitle(params: {
  title: string;
  limit: number;
}): Promise<{
  query: string;
  results: TitleMatch[];
}> {
  const key = `ol:title:${params.title}:${params.limit}`;
  return cached(key, () => _searchByTitle(params));
}

async function _searchByTitle(params: {
  title: string;
  limit: number;
}): Promise<{
  query: string;
  results: TitleMatch[];
}> {
  const data = await olFetch<OLSearchResponse>("/search.json", {
    title: params.title,
    limit: params.limit.toString(),
    fields: [
      "key",
      "title",
      "subtitle",
      "author_name",
      "first_publish_year",
      "isbn",
      "publisher",
      "publish_date",
      "language",
      "number_of_pages_median",
      "cover_i",
      "edition_count",
    ].join(","),
  });

  const queryLower = params.title.toLowerCase();

  const results: TitleMatch[] = data.docs.map((doc, index) => {
    // Approximate confidence from position in results + title similarity
    const titleLower = doc.title.toLowerCase();
    const exactMatch = titleLower === queryLower ? 1.0 : 0;
    const containsMatch = titleLower.includes(queryLower) ? 0.8 : 0;
    const positionScore = Math.max(0, 1 - index / data.docs.length) * 0.6;
    const confidence = Math.min(
      1,
      Math.max(exactMatch, containsMatch, positionScore),
    );

    return {
      title: doc.title,
      subtitle: doc.subtitle,
      authors: doc.author_name ?? [],
      firstPublished: doc.first_publish_year?.toString(),
      editions: searchDocToEditions(doc),
      confidence: Math.round(confidence * 100) / 100,
    };
  });

  // Sort by confidence descending
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
}): Promise<{
  author: string;
  bio?: AuthorBio;
  totalTitles?: number;
  titles: AuthorTitle[];
}> {
  const key = `ol:author:${params.author}:${params.sortBy}:${params.limit}`;
  return cached(key, () => _searchByAuthor(params));
}

async function _searchByAuthor(params: {
  author: string;
  sortBy: "date" | "title";
  limit: number;
}): Promise<{
  author: string;
  bio?: AuthorBio;
  totalTitles?: number;
  titles: AuthorTitle[];
}> {
  // Step 1: Find the author — fetch several candidates and pick the best match
  const authorSearch = await olFetch<OLAuthorSearchResponse>(
    "/search/authors.json",
    { q: params.author, limit: "5" },
  );

  if (!authorSearch.docs.length) {
    return { author: params.author, totalTitles: 0, titles: [] };
  }

  // Pick the author with the most works (most likely the well-known one)
  const authorDoc = authorSearch.docs.reduce((best, doc) =>
    (doc.work_count ?? 0) > (best.work_count ?? 0) ? doc : best,
  );
  const authorKey = authorDoc.key;
  const authorName = authorDoc.name;
  const authorId = authorKey.replace("/authors/", "");

  // Step 2: Fetch author detail (bio) and works in parallel
  const [authorDetail, worksData] = await Promise.all([
    olFetch<OLAuthorDetail>(`/authors/${authorId}.json`).catch(() => null),
    olFetch<OLAuthorWorksResponse>(`/authors/${authorId}/works.json`, {
      limit: params.limit.toString(),
      ...(params.sortBy === "title" ? { sort: "title" } : {}),
    }),
  ]);

  // Build bio
  let bio: AuthorBio | undefined;
  if (authorDetail) {
    const rawBio = authorDetail.bio;
    const bioText = rawBio
      ? typeof rawBio === "string"
        ? rawBio
        : rawBio.value
      : undefined;
    const photoId = authorDetail.photos?.[0];
    bio = {
      name: authorDetail.name ?? authorName,
      bio: bioText,
      birthDate: authorDetail.birth_date,
      deathDate: authorDetail.death_date,
      photoUrl: photoId ? `${COVERS}/a/id/${photoId}-L.jpg` : undefined,
    };
  }

  // Step 3: Build titles from work-level data (no per-work edition fetching for speed)
  const titles: AuthorTitle[] = worksData.entries.map((work) => ({
    title: work.title,
    authors: [authorName],
    firstPublished: work.first_publish_date,
    editions: [
      {
        format: "unknown",
        title: work.title,
        authors: [authorName],
        publisher: "unknown",
        publishDate: work.first_publish_date ?? "unknown",
        language: "unknown",
        coverImageUrl: coverUrl(work.covers?.[0]),
      },
    ],
  }));

  // Sort by date if requested (default)
  if (params.sortBy === "date") {
    titles.sort((a, b) => {
      const yearA = parseInt(a.firstPublished ?? "9999");
      const yearB = parseInt(b.firstPublished ?? "9999");
      return yearA - yearB;
    });
  }

  return {
    author: authorName,
    bio,
    totalTitles: worksData.size,
    titles,
  };
}
