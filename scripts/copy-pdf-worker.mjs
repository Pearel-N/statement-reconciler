/**
 * Copies pdfjs's worker into public/ so the browser-side page renderer loads
 * it from our own origin rather than a CDN.
 *
 * Done on install rather than committed, so the worker can never drift out of
 * step with the installed pdfjs version — a mismatch there fails at runtime
 * with an unhelpful error.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

try {
  const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const worker = join(pdfjsRoot, "build", "pdf.worker.min.mjs");

  mkdirSync("public", { recursive: true });
  copyFileSync(worker, join("public", "pdf.worker.min.mjs"));

  console.log("copied pdf.worker.min.mjs into public/");
} catch (error) {
  console.warn(
    "could not copy the pdfjs worker — the source-page view will not render:",
    error.message,
  );
}
