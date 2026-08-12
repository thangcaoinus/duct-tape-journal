// Shared sentiment→color logic. One source of truth for the sage↔rust mood tint
// used by Home (heatmap / timeline dots / topic bars) and the Calendar mood spine.
// The RGB triples mirror the app's --accent (sage) / --danger (rust) tokens; keep
// them in sync with :root in styles.css.
export const SENT_RGB = {
  pos: "91, 122, 107", // --accent  #5b7a6b
  neg: "179, 84, 47", // --danger  #b3542f
};

// The rgba() color for a -100..100 sentiment. Positive → sage, negative → rust,
// alpha scaled by magnitude so a mild day is faint and a strong day saturated.
// `floor`/`span` shape the alpha ramp: alpha = floor + mag*span. The heatmap uses
// the default light ramp; the Calendar raises the floor so a spine still reads on
// warm paper. Returns null for an unscored (null) sentiment — callers pick the
// neutral fallback that fits their surface.
export function sentimentColor(s, { floor = 0.25, span = 0.55 } = {}) {
  if (s == null) return null;
  const mag = Math.min(1, Math.abs(s) / 100);
  const alpha = floor + mag * span;
  const rgb = s >= 0 ? SENT_RGB.pos : SENT_RGB.neg;
  return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}

// Inline `background` style for a -100..100 sentiment (unchanged drop-in for Home's
// heatmap / topic bars). Unscored → the warm neutral paper-shade.
export function sentimentTint(s) {
  const c = sentimentColor(s);
  return { background: c ?? "var(--paper-shade)" };
}
