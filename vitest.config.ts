import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The reconciliation engine is pure and has no DOM, no network and no
    // framework. Keeping it runnable in plain node is the point: it can be
    // proven correct before extraction or storage exist.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
