// ---------------------------------------------------------------------------
// Shared configuration — timeouts, limits, API keys
// ---------------------------------------------------------------------------

import "dotenv/config";

export const config = {
  // Timeouts (ms)
  apiTimeout: parseInt(process.env.API_TIMEOUT ?? "5000"),
  coverTimeout: parseInt(process.env.COVER_TIMEOUT ?? "5000"),
  probeTimeout: parseInt(process.env.PROBE_TIMEOUT ?? "2000"),

  // Limits
  searchLimit: parseInt(process.env.SEARCH_LIMIT ?? "20"),
  titleSearchLimit: parseInt(process.env.TITLE_SEARCH_LIMIT ?? "10"),
  maxConcurrentPrices: parseInt(process.env.MAX_CONCURRENT_PRICES ?? "10"),
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT ?? "60"),
  maxInputLength: parseInt(process.env.MAX_INPUT_LENGTH ?? "200"),

  // API keys (optional)
  ebayAppToken: process.env.EBAY_APP_TOKEN ?? "",
  googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? "",

  // Server
  port: parseInt(process.env.PORT ?? "3333"),
  userAgent: "ColophonMCP/1.0 (book-lookup-mcp-server)",
};
