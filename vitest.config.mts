import { defineConfig } from "vitest/config";

// every package and worker is tested in plain Node with fakes for the network. Nothing reaches a
// real API.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "workers/*/test/**/*.test.ts"],
  },
});
