import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  type StatementRow,
  classifyBreaks,
  explainResidualDiscrepancy,
  reconcile,
  sumSignedAmounts,
  walkRunningBalance,
} from "./reconcile";

const d = (n: string | number) => new Decimal(n);

let nextIndex = 0;
function row(partial: Partial<StatementRow> & Pick<StatementRow, "amount" | "direction">): StatementRow {
  return {
    rowIndex: partial.rowIndex ?? nextIndex++,
    description: partial.description ?? "TRANSFER",
    amount: partial.amount,
    direction: partial.direction,
    runningBalance: partial.runningBalance ?? null,
    sourcePage: partial.sourcePage ?? 1,
  };
}

/**
 * A three-row statement that reconciles exactly.
 *   opening 10,000 → -1,500 → +2,000 → -500 → closing 10,000
 */
function cleanStatement(): StatementRow[] {
  nextIndex = 0;
  return [
    row({ amount: d(1500), direction: "debit", runningBalance: d(8500) }),
    row({ amount: d(2000), direction: "credit", runningBalance: d(10500) }),
    row({ amount: d(500), direction: "debit", runningBalance: d(10000) }),
  ];
}

// ---------------------------------------------------------------------------
// Base arithmetic — implemented
// ---------------------------------------------------------------------------

describe("sumSignedAmounts", () => {
  it("adds credits and subtracts debits", () => {
    expect(sumSignedAmounts(cleanStatement()).toString()).toBe("0");
  });

  it("does not accumulate binary floating point error", () => {
    nextIndex = 0;
    const rows = Array.from({ length: 10 }, () =>
      row({ amount: d("0.1"), direction: "credit" }),
    );
    // The whole project rests on this being exactly 1 and never 0.9999999.
    expect(sumSignedAmounts(rows).equals(d(1))).toBe(true);
  });
});

describe("reconcile", () => {
  it("proves a clean statement", () => {
    const result = reconcile(
      { openingBalance: d(10000), closingBalance: d(10000) },
      cleanStatement(),
    );

    expect(result.isReconciled).toBe(true);
    expect(result.discrepancy?.toString()).toBe("0");
    expect(result.flags).toEqual([]);
  });

  it("never reports success when a declared balance is missing", () => {
    const result = reconcile(
      { openingBalance: d(10000), closingBalance: null },
      cleanStatement(),
    );

    expect(result.isReconciled).toBe(false);
    expect(result.discrepancy).toBeNull();
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].flagType).toBe("missing_field");
    expect(result.flags[0].rowIndex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Running-balance walk — implemented
// ---------------------------------------------------------------------------

describe("walkRunningBalance", () => {
  it("finds nothing wrong with a clean statement", () => {
    expect(walkRunningBalance(d(10000), cleanStatement())).toEqual([]);
  });

  it("isolates a misread amount to the one row that caused it", () => {
    const rows = cleanStatement();
    rows[1].amount = d(200); // was 2,000

    const breaks = walkRunningBalance(d(10000), rows);

    // The point of re-anchoring on the printed balance: rows 2 onward are
    // still checked correctly, so the human is pointed at one row, not three.
    expect(breaks).toHaveLength(1);
    expect(breaks[0].rowIndex).toBe(1);
    expect(breaks[0].gap.toString()).toBe("1800");
  });

  it("surfaces a row that was missed entirely", () => {
    const rows = cleanStatement();
    rows.splice(1, 1); // drop the 2,000 credit

    const breaks = walkRunningBalance(d(10000), rows);

    expect(breaks).toHaveLength(1);
    expect(breaks[0].rowIndex).toBe(2);
    expect(breaks[0].gap.toString()).toBe("2000");
  });

  it("marks a break that lands on a page boundary", () => {
    const rows = cleanStatement();
    rows.splice(1, 1);
    rows[1].sourcePage = 2;

    const breaks = walkRunningBalance(d(10000), rows);

    expect(breaks[0].crossesPageBoundary).toBe(true);
  });

  it("has nothing to check when the layout prints no running balances", () => {
    nextIndex = 0;
    const rows = [
      row({ amount: d(1500), direction: "debit" }),
      row({ amount: d(2000), direction: "credit" }),
    ];

    expect(walkRunningBalance(d(10000), rows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Localisation
// ---------------------------------------------------------------------------

describe("classifyBreaks", () => {
  it("calls a break at a page boundary a page_boundary_gap", () => {
    const flags = classifyBreaks([
      {
        rowIndex: 2,
        expected: d(8000),
        actual: d(10000),
        gap: d(2000),
        crossesPageBoundary: true,
      },
    ]);

    expect(flags).toHaveLength(1);
    expect(flags[0].flagType).toBe("page_boundary_gap");
    expect(flags[0].rowIndex).toBe(2);
    expect(flags[0].severity).toBe("error");
    // A human has to act on this, so it has to say what went missing.
    expect(flags[0].detail).toMatch(/2000/);
  });

  it("calls a break inside a page a running_balance_break", () => {
    const flags = classifyBreaks([
      {
        rowIndex: 1,
        expected: d(8700),
        actual: d(10500),
        gap: d(1800),
        crossesPageBoundary: false,
      },
    ]);

    expect(flags).toHaveLength(1);
    expect(flags[0].flagType).toBe("running_balance_break");
    expect(flags[0].rowIndex).toBe(1);
  });

  it("returns one flag per break", () => {
    const flags = classifyBreaks([
      { rowIndex: 1, expected: d(1), actual: d(2), gap: d(1), crossesPageBoundary: false },
      { rowIndex: 5, expected: d(9), actual: d(4), gap: d(-5), crossesPageBoundary: true },
    ]);

    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.rowIndex)).toEqual([1, 5]);
  });
});

describe("explainResidualDiscrepancy", () => {
  it("names the row whose direction was flipped", () => {
    // A 2,000 credit read as a debit moves the delta by 2 x 2,000.
    nextIndex = 0;
    const rows = [
      row({ amount: d(1500), direction: "debit" }),
      row({ amount: d(2000), direction: "debit" }), // should be credit
      row({ amount: d(500), direction: "debit" }),
    ];

    const flags = explainResidualDiscrepancy(d(4000), rows);

    expect(flags).toHaveLength(1);
    expect(flags[0].rowIndex).toBe(1);
    expect(flags[0].flagType).toBe("arithmetic_mismatch");
  });

  it("says nothing rather than guessing when no hypothesis fits", () => {
    nextIndex = 0;
    const rows = [
      row({ amount: d(1500), direction: "debit" }),
      row({ amount: d(2000), direction: "credit" }),
    ];

    expect(explainResidualDiscrepancy(d("37.41"), rows)).toEqual([]);
  });
});

describe("explainResidualDiscrepancy, further cases", () => {
  it("spots a row that was extracted twice", () => {
    // A duplicated 750 credit inflates the extracted total by 750, so the
    // discrepancy (expected - actual) comes out at -750.
    nextIndex = 0;
    const rows = [
      row({ amount: d(1500), direction: "debit" }),
      row({ amount: d(750), direction: "credit", description: "SALARY" }),
      row({ amount: d(750), direction: "credit", description: "SALARY" }),
    ];

    const flags = explainResidualDiscrepancy(d(-750), rows);

    expect(flags).toHaveLength(1);
    expect(flags[0].flagType).toBe("duplicate_suspect");
    // The later of the pair is the copy; the earlier is the original.
    expect(flags[0].rowIndex).toBe(2);
  });

  it("stays silent when two rows equally explain the gap", () => {
    // Both rows are worth half the discrepancy. The arithmetic cannot say
    // which one is wrong, and naming both would send a human to re-read a
    // correct row as often as an incorrect one.
    nextIndex = 0;
    const rows = [
      row({ amount: d(2000), direction: "debit" }),
      row({ amount: d(2000), direction: "debit" }),
    ];

    expect(explainResidualDiscrepancy(d(4000), rows)).toEqual([]);
  });

  it("does nothing when the statement already reconciles", () => {
    nextIndex = 0;
    const rows = [row({ amount: d(2000), direction: "debit" })];

    expect(explainResidualDiscrepancy(d(0), rows)).toEqual([]);
  });
});
