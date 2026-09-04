import { z } from "zod";

/**
 * The contract the model must satisfy.
 *
 * One definition serves two purposes: Zod validates what comes back, and
 * `z.toJSONSchema` produces the tool schema the model is given. They cannot
 * drift apart, because there is only one of them.
 *
 * Money is a **string**, never a number. JSON numbers are IEEE doubles, so a
 * value that survives the model intact can still be mangled by the parser on
 * the way in. Strings are parsed to Decimal at the boundary instead. In an app
 * whose claim is exact arithmetic, money must never exist as a float even for
 * the microseconds it takes to deserialise.
 */

/** Digits and at most two decimal places. No currency symbol, no separators. */
const MONEY = /^\d{1,15}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const money = z.string().regex(MONEY, "expected a plain number like 1234.56");
const isoDate = z.string().regex(ISO_DATE, "expected a date like 2026-04-01");

export const ExtractedTransaction = z.object({
  /**
   * Which line of the supplied text this row came from.
   *
   * This is what makes provenance real rather than invented. The model is
   * never asked where anything is on the page — it is asked which numbered
   * line it read, and the coordinates of that line are already known from
   * parsing. It also makes the answer checkable: if the named line doesn't
   * contain the amount the model reported, the mapping is wrong and gets
   * flagged rather than trusted.
   */
  page: z.number().int().positive(),
  line: z.number().int().nonnegative(),

  date: isoDate,
  description: z.string().min(1).max(500),
  amount: money,
  direction: z.enum(["debit", "credit"]),
  /** Null where the layout prints no per-row balance. */
  runningBalance: money.nullable(),
});

export const ExtractedStatement = z.object({
  /**
   * Statement-level facts. All nullable: a statement that omits its closing
   * balance is still worth keeping, it just can't be verified — and saying so
   * is the honest outcome. A schema that demanded these would push the model
   * toward inventing them.
   */
  bankName: z.string().max(200).nullable(),
  accountNumberMasked: z.string().max(64).nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  openingBalance: money.nullable(),
  closingBalance: money.nullable(),
  currency: z.string().length(3).nullable(),

  /**
   * Set when more than one account appears in the file. Splitting is not
   * attempted — deciding where one statement ends and another begins is too
   * ambiguous to do reliably, and doing it wrong would corrupt the arithmetic
   * silently.
   */
  containsMultipleStatements: z.boolean(),

  transactions: z.array(ExtractedTransaction).max(2000),
});

export type ExtractedTransaction = z.infer<typeof ExtractedTransaction>;
export type ExtractedStatement = z.infer<typeof ExtractedStatement>;

/** The same shape, as the JSON Schema the model's tool definition needs. */
export function extractionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ExtractedStatement, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
}
