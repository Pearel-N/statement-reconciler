import Anthropic from "@anthropic-ai/sdk";

import type { ParsedPage } from "@/lib/pdf/parse";

import { ExtractedStatement, extractionJsonSchema } from "./schema";

/**
 * Asking a model to read a statement, and not believing it.
 *
 * The model is a component, not an authority. It is given text it cannot see
 * the position of, asked for values only, and its answer is validated against
 * a schema before anything downstream touches it. Coordinates are looked up
 * separately; arithmetic is checked separately. Nothing here assumes the
 * answer is right.
 */

export type ExtractionFailureCode =
  | "not_a_statement"
  | "multiple_statements"
  | "extraction_failed";

export type ExtractionResult =
  | { ok: true; statement: ExtractedStatement; raw: unknown }
  | { ok: false; code: ExtractionFailureCode; message: string; raw?: unknown };

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const TOOL_NAME = "record_statement";

/**
 * Dates as banks actually write them.
 *
 * This originally accepted only `/` and `-`, which quietly rejected an entire
 * real statement: ICICI writes `08.06.2026` with dots, so not a single row
 * matched and the document was refused as "not a bank statement" — before any
 * model call, with a confident message, and wrongly.
 *
 * That is the expensive mistake in this check. Letting a non-statement
 * through costs one model call, which the schema and then the arithmetic will
 * reject. Turning away a real statement costs the user the whole product. So
 * this is now wide: separators of `.`, `/` or `-`, and month names.
 */
const DATE_LIKE =
  /\b(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{1,2}[\s./-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s./-]*\d{2,4})\b/i;
const MONEY_LIKE = /\d[\d,]*\.\d{2}\b/;
const BALANCE_WORDS = /\b(balance|opening|closing|b\/f|brought forward)\b/i;

/**
 * A cheap structural pre-check, before any model call.
 *
 * Deliberately code rather than a model: it costs nothing, it is
 * deterministic, and the thing being asked — "does this document contain rows
 * of dated amounts and some notion of a balance" — is a shape question, not a
 * judgement. A model asked the same question on an invoice would be tempted
 * to make it fit.
 *
 * Permissive on purpose. Rejecting an unusual but genuine statement is a much
 * worse failure than passing an invoice through to extraction, where the
 * schema and then the arithmetic will catch it.
 */
export function looksLikeStatement(pages: ParsedPage[]): boolean {
  let rowsWithDateAndMoney = 0;
  let sawBalanceWord = false;

  for (const page of pages) {
    for (const line of page.lines) {
      if (BALANCE_WORDS.test(line.layout)) sawBalanceWord = true;
      if (DATE_LIKE.test(line.layout) && MONEY_LIKE.test(line.layout)) {
        rowsWithDateAndMoney += 1;
      }
    }
  }

  return sawBalanceWord && rowsWithDateAndMoney >= 5;
}

/**
 * The document as numbered lines.
 *
 * The numbering is not decoration — it is the provenance mechanism. The model
 * cites a line rather than describing a position, and the citation can then be
 * resolved against coordinates the parser already recorded.
 */
export function asNumberedText(pages: ParsedPage[]): string {
  return pages
    .map((page) =>
      [
        `--- page ${page.pageNumber} ---`,
        ...page.lines.map((line, index) => `[${page.pageNumber}:${index}] ${line.layout}`),
      ].join("\n"),
    )
    .join("\n\n");
}

const SYSTEM_PROMPT = `You read bank statements and report exactly what they say.

You are given a statement as numbered lines. Spacing is meaningful: it
reproduces where text sits on the page. Columns line up, and a gap means that
column is empty on that row.

Rules:

- Report only real transactions. An opening balance row, a closing balance
  row, a "balance brought forward" or "B/F" or "carried forward" row, a
  subtotal, and a column header are NOT transactions, even when they appear in
  the table with an amount beside them. Leave them out.
- Which column a number sits in decides its direction. A number under DEBIT
  (or WITHDRAWAL, or DR) is a debit; under CREDIT (or DEPOSIT, or CR) it is a
  credit. Do not infer direction from the description.
- Amounts are always positive. Direction is carried by the direction field.
- Strip digit separators. "1,23,857.14" is reported as "123857.14".
- Dates are ISO in your answer: 2026-04-01. Statements write them many ways —
  DD/MM/YYYY, DD.MM.YYYY, DD-MMM-YY, "8 Jun 2026". Read day-first unless the
  document clearly shows otherwise, and use the statement period stated at the
  top to resolve any ambiguity.
- A row whose description wraps onto the following line is still one
  transaction — some layouts wrap it over several lines. Cite the line the
  amounts are on.
- Some statements print a per-row balance but declare no opening or closing
  balance anywhere. That is normal for a "transaction history" export. Report
  the balances as null rather than inferring them from the rows.
- Every transaction must cite the page and line number it came from.
- If a value is genuinely absent, use null. Never invent one, and never carry
  a value over from a neighbouring row.
- If the file contains statements for more than one account, set
  containsMultipleStatements to true.`;

export async function extractStatement(
  pages: ParsedPage[],
): Promise<ExtractionResult> {
  if (!looksLikeStatement(pages)) {
    return {
      ok: false,
      code: "not_a_statement",
      message:
        "This doesn't look like a bank statement — I couldn't find a transaction list or account balances.",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      code: "extraction_failed",
      message: "Extraction isn't configured on this server.",
    };
  }

  const client = new Anthropic({ apiKey });

  let raw: unknown;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description: "Record every transaction found in the statement.",
          input_schema: extractionJsonSchema() as never,
        },
      ],
      // Forcing the tool is what makes the answer a data structure rather
      // than prose that has to be parsed out of a paragraph.
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: asNumberedText(pages) }],
    });

    const block = response.content.find((part) => part.type === "tool_use");

    if (!block || block.type !== "tool_use") {
      return {
        ok: false,
        code: "extraction_failed",
        message: "The extraction step returned nothing usable for this file.",
      };
    }

    raw = block.input;
  } catch (error) {
    return {
      ok: false,
      code: "extraction_failed",
      message:
        error instanceof Error && error.message
          ? `Extraction failed: ${error.message}`
          : "Extraction failed while reading this file.",
    };
  }

  // Forcing a tool constrains the shape; it does not guarantee it. Validate.
  const parsed = ExtractedStatement.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      code: "extraction_failed",
      message:
        "The extracted data didn't match the expected shape, so it was rejected rather than stored.",
      // Kept so a failed extraction can be inspected without paying for
      // another call.
      raw,
    };
  }

  if (parsed.data.containsMultipleStatements) {
    return {
      ok: false,
      code: "multiple_statements",
      message:
        "This file appears to contain more than one statement — please upload each separately.",
      raw,
    };
  }

  return { ok: true, statement: parsed.data, raw };
}
