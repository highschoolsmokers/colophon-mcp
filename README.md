# Colophon MCP

An MCP (Model Context Protocol) server for looking up books across retailers, libraries, and electronic sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_books` | Search for books by title, author, keywords, ISBN/EAN, or any combination |
| `find_retailers` | Find retailers selling a specific book |
| `check_library_availability` | Check if a book is available in library systems (Libby, OverDrive, local libraries) |
| `check_electronic_availability` | Check electronic availability (ebook, audiobook) across platforms |

## Setup

```bash
npm install
npm run build
```

## Usage

Start the server (communicates over stdio):

```bash
npm start
```

For development with hot reload:

```bash
npm run dev
```

### Adding to Claude Code

Add the following to your Claude Code MCP config:

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

## Status

This project is in early development. All four tools are scaffolded with stub implementations that return placeholder responses. The following API integrations are planned:

- **Book search:** Open Library, Google Books
- **Retailers:** AbeBooks SWS, Amazon, Bookshop.org, IndieBound
- **Libraries:** OverDrive/Libby, WorldCat, local library OPACs
- **Electronic:** Kindle, Apple Books, Google Play Books, Kobo, Audible

## Tech Stack

- TypeScript
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) (stdio transport)
- Zod for input validation
