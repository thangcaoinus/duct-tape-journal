// Local YYYY-MM-DD. Deliberately NOT toISOString() — that's UTC and rolls the
// date near midnight, which would file a memory under the wrong day.
export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
