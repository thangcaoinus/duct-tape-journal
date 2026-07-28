import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import { Markdown } from "tiptap-markdown";
import { today } from "./lib/date.js";
import { loadDay } from "./api.js";

// Render one finalized entry read-only. Reuses TipTap so markdown + math +
// images render identically to how they were written.
function Entry({ markdown }) {
  const editor = useEditor({
    editable: false,
    content: markdown,
    extensions: [
      StarterKit,
      Image,
      Mathematics,
      Markdown.configure({ html: false }),
    ],
  });
  useEffect(() => {
    if (editor) editor.commands.setContent(markdown);
  }, [editor, markdown]);
  return <EditorContent editor={editor} className="prose" />;
}

export default function Reader() {
  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    let cancelled = false;
    loadDay(date).then((e) => {
      if (!cancelled) setEntries(e);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="reader-pane">
      <div className="toolbar">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <span className="status">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="empty">No finalized entries for {date}.</p>
      ) : (
        entries.map((entry) => (
          <article key={entry.name} className="entry">
            <h3 className="entry-name">{entry.name}</h3>
            <Entry markdown={entry.markdown} />
          </article>
        ))
      )}
    </div>
  );
}
