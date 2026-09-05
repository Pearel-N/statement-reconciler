import { NextResponse } from "next/server";
import { z } from "zod";

import { reconcileStatement } from "@/lib/pipeline";
import { prisma } from "@/lib/prisma";

/**
 * Correcting one extracted value.
 *
 * Corrections never overwrite history. The first time a row is touched, the
 * model's original values are copied into `original_values` and kept — so the
 * extraction can still be evaluated afterwards, and a reviewer can see what
 * was changed rather than a row that silently looks correct.
 *
 * Every correction re-runs reconciliation immediately. That is the feedback
 * the whole review screen is built around: the discrepancy shrinks while you
 * work, and reaching zero is proof rather than a claim. It costs no model
 * call, because reconciliation reads the stored rows.
 */

const Correction = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().min(1).max(500).optional(),
    amount: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/).optional(),
    direction: z.enum(["debit", "credit"]).optional(),
    runningBalance: z
      .string()
      .regex(/^\d{1,15}(\.\d{1,2})?$/)
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "no fields to change",
  });

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "malformed_request", "The request body wasn't valid JSON.");
  }

  const parsed = Correction.safeParse(json);
  if (!parsed.success) {
    return fail(
      422,
      "invalid_correction",
      "That value isn't in a form this field accepts.",
    );
  }

  const existing = await prisma.transaction.findUnique({ where: { id } });

  if (!existing) {
    return fail(404, "transaction_not_found", "That row no longer exists.");
  }

  const update = await prisma.transaction.update({
    where: { id },
    data: {
      ...parsed.data,
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
      isCorrected: true,
      correctedAt: new Date(),
      // Written once. A second correction must not overwrite the model's
      // original answer with the reviewer's first attempt at fixing it.
      originalValues: existing.isCorrected
        ? undefined
        : ({
            date: existing.date.toISOString().slice(0, 10),
            description: existing.description,
            amount: existing.amount.toString(),
            direction: existing.direction,
            runningBalance: existing.runningBalance?.toString() ?? null,
          } as never),
    },
  });

  const outcome = await reconcileStatement(existing.statementId);

  return NextResponse.json({
    transaction: {
      id: update.id,
      date: update.date.toISOString().slice(0, 10),
      description: update.description,
      amount: update.amount.toString(),
      direction: update.direction,
      runningBalance: update.runningBalance?.toString() ?? null,
      isCorrected: update.isCorrected,
    },
    reconciliation: outcome,
  });
}
