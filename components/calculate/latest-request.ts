/**
 * A guard for async work whose result should only be used if nothing newer has
 * started since (F27, D69).
 *
 * StructurePreview parses the first uploaded file when the user clicks, and the
 * parse takes as long as the file is big. Without this, a slow parse of an
 * earlier file finished after a newer file's preview and wrote over it.
 *
 *     const isLatest = latest.begin();
 *     const parsed = await parse(file);
 *     if (!isLatest()) return; // a newer request began, or the input was reset
 *
 * `cancel()` makes every request in flight stale: call it when the input they
 * were started for is gone (the files changed, the panel closed).
 */
export interface LatestRequest {
  /** Start a request. The function it returns says whether it is still the latest. */
  begin(): () => boolean;
  /** Make every request begun so far stale. */
  cancel(): void;
}

export function createLatestRequest(): LatestRequest {
  let current = 0;
  return {
    begin() {
      const mine = ++current;
      return () => mine === current;
    },
    cancel() {
      current++;
    },
  };
}
