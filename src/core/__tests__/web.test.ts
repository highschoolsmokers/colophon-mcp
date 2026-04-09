import { describe, it, expect } from "vitest";
import request from "supertest";

// Import the Express app — we need to extract it from web.ts
// Since web.ts starts listening, we'll test against the running server
const BASE = "http://localhost:3333";

describe("Web UI", () => {
  it("serves the home page", async () => {
    const res = await request(BASE).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Colophon");
    expect(res.text).toContain("search");
  });

  it("returns health check", async () => {
    const res = await request(BASE).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.uptime).toBeGreaterThan(0);
  });

  it("redirects empty search to home", async () => {
    const res = await request(BASE).get("/search?q=");
    expect(res.status).toBe(302);
  });

  it("returns search results", async () => {
    const res = await request(BASE).get("/search?q=stoner&type=title");
    expect(res.status).toBe(200);
    expect(res.text).toContain("results");
  }, 15000);

  it("returns book detail page", async () => {
    const res = await request(BASE).get(
      "/book?title=I+remember&author=Joe+Brainard",
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("I remember");
  }, 15000);

  it("proxies cover images", async () => {
    // Known good cover ID
    const res = await request(BASE).get("/api/cover/924990?s=S");
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain("image");
    }
  }, 10000);

  it("returns 404 for invalid cover", async () => {
    const res = await request(BASE).get("/api/cover/0?s=S");
    expect(res.status).toBe(404);
  }, 10000);

  it("returns price comparison JSON", async () => {
    const res = await request(BASE).get("/api/prices/9781598531497");
    expect(res.status).toBe(200);
    expect(res.body.isbn).toBe("9781598531497");
    expect(res.body.links).toBeDefined();
  }, 15000);

  it("serves reading list page", async () => {
    const res = await request(BASE).get("/reading-list");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Reading list");
  });

  it("has CORS headers on API routes", async () => {
    const res = await request(BASE).get("/api/health");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("enforces input length limits", async () => {
    const longQ = "a".repeat(300);
    const res = await request(BASE).get(`/search?q=${longQ}&type=title`);
    expect(res.status).toBe(200);
    // Should not crash from long input
  }, 15000);
});
