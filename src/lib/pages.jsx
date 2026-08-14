// Shared page-rendering + pagination primitives used by both the book Reader
// (src/Reader.jsx) and the calendar's day overlay (src/DayOverlay.jsx). A day's
// finalized entries are concatenated into one continuous read-only flow, then
// paginated into fixed-size pages that break ONLY between whole top-level blocks
// (so a tall KaTeX formula or image is never sliced). Kept deliberately minimal
// — this is the pagination that was stabilized for the Reader; don't redesign.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import { Markdown } from "tiptap-markdown";
import { loadDay } from "../api.js";
import { useConcepts, buildMatcher, openConceptPage } from "./concepts.jsx";
import { sentimentColor } from "./sentiment.js";

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

// Invisible sentinel (zero-width joiner) that prefixes an injected topic
// paragraph. It rides through tiptap-markdown as ordinary text into a plain <p>,
// then `tagEntryTopics` finds exactly these paragraphs post-render and dresses
// them as a #topic chip — without ever matching real prose.
const TOPIC_SENTINEL = "⁣"; // invisible separator (U+2063)
// A second invisible separator between the topic and its sentiment on the injected
// line. A visible delimiter (tab/space) gets collapsed by the markdown pipeline,
// so use a zero-width char that survives verbatim and never shows to the reader.
const SENT_SENTINEL = "​"; // zero-width space

// Join a day's entries into one markdown doc, separated by an <hr>. When
// `showTopics` is set (default), each entry that has a topic gets a sentinel
// paragraph prepended so it opens with a styled #topic tag. Because BOTH the
// render pass and the off-screen measure pass call this, the topic block is part
// of the measured flow too — pagination geometry stays honest.
export function joinEntries(entries, showTopics = true) {
  return entries
    .map((e, i) => {
      const sep = i === 0 ? "" : "\n\n---\n\n";
      const topic = showTopics ? e.meta?.topic : null;
      // Carry the entry's sentiment alongside the topic (after a tab) so the read
      // marker can be tinted by it. Rides through tiptap-markdown as plain text in
      // the SAME injected paragraph — measured + rendered flows stay identical.
      const sent = e.meta?.sentiment;
      const head = topic
        ? `${TOPIC_SENTINEL}${topic}${SENT_SENTINEL}${sent ?? ""}\n\n`
        : "";
      return sep + head + e.markdown;
    })
    .join("");
}

// One day's flow rendered read-only. When `range` is given, only that block
// range [start,end) is shown (the rest is display:none) — whole blocks only, so
// nothing is ever clipped mid-line. `onImagesLoad` fires once images settle so
// callers can re-measure.
export function DayFlow({ entries, onImagesLoad, range, showTopics = true }) {
  const markdown = useMemo(
    () => joinEntries(entries, showTopics),
    [entries, showTopics]
  );
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

  // Concept-word highlighting: mark any word matching a concept name/keyword, and
  // pop a small preview on hover. Applied here (the shared read renderer) so every
  // read view — Reader, day overlay, Tore preview, concept previews — gets it. It
  // must stay geometry-neutral (inline spans, no box-model change) so pagination
  // measurement, which runs the SAME DayFlow off-screen, still breaks identically.
  const concepts = useConcepts();
  const matcher = useMemo(() => buildMatcher(concepts), [concepts]);
  // pop = the hovered mark's info + its anchor rect; the card is then positioned
  // (above the word, centered, flipping below only near the top edge) once its own
  // size is known — see the layout effect below.
  const [pop, setPop] = useState(null);
  const popRef = useRef(null);
  const [popPos, setPopPos] = useState(null); // {left, top, side} once measured

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pm = el.querySelector(".ProseMirror");
    if (!pm) return;
    highlightConcepts(pm, matcher);
  }, [editor, markdown, matcher]);

  // Dress the injected topic paragraphs (see joinEntries) as #topic chips. Only
  // restyles the block that's already in the flow — it never adds or removes a
  // block, so the measured page breaks and the rendered ones stay identical.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pm = el.querySelector(".ProseMirror");
    if (!pm) return;
    tagEntryTopics(pm);
  }, [editor, markdown]);

  // One delegated hover handler for all marks in this flow.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function show(e) {
      const mark = e.target.closest?.(".concept-mark");
      if (!mark || !el.contains(mark)) return;
      const info = matcher.termMap.get(mark.dataset.term);
      if (!info) return;
      const r = mark.getBoundingClientRect();
      // Anchor to the word's center-top; final placement waits for the card size.
      setPopPos(null);
      setPop({ rect: { cx: r.left + r.width / 2, top: r.top, bottom: r.bottom }, ...info });
    }
    function hide(e) {
      if (e.target.closest?.(".concept-mark")) {
        setPop(null);
        setPopPos(null);
      }
    }
    // Click (or Enter/Space on a focused mark) opens that concept's page.
    function open(mark) {
      const info = matcher.termMap.get(mark.dataset.term);
      if (info?.slug) openConceptPage(info.slug);
    }
    function onClick(e) {
      const mark = e.target.closest?.(".concept-mark");
      if (mark && el.contains(mark)) open(mark);
    }
    function onKey(e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const mark = e.target.closest?.(".concept-mark");
      if (mark && el.contains(mark)) {
        e.preventDefault();
        open(mark);
      }
    }
    el.addEventListener("mouseover", show);
    el.addEventListener("mouseout", hide);
    el.addEventListener("focusin", show);
    el.addEventListener("focusout", hide);
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("mouseover", show);
      el.removeEventListener("mouseout", hide);
      el.removeEventListener("focusin", show);
      el.removeEventListener("focusout", hide);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKey);
    };
  }, [matcher]);

  // Place the card just above the word, horizontally centered on it, clamped to
  // the viewport; flip to just below when there isn't room above. Runs after the
  // card mounts so we know its real size.
  useLayoutEffect(() => {
    if (!pop || !popRef.current) return;
    const card = popRef.current.getBoundingClientRect();
    const GAP = 8;
    const M = 8; // viewport margin
    let left = pop.rect.cx - card.width / 2;
    left = Math.max(M, Math.min(left, window.innerWidth - card.width - M));
    const above = pop.rect.top - GAP - card.height;
    const side = above >= M ? "top" : "bottom";
    const top = side === "top" ? above : pop.rect.bottom + GAP;
    // Keep the caret under the word even when the card is clamped to a screen edge.
    const caret = Math.max(10, Math.min(pop.rect.cx - left, card.width - 10));
    setPopPos({ left, top, side, caret });
  }, [pop]);

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
      {/* Portal to <body>: read views (the book) sit inside a `perspective`/
          transform subtree, which would otherwise re-anchor position:fixed and
          shift the card. Rendering at the body root keeps fixed = viewport, so the
          getBoundingClientRect coordinates line up everywhere. */}
      {pop &&
        createPortal(
          <div
            ref={popRef}
            className={`concept-pop ${popPos ? `pop-${popPos.side}` : "pop-hidden"}`}
            style={
              popPos
                ? { left: popPos.left, top: popPos.top, "--caret": `${popPos.caret}px` }
                : undefined
            }
          >
            <span className="concept-pop-name">{pop.name}</span>
            <span className="concept-pop-snippet">
              {pop.snippet || "no notes yet"}
            </span>
            <span className="concept-pop-count">
              {pop.linkCount} linked entr{pop.linkCount === 1 ? "y" : "ies"}
            </span>
          </div>,
          document.body
        )}
    </div>
  );
}

// Find the sentinel-prefixed paragraphs joinEntries injected and turn each into a
// #topic chip: strip the invisible marker, prepend "#", and tag the block so CSS
// can style it. Idempotent — a paragraph already carrying `.entry-topic-mark` is
// skipped, so re-running on re-render is safe. It only mutates blocks that are
// ALREADY in the flow (never adds/removes one), so it can't shift pagination.
function tagEntryTopics(pm) {
  for (const block of pm.children) {
    if (block.classList.contains("entry-topic-mark")) continue;
    const text = block.textContent || "";
    if (!text.startsWith(TOPIC_SENTINEL)) continue;
    // The injected line is `<sentinel>topic<sent-sentinel><sentiment>` (joinEntries).
    const payload = text.slice(TOPIC_SENTINEL.length);
    const sep = payload.indexOf(SENT_SENTINEL);
    const topic = (sep === -1 ? payload : payload.slice(0, sep)).trim();
    if (!topic) continue;
    const sentRaw = sep === -1 ? "" : payload.slice(sep + 1).trim();
    block.classList.add("entry-topic-mark");
    // Store the bare topic; the leading "#" is drawn by CSS (::before) so it can
    // be styled independently without ::first-letter catching the first word char.
    block.textContent = topic;
    // Tint the topic word green(+)/rust(−) by the entry's sentiment — a legible
    // ramp (high opacity floor) so the word stays readable on paper. Color only,
    // so pagination geometry is untouched. Unscored → keep the default topic ink.
    const sent = sentRaw === "" ? null : Number(sentRaw);
    const tint =
      sent == null || Number.isNaN(sent)
        ? null
        : sentimentColor(sent, { floor: 0.85, span: 0.15 });
    block.style.color = tint || ""; // "" restores the CSS default (--topic-fg)
  }
}

// Wrap every whole-word concept match in a .concept-mark span, in place, over the
// text nodes of a rendered .ProseMirror. Skips code/pre and anything already
// marked, so markup, links, and math ($...$ rendered by KaTeX) are never touched.
// Idempotent: it first unwraps any prior marks, so re-running on a concept change
// or re-render is safe. Geometry-neutral by construction (the spans add no box).
function highlightConcepts(pm, matcher) {
  // Unwrap previous marks (replace each span with its text) so we start clean.
  pm.querySelectorAll(".concept-mark").forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  pm.normalize(); // merge adjacent text nodes split by the unwrap
  if (!matcher.regex) return;

  // Collect candidate text nodes first (mutating during a tree walk is unsafe).
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // Skip code/pre and any element we've already marked or that is math.
      let p = node.parentElement;
      while (p && p !== pm) {
        const tag = p.tagName;
        if (tag === "CODE" || tag === "PRE") return NodeFilter.FILTER_REJECT;
        if (p.classList.contains("concept-mark")) return NodeFilter.FILTER_REJECT;
        if (p.hasAttribute("data-type") || p.classList.contains("katex"))
          return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n);

  for (const textNode of targets) {
    const text = textNode.nodeValue;
    matcher.regex.lastIndex = 0;
    let m;
    let last = 0;
    const frag = document.createDocumentFragment();
    let matched = false;
    while ((m = matcher.regex.exec(text))) {
      matched = true;
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const span = document.createElement("span");
      span.className = "concept-mark";
      span.textContent = m[0];
      span.dataset.term = m[0].toLowerCase();
      span.tabIndex = 0; // focusable so the preview is keyboard-reachable
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (!matched) continue;
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }
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
      {/* Footer dateline in the book's own voice (a friendly local date), not a
          raw ISO stamp. Absolute in the reserved --foot-h strip — no geometry
          change. */}
      <div className="page-foot">{formatDateFoot(page.date)}</div>
    </div>
  );
}

// A quiet footer dateline like "May 4, 2026" (LOCAL-parsed, no UTC roll). The
// longhand weekday form lives in the top chapter header; the footer stays short.
function formatDateFoot(date) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
