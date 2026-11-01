import { afterEach, describe, expect, it, vi } from "vitest";

// MACE_API_URL is read when lib/server/backend is first imported, so each test
// imports a fresh copy with the hosted environment in place.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("hosted synchronous path (D41)", () => {
  it("forwards the visitor's IP with the proxy key, so visitors do not share one rate-limit slot", async () => {
    vi.stubEnv("MACE_API_URL", "https://backend.example");
    vi.stubEnv("MACE_API_TOKEN", "test-proxy-key");
    const sent: Headers[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      return new Response(JSON.stringify({ status: "success", energy: -1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { calculate } = await import("@/lib/server/backend");

    await calculate(
      { data: new Blob(["1\n\nH 0 0 0\n"]), name: "h.xyz" },
      { calculationType: "single-point" },
      { profile: "hosted", timeoutMs: 5_000, ip: "203.0.113.7" },
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].get("x-simpleatom-client-ip")).toBe("203.0.113.7");
    expect(sent[0].get("x-simpleatom-proxy-key")).toBe("test-proxy-key");
  });
});

describe("local interpreter", () => {
  it("spawns the interpreter SIMPLEATOM_PYTHON names, and python3 otherwise", async () => {
    const { pythonExecutable } = await import("@/lib/server/backend");
    vi.stubEnv("SIMPLEATOM_PYTHON", "/opt/simpleatom/venv/bin/python");
    expect(pythonExecutable()).toBe("/opt/simpleatom/venv/bin/python");
    vi.stubEnv("SIMPLEATOM_PYTHON", "  ");
    expect(pythonExecutable()).toBe("python3");
  });
});
