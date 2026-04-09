// ---------------------------------------------------------------------------
// Retailer links and pricing aggregation
// ---------------------------------------------------------------------------

import type { PurchaseListing } from "./types.js";
import * as abebooks from "./abebooks.js";
import { cached } from "./cache.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Search URL generators (no API needed — just construct URLs)
// ---------------------------------------------------------------------------

export function amazonUrl(isbn: string): string {
  return `https://www.amazon.com/s?k=${isbn}&i=stripbooks`;
}

export function bookshopUrl(isbn: string): string {
  return `https://bookshop.org/books?keywords=${isbn}`;
}

export function bookfinderUrl(isbn: string): string {
  return `https://www.bookfinder.com/search/?isbn=${isbn}&st=xl&ac=qr`;
}

export function ebaySearchUrl(isbn: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${isbn}&_sacat=267`;
}

export function thriftbooksUrl(isbn: string): string {
  return `https://www.thriftbooks.com/browse/?b.search=${isbn}`;
}

// ---------------------------------------------------------------------------
// eBay Browse API (requires EBAY_APP_TOKEN env var)
// ---------------------------------------------------------------------------

interface EBayItemSummary {
  title: string;
  price: { value: string; currency: string };
  condition: string;
  itemWebUrl: string;
  seller?: { username: string; feedbackPercentage?: string };
}

interface EBaySearchResponse {
  total: number;
  itemSummaries?: EBayItemSummary[];
}

async function ebayApiSearch(isbn: string): Promise<PurchaseListing[]> {
  const token = process.env.EBAY_APP_TOKEN;
  if (!token) return [];

  try {
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=isbn+${isbn}&category_ids=267&limit=5`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as EBaySearchResponse;
    if (!data.itemSummaries?.length) return [];

    return data.itemSummaries.map((item) => ({
      title: item.title,
      authors: [],
      isbn,
      seller: `eBay: ${item.seller?.username ?? "seller"}`,
      condition: item.condition?.toLowerCase().includes("new")
        ? ("new" as const)
        : ("used" as const),
      price: `${item.price.currency} ${item.price.value}`,
      currency: item.price.currency,
      url: item.itemWebUrl,
      sellerRating: item.seller?.feedbackPercentage
        ? `${item.seller.feedbackPercentage}%`
        : undefined,
    }));
  } catch (err) {
    logger.warn({ err, isbn }, "eBay API search failed");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Aggregated price comparison
// ---------------------------------------------------------------------------

export interface PriceComparison {
  isbn: string;
  abebooks: {
    newPrice?: string;
    usedPrice?: string;
    newUrl: string;
    usedUrl: string;
  };
  ebay: PurchaseListing[];
  links: Array<{ name: string; url: string }>;
}

export function getRetailerComparison(isbn: string): Promise<PriceComparison> {
  const key = `retailers:${isbn}`;
  return cached(key, () => _getRetailerComparison(isbn));
}

async function _getRetailerComparison(isbn: string): Promise<PriceComparison> {
  const [abResult, ebayResult] = await Promise.allSettled([
    abebooks.lookupByIsbn(isbn),
    ebayApiSearch(isbn),
  ]);

  const ab =
    abResult.status === "fulfilled"
      ? abResult.value
      : { buyNew: [], buyUsed: [] };
  const ebay = ebayResult.status === "fulfilled" ? ebayResult.value : [];

  return {
    isbn,
    abebooks: {
      newPrice: ab.buyNew[0]?.price,
      usedPrice: ab.buyUsed[0]?.price,
      newUrl: `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}&n=100121501`,
      usedUrl: `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}&n=100121503`,
    },
    ebay,
    links: [
      { name: "Amazon", url: amazonUrl(isbn) },
      { name: "Bookshop.org", url: bookshopUrl(isbn) },
      { name: "BookFinder", url: bookfinderUrl(isbn) },
      { name: "eBay", url: ebaySearchUrl(isbn) },
      { name: "ThriftBooks", url: thriftbooksUrl(isbn) },
    ],
  };
}
