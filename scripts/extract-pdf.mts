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

import { extractStatement, type ExtractionResult } from "@/lib/extract/extract";
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

let extraction: ExtractionResult;

if (!fresh && existsSync(cachePath)) {
  // Cached output was produced by this same code path, so it has already
  // been through the schema once.
  extraction = JSON.parse(readFileSync(cachePath, "utf8")) as ExtractionResult;
  console.log("(cached extraction — pass --fresh to re-run the model)");
} else {
  extraction = await extractStatement(parsed.pages);
  if (extraction.ok) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(extraction, null, 2));
  }
}

if (!extraction.ok) {
  console.log(`refused at extraction: ${extraction.code}`);
  console.log(`"${extraction.message}"`);
  process.exit(0);
}

const { statement } = extraction;

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
