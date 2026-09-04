/**
 * The reconciliation engine.
 *
 * A bank statement declares an opening balance and a closing balance. The
 * transactions between them must account for the difference exactly. That
 * makes the document self-verifying: if the extracted rows don't produce the
 * declared delta, the extraction is wrong — not "probably wrong", wrong.
 *
 * This module is deliberately pure. No PDF, no database, no model, no React.
 * It takes a declaration and rows, and returns arithmetic and flags. That is
 * what lets it be proven correct before anything upstream of it exists, and
 * why it depends on `decimal.js` directly rather than on Prisma's re-export.
 */

import { Decimal } from "decimal.js";

export type Direction = "debit" | "credit";

export type FlagType =
  | "running_balance_break"
  | "page_boundary_gap"
  | "unverifiable_row"
  | "arithmetic_mismatch"
  | "duplicate_suspect"
  | "missing_field";

export type Severity = "info" | "warning" | "error";

export interface StatementRow {
  /** Position in the statement as extracted. Order is load-bearing here. */
  rowIndex: number;
  description: string;
  amount: Decimal;
  direction: Direction;
  /** Many layouts omit a per-row balance. When present it is the strongest
   *  signal available, because it localises an error to a single row. */
  runningBalance: Decimal | null;
  sourcePage: number;
}

export interface StatementDeclaration {
  openingBalance: Decimal | null;
  closingBalance: Decimal | null;
}

export interface Flag {
  flagType: FlagType;
  severity: Severity;
  /** null for statement-level flags. */
  rowIndex: number | null;
  detail: string;
}

export interface ReconciliationResult {
  /** closingBalance - openingBalance, as the document declares it. */
  expectedDelta: Decimal | null;
  /** credits - debits, as extracted. */
  actualDelta: Decimal;
  /** expectedDelta - actualDelta. Zero means the extraction is proven. */
  discrepancy: Decimal | null;
  isReconciled: boolean;
  flags: Flag[];
}

/** A single failed running-balance check, before it has been classified. */
export interface BalanceBreak {
  /** The row whose stated balance disagrees with the arithmetic. */
  rowIndex: number;
  /** What the balance should have been, given the previous stated balance. */
  expected: Decimal;
  /** What the document actually prints on this row. */
  actual: Decimal;
  /** actual - expected. The size and sign of the problem. */
  gap: Decimal;
  /** True when this row sits on a different page from the row before it. */
  crossesPageBoundary: boolean;
}

const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------
// Base arithmetic
// ---------------------------------------------------------------------------

/**
 * Credits add, debits subtract.
 *
 * `direction` is a column rather than the sign of `amount` precisely so this
 * function exists in one place instead of being an assumption baked into
 * every row by the extractor.
 */
export function signedAmount(row: StatementRow): Decimal {
  return row.direction === "credit" ? row.amount : row.amount.negated();
}

export function sumSignedAmounts(rows: StatementRow[]): Decimal {
  return rows.reduce((total, row) => total.plus(signedAmount(row)), ZERO);
}

// ---------------------------------------------------------------------------
// Running-balance walk  (implemented)
// ---------------------------------------------------------------------------

/**
 * Walks the statement checking each row's printed running balance.
 *
 * The important detail: each check starts from the *document's* previous
 * running balance, not from a balance this function accumulated itself.
 *
 * That choice is what makes localisation possible. If row 40's amount was
 * misread, chaining from our own running total would make rows 41, 42, 43 …
 * all fail too, and the output would be "100 rows are wrong" — useless to a
 * human. Chaining from the printed balance means row 41 is checked against
 * row 40's *printed* balance, which is correct, so exactly one row fails and
 * the human is pointed at exactly one row.
 *
 * When a row has no printed balance the last known printed balance is carried
 * forward and the amounts accumulate onto it, so gaps in the column degrade
 * the precision of localisation rather than breaking it.
 *
 * Rows before the first printed balance can't be checked at all — they're
 * left to statement-level reconciliation.
 */
export function walkRunningBalance(
  openingBalance: Decimal | null,
  rows: StatementRow[],
): BalanceBreak[] {
  const breaks: BalanceBreak[] = [];

  // The opening balance is the balance "printed" before row zero.
  let anchor: Decimal | null = openingBalance;
  let accumulated = ZERO;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    accumulated = accumulated.plus(signedAmount(row));

    if (row.runningBalance === null) {
      // Nothing to check against. Keep accumulating onto the same anchor.
      continue;
    }

    if (anchor === null) {
      // First printed balance in the statement, with no earlier anchor to
      // check it against. Adopt it and start checking from here.
      anchor = row.runningBalance;
      accumulated = ZERO;
      continue;
    }

    const expected = anchor.plus(accumulated);

    if (!expected.equals(row.runningBalance)) {
      breaks.push({
        rowIndex: row.rowIndex,
        expected,
        actual: row.runningBalance,
        gap: row.runningBalance.minus(expected),
        crossesPageBoundary: i > 0 && row.sourcePage !== rows[i - 1].sourcePage,
      });
    }

    // Re-anchor on what the document says regardless of whether the check
    // passed, so one bad row doesn't poison every row after it.
    anchor = row.runningBalance;
    accumulated = ZERO;
  }

  return breaks;
}

// ---------------------------------------------------------------------------
// Localisation  (yours)
// ---------------------------------------------------------------------------

/**
 * Turns raw balance breaks into flags a human can act on.
 *
 * One flag per break, deliberately. An earlier version merged consecutive
 * breaks that shared a gap, on the theory that they had one cause — but
 * `walkRunningBalance` re-anchors on the printed balance after every row, so
 * consecutive breaks are genuinely separate problems, not echoes of one. The
 * merging belonged to the naive walk, and disappeared with it.
 *
 * The distinction being drawn is between two different diagnoses:
 *
 *  - A break on a row that opens a new page is usually a *missing row*. Table
 *    rows get lost in the seam between pages far more often than a number is
 *    misread exactly at a page break.
 *  - A break inside a page is usually a *misread row* — wrong amount, or a
 *    debit read as a credit.
 *
 * Both are `error` severity: the arithmetic is provably broken either way.
 * `warning` is reserved for things that are suspicious but might be fine.
 */
export function classifyBreaks(breaks: BalanceBreak[]): Flag[] {
  return breaks.map((balanceBreak) => {
    const { rowIndex, expected, actual, gap, crossesPageBoundary } =
      balanceBreak;

    // The gap's sign says which way the balance moved; for a human the size
    // is what matters, and the expected/actual pair already shows direction.
    const size = gap.abs().toString();

    if (crossesPageBoundary) {
      return {
        flagType: "page_boundary_gap" as const,
        severity: "error" as const,
        rowIndex,
        detail:
          `The balance jumps by ${size} at the top of this page. ` +
          `Expected ${expected.toString()}, the statement shows ${actual.toString()}. ` +
          `A row was probably lost between pages.`,
      };
    }

    return {
      flagType: "running_balance_break" as const,
      severity: "error" as const,
      rowIndex,
      detail:
        `This row's balance is off by ${size}. ` +
        `Expected ${expected.toString()}, the statement shows ${actual.toString()}. ` +
        `The amount or the debit/credit direction on this row is probably wrong.`,
    };
  });
}

/**
 * Explains a discrepancy the running-balance walk could not.
 *
 * Runs when the rows agree with each other but not with the declared opening
 * and closing balances — or, more often, when the layout prints no
 * running-balance column at all and there is nothing to walk.
 *
 * Two hypotheses, both testable rather than guessed at:
 *
 *  1. **A flipped direction.** Reading a credit as a debit doesn't move the
 *     total by the row's amount — it moves it by *twice* the amount, because
 *     the row swings from adding to subtracting. So a row worth exactly half
 *     the discrepancy, in the direction that would explain the sign, is a
 *     strong suspect.
 *
 *  2. **A row extracted twice.** If removing one of a duplicate pair would
 *     close the gap exactly, the duplicate is the likely cause.
 *
 * Both only fire on a *unique* match. Two rows worth half the discrepancy
 * means the arithmetic can't tell which one is wrong, and pointing at both
 * would send a human to re-read two correct rows as often as one wrong one.
 *
 * When nothing fits, this returns nothing. "The arithmetic is off by X and I
 * can't tell you why" is a worse answer than a confident explanation, but a
 * far better one than a confident wrong explanation — and in an app whose
 * whole claim is knowing when it's wrong, a bad guess costs more than silence.
 */
export function explainResidualDiscrepancy(
  discrepancy: Decimal,
  rows: StatementRow[],
): Flag[] {
  if (discrepancy.isZero()) return [];

  // --- Hypothesis 1: one row's direction was flipped ----------------------
  //
  // A debit that should have been a credit leaves the extracted total too
  // low, so the discrepancy (expected - actual) comes out positive. The
  // reverse leaves it negative.
  const half = discrepancy.abs().dividedBy(2);
  const flippedFrom: Direction = discrepancy.greaterThan(0)
    ? "debit"
    : "credit";

  const flipSuspects = rows.filter(
    (row) => row.direction === flippedFrom && row.amount.equals(half),
  );

  if (flipSuspects.length === 1) {
    const suspect = flipSuspects[0];
    const shouldBe: Direction =
      flippedFrom === "debit" ? "credit" : "debit";

    return [
      {
        flagType: "arithmetic_mismatch",
        severity: "error",
        rowIndex: suspect.rowIndex,
        detail:
          `The statement is out by ${discrepancy.abs().toString()}, which is exactly twice this row's ` +
          `${suspect.amount.toString()}. It was read as a ${flippedFrom} and is probably a ${shouldBe}.`,
      },
    ];
  }

  // --- Hypothesis 2: one row was extracted twice --------------------------
  //
  // Removing a duplicate changes the total by that row's signed amount, so
  // the duplicate that closes the gap is the one whose signed amount is the
  // negative of the discrepancy.
  const duplicateSuspects = rows.filter((row, index) => {
    const isDuplicate = rows.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.description === row.description &&
        other.direction === row.direction &&
        other.amount.equals(row.amount),
    );

    return isDuplicate && signedAmount(row).negated().equals(discrepancy);
  });

  // A duplicate pair produces two matches — the same finding seen from both
  // rows. Flag the later one: it is the copy, and the earlier is the original.
  if (duplicateSuspects.length === 2) {
    const copy = duplicateSuspects[1];

    return [
      {
        flagType: "duplicate_suspect",
        severity: "warning",
        rowIndex: copy.rowIndex,
        detail:
          `This row is identical to an earlier one, and removing it would close ` +
          `the ${discrepancy.abs().toString()} gap exactly. It was probably extracted twice.`,
      },
    ];
  }

  // Nothing fits. Say so by saying nothing.
  return [];
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

export function reconcile(
  declaration: StatementDeclaration,
  rows: StatementRow[],
): ReconciliationResult {
  const actualDelta = sumSignedAmounts(rows);

  // Without both declared balances there is no oracle, so there is nothing to
  // reconcile against. The statement is kept and the rows are kept — it is
  // simply never reported as verified. Silently claiming success here would
  // be the single worst bug this app could have.
  if (declaration.openingBalance === null || declaration.closingBalance === null) {
    return {
      expectedDelta: null,
      actualDelta,
      discrepancy: null,
      isReconciled: false,
      flags: [
        {
          flagType: "missing_field",
          severity: "error",
          rowIndex: null,
          detail:
            "Can't verify this statement — the opening or closing balance is missing or unreadable.",
        },
      ],
    };
  }

  const expectedDelta = declaration.closingBalance.minus(
    declaration.openingBalance,
  );
  const discrepancy = expectedDelta.minus(actualDelta);

  if (discrepancy.isZero()) {
    return {
      expectedDelta,
      actualDelta,
      discrepancy,
      isReconciled: true,
      flags: [],
    };
  }

  const breaks = walkRunningBalance(declaration.openingBalance, rows);
  const flags =
    breaks.length > 0
      ? classifyBreaks(breaks)
      : explainResidualDiscrepancy(discrepancy, rows);

  return {
    expectedDelta,
    actualDelta,
    discrepancy,
    isReconciled: false,
    flags,
  };
}
