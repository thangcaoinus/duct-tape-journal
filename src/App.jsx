import { useState } from "react";
import Editor from "./Editor.jsx";
import Reader from "./Reader.jsx";
import Calendar from "./Calendar.jsx";
import Bin from "./Bin.jsx";

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
