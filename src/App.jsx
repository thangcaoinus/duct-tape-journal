import { useState } from "react";
import Editor from "./Editor.jsx";
import Reader from "./Reader.jsx";
import Calendar from "./Calendar.jsx";
import Bin from "./Bin.jsx";

export default function App() {
  // Boots to write mode (today's editor). A plain toggle flips modes.
  const [mode, setMode] = useState("write");

  // The calendar wants the full width; other modes keep the narrow column.
  return (
    <div className={`app ${mode === "calendar" ? "app-wide" : ""}`}>
      <header className="app-header">
        <h1>Duct-Tape Diary</h1>
        <nav>
          <button
            className={mode === "write" ? "active" : ""}
            onClick={() => setMode("write")}
          >
            Write
          </button>
          <button
            className={mode === "read" ? "active" : ""}
            onClick={() => setMode("read")}
          >
            Read
          </button>
          <button
            className={mode === "calendar" ? "active" : ""}
            onClick={() => setMode("calendar")}
          >
            Calendar
          </button>
          <button
            className={mode === "bin" ? "active" : ""}
            onClick={() => setMode("bin")}
          >
            Tore
          </button>
        </nav>
      </header>
      <main>
        {mode === "write" && <Editor />}
        {mode === "read" && <Reader />}
        {mode === "calendar" && <Calendar />}
        {mode === "bin" && <Bin />}
      </main>
    </div>
  );
}
