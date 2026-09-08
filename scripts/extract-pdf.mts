/**
 * Runs the whole pipeline over a local PDF and prints what happened:
 * parse, extract, derive provenance, reconcile.
 *
 *   npm run extract -- fixtures/clean.pdf
 *   npm run extract -- fixtures/carry-forward.pdf
 *
 * This is a development tool, not part of the app. It exists so the pipeline
 * can be watched end to end without a browser, a database or an upload.
 *
 * Extraction results are cached by file content under .extraction-cache/, so
 * iterating on reconciliation, provenance or the review screen doesn't pay
 * for the same model call repeatedly. Pass --fresh to bypass it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Decimal } from "decimal.js";

import {
  extractStatementPage,
  looksLikeStatement,
  mergeExtractions,
} from "@/lib/extract/extract";
import type { ExtractedStatement } from "@/lib/extract/schema";
import { deriveProvenance } from "@/lib/extract/provenance";
import { parsePdf } from "@/lib/pdf/parse";
import { reconcile, type StatementRow } from "@/lib/reconcile";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env is fine if the key is already exported.
}

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!file) {
  console.error("usage: npm run extract -- <file.pdf>");
  process.exit(1);
}

const parsed = await parsePdf(new Uint8Array(readFileSync(file)));

if (!parsed.ok) {
  console.log(`refused at parsing: ${parsed.code}`);
  console.log(`"${parsed.message}"`);
  process.exit(0);
}

console.log(`parsed ${parsed.pageCount} pages`);

const CACHE_DIR = ".extraction-cache";
const fresh = process.argv.includes("--fresh");
const fingerprint = createHash("sha256")
  .update(readFileSync(file))
  .digest("hex")
  .slice(0, 16);
const cachePath = join(CACHE_DIR, `${fingerprint}.json`);

// Mirrors production: one page per call, then merge. Running the whole
// document in one request is what outgrew the serverless time limit, so
// testing it that way locally would test the wrong thing.
let statement: ExtractedStatement;

if (!fresh && existsSync(cachePath)) {
  statement = JSON.parse(readFileSync(cachePath, "utf8")) as ExtractedStatement;
  console.log("(cached extraction — pass --fresh to re-run the model)");
} else {
  if (!looksLikeStatement(parsed.pages)) {
    console.log("refused at extraction: not_a_statement");
    process.exit(0);
  }

  const byPage = new Map<number, ExtractedStatement>();

  for (const page of parsed.pages) {
    const started = Date.now();
    process.stdout.write(
      `  page ${page.pageNumber}/${parsed.pageCount}…`.padEnd(20),
    );

    const result = await extractStatementPage(parsed.pages, page.pageNumber);

    if (!result.ok) {
      console.log(` refused: ${result.code} — ${result.message}`);
      process.exit(0);
    }

    byPage.set(page.pageNumber, result.statement);
    console.log(
      ` ${result.statement.transactions.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  statement = mergeExtractions(byPage);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(statement, null, 2));
}

console.log(`\nbank         ${statement.bankName ?? "(not found)"}`);
console.log(`account      ${statement.accountNumberMasked ?? "(not found)"}`);
console.log(`period       ${statement.periodStart ?? "?"} to ${statement.periodEnd ?? "?"}`);
console.log(`opening      ${statement.openingBalance ?? "(not found)"}`);
console.log(`closing      ${statement.closingBalance ?? "(not found)"}`);
console.log(`transactions ${statement.transactions.length}`);

// --- provenance -----------------------------------------------------------

const provenance = statement.transactions.map((t) =>
  deriveProvenance(parsed.pages, t),
);

const exact = provenance.filter((p) => p.bboxMatchConfidence === 1).length;
const partial = provenance.filter(
  (p) => p.bboxMatchConfidence !== null && p.bboxMatchConfidence > 0 && p.bboxMatchConfidence < 1,
).length;
const unmatched = provenance.length - exact - partial;

console.log(
  `\nprovenance   ${exact} exact · ${partial} partial · ${unmatched} unmatched`,
);

if (unmatched > 0) {
  console.log("  (unmatched means the cited line doesn't contain the amount —");
  console.log("   the model pointed at the wrong row, and we can tell)");
}

// --- reconciliation -------------------------------------------------------

const rows: StatementRow[] = statement.transactions.map((t, index) => ({
  rowIndex: index,
  description: t.description,
  amount: new Decimal(t.amount),
  direction: t.direction,
  runningBalance: t.runningBalance === null ? null : new Decimal(t.runningBalance),
  sourcePage: t.page,
}));

const result = reconcile(
  {
    openingBalance:
      statement.openingBalance === null ? null : new Decimal(statement.openingBalance),
    closingBalance:
      statement.closingBalance === null ? null : new Decimal(statement.closingBalance),
  },
  rows,
);

console.log("\n--- reconciliation ---");
console.log(`expected delta   ${result.expectedDelta?.toString() ?? "n/a"}`);
console.log(`actual delta     ${result.actualDelta.toString()}`);
console.log(`discrepancy      ${result.discrepancy?.toString() ?? "n/a"}`);
console.log(`reconciled       ${result.isReconciled ? "YES" : "NO"}`);

if (result.flags.length > 0) {
  console.log(`\n${result.flags.length} flag(s):`);
  for (const flag of result.flags) {
    const where = flag.rowIndex === null ? "statement" : `row ${flag.rowIndex}`;
    console.log(`  [${flag.severity}] ${flag.flagType} @ ${where}`);
    console.log(`    ${flag.detail}`);
    if (flag.rowIndex !== null && rows[flag.rowIndex]) {
      const row = rows[flag.rowIndex];
      console.log(`    row: ${row.description.slice(0, 60)} — ${row.direction} ${row.amount}`);
    }
  }
}
