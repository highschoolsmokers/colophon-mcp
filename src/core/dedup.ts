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

/**
 * Normalize a title for comparison: lowercase, strip punctuation/whitespace.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Deduplicate a list of results by matching on normalized title.
 * When duplicates are found, merges their editions arrays.
 */
export function dedup<T extends Deduplicable>(results: T[]): T[] {
  const seen = new Map<string, T>();

  for (const item of results) {
    const key = normalizeTitle(item.title);

    if (seen.has(key)) {
      // Merge editions, preferring the existing entry's metadata
      const existing = seen.get(key)!;
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

      // Use the longer description if available
      if (!existing.description && item.description) {
        existing.description = item.description;
      }
    } else {
      seen.set(key, { ...item });
    }
  }

  return Array.from(seen.values());
}
