/**
 * Callout — admonition box for docs (note / warning / tip).
 * Presentational only; safe to use inside server-rendered doc pages.
 */

import { Info, TriangleAlert, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

type CalloutType = "note" | "warning" | "tip";

const STYLES: Record<
  CalloutType,
  { icon: typeof Info; ring: string; iconColor: string; label: string }
> = {
  note: {
    icon: Info,
    ring: "border-[var(--color-border-emphasis)] bg-[var(--color-bg-secondary)]",
    iconColor: "text-[var(--color-accent-strong)]",
    label: "Note",
  },
  warning: {
    icon: TriangleAlert,
    ring: "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8",
    iconColor: "text-[var(--color-warning)]",
    label: "Warning",
  },
  tip: {
    icon: Lightbulb,
    ring: "border-[var(--color-accent-primary)]/30 bg-[var(--color-accent-soft)]",
    iconColor: "text-[var(--color-accent-strong)]",
    label: "Tip",
  },
};

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}) {
  const s = STYLES[type];
  const Icon = s.icon;
  return (
    <div className={cn("my-5 flex gap-3 rounded-xl border p-4", s.ring)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.iconColor)} strokeWidth={2} />
      <div className="min-w-0 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        <p className={cn("mb-1 font-semibold", s.iconColor)}>
          {title ?? s.label}
        </p>
        {children}
      </div>
    </div>
  );
}
