import { Loader2 } from "lucide-react";

export default function BenchmarkLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-primary)]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent-strong)]" />
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          Loading benchmark suite...
        </p>
      </div>
    </div>
  );
}
