import { defineConfig } from "vitest/config";

// every package and worker is tested in plain Node with fakes for the network. Nothing reaches a
// real API. The thresholds sit just under the current figures, so a change that drops coverage
// fails CI instead of slipping through.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "workers/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "workers/*/src/**"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: { statements: 85, branches: 78, functions: 80, lines: 88 },
    },
  },
});
