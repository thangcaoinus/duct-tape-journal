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
async function moveToTrash(absPath) {
  await fs.mkdir(TRASH, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(TRASH, `${stamp}__${path.basename(absPath)}`);
  await fs.rename(absPath, dest);
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
  await moveToTrash(draftPath);
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
  await moveToTrash(target);
  res.json({ ok: true });
});

// --- Static serve of diary/ so images display ---
app.use("/files", express.static(DIARY));

app.listen(PORT, () => {
  console.log(`Duct-Tape Diary server on http://localhost:${PORT}`);
});
