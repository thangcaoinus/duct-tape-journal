import express from "express";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIARY = path.join(ROOT, "diary");
const DRAFTS = path.join(DIARY, ".drafts");
const TRASH = path.join(DIARY, ".trash");
const META = path.join(DIARY, ".meta");
const TOPICS_FILE = path.join(META, "topics.json");
const TOPICS_DIR = path.join(META, "topics"); // per-topic index (a dir; coexists with topics.json)
const CONCEPTS = path.join(META, "concepts");

const PORT = 3001;
const app = express();
// Images arrive as base64 data URLs, so allow a generous JSON body.
app.use(express.json({ limit: "25mb" }));

// --- Path safety: the folder IS the format, so guard every path segment. ---
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Middleware: reject any :date that isn't exactly YYYY-MM-DD (blocks traversal).
function guardDate(req, res, next) {
  if (!DATE_RE.test(req.params.date)) {
    return res.status(400).json({ ok: false, error: "bad date" });
  }
  next();
}

// --- Disk <-> wire image path rewrites (match only markdown image refs). ---
// Disk stores portable `resources/foo.png`; the wire serves `/files/<date>/resources/foo.png`.
const toWire = (md, date) =>
  md.replace(/\]\(resources\//g, `](/files/${date}/resources/`);
const toDisk = (md, date) =>
  md.replace(
    new RegExp(`\\]\\(/files/${date}/resources/`, "g"),
    "](resources/"
  );

// --- Entry metadata: extensible YAML-ish frontmatter at the disk boundary. ---
// The frontend never sees raw frontmatter — the server parses it on read (like
// toWire) and hands back {meta, body}, and serialises it on finalize. Only a
// block that OPENS on line 1 with `---` counts, so a `---` horizontal rule inside
// prose is never mistaken for frontmatter. Values are strings; digit-only values
// become numbers. New metadata fields are just new keys — no code change needed.
function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, body: raw };
  const block = raw.slice(4, end);
  const body = raw.slice(end + 5); // past the closing "\n---\n"
  const meta = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    meta[key] = /^-?\d+$/.test(val) ? Number(val) : val;
  }
  return { meta, body };
}

function serializeFrontmatter(meta, body) {
  const keys = Object.keys(meta).filter((k) => meta[k] !== "" && meta[k] != null);
  if (!keys.length) return body;
  const block = keys.map((k) => `${k}: ${meta[k]}`).join("\n");
  return `---\n${block}\n---\n\n${body}`;
}

// Offline neural sentiment (Transformers.js / DistilBERT-SST-2). Lexicon scorers
// (VADER) can't read framing — a negative mulling full of hopeful words scored
// positive, and vice-versa — so we score with a real model. The model is fetched
// once from the hub then cached on disk; after that it runs fully offline. If it
// can't load (offline AND uncached), the feature degrades gracefully: the scorer
// returns null and the sentiment key is simply omitted (never crashes finalize).
let _sentimentPipe = null; // resolved pipeline, or null when unavailable
let _sentimentTried = false; // have we attempted a load this process?
async function getSentimentPipe() {
  if (_sentimentTried) return _sentimentPipe;
  _sentimentTried = true;
  try {
    const { pipeline } = await import("@huggingface/transformers");
    _sentimentPipe = await pipeline(
      "sentiment-analysis",
      "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
    );
  } catch (e) {
    console.warn("sentiment model unavailable (offline?):", e.message);
    _sentimentPipe = null; // graceful: feature disabled for this process
  }
  return _sentimentPipe;
}

// Score body text to an integer -100..100 (same wire contract as before), or
// null when the model is unavailable so callers can omit the frontmatter key.
async function scoreSentiment(text) {
  if (!text || !text.trim()) return null;
  const pipe = await getSentimentPipe();
  if (!pipe) return null; // offline / model missing
  // DistilBERT-SST-2 caps at 512 tokens; truncate defensively (~1800 chars).
  const input = text.length > 1800 ? text.slice(0, 1800) : text;
  const [out] = await pipe(input); // {label:'POSITIVE'|'NEGATIVE', score:0..1}
  const signed = out.label === "NEGATIVE" ? -out.score : out.score;
  return Math.round(signed * 100);
}

// A topic is a single lowercase word (one continuous \w+), like an email subject.
const normTopic = (t) => (t || "").toString().toLowerCase().match(/\w+/)?.[0] ?? "";

async function readTopics() {
  try {
    const j = JSON.parse(await fs.readFile(TOPICS_FILE, "utf8"));
    return Array.isArray(j.topics) ? j.topics : [];
  } catch {
    return [];
  }
}

async function addTopic(word) {
  const t = normTopic(word);
  if (!t) return;
  const topics = await readTopics();
  if (topics.includes(t)) return;
  topics.push(t);
  topics.sort();
  await fs.mkdir(META, { recursive: true });
  await fs.writeFile(TOPICS_FILE, JSON.stringify({ topics }), "utf8");
}

// --- Per-topic index (mirrors the concept storage, minus keywords/grep). ---
// A topic is the entry's `topic:` frontmatter word, so its link list is exact:
// every entry whose normTopic(meta.topic) equals this slug, plus a free-form
// notes page. Storage: one JSON per topic under .meta/topics/<slug>.json, shape
//   { topic, page, links: [{date, entry}], createdAt, updatedAt }
// This is a derived convenience — buildTopicIndex can always rebuild it from the
// archive (the frontmatter word stays the source of truth). Links are append-only
// (at finalize); nothing here ever removes one.
const topicIndexPath = (slug) => path.join(TOPICS_DIR, `${path.basename(slug)}.json`);

async function readTopicIndex(slug) {
  try {
    return JSON.parse(await fs.readFile(topicIndexPath(slug), "utf8"));
  } catch {
    return null;
  }
}

async function writeTopicIndex(slug, obj) {
  await fs.mkdir(TOPICS_DIR, { recursive: true });
  await fs.writeFile(topicIndexPath(slug), JSON.stringify(obj, null, 2), "utf8");
}

// Append a link if this {date, entry} isn't already recorded. Only ever ADDS.
// Returns true when a new link was added.
function addTopicLink(idx, { date, entry }) {
  idx.links = idx.links || [];
  if (idx.links.some((l) => l.date === date && l.entry === entry)) return false;
  idx.links.push({ date, entry });
  idx.updatedAt = new Date().toISOString();
  return true;
}

// Build (or rebuild) a topic's index from a full archive walk: every finalized
// entry whose frontmatter topic EXACTLY matches (normTopic equality — never a body
// grep). Preserves an existing notes `page`. Writes and returns the index. This is
// the on-demand build + backfill path for topics that predate the index.
async function buildTopicIndex(slug) {
  const target = normTopic(slug);
  const prev = await readTopicIndex(slug);
  const now = new Date().toISOString();
  const idx = {
    topic: target,
    page: prev?.page || "",
    links: [],
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  if (!target) return idx;
  let dirs = [];
  try {
    dirs = await fs.readdir(DIARY, { withFileTypes: true });
  } catch {
    dirs = [];
  }
  for (const d of dirs) {
    if (!d.isDirectory() || !DATE_RE.test(d.name)) continue;
    let inner = [];
    try {
      inner = await fs.readdir(path.join(DIARY, d.name));
    } catch {
      continue;
    }
    for (const name of inner) {
      if (!/^entry-\d+\.md$/.test(name)) continue;
      try {
        const raw = await fs.readFile(path.join(DIARY, d.name, name), "utf8");
        const { meta } = parseFrontmatter(raw);
        if (normTopic(meta.topic) === target) {
          addTopicLink(idx, { date: d.name, entry: name });
        }
      } catch {
        continue; // unreadable entry — skip, never abort the walk
      }
    }
  }
  await writeTopicIndex(slug, idx);
  return idx;
}

// Read the index, building it on first use (or when missing). Used by the browse
// and edit endpoints so a topic set before this feature still works.
async function ensureTopicIndex(slug) {
  return (await readTopicIndex(slug)) ?? (await buildTopicIndex(slug));
}

// --- Concepts: an Obsidian-lite tagging layer (no traversal). ---
// A concept is a named idea with optional alias keywords, its own free-form notes
// page, and an APPEND-ONLY list of the entries that reference it. Matching is by
// whole-word grep of an entry's BODY (never its frontmatter) against the concept's
// name + keywords. Links are made at finalize (new entry vs. all concepts) and on
// manual rescan (whole archive vs. one concept), and are NEVER removed — a deleted
// (tore'd) entry keeps its link and is just flagged live. Storage mirrors topics:
// one JSON per concept under .meta/concepts/<slug>.json. All handling stays at the
// server boundary; nothing here touches the immutable entry files.
const conceptPath = (slug) => path.join(CONCEPTS, `${path.basename(slug)}.json`);

async function readConcept(slug) {
  try {
    return JSON.parse(await fs.readFile(conceptPath(slug), "utf8"));
  } catch {
    return null;
  }
}

async function writeConcept(slug, obj) {
  await fs.mkdir(CONCEPTS, { recursive: true });
  await fs.writeFile(conceptPath(slug), JSON.stringify(obj, null, 2), "utf8");
}

async function listConcepts() {
  let files = [];
  try {
    files = await fs.readdir(CONCEPTS);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const c = await readConcept(f.slice(0, -".json".length));
    if (!c) continue;
    out.push({
      slug: f.slice(0, -".json".length),
      name: c.name,
      keywords: c.keywords || [],
      linkCount: (c.links || []).length,
      // A short, whitespace-collapsed peek at the notes page, for the read-side
      // hover preview. Empty when there are no notes.
      snippet: (c.page || "").replace(/\s+/g, " ").trim().slice(0, 140),
    });
  }
  out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return out;
}

// The normalized set of words a concept matches on: its name plus its keywords.
function matchTerms(concept) {
  const terms = [concept.name, ...(concept.keywords || [])]
    .map(normTopic)
    .filter(Boolean);
  return [...new Set(terms)];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Return the first term that appears as a whole word in `body`, or null. Grep the
// body only — callers pass parseFrontmatter(raw).body so a `topic:`/`sentiment:`
// frontmatter line never counts as a match.
function entryMatches(body, terms) {
  if (!terms.length || !body) return null;
  const re = new RegExp(`\\b(${terms.map(escapeRe).join("|")})\\b`, "i");
  const m = body.match(re);
  return m ? m[1].toLowerCase() : null;
}

// Append a link if this {date, entry} isn't already recorded. Only ever ADDS.
// Returns true when a new link was added.
function addLink(concept, { date, entry, matched }) {
  concept.links = concept.links || [];
  if (concept.links.some((l) => l.date === date && l.entry === entry)) {
    return false;
  }
  concept.links.push({ date, entry, matched, at: new Date().toISOString() });
  concept.updatedAt = new Date().toISOString();
  return true;
}

// Finalize hook: grep one just-written entry against every concept and link it.
// Best-effort — a failure here must never fail the finalize itself.
async function scanEntryAgainstAllConcepts(date, entry, body) {
  let files = [];
  try {
    files = await fs.readdir(CONCEPTS);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const slug = f.slice(0, -".json".length);
    const c = await readConcept(slug);
    if (!c) continue;
    const matched = entryMatches(body, matchTerms(c));
    if (matched && addLink(c, { date, entry, matched })) {
      await writeConcept(slug, c);
    }
  }
}

// Rescan/create: grep every finalized entry in the archive against one concept
// and add any new links. Mutates `concept` in place; returns the count added.
async function scanArchiveForConcept(concept) {
  const terms = matchTerms(concept);
  if (!terms.length) return 0;
  let dirs = [];
  try {
    dirs = await fs.readdir(DIARY, { withFileTypes: true });
  } catch {
    return 0;
  }
  let added = 0;
  for (const d of dirs) {
    if (!d.isDirectory() || !DATE_RE.test(d.name)) continue;
    let inner = [];
    try {
      inner = await fs.readdir(path.join(DIARY, d.name));
    } catch {
      continue;
    }
    for (const name of inner) {
      if (!/^entry-\d+\.md$/.test(name)) continue;
      const raw = await fs.readFile(path.join(DIARY, d.name, name), "utf8");
      const { body } = parseFrontmatter(raw);
      const matched = entryMatches(body, terms);
      if (matched && addLink(concept, { date: d.name, entry: name, matched })) {
        added++;
      }
    }
  }
  return added;
}

// Find a trashed entry's blob for a given origin {date, name} by scanning the
// trash sidecars (reuses the soft-delete sidecar mechanism). Lets us preview a
// linked entry that's currently in tore. Returns the blob's absolute path or null.
async function findTrashedEntry(date, name) {
  let files = [];
  try {
    files = await fs.readdir(TRASH);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const blob = f.slice(0, -".json".length);
    if (!files.includes(blob)) continue;
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(path.join(TRASH, f), "utf8"));
    } catch {
      continue;
    }
    if (meta.kind === "entry" && meta.date === date && meta.name === name) {
      return path.join(TRASH, blob);
    }
  }
  return null;
}

// Read one entry's stored sentiment (the frontmatter `sentiment` key) for the
// detail-page graphs. Reads it live, or from trash if the entry is tore'd (concept
// links can point at a deleted entry). Read-only — never re-scores or writes.
// Returns the signed -100..100 score, or null when unscored/unreadable.
async function entrySentiment(date, entry) {
  let blob = path.join(DIARY, date, entry);
  if (!fsSync.existsSync(blob)) {
    blob = await findTrashedEntry(date, entry);
    if (!blob) return null;
  }
  try {
    const { meta } = parseFrontmatter(await fs.readFile(blob, "utf8"));
    return typeof meta.sentiment === "number" ? meta.sentiment : null;
  } catch {
    return null;
  }
}

// Find the next entry number in a day dir; refuse to reuse existing numbers.
async function nextEntryNumber(dayDir) {
  let files = [];
  try {
    files = await fs.readdir(dayDir);
  } catch {
    return 1;
  }
  const nums = files
    .map((f) => f.match(/^entry-(\d+)\.md$/))
    .filter(Boolean)
    .map((m) => +m[1]);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// Soft delete: move a file into .trash/ with a timestamped name. Never unlink.
// `meta` records the file's ORIGIN so the Bin can restore it to its exact place:
//   { kind: 'entry'|'resource'|'draft', date, name }
// It's written as a sidecar `.trash/<trashName>.json`. The trashed blob keeps its
// original bytes and `<stamp>__<basename>` name; only the sidecar is new. Trash
// items from before this feature simply have no sidecar and aren't Bin-restorable.
async function moveToTrash(absPath, meta) {
  await fs.mkdir(TRASH, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashName = `${stamp}__${path.basename(absPath)}`;
  const dest = path.join(TRASH, trashName);
  await fs.rename(absPath, dest);
  if (meta) {
    await fs.writeFile(
      `${dest}.json`,
      JSON.stringify({ ...meta, deletedAt: new Date().toISOString() }),
      "utf8"
    );
  }
  return trashName;
}

// --- Draft autosave / load ---
// The draft body `.md` stays pure markdown (keeps the editor's markdown round-trip
// clean). The draft's topic rides in a tiny sidecar `.drafts/<date>.json` so it
// isn't jammed into the body; finalize reads it back to stamp the entry.
app.post("/api/draft/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  const md = req.body?.markdown ?? "";
  await fs.mkdir(DRAFTS, { recursive: true });
  await fs.writeFile(
    path.join(DRAFTS, `${date}.md`),
    toDisk(md, date),
    "utf8"
  );
  const topic = normTopic(req.body?.topic);
  const sidecar = path.join(DRAFTS, `${date}.json`);
  if (topic) {
    await fs.writeFile(sidecar, JSON.stringify({ topic }), "utf8");
  } else {
    await fs.rm(sidecar, { force: true }); // cleared topic → drop the sidecar
  }
  res.json({ ok: true });
});

app.get("/api/draft/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  let markdown = "";
  try {
    markdown = toWire(
      await fs.readFile(path.join(DRAFTS, `${date}.md`), "utf8"),
      date
    );
  } catch {
    /* no draft yet */
  }
  let topic = "";
  try {
    topic = JSON.parse(
      await fs.readFile(path.join(DRAFTS, `${date}.json`), "utf8")
    ).topic || "";
  } catch {
    /* no topic sidecar */
  }
  res.json({ ok: true, markdown, topic });
});

// --- Finalize: promote draft -> entry-N.md (soft, never clobber) ---
app.post("/api/finalize/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  const draftPath = path.join(DRAFTS, `${date}.md`);
  let md;
  try {
    md = await fs.readFile(draftPath, "utf8");
  } catch {
    return res.status(404).json({ ok: false, error: "no draft to finalize" });
  }
  if (!md.trim()) {
    return res.status(400).json({ ok: false, error: "draft is empty" });
  }

  const dayDir = path.join(DIARY, date);
  await fs.mkdir(dayDir, { recursive: true });
  const n = await nextEntryNumber(dayDir);
  const file = path.join(dayDir, `entry-${n}.md`);
  if (fsSync.existsSync(file)) {
    return res.status(409).json({ ok: false, error: "would overwrite" });
  }

  // Stamp metadata ONCE, at finalize (entries are immutable afterward). Topic
  // comes from the draft sidecar; sentiment is scored from the body text. This
  // is the only place frontmatter is written; more fields are just more keys.
  const draftMetaPath = path.join(DRAFTS, `${date}.json`);
  let topic = "";
  try {
    topic = normTopic(
      JSON.parse(await fs.readFile(draftMetaPath, "utf8")).topic
    );
  } catch {
    /* no topic sidecar */
  }
  const meta = {};
  const s = await scoreSentiment(md);
  if (s !== null) meta.sentiment = s; // omit when offline — entry still finalizes
  if (topic) meta.topic = topic;

  // Body on disk is already in disk-path form; prepend frontmatter and write.
  await fs.writeFile(file, serializeFrontmatter(meta, md), "utf8");
  if (topic) {
    await addTopic(topic);
    // Append this entry to its topic index in O(1). If the index doesn't exist
    // yet we create a minimal one with just this link — older entries are
    // backfilled lazily by ensureTopicIndex on first browse, not here. Best-effort:
    // a topic-index hiccup must never fail an otherwise-successful finalize.
    try {
      const nowIso = new Date().toISOString();
      const idx =
        (await readTopicIndex(topic)) ??
        { topic, page: "", links: [], createdAt: nowIso, updatedAt: nowIso };
      if (addTopicLink(idx, { date, entry: `entry-${n}.md` })) {
        await writeTopicIndex(topic, idx);
      }
    } catch (e) {
      console.error("topic index append failed:", e);
    }
  }
  await moveToTrash(draftPath, { kind: "draft", date, name: `${date}.md` });
  // The topic sidecar is draft scaffolding — remove it (best-effort).
  await fs.rm(draftMetaPath, { force: true });
  // Auto-link this new entry to any matching concepts. Best-effort: a concept
  // scan hiccup must never fail an otherwise-successful finalize. `md` is the
  // pre-frontmatter draft body, which is exactly what we want to grep.
  try {
    await scanEntryAgainstAllConcepts(date, `entry-${n}.md`, md);
  } catch (e) {
    console.error("concept scan on finalize failed:", e);
  }
  res.json({ ok: true, entry: `entry-${n}.md` });
});

// --- Read a day's finalized entries ---
app.get("/api/day/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  const dayDir = path.join(DIARY, date);
  let files = [];
  try {
    files = await fs.readdir(dayDir);
  } catch {
    return res.json({ ok: true, entries: [] });
  }
  const entryFiles = files
    .map((f) => f.match(/^entry-(\d+)\.md$/))
    .filter(Boolean)
    .sort((a, b) => +a[1] - +b[1])
    .map((m) => m[0]);
  const entries = [];
  for (const name of entryFiles) {
    const raw = await fs.readFile(path.join(dayDir, name), "utf8");
    // Split frontmatter off at the boundary; the frontend gets a clean body plus
    // a meta object. Old frontmatter-less entries → meta:{}, body unchanged.
    const { meta, body } = parseFrontmatter(raw);
    entries.push({ name, markdown: toWire(body, date), meta });
  }
  res.json({ ok: true, entries });
});

// --- List all dates that have finalized entries (feeds a future calendar) ---
app.get("/api/days", async (req, res) => {
  let dirs = [];
  try {
    dirs = await fs.readdir(DIARY, { withFileTypes: true });
  } catch {
    return res.json({ ok: true, days: [] });
  }
  const days = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !DATE_RE.test(d.name)) continue;
    const inner = await fs.readdir(path.join(DIARY, d.name));
    const count = inner.filter((f) => /^entry-\d+\.md$/.test(f)).length;
    if (count > 0) days.push({ date: d.name, count });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ ok: true, days });
});

// --- Dashboard stats: ONE archive walk aggregating per-day + per-topic sentiment
// and totals for the Home dashboard. Read-only, derived fresh each call (no cache,
// no stored aggregate) — reuses the same walk shape as scoreArchive/scanArchive.
// avgSentiment is null when NO entry in that bucket carries a sentiment (model was
// offline at finalize) — the frontend renders those as "unscored", never as 0. ---
app.get("/api/stats", async (req, res) => {
  let dirs = [];
  try {
    dirs = await fs.readdir(DIARY, { withFileTypes: true });
  } catch {
    return res.json({
      ok: true,
      stats: { days: [], topics: [], totals: emptyTotals() },
    });
  }
  const days = [];
  const topicAgg = new Map(); // topic -> {count, sum, scored}
  let entries = 0;
  let scored = 0;
  for (const d of dirs) {
    if (!d.isDirectory() || !DATE_RE.test(d.name)) continue;
    let inner = [];
    try {
      inner = await fs.readdir(path.join(DIARY, d.name));
    } catch {
      continue;
    }
    let dayCount = 0;
    let daySum = 0;
    let dayScored = 0;
    for (const name of inner) {
      if (!/^entry-\d+\.md$/.test(name)) continue;
      let meta = {};
      try {
        const raw = await fs.readFile(path.join(DIARY, d.name, name), "utf8");
        meta = parseFrontmatter(raw).meta;
      } catch {
        continue; // unreadable entry — skip, never abort the walk
      }
      entries++;
      dayCount++;
      const hasSent = typeof meta.sentiment === "number";
      if (hasSent) {
        scored++;
        daySum += meta.sentiment;
        dayScored++;
      }
      if (meta.topic) {
        const t = topicAgg.get(meta.topic) || { count: 0, sum: 0, scored: 0 };
        t.count++;
        if (hasSent) {
          t.sum += meta.sentiment;
          t.scored++;
        }
        topicAgg.set(meta.topic, t);
      }
    }
    if (dayCount > 0) {
      days.push({
        date: d.name,
        count: dayCount,
        avgSentiment: dayScored ? Math.round(daySum / dayScored) : null,
      });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const topics = [...topicAgg.entries()]
    .map(([topic, t]) => ({
      topic,
      count: t.count,
      avgSentiment: t.scored ? Math.round(t.sum / t.scored) : null,
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  res.json({
    ok: true,
    stats: {
      days,
      topics,
      totals: {
        entries,
        activeDays: days.length,
        scored,
        firstDate: days.length ? days[0].date : null,
        lastDate: days.length ? days[days.length - 1].date : null,
      },
    },
  });
});
function emptyTotals() {
  return { entries: 0, activeDays: 0, scored: 0, firstDate: null, lastDate: null };
}

// --- Sentiment: is the neural model available this process? (UI gating) ---
app.get("/api/sentiment/status", async (req, res) => {
  const pipe = await getSentimentPipe();
  res.json({ ok: true, available: !!pipe });
});

// Walk the whole archive scoring finalized entries. `force=false` (backfill)
// only ADDS a missing `sentiment` — the one narrow exception to "stamped once at
// finalize": it fills a gap, never re-scores an entry that already has one.
// `force=true` (rescore) re-scores EVERY entry, overwriting existing sentiments
// (used to replace old lexicon scores with the neural model — a deliberate,
// user-triggered bulk restamp). Both only ever touch the `sentiment` key: prose
// and every other frontmatter key are preserved (re-serialising {meta, body}).
// Best-effort per file — a single bad file never aborts the batch.
async function scoreArchive(force) {
  let dirs = [];
  try {
    dirs = await fs.readdir(DIARY, { withFileTypes: true });
  } catch {
    return { scored: 0, alreadyScored: 0, skipped: 0 };
  }
  let scored = 0;
  let alreadyScored = 0;
  let skipped = 0;
  for (const d of dirs) {
    if (!d.isDirectory() || !DATE_RE.test(d.name)) continue;
    let inner = [];
    try {
      inner = await fs.readdir(path.join(DIARY, d.name));
    } catch {
      continue;
    }
    for (const name of inner) {
      if (!/^entry-\d+\.md$/.test(name)) continue;
      const file = path.join(DIARY, d.name, name);
      try {
        const raw = await fs.readFile(file, "utf8");
        const { meta, body } = parseFrontmatter(raw);
        if (!force && meta.sentiment !== undefined) {
          alreadyScored++;
          continue; // backfill: never re-score an entry that already has one
        }
        const s = await scoreSentiment(body);
        if (s === null) {
          skipped++;
          continue;
        }
        meta.sentiment = s;
        await fs.writeFile(file, serializeFrontmatter(meta, body), "utf8");
        scored++;
      } catch (e) {
        console.error("score archive failed for", file, e.message);
        skipped++;
      }
    }
  }
  return { scored, alreadyScored, skipped };
}

// --- Sentiment backfill: score only entries with no `sentiment` yet. ---
app.post("/api/sentiment/backfill", async (req, res) => {
  const pipe = await getSentimentPipe();
  if (!pipe) return res.json({ ok: false, offline: true });
  res.json({ ok: true, ...(await scoreArchive(false)) });
});

// --- Sentiment rescore: re-score EVERY finalized entry, overwriting existing
// sentiments (e.g. to replace old lexicon scores). Deliberate bulk restamp. ---
app.post("/api/sentiment/rescore", async (req, res) => {
  const pipe = await getSentimentPipe();
  if (!pipe) return res.json({ ok: false, offline: true });
  res.json({ ok: true, ...(await scoreArchive(true)) });
});

// --- Resource: save a pasted/dropped image, return its served URL ---
app.post("/api/resource/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  const { dataUrl, ext } = req.body || {};
  if (!dataUrl || typeof dataUrl !== "string") {
    return res.status(400).json({ ok: false, error: "missing dataUrl" });
  }
  const base64 = dataUrl.split(",")[1] || "";
  const safeExt = String(ext || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
  const resDir = path.join(DIARY, date, "resources");
  await fs.mkdir(resDir, { recursive: true });
  const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  await fs.writeFile(path.join(resDir, name), Buffer.from(base64, "base64"));
  res.json({ ok: true, url: `/files/${date}/resources/${name}` });
});

// --- List a date's resources, flagging orphans (unreferenced files) ---
// The panel's real job is orphan cleanup, so we tell it which images are
// still referenced by the day's finalized entries or its live draft.
app.get("/api/resources/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  const resDir = path.join(DIARY, date, "resources");
  let files = [];
  try {
    files = await fs.readdir(resDir);
  } catch {
    return res.json({ ok: true, resources: [] });
  }

  // Gather every markdown that could reference this day's resources: the
  // draft plus all finalized entries. Disk paths are relative (resources/…).
  const texts = [];
  try {
    texts.push(await fs.readFile(path.join(DRAFTS, `${date}.md`), "utf8"));
  } catch {}
  const dayDir = path.join(DIARY, date);
  let dayFiles = [];
  try {
    dayFiles = await fs.readdir(dayDir);
  } catch {}
  for (const f of dayFiles) {
    if (/^entry-\d+\.md$/.test(f)) {
      texts.push(await fs.readFile(path.join(dayDir, f), "utf8"));
    }
  }
  const blob = texts.join("\n");

  const resources = files
    .filter((name) => name !== ".gitkeep")
    .map((name) => ({
      name,
      url: `/files/${date}/resources/${name}`,
      referenced: blob.includes(`resources/${name}`),
    }));
  res.json({ ok: true, resources });
});

// --- Resource soft delete (orphan cleanup, future panel) ---
app.delete("/api/resource/:date/:name", guardDate, async (req, res) => {
  const { date } = req.params;
  const name = path.basename(req.params.name); // block traversal
  const target = path.join(DIARY, date, "resources", name);
  if (!fsSync.existsSync(target)) {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  await moveToTrash(target, { kind: "resource", date, name });
  res.json({ ok: true });
});

// --- Entry soft delete (from the calendar day-overlay's by-entry mode) ---
// Deletes ONLY the entry markdown; its images are left untouched (delete of an
// entry and delete of an image are independent, by design). Numbers are never
// reused (nextEntryNumber is max+1), so the gap this leaves is stable and the
// entry can later be restored to its exact slot from the Bin.
app.delete("/api/entry/:date/:name", guardDate, async (req, res) => {
  const { date } = req.params;
  const name = path.basename(req.params.name); // block traversal
  if (!/^entry-\d+\.md$/.test(name)) {
    return res.status(400).json({ ok: false, error: "bad entry name" });
  }
  const target = path.join(DIARY, date, name);
  if (!fsSync.existsSync(target)) {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  await moveToTrash(target, { kind: "entry", date, name });
  res.json({ ok: true });
});

// --- Bin: list recoverable trash items (those with an origin sidecar) ---
// Drafts are recorded but hidden here — the Bin is for things a user meaningfully
// deleted (entries, images), not autosave churn. Sidecar-less items (pre-feature)
// are skipped: their origin is unknown, so we can't offer a one-click restore.
app.get("/api/trash", async (req, res) => {
  let files = [];
  try {
    files = await fs.readdir(TRASH);
  } catch {
    return res.json({ ok: true, items: [] });
  }
  const items = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue; // sidecars drive the listing
    const blob = f.slice(0, -".json".length);
    if (!files.includes(blob)) continue; // orphan sidecar; skip
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(path.join(TRASH, f), "utf8"));
    } catch {
      continue;
    }
    if (meta.kind === "draft") continue; // hide draft churn
    items.push({
      id: blob,
      kind: meta.kind,
      date: meta.date,
      name: meta.name,
      deletedAt: meta.deletedAt,
      url: meta.kind === "resource" ? `/files/.trash/${blob}` : undefined,
    });
  }
  items.sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
  res.json({ ok: true, items });
});

// --- Bin: read a trashed ENTRY's markdown, for previewing before restore ---
// Wire-rewrites image refs using the item's ORIGIN date (from the sidecar) so any
// embedded images still resolve in the preview. Only entry items are previewable.
app.get("/api/trash/:id", async (req, res) => {
  const id = path.basename(req.params.id); // block traversal
  const blob = path.join(TRASH, id);
  const sidecar = `${blob}.json`;
  if (!fsSync.existsSync(blob) || !fsSync.existsSync(sidecar)) {
    return res.status(404).json({ ok: false, error: "not in bin" });
  }
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(sidecar, "utf8"));
  } catch {
    return res.status(400).json({ ok: false, error: "bad sidecar" });
  }
  if (meta.kind !== "entry") {
    return res.status(400).json({ ok: false, error: "not previewable" });
  }
  const raw = await fs.readFile(blob, "utf8");
  // Strip frontmatter so the preview matches the reader (body only).
  const { body } = parseFrontmatter(raw);
  res.json({ ok: true, markdown: toWire(body, meta.date) });
});

// --- Topics: the used-topic registry, for the editor's suggestion list ---
app.get("/api/topics", async (req, res) => {
  res.json({ ok: true, topics: await readTopics() });
});

// --- Gather entries by exact topic (the Gather tab's Topics view). Unlike a
// concept (a body grep), a topic is the entry's `topic:` frontmatter word, so the
// predicate is an EXACT normTopic equality on meta.topic — never entryMatches.
// Backed by the persisted per-topic index (built + backfilled on first use). Each
// entry is annotated with its stored sentiment for the detail-page graph. ---
app.get("/api/topics/:topic/entries", async (req, res) => {
  const target = normTopic(req.params.topic);
  if (!target) return res.json({ ok: true, topic: target, page: "", entries: [] });
  const idx = await ensureTopicIndex(target);
  const links = (idx.links || [])
    .slice()
    .sort((a, b) => (a.date + a.entry).localeCompare(b.date + b.entry));
  const entries = [];
  for (const l of links) {
    entries.push({
      date: l.date,
      entry: l.entry,
      matched: target,
      sentiment: await entrySentiment(l.date, l.entry),
    });
  }
  res.json({ ok: true, topic: target, page: idx.page || "", entries });
});

// Update a topic's editable notes page only (a topic has no user-editable name or
// keywords — it's a frontmatter word). Ensures the index exists first.
app.put("/api/topics/:topic", async (req, res) => {
  const target = normTopic(req.params.topic);
  if (!target) return res.status(400).json({ ok: false, error: "bad topic" });
  const idx = await ensureTopicIndex(target);
  if (typeof req.body?.page === "string") idx.page = req.body.page;
  idx.updatedAt = new Date().toISOString();
  await writeTopicIndex(target, idx);
  res.json({ ok: true, topic: { topic: target, page: idx.page } });
});

// --- A finalized entry's markdown body for preview (frontmatter stripped, wire
// paths) — slug-independent, used by the Topics view. Mirrors the concept-scoped
// preview route but reads only live entries (a frontmatter topic never points at
// a tore'd entry the way a permanent concept link can). ---
app.get("/api/entry/:date/:name", guardDate, async (req, res) => {
  const { date } = req.params;
  const name = path.basename(req.params.name);
  if (!/^entry-\d+\.md$/.test(name)) {
    return res.status(400).json({ ok: false, error: "bad entry name" });
  }
  const blob = path.join(DIARY, date, name);
  if (!fsSync.existsSync(blob)) {
    return res.status(404).json({ ok: false, error: "not found" });
  }
  const raw = await fs.readFile(blob, "utf8");
  const { body } = parseFrontmatter(raw);
  res.json({ ok: true, markdown: toWire(body, date) });
});

// --- Bin: restore a trashed item to its original place (soft; rename back) ---
// Never overwrites: if the destination already exists (e.g. the same slot was
// re-created), refuse with 409 and leave the item in the bin.
app.post("/api/trash/restore/:id", async (req, res) => {
  const id = path.basename(req.params.id); // block traversal
  const blob = path.join(TRASH, id);
  const sidecar = `${blob}.json`;
  if (!fsSync.existsSync(blob) || !fsSync.existsSync(sidecar)) {
    return res.status(404).json({ ok: false, error: "not in bin" });
  }
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(sidecar, "utf8"));
  } catch {
    return res.status(400).json({ ok: false, error: "bad sidecar" });
  }
  const { kind, date, name } = meta;
  if (!DATE_RE.test(date || "")) {
    return res.status(400).json({ ok: false, error: "bad origin date" });
  }
  const safeName = path.basename(name || "");
  let dest;
  if (kind === "entry") {
    if (!/^entry-\d+\.md$/.test(safeName)) {
      return res.status(400).json({ ok: false, error: "bad entry name" });
    }
    dest = path.join(DIARY, date, safeName);
  } else if (kind === "resource") {
    dest = path.join(DIARY, date, "resources", safeName);
  } else {
    return res.status(400).json({ ok: false, error: "not restorable" });
  }
  if (fsSync.existsSync(dest)) {
    return res
      .status(409)
      .json({ ok: false, error: "destination already exists", date, name: safeName });
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(blob, dest);
  await fs.rm(sidecar, { force: true }); // drop the now-consumed origin record
  res.json({ ok: true, date, name: safeName });
});

// --- Concepts: the tagging layer (list / create / read / edit / rescan / preview) ---

// List all concepts (summaries) for the tab's list view.
app.get("/api/concepts", async (req, res) => {
  res.json({ ok: true, concepts: await listConcepts() });
});

// Create a concept. Slug from the name; refuse to clobber an existing one (409).
// Greps the whole archive immediately so a new concept gathers existing matches.
app.post("/api/concepts", async (req, res) => {
  const name = normTopic(req.body?.name);
  if (!name) {
    return res.status(400).json({ ok: false, error: "name must be one word" });
  }
  const slug = name; // normTopic already yields a safe single-token slug
  if (fsSync.existsSync(conceptPath(slug))) {
    return res.status(409).json({ ok: false, error: "concept already exists" });
  }
  const keywords = Array.isArray(req.body?.keywords)
    ? [...new Set(req.body.keywords.map(normTopic).filter(Boolean))]
    : [];
  const now = new Date().toISOString();
  const concept = {
    name,
    keywords,
    page: typeof req.body?.page === "string" ? req.body.page : "",
    links: [],
    createdAt: now,
    updatedAt: now,
  };
  await scanArchiveForConcept(concept); // grep-everything on create
  await writeConcept(slug, concept);
  res.json({ ok: true, concept });
});

// Read one concept in full, annotating each link with a live `deleted` flag
// (true when the origin entry no longer exists on disk, i.e. it's in tore).
app.get("/api/concepts/:slug", async (req, res) => {
  const slug = path.basename(req.params.slug);
  const c = await readConcept(slug);
  if (!c) return res.status(404).json({ ok: false, error: "not found" });
  const links = [];
  for (const l of c.links || []) {
    links.push({
      ...l,
      deleted: !fsSync.existsSync(path.join(DIARY, l.date, l.entry)),
      sentiment: await entrySentiment(l.date, l.entry), // for the detail-page graph
    });
  }
  res.json({ ok: true, concept: { ...c, slug, links } });
});

// Update editable fields only (name display, keywords, page notes). Never
// touches links — they're append-only and permanent.
app.put("/api/concepts/:slug", async (req, res) => {
  const slug = path.basename(req.params.slug);
  const c = await readConcept(slug);
  if (!c) return res.status(404).json({ ok: false, error: "not found" });
  if (typeof req.body?.name === "string") {
    const nm = normTopic(req.body.name);
    if (nm) c.name = nm; // display name; slug (filename) stays fixed
  }
  if (Array.isArray(req.body?.keywords)) {
    c.keywords = [...new Set(req.body.keywords.map(normTopic).filter(Boolean))];
  }
  if (typeof req.body?.page === "string") c.page = req.body.page;
  c.updatedAt = new Date().toISOString();
  await writeConcept(slug, c);
  res.json({ ok: true, concept: { ...c, slug } });
});

// Rescan the whole archive against this concept's current keywords. Only ADDS
// links; returns how many were newly added.
app.post("/api/concepts/:slug/rescan", async (req, res) => {
  const slug = path.basename(req.params.slug);
  const c = await readConcept(slug);
  if (!c) return res.status(404).json({ ok: false, error: "not found" });
  const added = await scanArchiveForConcept(c);
  if (added) await writeConcept(slug, c);
  res.json({ ok: true, added });
});

// Read a linked entry's markdown BODY for preview — whether the entry is live
// or currently in tore (found via its trash sidecar). Frontmatter stripped,
// wire paths, so it renders like the reader.
app.get("/api/concepts/:slug/entry/:date/:name", guardDate, async (req, res) => {
  const { date } = req.params;
  const name = path.basename(req.params.name);
  if (!/^entry-\d+\.md$/.test(name)) {
    return res.status(400).json({ ok: false, error: "bad entry name" });
  }
  let blob = path.join(DIARY, date, name);
  if (!fsSync.existsSync(blob)) {
    blob = await findTrashedEntry(date, name); // linked but tore'd — read trash
    if (!blob) return res.status(404).json({ ok: false, error: "not found" });
  }
  const raw = await fs.readFile(blob, "utf8");
  const { body } = parseFrontmatter(raw);
  res.json({ ok: true, markdown: toWire(body, date) });
});

// --- Static serve of diary/ so images display ---
app.use("/files", express.static(DIARY));

app.listen(PORT, () => {
  console.log(`Duct-Tape Diary server on http://localhost:${PORT}`);
});
