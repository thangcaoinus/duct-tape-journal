import { useEffect, useState } from "react";
import Editor from "./Editor.jsx";
import Reader from "./Reader.jsx";
import Calendar from "./Calendar.jsx";
import Concepts from "./Concepts.jsx";
import Bin from "./Bin.jsx";
import { onOpenConcept } from "./lib/concepts.jsx";

// A small, single-stroke icon set for the rail. Drawn inline (not emoji/glyphs)
// so the whole nav shares one weight and cap style. currentColor + CSS stroke.
const Icon = {
  write: (
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" />
  ),
  read: (
    <>
      <path d="M12 5.5C10.5 4.5 8 4 6 4H3v13h3c2 0 4.5.5 6 1.5" />
      <path d="M12 5.5C13.5 4.5 16 4 18 4h3v13h-3c-2 0-4.5.5-6 1.5" />
      <path d="M12 5.5v13" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M8 3v3M16 3v3" />
    </>
  ),
  concepts: (
    <>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="17" cy="6" r="2.2" />
      <circle cx="12" cy="17" r="2.2" />
      <path d="M7.6 8.6 10.6 15M15.3 7.7 12.9 15M8 7.2l6.8-.9" />
    </>
  ),
  tore: (
    <>
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    </>
  ),
};

function RailIcon({ name }) {
  return (
    <svg className="rail-icon" viewBox="0 0 24 24" aria-hidden="true">
      {Icon[name]}
    </svg>
  );
}

export default function App() {
  // Boots to write mode (today's editor). The rail flips modes.
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

  // The Write pane widens while the editor's resource drawer is open so the
  // drawer sits beside the editor in-flow (Editor owns the toggle; it reports up).
  const [writeOpen, setWriteOpen] = useState(false);

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

  // Calendar + Read get the wider content bound within the same shell.
  const wide = mode === "calendar" || mode === "read";

  return (
    <div className="app-shell">
      {/* App masthead: the wordmark spans the whole app, above the rail + content.
          Keeps the serif identity in one fixed place instead of crammed into the
          nav rail — the rail below is now pure navigation. */}
      <header className="masthead">
        <span className="masthead-brand">Duct-Tape Diary</span>
        <span className="masthead-sub">a local diary</span>
      </header>

      <nav className="rail" aria-label="Primary">
        <div className="rail-nav">
          <span className="rail-group-label">Write</span>
          <RailLink id="write" mode={mode} onGo={go} icon="write" label="Write" />

          <span className="rail-group-label">Review</span>
          <RailLink id="read" mode={mode} onGo={go} icon="read" label="Read" />
          <RailLink
            id="calendar"
            mode={mode}
            onGo={go}
            icon="calendar"
            label="Calendar"
          />
          <RailLink
            id="concepts"
            mode={mode}
            onGo={go}
            icon="concepts"
            label="Concepts"
          />

          <span className="rail-group-label">Recover</span>
          <RailLink id="bin" mode={mode} onGo={go} icon="tore" label="Tore" />
        </div>
      </nav>

      <div className="app-content">
        <main
          className={`app ${wide ? "app-wide" : ""} ${
            mode === "write" && writeOpen ? "write-open" : ""
          }`}
        >
          {/* The one authored motion moment: switching tabs settles the fresh
              page up+in, like turning to a new leaf. Keyed on `mode` so React
              remounts it each switch and the CSS animation replays. The Reader is
              excluded (kept mounted; it has its own page-flip motion). Honors
              prefers-reduced-motion in CSS. */}
          {mode !== "read" && (
            <div className="page-turn" key={mode}>
              {mode === "write" && (
                <Editor onFinalized={bumpData} onDrawerToggle={setWriteOpen} />
              )}
              {mode === "calendar" && <Calendar onChanged={bumpData} />}
              {/* Concepts is self-contained — it links entries but doesn't affect
                  Read pagination, so it needs no dataVersion wiring. */}
              {mode === "concepts" && <Concepts openTarget={conceptTarget} />}
              {mode === "bin" && <Bin onChanged={bumpData} />}
            </div>
          )}

          {/* Reader stays mounted once opened; hidden off-screen when inactive so
              it keeps its loaded/measured state and never re-runs the measure pass
              on a tab switch. `active` lets it pause measuring while hidden. */}
          {readerMounted && (
            <div className={mode === "read" ? "" : "pane-hidden"}>
              <Reader active={mode === "read"} dataVersion={dataVersion} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function RailLink({ id, mode, onGo, icon, label }) {
  return (
    <button
      className={`rail-link ${mode === id ? "active" : ""}`}
      aria-current={mode === id ? "page" : undefined}
      onClick={() => onGo(id)}
    >
      <RailIcon name={icon} />
      {label}
    </button>
  );
}
