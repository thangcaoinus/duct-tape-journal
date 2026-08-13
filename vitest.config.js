import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The sentiment model is short-circuited in tests (NODE_ENV=test, see
    // getSentimentPipe), so the suite is fast and network-free. This raised
    // timeout is a safety net only — if any future test genuinely awaits a slow
    // resource, a cold CI runner shouldn't fail it at the 5s default.
    testTimeout: 20000,
  },
});
