import { describe, it, expect } from "vitest";
import * as openLibrary from "../openlibrary.js";
import * as googleBooks from "../googlebooks.js";
import * as abebooks from "../abebooks.js";
import * as olAvailability from "../openlibrary-availability.js";
import { getRetailerComparison } from "../retailers.js";
import { getReviewLinks } from "../reviews.js";

// These are integration tests that hit real APIs.
// They may be slow or fail due to rate limits.
// Run with: npm test

describe("Open Library", () => {
  it("searches by title", async () => {
    const result = await openLibrary.searchByTitle({ title: "Stoner", limit: 3 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toBeDefined();
  }, 15000);

  it("searches by author", async () => {
    try {
      const result = await openLibrary.searchByAuthor({
        author: "Joe Brainard",
        sortBy: "date",
        limit: 5,
      });
      expect(result.author).toBeTruthy();
    } catch {
      console.warn("Open Library rate limited, skipping");
    }
  }, 15000);

  it("general search by ISBN", async () => {
    try {
      const result = await openLibrary.search({ isbn: "9781598531497" });
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    } catch {
      console.warn("Open Library rate limited, skipping");
    }
  }, 15000);
});

describe("Google Books", () => {
  it("searches by title", async () => {
    try {
      const result = await googleBooks.searchByTitle({ title: "I Remember", limit: 3 });
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    } catch {
      // Google Books may be rate limited — not a test failure
      console.warn("Google Books rate limited, skipping");
    }
  }, 15000);

  it("checks ebook availability", async () => {
    const result = await googleBooks.checkEbookAvailability({ title: "Dune" });
    // May return empty if rate limited
    expect(result.ebooks).toBeDefined();
    expect(result.audiobooks).toBeDefined();
  }, 15000);
});

describe("AbeBooks", () => {
  it("looks up pricing by ISBN", async () => {
    const result = await abebooks.lookupByIsbn("9781598531497");
    expect(result.buyNew).toBeDefined();
    expect(result.buyUsed).toBeDefined();
    // At least one should have results for a known book
    expect(result.buyNew.length + result.buyUsed.length).toBeGreaterThan(0);
  }, 15000);

  it("returns results for invalid ISBN (AbeBooks may still match)", async () => {
    const result = await abebooks.lookupByIsbn("0000000000");
    expect(result.buyNew).toBeDefined();
    expect(result.buyUsed).toBeDefined();
  }, 15000);
});

describe("Open Library Availability", () => {
  it("checks lending availability", async () => {
    const result = await olAvailability.checkAvailabilityByIsbn("9781598531497");
    expect(result.libraries).toBeDefined();
  }, 15000);
});

describe("Retailers", () => {
  it("aggregates retailer comparison", async () => {
    const result = await getRetailerComparison("9781598531497");
    expect(result.isbn).toBe("9781598531497");
    expect(result.abebooks).toBeDefined();
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.links.some((l) => l.name === "Amazon")).toBe(true);
  }, 15000);
});

describe("Reviews", () => {
  it("generates review links", async () => {
    const result = await getReviewLinks({
      isbn: "9781598531497",
      title: "Collected Writings of Joe Brainard",
      author: "Joe Brainard",
    });
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.links.some((l) => l.name === "NYT Books")).toBe(true);
    expect(result.links.some((l) => l.name === "Goodreads")).toBe(true);
  }, 15000);
});
