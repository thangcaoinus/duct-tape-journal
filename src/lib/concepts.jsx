// Read-side concept awareness: a tiny session cache of the concept list plus a
// matcher used by DayFlow to highlight concept words in rendered entries. This is
// purely a display concern — matching/linking on disk is done server-side; here we
// just recognize the same terms in the browser so we can mark them and show a
// hover preview. Kept minimal and framework-light (a module cache + a hook), so
// DayFlow's callers don't have to thread concept props through the read views.

import { useEffect, useState } from "react";
import { loadConcepts } from "../api.js";

// --- Module-level cache. Concepts change rarely, so one fetch per session is
// plenty; the Concepts tab calls refreshConcepts() after an edit so new keywords
// start highlighting without a reload. ---
let cache = null; // null = not loaded yet; otherwise the concept summaries array
let inflight = null; // de-dupe concurrent first-loads
const subscribers = new Set(); // setState fns of mounted useConcepts() consumers

function publish() {
  subscribers.forEach((fn) => fn(cache || []));
}

async function fetchConcepts() {
  if (!inflight) {
    inflight = loadConcepts()
      .then((list) => {
        cache = list;
        return list;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const list = await inflight;
  publish();
  return list;
}

// Force a re-fetch (call after create/save/rescan on the Concepts tab).
export function refreshConcepts() {
  cache = null;
  return fetchConcepts();
}

// --- Navigation: clicking a highlighted word (in any read view) asks the app to
// open that concept's page. DayFlow fires openConceptPage(slug); App subscribes
// via onOpenConcept and switches to the Concepts tab. Kept here (not threaded as
// props) so DayFlow's callers don't all have to forward a navigation callback. ---
const navSubs = new Set();
export function openConceptPage(slug) {
  navSubs.forEach((fn) => fn(slug));
}
export function onOpenConcept(fn) {
  navSubs.add(fn);
  return () => navSubs.delete(fn);
}

// Hook: the current concept summaries ([] until first load resolves).
export function useConcepts() {
  const [list, setList] = useState(cache || []);
  useEffect(() => {
    subscribers.add(setList);
    if (cache === null) fetchConcepts();
    else setList(cache);
    return () => subscribers.delete(setList);
  }, []);
  return list;
}

// --- Matcher: mirror the server's term logic (matchTerms + escapeRe in
// server/index.js) so the words we highlight are exactly the words that would
// link. A term is one lowercased \w+ (like normTopic); a concept matches on its
// name plus its keywords. ---
const normTerm = (t) => (t || "").toString().toLowerCase().match(/\w+/)?.[0] ?? "";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// From the concept list, build { regex, termMap }:
//   regex   - one case-insensitive whole-word regex over every concept term,
//             or null when there are no terms.
//   termMap - lowercased term -> the concept it belongs to ({slug,name,snippet,
//             linkCount}). First concept wins if two share a term.
export function buildMatcher(concepts) {
  const termMap = new Map();
  for (const c of concepts || []) {
    for (const raw of [c.name, ...(c.keywords || [])]) {
      const t = normTerm(raw);
      if (t && !termMap.has(t)) {
        termMap.set(t, {
          slug: c.slug,
          name: c.name,
          snippet: c.snippet || "",
          linkCount: c.linkCount ?? 0,
        });
      }
    }
  }
  if (!termMap.size) return { regex: null, termMap };
  // Longest-first so a multi-letter term isn't pre-empted by a shorter overlap.
  const terms = [...termMap.keys()].sort((a, b) => b.length - a.length);
  const regex = new RegExp(`\\b(${terms.map(escapeRe).join("|")})\\b`, "gi");
  return { regex, termMap };
}
