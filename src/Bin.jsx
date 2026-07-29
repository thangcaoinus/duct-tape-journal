import { useEffect, useState } from "react";
import { loadTrash, loadTrashEntry, restoreTrash } from "./api.js";
import { DayFlow } from "./lib/pages.jsx";

// The "Tore" tab: recoverable soft-deletes. Lists deleted entries and images
// (autosave drafts are hidden by the server) and restores each straight back to
// its original place. Restore never overwrites: if the original slot was retaken
// (e.g. you deleted the newest entry, then finalized a new one in its number),
// the server refuses with 409 and the item stays here — surfaced as a message.
export default function Bin() {
  const [items, setItems] = useState(null); // null = loading
  const [note, setNote] = useState("");

  function refresh() {
    loadTrash().then(setItems);
  }
  useEffect(refresh, []);

  async function onRestore(item) {
    const { status, body } = await restoreTrash(item.id);
    if (body.ok) {
      setItems((list) => (list || []).filter((i) => i.id !== item.id));
      setNote(`restored ${item.name} to ${item.date}`);
    } else if (status === 409) {
      setNote(
        `can't restore ${item.name} — ${item.date} already has that slot. ` +
          `Ditch it or free the slot first.`
      );
    } else {
      setNote(`restore failed: ${body.error || "unknown error"}`);
    }
  }

  const entries = (items || []).filter((i) => i.kind === "entry");
  const images = (items || []).filter((i) => i.kind === "resource");
  const fmtWhen = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "");

  return (
    <div className="bin-pane">
      <div className="toolbar">
        <span className="status">
          {items === null
            ? "loading…"
            : `${items.length} recoverable item${items.length === 1 ? "" : "s"}`}
        </span>
        <span className="status">{note}</span>
      </div>

      {items !== null && items.length === 0 ? (
        <p className="empty">The bin is empty.</p>
      ) : (
        <>
          {entries.length > 0 && (
            <section className="bin-group">
              <h3>Entries</h3>
              <ul className="resource-list">
                {entries.map((it) => (
                  <BinEntry key={it.id} item={it} onRestore={onRestore} fmtWhen={fmtWhen} />
                ))}
              </ul>
            </section>
          )}

          {images.length > 0 && (
            <section className="bin-group">
              <h3>Images</h3>
              <ul className="resource-list">
                {images.map((it) => (
                  <li key={it.id} className="resource">
                    <img
                      src={it.url}
                      alt={it.name}
                      className="resource-thumb"
                    />
                    <div className="resource-meta">
                      <code className="resource-name">
                        {it.date} · {it.name}
                      </code>
                      <span className="resource-tag">
                        deleted {fmtWhen(it.deletedAt)}
                      </span>
                    </div>
                    <div className="resource-actions">
                      <button onClick={() => onRestore(it)}>Restore</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// One deleted-entry row with an expandable read-only preview of its content, so
// you can see what you're about to restore. Markdown is fetched lazily on first
// expand and rendered via the shared DayFlow (same look as the reader).
function BinEntry({ item, onRestore, fmtWhen }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState(null); // null until first fetched

  function togglePreview() {
    if (!open && markdown === null) {
      loadTrashEntry(item.id).then((md) => setMarkdown(md));
    }
    setOpen((o) => !o);
  }

  return (
    <li className="resource bin-entry">
      <div className="bin-entry-row">
        <div className="resource-meta">
          <code className="resource-name">
            {item.date} · {item.name.replace(/\.md$/, "")}
          </code>
          <span className="resource-tag">deleted {fmtWhen(item.deletedAt)}</span>
        </div>
        <div className="resource-actions">
          <button onClick={togglePreview}>{open ? "Hide" : "Preview"}</button>
          <button onClick={() => onRestore(item)}>Restore</button>
        </div>
      </div>
      {open && (
        <div className="bin-preview">
          {markdown === null ? (
            <p className="empty">Loading preview…</p>
          ) : markdown.trim() === "" ? (
            <p className="empty">(empty entry)</p>
          ) : (
            <DayFlow entries={[{ name: item.name, markdown }]} />
          )}
        </div>
      )}
    </li>
  );
}
