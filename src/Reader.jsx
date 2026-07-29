import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { today } from "./lib/date.js";
import { loadDay, loadDays } from "./api.js";
import { DayFlow, Page, computePageRanges } from "./lib/pages.jsx";

const FLIP_MS = 560;
// Below this viewport width there's no room for a two-page spread.
const SPREAD_MIN_W = 900;

export default function Reader() {
  const [days, setDays] = useState([]); // sorted date strings with entries
  const [pageIndex, setPageIndex] = useState(0); // flattened index across days
  const [spread, setSpread] = useState(
    typeof window !== "undefined" && window.innerWidth >= SPREAD_MIN_W
  );
  const [flip, setFlip] = useState(null); // {dir:'fwd'|'back', from} | null
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

  // --- Load the day sequence, then land on today (or the last day). ---
  useEffect(() => {
    let cancelled = false;
    loadDays().then((d) => {
      if (cancelled) return;
      setDays(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Track viewport width for spread vs single. Same pageIndex feeds both. ---
  useEffect(() => {
    const onResize = () => setSpread(window.innerWidth >= SPREAD_MIN_W);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Land on today's chapter (or the most recent day) the first time the page
  // list is populated — a one-shot so it never fights user navigation after.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !days.length) return;
    const t = today();
    const target = days.includes(t) ? t : days[days.length - 1];
    if (!entriesCache.current.get(target)) return; // wait until it's loaded
    const idx = pagesRef.current.findIndex((p) => p.date === target);
    if (idx >= 0) {
      landed.current = true;
      setPageIndex(idx);
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

  // Jump to a date's first page (used by the date picker).
  function goToDate(date) {
    ensureDay(date);
    const idx = pages.findIndex((p) => p.date === date);
    if (idx >= 0) setPageIndex(idx);
  }

  // --- Navigation. Step is 2 in spread mode (a leaf = two pages), 1 single. ---
  const step = spread ? 2 : 1;
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

  // In spread mode the left page of a spread is always an even index.
  const leftIndex = spread ? pageIndex - (pageIndex % 2) : pageIndex;
  const atStart = pageIndex <= 0;
  const atEnd = spread ? leftIndex + 2 >= total : pageIndex >= total - 1;

  const curDate = pages[pageIndex]?.date;

  return (
    <div className="reader-pane">
      <div className="toolbar">
        <input
          type="date"
          value={curDate || today()}
          onChange={(e) => goToDate(e.target.value)}
        />
        <button onClick={() => navigate("back")} disabled={atStart || !!flip}>
          ◂ Prev
        </button>
        <button onClick={() => navigate("fwd")} disabled={atEnd || !!flip}>
          Next ▸
        </button>
        <span className="status">
          {total === 0
            ? "no entries"
            : `${curDate || ""} · page ${pageIndex + 1} of ${total}`}
        </span>
      </div>

      {total === 0 ? (
        <p className="empty">No finalized entries yet.</p>
      ) : spread ? (
        <Spread
          pages={pages}
          leftIndex={leftIndex}
          flip={flip}
          entriesFor={(d) => entriesCache.current.get(d)}
        />
      ) : (
        <Single
          pages={pages}
          index={pageIndex}
          flip={flip}
          entriesFor={(d) => entriesCache.current.get(d)}
        />
      )}

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
function Spread({ pages, leftIndex, flip, entriesFor }) {
  const left = pages[leftIndex];
  const right = pages[leftIndex + 1];
  // Where the flip is heading determines which underlying pages show through.
  const fwd = flip?.dir === "fwd";
  const back = flip?.dir === "back";
  const nextLeft = pages[leftIndex + 2];
  const nextRight = pages[leftIndex + 3];
  const prevLeft = pages[leftIndex - 2];
  const prevRight = pages[leftIndex - 1];

  return (
    <div className={`book ${flip ? "flipping" : ""}`}>
      {/* Static underlay: what will be revealed under the turning leaf. */}
      <div className="book-side left">
        <Page page={fwd ? left : back ? prevLeft : left} entriesFor={entriesFor} />
      </div>
      <div className="book-side right">
        <Page
          page={fwd ? nextRight : back ? right : right}
          entriesFor={entriesFor}
          blank={fwd ? !nextRight : false}
        />
      </div>

      {/* The turning leaf (only present during a flip). */}
      {flip && (
        <div className={`leaf ${fwd ? "leaf-fwd" : "leaf-back"}`}>
          <div className="leaf-face leaf-front">
            <Page
              page={fwd ? right : left}
              entriesFor={entriesFor}
              blank={fwd ? !right : !left}
            />
          </div>
          <div className="leaf-face leaf-back-face">
            <Page
              page={fwd ? nextLeft : prevRight}
              entriesFor={entriesFor}
              blank={fwd ? !nextLeft : !prevRight}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Single-page mode: a plain card that slides/shuffles between pages.
function Single({ pages, index, flip, entriesFor }) {
  const cur = pages[index];
  return (
    <div className="book single">
      <div className={`shuffle ${flip ? `shuffle-${flip.dir}` : ""}`}>
        <Page page={cur} entriesFor={entriesFor} />
      </div>
    </div>
  );
}
