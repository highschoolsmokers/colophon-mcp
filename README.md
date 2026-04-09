# Colophon

A book search engine and MCP server. Search across Open Library and Google Books, compare prices, check library availability, and find ebooks -- from Claude Code or a web browser.

## Tools

| Tool | Description |
|------|-------------|
| `search_books` | Search by title, author, keywords, or ISBN. Returns results from Open Library and Google Books with cover images, descriptions, and subjects |
| `search_by_title` | Fuzzy title search with confidence scoring. Exact matches rank first, English editions preferred |
| `search_by_author` | Author bibliography with bio, birth/death dates, and photo. Returns all known works with editions |
| `find_retailers` | AbeBooks new/used pricing with links. Falls back to title search if no ISBN provided |
| `check_library_availability` | Open Library/Internet Archive lending status (available, checked out, waitlist) |
| `check_electronic_availability` | Google Play Books ebook availability with prices and format (EPUB/PDF) |

Results include inline cover image URLs, author photo URLs, and links to full-size covers. Author searches return a brief bio with dates when available.

## Setup

```bash
npm install
npm run build
```

## Usage

### MCP Server (Claude Code)

Add to your Claude Code config (`~/.claude.json`):

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

### Web UI

```bash
npm run web
```

Opens at **http://localhost:3333**. Features:

- **Smart search** -- one input box that auto-detects ISBN, author, or title. Races both author and title searches in parallel and picks the better result
- **Author pages** -- photo, bio, dates, and full bibliography with cover thumbnails
- **Book detail pages** -- cover image, metadata, reading time estimate, breadcrumb navigation
- **Price comparison** -- AbeBooks new/used prices on every result, with links to Amazon, Bookshop.org, BookFinder, eBay, and ThriftBooks
- **Reviews and ratings** -- Open Library star ratings and reader counts, with links to NYT Books, Goodreads, The StoryGraph, and LibraryThing
- **Library and ebook lookup** -- check lending availability and find ebook editions
- **Dark mode** -- toggle in header, respects system preference, persists across sessions
- **Recent searches** -- stored locally, shown on the home page
- **Language filters** -- filter results by language when multiple are present
- **Keyboard shortcut** -- press `/` to focus search from anywhere

### MCP Inspector

For debugging the raw MCP protocol:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Data Sources

| Source | Auth | Used for |
|--------|------|----------|
| Open Library | None | Book search, author bios, editions, ratings, lending |
| Google Books | None (rate limited) | Book search, ebook availability |
| AbeBooks | None (unofficial) | New/used book pricing |
| eBay Browse API | Optional (`EBAY_APP_TOKEN`) | Marketplace listings |

To enable eBay pricing, register at [developer.ebay.com](https://developer.ebay.com) and run:

```bash
EBAY_APP_TOKEN=your_token npm run web
```

## Architecture

```
src/
  index.ts              MCP server (stdio transport)
  web.ts                Express web UI (localhost:3333)
  core/
    openlibrary.ts       Open Library search + author API
    googlebooks.ts       Google Books Volumes API
    abebooks.ts          AbeBooks pricing (unofficial endpoint)
    openlibrary-availability.ts  Open Library Read/lending API
    retailers.ts         Price comparison aggregator + retailer links
    reviews.ts           Ratings + review link generator
    cache.ts             In-memory TTL cache (5 min default)
    dedup.ts             Title deduplication across sources
    types.ts             Shared TypeScript interfaces
```

## Performance

- Parallel API calls to Open Library + Google Books
- In-memory cache with 5-minute TTL (repeat searches are near-instant)
- Result deduplication across sources
- Lazy-loaded retailer prices via client-side AJAX
- Cover image proxy with validation (filters fake placeholders)
- Gzip compression on all responses
- Streaming HTML for progressive page rendering

## Tech Stack

- TypeScript
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) (stdio transport)
- Express + Helmet + compression
- Zod for input validation
