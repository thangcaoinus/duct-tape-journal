import { useEffect, useState } from "react";
import {
  loadConcepts,
  createConcept,
  loadConcept,
  saveConcept,
  rescanConcept,
  loadConceptEntry,
} from "./api.js";
import { DayFlow } from "./lib/pages.jsx";
import { refreshConcepts } from "./lib/concepts.jsx";

// The "Concepts" tab: an Obsidian-lite tagging layer with no traversal. A concept
// is a named idea (+ optional alias keywords) that gathers every entry mentioning
// it, plus its own free-form notes page. Entries are linked automatically at
// finalize and via a manual Rescan; links are permanent — deleting (tore'ing) an
// entry keeps its link and just flags it "in tore". There is deliberately no
// remove-link or permanent-delete control anywhere here.
//
// Two views, like DayOverlay: the concept LIST (with a create form) and one
// concept's DETAIL (editable name/keywords/page, rescan, and its linked entries).
export default function Concepts({ openTarget }) {
  const [concepts, setConcepts] = useState(null); // null = loading
  const [openSlug, setOpenSlug] = useState(null);

  function refresh() {
    loadConcepts().then(setConcepts);
  }
  useEffect(refresh, []);

  // Clicking a concept word elsewhere routes here with {slug, nonce}. Open that
  // concept's detail; the nonce makes a repeat click on the same word re-open it.
  useEffect(() => {
    if (openTarget?.slug) setOpenSlug(openTarget.slug);
  }, [openTarget?.slug, openTarget?.nonce]);

  if (openSlug) {
    return (
      <ConceptDetail
        slug={openSlug}
        onBack={() => {
          setOpenSlug(null);
          refresh(); // link counts may have changed via rescan
        }}
      />
    );
  }

  return (
    <ConceptList
      concepts={concepts}
      onOpen={setOpenSlug}
      onCreated={refresh}
    />
  );
}

// --- List view: all concepts + a "new concept" form ---
function ConceptList({ concepts, onOpen, onCreated }) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [note, setNote] = useState("");

  async function onCreate(e) {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) return;
    const { status, body } = await createConcept({
      name: nm,
      keywords: splitKeywords(keywords),
    });
    if (body.ok) {
      const linked = (body.concept.links || []).length;
      setNote(
        `created "${body.concept.name}"${
          linked ? ` — linked ${linked} existing entr${linked === 1 ? "y" : "ies"}` : ""
        }`
      );
      setName("");
      setKeywords("");
      refreshConcepts(); // new concept → read views start highlighting it
      onCreated();
    } else if (status === 409) {
      setNote(`"${nm}" already exists — open it to edit.`);
    } else {
      setNote(`couldn't create: ${body.error || "unknown error"}`);
    }
  }

  return (
    <div className="bin-pane">
      <div className="toolbar">
        <span className="status">
          {concepts === null
            ? "loading…"
            : `${concepts.length} concept${concepts.length === 1 ? "" : "s"}`}
        </span>
        <span className="status">{note}</span>
      </div>

      <form className="concept-new" onSubmit={onCreate}>
        <input
          className="topic-input"
          type="text"
          placeholder="new concept (one word)…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Concept name (one word)"
        />
        <input
          className="concept-keywords-input"
          type="text"
          placeholder="alias keywords (comma or space separated)…"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          aria-label="Alias keywords"
        />
        <button type="submit">Create</button>
      </form>

      {concepts !== null && concepts.length === 0 ? (
        <p className="empty">
          No concepts yet. Create one above — it grabs matching entries from your
          whole archive right away.
        </p>
      ) : (
        <ul className="resource-list concept-list">
          {(concepts || []).map((c) => (
            <li key={c.slug} className="resource concept-row">
              <button className="concept-open" onClick={() => onOpen(c.slug)}>
                <span className="concept-name">{c.name}</span>
                <span className="resource-tag">
                  {c.linkCount} entr{c.linkCount === 1 ? "y" : "ies"}
                </span>
                {c.keywords.length > 0 && (
                  <span className="concept-chips">
                    {c.keywords.map((k) => (
                      <span key={k} className="concept-chip">
                        {k}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Detail view: one concept's editable fields, rescan, and linked entries ---
function ConceptDetail({ slug, onBack }) {
  const [concept, setConcept] = useState(null); // null = loading
  const [keywords, setKeywords] = useState("");
  const [page, setPage] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    loadConcept(slug).then((c) => {
      setConcept(c);
      if (c) {
        setKeywords((c.keywords || []).join(", "));
        setPage(c.page || "");
      }
    });
  }, [slug]);

  async function onSave() {
    setNote("saving…");
    const updated = await saveConcept(slug, {
      name: concept.name,
      keywords: splitKeywords(keywords),
      page,
    });
    if (updated) {
      setConcept((c) => ({ ...c, ...updated }));
      setKeywords((updated.keywords || []).join(", "));
      refreshConcepts(); // updated keywords/notes → refresh read-side highlights
      setNote("saved — Rescan to link older entries with the new keywords");
    } else {
      setNote("save failed");
    }
  }

  async function onRescan() {
    setNote("rescanning…");
    const added = await rescanConcept(slug);
    setNote(
      added
        ? `linked ${added} more entr${added === 1 ? "y" : "ies"}`
        : "no new matches"
    );
    const c = await loadConcept(slug); // pull the fresh link list
    if (c) setConcept(c);
    refreshConcepts(); // link count changed → keep hover previews accurate
  }

  if (concept === null) {
    return (
      <div className="bin-pane">
        <div className="toolbar">
          <button onClick={onBack}>‹ Concepts</button>
          <span className="status">loading…</span>
        </div>
      </div>
    );
  }

  const links = concept.links || [];
  return (
    <div className="bin-pane">
      <div className="toolbar">
        <button onClick={onBack}>‹ Concepts</button>
        <span className="status">
          #{concept.name} · {links.length} entr{links.length === 1 ? "y" : "ies"}
        </span>
        <span className="status">{note}</span>
      </div>

      <section className="concept-edit">
        <label className="concept-field">
          <span>Keywords</span>
          <input
            className="concept-keywords-input"
            type="text"
            placeholder="grieving, mourning, loss"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <label className="concept-field">
          <span>Page notes</span>
          <textarea
            className="concept-page"
            rows={6}
            placeholder="your notes about this concept…"
            value={page}
            onChange={(e) => setPage(e.target.value)}
          />
        </label>
        <div className="concept-actions">
          <button onClick={onSave}>Save</button>
          <button onClick={onRescan}>Rescan archive</button>
        </div>
      </section>

      <section className="bin-group">
        <h3>Linked entries</h3>
        {links.length === 0 ? (
          <p className="empty">
            Nothing linked yet. Add keywords and Rescan, or finalize a new entry
            that mentions this concept.
          </p>
        ) : (
          <ul className="resource-list">
            {links
              .slice()
              .sort((a, b) => (a.date + a.entry).localeCompare(b.date + b.entry))
              .map((l) => (
                <ConceptLink key={`${l.date}/${l.entry}`} slug={slug} link={l} />
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// One linked-entry row with a lazy read-only preview (same pattern as the Bin).
// Shows an "in tore" tag when the underlying entry is currently soft-deleted; the
// preview still renders because the server reads it from trash.
function ConceptLink({ slug, link }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState(null);

  function togglePreview() {
    if (!open && markdown === null) {
      loadConceptEntry(slug, link.date, link.entry).then(setMarkdown);
    }
    setOpen((o) => !o);
  }

  return (
    <li className="resource bin-entry">
      <div className="bin-entry-row">
        <div className="resource-meta">
          <code className="resource-name">
            {link.date} · {link.entry.replace(/\.md$/, "")}
          </code>
          <span className="resource-tag">
            {link.matched ? `matched “${link.matched}”` : ""}
            {link.deleted && (
              <span className="concept-tore-tag"> · in tore</span>
            )}
          </span>
        </div>
        <div className="resource-actions">
          <button onClick={togglePreview}>{open ? "Hide" : "Preview"}</button>
        </div>
      </div>
      {open && (
        <div className="bin-preview">
          {markdown === null ? (
            <p className="empty">Loading preview…</p>
          ) : markdown.trim() === "" ? (
            <p className="empty">(empty entry)</p>
          ) : (
            <DayFlow entries={[{ name: link.entry, markdown }]} />
          )}
        </div>
      )}
    </li>
  );
}

// Split a free-form keyword string ("grieving, mourning loss") into words.
function splitKeywords(s) {
  return (s || "")
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}
