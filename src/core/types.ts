// ---------------------------------------------------------------------------
// Shared types — used by MCP tools, web app, and API clients
// ---------------------------------------------------------------------------

/** A specific edition of a book (hardcover, paperback, ebook, etc.) */
export interface Edition {
  isbn?: string;
  isbn13?: string;
  format: string; // "hardcover" | "paperback" | "ebook" | "audiobook" | etc.
  title: string;
  authors: string[];
  publisher: string;
  publishDate: string; // ISO date or year
  language: string;
  pageCount?: number;
  coverImageUrl?: string;
}

/** A listing where you can buy a book */
export interface PurchaseListing {
  title: string;
  authors: string[];
  isbn?: string;
  seller: string;
  condition: "new" | "used" | "like-new" | "very-good" | "good" | "acceptable";
  price: string;
  currency: string;
  url: string;
  shippingNote?: string;
  sellerRating?: string;
}

/** A library where the book is available */
export interface LibraryListing {
  title: string;
  authors: string[];
  isbn?: string;
  library: string;
  system?: string;
  format: string;
  available: boolean;
  waitlist?: number;
  url?: string;
  appDeepLink?: string;
}

/** Where a keyword matched in the metadata */
export interface KeywordMatch {
  keyword: string;
  matchedIn: string;
  snippet?: string;
}

/** Full search result for a single work (groups all editions together) */
export interface BookResult {
  title: string;
  authors: string[];
  description?: string;
  subjects?: string[];
  tableOfContents?: string[];
  keywordMatches?: KeywordMatch[];
  editions: Edition[];
  buyNew: PurchaseListing[];
  buyUsed: PurchaseListing[];
  libraries: LibraryListing[];
}

/** A fuzzy title match result */
export interface TitleMatch {
  title: string;
  subtitle?: string;
  authors: string[];
  firstPublished?: string;
  editions: Edition[];
  confidence: number;
}

/** A title in an author's bibliography */
export interface AuthorTitle {
  title: string;
  authors: string[];
  firstPublished?: string;
  editions: Edition[];
}

/** Brief author biography */
export interface AuthorBio {
  name: string;
  bio?: string;
  birthDate?: string;
  deathDate?: string;
  photoUrl?: string;
}

/** Standard query shape for book searches */
export interface BookQuery {
  title?: string;
  author?: string;
  keywords?: string[];
  isbn?: string;
}
