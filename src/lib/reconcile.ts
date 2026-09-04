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
 * TODO(you): turn raw balance breaks into flags a human can act on.
 *
 * See `reconcile.test.ts` — the failing tests are the specification.
 *
 * The distinctions that matter:
 *
 *  - A break on a row that starts a new page is usually a *missing row*: rows
 *    lost in the seam between two pages of a table. That is
 *    `page_boundary_gap`, and the gap is the amount that went missing.
 *
 *  - A break in the middle of a page is usually a *misread row*: a wrong
 *    amount or a flipped direction on that row. That is
 *    `running_balance_break`.
 *
 *  - A break whose gap is exactly twice a row's amount is a direction flip,
 *    not a wrong number — worth saying so, because the fix is one click.
 *
 * Severity: a break is `error` (the arithmetic is provably broken). Reserve
 * `warning` for things that are suspicious but might be legitimate.
 */
export function classifyBreaks(breaks: BalanceBreak[]): Flag[] {
  void breaks;
  return [];
}

/**
 * TODO(you): explain a discrepancy that the running-balance walk did not.
 *
 * This is the harder half. It runs when the statement reconciles row-to-row
 * but still doesn't match its declared opening and closing balances — or when
 * the statement has no running-balance column at all and there is nothing to
 * walk.
 *
 * Hypotheses worth testing, cheapest first:
 *
 *  - A single row's direction was flipped. Flipping a row changes the delta
 *    by exactly twice its amount, so a row whose amount is `discrepancy / 2`
 *    is a strong suspect.
 *  - A single row was missed entirely: the discrepancy equals one plausible
 *    transaction amount.
 *  - A row was extracted twice: two rows share date, amount and description,
 *    and removing one closes the gap exactly.
 *
 * Return an empty array when nothing explains it — an honest "the arithmetic
 * is off by X and I can't tell you why" beats a confident wrong guess.
 */
export function explainResidualDiscrepancy(
  discrepancy: Decimal,
  rows: StatementRow[],
): Flag[] {
  void discrepancy;
  void rows;
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
