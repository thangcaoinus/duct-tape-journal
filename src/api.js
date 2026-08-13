// Thin wrappers over the Express contract. Frontend hits same-origin /api;
// the Vite proxy forwards to :3001, so no host/port ever appears here.

async function json(res) {
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// Returns {markdown, topic} — the body plus the draft's saved topic (subject).
export async function loadDraft(date) {
  const { body } = await json(await fetch(`/api/draft/${date}`));
  return { markdown: body.markdown ?? "", topic: body.topic ?? "" };
}

export async function saveDraft(date, markdown, topic = "") {
  await fetch(`/api/draft/${date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, topic }),
  });
}

// The used-topic registry, for the editor's suggestion list.
export async function loadTopics() {
  const { body } = await json(await fetch(`/api/topics`));
  return body.topics ?? [];
}

export async function finalize(date) {
  return json(
    await fetch(`/api/finalize/${date}`, { method: "POST" })
  );
}

export async function loadDay(date) {
  const { body } = await json(await fetch(`/api/day/${date}`));
  return body.entries ?? [];
}

// Sorted [{date, count}] of days that have finalized entries. Feeds the
// calendar's per-day card fan.
export async function loadDaysWithCounts() {
  const { body } = await json(await fetch(`/api/days`));
  return body.days ?? [];
}

// Sorted list of just the dates (YYYY-MM-DD) with entries. Feeds the reader's
// day-to-day page sequence. Derived from the counted form above.
export async function loadDays() {
  const days = await loadDaysWithCounts();
  return days.map((d) => d.date);
}

// Aggregate stats for the Home dashboard (one server-side archive walk):
// {days:[{date,count,avgSentiment}], topics:[{topic,count,avgSentiment}],
//  totals:{entries,activeDays,scored,firstDate,lastDate}}. avgSentiment is null
// where nothing in that bucket was scored.
export async function loadStats() {
  const { body } = await json(await fetch(`/api/stats`));
  return body.stats ?? { days: [], topics: [], totals: {} };
}

// Soft-delete a finalized entry (calendar day-overlay's by-entry mode). Does
// NOT touch the day's images — entry and image deletion are independent.
export async function deleteEntry(date, name) {
  return json(
    await fetch(`/api/entry/${date}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    })
  );
}

// List recoverable trash items ([{id, kind, date, name, deletedAt, url?}]).
export async function loadTrash() {
  const { body } = await json(await fetch(`/api/trash`));
  return body.items ?? [];
}

// Read a trashed ENTRY's markdown (wire paths) for previewing before restore.
export async function loadTrashEntry(id) {
  const { body } = await json(
    await fetch(`/api/trash/${encodeURIComponent(id)}`)
  );
  return body.markdown ?? "";
}

// Restore a trashed item to its original place. Resolves to {status, body};
// body.ok on success, or a 409 with body.error when the slot is already taken.
export async function restoreTrash(id) {
  return json(
    await fetch(`/api/trash/restore/${encodeURIComponent(id)}`, {
      method: "POST",
    })
  );
}

// --- Concepts: the tagging layer ---

// Summaries for the list view: [{slug, name, keywords, linkCount}].
export async function loadConcepts() {
  const { body } = await json(await fetch(`/api/concepts`));
  return body.concepts ?? [];
}

// Create a concept. Returns {status, body} so the UI can surface a 409 (the slug
// is already taken) as a friendly message, like restoreTrash does.
export async function createConcept({ name, keywords = [], page = "" }) {
  return json(
    await fetch(`/api/concepts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, keywords, page }),
    })
  );
}

// Full concept incl. links (each link annotated with a live `deleted` flag).
export async function loadConcept(slug) {
  const { body } = await json(
    await fetch(`/api/concepts/${encodeURIComponent(slug)}`)
  );
  return body.concept ?? null;
}

// Update editable fields (name, keywords, page). Never touches links server-side.
export async function saveConcept(slug, { name, keywords, page }) {
  const { body } = await json(
    await fetch(`/api/concepts/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, keywords, page }),
    })
  );
  return body.concept ?? null;
}

// Re-grep the whole archive against this concept's keywords; returns count added.
export async function rescanConcept(slug) {
  const { body } = await json(
    await fetch(`/api/concepts/${encodeURIComponent(slug)}/rescan`, {
      method: "POST",
    })
  );
  return body.added ?? 0;
}

// A linked entry's markdown body (wire paths) for preview — live or in tore.
export async function loadConceptEntry(slug, date, name) {
  const { body } = await json(
    await fetch(
      `/api/concepts/${encodeURIComponent(slug)}/entry/${date}/${encodeURIComponent(
        name
      )}`
    )
  );
  return body.markdown ?? "";
}

// --- Topics browsing (the Gather tab's Topics view) ---

// Entries whose frontmatter topic == the given word, plus the topic's notes page:
// { entries: [{date, entry, matched, sentiment}], page }.
export async function loadTopicEntries(topic) {
  const { body } = await json(
    await fetch(`/api/topics/${encodeURIComponent(topic)}/entries`)
  );
  return { entries: body.entries ?? [], page: body.page ?? "" };
}

// Save a topic's notes page. Returns {topic, page} or null.
export async function saveTopic(topic, page) {
  const { body } = await json(
    await fetch(`/api/topics/${encodeURIComponent(topic)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
    })
  );
  return body.topic ?? null;
}

// A finalized entry's markdown body (wire paths) for preview — slug-independent.
export async function loadEntry(date, name) {
  const { body } = await json(
    await fetch(`/api/entry/${date}/${encodeURIComponent(name)}`)
  );
  return body.markdown ?? "";
}

// --- AI recap (local, offline summarization of a concept's / topic's entries) ---
// Stateless: each call regenerates. Returns { summary, highlights, offline }.
// `summary` is null when the model is unavailable (offline+uncached); highlights
// need no model so they come back regardless.
export async function summarizeConcept(slug) {
  const { body } = await json(
    await fetch(`/api/concepts/${encodeURIComponent(slug)}/summary`, {
      method: "POST",
    })
  );
  return {
    summary: body.summary ?? null,
    highlights: body.highlights ?? [],
    offline: !!body.offline,
    empty: !!body.empty,
  };
}

export async function summarizeTopic(topic) {
  const { body } = await json(
    await fetch(`/api/topics/${encodeURIComponent(topic)}/summary`, {
      method: "POST",
    })
  );
  return {
    summary: body.summary ?? null,
    highlights: body.highlights ?? [],
    offline: !!body.offline,
    empty: !!body.empty,
  };
}

// --- Sentiment ---

// Whether the neural sentiment model loaded (offline+uncached => false). Lets the
// Tools tab disable its button and explain, rather than fail on click.
export async function sentimentStatus() {
  const { body } = await json(await fetch(`/api/sentiment/status`));
  return !!body.available;
}

// Score every finalized entry that has no sentiment yet. Returns {status, body}
// with body {ok, scored, alreadyScored, skipped} or {ok:false, offline:true}.
export async function backfillSentiment() {
  return json(await fetch(`/api/sentiment/backfill`, { method: "POST" }));
}

// Re-score EVERY finalized entry, overwriting existing sentiments (bulk restamp,
// e.g. to replace old lexicon scores). Same response shape as backfill.
export async function rescoreSentiment() {
  return json(await fetch(`/api/sentiment/rescore`, { method: "POST" }));
}

export async function loadResources(date) {
  const { body } = await json(await fetch(`/api/resources/${date}`));
  return body.resources ?? [];
}

export async function deleteResource(date, name) {
  return json(
    await fetch(`/api/resource/${date}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    })
  );
}

// Read a File -> data URL, POST it, return the served /files URL.
export async function uploadImage(date, file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("could not read file"));
    r.readAsDataURL(file);
  });
  // Phone camera files often have no useful name; derive the ext from the MIME
  // type, and fall back to png. (HEIC is transcoded to jpg server-side.)
  const nameExt = file.name?.includes(".") ? file.name.split(".").pop() : "";
  const mimeExt = (file.type || "").split("/")[1];
  const ext = (nameExt || mimeExt || "png").toLowerCase();
  const res = await fetch(`/api/resource/${date}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, ext }),
  });
  // Surface a non-OK response as a clean error instead of letting an unhandled
  // rejection blank the app (a 413/500 error page isn't the JSON we expect).
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const { body } = await json(res);
  if (!body.ok) throw new Error(body.error || "upload failed");
  return body.url;
}
