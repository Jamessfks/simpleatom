/**
 * Supabase client for MACE Link — created on first use, not at import.
 *
 * It used to be built at module scope from `process.env...!`, so a deployment
 * (or a fresh checkout) without the two NEXT_PUBLIC_SUPABASE_* variables threw
 * on import and took down every page that imported sharing — including
 * /calculate and the production build itself. Now a missing configuration is
 * a typed error raised only when sharing is actually used.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Sharing cannot work right now: not configured, or the database is unreachable. */
export class SharingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharingUnavailableError";
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new SharingUnavailableError("MACE Link sharing is not configured on this deployment.");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
