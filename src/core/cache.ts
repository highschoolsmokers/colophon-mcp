// ---------------------------------------------------------------------------
// Simple in-memory TTL cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

export function get<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function set<T>(key: string, value: T, ttl = DEFAULT_TTL): void {
  store.set(key, { value, expiresAt: Date.now() + ttl });
}

/**
 * Get-or-fetch: returns cached value if available, otherwise calls fn(),
 * caches the result, and returns it.
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttl = DEFAULT_TTL,
): Promise<T> {
  const existing = get<T>(key);
  if (existing !== undefined) return existing;
  const value = await fn();
  set(key, value, ttl);
  return value;
}
