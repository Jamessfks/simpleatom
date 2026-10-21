import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";

/** 404 for a MACE Link id with no stored result. */
export default function SharedResultNotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Result not found
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            No shared result exists at this address. Check the link, or run the calculation again.
          </p>
          <Button asChild className="mt-2">
            <Link href="/calculate">Run a new calculation</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
