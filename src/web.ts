import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import * as openLibrary from "./core/openlibrary.js";
import * as googleBooks from "./core/googlebooks.js";
import * as abebooks from "./core/abebooks.js";
import * as olAvailability from "./core/openlibrary-availability.js";
import { getRetailerComparison } from "./core/retailers.js";
import { getReviewLinks } from "./core/reviews.js";
import { dedup } from "./core/dedup.js";

const app = express();
const PORT = 3333;

// Security headers (allow inline styles/scripts for our server-rendered HTML)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: [
          "'self'",
          "https://covers.openlibrary.org",
          "https://books.google.com",
          "https://*.googleusercontent.com",
          "data:",
        ],
        connectSrc: ["'self'"],
      },
    },
  }),
);
app.use(compression());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coverSizes(url: string): { thumb: string; full: string } {
  if (url.includes("covers.openlibrary.org")) {
    const match = url.match(/\/b\/id\/(\d+)/);
    if (match) {
      return {
        thumb: `/api/cover/${match[1]}?s=M`,
        full: `/api/cover/${match[1]}?s=L`,
      };
    }
  }
  return { thumb: url, full: url };
}

function findCover(
  editions: Array<{ coverImageUrl?: string }>,
): string | undefined {
  return editions.find((e) => e.coverImageUrl)?.coverImageUrl;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function qstr(val: unknown): string {
  return (typeof val === "string" ? val : "").trim();
}

// ---------------------------------------------------------------------------
// Layout — styled after ws-gong: Geist Sans, warm beige bg, black borders,
// typography-driven, minimal/flat, no shadows
// ---------------------------------------------------------------------------

function layoutHead(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Colophon</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#128214;</text></svg>">
<link rel="preconnect" href="https://covers.openlibrary.org">
<link rel="preconnect" href="https://books.google.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  :root, [data-theme="light"] {
    --bg: #f2ede4;
    --fg: #000;
    --neutral-200: #e5e5e5;
    --neutral-400: #525252;
    --neutral-500: #a3a3a3;
    --neutral-700: #404040;
    --input-bg: #fff;
  }
  [data-theme="dark"] {
    --bg: #141414;
    --fg: #e5e5e5;
    --neutral-200: #333;
    --neutral-400: #999;
    --neutral-500: #777;
    --neutral-700: #bbb;
    --input-bg: #1e1e1e;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #141414;
      --fg: #e5e5e5;
      --neutral-200: #333;
      --neutral-400: #999;
      --neutral-500: #777;
      --neutral-700: #bbb;
      --input-bg: #1e1e1e;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
    max-width: 860px; margin: 0 auto; padding: 2rem 3rem;
    color: var(--fg); background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--fg); }
  a:hover { opacity: 0.7; }

  /* Header */
  header { padding-bottom: 1.5rem; }
  header h1 {
    font-size: 2.5rem; font-weight: 900; letter-spacing: -0.03em;
    line-height: 0.95;
  }
  header h1 a { text-decoration: none; color: var(--fg); }

  /* Nav */
  nav { border-bottom: 1px solid var(--fg);
        padding: 0.6rem 0; margin-bottom: 2rem; display: flex; gap: 1.5rem; }
  nav a { text-decoration: none; font-size: 0.85rem; font-weight: 600;
          color: var(--neutral-400); letter-spacing: 0.01em;
          transition: color 0.2s; }
  nav a:hover, nav a.active { color: var(--fg); opacity: 1; }

  /* Search form */
  .search-form { margin-bottom: 2rem; }
  .search-row { display: flex; gap: 0.75rem; align-items: center; }
  .search-row input {
    flex: 1; border: 1px solid var(--neutral-200); background: var(--input-bg);
    padding: 0.6rem 0.75rem; font-size: 1rem;
    font-family: inherit; color: var(--fg); outline: none;
    transition: border-color 0.2s;
  }
  .search-row input:focus { border-color: var(--fg); }
  .search-row input::placeholder { color: var(--neutral-500); }
  .search-row select {
    border: 1px solid var(--neutral-200); background: var(--input-bg);
    padding: 0.6rem 0.5rem; font-size: 0.85rem;
    font-family: inherit; color: var(--neutral-400); outline: none; cursor: pointer;
  }
  .search-row button {
    border: 1px solid var(--fg); background: var(--fg); color: var(--bg);
    font-family: inherit; font-size: 0.85rem; font-weight: 600;
    padding: 0.6rem 1.25rem; cursor: pointer; letter-spacing: 0.02em;
    text-transform: uppercase; transition: opacity 0.2s;
  }
  .search-row button:hover { opacity: 0.7; }
  .search-row button:disabled { opacity: 0.4; }

  /* Section headers */
  h2 { font-size: 0.8rem; font-weight: 600; color: var(--neutral-400);
       letter-spacing: 0.06em; text-transform: uppercase;
       border-top: 1px solid var(--fg); padding-top: 1rem; margin-bottom: 1rem; }

  /* Author header + bio */
  .author-header { margin-bottom: 1.5rem; }
  .author-name { font-size: 1.5rem; font-weight: 900; letter-spacing: -0.03em;
                 line-height: 1.1; border: none; padding: 0; margin-bottom: 1rem;
                 text-transform: none; color: var(--fg); }
  .author-name .dates { font-size: 1rem; font-weight: 400; color: var(--neutral-400); }
  .bio { display: flex; gap: 1.25rem; align-items: flex-start; }
  .bio img { width: 72px; height: auto; flex-shrink: 0; }
  .bio-text { font-size: 0.9rem; line-height: 1.55; color: var(--neutral-700); }
  .bio-text p { margin: 0; }

  /* Results list */
  .results { display: flex; flex-direction: column; }
  .card {
    display: flex; gap: 1rem; padding: 1rem 0;
    border-bottom: 1px solid var(--neutral-200);
    transition: opacity 0.2s;
    animation: fadeIn 0.3s ease-out both;
  }
  .card:hover { opacity: 0.8; }
  .card img { width: 56px; height: 84px; object-fit: cover; flex-shrink: 0;
              background: var(--neutral-200); }
  .card .placeholder {
    width: 56px; height: 84px; background: var(--neutral-200); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--neutral-500); font-size: 0.6rem; letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .card-info { flex: 1; min-width: 0; }
  .card-info h3 { font-size: 0.95rem; font-weight: 700; letter-spacing: -0.01em;
                  margin-bottom: 0.15rem; line-height: 1.3; }
  .card-info .meta { font-size: 0.8rem; color: var(--neutral-400); line-height: 1.4; }
  .card-info .isbn { font-family: monospace; font-size: 0.7rem; color: var(--neutral-500);
                     margin-top: 0.25rem; }
  .card-info .isbn a { font-family: inherit; margin-left: 0.5rem; color: var(--neutral-400);
                       text-decoration: none; transition: color 0.2s; }
  .card-info .isbn a:hover { color: var(--fg); text-decoration: underline; opacity: 1; }
  .card-info .editions { font-size: 0.7rem; color: var(--neutral-500); margin-top: 0.2rem; }
  .card-info .prices { font-size: 0.75rem; margin-top: 0.3rem; display: flex; gap: 1rem; }
  .card-info .prices .price-tag { color: var(--fg); font-weight: 700; }
  .card-info .prices .price-label { color: var(--neutral-500); font-size: 0.65rem;
    text-transform: uppercase; letter-spacing: 0.03em; margin-right: 0.25rem; }

  /* Book detail page */
  .book-detail { display: flex; gap: 2rem; margin-bottom: 2rem; }
  .book-cover { flex-shrink: 0; }
  .book-cover img { width: 180px; height: auto; }
  .book-cover .placeholder-lg { width: 180px; height: 270px; background: var(--neutral-200);
    display: flex; align-items: center; justify-content: center;
    color: var(--neutral-500); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .book-meta { flex: 1; }
  .book-meta h2 { font-size: 1.5rem; font-weight: 900; letter-spacing: -0.03em;
    line-height: 1.1; border: none; padding: 0; margin-bottom: 0.25rem;
    text-transform: none; color: var(--fg); }
  .book-meta .authors { font-size: 1rem; color: var(--neutral-400); margin-bottom: 1rem; }
  .book-meta .detail-row { font-size: 0.85rem; color: var(--neutral-700); line-height: 1.8; }
  .book-meta .detail-row span { color: var(--neutral-400); font-size: 0.75rem;
    text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.5rem; }
  .book-meta .description { font-size: 0.9rem; line-height: 1.6; color: var(--neutral-700);
    margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--neutral-200); }
  .book-meta .subjects { margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .book-meta .subjects span { font-size: 0.7rem; color: var(--neutral-400);
    border: 1px solid var(--neutral-200); padding: 0.15rem 0.5rem; }
  .book-actions { display: flex; gap: 1.5rem; margin-top: 1.25rem; padding-top: 1rem;
    border-top: 1px solid var(--neutral-200); }
  .book-actions a { font-size: 0.85rem; font-weight: 600; text-decoration: none;
    color: var(--neutral-400); transition: color 0.2s; }
  .book-actions a:hover { color: var(--fg); text-decoration: underline; opacity: 1; }

  /* Tables */
  .pricing { margin-top: 0.5rem; }
  .pricing table { width: 100%; border-collapse: collapse; }
  .pricing th { text-align: left; padding: 0.6rem 0; font-size: 0.7rem; font-weight: 600;
                color: var(--neutral-400); letter-spacing: 0.06em; text-transform: uppercase;
                border-bottom: 1px solid var(--fg); }
  .pricing td { padding: 0.75rem 0; font-size: 0.9rem; border-bottom: 1px solid var(--neutral-200); }
  .pricing td:last-child { text-align: right; }
  .pricing .price { font-weight: 700; }
  .pricing a { text-decoration: none; font-weight: 600; }
  .pricing a:hover { text-decoration: underline; }

  /* Messages */
  .msg { padding: 1rem 0; font-size: 0.85rem; color: var(--neutral-400);
         border-top: 1px solid var(--neutral-200); margin-top: 0.5rem; }

  /* Animations */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* Recent searches */
  .recent-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .recent-list a { font-size: 0.85rem; text-decoration: none; color: var(--fg);
    border: 1px solid var(--neutral-200); padding: 0.35rem 0.75rem;
    transition: border-color 0.2s; }
  .recent-list a:hover { border-color: var(--fg); opacity: 1; }

  /* Theme toggle */
  .theme-toggle { font-size: 0.75rem; color: var(--neutral-500); cursor: pointer;
    background: none; border: none; font-family: inherit; margin-left: auto;
    transition: opacity 0.2s; }
  .theme-toggle:hover { opacity: 0.7; }

  /* Language filter chips */
  .filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
  .filters a { font-size: 0.7rem; text-decoration: none; color: var(--neutral-400);
    border: 1px solid var(--neutral-200); padding: 0.2rem 0.5rem;
    transition: all 0.2s; }
  .filters a:hover, .filters a.active { border-color: var(--fg); color: var(--fg); opacity: 1; }

  /* Breadcrumbs */
  .breadcrumbs { font-size: 0.75rem; color: var(--neutral-500); margin-bottom: 1rem; }
  .breadcrumbs a { color: var(--neutral-400); text-decoration: none; }
  .breadcrumbs a:hover { color: var(--fg); opacity: 1; }
  .breadcrumbs span { margin: 0 0.4rem; }

  /* Share button */
  .share-btn { font-size: 0.75rem; color: var(--neutral-400); background: none; border: 1px solid var(--neutral-200);
    padding: 0.25rem 0.6rem; cursor: pointer; font-family: inherit; transition: all 0.2s; }
  .share-btn:hover { border-color: var(--fg); color: var(--fg); }

  /* Reading time */
  .reading-time { font-size: 0.75rem; color: var(--neutral-500); margin-top: 0.15rem; }

  /* Price slot (lazy-loaded) */
  .price-slot { min-height: 1.2rem; }
  .price-slot.loading { color: var(--neutral-500); font-size: 0.7rem; }

  @media (prefers-reduced-motion: reduce) {
    .card { animation: none; }
  }
</style>
<script>
// Dark mode
(function() {
  var t = localStorage.getItem("colophon:theme");
  if (t) document.documentElement.setAttribute("data-theme", t);
})();
document.addEventListener("DOMContentLoaded", function() {
  var btn = document.getElementById("theme-btn");
  if (btn) btn.addEventListener("click", function() {
    var r = document.documentElement;
    var c = r.getAttribute("data-theme") === "dark" ? "light" : "dark";
    r.setAttribute("data-theme", c);
    localStorage.setItem("colophon:theme", c);
  });
});
// Keyboard: / to focus search
document.addEventListener("keydown", function(e) {
  if (e.key === "/" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName || "")) {
    e.preventDefault();
    var input = document.querySelector("input[name=q]");
    if (input) input.focus();
  }
});
// Replace tiny placeholder images (Open Library returns 1x1 pixel for missing covers)
document.addEventListener("load", function(e) {
  var img = e.target;
  if (img.tagName === "IMG" && img.closest(".card") && img.naturalWidth <= 1) {
    img.parentElement.outerHTML = '<div class="placeholder">No cover</div>';
  }
}, true);
// Lazy-load prices
function loadPrices() {
  document.querySelectorAll("[data-isbn]").forEach(function(el) {
    var isbn = el.getAttribute("data-isbn");
    if (!isbn || el.classList.contains("loaded")) return;
    el.classList.add("loaded");
    fetch("/api/prices/" + isbn).then(function(r) { return r.json(); }).then(function(d) {
      var parts = [];
      if (d.abebooks && d.abebooks.newPrice) parts.push('<span><span class="price-label">New</span> <span class="price-tag"><a href="' + d.abebooks.newUrl + '" target="_blank" style="color:inherit;text-decoration:none">' + d.abebooks.newPrice + '</a></span></span>');
      if (d.abebooks && d.abebooks.usedPrice) parts.push('<span><span class="price-label">Used</span> <span class="price-tag"><a href="' + d.abebooks.usedUrl + '" target="_blank" style="color:inherit;text-decoration:none">' + d.abebooks.usedPrice + '</a></span></span>');
      if (d.links) {
        var links = d.links.map(function(l) { return '<a href="' + l.url + '" target="_blank">' + l.name + '</a>'; }).join("");
        el.innerHTML = (parts.length ? '<div class="prices">' + parts.join("") + '</div>' : '') + '<div class="isbn" style="margin-top:0.2rem">' + links + '</div>';
      }
    }).catch(function() { el.innerHTML = ""; });
  });
}
</script>
</head>
<body>
  <header style="display:flex;align-items:baseline;gap:1rem">
    <h1><a href="/">Colophon</a></h1>
    <button class="theme-toggle" id="theme-btn">light/dark</button>
  </header>
  `;
}

function layoutFoot(): string {
  return `</body></html>`;
}

function layout(title: string, body: string): string {
  return layoutHead(title) + body + layoutFoot();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Smart search: auto-detect ISBN, author name, or title
// ---------------------------------------------------------------------------

function isIsbn(q: string): boolean {
  const stripped = q.replace(/[-\s]/g, "");
  return /^\d{10}(\d{3})?$/.test(stripped);
}

// --- Cover image proxy: validates and caches cover images ---
app.get("/api/cover/:id", async (req, res) => {
  const id = req.params.id;
  const size = (req.query.s as string) || "M";
  try {
    const url = `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;
    const upstream = await fetch(url, {
      headers: { "User-Agent": "ColophonMCP/1.0" },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    // If it's not actually an image or too small, return a 1x1 transparent PNG
    if (!contentType.startsWith("image/") || buffer.length < 100) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    res.status(404).end();
  }
});

// --- JSON API: lazy-load prices for a single ISBN ---
app.get("/api/prices/:isbn", async (req, res) => {
  const isbn = req.params.isbn;
  try {
    const comparison = await getRetailerComparison(isbn);
    res.json(comparison);
  } catch {
    res.json({
      isbn,
      abebooks: { newUrl: "", usedUrl: "" },
      ebay: [],
      links: [],
    });
  }
});

app.get("/", (_req, res) => {
  res.send(
    layout(
      "Search",
      `
    <div class="search-form">
      <form class="search-row" action="/search" method="get">
        <input id="q" name="q" placeholder="Title, author, ISBN, or keyword\u2026" autofocus required>
        <input type="hidden" name="type" id="search-type" value="smart">
        <button type="submit">Search</button>
      </form>
    </div>
    <div id="recent"></div>
    <script>
    (function() {
      function escHtml(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
      var recent = JSON.parse(localStorage.getItem("colophon:recent") || "[]");
      if (!recent.length) return;
      var el = document.getElementById("recent");
      var html = '<h2 style="margin-top:0">Recent searches</h2><div class="recent-list">';
      recent.slice(0, 8).forEach(function(r) {
        html += '<a href="/search?q=' + encodeURIComponent(r.q) + '&type=' + encodeURIComponent(r.type) + '">' + escHtml(r.q) + ' <span style="color:var(--neutral-500);font-size:0.7rem">' + escHtml(r.type) + '</span></a>';
      });
      html += '</div>';
      el.innerHTML = html;
    })();
    </script>
  `,
    ),
  );
});

app.get("/search", async (req, res) => {
  const q = qstr(req.query.q);
  const forceType = qstr(req.query.type);
  if (!q) return res.redirect("/");

  // ISBN → book page
  if (isIsbn(q)) {
    return res.redirect(`/book?isbn=${encodeURIComponent(q)}`);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const searchBar = `
    <div class="search-form">
      <form class="search-row" action="/search" method="get">
        <input name="q" value="${esc(q)}" placeholder="Title, author, ISBN, or keyword\u2026">
        <button type="submit">Search</button>
      </form>
    </div>
    <script>
    (function() {
      var recent = JSON.parse(localStorage.getItem("colophon:recent") || "[]");
      recent = recent.filter(function(r) { return r.q !== ${JSON.stringify(q)}; });
      recent.unshift({ q: ${JSON.stringify(q)}, type: "smart" });
      recent = recent.slice(0, 12);
      localStorage.setItem("colophon:recent", JSON.stringify(recent));
    })();
    </script>`;

  res.write(layoutHead(`${q} \u2014 Search`) + searchBar);

  try {
    if (forceType === "author") {
      // Forced author search
      res.write(await renderAuthorResults(q));
    } else if (forceType === "title") {
      // Forced title search
      res.write(await renderTitleResults(q));
    } else {
      // Smart: race author + title in parallel, pick the better result
      const [authorResult, titleResult] = await Promise.allSettled([
        getAuthorData(q),
        getTitleData(q),
      ]);

      const authorData =
        authorResult.status === "fulfilled" ? authorResult.value : null;
      const titleData =
        titleResult.status === "fulfilled" ? titleResult.value : null;

      // Author wins if we got a bio or meaningful title count
      const authorScore =
        (authorData?.bio ? 3 : 0) + (authorData?.titles.length ?? 0);
      const titleScore = titleData?.length ?? 0;

      if (authorScore > titleScore && authorScore > 0) {
        res.write(renderAuthorHtml(authorData!));
        res.write(
          `<p style="font-size:0.75rem;color:var(--neutral-500);margin-top:1rem"><a href="/search?q=${encodeURIComponent(q)}&type=title">Search as title instead</a></p>`,
        );
      } else if (titleScore > 0) {
        res.write(`<h2>${titleData!.length} results</h2>`);
        res.write(renderTitleCards(titleData!));
        res.write(
          `<p style="font-size:0.75rem;color:var(--neutral-500);margin-top:1rem"><a href="/search?q=${encodeURIComponent(q)}&type=author">Search as author instead</a></p>`,
        );
      } else {
        res.write(`<div class="msg">No results found for "${esc(q)}".</div>`);
        res.write(
          `<p style="font-size:0.85rem;margin-top:0.5rem"><a href="/search?q=${encodeURIComponent(q)}&type=author">Try as author</a> <span style="margin:0 0.5rem;color:var(--neutral-400)">\u00b7</span> <a href="/search?q=${encodeURIComponent(q)}&type=title">Try as title</a></p>`,
        );
      }
    }
  } catch (err) {
    res.write(`<div class="msg">Error: ${esc(String(err))}</div>`);
  }

  res.end(layoutFoot());
});

// ---------------------------------------------------------------------------
// Search helpers — shared between smart and forced modes
// ---------------------------------------------------------------------------

async function getAuthorData(q: string) {
  const [olResult, gbResult] = await Promise.allSettled([
    openLibrary.searchByAuthor({ author: q, sortBy: "date", limit: 20 }),
    googleBooks.searchByAuthor({ author: q, sortBy: "date", limit: 20 }),
  ]);
  const olData = olResult.status === "fulfilled" ? olResult.value : null;
  const gbData = gbResult.status === "fulfilled" ? gbResult.value : null;
  const authorName = olData?.author ?? gbData?.author ?? q;
  const bio = olData?.bio;
  const titles = dedup([...(olData?.titles ?? []), ...(gbData?.titles ?? [])]);
  return { authorName, bio, titles };
}

async function getTitleData(q: string) {
  // Use both title-specific search AND general search for better coverage.
  // General search factors in popularity, so well-known books rank higher.
  const [olTitle, gbTitle, olGeneral] = await Promise.allSettled([
    openLibrary.searchByTitle({ title: q, limit: 10 }),
    googleBooks.searchByTitle({ title: q, limit: 10 }),
    openLibrary.search({ title: q }),
  ]);

  // General search results — assign confidence based on title match quality
  const generalResults =
    olGeneral.status === "fulfilled"
      ? olGeneral.value.results.map((r) => ({
          ...r,
          confidence:
            r.title.toLowerCase() === q.toLowerCase()
              ? 1.0
              : r.title.toLowerCase().includes(q.toLowerCase())
                ? 0.7
                : 0.3,
        }))
      : [];

  const combined = dedup([
    ...(olTitle.status === "fulfilled" ? olTitle.value.results : []),
    ...generalResults,
    ...(gbTitle.status === "fulfilled" ? gbTitle.value.results : []),
  ]);

  // Sort: exact title matches first, English editions preferred, then by confidence
  const qLower = q.toLowerCase();
  combined.sort((a, b) => {
    const aExact = a.title.toLowerCase() === qLower ? 1 : 0;
    const bExact = b.title.toLowerCase() === qLower ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aEng =
      (a.editions[0] as unknown as Record<string, unknown>)?.language === "eng"
        ? 1
        : 0;
    const bEng =
      (b.editions[0] as unknown as Record<string, unknown>)?.language === "eng"
        ? 1
        : 0;
    if (aEng !== bEng) return bEng - aEng;
    return (
      ((b as { confidence?: number }).confidence ?? 0) -
      ((a as { confidence?: number }).confidence ?? 0)
    );
  });

  return combined;
}

function renderAuthorHtml(data: {
  authorName: string;
  bio?: {
    birthDate?: string;
    deathDate?: string;
    photoUrl?: string;
    bio?: string;
  };
  titles: TitleEntry[];
}): string {
  let html = `<div class="author-header"><h2 class="author-name">${esc(data.authorName)}`;
  if (data.bio?.birthDate || data.bio?.deathDate) {
    html += ` <span class="dates">(${esc(data.bio.birthDate ?? "?")}–${esc(data.bio.deathDate ?? "present")})</span>`;
  }
  html += `</h2>`;
  if (data.bio?.photoUrl || data.bio?.bio) {
    html += `<div class="bio">`;
    if (data.bio.photoUrl)
      html += `<img src="${esc(data.bio.photoUrl)}" alt="${esc(data.authorName)}">`;
    if (data.bio.bio)
      html += `<div class="bio-text"><p>${esc(data.bio.bio)}</p></div>`;
    html += `</div>`;
  }
  html += `</div>`;
  html += `<h2>${data.titles.length} titles</h2>`;
  html += `<script>document.title=${JSON.stringify(`${data.authorName} (${data.titles.length} titles) \u2014 Colophon`)}</script>`;
  html += renderTitleCards(data.titles);
  return html;
}

async function renderAuthorResults(q: string): Promise<string> {
  const data = await getAuthorData(q);
  return renderAuthorHtml(data);
}

async function renderTitleResults(q: string): Promise<string> {
  const results = await getTitleData(q);
  return `<h2>${results.length} results</h2>` + renderTitleCards(results);
}

// --- Book detail page ---
app.get("/book", async (req, res) => {
  const title = qstr(req.query.title);
  const author = qstr(req.query.author);
  const isbn = qstr(req.query.isbn);
  if (!title && !isbn) return res.redirect("/");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.write(layoutHead(`${title || isbn} — Book`));

  try {
    // Search by ISBN, title, and keyword in parallel for best coverage
    const queries: Array<
      Promise<{
        results: {
          title: string;
          authors: string[];
          description?: string;
          subjects?: string[];
          editions: Array<{
            isbn?: string;
            isbn13?: string;
            format: string;
            title: string;
            authors: string[];
            publisher: string;
            publishDate: string;
            language: string;
            pageCount?: number;
            coverImageUrl?: string;
          }>;
        }[];
      }>
    > = [];

    const searchParams = {
      title: title || undefined,
      author: author || undefined,
      isbn: isbn || undefined,
    };
    queries.push(openLibrary.search(searchParams));
    queries.push(googleBooks.search(searchParams));

    // If ISBN-only, also try a title search with the ISBN as keyword (catches more results)
    if (isbn && !title) {
      queries.push(openLibrary.search({ keywords: [isbn] }));
    }

    const settled = await Promise.allSettled(queries);
    const allResults = dedup(
      settled.flatMap((r) => (r.status === "fulfilled" ? r.value.results : [])),
    );

    const book = allResults[0];
    if (!book) {
      let noResult = `<div class="msg">No results found${isbn ? ` for ISBN ${esc(isbn)}` : ""}. This ISBN may not be indexed by Open Library or Google Books.</div>`;
      if (isbn) {
        noResult += `<div style="margin-top:1rem;font-size:0.85rem">
          <a href="/retailers/lookup?isbn=${esc(isbn)}">Check AbeBooks for pricing</a>
          <span style="margin:0 0.5rem;color:var(--neutral-400)">\u00b7</span>
          <a href="/libraries/lookup?isbn=${esc(isbn)}">Check library availability</a>
        </div>`;
      }
      res.write(noResult);
      res.end(layoutFoot());
      return;
    }

    const coverUrl = findCover(book.editions);
    const sizes = coverUrl ? coverSizes(coverUrl) : null;
    const bestIsbn = book.editions[0]?.isbn13 ?? book.editions[0]?.isbn;

    // Breadcrumbs
    let html = `<div class="breadcrumbs"><a href="/">Search</a>`;
    if (book.authors[0]) {
      html += `<span>\u203A</span><a href="/search?q=${encodeURIComponent(book.authors[0])}&type=author">${esc(book.authors[0])}</a>`;
    }
    html += `<span>\u203A</span>${esc(book.title)}</div>`;

    html += `<div class="book-detail">`;

    // Cover
    html += `<div class="book-cover">`;
    if (sizes) {
      html += `<a href="${esc(sizes.full)}" target="_blank"><img src="${esc(sizes.full)}" alt="${esc(book.title)}" onload="if(this.naturalWidth<=1){var p=document.createElement('div');p.className='placeholder-lg';p.textContent='No cover';this.parentElement.replaceWith(p)}" onerror="var p=document.createElement('div');p.className='placeholder-lg';p.textContent='No cover';this.parentElement.replaceWith(p)"></a>`;
    } else {
      html += `<div class="placeholder-lg">No cover</div>`;
    }
    html += `</div>`;

    // Meta
    html += `<div class="book-meta">`;
    html += `<h2>${esc(book.title)}</h2>`;
    html += `<div class="authors">${book.authors
      .map(
        (a) =>
          `<a href="/search?q=${encodeURIComponent(a)}&type=author">${esc(a)}</a>`,
      )
      .join(", ")}</div>`;

    const ed = book.editions[0];
    if (ed) {
      if (ed.publisher && ed.publisher !== "unknown") {
        html += `<div class="detail-row"><span>Publisher</span>${esc(ed.publisher)}</div>`;
      }
      if (ed.publishDate && ed.publishDate !== "unknown") {
        html += `<div class="detail-row"><span>Published</span>${esc(ed.publishDate)}</div>`;
      }
      if (ed.pageCount) {
        html += `<div class="detail-row"><span>Pages</span>${ed.pageCount}</div>`;
        const readingMins = Math.round((ed.pageCount * 250) / 200);
        const readingHrs = Math.floor(readingMins / 60);
        const readingRem = readingMins % 60;
        html += `<div class="reading-time">${readingHrs > 0 ? `${readingHrs}h ${readingRem}m` : `${readingMins}m`} estimated reading time</div>`;
      }
      if (ed.language && ed.language !== "unknown") {
        html += `<div class="detail-row"><span>Language</span>${esc(ed.language)}</div>`;
      }
      if (bestIsbn) {
        html += `<div class="detail-row"><span>ISBN</span><code style="font-size:0.85rem">${esc(bestIsbn)}</code></div>`;
      }
    }

    html += `<div class="detail-row"><span>Editions</span>${book.editions.length}</div>`;

    // Share button
    html += `<div style="margin-top:0.75rem"><button class="share-btn" id="share-btn">Copy link</button></div>
    <script>document.getElementById("share-btn")?.addEventListener("click",function(){var b=this;navigator.clipboard.writeText(window.location.href).then(function(){b.textContent="Copied!"})});</script>`;

    // Price comparison + actions
    if (bestIsbn) {
      const comparison = await getRetailerComparison(bestIsbn);

      html += `<div class="book-actions">
        <a href="/libraries/lookup?isbn=${esc(bestIsbn)}">Check library</a>
        <a href="/ebooks/lookup?q=${esc(bestIsbn)}">Find ebook</a>
        ${book.authors[0] ? `<a href="/search?q=${encodeURIComponent(book.authors[0])}&type=author">More by ${esc(book.authors[0])}</a>` : ""}
        <a href="https://www.goodreads.com/search?q=${encodeURIComponent(bestIsbn)}" target="_blank">Goodreads</a>
      </div>`;

      // Price comparison table
      html += `</div></div><h2>Price comparison</h2><div class="pricing"><table>
        <tr><th>Source</th><th>Condition</th><th>Price</th><th></th></tr>`;

      if (comparison.abebooks.newPrice) {
        html += `<tr><td>AbeBooks</td><td>New</td><td class="price">${esc(comparison.abebooks.newPrice)}</td><td><a href="${esc(comparison.abebooks.newUrl)}" target="_blank">Buy \u2192</a></td></tr>`;
      }
      if (comparison.abebooks.usedPrice) {
        html += `<tr><td>AbeBooks</td><td>Used</td><td class="price">${esc(comparison.abebooks.usedPrice)}</td><td><a href="${esc(comparison.abebooks.usedUrl)}" target="_blank">Buy \u2192</a></td></tr>`;
      }
      for (const eb of comparison.ebay) {
        html += `<tr><td>eBay: ${esc(eb.seller.replace("eBay: ", ""))}</td><td>${esc(eb.condition)}</td><td class="price">${esc(eb.price)}</td><td><a href="${esc(eb.url)}" target="_blank">Buy \u2192</a></td></tr>`;
      }
      html += `</table></div>`;

      // Also search at
      html += `<h2>Also search at</h2><div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:2rem">`;
      for (const link of comparison.links) {
        html += `<a href="${esc(link.url)}" target="_blank" style="font-size:0.85rem;border:1px solid var(--neutral-200);padding:0.4rem 0.75rem;text-decoration:none;color:var(--fg);transition:border-color 0.2s">${esc(link.name)}</a>`;
      }
      html += `</div>`;

      // Reviews & ratings
      const reviews = await getReviewLinks({
        isbn: bestIsbn,
        title: book.title,
        author: book.authors[0],
      });

      html += `<h2>Reviews &amp; ratings</h2>`;

      // Open Library ratings
      if (reviews.ratings?.average) {
        const stars =
          "\u2605".repeat(Math.round(reviews.ratings.average)) +
          "\u2606".repeat(5 - Math.round(reviews.ratings.average));
        html += `<div style="margin-bottom:1rem">`;
        html += `<span style="font-size:1.1rem;letter-spacing:0.1em">${stars}</span> `;
        html += `<span style="font-size:0.85rem;color:var(--neutral-400)">${reviews.ratings.average.toFixed(1)}/5`;
        if (reviews.ratings.count)
          html += ` (${reviews.ratings.count} ratings)`;
        html += `</span>`;
        if (reviews.ratings.alreadyRead || reviews.ratings.wantToRead) {
          html += `<div style="font-size:0.75rem;color:var(--neutral-500);margin-top:0.25rem">`;
          const parts: string[] = [];
          if (reviews.ratings.alreadyRead)
            parts.push(`${reviews.ratings.alreadyRead.toLocaleString()} read`);
          if (reviews.ratings.wantToRead)
            parts.push(
              `${reviews.ratings.wantToRead.toLocaleString()} want to read`,
            );
          if (reviews.ratings.currentlyReading)
            parts.push(
              `${reviews.ratings.currentlyReading.toLocaleString()} reading`,
            );
          html += parts.join(" \u00b7 ");
          html += `</div>`;
        }
        html += `</div>`;
      }

      // Review links
      html += `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:2rem">`;
      for (const link of reviews.links) {
        html += `<a href="${esc(link.url)}" target="_blank" style="font-size:0.85rem;border:1px solid var(--neutral-200);padding:0.4rem 0.75rem;text-decoration:none;color:var(--fg);transition:border-color 0.2s">${esc(link.name)}</a>`;
      }
      html += `</div>`;

      // Re-open the book-meta div we closed for the table
      html += `<div style="display:none">`;
    }

    // Description
    if (book.description) {
      html += `<div class="description">${esc(book.description)}</div>`;
    }

    // Subjects
    if (book.subjects?.length) {
      html += `<div class="subjects">${book.subjects
        .slice(0, 12)
        .map((s) => `<span>${esc(s)}</span>`)
        .join("")}</div>`;
    }

    html += `</div></div>`;
    res.write(html);
  } catch (err) {
    res.write(
      `<script>document.querySelector(".loading-bar")?.remove();document.querySelector(".loading-text")?.remove();</script>`,
    );
    res.write(`<div class="msg">Error: ${esc(String(err))}</div>`);
  }

  res.end(layoutFoot());
});

app.get("/retailers", (_req, res) => {
  res.send(
    layout(
      "Retailers",
      `
    <div class="search-form">
      <form class="search-row" action="/retailers/lookup" method="get">
        <input name="isbn" placeholder="Enter ISBN\u2026" autofocus required>
        <button type="submit">Find Prices</button>
      </form>
    </div>
  `,
    ),
  );
});

app.get("/retailers/lookup", async (req, res) => {
  const isbn = qstr(req.query.isbn);
  if (!isbn) return res.redirect("/retailers");

  try {
    const result = await abebooks.lookupByIsbn(isbn);
    let html = `
      <div class="search-form">
        <form class="search-row" action="/retailers/lookup" method="get">
          <input name="isbn" value="${esc(isbn)}" placeholder="Enter ISBN\u2026">
          <button type="submit">Find Prices</button>
        </form>
      </div>
      <h2>Prices for ${esc(isbn)}</h2>`;

    if (result.buyNew.length || result.buyUsed.length) {
      html += `<div class="pricing"><table>
        <tr><th>Condition</th><th>Price</th><th>Shipping</th><th>Seller</th><th></th></tr>`;
      for (const item of [...result.buyNew, ...result.buyUsed]) {
        html += `<tr>
          <td>${esc(item.condition)}</td>
          <td class="price">${esc(item.price)}</td>
          <td>${esc(item.shippingNote ?? "\u2014")}</td>
          <td>${esc(item.seller)}</td>
          <td><a href="${esc(item.url)}" target="_blank">Buy \u2192</a></td>
        </tr>`;
      }
      html += `</table></div>`;
    } else {
      html += `<div class="msg">No listings found on AbeBooks for this ISBN.</div>`;
    }

    res.send(layout(`Retailers \u2014 ${isbn}`, html));
  } catch (err) {
    res.send(
      layout("Error", `<div class="msg">Error: ${esc(String(err))}</div>`),
    );
  }
});

app.get("/libraries", (_req, res) => {
  res.send(
    layout(
      "Libraries",
      `
    <div class="search-form">
      <form class="search-row" action="/libraries/lookup" method="get">
        <input name="isbn" placeholder="Enter ISBN\u2026" autofocus required>
        <button type="submit">Check Availability</button>
      </form>
    </div>
  `,
    ),
  );
});

app.get("/libraries/lookup", async (req, res) => {
  const isbn = qstr(req.query.isbn);
  if (!isbn) return res.redirect("/libraries");

  try {
    const result = await olAvailability.checkAvailabilityByIsbn(isbn);
    let html = `
      <div class="search-form">
        <form class="search-row" action="/libraries/lookup" method="get">
          <input name="isbn" value="${esc(isbn)}" placeholder="Enter ISBN\u2026">
          <button type="submit">Check Availability</button>
        </form>
      </div>
      <h2>Library availability for ${esc(isbn)}</h2>`;

    if (result.libraries.length) {
      html += `<div class="pricing"><table>
        <tr><th>Library</th><th>Format</th><th>Available</th><th></th></tr>`;
      for (const lib of result.libraries) {
        html += `<tr>
          <td>${esc(lib.library)}</td>
          <td>${esc(lib.format)}</td>
          <td>${lib.available ? "Available" : "Checked out"} ${lib.waitlist ? `(${lib.waitlist} waiting)` : ""}</td>
          <td>${lib.url ? `<a href="${esc(lib.url)}" target="_blank">Borrow \u2192</a>` : ""}</td>
        </tr>`;
      }
      html += `</table></div>`;
    } else {
      html += `<div class="msg">No lending availability found on Open Library. Try your local library catalog.</div>`;
    }

    res.send(layout(`Libraries \u2014 ${isbn}`, html));
  } catch (err) {
    res.send(
      layout("Error", `<div class="msg">Error: ${esc(String(err))}</div>`),
    );
  }
});

app.get("/ebooks", (_req, res) => {
  res.send(
    layout(
      "Ebooks",
      `
    <div class="search-form">
      <form class="search-row" action="/ebooks/lookup" method="get">
        <input name="q" placeholder="Title or ISBN\u2026" autofocus required>
        <button type="submit">Check Ebooks</button>
      </form>
    </div>
  `,
    ),
  );
});

app.get("/ebooks/lookup", async (req, res) => {
  const q = qstr(req.query.q);
  if (!q) return res.redirect("/ebooks");

  try {
    const isIsbn = /^[\d-]{10,17}$/.test(q.replace(/-/g, ""));
    const result = await googleBooks.checkEbookAvailability(
      isIsbn ? { isbn: q } : { title: q },
    );

    let html = `
      <div class="search-form">
        <form class="search-row" action="/ebooks/lookup" method="get">
          <input name="q" value="${esc(q)}" placeholder="Title or ISBN\u2026">
          <button type="submit">Check Ebooks</button>
        </form>
      </div>
      <h2>Ebook availability</h2>`;

    if (result.ebooks.length) {
      html += `<div class="pricing"><table>
        <tr><th>Title</th><th>Price</th><th>Format</th><th></th></tr>`;
      for (const eb of result.ebooks) {
        html += `<tr>
          <td>${esc(eb.title)}<br><span style="font-size:0.75rem;color:var(--neutral-500)">${esc(eb.authors.join(", "))}</span></td>
          <td class="price">${esc(eb.price)}</td>
          <td style="font-size:0.8rem">${esc(eb.shippingNote ?? "\u2014")}</td>
          <td><a href="${esc(eb.url)}" target="_blank">View \u2192</a></td>
        </tr>`;
      }
      html += `</table></div>`;
    } else {
      html += `<div class="msg">No ebook listings found on Google Play Books.</div>`;
    }

    res.send(layout(`Ebooks \u2014 ${q}`, html));
  } catch (err) {
    res.send(
      layout("Error", `<div class="msg">Error: ${esc(String(err))}</div>`),
    );
  }
});

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

type TitleEntry = {
  title: string;
  authors?: string[];
  firstPublished?: string;
  editions: Array<{
    isbn?: string;
    isbn13?: string;
    publisher?: string;
    publishDate?: string;
    coverImageUrl?: string;
  }>;
};

function renderTitleCards(titles: TitleEntry[]): string {
  // Collect languages for filter chips
  const langCounts = new Map<string, number>();
  for (const t of titles) {
    const lang =
      ((t.editions[0] as Record<string, unknown>)?.language as string) ??
      "unknown";
    if (lang && lang !== "unknown")
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }

  let html = "";
  // Language filter chips (only if more than one language)
  if (langCounts.size > 1) {
    html += `<div class="filters" id="lang-filters">
      <a href="#" class="active" data-lang="all">All</a>`;
    const sorted = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [lang, count] of sorted) {
      html += `<a href="#" data-lang="${esc(lang)}">${esc(lang)} (${count})</a>`;
    }
    html += `</div>
    <script>
    document.getElementById("lang-filters")?.addEventListener("click", function(e) {
      e.preventDefault();
      var target = e.target;
      if (!target.dataset?.lang) return;
      var lang = target.dataset.lang;
      this.querySelectorAll("a").forEach(function(a) { a.classList.remove("active"); });
      target.classList.add("active");
      document.querySelectorAll(".card[data-lang]").forEach(function(card) {
        card.style.display = (lang === "all" || card.dataset.lang === lang) ? "" : "none";
      });
    });
    </script>`;
  }

  html += `<div class="results">`;

  for (const t of titles) {
    const isbn = t.editions[0]?.isbn13 ?? t.editions[0]?.isbn;
    const publisher = t.editions[0]?.publisher ?? "";
    const year = t.firstPublished ?? t.editions[0]?.publishDate ?? "";
    const lang =
      ((t.editions[0] as Record<string, unknown>)?.language as string) ?? "";
    const authors = t.authors?.join(", ") ?? "";
    const coverUrl = findCover(t.editions);
    const sizes = coverUrl ? coverSizes(coverUrl) : null;

    const bookUrl = `/book?title=${encodeURIComponent(t.title)}${authors ? `&author=${encodeURIComponent(t.authors?.[0] ?? "")}` : ""}${isbn ? `&isbn=${encodeURIComponent(isbn)}` : ""}`;
    const authorLinks = (t.authors ?? [])
      .map(
        (a) =>
          `<a href="/search?q=${encodeURIComponent(a)}&type=author">${esc(a)}</a>`,
      )
      .join(", ");

    html += `<div class="card"${lang && lang !== "unknown" ? ` data-lang="${esc(lang)}"` : ""}>`;
    if (sizes) {
      html += `<a href="${esc(bookUrl)}"><img src="${esc(sizes.thumb)}" alt="${esc(t.title)}" loading="lazy" onload="if(this.naturalWidth<=2||this.naturalHeight<=2){var p=document.createElement('div');p.className='placeholder';p.textContent='No cover';this.parentElement.replaceWith(p)}" onerror="var p=document.createElement('div');p.className='placeholder';p.textContent='No cover';this.parentElement.replaceWith(p)"></a>`;
    } else {
      html += `<a href="${esc(bookUrl)}" class="placeholder">No cover</a>`;
    }
    html += `<div class="card-info">
      <h3><a href="${esc(bookUrl)}" style="text-decoration:none;color:inherit">${esc(t.title)}</a></h3>
      <div class="meta">${authorLinks}${publisher && publisher !== "unknown" ? ` \u2014 ${esc(publisher)}` : ""}${year && year !== "unknown" ? `, ${esc(year)}` : ""}</div>`;

    // Lazy-loaded price slot
    if (isbn) {
      html += `<div class="price-slot loading" data-isbn="${esc(isbn)}">loading prices\u2026</div>`;
    }

    html += `${renderEditionIsbns(t)}
      <div class="editions">${t.editions.length} edition(s)</div>
    </div></div>`;
  }

  html += `</div><script>loadPrices()</script>`;
  return html;
}

function renderEditionIsbns(t: {
  title: string;
  editions: Array<{
    isbn?: string;
    isbn13?: string;
    publisher?: string;
    publishDate?: string;
  }>;
}): string {
  // Collect unique ISBNs with their edition info
  const seen = new Set<string>();
  const entries: Array<{ isbn: string; publisher: string; year: string }> = [];

  for (const ed of t.editions) {
    const id = ed.isbn13 ?? ed.isbn;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pub = ed.publisher && ed.publisher !== "unknown" ? ed.publisher : "";
    const yr =
      ed.publishDate && ed.publishDate !== "unknown" ? ed.publishDate : "";
    entries.push({ isbn: id, publisher: pub, year: yr });
  }

  if (entries.length === 0) return "";

  if (entries.length === 1) {
    const e = entries[0];
    return `<div class="isbn"><a href="/book?isbn=${encodeURIComponent(e.isbn)}&title=${encodeURIComponent(t.title)}" style="color:inherit">${esc(e.isbn)}</a>
      <a href="/retailers/lookup?isbn=${esc(e.isbn)}">prices</a>
      <a href="/libraries/lookup?isbn=${esc(e.isbn)}">library</a>
      <a href="/ebooks/lookup?q=${esc(e.isbn)}">ebook</a>
    </div>`;
  }

  // Multiple ISBNs — show each as a row
  let html = `<div class="isbn">`;
  for (const e of entries) {
    const label = [e.publisher, e.year].filter(Boolean).join(", ");
    html += `<div style="margin-bottom:0.2rem"><a href="/book?isbn=${encodeURIComponent(e.isbn)}&title=${encodeURIComponent(t.title)}" style="color:inherit">${esc(e.isbn)}</a>`;
    if (label)
      html += ` <span style="color:var(--neutral-400);font-size:0.65rem">${esc(label)}</span>`;
    html += ` <a href="/retailers/lookup?isbn=${esc(e.isbn)}">prices</a>`;
    html += ` <a href="/libraries/lookup?isbn=${esc(e.isbn)}">library</a>`;
    html += ` <a href="/ebooks/lookup?q=${esc(e.isbn)}">ebook</a>`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Colophon web UI running at http://localhost:${PORT}`);
});
