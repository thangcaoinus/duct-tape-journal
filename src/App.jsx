import { useEffect, useState } from "react";
import Editor from "./Editor.jsx";
import Reader from "./Reader.jsx";
import Calendar from "./Calendar.jsx";
import Concepts from "./Concepts.jsx";
import Bin from "./Bin.jsx";
import { onOpenConcept } from "./lib/concepts.jsx";

export default function App() {
  // Boots to write mode (today's editor). A plain toggle flips modes.
  const [mode, setMode] = useState("write");

  // The Reader is expensive to build (it loads every day and measures pagination
  // off-screen). We keep it MOUNTED across tab switches so it renders + measures
  // ONCE, instead of reloading every time Read is opened. It's mounted lazily on
  // the first Read visit, then hidden (kept in the layout, moved off-screen so its
  // measuring still has real geometry) when another tab is active.
  const [readerMounted, setReaderMounted] = useState(false);

  // Bumped whenever an entry changes (finalize / delete / restore) so the still-
  // mounted Reader knows to drop its caches and re-measure. A plain tab switch does
  // NOT bump this — only real edits do.
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = () => setDataVersion((v) => v + 1);

  // Clicking a highlighted concept word (in any read view) jumps to that concept's
  // page. `conceptTarget` bumps a nonce so re-clicking the SAME slug re-opens it
  // even if we're already on the Concepts tab.
  const [conceptTarget, setConceptTarget] = useState(null); // {slug, nonce} | null
  useEffect(
    () =>
      onOpenConcept((slug) => {
        setConceptTarget({ slug, nonce: Date.now() });
        setMode("concepts");
      }),
    []
  );

  function go(next) {
    if (next === "read") setReaderMounted(true);
    setMode(next);
  }

  return (
    <div className={`app ${mode === "calendar" ? "app-wide" : ""}`}>
      <header className="app-header">
        <h1>Duct-Tape Diary</h1>
        <nav>
          <button
            className={mode === "write" ? "active" : ""}
            onClick={() => go("write")}
          >
            Write
          </button>
          <button
            className={mode === "read" ? "active" : ""}
            onClick={() => go("read")}
          >
            Read
          </button>
          <button
            className={mode === "calendar" ? "active" : ""}
            onClick={() => go("calendar")}
          >
            Calendar
          </button>
          <button
            className={mode === "concepts" ? "active" : ""}
            onClick={() => go("concepts")}
          >
            Concepts
          </button>
          <button
            className={mode === "bin" ? "active" : ""}
            onClick={() => go("bin")}
          >
            Tore
          </button>
        </nav>
      </header>
      <main>
        {mode === "write" && <Editor onFinalized={bumpData} />}
        {mode === "calendar" && <Calendar onChanged={bumpData} />}
        {/* Concepts is self-contained — it links entries but doesn't affect Read
            pagination, so it needs no dataVersion wiring. */}
        {mode === "concepts" && <Concepts openTarget={conceptTarget} />}
        {mode === "bin" && <Bin onChanged={bumpData} />}

        {/* Reader stays mounted once opened; hidden off-screen when inactive so it
            keeps its loaded/measured state and never re-runs the measure pass on a
            tab switch. `active` lets it pause measuring while hidden. */}
        {readerMounted && (
          <div className={mode === "read" ? "" : "pane-hidden"}>
            <Reader active={mode === "read"} dataVersion={dataVersion} />
          </div>
        )}
      </main>
    </div>
  );
}
