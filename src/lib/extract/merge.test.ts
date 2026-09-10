import { describe, expect, it } from "vitest";

import { mergeExtractions } from "./extract";
import type { ExtractedStatement } from "./schema";

function page(over: Partial<ExtractedStatement> = {}): ExtractedStatement {
  return {
    bankName: null,
    accountNumberMasked: null,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
    closingBalance: null,
    currency: null,
    containsMultipleStatements: false,
    transactions: [],
    ...over,
  };
}

const tx = (line: number, amount: string) => ({
  page: 1,
  line,
  date: "2026-04-01",
  description: `ROW ${line}`,
  amount,
  direction: "debit" as const,
  runningBalance: null,
});

describe("mergeExtractions", () => {
  it("keeps transactions in page order", () => {
    const merged = mergeExtractions(
      new Map([
        [2, page({ transactions: [tx(1, "20.00")] })],
        [1, page({ transactions: [tx(1, "10.00")] })],
        [3, page({ transactions: [tx(1, "30.00")] })],
      ]),
    );

    expect(merged.transactions.map((t) => t.amount)).toEqual([
      "10.00",
      "20.00",
      "30.00",
    ]);
  });

  it("takes the opening balance from the earliest page that prints one", () => {
    const merged = mergeExtractions(
      new Map([
        [1, page({ openingBalance: "84250.00" })],
        [2, page({ openingBalance: "99999.00" })],
      ]),
    );

    expect(merged.openingBalance).toBe("84250.00");
  });

  it("takes the closing balance from the latest page that prints one", () => {
    // Statements print the closing figure at the end, so a later page wins —
    // this is what keeps the oracle bounding the whole document even though
    // it was read a page at a time.
    const merged = mergeExtractions(
      new Map([
        [1, page({ closingBalance: "11111.00" })],
        [3, page({ closingBalance: "123857.14" })],
      ]),
    );

    expect(merged.closingBalance).toBe("123857.14");
  });

  it("finds identity fields on whichever page carries them", () => {
    const merged = mergeExtractions(
      new Map([
        [1, page()],
        [2, page({ bankName: "Northwind Bank", currency: "INR" })],
      ]),
    );

    expect(merged.bankName).toBe("Northwind Bank");
    expect(merged.currency).toBe("INR");
  });

  it("carries a multiple-statement finding from any page", () => {
    const merged = mergeExtractions(
      new Map([
        [1, page()],
        [2, page({ containsMultipleStatements: true })],
      ]),
    );

    expect(merged.containsMultipleStatements).toBe(true);
  });

  it("reports nothing rather than inventing it when no page printed it", () => {
    const merged = mergeExtractions(new Map([[1, page()], [2, page()]]));

    expect(merged.openingBalance).toBeNull();
    expect(merged.closingBalance).toBeNull();
    expect(merged.bankName).toBeNull();
  });
});
