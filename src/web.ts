import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { config } from "./core/config.js";
import { logger } from "./core/logger.js";
import * as openLibrary from "./core/openlibrary.js";
import * as googleBooks from "./core/googlebooks.js";
import * as abebooks from "./core/abebooks.js";
import * as olAvailability from "./core/openlibrary-availability.js";
import { getRetailerComparison } from "./core/retailers.js";
import { getReviewLinks } from "./core/reviews.js";
import { dedup } from "./core/dedup.js";

const app = express();
const PORT = config.port;

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
app.use(express.static("public"));
// CORS for JSON API endpoints
app.use("/api", cors());
// Separate rate limit for cover proxy (more permissive)
app.use(
  "/api/cover",
  rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }),
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

/** Strip markdown formatting from book descriptions */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/\*([^*]+)\*/g, "$1")     // *italic*
    .replace(/__([^_]+)__/g, "$1")     // __bold__
    .replace(/_([^_]+)_/g, "$1")       // _italic_
    .replace(/#{1,6}\s/g, "")          // # headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [links](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "") // ![images](url)
    .trim();
}

function qstr(val: unknown): string {
  const s = (typeof val === "string" ? val : "").trim();
  return s.slice(0, config.maxInputLength);
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
<link rel="manifest" href="/manifest.json">
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

  /* Sort controls */
  .sort-bar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; }
  .sort-bar span { font-size: 0.7rem; color: var(--neutral-500); text-transform: uppercase; letter-spacing: 0.04em; }
  .sort-bar a { font-size: 0.75rem; text-decoration: none; color: var(--neutral-400); transition: color 0.2s; }
  .sort-bar a:hover, .sort-bar a.active { color: var(--fg); font-weight: 600; opacity: 1; }

  /* Reading list button */
  .save-btn { font-size: 0.65rem; color: var(--neutral-400); background: none; border: 1px solid var(--neutral-200);
    padding: 0.15rem 0.4rem; cursor: pointer; font-family: inherit; transition: all 0.2s; margin-left: 0.5rem; }
  .save-btn:hover { border-color: var(--fg); color: var(--fg); }
  .save-btn.saved { border-color: var(--fg); color: var(--fg); }

  /* Reading list page */
  .reading-list-empty { text-align: center; padding: 3rem 0; color: var(--neutral-400); }

  /* Autocomplete */
  .ac-wrap { position: relative; flex: 1; }
  .ac-wrap input { width: 100%; }
  .ac-list { position: absolute; top: 100%; left: 0; right: 0; background: var(--bg);
    border: 1px solid var(--neutral-200); z-index: 10; max-height: 240px; overflow-y: auto; display: none; }
  .ac-list.open { display: block; }
  .ac-list a { display: block; padding: 0.5rem 0.75rem; text-decoration: none; color: var(--fg);
    font-size: 0.85rem; border-bottom: 1px solid var(--neutral-200); }
  .ac-list a:hover { background: var(--neutral-200); opacity: 1; }

  /* Related books */
  .related { display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; }
  .related-card { flex-shrink: 0; width: 100px; text-align: center; }
  .related-card img { width: 70px; height: 105px; object-fit: cover; background: var(--neutral-200); }
  .related-card a { font-size: 0.7rem; text-decoration: none; color: var(--fg); display: block; margin-top: 0.3rem;
    line-height: 1.2; }

  /* Print */
  @media print {
    body { background: #fff; color: #000; padding: 0; }
    header, .theme-toggle, .search-form, .filters, .sort-bar, .share-btn,
    .save-btn, .ac-list, .price-slot, .book-actions, #recent { display: none !important; }
    .card { break-inside: avoid; border-bottom: 1px solid #ccc; }
    .card img { width: 40px; height: 60px; }
    a { color: #000; }
    a[href]::after { content: " (" attr(href) ")"; font-size: 0.7rem; color: #666; }
    a[href^="/"]::after { display: none; }
    h2 { border-color: #000; }
  }

  /* Mobile */
  @media (max-width: 600px) {
    body { padding: 1rem; }
    header h1 { font-size: 1.8rem; }
    .search-row { flex-wrap: wrap; }
    .search-row input { min-width: 100%; }
    .book-detail { flex-direction: column; gap: 1rem; }
    .book-cover img { width: 120px; }
    .book-cover .placeholder-lg { width: 120px; height: 180px; }
    .bio { flex-direction: column; gap: 0.75rem; }
    .bio img { width: 60px; }
    .book-actions { flex-wrap: wrap; gap: 0.75rem; }
    .related { gap: 0.5rem; }
  }

  /* Empty state */
  .empty-state { text-align: center; padding: 3rem 0; }
  .empty-state .icon { font-size: 3rem; margin-bottom: 1rem; }
  .empty-state p { color: var(--neutral-400); font-size: 0.9rem; }

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
// Sort results client-side
function sortResults(by) {
  var container = document.querySelector(".results");
  if (!container) return;
  var cards = Array.from(container.querySelectorAll(".card"));
  cards.sort(function(a, b) {
    if (by === "title") {
      return (a.querySelector("h3")?.textContent || "").localeCompare(b.querySelector("h3")?.textContent || "");
    } else if (by === "date") {
      var ya = (a.querySelector(".meta")?.textContent || "").match(/\\d{4}/);
      var yb = (b.querySelector(".meta")?.textContent || "").match(/\\d{4}/);
      return (ya ? parseInt(ya[0]) : 9999) - (yb ? parseInt(yb[0]) : 9999);
    }
    return 0;
  });
  cards.forEach(function(c) { container.appendChild(c); });
  container.querySelectorAll(".sort-bar a").forEach(function(a) { a.classList.remove("active"); });
  document.querySelector('.sort-bar a[data-sort="' + by + '"]')?.classList.add("active");
}
// Reading list
function getReadingList() { return JSON.parse(localStorage.getItem("colophon:readinglist") || "[]"); }
function saveToReadingList(isbn, title, author) {
  var list = getReadingList();
  if (list.some(function(r) { return r.isbn === isbn; })) return;
  list.push({ isbn: isbn, title: title, author: author, added: new Date().toISOString() });
  localStorage.setItem("colophon:readinglist", JSON.stringify(list));
}
function removeFromReadingList(isbn) {
  var list = getReadingList().filter(function(r) { return r.isbn !== isbn; });
  localStorage.setItem("colophon:readinglist", JSON.stringify(list));
}
function isInReadingList(isbn) { return getReadingList().some(function(r) { return r.isbn === isbn; }); }
// Autocomplete
var acTimeout;
function setupAutocomplete(input) {
  var wrap = input.parentElement;
  if (!wrap.classList.contains("ac-wrap")) return;
  var list = wrap.querySelector(".ac-list");
  input.addEventListener("input", function() {
    clearTimeout(acTimeout);
    var q = input.value.trim();
    if (q.length < 3) { list.classList.remove("open"); return; }
    acTimeout = setTimeout(function() {
      fetch("/api/autocomplete?q=" + encodeURIComponent(q))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.docs || !d.docs.length) { list.classList.remove("open"); return; }
          list.innerHTML = d.docs.map(function(doc) {
            var authors = (doc.author_name || []).join(", ");
            return '<a href="/search?q=' + encodeURIComponent(doc.title) + '">' + doc.title + (authors ? ' <span style="color:var(--neutral-500);font-size:0.75rem">' + authors + '</span>' : '') + '</a>';
          }).join("");
          list.classList.add("open");
        }).catch(function() { list.classList.remove("open"); });
    }, 300);
  });
  input.addEventListener("blur", function() { setTimeout(function() { list.classList.remove("open"); }, 200); });
  input.addEventListener("focus", function() { if (list.innerHTML) list.classList.add("open"); });
}
document.addEventListener("DOMContentLoaded", function() {
  document.querySelectorAll(".ac-wrap input").forEach(setupAutocomplete);
  // Mark saved books + delegate save clicks
  document.querySelectorAll(".save-btn").forEach(function(btn) {
    if (isInReadingList(btn.dataset.isbn)) { btn.textContent = "saved"; btn.classList.add("saved"); }
  });
  document.addEventListener("click", function(e) {
    var btn = e.target.closest?.(".save-btn");
    if (!btn || btn.classList.contains("saved")) return;
    saveToReadingList(btn.dataset.isbn, btn.dataset.title, btn.dataset.author);
    btn.textContent = "saved";
    btn.classList.add("saved");
  });
});
// Service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(function(){});
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

// --- Autocomplete proxy ---
app.get("/api/autocomplete", async (req, res) => {
  const q = qstr(req.query.q);
  if (q.length < 2) { res.json({ docs: [] }); return; }
  try {
    const r = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5&fields=title,author_name`,
      { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(config.apiTimeout) },
    );
    if (!r.ok) { res.json({ docs: [] }); return; }
    const data = await r.json();
    res.json(data);
  } catch {
    res.json({ docs: [] });
  }
});

// --- Health check ---
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// --- Cover image proxy: validates and caches cover images ---
import { get as cacheGet, set as cacheSet } from "./core/cache.js";

const COVER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

app.get("/api/cover/:id", async (req, res) => {
  const id = req.params.id;
  const size = (req.query.s as string) || "M";
  const type = (req.query.t as string) === "a" ? "a" : "b";
  const cacheKey = `cover:${type}:${id}:${size}`;

  // Check server-side cache
  const cached = cacheGet<{ contentType: string; data: Buffer } | null>(cacheKey);
  if (cached !== undefined) {
    if (cached === null) { res.status(404).end(); return; }
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(cached.data);
    return;
  }

  try {
    const url = `https://covers.openlibrary.org/${type}/id/${id}-${size}.jpg`;
    const upstream = await fetch(url, {
      headers: { "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(config.coverTimeout),
      redirect: "follow",
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    if (!contentType.startsWith("image/") || buffer.length < 100) {
      cacheSet(cacheKey, null, COVER_CACHE_TTL);
      res.status(404).end();
      return;
    }

    cacheSet(cacheKey, { contentType, data: buffer }, COVER_CACHE_TTL);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    cacheSet(cacheKey, null, 5 * 60 * 1000); // cache failures for 5 min
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
        <div class="ac-wrap">
          <input id="q" name="q" placeholder="Title, author, ISBN, or keyword\u2026" autofocus required autocomplete="off">
          <div class="ac-list"></div>
        </div>
        <button type="submit">Search</button>
      </form>
    </div>
    <div style="margin-bottom:1rem"><a href="/reading-list" style="font-size:0.8rem;color:var(--neutral-400);text-decoration:none">Reading list</a></div>
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
  let forceType = qstr(req.query.type);
  if (!q) return res.redirect("/");

  // ISBN → book page
  if (isIsbn(q)) {
    return res.redirect(`/book?isbn=${encodeURIComponent(q)}`);
  }

  // Single word → always title search (never an author name)
  const isSingleWord = !q.includes(" ");
  if (isSingleWord && !forceType) {
    forceType = "title";
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const searchBar = `
    <div class="search-form">
      <form class="search-row" action="/search" method="get">
        <div class="ac-wrap">
          <input name="q" value="${esc(q)}" placeholder="Title, author, ISBN, or keyword\u2026" autocomplete="off">
          <div class="ac-list"></div>
        </div>
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
      // Smart: fast author probe, then commit to one path
      // Only probe if multi-word query (single words are always titles)
      let isAuthor = false;
      if (q.includes(" ")) {
        try {
          const probe = await fetch(
            `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(q)}&limit=1`,
            { headers: { "User-Agent": "ColophonMCP/1.0" }, signal: AbortSignal.timeout(2000) },
          );
          if (probe.ok) {
            const data = (await probe.json()) as { docs?: Array<{ work_count?: number }> };
            isAuthor = (data.docs?.[0]?.work_count ?? 0) >= 5;
          }
        } catch {
          // Probe failed — default to title
        }
      }

      if (isAuthor) {
        const authorData = await getAuthorData(q);
        if (authorData.titles.length > 0) {
          res.write(renderAuthorHtml(authorData));
          res.write(
            `<p style="font-size:0.75rem;color:var(--neutral-500);margin-top:1rem"><a href="/search?q=${encodeURIComponent(q)}&type=title">Search as title instead</a></p>`,
          );
        } else {
          // Author found but no titles — fall back to title search
          const titleData = await getTitleData(q);
          if (titleData.length > 0) {
            res.write(`<h2>${titleData.length} results</h2>`);
            res.write(renderTitleCards(titleData));
          } else {
            res.write(`<div class="empty-state"><div class="icon">\uD83D\uDD0D</div><p>No results found for "${esc(q)}"</p></div>`);
          }
          res.write(
            `<p style="font-size:0.75rem;color:var(--neutral-500);margin-top:1rem"><a href="/search?q=${encodeURIComponent(q)}&type=author">Try as author</a></p>`,
          );
        }
      } else {
        const titleData = await getTitleData(q);
        if (titleData.length > 0) {
          res.write(`<h2>${titleData.length} results</h2>`);
          res.write(renderTitleCards(titleData));
        } else {
          res.write(`<div class="empty-state"><div class="icon">\uD83D\uDD0D</div><p>No results found for "${esc(q)}"</p></div>`);
        }
        res.write(
          `<p style="font-size:0.75rem;color:var(--neutral-500);margin-top:1rem"><a href="/search?q=${encodeURIComponent(q)}&type=author">Search as author instead</a></p>`,
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
  // Title search from both sources in parallel
  // Only add general search for short queries (≤3 words) where ranking matters
  const isShortQuery = q.split(/\s+/).length <= 3;
  const promises: Array<Promise<unknown>> = [
    openLibrary.searchByTitle({ title: q, limit: 10 }),
    googleBooks.searchByTitle({ title: q, limit: 10 }),
  ];
  if (isShortQuery) {
    promises.push(openLibrary.search({ title: q }));
  }

  const [olTitle, gbTitle, olGeneral] = await Promise.allSettled(promises);

  // General search results — assign confidence based on title match quality
  const generalResults =
    olGeneral?.status === "fulfilled"
      ? ((olGeneral.value as { results: Array<{ title: string; editions: Array<{ language?: string }> }> }).results).map((r) => ({
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
    ...(olTitle.status === "fulfilled" ? (olTitle.value as { results: Array<Record<string, unknown>> }).results : []),
    ...generalResults,
    ...(gbTitle.status === "fulfilled" ? (gbTitle.value as { results: Array<Record<string, unknown>> }).results : []),
  ] as Array<{ title: string; authors?: string[]; description?: string; editions: Array<{ isbn?: string; isbn13?: string; language?: string }> }>);

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
    if (data.bio.photoUrl) {
      // Proxy author photos through our server to validate
      const photoMatch = data.bio.photoUrl.match(/\/a\/id\/(\d+)/);
      const photoSrc = photoMatch ? `/api/cover/${photoMatch[1]}?s=L&t=a` : data.bio.photoUrl;
      html += `<img src="${esc(photoSrc)}" alt="${esc(data.authorName)}" onerror="this.remove()">`;
    }
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
// --- Reading list page ---
app.get("/reading-list", (_req, res) => {
  res.send(
    layout(
      "Reading List",
      `
    <h2 style="margin-top:0">Reading list</h2>
    <div id="reading-list-content"><div class="reading-list-empty">Loading...</div></div>
    <script>
    (function() {
      var list = JSON.parse(localStorage.getItem("colophon:readinglist") || "[]");
      var el = document.getElementById("reading-list-content");
      if (!list.length) {
        el.innerHTML = '<div class="empty-state"><div class="icon">\\uD83D\\uDCDA</div><p>No books saved yet. Click \\u201Csave\\u201D on any book to add it here.</p></div>';
        return;
      }
      var html = '<div class="results">';
      list.forEach(function(r) {
        html += '<div class="card"><div class="card-info">';
        html += '<h3><a href="/book?isbn=' + encodeURIComponent(r.isbn) + '&title=' + encodeURIComponent(r.title) + '" style="text-decoration:none;color:inherit">' + r.title + '</a></h3>';
        html += '<div class="meta">' + (r.author || "") + '</div>';
        html += '<div class="isbn">' + r.isbn + ' <button class="save-btn saved" onclick="removeFromReadingList(\\'' + r.isbn + '\\');this.closest(\\'div.card\\').remove()">remove</button></div>';
        html += '</div></div>';
      });
      html += '</div>';
      html += '<div style="margin-top:1rem"><button id="export-csv" style="font-size:0.8rem;color:var(--neutral-400);background:none;border:1px solid var(--neutral-200);padding:0.3rem 0.6rem;cursor:pointer;font-family:inherit">Export as CSV</button></div>';
      html += '<script>document.getElementById("export-csv")?.addEventListener("click",function(){var list=JSON.parse(localStorage.getItem("colophon:readinglist")||"[]");var csv="Title,Author,ISBN,Added\\n"+list.map(function(r){return [r.title,r.author,r.isbn,r.added].map(function(f){return \\'\"\\'+String(f||\\'\\').replace(/"/g,\\'""\\')+"\\""}).join(",")}).join("\\n");var blob=new Blob([csv],{type:"text/csv"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="reading-list.csv";a.click()});</script>';
      el.innerHTML = html;
    })();
    </script>
  `,
    ),
  );
});

// CSV export is client-side (reading list is in localStorage)

// --- Wikipedia summary API ---
app.get("/api/wiki/:name", async (req, res) => {
  const name = req.params.name;
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "ColophonMCP/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) { res.json({ extract: null }); return; }
    const data = (await r.json()) as { extract?: string; thumbnail?: { source: string } };
    res.json({ extract: data.extract, thumbnail: data.thumbnail?.source });
  } catch {
    res.json({ extract: null });
  }
});

// --- Related books by subject ---
app.get("/api/related/:subject", async (req, res) => {
  const subject = req.params.subject;
  try {
    const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject.toLowerCase().replace(/\s+/g, "_"))}.json?limit=8`;
    const r = await fetch(url, {
      headers: { "User-Agent": "ColophonMCP/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) { res.json({ works: [] }); return; }
    const data = (await r.json()) as {
      works?: Array<{
        title: string;
        authors?: Array<{ name: string }>;
        cover_id?: number;
        key?: string;
      }>;
    };
    const works = (data.works ?? []).map((w) => ({
      title: w.title,
      author: w.authors?.[0]?.name,
      coverUrl: w.cover_id ? `/api/cover/${w.cover_id}?s=M` : null,
    }));
    res.json({ works });
  } catch {
    res.json({ works: [] });
  }
});

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

    // Prefer English editions
    allResults.sort((a, b) => {
      const aEng = a.editions.some((e) => e.language === "eng") ? 1 : 0;
      const bEng = b.editions.some((e) => e.language === "eng") ? 1 : 0;
      return bEng - aEng;
    });

    // Within the chosen result, sort English editions first
    const book = allResults[0];
    if (book) {
      book.editions.sort((a, b) => {
        const aEng = a.language === "eng" ? 1 : 0;
        const bEng = b.language === "eng" ? 1 : 0;
        return bEng - aEng;
      });
    }
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

      // Edition comparison (if multiple editions)
      if (book.editions.length > 1) {
        html += `<h2>Editions</h2><div class="pricing"><table>
          <tr><th>Format</th><th>Publisher</th><th>Date</th><th>Pages</th><th>Language</th><th>ISBN</th></tr>`;
        for (const ed of book.editions.slice(0, 10)) {
          html += `<tr>
            <td>${esc(ed.format)}</td>
            <td>${esc(ed.publisher)}</td>
            <td>${esc(ed.publishDate)}</td>
            <td>${ed.pageCount ?? "\u2014"}</td>
            <td>${esc(ed.language)}</td>
            <td style="font-family:monospace;font-size:0.8rem">${esc(ed.isbn13 ?? ed.isbn ?? "\u2014")}</td>
          </tr>`;
        }
        html += `</table></div>`;
      }

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

      // Related books (loaded client-side from first subject)
      if (book.subjects?.length) {
        const firstSubject = book.subjects[0];
        html += `<h2>Related books</h2><div class="related" id="related-books"></div>
        <script>
        fetch("/api/related/${encodeURIComponent(firstSubject)}")
          .then(function(r){return r.json()})
          .then(function(d){
            var el=document.getElementById("related-books");
            if(!d.works||!d.works.length){el.remove();el.previousElementSibling?.remove();return}
            el.innerHTML=d.works.map(function(w){
              return '<div class="related-card">'+(w.coverUrl?'<img src="'+w.coverUrl+'" alt="'+w.title+'" loading="lazy">':'')+'<a href="/search?q='+encodeURIComponent(w.title)+'">'+w.title+'</a></div>';
            }).join("");
          }).catch(function(){});
        </script>`;
      }

      // Wikipedia summary for author (loaded client-side)
      if (book.authors[0]) {
        html += `<div id="wiki-summary"></div>
        <script>
        fetch("/api/wiki/${encodeURIComponent(book.authors[0])}")
          .then(function(r){return r.json()})
          .then(function(d){
            if(!d.extract)return;
            var el=document.getElementById("wiki-summary");
            el.innerHTML='<h2>About ${esc(book.authors[0])}</h2><p style="font-size:0.85rem;line-height:1.6;color:var(--neutral-700)">'+d.extract+'</p>';
          }).catch(function(){});
        </script>`;
      }

      // Re-open the book-meta div we closed for the table
      html += `<div style="display:none">`;
    }

    // Description
    if (book.description) {
      html += `<div class="description">${esc(stripMarkdown(book.description))}</div>`;
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

  // Sort bar
  if (titles.length > 3) {
    html += `<div class="sort-bar" id="sort-bar"><span>Sort</span>
      <a href="#" class="active" data-sort="relevance">Relevance</a>
      <a href="#" data-sort="title">Title</a>
      <a href="#" data-sort="date">Date</a>
    </div>
    <script>document.getElementById("sort-bar")?.addEventListener("click",function(e){e.preventDefault();var t=e.target;if(t.dataset?.sort&&t.dataset.sort!=="relevance"){sortResults(t.dataset.sort)}else if(t.dataset?.sort==="relevance"){location.reload()}});</script>`;
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
      <div class="editions">${t.editions.length} edition(s)${isbn ? `<button class="save-btn" data-isbn="${esc(isbn)}" data-title="${esc(t.title)}" data-author="${esc(t.authors?.[0] ?? "")}">save</button>` : ""}</div>
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

// --- 404 page ---
app.use((_req, res) => {
  res.status(404).send(
    layout("Not Found", `<div class="empty-state"><div class="icon">\uD83D\uDCD6</div><p>Page not found</p><p style="margin-top:0.5rem"><a href="/">Back to search</a></p></div>`),
  );
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, `Colophon web UI running at http://localhost:${PORT}`);
});
