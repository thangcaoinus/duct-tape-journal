// Rotating copy for the Write tab — a small warm pool so the empty page and the
// commit moment feel alive rather than static (like the Claude app's rotating
// greetings). Quiet and human, never cutesy or gamified; no streaks anywhere.

// Placeholder shown in the empty editor. A fresh one is picked each time the page
// goes blank (mount + after a finalize clears it), inviting the first keystroke.
export const writingPrompts = [
  "What happened today?",
  "What's on your mind?",
  "Anything worth remembering?",
  "How did today feel?",
  "Start anywhere…",
  "What's stuck with you today?",
  "A line or two is plenty.",
  "What are you not saying out loud?",
  "What went right today?",
  "Just get it down — you can't do it wrong.",
];

// Brief confirmation after an entry is committed, shown beside the entry name.
export const finalizeCheers = [
  "Saved.",
  "Down on the page.",
  "That's today, kept.",
  "Committed to the record.",
  "One more day written.",
  "Filed away.",
  "Nicely done.",
];

// Pick a random item; falls back to the first when a repeat would be jarring
// isn't worth guarding — a small pool with plain random reads fine.
export function randomPrompt(list) {
  if (!list || !list.length) return "";
  return list[Math.floor(Math.random() * list.length)];
}
