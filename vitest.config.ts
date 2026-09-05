import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The logic under test is pure and has no DOM, no framework and — apart
    // from reading a fixture off disk — no I/O. Keeping it runnable in plain
    // node is the point: it can be proven without a database or a model.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
