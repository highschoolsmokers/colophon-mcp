import { describe, it, expect } from "vitest";
import { dedup, mergeAuthors } from "../dedup.js";

describe("dedup", () => {
  it("removes exact duplicate titles", () => {
    const results = dedup([
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "123" }] },
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "456" }] },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].editions).toHaveLength(2);
  });

  it("matches titles with different punctuation", () => {
    const results = dedup([
      { title: "Stoner: A Novel", authors: ["John Williams"], editions: [{ isbn: "123" }] },
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "456" }] },
    ]);
    expect(results).toHaveLength(1);
  });

  it("matches titles with leading articles stripped", () => {
    const results = dedup([
      { title: "The Ballad of Sexual Dependency", authors: ["Nan Goldin"], editions: [{ isbn: "1" }] },
      { title: "Ballad of Sexual Dependency", authors: ["Nan Goldin"], editions: [{ isbn: "2" }] },
    ]);
    expect(results).toHaveLength(1);
  });

  it("does not merge different titles", () => {
    const results = dedup([
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "1" }] },
      { title: "Butcher's Crossing", authors: ["John Williams"], editions: [{ isbn: "2" }] },
    ]);
    expect(results).toHaveLength(2);
  });

  it("does not merge same title by different authors", () => {
    const results = dedup([
      { title: "Poems", authors: ["Emily Dickinson"], editions: [{ isbn: "1" }] },
      { title: "Poems", authors: ["Walt Whitman"], editions: [{ isbn: "2" }] },
    ]);
    expect(results).toHaveLength(2);
  });

  it("deduplicates ISBNs when merging editions", () => {
    const results = dedup([
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "123" }] },
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "123" }, { isbn: "456" }] },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].editions).toHaveLength(2);
  });

  it("keeps the longer description", () => {
    const results = dedup([
      { title: "Stoner", authors: ["John Williams"], editions: [{ isbn: "1" }] },
      { title: "Stoner", authors: ["John Williams"], description: "A great novel", editions: [{ isbn: "2" }] },
    ]);
    expect(results[0].description).toBe("A great novel");
  });
});

describe("mergeAuthors", () => {
  it("merges identical names", () => {
    expect(mergeAuthors(["John Williams"], ["John Williams"])).toEqual(["John Williams"]);
  });

  it("keeps the longer name variant", () => {
    const result = mergeAuthors(["C.S. Lewis"], ["Clive Staples Lewis"]);
    expect(result).toEqual(["Clive Staples Lewis"]);
  });

  it("matches initials to full names", () => {
    const result = mergeAuthors(["C. S. Lewis"], ["C.S. Lewis"]);
    expect(result).toHaveLength(1);
  });

  it("adds genuinely different authors", () => {
    const result = mergeAuthors(["John Williams"], ["Nan Goldin"]);
    expect(result).toEqual(["John Williams", "Nan Goldin"]);
  });
});
