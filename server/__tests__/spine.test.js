// The safety spine, exercised over real HTTP (supertest). These encode the
// non-negotiable invariants from CLAUDE.md: finalize never overwrites, deletes
// are soft + restorable to their exact slot, restore refuses to clobber, entry
// numbers are never reused, and concept links are permanent across delete.
//
// Every test runs against a throwaway archive: DIARY_DIR is pointed at a temp dir
// BEFORE the server module is imported (it reads the env once at load), and the
// dir is wiped between tests for isolation. No sockets are opened — supertest
// drives the exported `app` directly, and NODE_ENV=test skips app.listen.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import request from "supertest";

const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "dtd-spine-"));
process.env.DIARY_DIR = TMP;
process.env.NODE_ENV = "test";

const { app } = await import("../index.js");
const DATE = "2026-05-04";

// Reset the archive between tests so each starts from an empty diary/.
beforeEach(async () => {
  for (const name of await fs.readdir(TMP)) {
    await fs.rm(path.join(TMP, name), { recursive: true, force: true });
  }
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

// Helpers over the API — a draft then a finalize is the create path.
async function draft(date, markdown, topic) {
  const r = await request(app)
    .post(`/api/draft/${date}`)
    .send(topic ? { markdown, topic } : { markdown });
  expect(r.status).toBe(200);
}
async function finalize(date) {
  return request(app).post(`/api/finalize/${date}`).send({});
}

describe("finalize never overwrites", () => {
  it("assigns entry-1, then entry-2, and each write is soft", async () => {
    await draft(DATE, "First entry body.");
    const r1 = await finalize(DATE);
    expect(r1.status).toBe(200);
    expect(r1.body.entry).toBe("entry-1.md");

    await draft(DATE, "Second entry body.");
    const r2 = await finalize(DATE);
    expect(r2.body.entry).toBe("entry-2.md");

    const day = await request(app).get(`/api/day/${DATE}`);
    expect(day.body.entries.map((e) => e.name).sort()).toEqual([
      "entry-1.md",
      "entry-2.md",
    ]);
  });

  it("refuses an empty draft (400) and a missing draft (404)", async () => {
    const none = await finalize(DATE);
    expect(none.status).toBe(404);
    await draft(DATE, "   ");
    const empty = await finalize(DATE);
    expect(empty.status).toBe(400);
  });

  it("stamps sentiment as a number when scored, or omits it when offline — never fails finalize", async () => {
    await draft(DATE, "A perfectly ordinary day, nothing to report.");
    const r = await finalize(DATE);
    expect(r.status).toBe(200); // succeeds regardless of model availability
    const day = await request(app).get(`/api/day/${DATE}`);
    const entry = day.body.entries[0];
    if ("sentiment" in entry.meta)
      expect(typeof entry.meta.sentiment).toBe("number");
    // The frontend never sees a raw --- block: markdown is body-only.
    expect(entry.markdown).not.toMatch(/^---/);
  });
});

describe("soft delete → restore round-trips to the exact slot", () => {
  it("deletes to the bin (never hard-deletes) and restores in place", async () => {
    await draft(DATE, "Keep me safe.");
    await finalize(DATE);

    const del = await request(app).delete(`/api/entry/${DATE}/entry-1.md`);
    expect(del.status).toBe(200);

    // Gone from the day, present in the bin.
    const dayAfter = await request(app).get(`/api/day/${DATE}`);
    expect(dayAfter.body.entries).toHaveLength(0);
    const bin = await request(app).get("/api/trash");
    const item = bin.body.items.find(
      (i) => i.kind === "entry" && i.name === "entry-1.md"
    );
    expect(item).toBeTruthy();

    // Restore returns it to entry-1.md.
    const res = await request(app).post(`/api/trash/restore/${item.id}`);
    expect(res.status).toBe(200);
    const dayBack = await request(app).get(`/api/day/${DATE}`);
    expect(dayBack.body.entries.map((e) => e.name)).toEqual(["entry-1.md"]);
  });

  it("refuses (409) to restore into a slot that's been retaken — item stays in bin", async () => {
    await draft(DATE, "Original entry-1.");
    await finalize(DATE);
    const del = await request(app).delete(`/api/entry/${DATE}/entry-1.md`);
    expect(del.status).toBe(200);

    // A new finalize reuses the freed max number → a NEW entry-1.md exists.
    await draft(DATE, "A fresh entry-1 taking the slot.");
    const re = await finalize(DATE);
    expect(re.body.entry).toBe("entry-1.md");

    // Restoring the old one must refuse rather than clobber the new one.
    const bin = await request(app).get("/api/trash");
    const item = bin.body.items.find((i) => i.kind === "entry");
    const res = await request(app).post(`/api/trash/restore/${item.id}`);
    expect(res.status).toBe(409);
    // Still in the bin (not consumed).
    const binAfter = await request(app).get("/api/trash");
    expect(binAfter.body.items.some((i) => i.id === item.id)).toBe(true);
  });
});

describe("entry numbers are never reused (nextEntryNumber = max + 1)", () => {
  it("deleting a MIDDLE entry leaves a permanent gap — the number is not backfilled", async () => {
    await draft(DATE, "one");
    await finalize(DATE); // entry-1
    await draft(DATE, "two");
    await finalize(DATE); // entry-2
    await draft(DATE, "three");
    await finalize(DATE); // entry-3

    // Delete the middle entry. max existing is still 3, so the gap at 2 is
    // permanent — the next finalize is entry-4, never a reused entry-2.
    await request(app).delete(`/api/entry/${DATE}/entry-2.md`);

    await draft(DATE, "four");
    const r = await finalize(DATE);
    expect(r.body.entry).toBe("entry-4.md"); // NOT the freed entry-2

    const day = await request(app).get(`/api/day/${DATE}`);
    expect(day.body.entries.map((e) => e.name)).toEqual([
      "entry-1.md",
      "entry-3.md",
      "entry-4.md",
    ]);
  });
});

describe("concept links are permanent and independent of entry delete", () => {
  it("links on finalize, and the link survives delete (flagged, never removed)", async () => {
    // Create a concept whose keyword appears in the entry body.
    const created = await request(app)
      .post("/api/concepts")
      .send({ name: "gardening", keywords: ["tomato"] });
    expect(created.status).toBe(200);

    await draft(DATE, "Planted a tomato today. It may or may not survive.");
    const fin = await finalize(DATE);
    expect(fin.status).toBe(200);

    // The concept gathered this entry on finalize.
    let links = (await request(app).get("/api/concepts/gardening")).body.concept
      .links;
    expect(links.some((l) => l.date === DATE)).toBe(true);
    expect(links.every((l) => l.deleted === false)).toBe(true);
    const countBefore = links.length;

    // Deleting the entry does NOT remove the link — it just flips `deleted`.
    await request(app).delete(`/api/entry/${DATE}/${fin.body.entry}`);
    links = (await request(app).get("/api/concepts/gardening")).body.concept
      .links;
    const link = links.find((l) => l.date === DATE);
    expect(link).toBeTruthy(); // still present
    expect(link.deleted).toBe(true); // now shows "in tore"
    expect(links).toHaveLength(countBefore); // never removed

    // Restoring clears the flag; the link count never changed.
    const bin = await request(app).get("/api/trash");
    const item = bin.body.items.find((i) => i.kind === "entry");
    await request(app).post(`/api/trash/restore/${item.id}`);
    links = (await request(app).get("/api/concepts/gardening")).body.concept
      .links;
    expect(links.find((l) => l.date === DATE).deleted).toBe(false);
    expect(links).toHaveLength(countBefore);
  });
});
