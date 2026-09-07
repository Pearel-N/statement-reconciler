export default function Loading() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-6">
          <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-stone-900">
            Statement Reconciler
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="h-3 w-24 animate-pulse rounded bg-stone-100" />
        <div className="mt-5 h-8 w-56 animate-pulse rounded bg-stone-200" />
        <div className="mt-3 h-4 w-80 animate-pulse rounded bg-stone-100" />
        <div className="mt-6 h-20 w-full animate-pulse rounded-lg bg-stone-100" />
        <div className="mt-8 h-40 w-full animate-pulse rounded-lg bg-stone-100" />
      </main>
    </div>
  );
}
