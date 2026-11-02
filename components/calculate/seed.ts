/**
 * The MD random seed, as typed.
 *
 * Blank means "do not send one": the backend then uses its documented default
 * (42), so a trajectory is reproducible without the user choosing a number.
 * Anything else must be a whole number the contract accepts; the Python
 * backend refuses the rest, and the box says so before the run is submitted.
 */

export interface SeedInput {
  value: number | undefined;
  error: string | null;
}

export function parseSeed(raw: string, min: number, max: number): SeedInput {
  const text = raw.trim();
  if (text === "") return { value: undefined, error: null };
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    // NaN, not undefined: the request check refuses it and the run stays
    // blocked. Undefined would quietly run the default seed while the box
    // shows something else.
    return { value: NaN, error: `Enter a whole number from ${min} to ${max}, or leave it blank. The run is blocked until then.` };
  }
  return { value: n, error: null };
}
