/**
 * MACE Link — what both the browser and the server need to know about a
 * shared result: its id format, its embed path, how a stored payload is
 * normalised for display, and how the calculator publishes one.
 *
 * Storage lives server-side only (lib/server/share-store.ts, behind
 * POST /api/share and the /r/[id] pages). The browser used to insert rows
 * straight into Supabase with the public anon key, which let anyone list,
 * flood or forge the table (docs/adr/0024). This module no longer imports a
 * database client at all, so none ships to the browser.
 */

import { getSiteUrl } from "@/lib/site";
import { ApiRequestError, readError } from "@/lib/api-client";
import type { CalculationResult, SharedResult } from "@/types/mace";

/** Shared-result ids: nanoid(8) for older links, 12-char base64url now. */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

/**
 * What the user is told before a result is published. Shown by the calculator's
 * confirmation step; the server stores exactly this much (coordinates, forces,
 * the file name and the results) and cannot delete it from the app.
 */
export const SHARE_DISCLOSURE =
  "Anyone with the link can see this structure's atomic coordinates, its file name and the full results. " +
  "The link is public and permanent: it cannot be deleted from the app.";

/**
 * Publish a calculation result and return its shareable URL.
 *
 * `consent` is the user's answer to SHARE_DISCLOSURE and has no default: the
 * request is not made without it (the server would refuse it too, ADR-0024).
 * The server validates the payload, stores it, and chooses the id. Only the
 * result's own `params` (what actually ran) are stored — never a second,
 * client-supplied copy that could disagree with it.
 */
export async function saveResult(
  result: CalculationResult,
  filename?: string,
  consent?: boolean,
): Promise<{ id: string; url: string }> {
  if (consent !== true) {
    throw new ApiRequestError("Confirm that you want to publish this result first.", 400, "consent_required", "consent");
  }
  const response = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result, filename: filename ?? null, consent: true }),
  });
  if (!response.ok) throw await readError(response, "Could not create the share link");
  const { id } = (await response.json()) as { id?: string };
  if (!id || !SHARE_ID_PATTERN.test(id)) {
    throw new ApiRequestError("The share service returned no link.", 502, "share_failed");
  }
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
 * pulls in more than plain constants).
 */
export function embedPath(id: string): string {
  return `/r/${id}/embed`;
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
