/**
 * Shown the instant a navigation starts.
 *
 * These pages read the database on every request, and the database is in a
 * different region from the functions serving them. Without this file the
 * App Router waits for the server before painting anything, so a click looks
 * like nothing happened — which reads as broken rather than slow.
 */
export default function Loading() {
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
        <div className="h-8 w-64 animate-pulse rounded bg-stone-200" />
        <div className="mt-4 h-4 w-full max-w-xl animate-pulse rounded bg-stone-100" />
        <div className="mt-2 h-4 w-3/4 max-w-lg animate-pulse rounded bg-stone-100" />
        <div className="mt-8 h-11 w-full animate-pulse rounded-lg bg-stone-100" />
        <div className="mt-8 h-48 w-full animate-pulse rounded-xl bg-stone-100" />
      </main>
    </div>
  );
}
