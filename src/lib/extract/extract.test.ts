import { describe, expect, it } from "vitest";

import type { ParsedPage } from "@/lib/pdf/parse";

import { looksLikeStatement } from "./extract";

/** Builds a page from raw layout lines; only `layout` is read by the check. */
function pageOf(lines: string[]): ParsedPage {
  return {
    pageNumber: 1,
    width: 595,
    height: 842,
    lines: lines.map((layout, i) => ({ y: i * 12, layout, items: [] })),
  };
}

const header = "Date        Particulars        Withdrawal    Deposit     Balance";

describe("looksLikeStatement", () => {
  it("accepts slash-separated dates", () => {
    const rows = Array.from(
      { length: 6 },
      (_, i) => `0${i + 1}/04/2026   PAYMENT ${i}     1,200.00     84,250.00`,
    );
    expect(looksLikeStatement([pageOf([header, ...rows])])).toBe(true);
  });

  it("accepts dot-separated dates", () => {
    // The format that wrongly rejected a real ICICI statement: every row was
    // written 08.06.2026, so the original pattern matched nothing at all.
    const rows = Array.from(
      { length: 6 },
      (_, i) => `0${i + 1}.06.2026   UPI/Zepto/payment     195.00     13,748.06`,
    );
    expect(looksLikeStatement([pageOf([header, ...rows])])).toBe(true);
  });

  it("accepts month-name dates", () => {
    const rows = Array.from(
      { length: 6 },
      (_, i) => `0${i + 1} Jun 2026   CARD PURCHASE     1,499.00     22,110.00`,
    );
    expect(looksLikeStatement([pageOf([header, ...rows])])).toBe(true);
  });

  it("still turns away a document with no transaction rows", () => {
    expect(
      looksLikeStatement([
        pageOf([
          "INVOICE 4471",
          "Bill to: Acme Ltd",
          "Amount due 12,000.00",
          "Payable within 30 days",
        ]),
      ]),
    ).toBe(false);
  });

  it("turns away a statement-shaped document with too few rows", () => {
    // Deliberately permissive, but not so permissive that any page with a
    // date and a number gets sent to the model.
    expect(
      looksLikeStatement([
        pageOf([header, "01.06.2026  ONE ROW ONLY   100.00   900.00"]),
      ]),
    ).toBe(false);
  });
});
