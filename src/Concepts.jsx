import { useEffect, useState } from "react";
import {
  loadConcepts,
  createConcept,
  loadConcept,
  saveConcept,
  rescanConcept,
  loadConceptEntry,
  loadStats,
  loadTopicEntries,
  loadEntry,
  saveTopic,
} from "./api.js";
import { DayFlow } from "./lib/pages.jsx";
import { MiniSentiment } from "./lib/spark.jsx";
import { refreshConcepts } from "./lib/concepts.jsx";

// The "Concepts" tab: an Obsidian-lite tagging layer with no traversal. A concept
// is a named idea (+ optional alias keywords) that gathers every entry mentioning
// it, plus its own free-form notes page. Entries are linked automatically at
// finalize and via a manual Rescan; links are permanent — deleting (tore'ing) an
// entry keeps its link and just flags it "in tore". There is deliberately no
// remove-link or permanent-delete control anywhere here.
//
// The "Gather" tab: two ways entries get grouped, switched by a segmented toggle.
//   - TOPICS: entries sharing an exact `topic:` frontmatter word (set while
//     drafting). Read-only browsing, gathered fresh by an archive scan.
//   - CONCEPTS: the Obsidian-lite tagging layer below — named ideas + keywords
//     that gather entries by whole-word BODY grep, with editable notes + rescan.
// Each side has its own list ⇋ detail, like DayOverlay's view modes.
export default function Concepts({ openTarget }) {
  const [view, setView] = useState("topics"); // 'topics' | 'concepts'

  // A concept-word deep-link (clicking a highlighted word in a read view) must
  // land on the CONCEPTS side, not Topics.
  useEffect(() => {
    if (openTarget?.slug) setView("concepts");
  }, [openTarget?.slug, openTarget?.nonce]);

  return (
    <div className="gather-pane">
      <div className="gather-viewtoggle" role="tablist" aria-label="Gather by">
        <button
          role="tab"
          aria-selected={view === "topics"}
          className={view === "topics" ? "active" : ""}
          onClick={() => setView("topics")}
        >
          Topics
        </button>
        <button
          role="tab"
          aria-selected={view === "concepts"}
          className={view === "concepts" ? "active" : ""}
          onClick={() => setView("concepts")}
        >
          Concepts
        </button>
      </div>
      {view === "topics" ? <Topics /> : <ConceptsView openTarget={openTarget} />}
    </div>
  );
}

// --- The Concepts side: list (with create) ⇋ one concept's detail. ---
function ConceptsView({ openTarget }) {
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
    <ConceptList concepts={concepts} onOpen={setOpenSlug} onCreated={refresh} />
  );
}

// --- The Topics side: list of subject words (count + sentiment) ⇋ one topic's
// entries. Read-only — topics are created while writing, not here. ---
function Topics() {
  const [topics, setTopics] = useState(null); // null = loading
  const [openTopic, setOpenTopic] = useState(null);

  useEffect(() => {
    loadStats().then((s) => setTopics(s.topics || []));
  }, []);

  if (openTopic) {
    return <TopicDetail topic={openTopic} onBack={() => setOpenTopic(null)} />;
  }
  return <TopicList topics={topics} onOpen={setOpenTopic} />;
}

// Sentiment dot color for a -100..100 score (sage↔rust), matching Home's tint.
function sentimentDot(s) {
  if (s == null) return "var(--muted)";
  const mag = Math.min(1, Math.abs(s) / 100);
  const alpha = 0.4 + mag * 0.6;
  const rgb = s >= 0 ? "91, 122, 107" : "179, 84, 47"; // --accent / --danger
  return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}

function TopicList({ topics, onOpen }) {
  if (topics === null) {
    return (
      <div className="bin-pane">
        <div className="page-header">
          <h2>Gather</h2>
          <span className="page-sub">loading…</span>
          <div className="page-rule" />
        </div>
      </div>
    );
  }
  return (
    <div className="bin-pane">
      <div className="page-header">
        <h2>Gather · Topics</h2>
        <span className="page-sub">entries grouped by their subject word</span>
        <div className="page-rule" />
      </div>
      {topics.length === 0 ? (
        <p className="empty">
          No topics yet — set a topic while writing and it'll gather here.
        </p>
      ) : (
        <ul className="resource-list topic-list">
          {topics.map((t) => (
            <li key={t.topic} className="resource topic-row">
              <button className="topic-open" onClick={() => onOpen(t.topic)}>
                {/* the "#" is drawn by CSS (.topic-open-name::before) */}
                <span className="topic-open-name">{t.topic}</span>
                <span className="topic-open-count">
                  {t.count} entr{t.count === 1 ? "y" : "ies"}
                </span>
                {t.avgSentiment != null && (
                  <span className="topic-open-sent">
                    <span
                      className="topic-sent-dot"
                      style={{ background: sentimentDot(t.avgSentiment) }}
                    />
                    {t.avgSentiment > 0 ? `+${t.avgSentiment}` : t.avgSentiment}
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

function TopicDetail({ topic, onBack }) {
  const [entries, setEntries] = useState(null); // null = loading
  const [page, setPage] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    loadTopicEntries(topic).then(({ entries, page }) => {
      setEntries(entries);
      setPage(page || "");
    });
  }, [topic]);

  async function onSave() {
    setNote("saving…");
    const saved = await saveTopic(topic, page);
    setNote(saved ? "saved" : "save failed");
  }

  const list = entries || [];
  return (
    <div className="bin-pane">
      <div className="page-header">
        <button className="btn-ghost" onClick={onBack}>
          ‹ Topics
        </button>
        <h2 className="concept-detail-title">#{topic}</h2>
        <span className="page-sub">
          {entries === null
            ? "loading…"
            : `${list.length} entr${list.length === 1 ? "y" : "ies"}`}
          {note ? ` · ${note}` : ""}
        </span>
        <div className="page-rule" />
      </div>

      {entries !== null && (
        <section className="bin-group">
          <h3>Sentiment over time</h3>
          <MiniSentiment
            points={list.map((e) => ({ date: e.date, sentiment: e.sentiment }))}
          />
        </section>
      )}

      <section className="concept-edit">
        <label className="concept-field">
          <span>Page notes</span>
          <textarea
            className="concept-page"
            rows={6}
            placeholder="your notes about this topic…"
            value={page}
            onChange={(e) => setPage(e.target.value)}
          />
        </label>
        <div className="concept-actions">
          <button className="btn-primary" onClick={onSave}>
            Save
          </button>
        </div>
      </section>

      <section className="bin-group">
        <h3>Entries</h3>
        {entries === null ? (
          <p className="empty">Loading…</p>
        ) : list.length === 0 ? (
          <p className="empty">No entries carry this topic.</p>
        ) : (
          <ul className="resource-list">
            {list.map((e) => (
              <TopicLink key={`${e.date}/${e.entry}`} link={e} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// One topic-entry row with a lazy read-only preview — the ConceptLink pattern,
// but slug-independent (loadEntry) and with no "in tore" tag (topic entries are
// always live).
function TopicLink({ link }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState(null);

  function togglePreview() {
    if (!open && markdown === null) {
      loadEntry(link.date, link.entry).then(setMarkdown);
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
      <div className="page-header">
        <h2>Gather · Concepts</h2>
        <span className="page-sub">
          {concepts === null
            ? "loading…"
            : `${concepts.length} concept${
                concepts.length === 1 ? "" : "s"
              } gathering your entries`}
          {note ? ` · ${note}` : ""}
        </span>
        <div className="page-rule" />
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
        <button type="submit" className="btn-primary">
          Create
        </button>
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
          <button className="btn-ghost" onClick={onBack}>
            ‹ Concepts
          </button>
          <span className="status">loading…</span>
        </div>
      </div>
    );
  }

  const links = concept.links || [];
  return (
    <div className="bin-pane">
      <div className="page-header">
        <button className="btn-ghost" onClick={onBack}>
          ‹ Concepts
        </button>
        <h2 className="concept-detail-title">#{concept.name}</h2>
        <span className="page-sub">
          {links.length} entr{links.length === 1 ? "y" : "ies"} linked
          {note ? ` · ${note}` : ""}
        </span>
        <div className="page-rule" />
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
          <button className="btn-primary" onClick={onSave}>
            Save
          </button>
          <button onClick={onRescan}>Rescan archive</button>
        </div>
      </section>

      <section className="bin-group">
        <h3>Sentiment over time</h3>
        <MiniSentiment
          points={links.map((l) => ({ date: l.date, sentiment: l.sentiment }))}
        />
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
