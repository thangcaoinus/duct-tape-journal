// Global test setup (wired via vitest.config.js `setupFiles`). Runs before any
// test module is imported, so it's the one reliable place to guarantee two things
// for EVERY test file:
//   1. NODE_ENV=test — short-circuits the sentiment/summarizer models (fast,
//      deterministic, offline).
//   2. DIARY_DIR points at a throwaway temp dir — so even a test that statically
//      imports from server/index.js (pure-helper tests do) never binds the module
//      to the real diary/. The server also hard-refuses test mode without this
//      (see the guard in server/index.js); this setup satisfies it globally.
// HTTP suites still mkdtemp their OWN per-file DIARY_DIR before their dynamic
// import for isolation; this is the safe default floor beneath them.
import fs from "fs";
import os from "os";
import path from "path";

process.env.NODE_ENV = "test";
if (!process.env.DIARY_DIR) {
  process.env.DIARY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dtd-test-default-"));
}
