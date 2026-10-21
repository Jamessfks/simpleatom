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
    ring: "border-border-emphasis bg-bg-secondary",
    iconColor: "text-accent-strong",
    label: "Note",
  },
  warning: {
    icon: TriangleAlert,
    ring: "border-warning/30 bg-warning/8",
    iconColor: "text-warning",
    label: "Warning",
  },
  tip: {
    icon: Lightbulb,
    ring: "border-accent-primary/30 bg-accent-soft",
    iconColor: "text-accent-strong",
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
      <div className="min-w-0 text-sm leading-relaxed text-text-secondary">
        <p className={cn("mb-1 font-semibold", s.iconColor)}>
          {title ?? s.label}
        </p>
        {children}
      </div>
    </div>
  );
}
