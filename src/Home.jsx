import { useEffect, useMemo, useState } from "react";
import { loadStats, loadDay } from "./api.js";
import { monthGrid, monthLabel, today } from "./lib/date.js";
import DayOverlay from "./DayOverlay.jsx";

// The Home dashboard: a calm overview of the whole diary, derived from one
// GET /api/stats archive walk. Reflective, NOT gamified — totals, a sentiment
// timeline, a mood heatmap, which topics skew positive/negative, and a small
// curated "bundle" of pages to revisit. Deliberately no streaks. Clicking a day
// (heatmap or bundle) opens the same DayOverlay the calendar uses.
export default function Home({ dataVersion = 0, onChanged }) {
  const [stats, setStats] = useState(null); // null = loading
  const [openDate, setOpenDate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadStats().then((s) => !cancelled && setStats(s));
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const empty = stats && stats.totals.entries === 0;

  return (
    <div className="home-pane">
      <div className="page-header">
        <h2>Home</h2>
        <span className="page-sub">Your diary at a glance</span>
        <div className="page-rule" />
      </div>

      {!stats ? (
        <p className="empty">Reading your diary…</p>
      ) : empty ? (
        <p className="empty">
          No entries yet — write your first one and it'll show up here.
        </p>
      ) : (
        <>
          <Totals totals={stats.totals} />
          <SentimentTimeline days={stats.days} />
          <Heatmap
            days={stats.days}
            totals={stats.totals}
            onOpenDay={setOpenDate}
          />
          <TopicBars topics={stats.topics} />
          <Bundle days={stats.days} onOpenDay={setOpenDate} />
        </>
      )}

      {openDate && (
        <DayOverlay
          date={openDate}
          onClose={() => setOpenDate(null)}
          onChanged={() => onChanged?.()}
        />
      )}
    </div>
  );
}

// --- Section wrapper: a quiet serif heading + a light rule, reused per block. ---
function Section({ title, sub, children }) {
  return (
    <section className="home-section">
      <div className="home-section-head">
        <h3>{title}</h3>
        {sub && <span className="home-section-sub">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

// --- Totals: a single quiet line. No streak (a diary isn't a habit tracker). ---
function Totals({ totals }) {
  const { entries, activeDays, firstDate } = totals;
  const since = firstDate ? monthYear(firstDate) : null;
  return (
    <p className="home-totals">
      <strong>{entries}</strong> {entries === 1 ? "entry" : "entries"} across{" "}
      <strong>{activeDays}</strong> {activeDays === 1 ? "day" : "days"}
      {since && <> · since {since}</>}
    </p>
  );
}

// --- Sentiment over time: a diverging area/line. Positive (sage) above the zero
// baseline, negative (rust) below. One series → no legend; the title names it.
// Days with no scored entry are gaps (the line breaks), never plotted as 0. ---
function SentimentTimeline({ days }) {
  const pts = days.filter((d) => d.avgSentiment != null);
  if (pts.length < 1) {
    return (
      <Section title="Sentiment over time">
        <p className="home-note">No scored entries yet.</p>
      </Section>
    );
  }
  const W = 720;
  const H = 160;
  const PAD_X = 8;
  const PAD_Y = 14;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;
  const n = days.length;
  // x by index across ALL days (so gaps read as time passing), y by score -100..100.
  const x = (i) => (n === 1 ? PAD_X + innerW / 2 : PAD_X + (i / (n - 1)) * innerW);
  const y = (s) => PAD_Y + ((100 - s) / 200) * innerH;
  const zeroY = y(0);

  // Build a polyline over only the scored points (index preserved for x).
  const scored = days
    .map((d, i) => ({ i, s: d.avgSentiment, date: d.date }))
    .filter((p) => p.s != null);
  const linePath = scored
    .map((p, k) => `${k === 0 ? "M" : "L"} ${x(p.i).toFixed(1)} ${y(p.s).toFixed(1)}`)
    .join(" ");
  // Area to the zero baseline (split visually by the baseline via a clip is overkill
  // for one series; a translucent fill from the line to zero reads fine).
  const areaPath =
    scored.length > 1
      ? `${linePath} L ${x(scored[scored.length - 1].i).toFixed(1)} ${zeroY.toFixed(
          1
        )} L ${x(scored[0].i).toFixed(1)} ${zeroY.toFixed(1)} Z`
      : "";

  return (
    <Section title="Sentiment over time" sub="how entries felt, day by day">
      <div className="home-chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="timeline-svg"
          preserveAspectRatio="none"
          role="img"
          aria-label="Average sentiment per day over time"
        >
          {/* Diverging area, split at the zero baseline: sage above (positive),
              rust below (negative). Two clip rects halve the same area path. */}
          <defs>
            <clipPath id="tl-above">
              <rect x="0" y="0" width={W} height={zeroY} />
            </clipPath>
            <clipPath id="tl-below">
              <rect x="0" y={zeroY} width={W} height={H - zeroY} />
            </clipPath>
          </defs>
          {areaPath && (
            <>
              <path className="timeline-area pos" d={areaPath} clipPath="url(#tl-above)" />
              <path className="timeline-area neg" d={areaPath} clipPath="url(#tl-below)" />
            </>
          )}
          {/* zero baseline */}
          <line
            className="timeline-zero"
            x1={PAD_X}
            x2={W - PAD_X}
            y1={zeroY}
            y2={zeroY}
          />
          {linePath && <path className="timeline-line" d={linePath} />}
          {scored.map((p) => (
            <circle
              key={p.date}
              className={`timeline-dot ${p.s >= 0 ? "pos" : "neg"}`}
              cx={x(p.i)}
              cy={y(p.s)}
              r="3"
            >
              <title>
                {niceDate(p.date)}: {p.s > 0 ? `+${p.s}` : p.s}
              </title>
            </circle>
          ))}
        </svg>
        <div className="timeline-axis">
          <span>{niceDate(days[0].date)}</span>
          <span>{niceDate(days[days.length - 1].date)}</span>
        </div>
      </div>
    </Section>
  );
}

// --- Mood heatmap: month grids from first→last entry, each day tinted by its
// average sentiment (sage↔rust), falling back to a neutral ink tint for days with
// entries but no score. Reuses monthGrid + the calendar cell idiom. ---
function Heatmap({ days, totals, onOpenDay }) {
  const byDate = useMemo(() => {
    const m = new Map();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const months = useMemo(
    () => monthsBetween(totals.firstDate, totals.lastDate),
    [totals.firstDate, totals.lastDate]
  );
  const t = today();

  return (
    <Section title="Mood map" sub="each day tinted by how it felt">
      <div className="heatmap">
        {months.map((ym) => (
          <div className="heatmap-month" key={`${ym.year}-${ym.month0}`}>
            <div className="heatmap-label">{monthLabel(ym)}</div>
            <div className="heatmap-grid">
              {monthGrid(ym).map((cell) => {
                const d = byDate.get(cell.date);
                const has = !!d;
                const style = has ? sentimentTint(d.avgSentiment) : undefined;
                const cls = [
                  "heatmap-cell",
                  cell.inMonth ? "" : "out",
                  has ? "has" : "",
                  cell.date === t ? "today" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                if (has) {
                  return (
                    <button
                      key={cell.date}
                      className={cls}
                      style={style}
                      onClick={() => onOpenDay(cell.date)}
                      title={`${niceDate(cell.date)} · ${d.count} ${
                        d.count === 1 ? "entry" : "entries"
                      }${
                        d.avgSentiment != null
                          ? ` · ${d.avgSentiment > 0 ? "+" : ""}${d.avgSentiment}`
                          : " · unscored"
                      }`}
                    />
                  );
                }
                return <div key={cell.date} className={cls} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// --- Topic × sentiment: which subjects skew positive vs negative. A compact row
// per topic: the #topic, a count, and a bar tinted + signed by avg sentiment. ---
function TopicBars({ topics }) {
  if (!topics.length) {
    return (
      <Section title="Topics">
        <p className="home-note">No topics yet — add one while writing.</p>
      </Section>
    );
  }
  const maxCount = Math.max(...topics.map((t) => t.count));
  return (
    <Section title="Topics" sub="what you write about, and how it feels">
      <ul className="topic-bars">
        {topics.map((t) => (
          <li key={t.topic} className="topic-bar-row">
            <span className="topic-bar-name">#{t.topic}</span>
            <span className="topic-bar-track">
              <span
                className="topic-bar-fill"
                style={{
                  width: `${Math.max(6, (t.count / maxCount) * 100)}%`,
                  ...(t.avgSentiment != null ? sentimentTint(t.avgSentiment) : {}),
                }}
              />
            </span>
            <span className="topic-bar-meta">
              {t.count}
              {t.avgSentiment != null && (
                <em className="topic-bar-score">
                  {t.avgSentiment > 0 ? `+${t.avgSentiment}` : t.avgSentiment}
                </em>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// --- Curated bundle: a small stack of pages to revisit, picked by a criterion.
// Works on any archive size (unlike "on this day"). Snippets loaded on demand. ---
const CRITERIA = [
  { id: "recent", label: "Recent" },
  { id: "random", label: "Surprise me" },
  { id: "bright", label: "Brightest" },
  { id: "past", label: "A while ago" },
];

function Bundle({ days, onOpenDay }) {
  const [crit, setCrit] = useState("recent");
  const [cards, setCards] = useState(null); // [{date, entry, topic, snippet, sentiment}]

  const pickedDates = useMemo(() => pickDates(days, crit), [days, crit]);

  useEffect(() => {
    let cancelled = false;
    setCards(null);
    (async () => {
      const out = [];
      for (const date of pickedDates) {
        const entries = await loadDay(date);
        if (!entries.length) continue;
        const e = entries[0];
        out.push({
          date,
          entry: e.name,
          topic: e.meta?.topic || null,
          sentiment: typeof e.meta?.sentiment === "number" ? e.meta.sentiment : null,
          snippet: snippetOf(e.markdown),
        });
      }
      if (!cancelled) setCards(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedDates]);

  return (
    <Section title="Revisit" sub="a few pages worth another look">
      <div className="bundle-crit">
        {CRITERIA.map((c) => (
          <button
            key={c.id}
            className={`bundle-chip ${crit === c.id ? "active" : ""}`}
            onClick={() => setCrit(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!cards ? (
        <p className="home-note">Gathering pages…</p>
      ) : cards.length === 0 ? (
        <p className="home-note">Nothing to show for this pick.</p>
      ) : (
        <div className="bundle-cards">
          {cards.map((c) => (
            <button
              key={`${c.date}-${c.entry}`}
              className="bundle-card"
              onClick={() => onOpenDay(c.date)}
            >
              <span className="bundle-card-date">{niceDate(c.date)}</span>
              {c.topic && <span className="bundle-card-topic">#{c.topic}</span>}
              <span className="bundle-card-snippet">{c.snippet}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------- helpers ----------

// Tint style for a -100..100 sentiment: sage for positive, rust for negative,
// alpha scaled by magnitude so a mild day is faint and a strong day saturated.
// Returns inline style using the app's accent/danger hues (kept in sync here).
function sentimentTint(s) {
  if (s == null) return { background: "var(--paper-shade)" };
  const mag = Math.min(1, Math.abs(s) / 100);
  const alpha = 0.25 + mag * 0.55;
  const rgb = s >= 0 ? "91, 122, 107" : "179, 84, 47"; // --accent / --danger
  return { background: `rgba(${rgb}, ${alpha.toFixed(2)})` };
}

// Choose the bundle's dates (max 4) for a criterion. Uses whole-day averages.
function pickDates(days, crit) {
  const withEntries = days.filter((d) => d.count > 0);
  if (!withEntries.length) return [];
  const take = (arr) => arr.slice(0, 4).map((d) => d.date);
  switch (crit) {
    case "recent":
      return take([...withEntries].reverse());
    case "bright": {
      const scored = withEntries.filter((d) => d.avgSentiment != null);
      return take([...scored].sort((a, b) => b.avgSentiment - a.avgSentiment));
    }
    case "past": {
      // Oldest third, sampled — a nostalgic pull that's never empty on a young
      // archive (unlike a strict same-date "on this day").
      const third = withEntries.slice(0, Math.max(1, Math.ceil(withEntries.length / 3)));
      return take(shuffle(third));
    }
    case "random":
    default:
      return take(shuffle([...withEntries]));
  }
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// First ~120 chars of prose, stripped of markdown image refs and heading marks.
function snippetOf(md) {
  const text = (md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 120 ? text.slice(0, 120).trimEnd() + "…" : text || "(no text)";
}

// "Jul 30" style, local-parsed (no UTC roll).
function niceDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// "May 2026" from a YYYY-MM-DD.
function monthYear(date) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

// The list of {year, month0} months spanning first→last (inclusive).
function monthsBetween(firstDate, lastDate) {
  if (!firstDate || !lastDate) return [];
  const [fy, fm] = firstDate.split("-").map(Number);
  const [ly, lm] = lastDate.split("-").map(Number);
  const out = [];
  let y = fy;
  let m0 = fm - 1;
  // Guard against a pathological range.
  for (let guard = 0; guard < 240; guard++) {
    out.push({ year: y, month0: m0 });
    if (y === ly && m0 === lm - 1) break;
    m0++;
    if (m0 > 11) {
      m0 = 0;
      y++;
    }
  }
  return out;
}
