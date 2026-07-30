import { useEffect, useMemo, useState } from "react";
import {
  monthGrid,
  monthLabel,
  shiftMonth,
  todayYM,
  today,
  WEEKDAYS,
} from "./lib/date.js";
import { loadDaysWithCounts } from "./api.js";
import DayOverlay from "./DayOverlay.jsx";

// Fan out up to 3 small blank page-cards to signal a day's entry count. 0 -> no
// cards; 4+ -> still 3. Cards are rotated a few degrees each to fan like a hand.
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

export default function Calendar({ onChanged }) {
  const [ym, setYm] = useState(todayYM());
  const [counts, setCounts] = useState(new Map()); // date -> count
  const [openDate, setOpenDate] = useState(null);
  const t = today();

  // Bump to re-pull per-day counts after a delete in the overlay.
  const [countsKey, setCountsKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadDaysWithCounts().then((days) => {
      if (cancelled) return;
      setCounts(new Map(days.map((d) => [d.date, d.count])));
    });
    return () => {
      cancelled = true;
    };
  }, [countsKey]);

  const cells = useMemo(() => monthGrid(ym), [ym]);

  return (
    <div className="calendar-pane">
      <div className="calendar-head">
        <button
          className="cal-nav"
          onClick={() => setYm((m) => shiftMonth(m, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h2 className="cal-title">{monthLabel(ym)}</h2>
        <button
          className="cal-nav"
          onClick={() => setYm((m) => shiftMonth(m, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const count = counts.get(cell.date) || 0;
          const hasEntries = count > 0;
          const cls = [
            "cal-cell",
            cell.inMonth ? "" : "cal-out",
            cell.date === t ? "cal-today" : "",
            hasEntries ? "cal-has" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const inner = (
            <>
              <span className="cal-daynum">{cell.day}</span>
              <CardFan count={count} />
            </>
          );
          return hasEntries ? (
            <button
              key={cell.date}
              className={cls}
              onClick={() => setOpenDate(cell.date)}
              title={`${cell.date} · ${count} ${
                count === 1 ? "entry" : "entries"
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

      {openDate && (
        <DayOverlay
          date={openDate}
          onClose={() => setOpenDate(null)}
          onChanged={() => {
            setCountsKey((k) => k + 1); // refresh this calendar's fan counts
            onChanged?.(); // and tell the app so Read re-measures
          }}
        />
      )}
    </div>
  );
}
