import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { today } from "./lib/date.js";
import { loadDay, loadDaysWithCounts } from "./api.js";
import { DayFlow, Page, computePageRanges } from "./lib/pages.jsx";

const FLIP_MS = 560;
// Below this viewport width there's no room for a two-page spread.
const SPREAD_MIN_W = 900;

// Riffle (multi-page jump) tuning. Turns are capped at RIFFLE_CAP so a 300-page
// jump never becomes a 300-turn animation — beyond the cap each turn just advances
// a bigger chunk. The whole riffle aims for ~RIFFLE_TOTAL_MS regardless of how many
// turns it renders, so more turns ⇒ each turn is FASTER (16 turns flip faster than
// 8, faster than 2). MIN_FLIP_MS is the per-turn floor so it never blurs, and it's
// what bounds a very long riffle's total time.
const RIFFLE_CAP = 16;
const RIFFLE_TOTAL_MS = 900;
const MIN_FLIP_MS = 70;

// Drawn chevron icon (matches the app's single-stroke SVG convention — rail
// icons, bubble-menu icons — never an ASCII glyph). `dir` picks left/right.
function Chevron({ dir }) {
  return (
    <svg
      className="reader-chevron"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

// Label a day-picker option compactly: "Jul 21, 2026 · 2" (date parsed LOCAL, no
// UTC roll). Short so the picker reads as a tidy chip, not a sentence; the count
// still shows which days hold how much.
function formatDayOption(date, count) {
  const [y, m, d] = date.split("-").map(Number);
  let label = date;
  if (y && m && d) {
    label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  return `${label} · ${count ?? 0}`;
}

// Remember the last-read position as a stable {date, pageInDay} (NOT the flat
// index, which shifts as pagination fills in). localStorage so it survives a full
// reload; try/catch because storage can be absent or throw (private mode, quota).
const READ_POS_KEY = "dtd:read-pos";
function saveReadPos(pos) {
  try {
    localStorage.setItem(READ_POS_KEY, JSON.stringify(pos));
  } catch {
    /* storage unavailable — reading position just won't persist */
  }
}
function loadReadPos() {
  try {
    const raw = localStorage.getItem(READ_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p.date === "string" ? p : null;
  } catch {
    return null;
  }
}

export default function Reader({ active = true, dataVersion = 0 }) {
  const [days, setDays] = useState([]); // sorted date strings with entries
  const [pageIndex, setPageIndex] = useState(0); // flattened index across days
  const [spread, setSpread] = useState(
    typeof window !== "undefined" && window.innerWidth >= SPREAD_MIN_W
  );
  const [flip, setFlip] = useState(null); // {dir:'fwd'|'back', from} | null
  const [flipDur, setFlipDur] = useState(null); // per-turn ms override for a riffle
  const riffleToken = useRef(0); // bumps to cancel an in-flight riffle sequence
  const [ready, setReady] = useState(0); // bumps to force page-list recompute

  // Per-date caches: entries[date] = [{name,markdown}];
  // ranges[date] = [{start,end}, ...] (one block-range per page of that day)
  const entriesCache = useRef(new Map());
  const rangesCache = useRef(new Map());
  const measureRef = useRef(null);
  const [measuring, setMeasuring] = useState(null); // date currently measuring

  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  // --- Load the day sequence (with counts, for the day picker). ---
  // Runs on mount and again ONLY when dataVersion bumps (an entry was finalized /
  // deleted / restored). A plain tab switch keeps this component mounted and does
  // NOT re-run it, so Read renders + measures once and reuses it. On a real change
  // we clear the per-day caches and re-measure from scratch.
  const [dayCounts, setDayCounts] = useState(new Map()); // date -> entry count
  useEffect(() => {
    let cancelled = false;
    if (dataVersion > 0) {
      // Invalidate everything so the reload re-measures against fresh content.
      entriesCache.current.clear();
      rangesCache.current.clear();
      landed.current = false; // re-resolve the reading position against the new list
      savingEnabled.current = false; // don't persist placeholders during re-measure
    }
    loadDaysWithCounts().then((rows) => {
      if (cancelled) return;
      setDays(rows.map((r) => r.date));
      setDayCounts(new Map(rows.map((r) => [r.date, r.count])));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // --- Track viewport width for spread vs single. Same pageIndex feeds both. ---
  useEffect(() => {
    const onResize = () => setSpread(window.innerWidth >= SPREAD_MIN_W);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Land on the initial page the first time the page list is populated — a
  // one-shot so it never fights user navigation after. Priority:
  //   1. the saved read position (return to exactly where you left off — snap, no
  //      flourish), falling back to that date's first page if the exact page is
  //      gone;
  //   2. otherwise today's chapter (or the most recent day) — reached with an
  //      "opening the book" riffle from page 1.
  const landed = useRef(false);
  // Saving is disabled until AFTER the landing commit settles, so the mount-time
  // pageIndex=0 (first date) can never clobber the stored position before we've
  // read it. `enableSaving` flips this on one frame after we land.
  const savingEnabled = useRef(false);
  const enableSaving = () =>
    requestAnimationFrame(() => {
      savingEnabled.current = true;
    });
  useEffect(() => {
    if (landed.current || !days.length) return;

    // CRITICAL: wait until EVERY day is measured before resolving a flat index.
    // Unmeasured days contribute only a 1-page placeholder, so the flat list is
    // compressed; landing early would resolve an index that then shifts as days
    // expand to their real page counts — dropping us on an earlier day. Once all
    // days have ranges, the page list length and order are final.
    const allMeasured = days.every((d) => rangesCache.current.has(d));
    if (!allMeasured) return;
    const list = pagesRef.current;

    // 1. Saved position?
    const saved = loadReadPos();
    if (saved && days.includes(saved.date)) {
      let idx = list.findIndex(
        (p) => p.date === saved.date && p.pageInDay === saved.pageInDay
      );
      if (idx < 0) idx = list.findIndex((p) => p.date === saved.date); // page gone
      if (idx >= 0) {
        // In spread mode, align to the spread that leads with the saved page so it
        // shows on the LEFT (an odd flat index would otherwise open the previous
        // page's spread with the saved page on the right).
        if (spread && idx % 2 === 1) idx -= 1;
        landed.current = true;
        setPageIndex(idx); // returning to your spot: snap, no animation
        enableSaving();
        return;
      }
    }

    // 2. Default to today / last day, reached with an opening riffle from page 1.
    const t = today();
    const target = days.includes(t) ? t : days[days.length - 1];
    const idx = list.findIndex((p) => p.date === target);
    if (idx >= 0) {
      landed.current = true;
      if (idx > 0) flipMany(idx, { from: 0 });
      else setPageIndex(idx);
      enableSaving();
    }
  }, [days, ready]);

  // Ensure a date's entries are loaded; returns nothing but populates cache and
  // bumps `ready` so the flattened page list recomputes.
  const ensureDay = useCallback((date) => {
    if (!date || entriesCache.current.has(date)) return;
    entriesCache.current.set(date, null); // in-flight marker
    loadDay(date).then((entries) => {
      entriesCache.current.set(date, entries);
      setReady((r) => r + 1);
    });
  }, []);

  // Load every day's entries up front (archives are small; keeps paging simple).
  useEffect(() => {
    days.forEach(ensureDay);
  }, [days, ensureDay]);

  // Build the flattened list of pages across all days, in order. A day
  // contributes as many pages as its measured block ranges; each page carries
  // the {start, end} range of that day's blocks it should render.
  const pages = useMemo(() => {
    const list = [];
    for (const date of days) {
      const entries = entriesCache.current.get(date);
      if (!entries) {
        // Not loaded yet — reserve a single placeholder page so navigation and
        // indices stay stable; it fills in once measured. `range: null` renders
        // the whole (short) flow until real ranges arrive.
        list.push({ date, pageInDay: 0, range: null, pending: true });
        continue;
      }
      const ranges = rangesCache.current.get(date) || [null];
      ranges.forEach((range, i) =>
        list.push({ date, pageInDay: i, range, pending: false })
      );
    }
    return list;
    // ready + measuring drive recompute as caches fill.
  }, [days, ready]);

  // Mirror the latest page list into a ref so one-shot effects (initial
  // landing) can read it without listing `pages` as a dependency.
  const pagesRef = useRef([]);
  pagesRef.current = pages;

  // --- Measure days that have entries but no offsets yet, one at a time. ---
  const needsMeasure = useMemo(
    () =>
      days.find(
        (d) =>
          entriesCache.current.get(d) && !rangesCache.current.has(d)
      ),
    [days, ready]
  );
  useEffect(() => {
    if (needsMeasure && measuring !== needsMeasure) setMeasuring(needsMeasure);
  }, [needsMeasure, measuring]);

  // Called by the hidden measuring DayFlow once its images have settled.
  const onMeasured = useCallback(() => {
    const date = measuring;
    if (!date) return;
    // Wait for web fonts before measuring: measuring against a fallback font's
    // line height and then reflowing to the real font would shift every block
    // and slice the bottom line. Then rAF so layout is flushed before reading.
    const measure = () =>
      requestAnimationFrame(() => {
        const ranges = computePageRanges(measureRef.current);
        rangesCache.current.set(date, ranges);
        setMeasuring(null);
        setReady((r) => r + 1);
      });
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    else measure();
  }, [measuring]);

  // Re-measure everything on spread/width changes only if content width would
  // differ — here page content width is fixed (PAGE_W), so pagination is
  // width-independent and we do NOT need to recompute on resize. (Kept simple.)

  const total = pages.length;
  const clamp = (i) => Math.max(0, Math.min(i, Math.max(0, total - 1)));

  // --- Navigation. Step is 2 in spread mode (a leaf = two pages), 1 single. ---
  const step = spread ? 2 : 1;

  // Persist the reading position whenever the page settles (not mid-flip). Stored
  // as {date, pageInDay} so it survives pagination shifts and reloads.
  // IMPORTANT: don't save until the initial landing has resolved — on mount
  // pageIndex is 0 (the first date), and saving that would clobber the real saved
  // position BEFORE the restore effect gets to read it.
  useEffect(() => {
    if (!savingEnabled.current || flip || flipDur || total === 0) return; // pre-landing / mid-anim
    const p = pages[pageIndex];
    if (p) saveReadPos({ date: p.date, pageInDay: p.pageInDay });
  }, [pageIndex, flip, flipDur, total, ready]);

  function navigate(dir) {
    if (flip) return; // ignore input mid-flip so pages can't desync
    const target = clamp(pageIndex + (dir === "fwd" ? step : -step));
    if (target === pageIndex) return;
    const commit = () => {
      setPageIndex(target);
      setFlip(null);
    };
    if (reduceMotion.current) {
      commit();
      return;
    }
    setFlip({ dir, target });
    // transitionend is the primary signal; timeout is the safety net.
    setTimeout(commit, FLIP_MS + 60);
  }

  // Keyboard paging: ←/→ turn the page while Read is the visible tab. Bound each
  // render (no deps) so it closes over the current pageIndex/flip — navigate()
  // already guards mid-flip and clamps at the ends. Skipped when the Reader is
  // hidden off-screen (`active`) so it can't steal arrows from another tab, and
  // when focus is in the day-jump/select/input so those keep their native arrows.
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      navigate(e.key === "ArrowRight" ? "fwd" : "back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Riffle to a far page: a chained sequence of single turns that reads like
  // flipping through the pages in between — proportional to the distance, capped
  // at RIFFLE_CAP turns and speeding up as the count grows. `opts.from` overrides
  // the start (used by the opening-book landing, which begins at page 0 before
  // pageIndex has settled). Distance ≤ 1 step falls back to a single `navigate`.
  function flipMany(targetRaw, opts = {}) {
    if (flip) return; // locked out mid-animation
    const from = clamp(opts.from ?? pageIndex);
    const target = clamp(targetRaw);
    if (target === from) return;
    const dir = target > from ? "fwd" : "back";

    // Whole steps between here and there (a step is a spread-leaf or a single page).
    const stepsTotal = Math.ceil(Math.abs(target - from) / step);
    // Reduced motion, or a jump so short there's nothing to riffle → just snap.
    if (reduceMotion.current || stepsTotal <= 1) {
      setPageIndex(target);
      return;
    }

    // Turn COUNT grows sub-linearly (√distance) so more pages ⇒ more turns, but a
    // 300-page jump is ~16 turns, not 300. Per-turn SPEED scales with the number of
    // turns we ACTUALLY render (not the raw distance): the whole riffle aims for a
    // ~fixed total time, so the more turns there are, the faster each one — 16 turns
    // flip faster than 8. Floored at MIN_FLIP_MS so a big jump never blurs.
    const turns = Math.min(
      stepsTotal,
      Math.max(2, Math.round(Math.sqrt(stepsTotal) * 1.6)),
      RIFFLE_CAP
    );
    const dur = Math.max(MIN_FLIP_MS, Math.round(RIFFLE_TOTAL_MS / turns));

    // Distribute stepsTotal across `turns` turns so we land exactly on target
    // while showing at most RIFFLE_CAP turns (each turn may advance a chunk).
    const myToken = ++riffleToken.current;
    let idx = from;
    let turnsLeft = turns;
    let stepsLeft = stepsTotal;
    setFlipDur(dur);

    let seq = 0;
    const runTurn = () => {
      if (myToken !== riffleToken.current) return; // cancelled (remount/new jump)
      const chunk = Math.max(1, Math.round(stepsLeft / turnsLeft));
      const nextIdx =
        turnsLeft === 1
          ? target // last turn lands exactly
          : clamp(idx + (dir === "fwd" ? chunk : -chunk) * step);
      // `seq` bumps every turn so the animated leaf/shuffle gets a fresh React key
      // and its CSS animation REPLAYS — otherwise the same class stays applied and
      // only the first turn ever visibly animates.
      setFlip({ dir, target: nextIdx, seq: seq++ });
      setTimeout(() => {
        if (myToken !== riffleToken.current) return;
        setPageIndex(nextIdx);
        idx = nextIdx;
        stepsLeft -= chunk;
        turnsLeft -= 1;
        if (turnsLeft <= 0 || nextIdx === target) {
          setFlip(null);
          setFlipDur(null);
          // The settle effect persists the final position once flip clears.
          return;
        }
        runTurn();
      }, dur + 30);
    };
    runTurn();
  }

  // Jump to a date's first page (date picker) — riffles through the pages between.
  function goToDate(date) {
    ensureDay(date);
    const idx = pages.findIndex((p) => p.date === date);
    if (idx >= 0) flipMany(idx);
  }

  // Cancel any in-flight riffle on unmount so a late timer can't touch state.
  useEffect(() => () => { riffleToken.current++; }, []);

  // In spread mode the left page of a spread is always an even index.
  const leftIndex = spread ? pageIndex - (pageIndex % 2) : pageIndex;
  const atStart = pageIndex <= 0;
  const atEnd = spread ? leftIndex + 2 >= total : pageIndex >= total - 1;

  const curDate = pages[pageIndex]?.date;

  return (
    <div className="reader-pane">
      <div className="page-header">
        <h2>Read</h2>
        <span className="page-sub">Your journal as a book</span>
        <div className="page-rule" />
      </div>

      <div className="toolbar reader-toolbar">
        {/* Navigation group: jump-to-day + Prev/Next, kept together as one unit
            of book furniture. */}
        <div className="reader-nav">
          {/* Jump to a day. A native date calendar can't show WHICH days have
              entries, so this lists only real diary days, each with its count. */}
          <select
            className="day-jump"
            value={curDate || ""}
            onChange={(e) => goToDate(e.target.value)}
            disabled={days.length === 0 || !!flip}
            aria-label="Jump to a day"
          >
            {!curDate && <option value="">Jump to a day…</option>}
            {days.map((d) => (
              <option key={d} value={d}>
                {formatDayOption(d, dayCounts.get(d))}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary reader-turn"
            onClick={() => navigate("back")}
            disabled={atStart || !!flip}
            aria-label="Previous page"
          >
            <Chevron dir="left" />
            <span>Prev</span>
          </button>
          <button
            className="btn-secondary reader-turn"
            onClick={() => navigate("fwd")}
            disabled={atEnd || !!flip}
            aria-label="Next page"
          >
            <span>Next</span>
            <Chevron dir="right" />
          </button>
        </div>
        {/* Running-head reading position, pushed to its own side. The day picker
            already names the current day, so the raw date here was redundant. */}
        <span className="status">
          {total === 0 ? "no entries" : `page ${pageIndex + 1} of ${total}`}
        </span>
      </div>

      {total === 0 ? (
        <p className="empty">No finalized entries yet.</p>
      ) : (
        <div className="reader-stage">
          {spread ? (
            <Spread
              pages={pages}
              leftIndex={leftIndex}
              flip={flip}
              flipDur={flipDur}
              entriesFor={(d) => entriesCache.current.get(d)}
            />
          ) : (
            <Single
              pages={pages}
              index={pageIndex}
              flip={flip}
              flipDur={flipDur}
              entriesFor={(d) => entriesCache.current.get(d)}
            />
          )}
        </div>
      )}
      {/* Reader flows across many days, so each day's first page shows a date
          "chapter" header — see `showDateHead` threaded into <Page> below. */}

      {/* Hidden off-screen measuring pass: renders one day's full flow at the
          exact page content width so we can find where pages break. */}
      {measuring && entriesCache.current.get(measuring) && (
        <div className="measure-host" aria-hidden ref={measureRef}>
          <DayFlow
            key={measuring}
            entries={entriesCache.current.get(measuring)}
            onImagesLoad={onMeasured}
          />
        </div>
      )}
    </div>
  );
}

// Two-page spread with a 3D leaf turn. The turning leaf shows the outgoing page
// on its front and the incoming page on its back.
function Spread({ pages, leftIndex, flip, flipDur, entriesFor }) {
  const left = pages[leftIndex];
  const right = pages[leftIndex + 1];
  // Where the flip is heading determines which underlying pages show through.
  const fwd = flip?.dir === "fwd";
  const back = flip?.dir === "back";
  const nextLeft = pages[leftIndex + 2];
  const nextRight = pages[leftIndex + 3];
  const prevLeft = pages[leftIndex - 2];
  const prevRight = pages[leftIndex - 1];

  // During a riffle, override the per-turn speed via the shared --flip-ms var.
  const bookStyle = flipDur ? { "--flip-ms": `${flipDur}ms` } : undefined;

  return (
    // .book-scaler lets a phone shrink the whole spread to fit the viewport
    // (visual transform only — page geometry is untouched). No-op on desktop.
    <div className="book-scaler">
    <div className={`book ${flip ? "flipping" : ""}`} style={bookStyle}>
      {/* Static underlay: what will be revealed under the turning leaf. */}
      <div className="book-side left">
        <Page
          page={fwd ? left : back ? prevLeft : left}
          entriesFor={entriesFor}
          showDateHead
        />
      </div>
      <div className="book-side right">
        <Page
          page={fwd ? nextRight : back ? right : right}
          entriesFor={entriesFor}
          blank={fwd ? !nextRight : false}
          showDateHead
        />
      </div>

      {/* The turning leaf (only present during a flip). `key` includes flip.seq so
          each riffle turn remounts the leaf and its animation replays. */}
      {flip && (
        <div
          key={`leaf-${flip.seq ?? 0}`}
          className={`leaf ${fwd ? "leaf-fwd" : "leaf-back"}`}
        >
          <div className="leaf-face leaf-front">
            <Page
              page={fwd ? right : left}
              entriesFor={entriesFor}
              blank={fwd ? !right : !left}
              showDateHead
            />
          </div>
          <div className="leaf-face leaf-back-face">
            <Page
              page={fwd ? nextLeft : prevRight}
              entriesFor={entriesFor}
              blank={fwd ? !nextLeft : !prevRight}
              showDateHead
            />
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// Single-page mode: a plain card that slides/shuffles between pages.
function Single({ pages, index, flip, flipDur, entriesFor }) {
  const cur = pages[index];
  const bookStyle = flipDur ? { "--flip-ms": `${flipDur}ms` } : undefined;
  return (
    <div className="book-scaler book-scaler--single">
    <div className="book single" style={bookStyle}>
      {/* key includes flip.seq so each riffle turn replays the shuffle animation. */}
      <div
        key={`shuffle-${flip?.seq ?? "idle"}`}
        className={`shuffle ${flip ? `shuffle-${flip.dir}` : ""}`}
      >
        <Page page={cur} entriesFor={entriesFor} showDateHead />
      </div>
    </div>
    </div>
  );
}
