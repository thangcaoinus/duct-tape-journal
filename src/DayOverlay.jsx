import { useEffect, useRef, useState } from "react";
import { Page, useDayPages } from "./lib/pages.jsx";

const SHUFFLE_MS = 560; // keep in sync with the .shuffle transition in CSS

// Full-screen overlay that reads ONE day's pages one at a time as a shuffling
// card, over a dimmed backdrop (the calendar stays mounted, faded, behind it).
// Prev/Next step pages; ✕ / Esc / backdrop-click close. Reuses the shared page
// rendering + pagination so a day paginates exactly like Read mode.
export default function DayOverlay({ date, onClose }) {
  const { pages, entries, measureHost } = useDayPages(date);
  const [index, setIndex] = useState(0);
  const [shuffle, setShuffle] = useState(null); // 'fwd' | 'back' | null

  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  // Reset to the first page whenever the day changes.
  useEffect(() => {
    setIndex(0);
    setShuffle(null);
  }, [date]);

  const total = pages.length;

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

  // Keyboard: Esc closes, ←/→ step.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step("fwd");
      else if (e.key === "ArrowLeft") step("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cur = pages[index];

  return (
    <div className="overlay" onClick={onClose}>
      {/* Stop propagation so clicks on the card/controls don't close. */}
      <div className="overlay-stage" onClick={(e) => e.stopPropagation()}>
        <button className="overlay-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="book single overlay-book">
          {entries && cur ? (
            <div className={`shuffle ${shuffle ? `shuffle-${shuffle}` : ""}`}>
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

        <div className="overlay-controls">
          <button onClick={() => step("back")} disabled={index <= 0 || !!shuffle}>
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
      </div>

      {/* Hidden measuring pass owned by useDayPages. */}
      {measureHost}
    </div>
  );
}
