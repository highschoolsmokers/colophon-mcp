// ---------------------------------------------------------------------------
// Deduplicate book results from multiple sources
// ---------------------------------------------------------------------------

interface Deduplicable {
  title: string;
  authors?: string[];
  description?: string;
  editions: Array<{
    isbn?: string;
    isbn13?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Title normalization — handles punctuation, subtitles, articles
// ---------------------------------------------------------------------------

/**
 * Normalize a title for comparison:
 * - lowercase
 * - strip leading articles (the, a, an)
 * - strip subtitle after colon/dash
 * - strip punctuation and extra whitespace
 */
function normalizeTitle(title: string): string {
  let t = title.toLowerCase();
  // Remove subtitle (after : or — or -)
  t = t.replace(/[:–—\-]\s*.+$/, "");
  // Remove leading articles
  t = t.replace(/^(the|a|an)\s+/i, "");
  // Strip all non-alphanumeric
  t = t.replace(/[^a-z0-9]/g, "");
  return t.trim();
}

// ---------------------------------------------------------------------------
// Author name normalization — handles variants like:
// "C.S. Lewis" vs "Clive Staples Lewis" vs "C. S. Lewis"
// ---------------------------------------------------------------------------

/**
 * Normalize an author name for comparison:
 * - lowercase
 * - strip periods, commas, extra spaces
 * - reduce initials (C S → cs)
 * - extract last name as primary key
 */
function normalizeAuthor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the "last name" from an author name.
 * Handles "First Last", "First Middle Last", "Last, First".
 */
function authorLastName(name: string): string {
  const n = name.trim();
  // "Last, First" format
  if (n.includes(",")) {
    return n.split(",")[0].toLowerCase().trim();
  }
  // "First Last" — take the last word
  const parts = n.split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Check if two author names likely refer to the same person.
 * Handles initials, name order, and common variants.
 */
function sameAuthor(a: string, b: string): boolean {
  const na = normalizeAuthor(a);
  const nb = normalizeAuthor(b);

  // Exact match after normalization
  if (na === nb) return true;

  // Same last name check
  const lastA = authorLastName(a);
  const lastB = authorLastName(b);
  if (lastA !== lastB) return false;

  // If last names match, check if first names are compatible
  // (initials match, or one is an abbreviation of the other)
  const partsA = na.split(" ").filter((p) => p !== lastA);
  const partsB = nb.split(" ").filter((p) => p !== lastB);

  // One has no first name info
  if (partsA.length === 0 || partsB.length === 0) return true;

  // Check if first parts are compatible (initial matches full name)
  const firstA = partsA[0];
  const firstB = partsB[0];

  // "cs" matches "clive staples" (initials)
  if (firstA.length <= 2 && firstB.startsWith(firstA[0])) return true;
  if (firstB.length <= 2 && firstA.startsWith(firstB[0])) return true;

  // First name starts with same letter (initial match)
  if (firstA[0] === firstB[0]) return true;

  return false;
}

/**
 * Merge author lists, collapsing variants into the longest form.
 * E.g., ["C.S. Lewis"] + ["Clive Staples Lewis"] → ["Clive Staples Lewis"]
 */
export function mergeAuthors(
  existing: string[],
  incoming: string[],
): string[] {
  const result = [...existing];

  for (const inc of incoming) {
    const matchIdx = result.findIndex((r) => sameAuthor(r, inc));
    if (matchIdx >= 0) {
      // Keep the longer name
      if (inc.length > result[matchIdx].length) {
        result[matchIdx] = inc;
      }
    } else {
      result.push(inc);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fuzzy title matching — catches more duplicates
// ---------------------------------------------------------------------------

/**
 * Check if two titles are likely the same work.
 * Uses normalized comparison + Jaccard similarity on words.
 */
function sameTitleFuzzy(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);

  // Exact normalized match
  if (na === nb) return true;

  // One contains the other (e.g., "Stoner" vs "Stoner: A Novel")
  if (na.includes(nb) || nb.includes(na)) return true;

  // Word-level Jaccard similarity (for reordered words, minor differences)
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));

  // Remove stop words
  const stops = new Set(["the", "a", "an", "of", "and", "in", "to", "for"]);
  const filteredA = new Set([...wordsA].filter((w) => !stops.has(w)));
  const filteredB = new Set([...wordsB].filter((w) => !stops.has(w)));

  if (filteredA.size === 0 || filteredB.size === 0) return false;

  const intersection = [...filteredA].filter((w) => filteredB.has(w)).length;
  const union = new Set([...filteredA, ...filteredB]).size;
  const jaccard = intersection / union;

  return jaccard >= 0.8;
}

// ---------------------------------------------------------------------------
// Main dedup function
// ---------------------------------------------------------------------------

/**
 * Deduplicate a list of results by fuzzy title matching.
 * Merges editions and author name variants when duplicates are found.
 */
export function dedup<T extends Deduplicable>(results: T[]): T[] {
  const merged: T[] = [];

  for (const item of results) {
    // Find existing entry that matches
    const existingIdx = merged.findIndex(
      (existing) =>
        sameTitleFuzzy(existing.title, item.title) &&
        // If both have authors, at least one must match
        (!existing.authors?.length ||
          !item.authors?.length ||
          existing.authors.some((a) =>
            item.authors!.some((b) => sameAuthor(a, b)),
          )),
    );

    if (existingIdx >= 0) {
      const existing = merged[existingIdx];

      // Merge editions
      const existingIsbns = new Set(
        existing.editions.map((e) => e.isbn13 ?? e.isbn).filter(Boolean),
      );
      for (const ed of item.editions) {
        const edIsbn = ed.isbn13 ?? ed.isbn;
        if (!edIsbn || !existingIsbns.has(edIsbn)) {
          existing.editions.push(ed);
          if (edIsbn) existingIsbns.add(edIsbn);
        }
      }

      // Merge authors (keep longest name variants)
      if (item.authors?.length) {
        existing.authors = mergeAuthors(
          existing.authors ?? [],
          item.authors,
        );
      }

      // Use the longer description
      if (!existing.description && item.description) {
        existing.description = item.description;
      }
    } else {
      merged.push({ ...item });
    }
  }

  return merged;
}
