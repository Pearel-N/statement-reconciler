import { notFound } from "next/navigation";

import { UploadPanel } from "@/components/upload-panel";
import { WorkspaceUrlBar } from "@/components/workspace-url-bar";
import { prisma } from "@/lib/prisma";
import { formatBytes } from "@/lib/upload-validation";
import { isValidWorkspaceId } from "@/lib/workspace";

// Reads the database on every request. A cached workspace page would show a
// visitor someone else's statements, or their own from minutes ago.
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  uploaded: "bg-stone-100 text-stone-600",
  parsing: "bg-blue-50 text-blue-700",
  extracting: "bg-blue-50 text-blue-700",
  reconciling: "bg-blue-50 text-blue-700",
  needs_review: "bg-amber-50 text-amber-700",
  verified: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  // A malformed ID is a wrong link, not an empty workspace. Rendering an
  // empty upload screen for it would quietly invite work that goes nowhere.
  if (!isValidWorkspaceId(workspaceId)) {
    notFound();
  }

  const statements = await prisma.statement.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      fileBytes: true,
      status: true,
      errorDetail: true,
      bankName: true,
      createdAt: true,
      _count: { select: { transactions: true, flags: true } },
      // Most recent run only. The history exists so the discrepancy can be
      // watched shrinking; the list only needs where it stands now.
      reconciliations: {
        orderBy: { runAt: "desc" },
        take: 1,
        select: { discrepancy: true, isReconciled: true },
      },
    },
  });

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-6">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-stone-900">
            Statement Reconciler
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          Upload a statement
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
          Every statement is checked against its own declared opening and
          closing balances. If the extracted transactions don&apos;t account
          for the difference, you&apos;ll be shown exactly which rows are
          responsible — not asked to re-read the whole document.
        </p>

        <div className="mt-6">
          <WorkspaceUrlBar workspaceId={workspaceId} />
          <p className="mt-2 text-xs text-stone-500">
            There is no login. This link is the only way back to this
            workspace, so keep it.
          </p>
        </div>

        <div className="mt-8">
          <UploadPanel workspaceId={workspaceId} />
        </div>

        {statements.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs font-medium uppercase tracking-wider text-stone-500">
              Statements
            </h2>
            <ul className="mt-2 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
              {statements.map((statement) => {
                const run = statement.reconciliations[0];
                return (
                  <li key={statement.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm text-stone-800">
                        {statement.filename}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-stone-400">
                        {formatBytes(statement.fileBytes)}
                      </span>
                      <span
                        className={[
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          STATUS_STYLE[statement.status] ??
                            "bg-stone-100 text-stone-600",
                        ].join(" ")}
                      >
                        {statement.status.replace("_", " ")}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-stone-500">
                      {statement.bankName ? `${statement.bankName} · ` : ""}
                      {statement._count.transactions} transactions
                      {run && !run.isReconciled && (
                        <span className="text-amber-700">
                          {" · off by "}
                          {run.discrepancy.toString()}
                          {statement._count.flags > 0 &&
                            ` · ${statement._count.flags} flagged`}
                        </span>
                      )}
                      {run?.isReconciled && (
                        <span className="text-emerald-700">
                          {" · reconciles exactly"}
                        </span>
                      )}
                    </p>

                    {statement.errorDetail && (
                      <p className="mt-1 text-xs leading-relaxed text-red-700">
                        {statement.errorDetail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

          </section>
        )}

        <div className="mt-10 border-t border-stone-200 pt-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-stone-500">
            Not supported, on purpose
          </h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-stone-500">
            Scanned statements with no text layer are declined rather than run
            through OCR. In a tool whose whole claim is verified correctness, a
            misread digit is worse than an honest refusal.
          </p>
        </div>
      </main>
    </div>
  );
}
