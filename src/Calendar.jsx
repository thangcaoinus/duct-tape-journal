import { useEffect, useMemo, useRef, useState } from "react";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  todayYM,
  today,
  MONTHS,
  WEEKDAYS,
} from "./lib/date.js";
import { loadStats } from "./api.js";
import { sentimentColor } from "./lib/sentiment.js";
import DayOverlay from "./DayOverlay.jsx";

// Fan out up to 3 small blank page-cards to signal a day's entry count. 0 -> no
// cards; 4+ -> still 3 (the exact count is shown by the corner chip instead).
const FAN_ANGLES = { 1: [0], 2: [-7, 7], 3: [-10, 0, 10] };

function CardFan({ count }) {
  const n = Math.min(count, 3);
  if (n <= 0) return null;
  const angles = FAN_ANGLES[n];
  return (
    <div className="card-fan" aria-hidden>
      {angles.map((a, i) => (
        <span
          key={i}
          className="page-card"
          style={{ transform: `rotate(${a}deg)` }}
        />
      ))}
    </div>
  );
}

// "Aug 4" style, local-parsed (no UTC roll).
function niceDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// The visible month's own summary from the loaded stats: entry total + avg mood
// over the days that actually fall in this month (avg only over scored days).
function monthSummary(days, ym) {
  const prefix = `${ym.year}-${String(ym.month0 + 1).padStart(2, "0")}-`;
  let entries = 0;
  let sum = 0;
  let scored = 0;
  for (const d of days) {
    if (!d.date.startsWith(prefix)) continue;
    entries += d.count;
    if (d.avgSentiment != null) {
      sum += d.avgSentiment;
      scored += 1;
    }
  }
  if (entries === 0) return "no entries this month";
  const label = `${entries} ${entries === 1 ? "entry" : "entries"}`;
  if (scored === 0) return label;
  const avg = Math.round(sum / scored);
  return `${label} · avg mood ${avg > 0 ? "+" : ""}${avg}`;
}

// The {year, month0} span of the archive (first→last), widened to include today,
// so the picker offers exactly the years worth jumping to.
function pickerYears(totals) {
  const t = todayYM();
  let minY = t.year;
  let maxY = t.year;
  if (totals.firstDate) minY = Math.min(minY, Number(totals.firstDate.slice(0, 4)));
  if (totals.lastDate) maxY = Math.max(maxY, Number(totals.lastDate.slice(0, 4)));
  const years = [];
  for (let y = minY; y <= maxY; y++) years.push(y);
  return years;
}

export default function Calendar({ onChanged }) {
  const [ym, setYm] = useState(todayYM());
  const [stats, setStats] = useState(null); // null = loading
  const [openDate, setOpenDate] = useState(null);
  const [picking, setPicking] = useState(false); // month/year picker expanded?
  const t = today();
  const tYM = todayYM();

  // Direction of the last month change, for the slide animation:
  //  -1 back, +1 forward, 0 snap (picker / Today). A nonce forces a replay even
  // when the direction repeats.
  const [anim, setAnim] = useState({ dir: 0, nonce: 0 });
  const goMonth = (next, dir) => {
    setAnim((a) => ({ dir, nonce: a.nonce + 1 }));
    setYm(next);
  };

  // Bump to re-pull stats after a delete in the overlay.
  const [dataKey, setDataKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadStats().then((s) => {
      if (!cancelled) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [dataKey]);

  const byDate = useMemo(() => {
    const m = new Map();
    for (const d of stats?.days ?? []) m.set(d.date, d);
    return m;
  }, [stats]);

  const cells = useMemo(() => monthGrid(ym), [ym]);
  const onCurrentMonth = ym.year === tYM.year && ym.month0 === tYM.month0;
  const totals = stats?.totals;
  const empty = stats && totals.entries === 0;

  return (
    <div className="calendar-pane">
      <div className="page-header">
        <h2>Calendar</h2>
        <span className="page-sub">Click a day with entries to read it</span>
        <div className="page-rule" />
      </div>

      <div className="calendar-head">
        <button
          className="cal-nav btn-ghost"
          onClick={() => goMonth(shiftMonth(ym, -1), -1)}
          aria-label="Previous month"
        >
          ‹
        </button>

        {picking && stats ? (
          <div className="cal-picker">
            <select
              className="btn"
              value={ym.month0}
              aria-label="Month"
              onChange={(e) =>
                goMonth({ ...ym, month0: Number(e.target.value) }, 0)
              }
            >
              {MONTHS.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="btn"
              value={ym.year}
              aria-label="Year"
              onChange={(e) =>
                goMonth({ ...ym, year: Number(e.target.value) }, 0)
              }
              onBlur={() => setPicking(false)}
            >
              {pickerYears(totals).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <button
            className="cal-title"
            onClick={() => setPicking(true)}
            title="Jump to a month"
            disabled={!stats}
          >
            {monthLabel(ym)}
          </button>
        )}

        <button
          className="cal-nav btn-ghost"
          onClick={() => goMonth(shiftMonth(ym, 1), 1)}
          aria-label="Next month"
        >
          ›
        </button>

        {!onCurrentMonth && (
          <button
            className="cal-today-btn btn-ghost"
            onClick={() => {
              setPicking(false);
              goMonth(todayYM(), 0);
            }}
          >
            Today
          </button>
        )}
      </div>

      {stats && (
        <p className="cal-month-sub">
          {empty ? "No entries yet — write your first one." : monthSummary(stats.days, ym)}
        </p>
      )}

      <div className="calendar-grid cal-grid-head">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
      </div>

      {!stats ? (
        <p className="empty">Reading your journal…</p>
      ) : (
        <div
          key={anim.nonce}
          className={`calendar-grid cal-grid-body cal-grid-enter dir-${
            anim.dir < 0 ? "back" : anim.dir > 0 ? "fwd" : "snap"
          }`}
        >
          {cells.map((cell) => {
            // Only this month's days carry entries. Days that spill in from the
            // adjacent month (grid padding) are always shown as quiet empties —
            // rendering their entry here reads as the wrong month (a July 30
            // entry appearing in the August grid).
            const d = cell.inMonth ? byDate.get(cell.date) : null;
            const count = d ? d.count : 0;
            const hasEntries = count > 0;
            const score = d ? d.avgSentiment : null;
            const cls = [
              "cal-cell",
              cell.inMonth ? "" : "cal-out",
              cell.date === t ? "cal-today" : "",
              hasEntries ? "cal-has" : "",
            ]
              .filter(Boolean)
              .join(" ");

            // Mood spine: sage/rust by score (raised alpha floor so it reads on
            // paper), a neutral muted spine for entry-days with no score, none
            // for empty days. The spine alone carries the hue — the day number
            // stays solid ink so it never drops below readable contrast.
            let moodStyle;
            if (hasEntries) {
              const c = sentimentColor(score, { floor: 0.42, span: 0.38 });
              moodStyle = { background: c ?? "var(--muted)" };
            }

            const inner = (
              <>
                {hasEntries && (
                  <span className="cal-mood" aria-hidden style={moodStyle} />
                )}
                <span className="cal-daynum">{cell.day}</span>
                {count > 3 && <span className="cal-count">{count}</span>}
                <CardFan count={count} />
              </>
            );

            return hasEntries ? (
              <button
                key={cell.date}
                className={cls}
                onClick={() => setOpenDate(cell.date)}
                title={`${niceDate(cell.date)} · ${count} ${
                  count === 1 ? "entry" : "entries"
                }${
                  score != null
                    ? ` · ${score > 0 ? "+" : ""}${score}`
                    : " · unscored"
                }`}
              >
                {inner}
              </button>
            ) : (
              <div key={cell.date} className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
      )}

      {openDate && (
        <DayOverlay
          date={openDate}
          onClose={() => setOpenDate(null)}
          onChanged={() => {
            setDataKey((k) => k + 1); // refresh this calendar's spine/counts
            onChanged?.(); // and tell the app so Read re-measures
          }}
        />
      )}
    </div>
  );
}
