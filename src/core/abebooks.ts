// ---------------------------------------------------------------------------
// AbeBooks unofficial pricing API
// Uses the undocumented pricingservice endpoint to get used/new prices.
// No auth required. This is reverse-engineered and may break without notice.
// ---------------------------------------------------------------------------

import type { PurchaseListing } from "./types.js";
import { logger } from "./logger.js";

const ENDPOINT =
  "https://www.abebooks.com/servlet/DWRestService/pricingservice";

interface ABPricingResponse {
  pricingInfoForBestUsed?: ABListing;
  pricingInfoForBestNew?: ABListing;
}

interface ABListing {
  bestPriceInPurchaseCurrencyWithCurrencySymbol?: string;
  bestPriceInPurchaseCurrencyValueOnly?: number;
  bestShippingToDestinationPriceWithCurrencySymbol?: string;
  purchaseCurrencyCode?: string;
  vendorName?: string;
  vendorCountry?: string;
  vendorRating?: string;
  listingUrl?: string;
  isbn?: string;
  totalResults?: number;
}

/**
 * Look up used/new prices on AbeBooks for a given ISBN.
 * Returns best used and best new listings.
 */
export async function lookupByIsbn(isbn: string): Promise<{
  buyNew: PurchaseListing[];
  buyUsed: PurchaseListing[];
}> {
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("action", "getPricingDataByISBN");
    url.searchParams.set("isbn", isbn);
    url.searchParams.set("container", "pricingService-" + isbn);

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "ColophonMCP/1.0 (book-lookup-mcp-server)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return { buyNew: [], buyUsed: [] };

    const data = (await res.json()) as ABPricingResponse;

    const buyNew: PurchaseListing[] = [];
    const buyUsed: PurchaseListing[] = [];

    if (data.pricingInfoForBestNew) {
      const n = data.pricingInfoForBestNew;
      buyNew.push({
        title: "",
        authors: [],
        isbn,
        seller: n.vendorName ?? "AbeBooks seller",
        condition: "new",
        price:
          n.bestPriceInPurchaseCurrencyWithCurrencySymbol ??
          String(n.bestPriceInPurchaseCurrencyValueOnly ?? "?"),
        currency: n.purchaseCurrencyCode ?? "USD",
        url: n.listingUrl
          ? `https://www.abebooks.com${n.listingUrl}`
          : `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}&n=100121501`,
        shippingNote: n.bestShippingToDestinationPriceWithCurrencySymbol,
        sellerRating: n.vendorRating,
      });
    }

    if (data.pricingInfoForBestUsed) {
      const u = data.pricingInfoForBestUsed;
      buyUsed.push({
        title: "",
        authors: [],
        isbn,
        seller: u.vendorName ?? "AbeBooks seller",
        condition: "used",
        price:
          u.bestPriceInPurchaseCurrencyWithCurrencySymbol ??
          String(u.bestPriceInPurchaseCurrencyValueOnly ?? "?"),
        currency: u.purchaseCurrencyCode ?? "USD",
        url: u.listingUrl
          ? `https://www.abebooks.com${u.listingUrl}`
          : `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}&n=100121503`,
        shippingNote: u.bestShippingToDestinationPriceWithCurrencySymbol,
        sellerRating: u.vendorRating,
      });
    }

    return { buyNew, buyUsed };
  } catch (err) {
    logger.warn({ err, isbn }, "AbeBooks lookup failed");
    return { buyNew: [], buyUsed: [] };
  }
}
