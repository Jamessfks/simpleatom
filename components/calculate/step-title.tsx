import { CardTitle } from "@/components/ui/card";

/**
 * Title of one configuration step on the calculator. The numbers mean
 * something: a calculation is set up in this order — structure, then model,
 * then what to compute.
 */
export function StepTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-3 font-serif text-xl font-semibold">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-sans text-sm font-semibold text-accent-strong"
      >
        {step}
      </span>
      {children}
    </CardTitle>
  );
}
