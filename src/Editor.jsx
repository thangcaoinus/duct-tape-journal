import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Mathematics from "@tiptap/extension-mathematics";
import { Markdown } from "tiptap-markdown";
import { today } from "./lib/date.js";
import {
  loadDraft,
  saveDraft,
  finalize,
  uploadImage,
  loadTopics,
} from "./api.js";
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

// Drawn, single-stroke formatting icons for the selection bubble menu — mirrors
// the rail's inline-SVG convention (App.jsx), never glyphs/emoji. Color + active
// state flow through `currentColor`; the svg is decorative (button carries the
// aria-label), so it's aria-hidden.
const FMT_ICON = {
  bold: (
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  ),
  italic: <path d="M14 5h-4M14 19h-4M15 5l-4 14" />,
  heading: <path d="M6 5v14M18 5v14M6 12h12" />,
  bullet: (
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  ),
  ordered: <path d="M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M4.5 15.5h1.5v1.5H4v1.5h2" />,
  quote: (
    <path d="M7 7c-1.7 0-3 1.3-3 3s1.3 3 3 3c0 2-1 3-3 3M17 7c-1.7 0-3 1.3-3 3s1.3 3 3 3c0 2-1 3-3 3" />
  ),
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
};

function FmtIcon({ name }) {
  return (
    <svg className="fmt-icon" viewBox="0 0 24 24" aria-hidden="true">
      {FMT_ICON[name]}
    </svg>
  );
}

export default function Editor({ onFinalized, onDrawerToggle }) {
  const date = today();
  const editorRef = useRef(null);
  const saveTimer = useRef(null);
  const [status, setStatus] = useState("");
  const [currentMath, setCurrentMath] = useState("");
  const [topic, setTopic] = useState(""); // subject-line topic for this entry
  const topicRef = useRef(""); // live value for the debounced autosave closure
  const [topics, setTopics] = useState([]); // suggestions from past finalizes
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bump on open so the drawer reloads (e.g. an image pasted since last time).
  const [drawerKey, setDrawerKey] = useState(0);

  // Tell the app shell whether the drawer is open so the Write pane can widen to
  // fit the side panel; clear it when the editor unmounts (tab switch).
  useEffect(() => {
    onDrawerToggle?.(drawerOpen);
    return () => onDrawerToggle?.(false);
  }, [drawerOpen, onDrawerToggle]);

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
        await saveDraft(
          date,
          editor.storage.markdown.getMarkdown(),
          topicRef.current
        );
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

  // Load today's draft (body + topic) and the topic suggestions on mount.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    (async () => {
      const { markdown, topic: savedTopic } = await loadDraft(date);
      if (cancelled) return;
      if (markdown) editor.commands.setContent(markdown);
      setTopic(savedTopic);
      topicRef.current = savedTopic;
    })();
    loadTopics().then((t) => !cancelled && setTopics(t));
    return () => {
      cancelled = true;
      clearTimeout(saveTimer.current);
    };
  }, [editor, date]);

  // Autosave the topic on change (debounced alongside the body). A topic is one
  // continuous word; strip anything else as the user types.
  function onTopicChange(e) {
    const t = (e.target.value.match(/\w+/)?.[0] ?? "").toLowerCase();
    setTopic(t);
    topicRef.current = t;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus("saving…");
      await saveDraft(
        date,
        editorRef.current?.storage.markdown.getMarkdown() ?? "",
        t
      );
      setStatus("saved");
    }, AUTOSAVE_MS);
  }

  async function onFinalize() {
    if (!editor) return;
    // Flush any pending autosave first so finalize sees the latest text + topic.
    clearTimeout(saveTimer.current);
    await saveDraft(date, editor.storage.markdown.getMarkdown(), topicRef.current);
    const { status: code, body } = await finalize(date);
    if (body.ok) {
      editor.commands.setContent(""); // clear to a blank today for entry-N+1
      setTopic("");
      topicRef.current = "";
      loadTopics().then(setTopics); // a just-used new topic now suggests
      onFinalized?.(); // tell the app an entry changed so Read re-measures
      setStatus(`finalized ${body.entry}`);
    } else {
      setStatus(`finalize failed (${code}): ${body.error}`);
    }
  }

  return (
    <div className="editor-pane">
      <div className="page-header">
        <h2>Today</h2>
        <span className="page-sub">{date} · autosaves as you write</span>
        <div className="page-rule" />
      </div>

      <div className="toolbar">
        <input
          className="topic-input"
          type="text"
          list="topic-suggestions"
          placeholder="topic…"
          value={topic}
          onChange={onTopicChange}
          aria-label="Entry topic (one word)"
        />
        <datalist id="topic-suggestions">
          {topics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <button className="btn-primary" onClick={onFinalize}>
          Finalize
        </button>
        <button
          className="drawer-toggle btn-ghost"
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
          {editor && (
            <BubbleMenu
              editor={editor}
              className="bubble-menu"
              updateDelay={0}
              tippyOptions={{ duration: 120 }}
            >
              <button
                type="button"
                aria-label="Bold"
                title="Bold"
                className={editor.isActive("bold") ? "is-active" : ""}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <FmtIcon name="bold" />
              </button>
              <button
                type="button"
                aria-label="Italic"
                title="Italic"
                className={editor.isActive("italic") ? "is-active" : ""}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <FmtIcon name="italic" />
              </button>
              <button
                type="button"
                aria-label="Inline code"
                title="Inline code"
                className={editor.isActive("code") ? "is-active" : ""}
                onClick={() => editor.chain().focus().toggleCode().run()}
              >
                <FmtIcon name="code" />
              </button>
              <span className="bubble-sep" aria-hidden="true" />
              <button
                type="button"
                aria-label="Heading"
                title="Heading"
                className={editor.isActive("heading", { level: 2 }) ? "is-active" : ""}
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                <FmtIcon name="heading" />
              </button>
              <button
                type="button"
                aria-label="Bullet list"
                title="Bullet list"
                className={editor.isActive("bulletList") ? "is-active" : ""}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <FmtIcon name="bullet" />
              </button>
              <button
                type="button"
                aria-label="Numbered list"
                title="Numbered list"
                className={editor.isActive("orderedList") ? "is-active" : ""}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <FmtIcon name="ordered" />
              </button>
              <button
                type="button"
                aria-label="Quote"
                title="Quote"
                className={editor.isActive("blockquote") ? "is-active" : ""}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              >
                <FmtIcon name="quote" />
              </button>
            </BubbleMenu>
          )}
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
