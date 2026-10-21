/** Shown while a shared result is read on the server. */
export default function SharedResultLoading() {
  return (
    <main id="main" className="mx-auto max-w-screen-2xl px-6 py-16" aria-busy="true">
      <p className="text-sm text-text-secondary">Loading shared result…</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="h-40 rounded-2xl bg-bg-secondary motion-safe:animate-pulse" />
        <div className="h-40 rounded-2xl bg-bg-secondary motion-safe:animate-pulse" />
      </div>
    </main>
  );
}
