import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARE_DISCLOSURE, saveResult } from "@/lib/share";
import { ApiRequestError } from "@/lib/api-client";
import type { CalculationResult } from "@/types/mace";

const result = { status: "success", energy: -1 } as CalculationResult;

afterEach(() => vi.unstubAllGlobals());

// D63: Share used to send `consent: true` unconditionally, so the server's
// consent check (ADR-0024) was satisfied without anyone being asked. Consent
// now exists only as an argument the confirmation step passes.
describe("sharing needs consent from the user (D63)", () => {
  it("does not contact the server unless consent was given", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const err = await saveResult(result, "a.xyz").catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe("consent_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends consent only when it was given, with the filename it was given for", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "Ab3_-xYz09Qw" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await saveResult(result, "a.xyz", true);
    expect(id).toBe("Ab3_-xYz09Qw");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.consent).toBe(true);
    expect(body.filename).toBe("a.xyz");
  });

  it("tells the user what publishing means before they agree", () => {
    expect(SHARE_DISCLOSURE).toMatch(/public/i);
    expect(SHARE_DISCLOSURE).toMatch(/permanent/i);
    expect(SHARE_DISCLOSURE).toMatch(/file ?name/i);
  });
});
