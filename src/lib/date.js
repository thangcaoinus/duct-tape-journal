// Local YYYY-MM-DD. Deliberately NOT toISOString() — that's UTC and rolls the
// date near midnight, which would file a memory under the wrong day.
export function today() {
  const d = new Date();
  return fmt(d.getFullYear(), d.getMonth(), d.getDate());
}

// Format a local Y/M(0-based)/D triple as YYYY-MM-DD.
function fmt(y, m0, d) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// {year, month0} for today's month — the calendar's default view.
export function todayYM() {
  const d = new Date();
  return { year: d.getFullYear(), month0: d.getMonth() };
}

// Step a {year, month0} by ±1 month, rolling the year over.
export function shiftMonth({ year, month0 }, delta) {
  const m = month0 + delta;
  return { year: year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
}

// A month's title, e.g. "July 2026".
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export function monthLabel({ year, month0 }) {
  return `${MONTHS[month0]} ${year}`;
}

// A 6-row × 7-col grid of local dates covering the given month, with leading /
// trailing days from adjacent months so the weeks are full. Weeks start Sunday.
// Each cell: { date: 'YYYY-MM-DD', inMonth: boolean }. All local — no UTC.
export function monthGrid({ year, month0 }) {
  const first = new Date(year, month0, 1);
  const startDow = first.getDay(); // 0=Sun
  const cells = [];
  // Walk back to the Sunday on/before the 1st, then emit 42 consecutive days.
  const start = new Date(year, month0, 1 - startDow);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({
      date: fmt(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      inMonth: d.getMonth() === month0 && d.getFullYear() === year,
    });
  }
  return cells;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
