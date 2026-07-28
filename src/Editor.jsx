import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import { Markdown } from "tiptap-markdown";
import { today } from "./lib/date.js";
import { loadDraft, saveDraft, finalize, uploadImage } from "./api.js";
import MathHelper from "./MathHelper.jsx";

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
        const files = event.clipboardData?.files || [];
        if (![...files].some((f) => f.type.startsWith("image/"))) return false;
        event.preventDefault();
        return handleImageFiles(files);
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
        <span className="status">{status}</span>
      </div>
      <EditorContent editor={editor} className="prose" />
      <MathHelper currentMath={currentMath} />
    </div>
  );
}
