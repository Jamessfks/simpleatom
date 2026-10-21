/**
 * The one MACE Link error the UI distinguishes: sharing cannot work right
 * now — not configured, or the database is unreachable. Storage itself lives
 * in lib/server/share-store.ts (server-only).
 *
 * The client used to be built at module scope from `process.env...!`, so a
 * checkout without NEXT_PUBLIC_SUPABASE_* threw on import and took down every
 * page that imported sharing, including the production build.
 */
export class SharingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharingUnavailableError";
  }
}
