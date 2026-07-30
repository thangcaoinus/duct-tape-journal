// Shared page-rendering + pagination primitives used by both the book Reader
// (src/Reader.jsx) and the calendar's day overlay (src/DayOverlay.jsx). A day's
// finalized entries are concatenated into one continuous read-only flow, then
// paginated into fixed-size pages that break ONLY between whole top-level blocks
// (so a tall KaTeX formula or image is never sliced). Kept deliberately minimal
// — this is the pagination that was stabilized for the Reader; don't redesign.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import { Markdown } from "tiptap-markdown";
import { loadDay } from "../api.js";

// Fixed page geometry (px). Kept in sync with the CSS custom properties in
// styles.css (--page-w/h/pad/foot-h).
export const PAGE_W = 460;
export const PAGE_H = 620;
export const PAGE_PAD = 36; // inner padding; content width is PAGE_W - 2*PAD
export const FOOT_H = 24; // reserved strip at the page bottom for the date footer
// Usable text height per page. Kept in sync with CSS --content-h.
export const CONTENT_H = PAGE_H - 2 * PAGE_PAD - FOOT_H;

const EXTENSIONS = [
  StarterKit,
  Image,
  Mathematics,
  Markdown.configure({ html: false }),
];

// Join a day's entries into one markdown doc, separated by an <hr>.
export function joinEntries(entries) {
  return entries
    .map((e, i) => (i === 0 ? "" : "\n\n---\n\n") + e.markdown)
    .join("");
}

// One day's flow rendered read-only. When `range` is given, only that block
// range [start,end) is shown (the rest is display:none) — whole blocks only, so
// nothing is ever clipped mid-line. `onImagesLoad` fires once images settle so
// callers can re-measure.
export function DayFlow({ entries, onImagesLoad, range }) {
  const markdown = useMemo(() => joinEntries(entries), [entries]);
  const editor = useEditor(
    {
      editable: false,
      content: markdown,
      extensions: EXTENSIONS,
      immediatelyRender: true,
    },
    [markdown]
  );

  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onImagesLoad) return;
    const imgs = [...el.querySelectorAll("img")];
    const pending = imgs.filter((im) => !im.complete);
    if (!pending.length) {
      onImagesLoad();
      return;
    }
    let left = pending.length;
    const done = () => {
      if (--left <= 0) onImagesLoad();
    };
    pending.forEach((im) => {
      im.addEventListener("load", done, { once: true });
      im.addEventListener("error", done, { once: true });
    });
    return () => {
      pending.forEach((im) => {
        im.removeEventListener("load", done);
        im.removeEventListener("error", done);
      });
    };
  }, [editor, onImagesLoad]);

  // Reveal only this page's block range; hide the rest.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pm = el.querySelector(".ProseMirror");
    if (!pm) return;
    const blocks = [...pm.children];
    blocks.forEach((b, i) => {
      const shown = !range || (i >= range.start && i < range.end);
      b.style.display = shown ? "" : "none";
    });
  }, [editor, range, markdown]);

  return (
    <div ref={ref} className="day-flow">
      <EditorContent editor={editor} className="prose" />
    </div>
  );
}

// Measure a day's flow off-screen and return, for each page, the RANGE of
// top-level block indices it should show: { start, end } (end exclusive). A page
// accumulates whole blocks until the next block would overflow CONTENT_H, then
// starts a fresh page. Pages are described by block indices, not pixel offsets,
// so each rendered page lays out its own whole blocks and nothing is clipped.
export function computePageRanges(flowEl) {
  const pm = flowEl?.querySelector(".ProseMirror");
  if (!pm) return [{ start: 0, end: 0 }];
  const blocks = [...pm.children];
  if (!blocks.length) return [{ start: 0, end: 0 }];
  const base = pm.getBoundingClientRect().top;
  const ranges = [];
  let start = 0;
  let pageTop = blocks[0].getBoundingClientRect().top - base;
  for (let i = 0; i < blocks.length; i++) {
    const rect = blocks[i].getBoundingClientRect();
    const bottom = rect.bottom - base;
    if (bottom - pageTop > CONTENT_H && i > start) {
      ranges.push({ start, end: i });
      start = i;
      pageTop = rect.top - base;
    }
  }
  ranges.push({ start, end: blocks.length });
  return ranges;
}

// One physical page showing this page's block range of its day's flow. `blank`
// renders an empty paper page (used to pad book spreads). When `showDateHead` is
// set and this is the FIRST page of its day (`pageInDay === 0`), a date "chapter"
// header is drawn in the top margin — it marks where a new date begins as you page
// through the multi-day Reader flow. It lives in the padding strip (absolute, like
// the footer), NOT in the content flow, so it never eats into CONTENT_H and can't
// clip the paginated blocks below it.
export function Page({ page, entriesFor, blank, showDateHead }) {
  if (blank || !page) return <div className="page page-blank" />;
  const entries = entriesFor(page.date);
  const isDayStart = showDateHead && page.pageInDay === 0;
  return (
    <div className={`page ${isDayStart ? "page-daystart" : ""}`}>
      {isDayStart && <div className="page-head">{formatDateHead(page.date)}</div>}
      <div className="page-inner">
        {entries ? (
          <DayFlow entries={entries} range={page.range} />
        ) : (
          <p className="empty">…</p>
        )}
      </div>
      <div className="page-foot">{page.date}</div>
    </div>
  );
}

// A friendly date header like "Monday, July 28, 2026" from a YYYY-MM-DD string.
// Parsed as LOCAL (split, not new Date(str) which is UTC and can roll a day).
function formatDateHead(date) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Load + paginate a SINGLE date's entries. Returns:
//   entries  - [{name,markdown}] once loaded (null while loading)
//   pages    - [{date, pageInDay, range}] once measured
//   measured - true once real block ranges are known
// Encapsulates the hidden measuring pass (fonts + image settle) that both the
// Reader and the overlay rely on. Renders its own off-screen measure host, so
// callers just place <div>{measureHost}</div> somewhere in their tree.
export function useDayPages(date) {
  const [entries, setEntries] = useState(null);
  const [ranges, setRanges] = useState(null); // [{start,end}] or null
  const measureRef = useRef(null);

  // Load entries when the date changes.
  useEffect(() => {
    if (!date) {
      setEntries(null);
      setRanges(null);
      return;
    }
    let cancelled = false;
    setEntries(null);
    setRanges(null);
    loadDay(date).then((e) => {
      if (!cancelled) setEntries(e);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Measure once entries (and their images/fonts) have rendered.
  const onMeasured = useCallback(() => {
    const measure = () =>
      requestAnimationFrame(() => {
        setRanges(computePageRanges(measureRef.current));
      });
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    else measure();
  }, []);

  const pages = useMemo(() => {
    if (!entries) return [];
    const rs = ranges || [null]; // one whole-flow page until measured
    return rs.map((range, i) => ({ date, pageInDay: i, range }));
  }, [entries, ranges, date]);

  // Off-screen measuring host the caller must render somewhere.
  const measureHost =
    entries && !ranges ? (
      <div className="measure-host" aria-hidden ref={measureRef}>
        <DayFlow key={date} entries={entries} onImagesLoad={onMeasured} />
      </div>
    ) : null;

  return { entries, pages, measured: !!ranges, measureHost };
}
