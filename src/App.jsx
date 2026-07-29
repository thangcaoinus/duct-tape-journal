import { useState } from "react";
import Editor from "./Editor.jsx";
import Reader from "./Reader.jsx";

export default function App() {
  // Boots to write mode (today's editor). A plain toggle flips to read mode.
  const [mode, setMode] = useState("write");

  return (
    <div className="app">
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
        </nav>
      </header>
      <main>
        {mode === "write" && <Editor />}
        {mode === "read" && <Reader />}
      </main>
    </div>
  );
}
