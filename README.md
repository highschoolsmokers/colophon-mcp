# Colophon

A book search engine and MCP server. Search across Open Library and Google Books, compare prices, check library availability, and find ebooks -- from Claude Code or a web browser.

## Setup

```bash
npm install
npm run build
cp .env.example .env  # then add your API keys
```

### API Keys (optional)

| Key | How to get | What it enables |
|-----|-----------|-----------------|
| `GOOGLE_BOOKS_API_KEY` | [console.cloud.google.com](https://console.cloud.google.com) → Enable Books API → Create credentials | Raises quota from ~1,000 to 40,000 requests/day |
| `EBAY_APP_TOKEN` | [developer.ebay.com](https://developer.ebay.com) → Create app → Generate OAuth token | eBay marketplace listings and pricing |

Add keys to `.env` (never committed):

```
GOOGLE_BOOKS_API_KEY=your_key
EBAY_APP_TOKEN=your_token
```

## Usage

This is a single codebase with two entry points. Run both simultaneously if you want.

### Web UI

```bash
npm run web           # production
npm run dev:web       # with hot reload
```

Opens at **http://localhost:3333**.

- **Smart search** -- one input box that auto-detects ISBN, author, or title
- **Author pages** -- photo, bio, dates, bibliography with cover thumbnails
- **Book detail pages** -- cover, metadata, edition comparison, breadcrumbs
- **Price comparison** -- AbeBooks new/used prices, links to Amazon, Bookshop.org, BookFinder, eBay, ThriftBooks
- **Reviews and ratings** -- Open Library ratings, links to NYT Books, Goodreads, The StoryGraph, LibraryThing
- **Wikipedia summaries** -- author bios from Wikipedia on book pages
- **Related books** -- suggestions by subject on book pages
- **Library and ebook lookup** -- lending availability, Google Play Books ebook search
- **Reading list** -- save books locally, view at `/reading-list`
- **Search autocomplete** -- live suggestions from Open Library (3+ characters)
- **Sort and filter** -- sort by relevance/title/date, filter by language
- **Dark mode** -- toggle in header, respects system preference
- **Keyboard shortcut** -- press `/` to focus search
- **PWA** -- installable, caches cover images offline
- **Print-friendly** -- clean printout with link URLs

### MCP Server (Claude Code)

```bash
npm start
```

Add to Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "colophon": {
      "command": "node",
      "args": ["/path/to/colophon-mcp/dist/index.js"]
    }
  }
}
```

Then ask Claude naturally: "search for books by Nan Goldin", "find I Remember by Joe Brainard", etc.

### Docker

```bash
docker build -t colophon .

# Web UI (default)
docker run -p 3333:3333 colophon

# MCP server
docker run colophon node dist/index.js
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_books` | Search by title, author, keywords, or ISBN |
| `search_by_title` | Fuzzy title search with confidence scoring |
| `search_by_author` | Author bibliography with bio and photo |
| `find_retailers` | AbeBooks new/used pricing |
| `check_library_availability` | Open Library/Internet Archive lending status |
| `check_electronic_availability` | Google Play Books ebook availability |

## JSON API

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check (uptime, status) |
| `GET /api/prices/:isbn` | Retailer price comparison for an ISBN |
| `GET /api/cover/:id?s=M&t=b` | Proxied cover image (validates, caches) |
| `GET /api/wiki/:name` | Wikipedia summary for an author |
| `GET /api/related/:subject` | Related books by subject |

Full spec: [openapi.yaml](openapi.yaml)

## Data Sources

| Source | Auth | Used for |
|--------|------|----------|
| Open Library | None | Book search, author bios, editions, ratings, lending |
| Google Books | Optional API key | Book search, ebook availability (higher quota with key) |
| AbeBooks | None (unofficial) | New/used book pricing |
| eBay Browse API | Optional OAuth token | Marketplace listings |
| Wikipedia | None | Author summaries |

## Architecture

```
src/
  index.ts                MCP server (stdio transport)
  web.ts                  Express web UI (localhost:3333)
  core/
    openlibrary.ts         Open Library search + author API
    googlebooks.ts         Google Books Volumes API
    abebooks.ts            AbeBooks pricing (unofficial)
    openlibrary-availability.ts  Lending/borrow status
    retailers.ts           Price aggregator + retailer links
    reviews.ts             Ratings + review links
    dedup.ts               Fuzzy title dedup + author merging
    cache.ts               In-memory TTL cache (5 min)
    circuit-breaker.ts     Backs off failing services
    config.ts              Shared config + .env support
    logger.ts              Structured logging (pino)
    types.ts               Shared TypeScript interfaces
    __tests__/             Unit + integration tests
  public/
    sw.js                  Service worker (cover caching)
    manifest.json          PWA manifest
```

## Configuration

All settings can be overridden via `.env` or environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3333` | Web server port |
| `API_TIMEOUT` | `5000` | API request timeout (ms) |
| `SEARCH_LIMIT` | `20` | Max results per source |
| `RATE_LIMIT` | `60` | Requests per minute per IP |
| `LOG_LEVEL` | `info` | pino log level |

## Performance

- Smart author probe avoids expensive dual-search race
- 5s API timeouts cap slow upstream responses
- Circuit breaker backs off Open Library after 5 failures
- In-memory cache (5 min TTL) makes repeat searches instant (~0.3s)
- Fuzzy dedup merges duplicates across sources
- Lazy-loaded retailer prices via client-side AJAX
- Cover image proxy validates and caches upstream images
- Gzip compression, streaming HTML, preconnect hints

## Security

- Helmet CSP headers
- Rate limiting (60/min search, 300/min covers)
- CORS on API routes
- Input length sanitization (200 char max)
- XSS protection via `esc()` + `JSON.stringify()` in script contexts

## Testing

```bash
npm test              # run all tests
npm run dev:web       # hot reload for development
```

36 tests covering cache, dedup/author merging, all API clients, and web UI integration.

## Tech Stack

- TypeScript, Node.js
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Express, Helmet, compression, cors
- pino (structured logging)
- Zod (input validation)
- Vitest + supertest (testing)
