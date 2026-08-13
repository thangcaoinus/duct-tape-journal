// Frontmatter is the "extensible metadata slot" — the whole reason the frontend
// never sees a raw `---` block. These tests pin the parse/serialize contract that
// the server boundary depends on (see CLAUDE.md "Entry metadata").
import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../index.js";

describe("parseFrontmatter", () => {
  it("splits a leading block into meta + body, consuming the blank-line separator", () => {
    const { meta, body } = parseFrontmatter(
      "---\nsentiment: 51\ntopic: dream\n---\n\nHello world"
    );
    expect(meta).toEqual({ sentiment: 51, topic: "dream" });
    // The single separator newline serialize wrote is consumed → clean body.
    expect(body).toBe("Hello world");
  });

  it("treats a frontmatter-less entry as meta:{} (old entries render unchanged)", () => {
    const raw = "Just some prose,\nno frontmatter here.";
    expect(parseFrontmatter(raw)).toEqual({ meta: {}, body: raw });
  });

  it("only a `---` on line 1 opens a block — a horizontal rule in prose does NOT", () => {
    const raw = "Some prose.\n\n---\n\nMore prose after a rule.";
    const { meta, body } = parseFrontmatter(raw);
    expect(meta).toEqual({});
    expect(body).toBe(raw); // the whole thing is body; the rule is untouched
  });

  it("does not treat the `\\n\\n---\\n\\n` entry-join separator as frontmatter", () => {
    // Two entries joined for a day flow — the separator must stay in the body.
    const raw = "Entry one.\n\n---\n\nEntry two.";
    expect(parseFrontmatter(raw).meta).toEqual({});
  });

  it("coerces a digit-only sentiment to a Number but keeps topic a String", () => {
    // The 2026-08-12 crash: a numeric topic parsed as a number blew up
    // `topic.localeCompare` in /api/stats. A topic is always a string.
    const { meta } = parseFrontmatter("---\nsentiment: -14\ntopic: 33\n---\nbody");
    expect(meta.sentiment).toBe(-14);
    expect(typeof meta.sentiment).toBe("number");
    expect(meta.topic).toBe("33");
    expect(typeof meta.topic).toBe("string");
  });
});

describe("serializeFrontmatter", () => {
  it("omits empty/null keys and drops the block entirely when nothing's left", () => {
    expect(serializeFrontmatter({ topic: "", sentiment: null }, "body")).toBe(
      "body"
    );
  });

  it("is a byte-exact fixed point: serialize is the inverse of parse", () => {
    // parse consumes the single blank-line separator serialize writes, so BOTH the
    // metadata AND the body survive a round trip untouched, and re-serializing the
    // parsed pair reproduces the exact same bytes.
    const original = { sentiment: 62, topic: "work" };
    const body = "The body stays exactly as written.";
    const raw = serializeFrontmatter(original, body);
    const parsed = parseFrontmatter(raw);
    expect(parsed.meta).toEqual(original);
    expect(parsed.body).toBe(body);
    expect(serializeFrontmatter(parsed.meta, parsed.body)).toBe(raw); // fixed point
  });

  it("does NOT accumulate blank lines across repeated backfill/rescore round-trips", () => {
    // The Tools backfill/rescore re-serialises the parsed {meta, body}. That must
    // be idempotent — 10 passes produce the same bytes as one, never a growing
    // stack of blank lines atop the body.
    let raw = serializeFrontmatter({ sentiment: 1 }, "body");
    const once = raw;
    for (let i = 0; i < 10; i++) {
      const p = parseFrontmatter(raw);
      raw = serializeFrontmatter(p.meta, p.body);
    }
    expect(raw).toBe(once);
  });

  it("leaves a legacy entry's existing blank lines exactly as-is (stable, no growth)", () => {
    // Entries on disk from before the fix already carry extra blank lines (the old
    // bug). The fix's guarantee is that a re-serialise is now a FIXED POINT for
    // them too: it neither adds nor removes blanks — the body is preserved verbatim
    // (we don't rewrite prose), and repeated backfills produce identical bytes.
    const legacy = "---\nsentiment: 5\n---\n\n\n\n\nHello"; // pre-existing blanks
    let raw = legacy;
    for (let i = 0; i < 10; i++) {
      const p = parseFrontmatter(raw);
      raw = serializeFrontmatter(p.meta, p.body);
    }
    expect(raw).toBe(legacy); // unchanged after 10 passes — no accumulation
  });

  it("a new metadata key rides through with no parser change (extensible slot)", () => {
    const raw = serializeFrontmatter({ mood: "calm", topic: "dream" }, "b");
    expect(parseFrontmatter(raw).meta).toEqual({ mood: "calm", topic: "dream" });
  });
});
