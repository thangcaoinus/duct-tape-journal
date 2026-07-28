import { useState } from "react";
import katex from "katex";

// Common LaTeX, all in the inline $...$ form the Mathematics extension detects
// (regex: /\$([^$]*)\$/). Grouped so the panel scans quickly.
const CHEAT = [
  ["Fraction", "$\\frac{a}{b}$"],
  ["Square root", "$\\sqrt{x}$"],
  ["Nth root", "$\\sqrt[n]{x}$"],
  ["Power", "$x^{2}$"],
  ["Subscript", "$x_{i}$"],
  ["Sum", "$\\sum_{i=1}^{n} i$"],
  ["Integral", "$\\int_{a}^{b} f(x)\\,dx$"],
  ["Limit", "$\\lim_{x \\to 0}$"],
  ["Greek", "$\\alpha\\ \\beta\\ \\pi\\ \\theta$"],
  ["Infinity", "$\\infty$"],
  ["Times / dot", "$a \\times b \\cdot c$"],
  ["Not equal / leq", "$a \\neq b \\leq c$"],
  ["Vector", "$\\vec{v}$"],
  ["Matrix", "$\\begin{matrix} a & b \\\\ c & d \\end{matrix}$"],
];

// Render a KaTeX string to HTML for the mini-preview. Returns null on error
// (so a half-typed formula doesn't throw while you're mid-keystroke).
function renderKatex(src) {
  try {
    return katex.renderToString(src, { throwOnError: true });
  } catch {
    return null;
  }
}

// `currentMath` is the raw LaTeX (without $) the cursor is currently inside,
// or "" when the cursor isn't in a math span.
export default function MathHelper({ currentMath }) {
  const [open, setOpen] = useState(false);

  const active = currentMath && currentMath.trim().length > 0;
  const html = active ? renderKatex(currentMath) : null;

  return (
    <aside className="math-helper">
      {/* Live suggestion: what the cursor's math renders to right now. */}
      {active && (
        <div className="math-live">
          <div className="math-live-label">You're typing math:</div>
          <code className="math-live-src">${currentMath}$</code>
          <div className="math-live-preview">
            {html ? (
              <span dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <span className="math-live-err">…keep typing (not valid yet)</span>
            )}
          </div>
        </div>
      )}

      <button
        className="math-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} LaTeX cheat sheet
      </button>

      {open && (
        <table className="math-cheat">
          <tbody>
            {CHEAT.map(([label, src]) => {
              const inner = src.replace(/^\$|\$$/g, "");
              const rendered = renderKatex(inner);
              return (
                <tr key={label}>
                  <th>{label}</th>
                  <td>
                    <code>{src}</code>
                  </td>
                  <td className="math-cheat-render">
                    {rendered && (
                      <span dangerouslySetInnerHTML={{ __html: rendered }} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </aside>
  );
}
