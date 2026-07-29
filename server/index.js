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
app.post("/api/draft/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  const md = req.body?.markdown ?? "";
  await fs.mkdir(DRAFTS, { recursive: true });
  await fs.writeFile(
    path.join(DRAFTS, `${date}.md`),
    toDisk(md, date),
    "utf8"
  );
  res.json({ ok: true });
});

app.get("/api/draft/:date", guardDate, async (req, res) => {
  const { date } = req.params;
  try {
    const md = await fs.readFile(path.join(DRAFTS, `${date}.md`), "utf8");
    res.json({ ok: true, markdown: toWire(md, date) });
  } catch {
    res.json({ ok: true, markdown: "" });
  }
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
  // Draft is already on disk in disk-path form; write straight through.
  await fs.writeFile(file, md, "utf8");
  await moveToTrash(draftPath, { kind: "draft", date, name: `${date}.md` });
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
    const md = await fs.readFile(path.join(dayDir, name), "utf8");
    entries.push({ name, markdown: toWire(md, date) });
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
  const md = await fs.readFile(blob, "utf8");
  res.json({ ok: true, markdown: toWire(md, meta.date) });
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

// --- Static serve of diary/ so images display ---
app.use("/files", express.static(DIARY));

app.listen(PORT, () => {
  console.log(`Duct-Tape Diary server on http://localhost:${PORT}`);
});
