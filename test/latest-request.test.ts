import { describe, expect, it } from "vitest";
import { createLatestRequest } from "@/components/calculate/latest-request";

// F27 (d): StructurePreview parsed the first file on click and wrote the result
// into state whenever the parse finished, so a slow parse of an earlier file
// overwrote the preview of a newer one. A request now asks, once its parse is
// done, whether it is still the latest.

describe("createLatestRequest", () => {
  it("a request is the latest until another begins", () => {
    const latest = createLatestRequest();
    const first = latest.begin();
    expect(first()).toBe(true);
    const second = latest.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("cancel makes every request in flight stale", () => {
    const latest = createLatestRequest();
    const first = latest.begin();
    latest.cancel();
    expect(first()).toBe(false);
    const second = latest.begin();
    expect(second()).toBe(true);
  });

  it("keeps separate guards apart", () => {
    const a = createLatestRequest();
    const b = createLatestRequest();
    const fromA = a.begin();
    b.begin();
    b.begin();
    expect(fromA()).toBe(true);
  });

  it("applies only the newest parse when a slow one for an older file finishes last", async () => {
    const latest = createLatestRequest();
    let preview = "";
    const parse = async (name: string, ms: number) => {
      const isLatest = latest.begin();
      await new Promise((resolve) => setTimeout(resolve, ms));
      if (!isLatest()) return;
      preview = name;
    };
    await Promise.all([parse("old-slow.xyz", 30), parse("new-fast.xyz", 5)]);
    expect(preview).toBe("new-fast.xyz");
  });

  it("applies nothing when the file changed mid-parse", async () => {
    const latest = createLatestRequest();
    let preview = "";
    const pending = (async () => {
      const isLatest = latest.begin();
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (isLatest()) preview = "stale";
    })();
    latest.cancel();
    await pending;
    expect(preview).toBe("");
  });
});
