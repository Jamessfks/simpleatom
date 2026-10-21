/**
 * /r/[id]/embed — the embeddable form of a MACE Link.
 *
 * WHAT THIS IS FOR
 *   A single calculation that can be dropped into someone else's page. The bar
 *   (docs/v2/bars/rowan.md) ships exactly this primitive —
 *   `labs.rowansci.com/iframe2/calculation/<uuid>?auto-rotate=true&no-border=true`
 *   — and embeds it in its own marketing hero, so the comparison is direct:
 *   a bare interactive viewer, no page chrome, presentation controlled by query
 *   parameters, framable cross-origin.
 *
 * WHY A SUB-ROUTE AND NOT `?embed=1` ON /r/[id]
 *   Response headers are matched on the PATH. `next.config.ts` has to give this
 *   view a `frame-ancestors` policy that the rest of the site must not have,
 *   and a query string cannot carry that: `/r/<id>?embed=1` and `/r/<id>` are
 *   the same path, so relaxing framing for one relaxes it for both — and for
 *   the whole site if the policy is set site-wide. A distinct path is the only
 *   way to scope the exemption. It also caches as its own resource instead of
 *   needing `Vary`, and it keeps query parameters free for what they are good
 *   at, which is presentation — the same split the bar uses.
 *
 * QUERY PARAMETERS (presentation only — none of them change a number)
 *   `no-border=true`  drop the frame and rounding, for a host page that draws
 *                     its own container.
 *   `caption=false`   hide the caption strip and show the viewer alone.
 *
 *   Deliberately ABSENT: `auto-rotate`. The bar has it; MoleculeViewer3D takes
 *   no prop for it and that component belongs to another piece, so accepting
 *   the parameter here would mean accepting it and doing nothing. A parameter
 *   that is silently ignored is worse than one that is not offered.
 *
 * WHAT SURVIVES INTO THE EMBED
 *   The caption states the subject, the calculation, the energy WITH its unit,
 *   the model AND its energy reference convention (a MACE-MP-0 total energy and
 *   a MACE-OFF total energy are not comparable numbers), when it was computed,
 *   and the checkpoint hash when one was recorded. Everything comes from the
 *   stored payload; anything absent is omitted, not filled in. The full
 *   provenance manifest is one click away on the page this embed came from.
 */

import type { Metadata } from "next";
import { loadResult } from "@/lib/server/share-store";
import { SharingUnavailableError } from "@/lib/supabase";
import { MoleculeViewer3D } from "@/components/calculate/molecule-viewer-3d";
import { hasStructure, summarizeShared } from "../result-context";

/**
 * Not indexable: it is the same calculation as `/r/[id]`, without the context.
 * The page it came from is the one search engines should hold.
 */
export const metadata: Metadata = {
  title: "Embedded MACE result",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}

/**
 * Query-parameter truthiness, matching how flags are written in URLs by hand:
 * a bare `?no-border`, `=`, `=true` and `=1` all mean on; `=false` and `=0`
 * mean off; anything else falls back to `fallback`.
 */
function flag(
  raw: string | string[] | undefined,
  fallback: boolean,
): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

/** Shared shell so every state of the embed has the same box. */
function EmbedShell({
  bordered,
  children,
}: {
  bordered: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex min-h-[100svh] flex-col overflow-y-auto bg-bg-elevated ${
        bordered
          ? "rounded-lg border border-border-subtle"
          : ""
      }`}
    >
      {children}
    </div>
  );
}

function EmbedMessage({
  bordered,
  title,
  detail,
  href,
}: {
  bordered: boolean;
  title: string;
  detail: string;
  href?: string;
}) {
  return (
    <EmbedShell bordered={bordered}>
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="space-y-1.5">
          <p className="font-serif text-sm font-semibold text-text-primary">
            {title}
          </p>
          <p className="text-xs leading-relaxed text-text-secondary">
            {detail}
          </p>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-mono text-xs text-accent-strong underline underline-offset-2"
            >
              Open on SimpleAtom
            </a>
          )}
        </div>
      </div>
    </EmbedShell>
  );
}

export default async function EmbeddedResultPage({
  params,
  searchParams,
}: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const bordered = !flag(query["no-border"], false);
  const showCaption = flag(query["caption"], true);

  let shared: Awaited<ReturnType<typeof loadResult>>;
  try {
    shared = await loadResult(id);
  } catch (error) {
    if (!(error instanceof SharingUnavailableError)) throw error;
    // An outage is not a missing result: say which one it is (R1).
    return (
      <EmbedMessage
        bordered={bordered}
        title="Sharing is unavailable right now"
        detail="The MACE Link database could not be reached. The link is not known to be broken — try again later."
      />
    );
  }

  if (!shared) {
    return (
      <EmbedMessage
        bordered={bordered}
        title="Result not available"
        detail={`No shared MACE calculation with the id ${id}. It may have been removed.`}
      />
    );
  }

  const { result } = shared;
  const summary = summarizeShared(shared);
  const fullUrl = `/r/${id}`;

  if (result.status !== "success") {
    return (
      <EmbedMessage
        bordered={bordered}
        title="This calculation did not complete"
        detail={
          result.message ??
          `The stored result has status "${result.status ?? "unknown"}", so there is no structure to show.`
        }
        href={fullUrl}
      />
    );
  }

  if (!hasStructure(result)) {
    return (
      <EmbedMessage
        bordered={bordered}
        title="No coordinates stored"
        detail="This result was saved without atomic positions, so it cannot be rendered in 3D. The energies and forces are on the full page."
        href={fullUrl}
      />
    );
  }

  return (
    <EmbedShell bordered={bordered}>
      {/*
        VIEWER. MoleculeViewer3D draws no surface of its own by contract — its
        caller owns the background — and its canvas is `aspect-square` capped at
        520 px. In an iframe the host owns the box, so the width is additionally
        capped by the available height: without that, an 800x450 hero-sized
        frame gets an 800 px-wide square and the caption lands below the fold.
        `overflow-y-auto` on the shell is the backstop, so a cap the browser
        rejects costs a scroll rather than hiding anything.
      */}
      <div className="flex flex-1 items-center justify-center p-2">
        <div
          className={`mx-auto w-full ${
            // Both strings are written out in full: Tailwind generates
            // utilities by scanning the source text, so a class assembled from
            // fragments at runtime would name a rule that was never emitted.
            // The reserve covers the viewer's own toolbar plus the caption.
            showCaption
              ? "max-w-[min(100%,calc(100svh_-_7rem))]"
              : "max-w-[min(100%,calc(100svh_-_3.5rem))]"
          }`}
        >
          <MoleculeViewer3D result={result} />
        </div>
      </div>

      {showCaption && (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-t border-border-subtle px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-sans text-xs font-semibold text-text-primary">
              {summary.headline}
              {summary.atomCount != null && (
                <span className="font-normal text-text-secondary">
                  {" "}
                  · {summary.atomCount} atoms
                </span>
              )}
            </p>
            <p className="mt-0.5 font-mono text-xs leading-snug text-text-secondary">
              {[
                summary.energy,
                summary.energyPerAtom,
                summary.model,
                summary.convention,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-0.5 font-mono text-xs leading-snug text-text-muted">
              {[
                summary.computedUtc
                  ? `Computed ${summary.computedUtc}`
                  : summary.sharedUtc
                    ? `Shared ${summary.sharedUtc}`
                    : null,
                summary.checkpointSha
                  ? `checkpoint ${summary.checkpointSha.slice(0, 12)}…`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {/* Attribution and the route back to the full record, as on the bar's
              embed. `target="_blank"` because this document is normally inside
              somebody else's frame. */}
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-full border border-border-subtle px-2.5 py-1 font-mono text-xs font-medium text-accent-strong transition-colors hover:border-accent-primary hover:bg-accent-soft"
          >
            SimpleAtom ↗
          </a>
        </div>
      )}
    </EmbedShell>
  );
}
