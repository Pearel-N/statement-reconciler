import { describe, expect, it } from "vitest";

import type { ParsedPage } from "@/lib/pdf/parse";

import { deriveProvenance } from "./provenance";
import type { ExtractedTransaction } from "./schema";

function page(): ParsedPage {
  return {
    pageNumber: 1,
    width: 595,
    height: 842,
    lines: [
      {
        y: 100,
        layout: "01/04/2026  ACH DR-VERTEXFIN-LOAN EMI  18,740.00  1,61,910.00",
        items: [
          { text: "01/04/2026", x: 40, y: 100, width: 50, height: 8 },
          { text: "ACH DR-VERTEXFIN-LOAN EMI", x: 110, y: 100, width: 130, height: 8 },
          { text: "18,740.00", x: 380, y: 100, width: 42, height: 8 },
          { text: "1,61,910.00", x: 500, y: 100, width: 48, height: 8 },
        ],
      },
      {
        y: 120,
        layout: "02/04/2026  UPI/DR/1234/MetroMart Retail/NWBK  1,505.23  1,60,405.00",
        items: [
          { text: "02/04/2026", x: 40, y: 120, width: 50, height: 8 },
          { text: "UPI/DR/1234/MetroMart Retail/NWBK", x: 110, y: 120, width: 150, height: 8 },
          { text: "1,505.23", x: 386, y: 120, width: 36, height: 8 },
          { text: "1,60,405.00", x: 500, y: 120, width: 48, height: 8 },
        ],
      },
    ],
  };
}

function transaction(overrides: Partial<ExtractedTransaction> = {}): ExtractedTransaction {
  return {
    page: 1,
    line: 0,
    date: "2026-04-01",
    description: "ACH DR-VERTEXFIN-LOAN EMI",
    amount: "18740.00",
    direction: "debit",
    runningBalance: "161910.00",
    ...overrides,
  };
}

describe("deriveProvenance", () => {
  it("boxes the whole cited line", () => {
    const result = deriveProvenance([page()], transaction());

    expect(result.sourcePage).toBe(1);
    // Left edge of the first fragment to the right edge of the last.
    expect(result.sourceBbox).toEqual({ x: 40, y: 100, width: 508, height: 8 });
  });

  it("is fully confident when both claimed values are on the line", () => {
    expect(deriveProvenance([page()], transaction()).bboxMatchConfidence).toBe(1);
  });

  it("ignores digit grouping when matching", () => {
    // The model reports 18740.00; the page prints 18,740.00. Same number.
    const result = deriveProvenance(
      [page()],
      transaction({ amount: "18740.00", runningBalance: "161910.00" }),
    );

    expect(result.bboxMatchConfidence).toBe(1);
  });

  it("catches the model citing the wrong line", () => {
    // Line 1 holds 1,505.23 — not the 18,740.00 being claimed.
    const result = deriveProvenance([page()], transaction({ line: 1 }));

    expect(result.sourceBbox).not.toBeNull();
    // A confidently wrong highlight is worse than none: a reviewer would look
    // at the region, see a different row, and stop trusting every highlight.
    expect(result.bboxMatchConfidence).toBe(0);
  });

  it("is partially confident when only one claimed value matches", () => {
    const result = deriveProvenance(
      [page()],
      transaction({ runningBalance: "999999.00" }),
    );

    expect(result.bboxMatchConfidence).toBe(0.5);
  });

  it("reports nothing rather than a box when the line doesn't exist", () => {
    const result = deriveProvenance([page()], transaction({ line: 99 }));

    expect(result.sourcePage).toBeNull();
    expect(result.sourceBbox).toBeNull();
    expect(result.bboxMatchConfidence).toBeNull();
  });
});
