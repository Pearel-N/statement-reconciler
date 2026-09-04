import type { ParsedPage, TextItem } from "@/lib/pdf/parse";

import type { ExtractedTransaction } from "./schema";

/**
 * Turning a model's line reference into a region of the page — and checking
 * that it was telling the truth.
 *
 * The model reports which numbered line it read a transaction from. Those
 * lines came from the parser, which knows exactly where each fragment sits.
 * So the bounding box is looked up, never generated.
 *
 * The check matters as much as the box. A model can name the wrong line, and
 * a confidently wrong highlight is worse than none: a reviewer would look at
 * the region shown, see a different row, and lose faith in every other
 * highlight on the page. So the referenced line is searched for the values
 * the model claims came from it, and confidence is the share that were found.
 */

export interface Provenance {
  sourcePage: number | null;
  sourceBbox: { x: number; y: number; width: number; height: number } | null;
  /** 1 when every claimed value appears on the referenced line, 0 when none
   *  do, null when the reference points at no line at all. */
  bboxMatchConfidence: number | null;
}

function boundingBox(items: TextItem[]) {
  const left = Math.min(...items.map((i) => i.x));
  const top = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + i.width));
  const bottom = Math.max(...items.map((i) => i.y + i.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Comparable form: digits only, so "1,23,857.14" matches "123857.14". */
function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

export function deriveProvenance(
  pages: ParsedPage[],
  transaction: ExtractedTransaction,
): Provenance {
  const page = pages.find((p) => p.pageNumber === transaction.page);
  const line = page?.lines[transaction.line];

  if (!page || !line || line.items.length === 0) {
    return { sourcePage: null, sourceBbox: null, bboxMatchConfidence: null };
  }

  const haystack = digitsOnly(line.items.map((i) => i.text).join(" "));

  // Only values that must appear literally on the row are checked. The
  // description is excluded: it is often reformatted or joined across two
  // visual lines, so its absence would mean nothing.
  const claims = [transaction.amount, transaction.runningBalance].filter(
    (value): value is string => value !== null,
  );

  const found = claims.filter((value) =>
    haystack.includes(digitsOnly(value)),
  ).length;

  return {
    sourcePage: page.pageNumber,
    sourceBbox: boundingBox(line.items),
    bboxMatchConfidence: claims.length === 0 ? 0 : found / claims.length,
  };
}
