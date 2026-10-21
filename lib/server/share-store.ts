/**
 * MACE Link storage — server-only (docs/adr/0024).
 *
 * Reads and writes go through this module, called by POST /api/share and the
 * /r/[id] pages, never by the browser. With SUPABASE_SERVICE_ROLE_KEY set,
 * it uses that key and the anon role needs no table access at all
 * (supabase/migrations/0003_lockdown.sql); without it, it falls back to the
 * public anon key and the original permissive policies, so a deployment keeps
 * working until the key is configured.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SharingUnavailableError } from "@/lib/supabase";
import { SHARE_ID_PATTERN, normalizeSharedResult } from "@/lib/share";
import type { SharedResult } from "@/types/mace";

let client: SupabaseClient | null = null;

function store(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new SharingUnavailableError("MACE Link sharing is not configured on this deployment.");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/**
 * Load a shared result by id.
 *
 * Returns null ONLY when the row does not exist. Any other failure — sharing
 * not configured, the database paused or unreachable — throws
 * SharingUnavailableError. Every error used to map to null, so an outage
 * rendered "this result doesn't exist" for links that were fine (R1).
 */
export async function loadResult(id: string): Promise<SharedResult | null> {
  if (!SHARE_ID_PATTERN.test(id)) return null;
  const { data, error } = await store()
    .from("shared_results")
    .select("id, result, params, filename, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new SharingUnavailableError(
      `The MACE Link database could not be reached (${error.message || "unknown error"}).`,
    );
  }
  return data ? normalizeSharedResult(data as SharedResult) : null;
}

export interface NewSharedRow {
  id: string;
  result: unknown;
  params: unknown;
  filename: string | null;
  size_bytes: number;
}

/** Insert one validated row. A duplicate id surfaces as an error, never an overwrite. */
export async function insertSharedResult(row: NewSharedRow): Promise<void> {
  const { size_bytes, ...base } = row;
  let { error } = await store().from("shared_results").insert({ ...base, size_bytes });
  // Before migration 0002 the size column does not exist; store without it.
  if (error && /size_bytes/.test(error.message)) {
    ({ error } = await store().from("shared_results").insert(base));
  }
  if (error) {
    throw new SharingUnavailableError(`Could not save the shared result (${error.message}).`);
  }
}
