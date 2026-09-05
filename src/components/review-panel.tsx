"use client";

import { useMemo, useState } from "react";

import { formatMoney } from "@/lib/money";
import { SourceView, type SourceBox } from "@/components/source-view";

/**
 * The review screen.
 *
 * The organising idea is that a person should never be asked to re-read a
 * document. They are shown the arithmetic verdict, then only the rows the
 * arithmetic can't account for. Everything else is available but collapsed,
 * because a list of 70 correct rows is noise when 1 is wrong.
 *
 * Corrections recompute immediately, so the discrepancy visibly shrinks while
 * they work. Reaching zero is the point: it isn't the app claiming success,
 * it's the same arithmetic that found the problem confirming it's gone.
 */

export interface ReviewFlag {
  flagType: string;
  severity: string;
  detail: string;
}

export interface ReviewRow {
  id: string;
  rowIndex: number;
  date: string;
  description: string;
  amount: string;
  direction: "debit" | "credit";
  runningBalance: string | null;
  isCorrected: boolean;
  sourcePage: number | null;
  sourceBbox: SourceBox | null;
  flags: ReviewFlag[];
}

interface Verdict {
  isReconciled: boolean;
  discrepancy: string | null;
  expectedDelta: string | null;
  actualDelta: string | null;
  flagCount: number;
}

export function ReviewPanel({
  rows: initialRows,
  currency,
  statementFlags,
  initial,
  statementId,
  workspaceId,
}: {
  rows: ReviewRow[];
  currency: string | null;
  statementFlags: ReviewFlag[];
  initial: Verdict;
  statementId: string;
  workspaceId: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [verdict, setVerdict] = useState(initial);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flagged = useMemo(() => rows.filter((r) => r.flags.length > 0), [rows]);

  async function save(id: string, changes: Partial<ReviewRow>) {
    setSaving(id);
    setError(null);

    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error?.message ?? "That change couldn't be saved.");
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === id ? { ...row, ...payload.transaction } : row,
        ),
      );
      setVerdict({
        isReconciled: payload.reconciliation.isReconciled,
        discrepancy: payload.reconciliation.discrepancy,
        expectedDelta: payload.reconciliation.expectedDelta,
        actualDelta: payload.reconciliation.actualDelta,
        flagCount: payload.reconciliation.flagCount,
      });
    } catch {
      setError("Couldn't reach the server. Your change wasn't saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <Verdict verdict={verdict} rowCount={rows.length} currency={currency} />

      {statementFlags.length > 0 && (
        <ul className="mt-4 space-y-2">
          {statementFlags.map((flag, index) => (
            <li
              key={index}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {flag.detail}
              <code className="ml-2 font-mono text-[11px] text-amber-600">
                {flag.flagType}
              </code>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {flagged.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider text-stone-500">
            Needs your attention
          </h2>
          <div className="mt-2 space-y-3">
            {flagged.map((row) => (
              <RowEditor
                key={row.id}
                row={row}
                currency={currency}
                saving={saving === row.id}
                onSave={save}
                statementId={statementId}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
        >
          {showAll ? "Hide" : "Show"} all {rows.length} transactions
        </button>

        {showAll && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] uppercase tracking-wider text-stone-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 text-right font-medium">Page</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-stone-100 last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-stone-600">
                      {row.date}
                    </td>
                    <td className="px-3 py-2 text-xs text-stone-800">
                      {row.description}
                      {row.isCorrected && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                          corrected
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-stone-800">
                      {row.direction === "debit"
                        ? formatMoney(row.amount, currency)
                        : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-stone-800">
                      {row.direction === "credit"
                        ? formatMoney(row.amount, currency)
                        : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-stone-500">
                      {row.runningBalance
                        ? formatMoney(row.runningBalance, currency)
                        : ""}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-stone-400">
                      {row.sourcePage ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Verdict({
  verdict,
  rowCount,
  currency,
}: {
  verdict: Verdict;
  rowCount: number;
  currency: string | null;
}) {
  if (verdict.isReconciled) {
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
        <p className="text-sm font-medium text-emerald-900">
          Reconciles exactly — nothing needs your attention
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          All {rowCount} transactions account for the difference between the
          declared opening and closing balances, to the paisa.
        </p>
      </div>
    );
  }

  if (verdict.discrepancy === null) {
    return (
      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm font-medium text-amber-900">
          Can&apos;t verify this statement
        </p>
        <p className="mt-1 text-sm text-amber-800">
          {rowCount} transactions were extracted, but the declared balances are
          missing or unreadable, so there is nothing to check them against.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
      <p className="text-sm font-medium text-amber-900">
        {rowCount} transactions extracted — the arithmetic is off by{" "}
        <span className="font-mono tabular-nums">
          {formatMoney(verdict.discrepancy.replace("-", ""), currency)}
        </span>
      </p>
      <p className="mt-1 text-sm text-amber-800">
        {verdict.flagCount === 0
          ? "No single row explains the difference."
          : `${verdict.flagCount} row${verdict.flagCount === 1 ? "" : "s"} below ${verdict.flagCount === 1 ? "is" : "are"} responsible. Fix ${verdict.flagCount === 1 ? "it" : "them"} and this goes to zero.`}
      </p>
    </div>
  );
}

function RowEditor({
  row,
  currency,
  saving,
  onSave,
  statementId,
  workspaceId,
}: {
  row: ReviewRow;
  currency: string | null;
  saving: boolean;
  onSave: (id: string, changes: Partial<ReviewRow>) => void;
  statementId: string;
  workspaceId: string;
}) {
  const [amount, setAmount] = useState(row.amount);
  const [direction, setDirection] = useState(row.direction);

  const changed = amount !== row.amount || direction !== row.direction;

  return (
    <div className="rounded-lg border border-amber-200 bg-white">
      <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-2.5">
        {row.flags.map((flag, index) => (
          <p key={index} className="text-sm leading-relaxed text-amber-900">
            {flag.detail}
            <code className="ml-2 font-mono text-[11px] text-amber-600">
              {flag.flagType}
            </code>
          </p>
        ))}
      </div>

      <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
        <p className="text-xs text-stone-500">
          Row {row.rowIndex}
          {row.sourcePage !== null && ` · page ${row.sourcePage}`}
        </p>
        <p className="mt-0.5 text-sm text-stone-800">{row.description}</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-stone-500">
              Amount
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-36 rounded-md border border-stone-300 px-2 py-1 font-mono text-sm tabular-nums focus:border-stone-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-stone-500">
              Direction
            </span>
            <select
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as "debit" | "credit")
              }
              className="mt-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
            >
              <option value="debit">debit</option>
              <option value="credit">credit</option>
            </select>
          </label>

          <button
            type="button"
            disabled={!changed || saving}
            onClick={() => onSave(row.id, { amount, direction })}
            className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white transition enabled:hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save and re-check"}
          </button>

          <span className="text-xs text-stone-400">
            currently {formatMoney(row.amount, currency)} {row.direction}
          </span>
        </div>
        </div>

        {row.sourcePage !== null && row.sourceBbox !== null && (
          <SourceView
            statementId={statementId}
            workspaceId={workspaceId}
            page={row.sourcePage}
            box={row.sourceBbox}
          />
        )}
      </div>
    </div>
  );
}
