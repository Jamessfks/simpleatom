/**
 * /r/[id] — MACE Link shared result page.
 *
 * Permanent, read-only view of a MACE calculation. Anyone with the URL sees the
 * full result (3D viewer, metrics, provenance, charts, export) — no login.
 *
 * The embeddable form of the same result lives at `/r/[id]/embed`.
 *
 * `loadResult` is wrapped in React's `cache` so `generateMetadata` and the page
 * body share one database read per request instead of two.
 */

import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadResult } from "@/lib/server/share-store";
import { SharingUnavailableError } from "@/lib/supabase";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { SharedResultView } from "./shared-result-view";
import { summarizeShared } from "./result-context";

type Lookup =
  | { state: "found"; shared: NonNullable<Awaited<ReturnType<typeof loadResult>>> }
  | { state: "missing" }
  | { state: "unavailable"; reason: string };

/** One database read per request, shared by generateMetadata and the page. */
const getShared = cache(async (id: string): Promise<Lookup> => {
  try {
    const shared = await loadResult(id);
    return shared ? { state: "found", shared } : { state: "missing" };
  } catch (error) {
    if (error instanceof SharingUnavailableError) return { state: "unavailable", reason: error.message };
    throw error;
  }
});

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Link preview text, built from the stored payload only.
 *
 * A shared link is often read as a preview card before it is read as a page, so
 * the same facts the page leads with — calculation, structure, model, reference
 * convention — go here. Nothing is defaulted: a result stored without a model
 * gets a shorter description, not a guessed one.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const lookup = await getShared(id);

  if (lookup.state !== "found") {
    return {
      title: lookup.state === "missing" ? "Result not found" : "Sharing unavailable",
      robots: { index: false, follow: false },
    };
  }

  const summary = summarizeShared(lookup.shared);
  const description = [
    summary.headline,
    summary.atomCount != null ? `${summary.atomCount} atoms` : null,
    summary.energy ? `total energy ${summary.energy}` : null,
    summary.model,
    summary.convention,
    summary.computedUtc ? `computed ${summary.computedUtc}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: summary.headline,
    description,
    openGraph: { title: `${summary.headline} · SimpleAtom`, description },
  };
}

export default async function SharedResultPage({ params }: Props) {
  const { id } = await params;
  const lookup = await getShared(id);

  // A missing row is a real 404 (app/r/[id]/not-found.tsx); it used to render
  // a "not found" page with HTTP 200.
  if (lookup.state === "missing") notFound();

  if (lookup.state === "unavailable") {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main id="main" className="flex flex-1 items-center justify-center px-6 py-20">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Sharing is unavailable right now
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              The shared result{" "}
              <code className="font-mono text-[var(--color-accent-strong)]">{id}</code>{" "}
              could not be loaded because the MACE Link database is not reachable. The link
              itself is not known to be broken — try again later.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {/* A full reload, not a client navigation: the lookup runs on the server. */}
              <Button asChild>
                <a href={`/r/${encodeURIComponent(id)}`}>Try again</a>
              </Button>
              <Button asChild variant="outline">
                <Link href="/calculate">Run a new calculation</Link>
              </Button>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return <SharedResultView shared={lookup.shared} />;
}
