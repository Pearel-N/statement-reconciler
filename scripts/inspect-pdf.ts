/**
 * Prints what the parser sees, so the text going to the model can be read by
 * a human before anyone writes a prompt for it.
 *
 *   npm run inspect -- fixtures/clean.pdf
 *   npm run inspect -- fixtures/scanned-no-text-layer.pdf
 */

import { readFileSync } from "node:fs";

import { pagesAsText, parsePdf } from "../src/lib/pdf/parse.ts";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("usage: npm run inspect -- <file.pdf> [more.pdf ...]");
  process.exit(1);
}

for (const file of files) {
  console.log("=".repeat(72));
  console.log(file);

  const result = await parsePdf(new Uint8Array(readFileSync(file)));

  if (!result.ok) {
    console.log(`  refused: ${result.code}`);
    console.log(`  "${result.message}"`);
    continue;
  }

  const text = pagesAsText(result.pages);
  const lineCount = result.pages.reduce((n, page) => n + page.lines.length, 0);

  console.log(`  ${result.pageCount} pages · ${lineCount} lines · ${text.length} characters`);
  console.log();
  console.log(text);
}
