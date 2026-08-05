// Shared read-side data viz: a COMPACT sentiment-over-time sparkline, used on the
// Gather tab's topic + concept detail pages. It's the small sibling of Home's
// SentimentTimeline (Home.jsx) — same diverging visual language so the app reads
// as one system: sage area/dots above the zero baseline, rust below, split by two
// clip rects; a thin dashed zero line; one line through the scored points. Display
// only; it never writes. Reuses Home's `.timeline-*` CSS (sized down via
// `.mini-sentiment .timeline-svg`).

// points: [{ date, sentiment }] — `sentiment` is a signed -100..100 score or null
// (unscored). x is by index across ALL points so gaps read as time passing; only
// scored points get a dot and join the line.
export function MiniSentiment({ points = [] }) {
  const scored = points
    .map((p, i) => ({ i, s: p.sentiment, date: p.date }))
    .filter((p) => typeof p.s === "number");

  if (scored.length < 1) {
    return <p className="empty">No scored entries yet.</p>;
  }

  const W = 320;
  const H = 72;
  const PAD_X = 6;
  const PAD_Y = 8;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;
  const n = points.length;
  const x = (i) =>
    n === 1 ? PAD_X + innerW / 2 : PAD_X + (i / (n - 1)) * innerW;
  const y = (s) => PAD_Y + ((100 - s) / 200) * innerH;
  const zeroY = y(0);

  const linePath = scored
    .map(
      (p, k) => `${k === 0 ? "M" : "L"} ${x(p.i).toFixed(1)} ${y(p.s).toFixed(1)}`
    )
    .join(" ");
  const areaPath =
    scored.length > 1
      ? `${linePath} L ${x(scored[scored.length - 1].i).toFixed(1)} ${zeroY.toFixed(
          1
        )} L ${x(scored[0].i).toFixed(1)} ${zeroY.toFixed(1)} Z`
      : "";

  return (
    <div className="mini-sentiment">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="timeline-svg"
        preserveAspectRatio="none"
        role="img"
        aria-label="Sentiment over time for these entries"
      >
        <defs>
          <clipPath id="ms-above">
            <rect x="0" y="0" width={W} height={zeroY} />
          </clipPath>
          <clipPath id="ms-below">
            <rect x="0" y={zeroY} width={W} height={H - zeroY} />
          </clipPath>
        </defs>
        {areaPath && (
          <>
            <path
              className="timeline-area pos"
              d={areaPath}
              clipPath="url(#ms-above)"
            />
            <path
              className="timeline-area neg"
              d={areaPath}
              clipPath="url(#ms-below)"
            />
          </>
        )}
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
            key={`${p.date}-${p.i}`}
            className={`timeline-dot ${p.s >= 0 ? "pos" : "neg"}`}
            cx={x(p.i)}
            cy={y(p.s)}
            r="2.5"
          >
            <title>
              {niceDate(p.date)}: {p.s > 0 ? `+${p.s}` : p.s}
            </title>
          </circle>
        ))}
      </svg>
      <div className="timeline-axis">
        <span>{niceDate(points[0].date)}</span>
        <span>{niceDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

// Short readable date ("Aug 4"), local — matches Home's niceDate voice.
function niceDate(date) {
  const [y, m, d] = (date || "").split("-").map(Number);
  if (!y) return date || "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
