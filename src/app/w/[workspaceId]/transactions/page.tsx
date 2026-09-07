import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { searchTransactions, type TransactionQuery } from "@/lib/search";
import { isValidWorkspaceId } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Run next to the database rather than wherever the request lands. The
// Supabase project is in ap-northeast-2, and functions were being served from
// Washington by default — so every page paid a trans-Pacific round trip for
// a query that takes milliseconds once it arrives.
export const preferredRegion = "icn1";

/**
 * The query surface.
 *
 * Filters live in the URL and the form submits by GET, so every result set is
 * a link — shareable, bookmarkable, and back-button correct — with no client
 * state to keep in sync. It also matches how the rest of the app works: the
 * URL is the thing you keep.
 */

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;

  if (!isValidWorkspaceId(workspaceId)) notFound();

  const rawDirection = first(sp.direction);
  // Anything other than the two valid values is treated as no filter, rather
  // than passed through to the query and rejected by Postgres.
  const direction =
    rawDirection === "debit" || rawDirection === "credit" ? rawDirection : undefined;
  const includeUnverified = first(sp.unverified) === "1";

  const query: TransactionQuery = {
    workspaceId,
    text: first(sp.q),
    from: first(sp.from),
    to: first(sp.to),
    minAmount: first(sp.min),
    maxAmount: first(sp.max),
    direction,
    statementId: first(sp.statement),
    includeUnverified,
  };

  const [{ rows, total }, statements] = await Promise.all([
    searchTransactions(query),
    prisma.statement.findMany({
      where: { workspaceId, status: { in: ["verified", "needs_review"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, filename: true, bankName: true, status: true },
    }),
  ]);

  const unverifiedAvailable = statements.some((s) => s.status === "needs_review");
  const field =
    "mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none";
  const label = "block text-[11px] uppercase tracking-wider text-stone-500";

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
          <Link
            href={`/w/${workspaceId}`}
            className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-stone-900 hover:text-stone-600"
          >
            Statement Reconciler
          </Link>
          <span className="text-xs text-stone-500">Transactions</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <Link
          href={`/w/${workspaceId}`}
          className="text-xs text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
        >
          ← all statements
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900">
          Transactions
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
          Every row here came from a statement that proved itself against its
          own declared balances. That is what makes the results worth acting on
          rather than a list a model produced.
        </p>

        <form method="get" className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="lg:col-span-2">
              <span className={label}>Search descriptions</span>
              <input
                name="q"
                defaultValue={query.text ?? ""}
                placeholder='e.g. broadband, or "loan emi"'
                className={field}
              />
            </label>

            <label>
              <span className={label}>From</span>
              <input type="date" name="from" defaultValue={query.from ?? ""} className={field} />
            </label>

            <label>
              <span className={label}>To</span>
              <input type="date" name="to" defaultValue={query.to ?? ""} className={field} />
            </label>

            <label>
              <span className={label}>Min amount</span>
              <input name="min" inputMode="decimal" defaultValue={query.minAmount ?? ""} className={field} />
            </label>

            <label>
              <span className={label}>Max amount</span>
              <input name="max" inputMode="decimal" defaultValue={query.maxAmount ?? ""} className={field} />
            </label>

            <label>
              <span className={label}>Direction</span>
              <select name="direction" defaultValue={query.direction ?? ""} className={field}>
                <option value="">any</option>
                <option value="debit">debit</option>
                <option value="credit">credit</option>
              </select>
            </label>

            <label>
              <span className={label}>Statement</span>
              <select name="statement" defaultValue={query.statementId ?? ""} className={field}>
                <option value="">all statements</option>
                {statements.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.filename}
                    {s.bankName ? ` · ${s.bankName}` : ""}
                    {s.status === "needs_review" ? " · unverified" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              type="submit"
              className="rounded-md bg-stone-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
            >
              Apply
            </button>
            <Link
              href={`/w/${workspaceId}/transactions`}
              className="text-xs text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
            >
              Clear
            </Link>

            {unverifiedAvailable && (
              <label className="flex items-center gap-2 text-xs text-stone-600">
                <input
                  type="checkbox"
                  name="unverified"
                  value="1"
                  defaultChecked={includeUnverified}
                  className="h-3.5 w-3.5 rounded border-stone-300"
                />
                Include rows from statements that don&apos;t reconcile
              </label>
            )}
          </div>
        </form>

        <p className="mt-6 text-xs text-stone-500">
          {total} {total === 1 ? "transaction" : "transactions"}
          {!includeUnverified && unverifiedAvailable && (
            <span className="text-stone-400">
              {" "}
              · rows from unreconciled statements are hidden
            </span>
          )}
        </p>

        {rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-500">
            Nothing matches those filters.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] uppercase tracking-wider text-stone-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-stone-600">
                      {row.date.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-xs text-stone-800">
                      {row.description}
                      {row.is_corrected && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                          corrected
                        </span>
                      )}
                      {row.status === "needs_review" && (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          unverified
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-stone-800">
                      {row.direction === "debit"
                        ? formatMoney(row.amount.toString(), row.currency)
                        : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-stone-800">
                      {row.direction === "credit"
                        ? formatMoney(row.amount.toString(), row.currency)
                        : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <Link
                        href={`/w/${workspaceId}/s/${row.statement_id}`}
                        className="text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
                      >
                        {row.bank_name ?? row.filename}
                        {row.source_page !== null && ` · p${row.source_page}`}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
