import Link from "next/link";
import { notFound } from "next/navigation";

import { ReviewPanel, type ReviewRow } from "@/components/review-panel";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { isValidWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function StatementPage({
  params,
}: {
  params: Promise<{ workspaceId: string; statementId: string }>;
}) {
  const { workspaceId, statementId } = await params;

  if (!isValidWorkspaceId(workspaceId)) notFound();

  const statement = await prisma.statement.findFirst({
    // Scoped by workspace as well as id: possession of a statement id alone
    // must not be enough to read someone else's document.
    where: { id: statementId, workspaceId },
    include: {
      transactions: { orderBy: { rowIndex: "asc" } },
      flags: { where: { isResolved: false } },
      reconciliations: { orderBy: { runAt: "desc" }, take: 1 },
    },
  });

  if (!statement) notFound();

  const run = statement.reconciliations[0] ?? null;
  const currency = statement.currency;

  const flagsByTransaction = new Map<string, typeof statement.flags>();
  const statementFlags = statement.flags.filter((f) => f.transactionId === null);

  for (const flag of statement.flags) {
    if (!flag.transactionId) continue;
    const list = flagsByTransaction.get(flag.transactionId) ?? [];
    list.push(flag);
    flagsByTransaction.set(flag.transactionId, list);
  }

  const rows: ReviewRow[] = statement.transactions.map((row) => ({
    id: row.id,
    rowIndex: row.rowIndex,
    date: row.date.toISOString().slice(0, 10),
    description: row.description,
    amount: row.amount.toString(),
    direction: row.direction as "debit" | "credit",
    runningBalance: row.runningBalance?.toString() ?? null,
    isCorrected: row.isCorrected,
    sourcePage: row.sourcePage,
    flags: (flagsByTransaction.get(row.id) ?? []).map((flag) => ({
      flagType: flag.flagType,
      severity: flag.severity,
      detail: flag.detail,
    })),
  }));

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6">
          <Link
            href={`/w/${workspaceId}`}
            className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-stone-900 hover:text-stone-600"
          >
            Statement Reconciler
          </Link>
          <span className="truncate text-xs text-stone-500">
            {statement.filename}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Link
          href={`/w/${workspaceId}`}
          className="text-xs text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
        >
          ← all statements
        </Link>

        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
              {statement.bankName ?? "Statement"}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              {statement.accountNumberMasked ?? "account not identified"}
              {statement.periodStart && statement.periodEnd && (
                <>
                  {" · "}
                  {statement.periodStart.toISOString().slice(0, 10)} to{" "}
                  {statement.periodEnd.toISOString().slice(0, 10)}
                </>
              )}
            </p>
          </div>

          <dl className="flex gap-6 text-sm sm:justify-end">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-stone-500">
                Opening
              </dt>
              <dd className="font-mono tabular-nums text-stone-900">
                {statement.openingBalance
                  ? formatMoney(statement.openingBalance.toString(), currency)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-stone-500">
                Closing
              </dt>
              <dd className="font-mono tabular-nums text-stone-900">
                {statement.closingBalance
                  ? formatMoney(statement.closingBalance.toString(), currency)
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>

        {statement.status === "failed" && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-900">
              This statement couldn&apos;t be processed
            </p>
            <p className="mt-1 text-sm text-red-800">{statement.errorDetail}</p>
            <code className="mt-1 block font-mono text-[11px] text-red-500">
              {statement.errorCode}
            </code>
          </div>
        )}

        {statement.status !== "failed" && (
          <ReviewPanel
            rows={rows}
            currency={currency}
            statementFlags={statementFlags.map((flag) => ({
              flagType: flag.flagType,
              severity: flag.severity,
              detail: flag.detail,
            }))}
            initial={{
              isReconciled: run?.isReconciled ?? false,
              discrepancy: run?.discrepancy.toString() ?? null,
              expectedDelta: run?.expectedDelta.toString() ?? null,
              actualDelta: run?.actualDelta.toString() ?? null,
              flagCount: statement.flags.length,
            }}
          />
        )}
      </main>
    </div>
  );
}
