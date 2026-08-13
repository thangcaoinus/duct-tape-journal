// The AI-recap feature: extractive highlights (pure, always available) + the
// summary endpoints' graceful-offline contract. Under NODE_ENV=test the
// summarization model is short-circuited to null (like sentiment), so `summary`
// is null but `highlights` — which need no model — must still come back. These
// tests also pin the never-mutate invariant: a summary POST writes nothing.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import request from "supertest";

// Point the server at a throwaway archive BEFORE importing it — server/index.js
// captures DIARY from DIARY_DIR at module load. This MUST run before the import
// below, so the import is dynamic (a static `import` would hoist above these
// assignments and bind DIARY to the real diary/ — which the tests would mutate).
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dtd-summary-"));
process.env.DIARY_DIR = TMP;
process.env.NODE_ENV = "test";
const { app, highlightSentences } = await import("../index.js");
const DATE = "2026-05-04";

// --- Pure unit: extractive highlights ---
describe("highlightSentences", () => {
  it("returns [] for empty / whitespace input", () => {
    expect(highlightSentences("")).toEqual([]);
    expect(highlightSentences("   \n ")).toEqual([]);
  });

  it("returns all sentences when there are fewer than n", () => {
    const text =
      "The deadline loomed over the whole week. I ended up shipping it a little late.";
    const out = highlightSentences(text, 4);
    expect(out.length).toBe(2);
  });

  it("respects n and preserves original reading order", () => {
    const text =
      "The project deadline was stressful and the deadline dominated everything. " +
      "I ate a sandwich at some point during the day. " +
      "The deadline finally passed and the project shipped to relief. " +
      "A bird landed on the windowsill briefly. " +
      "Shipping the project on deadline taught me about the project cadence.";
    const out = highlightSentences(text, 2);
    expect(out.length).toBe(2);
    // The two deadline/project-heavy sentences should outrank the filler; and
    // whichever two are chosen, they must appear in their original order.
    const idx = out.map((s) => text.indexOf(s));
    expect(idx[0]).toBeLessThan(idx[1]);
    // The filler sentences shouldn't dominate the ranking.
    expect(out.join(" ")).not.toContain("bird landed");
  });
});

// --- HTTP contract: the two summary endpoints against a temp archive ---
beforeEach(async () => {
  for (const name of await fs.readdir(TMP)) {
    await fs.rm(path.join(TMP, name), { recursive: true, force: true });
  }
});
afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

async function draftAndFinalize(date, markdown, topic) {
  await request(app)
    .post(`/api/draft/${date}`)
    .send(topic ? { markdown, topic } : { markdown });
  return request(app).post(`/api/finalize/${date}`).send({});
}

describe("POST /api/concepts/:slug/summary", () => {
  it("offline-safe contract: null recap but non-empty highlights, links untouched", async () => {
    // A concept created via the API immediately greps the archive, so finalize a
    // matching entry first, then create the concept to link it.
    await draftAndFinalize(
      DATE,
      "The deadline was stressful today. I worried about the deadline all afternoon before it finally passed."
    );
    const created = await request(app)
      .post("/api/concepts")
      .send({ name: "deadline" });
    expect(created.status).toBe(200);

    // Snapshot the concept (via the API) to prove the summary POST mutates
    // nothing — links especially must be byte-identical afterward.
    const before = (await request(app).get("/api/concepts/deadline")).body
      .concept;

    const res = await request(app).post("/api/concepts/deadline/summary");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Model short-circuited under test → recap null + offline flag...
    expect(res.body.summary).toBeNull();
    expect(res.body.offline).toBe(true);
    // ...but highlights need no model, so they must still return.
    expect(Array.isArray(res.body.highlights)).toBe(true);
    expect(res.body.highlights.length).toBeGreaterThan(0);

    // Invariant: the endpoint wrote nothing — the concept (and its links) is
    // unchanged.
    const after = (await request(app).get("/api/concepts/deadline")).body
      .concept;
    expect(after.links).toEqual(before.links);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("empty concept (no linked entries) → empty flag, no crash", async () => {
    // A concept with no matches links nothing.
    await request(app).post("/api/concepts").send({ name: "nonexistentword" });
    const res = await request(app).post("/api/concepts/nonexistentword/summary");
    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.highlights).toEqual([]);
  });

  it("404s an unknown concept", async () => {
    const res = await request(app).post("/api/concepts/neverexisted/summary");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/topics/:topic/summary", () => {
  it("offline-safe contract: null recap, non-empty highlights for a real topic", async () => {
    await draftAndFinalize(
      DATE,
      "Work was heavy today. The work kept piling up and the work stress lingered into the evening.",
      "work"
    );
    const res = await request(app).post("/api/topics/work/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeNull();
    expect(res.body.offline).toBe(true);
    expect(res.body.highlights.length).toBeGreaterThan(0);
  });
});
