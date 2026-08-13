#!/usr/bin/env node
// Seed the DEMO archive (diary.demo/) from the committed diary.sample/, then let
// `npm run demo` launch the app against it via DIARY_DIR. This never touches your
// real diary/ — the demo runs in its own throwaway directory, so you can have a
// full personal archive AND boot the demo without either clobbering the other.
//
// diary.demo/ is gitignored and disposable: this script wipes and re-seeds it
// every run, and `npm run demo:clean` deletes it.
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = path.join(ROOT, "diary.sample");
const DEMO = path.join(ROOT, "diary.demo");

async function main() {
  try {
    await fs.access(SAMPLE);
  } catch {
    console.error("✗ diary.sample/ not found — nothing to seed.");
    process.exit(1);
  }

  // Fresh every time: remove any previous demo archive, then copy the sample in.
  await fs.rm(DEMO, { recursive: true, force: true });
  await fs.cp(SAMPLE, DEMO, { recursive: true });
  console.log("✓ Seeded diary.demo/ from diary.sample/ (your real diary/ is untouched).");
}

main().catch((e) => {
  console.error("✗ seed failed:", e.message);
  process.exit(1);
});
