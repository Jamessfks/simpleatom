import { describe, expect, it, vi } from "vitest";

// D64 remainder: the share route answered 500 (a TypeError on `null.positions`)
// for `trajectory: null`. A malformed result is the client's mistake: 400.
vi.mock("@/lib/server/share-store", () => ({
  SharingUnavailableError: class extends Error {},
  insertSharedResult: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/share/route";
import { NextRequest } from "next/server";

const frame = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const result = (extra: Record<string, unknown>) => ({
  status: "success",
  energy: -1,
  symbols: ["O", "H", "H"],
  positions: frame,
  forces: frame,
  ...extra,
});

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost:3000/api/share", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
      body: JSON.stringify({ result: body, filename: "a.xyz", consent: true }),
    }),
  );
}

describe("POST /api/share refuses a malformed trajectory with a 400, never a 500 (D64)", () => {
  it("trajectory: null", async () => {
    const res = await post(result({ trajectory: null }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.field ?? "").toMatch(/trajectory/);
  });

  it("trajectory: {}", async () => {
    expect((await post(result({ trajectory: {} }))).status).toBe(400);
  });

  it("answers in the common error shape, with a code a client can act on", async () => {
    for (const trajectory of [null, {}, [], "x", { energies: [1] }]) {
      const res = await post(result({ trajectory }));
      expect(res.status, JSON.stringify(trajectory)).toBe(400);
      const body = await res.json();
      expect(body.status).toBe("error");
      expect(typeof body.message).toBe("string");
      expect(body.error).toMatchObject({ code: "invalid_result", field: "result.trajectory" });
      expect(typeof body.error.message).toBe("string");
    }
  });

  it("a well-formed trajectory is stored", async () => {
    const res = await post(result({ trajectory: { energies: [1, 2], step: [0, 1], positions: [frame, frame] } }));
    expect(res.status).toBe(201);
  });
});
