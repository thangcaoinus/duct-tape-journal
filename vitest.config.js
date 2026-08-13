import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The sentiment model is short-circuited in tests (NODE_ENV=test, see
    // getSentimentPipe), so the suite is fast and network-free. This raised
    // timeout is a safety net only — if any future test genuinely awaits a slow
    // resource, a cold CI runner shouldn't fail it at the 5s default.
    testTimeout: 20000,
    // Guarantees NODE_ENV=test and a throwaway DIARY_DIR floor for every file
    // (see server/__tests__/setup.js) so no test can ever touch the real diary/.
    setupFiles: ["./server/__tests__/setup.js"],
    // Run each test FILE in its own forked process. The HTTP suites point the
    // server at a per-file temp archive by setting DIARY_DIR *before* importing
    // server/index.js (which captures DIARY once at load). In a shared worker the
    // module would be imported once and every file would race on the first file's
    // DIARY_DIR; a fork per file gives each its own fresh module + archive.
    pool: "forks",
    poolOptions: { forks: { isolate: true } },
  },
});
