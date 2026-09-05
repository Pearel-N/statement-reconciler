import { Decimal } from "decimal.js";

import { extractStatement } from "@/lib/extract/extract";
import { deriveProvenance } from "@/lib/extract/provenance";
import { parsePdf } from "@/lib/pdf/parse";
import { prisma } from "@/lib/prisma";
import { reconcile, type StatementRow } from "@/lib/reconcile";
import { storage } from "@/lib/supabase";

/**
 * The processing pipeline, one stage per call.
 *
 * Extraction takes longer than a serverless function is allowed to live, so
 * the work cannot happen inside the upload request. Splitting it by stage
 * means every call finishes comfortably inside the limit, a crash loses only
 * the stage that was running, and the `status` column stops being decoration:
 * a statement that says `extracting` genuinely is mid-extraction, so the
 * progress the user sees is the truth rather than a spinner's guess.
 *
 * The client polls this endpoint. Each poll advances the statement one step.
 *
 * No lock is taken. Two simultaneous calls would at worst repeat a stage —
 * parsing is pure, extraction replaces the rows it wrote, and reconciliation
 * appends a run, which it is designed to do. The cost of a collision is one
 * wasted model call, not corrupt data, and a single polling browser makes
 * collisions unlikely. A queue would be the right answer with real
 * concurrency; it is not the right answer for five days.
 */

export type Stage =
  | "uploaded"
  | "parsing"
  | "extracting"
  | "reconciling"
  | "needs_review"
  | "verified"
  | "failed";

export interface AdvanceResult {
  status: Stage;
  /** True once no further call will change anything. */
  done: boolean;
  errorCode?: string | null;
  errorDetail?: string | null;
  discrepancy?: string | null;
  flagCount?: number;
}

const TERMINAL: Stage[] = ["verified", "needs_review", "failed"];

async function fail(
  statementId: string,
  errorCode: string,
  errorDetail: string,
): Promise<AdvanceResult> {
  await prisma.statement.update({
    where: { id: statementId },
    data: {
      status: "failed",
      errorCode: errorCode as never,
      errorDetail,
      processedAt: new Date(),
    },
  });

  return { status: "failed", done: true, errorCode, errorDetail };
}

async function loadPdf(storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await storage().download(storagePath);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function advance(statementId: string): Promise<AdvanceResult> {
  const statement = await prisma.statement.findUnique({
    where: { id: statementId },
  });

  if (!statement) {
    throw new Error("statement not found");
  }

  const status = statement.status as Stage;

  if (TERMINAL.includes(status)) {
    return {
      status,
      done: true,
      errorCode: statement.errorCode,
      errorDetail: statement.errorDetail,
    };
  }

  // ---- Stage 1: read the file -------------------------------------------
  //
  // Its own stage so that a file which can't be read costs nothing. Every
  // refusal here — encrypted, corrupted, a scan — happens before a single
  // token is spent on extraction.
  if (status === "uploaded" || status === "parsing") {
    await prisma.statement.update({
      where: { id: statementId },
      data: { status: "parsing" },
    });

    const bytes = await loadPdf(statement.storagePath);
    if (!bytes) {
      return fail(
        statementId,
        "unreadable_file",
        "The uploaded file couldn't be retrieved from storage.",
      );
    }

    const parsed = await parsePdf(bytes);
    if (!parsed.ok) {
      return fail(statementId, parsed.code, parsed.message);
    }

    await prisma.statement.update({
      where: { id: statementId },
      data: { status: "extracting", pageCount: parsed.pageCount },
    });

    return { status: "extracting", done: false };
  }

  // ---- Stage 2: extract --------------------------------------------------
  if (status === "extracting") {
    const bytes = await loadPdf(statement.storagePath);
    if (!bytes) {
      return fail(
        statementId,
        "unreadable_file",
        "The uploaded file couldn't be retrieved from storage.",
      );
    }

    // Re-parsed rather than carried between calls. Parsing is fast and pure;
    // persisting a page of positioned fragments to carry it across a request
    // boundary would cost more than doing it again.
    const parsed = await parsePdf(bytes);
    if (!parsed.ok) {
      return fail(statementId, parsed.code, parsed.message);
    }

    const extraction = await extractStatement(parsed.pages);

    if (!extraction.ok) {
      await prisma.statement.update({
        where: { id: statementId },
        data: { rawExtraction: (extraction.raw ?? null) as never },
      });
      return fail(statementId, extraction.code, extraction.message);
    }

    const { statement: extracted } = extraction;

    await prisma.$transaction([
      // Re-extraction replaces rather than appends, so running this stage
      // twice cannot double the transaction list.
      prisma.transaction.deleteMany({ where: { statementId } }),
      prisma.statement.update({
        where: { id: statementId },
        data: {
          bankName: extracted.bankName,
          accountNumberMasked: extracted.accountNumberMasked,
          periodStart: extracted.periodStart ? new Date(extracted.periodStart) : null,
          periodEnd: extracted.periodEnd ? new Date(extracted.periodEnd) : null,
          openingBalance: extracted.openingBalance,
          closingBalance: extracted.closingBalance,
          currency: extracted.currency,
          rawExtraction: (extraction.raw ?? null) as never,
          status: "reconciling",
        },
      }),
      prisma.transaction.createMany({
        data: extracted.transactions.map((row, index) => {
          const provenance = deriveProvenance(parsed.pages, row);
          return {
            statementId,
            rowIndex: index,
            date: new Date(row.date),
            description: row.description,
            amount: row.amount,
            direction: row.direction,
            runningBalance: row.runningBalance,
            sourcePage: provenance.sourcePage,
            sourceBbox: provenance.sourceBbox as never,
            bboxMatchConfidence: provenance.bboxMatchConfidence,
          };
        }),
      }),
    ]);

    return { status: "reconciling", done: false };
  }

  // ---- Stage 3: reconcile ------------------------------------------------
  if (status === "reconciling") {
    const stored = await prisma.transaction.findMany({
      where: { statementId },
      orderBy: { rowIndex: "asc" },
    });

    // Prisma's Decimal and decimal.js are the same library, but converting
    // through the string form keeps the engine's types honest and independent
    // of the ORM — it is meant to run without a database at all.
    const rows: StatementRow[] = stored.map((row) => ({
      rowIndex: row.rowIndex,
      description: row.description,
      amount: new Decimal(row.amount.toString()),
      direction: row.direction as "debit" | "credit",
      runningBalance:
        row.runningBalance === null ? null : new Decimal(row.runningBalance.toString()),
      sourcePage: row.sourcePage ?? 1,
    }));

    const result = reconcile(
      {
        openingBalance:
          statement.openingBalance === null
            ? null
            : new Decimal(statement.openingBalance.toString()),
        closingBalance:
          statement.closingBalance === null
            ? null
            : new Decimal(statement.closingBalance.toString()),
      },
      rows,
    );

    const byRowIndex = new Map(stored.map((row) => [row.rowIndex, row.id]));

    await prisma.$transaction([
      // Flags describe the current state, so a re-run replaces them. The
      // reconciliation history is appended, not replaced — watching the
      // discrepancy shrink is the point of keeping it.
      prisma.flag.deleteMany({ where: { statementId } }),
      prisma.reconciliation.create({
        data: {
          statementId,
          expectedDelta: result.expectedDelta?.toString() ?? "0",
          actualDelta: result.actualDelta.toString(),
          discrepancy: result.discrepancy?.toString() ?? "0",
          isReconciled: result.isReconciled,
        },
      }),
      prisma.flag.createMany({
        data: result.flags.map((flag) => ({
          statementId,
          transactionId:
            flag.rowIndex === null ? null : (byRowIndex.get(flag.rowIndex) ?? null),
          flagType: flag.flagType,
          severity: flag.severity,
          detail: flag.detail,
        })),
      }),
      prisma.statement.update({
        where: { id: statementId },
        data: {
          status: result.isReconciled ? "verified" : "needs_review",
          processedAt: new Date(),
        },
      }),
    ]);

    return {
      status: result.isReconciled ? "verified" : "needs_review",
      done: true,
      discrepancy: result.discrepancy?.toString() ?? null,
      flagCount: result.flags.length,
    };
  }

  return { status, done: false };
}
