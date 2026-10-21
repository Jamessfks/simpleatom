import { Loader2 } from "lucide-react";

export default function BenchmarkLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-accent-strong" />
        <p className="font-mono text-xs text-text-muted">
          Loading benchmark suite...
        </p>
      </div>
    </div>
  );
}
