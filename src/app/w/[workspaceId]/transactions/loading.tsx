export default function Loading() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-stone-900">
            Statement Reconciler
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="h-8 w-48 animate-pulse rounded bg-stone-200" />
        <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded bg-stone-100" />
        <div className="mt-6 h-40 w-full animate-pulse rounded-lg bg-stone-100" />
        <div className="mt-6 h-64 w-full animate-pulse rounded-lg bg-stone-100" />
      </main>
    </div>
  );
}
