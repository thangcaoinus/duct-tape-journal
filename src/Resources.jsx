import { useEffect, useRef, useState } from "react";
import { today } from "./lib/date.js";
import { loadResources, deleteResource, uploadImage } from "./api.js";

// Orphan-cleanup panel: per-date image list with copy-reference + soft delete.
// "Orphan" = a file no finalized entry or draft references — the whole point of
// this panel, since paste-to-embed gives you no delete affordance.
//
// Props (all optional):
//   fixedDate  - lock to this date and hide the picker (drawer-in-editor mode)
//   refreshKey - bump to force a reload (e.g. each time the drawer opens)
//   onInsert   - if given, shows an "Insert" button that drops the image
//                straight into the editor (wire url) instead of copy+paste
//   onDeleted  - called after a successful soft-delete (lets a host refresh)
export default function Resources({ fixedDate, refreshKey, onInsert, onDeleted }) {
  const [date, setDate] = useState(fixedDate || today());
  const [resources, setResources] = useState([]);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  // Keep in sync if a parent-controlled fixedDate changes.
  useEffect(() => {
    if (fixedDate) setDate(fixedDate);
  }, [fixedDate]);

  function refresh(d) {
    loadResources(d).then(setResources);
  }
  useEffect(() => {
    refresh(date);
  }, [date, refreshKey]);

  function copyRef(r) {
    // Copy the WIRE-path markdown so pasting it into the editor resolves to a
    // real image. The server rewrites this back to the relative disk path on
    // save, so on-disk entries stay portable.
    navigator.clipboard?.writeText(`![](${r.url})`);
    setNote(`copied reference to ${r.name}`);
  }

  async function onUpload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) await uploadImage(date, f);
      setNote(`uploaded ${files.length} image${files.length === 1 ? "" : "s"}`);
      refresh(date);
    } catch (err) {
      setNote(`upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(name) {
    if (!confirm(`Move ${name} to trash? (soft delete — recoverable)`)) return;
    const { body } = await deleteResource(date, name);
    if (body.ok) {
      setNote(`moved ${name} to trash`);
      refresh(date);
      onDeleted?.();
    } else {
      setNote(`delete failed: ${body.error}`);
    }
  }

  const orphans = resources.filter((r) => !r.referenced).length;

  return (
    <div className="resources-pane">
      <div className="toolbar">
        {!fixedDate && (
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
        <button
          className="btn-primary"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload image"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          onChange={onUpload}
          style={{ display: "none" }}
        />
        <span className="status">
          {resources.length} image{resources.length === 1 ? "" : "s"}
          {orphans > 0 && ` · ${orphans} orphan${orphans === 1 ? "" : "s"}`}
        </span>
        <span className="status">{note}</span>
      </div>

      {resources.length === 0 ? (
        <p className="empty">No images for {date}.</p>
      ) : (
        <ul className="resource-list">
          {resources.map((r) => (
            <li
              key={r.name}
              className={r.referenced ? "resource" : "resource orphan"}
            >
              <img src={r.url} alt={r.name} className="resource-thumb" />
              <div className="resource-meta">
                <code className="resource-name">{r.name}</code>
                <span className="resource-tag">
                  {r.referenced ? "in use" : "orphan — safe to delete"}
                </span>
              </div>
              <div className="resource-actions">
                {onInsert && (
                  <button onClick={() => onInsert(r)}>Insert</button>
                )}
                <button onClick={() => copyRef(r)}>Copy ref</button>
                <button className="danger" onClick={() => onDelete(r.name)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
