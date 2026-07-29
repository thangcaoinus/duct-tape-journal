import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import { Markdown } from "tiptap-markdown";
import { today } from "./lib/date.js";
import { loadDraft, saveDraft, finalize, uploadImage } from "./api.js";
import MathHelper from "./MathHelper.jsx";
import Resources from "./Resources.jsx";

const AUTOSAVE_MS = 800;

// Given the plain text of the block the cursor is in and the cursor's offset
// within it, return the LaTeX (without $) the cursor sits inside, or "".
// Finds the nearest unescaped $ before and after the cursor on the same block.
function mathAtCursor(text, offset) {
  if (!text) return "";
  const before = text.lastIndexOf("$", offset - 1);
  if (before === -1) return "";
  const after = text.indexOf("$", offset);
  if (after === -1) return "";
  // Count $ before the opening one: an odd count means we're already outside
  // a closed pair (i.e. between spans), so don't treat this as "inside".
  const dollarsBefore = (text.slice(0, before).match(/\$/g) || []).length;
  if (dollarsBefore % 2 !== 0) return "";
  return text.slice(before + 1, after);
}

export default function Editor() {
  const date = today();
  const editorRef = useRef(null);
  const saveTimer = useRef(null);
  const [status, setStatus] = useState("");
  const [currentMath, setCurrentMath] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bump on open so the drawer reloads (e.g. an image pasted since last time).
  const [drawerKey, setDrawerKey] = useState(0);

  // Insert an existing resource straight into the editor at the cursor.
  function insertResource(r) {
    editorRef.current?.chain().focus().setImage({ src: r.url }).run();
    setStatus(`inserted ${r.name}`);
  }

  function toggleDrawer() {
    setDrawerOpen((open) => {
      if (!open) setDrawerKey((k) => k + 1); // refresh list on open
      return !open;
    });
  }

  // Upload then insert AFTER the async resolves — capture editor via ref.
  function handleImageFiles(files) {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    (async () => {
      for (const f of images) {
        try {
          const url = await uploadImage(date, f);
          editorRef.current?.chain().focus().setImage({ src: url }).run();
        } catch (e) {
          setStatus(`image upload failed: ${e.message}`);
        }
      }
    })();
    return true;
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Mathematics,
      Markdown.configure({ html: false }),
    ],
    editorProps: {
      handlePaste(view, event) {
        // 1. Pasted image FILES (screenshot, copied image) -> upload + insert.
        const files = event.clipboardData?.files || [];
        if ([...files].some((f) => f.type.startsWith("image/"))) {
          event.preventDefault();
          return handleImageFiles(files);
        }
        // 2. Pasted TEXT that is a markdown image ref (e.g. from "Copy ref")
        //    -> insert a real image node so it renders instead of staying text.
        const text = event.clipboardData?.getData("text/plain") || "";
        const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
        const imgMatches = [...text.matchAll(imgRe)];
        // Only convert when the paste is *just* image refs (ignoring whitespace),
        // so prose that merely mentions ![]() isn't hijacked.
        const isPureImages =
          imgMatches.length > 0 && text.replace(imgRe, "").trim() === "";
        if (isPureImages) {
          event.preventDefault();
          let chain = editorRef.current?.chain().focus();
          for (const m of imgMatches) chain = chain.setImage({ src: m[1] });
          chain?.run();
          return true;
        }
        return false;
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files || [];
        if (![...files].some((f) => f.type.startsWith("image/"))) return false;
        event.preventDefault();
        return handleImageFiles(files);
      },
    },
    onUpdate({ editor }) {
      // Debounced autosave. Enter is a newline — never save-on-Enter.
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setStatus("saving…");
        await saveDraft(date, editor.storage.markdown.getMarkdown());
        setStatus("saved");
      }, AUTOSAVE_MS);
    },
    onSelectionUpdate({ editor }) {
      // Detect whether the cursor sits inside a $...$ span for the live hint.
      const { $from, empty } = editor.state.selection;
      if (!empty || !$from.parent.isTextblock) {
        setCurrentMath("");
        return;
      }
      setCurrentMath(mathAtCursor($from.parent.textContent, $from.parentOffset));
    },
  });

  // Keep a live ref to the editor for the async image insert.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Load today's draft on mount.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    (async () => {
      const md = await loadDraft(date);
      if (!cancelled && md) editor.commands.setContent(md);
    })();
    return () => {
      cancelled = true;
      clearTimeout(saveTimer.current);
    };
  }, [editor, date]);

  async function onFinalize() {
    if (!editor) return;
    // Flush any pending autosave first so finalize sees the latest text.
    clearTimeout(saveTimer.current);
    await saveDraft(date, editor.storage.markdown.getMarkdown());
    const { status: code, body } = await finalize(date);
    if (body.ok) {
      editor.commands.setContent(""); // clear to a blank today for entry-N+1
      setStatus(`finalized ${body.entry}`);
    } else {
      setStatus(`finalize failed (${code}): ${body.error}`);
    }
  }

  return (
    <div className="editor-pane">
      <div className="toolbar">
        <span className="date">{date}</span>
        <button onClick={onFinalize}>Finalize</button>
        <button
          className="drawer-toggle"
          onClick={toggleDrawer}
          aria-expanded={drawerOpen}
        >
          Images {drawerOpen ? "▸" : "◂"}
        </button>
        <span className="status">{status}</span>
      </div>
      {/* Editor and the resource drawer sit side by side inside the pane, so
          the drawer reads as part of this tab — no overlay, no dimming. */}
      <div className={`editor-body ${drawerOpen ? "drawer-open" : ""}`}>
        <div className="editor-main">
          <EditorContent editor={editor} className="prose" />
          <MathHelper currentMath={currentMath} />
        </div>

        <aside className="drawer" aria-hidden={!drawerOpen}>
          <div className="drawer-head">
            <strong>Images · {date}</strong>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)}>
              ✕
            </button>
          </div>
          <Resources
            fixedDate={date}
            refreshKey={drawerKey}
            onInsert={insertResource}
          />
        </aside>
      </div>
    </div>
  );
}
