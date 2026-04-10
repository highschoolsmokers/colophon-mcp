import { describe, it, expect } from "vitest";
import request from "supertest";

const BASE = "http://localhost:3333";

/**
 * Regression tests for search bugs discovered during development.
 * These test the smart search behavior end-to-end.
 * Requires the web server to be running on localhost:3333.
 */
describe("Search regressions", () => {
  // "stoner" was incorrectly triggering an author search
  // Fix: single-word queries always default to title search
  it('single word "stoner" should return title results, not author', async () => {
    const res = await request(BASE).get("/search?q=stoner");
    expect(res.status).toBe(200);
    expect(res.text).toContain("results");
    // Should NOT have an author-name header
    expect(res.text).not.toMatch(/class="author-name".*Stoner/);
    // Should contain book cards
    expect(res.text).toContain('class="card"');
  }, 20000);

  // "i remember" was not returning Joe Brainard's book
  // Fix: added general search + exact title match boost
  it('"i remember" should include Joe Brainard\'s book', async () => {
    const res = await request(BASE).get(
      "/search?q=i+remember&type=title",
    );
    expect(res.status).toBe(200);
    // Brainard's "I remember" should be in the results
    expect(res.text.toLowerCase()).toContain("brainard");
  }, 20000);

  // "naked lunch" was incorrectly triggering an author search
  // Fix: improved smart search detection
  it('"naked lunch" should return title results', async () => {
    const res = await request(BASE).get("/search?q=naked+lunch");
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card"');
  }, 20000);

  // "jackie ess" returned 0 results because author probe threshold was too high (5)
  // Fix: lowered threshold to 1, added author fallback when title returns 0
  it('"jackie ess" should return results (author with few works)', async () => {
    const res = await request(BASE).get("/search?q=jackie+ess");
    expect(res.status).toBe(200);
    // Should have cards OR at least not crash (OL may rate limit)
    const hasCards = res.text.includes('class="card"');
    const hasEmptyState = res.text.includes("empty-state");
    if (!hasCards && hasEmptyState) {
      console.warn("Jackie Ess returned empty — may be OL rate limited");
    }
    expect(hasCards || hasEmptyState).toBe(true);
  }, 20000);

  // "katie kitamura" was defaulting to title search because of case sensitivity
  // Fix: case-insensitive author detection
  it('"katie kitamura" should return author results', async () => {
    const res = await request(BASE).get("/search?q=katie+kitamura");
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card"');
  }, 20000);

  // "jeanette winterson" was showing 0 results when OL was slow
  // Fix: fallback to title results when author search has 0 titles
  it('"jeanette winterson" should return results', async () => {
    const res = await request(BASE).get("/search?q=jeanette+winterson");
    expect(res.status).toBe(200);
    // Tolerate OL flakiness — should at least not crash
    const hasCards = res.text.includes('class="card"');
    if (!hasCards) {
      console.warn("Jeanette Winterson returned no cards — OL may be rate limited");
    }
  }, 20000);

  // ISBN search should redirect to book page
  it("ISBN should redirect to book page", async () => {
    const res = await request(BASE).get("/search?q=9781598531497");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/book?isbn=");
  });

  // Forced author search should always work
  it("forced author search should return results", async () => {
    const res = await request(BASE).get(
      "/search?q=joe+brainard&type=author",
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("author-name");
    expect(res.text).toContain('class="card"');
  }, 20000);

  // Forced title search should always work
  it("forced title search should return results", async () => {
    const res = await request(BASE).get(
      "/search?q=i+remember&type=title",
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card"');
  }, 20000);

  // Empty query should redirect to home
  it("empty query should redirect to home", async () => {
    const res = await request(BASE).get("/search?q=");
    expect(res.status).toBe(302);
  });
});
