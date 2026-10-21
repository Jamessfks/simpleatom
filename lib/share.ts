/**
 * MACE Link — persist and retrieve shared calculation results.
 *
 * Uses Supabase `shared_results` table (jsonb) with nanoid-generated 8-char IDs.
 * Results are publicly readable (RLS policy) so anyone with the URL can view them.
 *
 * ── Supabase SQL (run once in the Supabase SQL editor) ──────────────────────
 *
 *   create table shared_results (
 *     id text primary key,
 *     result jsonb not null,
 *     params jsonb not null default '{}',
 *     filename text,
 *     created_at timestamptz not null default now()
 *   );
 *   alter table shared_results enable row level security;
 *   create policy "Anyone can read shared results"
 *     on shared_results for select using (true);
 *   create policy "Anyone can insert shared results"
 *     on shared_results for insert with check (true);
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

import { nanoid } from "nanoid";
import { getSupabase, SharingUnavailableError } from "@/lib/supabase";
import { getSiteUrl } from "@/lib/site";
import type { CalculationResult, CalculationParams, SharedResult } from "@/types/mace";

/** Save a calculation result and return its shareable URL. */
export async function saveResult(
  result: CalculationResult,
  params: Partial<CalculationParams>,
  filename?: string
): Promise<{ id: string; url: string }> {
  const id = nanoid(8);

  const { error } = await getSupabase().from("shared_results").insert({
    id,
    result,
    params,
    filename: filename ?? null,
  });

  if (error) throw new Error(`Failed to save result: ${error.message}`);

  return { id, url: `${getSiteUrl()}/r/${id}` };
}

/**
 * Path of the embeddable form of a shared result, relative to the site origin.
 *
 * A sub-route rather than a query parameter because response headers are
 * matched on the path: the framing exemption in `next.config.ts` can only be
 * scoped to this view if this view has a path of its own (see the header
 * comment in app/r/[id]/embed/page.tsx). Keep this in step with that route and
 * with the `headers()` sources in next.config.ts — the string is spelled out in
 * all three places because next.config cannot import from here (this module
 * pulls in the Supabase client).
 */
export function embedPath(id: string): string {
  return `/r/${id}/embed`;
}

/** Shared-result ids: nanoid(8) today; anything else is not a row we wrote. */
const SHARE_ID = /^[A-Za-z0-9_-]{6,32}$/;

/**
 * Load a previously shared result by ID.
 *
 * Returns null ONLY when the row does not exist. Any other failure — sharing
 * not configured, the database paused or unreachable — throws
 * SharingUnavailableError. Every error used to map to null, so an outage
 * rendered "this result doesn't exist" for links that were fine (R1).
 *
 * Normalizes the stored payload on the way out — see `normalizeSharedResult()`
 * for exactly what that means and, more importantly, what it does not.
 */
export async function loadResult(id: string): Promise<SharedResult | null> {
  if (!SHARE_ID.test(id)) return null;
  const { data, error } = await getSupabase()
    .from("shared_results")
    .select("id, result, params, filename, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new SharingUnavailableError(
      `The MACE Link database could not be reached (${error.message || "unknown error"}).`,
    );
  }
  if (!data) return null;

  return normalizeSharedResult(data as SharedResult);
}

/**
 * True when a nested object holds at least one value worth rendering.
 *
 * Recursive because the provenance manifest is a tree of optional groups whose
 * every leaf is nullable by design: the backend writes `null` for anything it
 * could not measure rather than inventing it (mace-api/provenance.py). A
 * manifest of nothing but nulls is therefore possible, and is not content.
 */
function hasRenderableLeaf(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasRenderableLeaf);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasRenderableLeaf);
  }
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * Make a stored payload safe for a reader that predates — or postdates — it.
 *
 * `result.provenance` and `result.validation` were added after MACE Link
 * shipped, so rows written earlier do not have them, and the UI must render
 * nothing at all rather than an empty section. Absent keys already do that.
 * What this guards is the middle case: a payload where the key EXISTS but says
 * nothing — a manifest of all-null leaves, or a validation object with no
 * `status`. Both would draw a headed, empty card, and the validation one would
 * additionally claim the validator was unavailable, which for a row that simply
 * predates validation is a false statement about a run nobody can re-inspect.
 *
 * This only ever DELETES a contentless key. It never adds a field, never fills
 * a null, and never changes a number — a shared result must keep saying exactly
 * what it said when it was stored.
 *
 * Exported so it can be exercised directly against hand-built legacy payloads.
 */
export function normalizeSharedResult(shared: SharedResult): SharedResult {
  const result = shared.result;
  if (!result || typeof result !== "object") return shared;

  const dropProvenance =
    "provenance" in result &&
    !hasRenderableLeaf({
      // `schemaVersion` and `paramsRef` describe the manifest, not the run, so
      // a manifest carrying only those two is still empty on screen.
      ...result.provenance,
      schemaVersion: undefined,
      paramsRef: undefined,
    });

  const status = result.validation?.status;
  const dropValidation =
    "validation" in result && status !== "ran" && status !== "unavailable";

  if (!dropProvenance && !dropValidation) return shared;

  const next: CalculationResult = { ...result };
  if (dropProvenance) delete next.provenance;
  if (dropValidation) delete next.validation;

  return { ...shared, result: next };
}
