import { useEffect, useMemo, useRef, useState } from "react";
import { Page, useDayPages, DayFlow } from "./lib/pages.jsx";
import { deleteEntry } from "./api.js";
import Resources from "./Resources.jsx";

const SHUFFLE_MS = 560; // keep in sync with the .shuffle transition in CSS

// Small metadata tag shown above an entry in by-entry mode: the topic (like an
// email subject) and a sentiment chip driven by the sign of the -100..100 score.
// Both are optional — a frontmatter-less (older) entry renders nothing here.
function EntryMeta({ meta }) {
  if (!meta || (!meta.topic && meta.sentiment == null)) return null;
  const s = meta.sentiment;
  const face = s == null ? "" : s > 0 ? "🙂" : s < 0 ? "🙁" : "😐";
  return (
    <span className="entry-meta">
      {meta.topic && <span className="entry-topic">#{meta.topic}</span>}
      {s != null && (
        <span className="sentiment-chip" title="sentiment (-100…100)">
          {face} {s > 0 ? `+${s}` : s}
        </span>
      )}
    </span>
  );
}

// Full-screen overlay that reads ONE day's entries over a dimmed backdrop (the
// calendar stays mounted, faded, behind it). Two view modes:
//   - "flow"    : the day joined into one continuous flow, paginated, stepped as
//                 shuffling cards (Prev/Next). This is the plain reader.
//   - "by-entry": ONE entry shown in full at a time, with Prev/Next shuffling to
//                 the adjacent entry and a per-entry Delete. An independent image
//                 side panel (its own scroll) sits alongside. Entry-delete and
//                 image-delete never touch each other.
// ✕ / Esc / backdrop-click close. `onChanged` fires after any delete so the
// calendar can refresh its per-day counts.
export default function DayOverlay({ date, onClose, onChanged }) {
  const { pages, entries, measureHost } = useDayPages(date);
  const [view, setView] = useState("flow"); // 'flow' | 'by-entry'
  const [index, setIndex] = useState(0); // flow: page index
  const [shuffle, setShuffle] = useState(null); // 'fwd' | 'back' | null
  const [entryIdx, setEntryIdx] = useState(0); // by-entry: which live entry
  const [entryShuffle, setEntryShuffle] = useState(null);
  // Entries deleted this session, hidden from the by-entry list immediately.
  const [deleted, setDeleted] = useState(() => new Set());
  const [note, setNote] = useState("");

  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  // Reset when the day changes.
  useEffect(() => {
    setIndex(0);
    setShuffle(null);
    setEntryIdx(0);
    setEntryShuffle(null);
    setView("flow");
    setDeleted(new Set());
    setNote("");
  }, [date]);

  const total = pages.length;

  // --- Flow-mode page stepping (unchanged). ---
  function step(dir) {
    if (shuffle) return; // ignore input mid-animation so pages can't desync
    const target = dir === "fwd" ? index + 1 : index - 1;
    if (target < 0 || target >= total) return;
    const commit = () => {
      setIndex(target);
      setShuffle(null);
    };
    if (reduceMotion.current) {
      commit();
      return;
    }
    setShuffle(dir);
    setTimeout(commit, SHUFFLE_MS + 40);
  }

  // Entries still present (not deleted this session).
  const liveEntries = useMemo(
    () => (entries || []).filter((e) => !deleted.has(e.name)),
    [entries, deleted]
  );

  // Keep the by-entry cursor in range as entries are deleted.
  useEffect(() => {
    if (entryIdx > liveEntries.length - 1) {
      setEntryIdx(Math.max(0, liveEntries.length - 1));
    }
  }, [liveEntries.length, entryIdx]);

  // --- By-entry stepping: shuffle to the adjacent entry. ---
  function stepEntry(dir) {
    if (entryShuffle) return;
    const target = dir === "fwd" ? entryIdx + 1 : entryIdx - 1;
    if (target < 0 || target >= liveEntries.length) return;
    const commit = () => {
      setEntryIdx(target);
      setEntryShuffle(null);
    };
    if (reduceMotion.current) {
      commit();
      return;
    }
    setEntryShuffle(dir);
    setTimeout(commit, SHUFFLE_MS + 40);
  }

  // Keyboard: Esc closes; ←/→ step the active view.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowRight") view === "flow" ? step("fwd") : stepEntry("fwd");
      else if (e.key === "ArrowLeft")
        view === "flow" ? step("back") : stepEntry("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function onDeleteEntry(name) {
    if (!confirm(`Move ${name} to the bin? (soft delete — recoverable)`)) return;
    const { body } = await deleteEntry(date, name);
    if (!body.ok) {
      setNote(`delete failed: ${body.error || "unknown error"}`);
      return;
    }
    const next = new Set(deleted);
    next.add(name);
    // Nothing left → exit to the calendar.
    const remaining = (entries || []).filter((e) => !next.has(e.name));
    if (remaining.length === 0) {
      onChanged?.();
      onClose();
      return;
    }
    // Land on a valid entry in the SAME update so the reader never flashes blank.
    // Deleting shifts later entries left, so keeping entryIdx shows the "next"
    // entry; clamping to the new last index falls back to the previous one when
    // we just removed the final entry.
    setDeleted(next);
    setEntryIdx(Math.min(entryIdx, remaining.length - 1));
    setEntryShuffle(null);
    setNote(`moved ${name} to the bin`);
    onChanged?.();
  }

  const cur = pages[index];
  // Guard against a transient out-of-range index (defensive; delete keeps it valid).
  const curEntry = liveEntries[Math.min(entryIdx, liveEntries.length - 1)];

  return (
    <div className="overlay" onClick={onClose}>
      {/* Stop propagation so clicks on the card/controls don't close. */}
      <div
        className={`overlay-stage ${view === "by-entry" ? "by-entry" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="overlay-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="overlay-head">
          <strong>{date}</strong>
          <div className="overlay-viewtoggle">
            <button
              className={view === "flow" ? "active" : ""}
              onClick={() => setView("flow")}
            >
              Flow
            </button>
            <button
              className={view === "by-entry" ? "active" : ""}
              onClick={() => setView("by-entry")}
            >
              By entry
            </button>
          </div>
          {note && <span className="status">{note}</span>}
        </div>

        {view === "flow" ? (
          <>
            {/* .book-scaler shrinks the flow page to fit a phone (visual only). */}
            <div className="book-scaler book-scaler--single">
            <div className="book single overlay-book">
              {entries && cur ? (
                <div
                  className={`shuffle ${shuffle ? `shuffle-${shuffle}` : ""}`}
                >
                  <Page page={cur} entriesFor={() => entries} />
                </div>
              ) : (
                <div className="page">
                  <div className="page-inner">
                    <p className="empty">Loading {date}…</p>
                  </div>
                </div>
              )}
            </div>
            </div>

            <div className="overlay-controls">
              <button
                onClick={() => step("back")}
                disabled={index <= 0 || !!shuffle}
              >
                ◂ Prev
              </button>
              <span className="status">
                {total ? `page ${index + 1} of ${total}` : ""}
              </span>
              <button
                onClick={() => step("fwd")}
                disabled={index >= total - 1 || !!shuffle}
              >
                Next ▸
              </button>
            </div>
          </>
        ) : (
          <div className="overlay-byentry">
            {/* Entry reader: ONE entry in full, shuffling to the next. */}
            <div className="entry-column">
              {!entries ? (
                <p className="empty">Loading {date}…</p>
              ) : liveEntries.length === 0 ? (
                <p className="empty">No entries left for {date}.</p>
              ) : (
                <>
                  <div className="entry-stage">
                    <div
                      className={`shuffle ${
                        entryShuffle ? `shuffle-${entryShuffle}` : ""
                      }`}
                      key={curEntry.name}
                    >
                      <div className="entry-card">
                        <div className="entry-card-head">
                          <code>{curEntry.name.replace(/\.md$/, "")}</code>
                          <EntryMeta meta={curEntry.meta} />
                          <button
                            className="danger"
                            onClick={() => onDeleteEntry(curEntry.name)}
                          >
                            Delete
                          </button>
                        </div>
                        <div className="entry-card-body">
                          {/* The card header already shows #topic via EntryMeta,
                              so suppress the in-flow chip here to avoid doubling. */}
                          <DayFlow entries={[curEntry]} showTopics={false} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overlay-controls">
                    <button
                      onClick={() => stepEntry("back")}
                      disabled={entryIdx <= 0 || !!entryShuffle}
                    >
                      ◂ Prev
                    </button>
                    <span className="status">
                      entry {entryIdx + 1} of {liveEntries.length}
                    </span>
                    <button
                      onClick={() => stepEntry("fwd")}
                      disabled={
                        entryIdx >= liveEntries.length - 1 || !!entryShuffle
                      }
                    >
                      Next ▸
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Independent image side panel (its own scroll). */}
            <aside className="entry-images">
              <div className="drawer-head">
                <strong>Images · {date}</strong>
              </div>
              {/* Reuses the orphan-cleanup panel; its Delete is already soft and
                  deliberately leaves any ![]() reference intact. */}
              <Resources fixedDate={date} onDeleted={onChanged} />
            </aside>
          </div>
        )}
      </div>

      {/* Hidden measuring pass owned by useDayPages (flow pagination). */}
      {measureHost}
    </div>
  );
}
