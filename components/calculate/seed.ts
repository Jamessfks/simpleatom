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
    return { value: undefined, error: `Enter a whole number from ${min} to ${max}, or leave it blank. Until then the default seed is used.` };
  }
  return { value: n, error: null };
}
