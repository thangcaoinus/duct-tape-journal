import { useEffect, useState } from "react";
import {
  sentimentStatus,
  backfillSentiment,
  rescoreSentiment,
} from "./api.js";

// The "Tools" tab: maintenance actions on the archive. Two sentiment actions:
//  • Analyze (backfill) — scores only entries with NO sentiment yet; the narrow
//    exception to "stamped once at finalize" (fills a gap, never re-scores).
//  • Rescore all — re-scores EVERY entry, overwriting existing sentiments (e.g.
//    to replace old lexicon scores with the neural model). Deliberate bulk
//    restamp, so it asks for confirmation first.
// Both live behind the model being available and share a busy guard so only one
// runs at a time. See the server's /api/sentiment/backfill|rescore notes.
export default function Tools({ onChanged }) {
  const [available, setAvailable] = useState(null); // null = checking
  const [busy, setBusy] = useState(""); // "" | "backfill" | "rescore"
  const [note, setNote] = useState("");

  useEffect(() => {
    sentimentStatus().then(setAvailable);
  }, []);

  async function run(kind, fn) {
    setBusy(kind);
    setNote(
      kind === "rescore"
        ? "rescoring every entry…"
        : "analyzing… (first run may download the model)"
    );
    const { body } = await fn();
    setBusy("");
    if (body.offline) {
      setAvailable(false);
      setNote("");
    } else if (body.ok) {
      const { scored, alreadyScored, skipped } = body;
      setNote(
        `${scored} entr${scored === 1 ? "y" : "ies"} scored · ` +
          `${alreadyScored} left as-is · ${skipped} skipped`
      );
      if (scored > 0) onChanged?.(); // refresh Read/Calendar so tags update
    } else {
      setNote(`failed: ${body.error || "unknown error"}`);
    }
  }

  function onRescore() {
    if (
      !window.confirm(
        "Re-score every finalized entry, overwriting existing sentiments? " +
          "This restamps old scores with the current model — it never touches " +
          "your prose. Continue?"
      )
    )
      return;
    run("rescore", rescoreSentiment);
  }

  const disabled = busy !== "" || available === false || available === null;

  return (
    <div className="bin-pane">
      <div className="page-header">
        <h2>Tools</h2>
        <span className="page-sub">Maintenance actions for your archive.</span>
        <div className="page-rule" />
      </div>

      <section className="bin-group">
        <ul className="resource-list">
          <li className="resource">
            <div className="resource-meta">
              <code className="resource-name">Analyze unanalyzed entries</code>
              <span className="resource-tag" style={{ display: "block" }}>
                Scores any finalized entry that has no sentiment yet · existing
                scores left untouched
              </span>
            </div>
            <div className="resource-actions">
              <button
                className="btn-primary"
                onClick={() => run("backfill", backfillSentiment)}
                disabled={disabled}
              >
                {busy === "backfill" ? "Analyzing…" : "Analyze"}
              </button>
            </div>
          </li>

          <li className="resource">
            <div className="resource-meta">
              <code className="resource-name">Rescore all entries</code>
              <span className="resource-tag" style={{ display: "block" }}>
                Re-scores every finalized entry, overwriting existing sentiments
                (e.g. to replace old lexicon scores) · never touches your prose
              </span>
            </div>
            <div className="resource-actions">
              <button
                className="btn-secondary"
                onClick={onRescore}
                disabled={disabled}
              >
                {busy === "rescore" ? "Rescoring…" : "Rescore all"}
              </button>
            </div>
          </li>
        </ul>

        {note ? (
          <span
            className="resource-tag"
            style={{ display: "block", marginTop: "var(--s-2)" }}
          >
            {note}
          </span>
        ) : null}
        {available === false ? (
          <span
            className="resource-tag"
            style={{ display: "block", marginTop: "var(--s-2)" }}
          >
            Sentiment model unavailable — you appear to be offline, or the model
            hasn't been downloaded yet. Reconnect once to fetch it; after that it
            runs offline.
          </span>
        ) : null}
      </section>
    </div>
  );
}
