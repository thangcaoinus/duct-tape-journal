// The concepts tagging layer links entries by whole-word, case-insensitive,
// ANY-of matching over [name, ...keywords], grepping the BODY only. These tests
// pin that contract + the append-only dedupe (see CLAUDE.md "Concepts").
import { describe, it, expect } from "vitest";
import { matchTerms, entryMatches, addLink, addTopicLink } from "../index.js";

describe("matchTerms", () => {
  it("normalizes name + keywords to a deduped term set", () => {
    const terms = matchTerms({ name: "Grief", keywords: ["loss", "GRIEF", ""] });
    expect(terms).toContain("grief");
    expect(terms).toContain("loss");
    // "GRIEF" normalizes to the same term as the name → deduped; "" dropped.
    expect(terms.filter((t) => t === "grief")).toHaveLength(1);
    expect(terms).not.toContain("");
  });
});

describe("entryMatches", () => {
  const terms = matchTerms({ name: "art", keywords: ["painting"] });

  it("matches a whole word, case-insensitively", () => {
    expect(entryMatches("I made some ART today.", terms)).toBe("art");
    expect(entryMatches("A quiet painting session.", terms)).toBe("painting");
  });

  it("respects word boundaries — 'art' never matches 'start'", () => {
    expect(entryMatches("I want to start a new project.", terms)).toBeNull();
    expect(entryMatches("smart cartography", terms)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(entryMatches("nothing relevant here", terms)).toBeNull();
  });

  it("greps the body only (callers pass the frontmatter-stripped body)", () => {
    // A concept named after a frontmatter key must not self-match on the block.
    const t = matchTerms({ name: "topic", keywords: [] });
    // The server always passes parseFrontmatter(raw).body, so a `topic:` line is
    // never in scope. Simulate that: the body has no such line.
    expect(entryMatches("real prose without the keyword", t)).toBeNull();
    // ...and it DOES match when the word genuinely appears in prose.
    expect(entryMatches("we changed the topic mid-conversation", t)).toBe("topic");
  });
});

describe("addLink (concepts) — append-only, deduped on {date, entry}", () => {
  it("adds a new link and refuses a duplicate", () => {
    const concept = { name: "grief", links: [] };
    expect(addLink(concept, { date: "2026-05-04", entry: "entry-1" })).toBe(true);
    expect(concept.links).toHaveLength(1);
    // Same {date, entry} again → no-op, still one link.
    expect(addLink(concept, { date: "2026-05-04", entry: "entry-1" })).toBe(false);
    expect(concept.links).toHaveLength(1);
    // A different entry on the same day IS a distinct link.
    expect(addLink(concept, { date: "2026-05-04", entry: "entry-2" })).toBe(true);
    expect(concept.links).toHaveLength(2);
  });
});

describe("addTopicLink — same append-only dedupe for the topic index", () => {
  it("adds once, dedupes the repeat", () => {
    const idx = { links: [] };
    expect(addTopicLink(idx, { date: "2026-06-02", entry: "entry-1" })).toBe(true);
    expect(addTopicLink(idx, { date: "2026-06-02", entry: "entry-1" })).toBe(false);
    expect(idx.links).toHaveLength(1);
  });
});
