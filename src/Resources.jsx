import { useEffect, useState } from "react";
import { today } from "./lib/date.js";
import { loadResources, deleteResource } from "./api.js";

// Orphan-cleanup panel: per-date image list with copy-reference + soft delete.
// "Orphan" = a file no finalized entry or draft references — the whole point of
// this tab, since paste-to-embed gives you no delete affordance.
export default function Resources() {
  const [date, setDate] = useState(today());
  const [resources, setResources] = useState([]);
  const [note, setNote] = useState("");

  function refresh(d) {
    loadResources(d).then(setResources);
  }
  useEffect(() => {
    refresh(date);
  }, [date]);

  function copyRef(name) {
    // The markdown you'd paste into an entry to reference this image on disk.
    navigator.clipboard?.writeText(`![](resources/${name})`);
    setNote(`copied reference to ${name}`);
  }

  async function onDelete(name) {
    if (!confirm(`Move ${name} to trash? (soft delete — recoverable)`)) return;
    const { body } = await deleteResource(date, name);
    if (body.ok) {
      setNote(`moved ${name} to trash`);
      refresh(date);
    } else {
      setNote(`delete failed: ${body.error}`);
    }
  }

  const orphans = resources.filter((r) => !r.referenced).length;

  return (
    <div className="resources-pane">
      <div className="toolbar">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
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
                <button onClick={() => copyRef(r.name)}>Copy ref</button>
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
