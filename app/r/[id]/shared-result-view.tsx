/**
 * SharedResultView — read-only view of a shared calculation ("MACE Link").
 *
 * THIS PAGE HAS TO STAND ALONE. A reader arrives from a bare URL with no
 * context: they did not choose the model, they did not see the input, and they
 * have no idea whether the number in front of them is comparable to anything
 * else. So the header states, from the stored payload only, WHAT was computed,
 * on WHICH structure, with WHICH model and its energy reference convention, and
 * WHEN — distinguishing when the numbers were produced (the provenance
 * manifest) from when the link was made (the database row). Those are different
 * facts and were previously conflated into one "Shared" date.
 *
 * NOTHING IS DEFAULTED. An earlier version of this file wrote
 * `p.modelType ?? "MACE-MP-0"` and `p.modelSize ?? "medium"`, so a result
 * stored without model metadata was labelled — and CITED — as a MACE-MP-0
 * medium run. A shared calculation whose provenance is guessed is worse than
 * one with a gap in it. Missing fields are now omitted.
 *
 * Provenance and validation ride along inside `result`, so they persist through
 * sharing untouched and MetricsDashboard renders them below (its sections
 * return null when absent). Because a silent absence is indistinguishable from
 * a section that failed to render, this page states which of the two are
 * attached — including when neither is.
 *
 * The dashboard itself is reused verbatim: a shared result is the same result,
 * not a reduced one.
 */

"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, Code2, Copy, ExternalLink, Plus } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MetricsDashboard } from "@/components/calculate/metrics-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { embedPath } from "@/lib/share";
import { FALLBACK_SITE_URL, getSiteUrl } from "@/lib/site";
import { effectiveParams, summarizeShared } from "./result-context";
import type { SharedResult } from "@/types/mace";

interface Props {
  shared: SharedResult;
}

type CopyKey = "link" | "cite" | "embed";

/** Default embed box. Square-ish, because the viewer canvas is square. */
const EMBED_WIDTH = 480;
const EMBED_HEIGHT = 560;

/**
 * Escape a value that is about to sit inside a double-quoted HTML attribute in
 * the copyable embed snippet.
 *
 * The snippet's `title` is built from the structure name, which can be the
 * uploaded FILENAME — attacker-supplied text. Pasted unescaped into a host
 * page, a filename containing a quote would close the attribute and inject
 * markup into someone else's site. Cheap to prevent; not obvious to notice.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The site origin, read hydration-safely.
 *
 * `getSiteUrl()` answers `window.location.origin` in the browser and the
 * env/fallback host on the server, so calling it during render makes the first
 * client render disagree with the server HTML on any host that is not
 * `NEXT_PUBLIC_SITE_URL` — every preview deployment, and localhost. That is
 * precisely what `useSyncExternalStore`'s third argument is for: React uses the
 * server snapshot for the server render AND for hydration, then re-reads the
 * client snapshot, so both passes agree and the copied link still ends up
 * carrying the real origin. The store never changes, so `subscribe` is a no-op.
 */
const SERVER_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL;
const subscribeToNothing = () => () => {};
const readClientOrigin = () => getSiteUrl();
const readServerOrigin = () => SERVER_ORIGIN;

/**
 * Copy-to-clipboard button.
 *
 * Declared at module scope, not inside SharedResultView: a component defined in
 * a render body is a new component type on every render, so React unmounts and
 * remounts it whenever the parent re-renders — which here is the moment you
 * click it, taking the keyboard focus with it.
 */
function CopyButton({
  text,
  copyKey,
  label,
  copied,
  onCopy,
}: {
  text: string;
  copyKey: CopyKey;
  label: string;
  copied: CopyKey | null;
  onCopy: (text: string, key: CopyKey) => void;
}) {
  const done = copied === copyKey;
  return (
    <Button variant="outline" size="sm" onClick={() => onCopy(text, copyKey)}>
      {done ? (
        <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {done ? "Copied" : label}
    </Button>
  );
}

export function SharedResultView({ shared }: Props) {
  const { id, result, filename } = shared;
  const [copied, setCopied] = useState<CopyKey | null>(null);

  const origin = useSyncExternalStore(
    subscribeToNothing,
    readClientOrigin,
    readServerOrigin,
  );

  const url = `${origin}/r/${id}`;
  const embedUrl = `${origin}${embedPath(id)}`;
  const summary = summarizeShared(shared);
  const params = effectiveParams(shared);

  const embedSnippet =
    `<iframe src="${escapeAttribute(`${embedUrl}?no-border=true`)}"\n` +
    `        width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" loading="lazy"\n` +
    `        style="border:0" title="${escapeAttribute(`${summary.headline} · SimpleAtom`)}"></iframe>`;

  /**
   * Citation. Every line is dropped when the fact behind it was not stored, so
   * this text never asserts a model, a convention, or a date that the payload
   * does not contain. "Computed" is the manifest's own ISO-8601 UTC string,
   * quoted verbatim rather than reformatted.
   */
  const citation = [
    "SimpleAtom — a web interface to MACE machine-learning interatomic potentials.",
    summary.calculation || summary.subject
      ? `Calculation: ${[summary.calculation, summary.subject].filter(Boolean).join(" of ")}${
          summary.model ? `, ${summary.model}` : ""
        }${summary.convention ? ` (${summary.convention})` : ""}.`
      : null,
    result.provenance?.timestampUtc
      ? `Computed: ${result.provenance.timestampUtc}`
      : null,
    `Result: ${url}`,
    `Accessed: ${new Date().toISOString().slice(0, 10)} (UTC)`,
  ]
    .filter(Boolean)
    .join("\n");

  async function copyText(text: string, key: CopyKey) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard unavailable (insecure origin, denied permission). The value is
      // on screen and selectable, so there is nothing to recover.
    }
  }

  // ── What the reader is looking at, in one line each ──
  const identity = [
    summary.atomCount != null ? `${summary.atomCount} atoms` : null,
    summary.model,
    summary.convention,
  ].filter(Boolean);

  const timing = [
    summary.computedUtc ? `Computed ${summary.computedUtc}` : null,
    summary.sharedUtc ? `Shared ${summary.sharedUtc} (UTC)` : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main id="main" className="mx-auto max-w-screen-2xl space-y-6 px-6 py-6">
        {/* ── Title: the calculation itself, not the word "result" ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              {summary.headline}
            </h1>
            {identity.length > 0 && (
              <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">
                {identity.join(" · ")}
              </p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {timing.length > 0 ? `${timing.join(" · ")}. ` : ""}
              Read-only snapshot — the calculation is not re-run when this page
              is opened.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CopyButton
              text={url}
              copyKey="link"
              label="Copy link"
              copied={copied}
              onCopy={copyText}
            />
            <Button asChild size="sm">
              <Link href="/calculate">
                <Plus className="h-3.5 w-3.5" />
                New calculation
              </Link>
            </Button>
          </div>
        </div>

        {/* ── Meta bar: only what was stored ── */}
        <div className="flex flex-wrap items-center gap-2">
          {filename && (
            <Badge variant="secondary" className="font-mono">
              {filename}
            </Badge>
          )}
          {summary.model && (
            <Badge className="bg-[var(--color-accent-soft)] font-mono text-[var(--color-accent-strong)]">
              {summary.model}
            </Badge>
          )}
          {params.calculationType && (
            <Badge variant="secondary" className="font-mono">
              {params.calculationType}
            </Badge>
          )}
          {summary.settings.map((chip) => (
            <Badge key={chip} variant="outline" className="font-mono font-normal">
              {chip}
            </Badge>
          ))}
        </div>

        {/* Geometry-opt convergence, stated where it cannot be missed. */}
        {summary.convergence && (
          <p className="font-mono text-xs text-[var(--color-text-secondary)]">
            {summary.convergence}
          </p>
        )}

        {/* ── What travelled with this result ──
            Rendered in both directions on purpose. When the manifest is
            present, the reader is told where to look for it; when it is absent,
            the reader is told that it is absent rather than being left to
            wonder whether a section failed to load. Results stored before these
            fields existed hit the second branch. */}
        <p className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-2.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          {summary.hasProvenance ? (
            <>
              <span className="font-medium text-[var(--color-text-primary)]">
                Reproducibility manifest attached.
              </span>{" "}
              The checkpoint SHA-256, library versions, structure hash, source
              commit and any RNG seed are listed under Provenance below.
            </>
          ) : (
            <>
              <span className="font-medium text-[var(--color-text-primary)]">
                No reproducibility manifest.
              </span>{" "}
              This result was stored before SimpleAtom recorded checkpoint
              hashes and library versions, so which exact weights produced these
              numbers cannot be established from it.
            </>
          )}{" "}
          {summary.hasValidation
            ? "Validator findings are attached and shown under Validation."
            : "No validator findings were stored with it."}
        </p>

        {/* ── Results dashboard (reused verbatim) ── */}
        <MetricsDashboard result={result} filename={filename} />

        {/* ── Share surfaces: embed + citation ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Embed */}
          <div className="space-y-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-5">
            <div className="flex items-center gap-2">
              <Code2
                className="h-4 w-4 text-[var(--color-accent-strong)]"
                strokeWidth={1.75}
              />
              <h2 className="font-serif text-lg font-semibold text-[var(--color-text-primary)]">
                Embed this result
              </h2>
            </div>
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              The interactive viewer, with no site chrome, on a page of its own
              that any site may frame. Presentation is controlled by query
              parameters:{" "}
              <code className="font-mono text-[var(--color-accent-strong)]">
                no-border=true
              </code>{" "}
              drops the frame,{" "}
              <code className="font-mono text-[var(--color-accent-strong)]">
                caption=false
              </code>{" "}
              hides the caption strip.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-[var(--color-bg-secondary)] p-4 font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {embedSnippet}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                text={embedSnippet}
                copyKey="embed"
                label="Copy embed code"
                copied={copied}
                onCopy={copyText}
              />
              <Button asChild variant="ghost" size="sm">
                <a href={embedPath(id)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open embed
                </a>
              </Button>
            </div>
          </div>

          {/* Citation */}
          <div className="space-y-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-5">
            <h2 className="font-serif text-lg font-semibold text-[var(--color-text-primary)]">
              Cite this result
            </h2>
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              Built only from what this result carries — a line is omitted
              rather than filled in with a default.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-[var(--color-bg-secondary)] p-4 font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {citation}
            </pre>
            <CopyButton
              text={citation}
              copyKey="cite"
              label="Copy citation"
              copied={copied}
              onCopy={copyText}
            />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
