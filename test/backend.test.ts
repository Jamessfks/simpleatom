import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  assertLoopbackHost,
  assertSameOrigin,
  displayName,
  parseParams,
  structureSuffix,
} from "@/lib/server/backend";

describe("upload names", () => {
  it("reduces a client filename to a bare basename", () => {
    expect(displayName("../../../../tmp/sa-pwn.xyz")).toBe("sa-pwn.xyz");
    expect(displayName("C:\\Users\\me\\ethanol.xyz")).toBe("ethanol.xyz");
    expect(displayName("")).toBe("structure");
  });

  it("maps extensions through the allow-list", () => {
    expect(structureSuffix("silicon.CIF")).toBe(".cif");
    expect(structureSuffix("POSCAR")).toBe(".poscar");
    expect(structureSuffix("run.extxyz")).toBe(".extxyz");
  });

  it("refuses anything else with a 400", () => {
    expect(() => structureSuffix("payload.exe")).toThrow(ApiError);
    try {
      structureSuffix("payload.exe");
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).code).toBe("unsupported_format");
    }
  });
});

describe("parseParams", () => {
  it("accepts a JSON object and nothing else", () => {
    expect(parseParams('{"modelType":"MACE-OFF"}')).toEqual({ modelType: "MACE-OFF" });
    expect(parseParams(null)).toEqual({});
    expect(() => parseParams("[1,2]")).toThrow(ApiError);
    expect(() => parseParams("--model-path")).toThrow(ApiError);
  });
});

describe("cross-site and rebinding guards (D40)", () => {
  const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it("lets same-origin browser requests and non-browser clients through", () => {
    expect(() => assertSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ host: "mace-lake.vercel.app", origin: "https://mace-lake.vercel.app" }))).not.toThrow();
    expect(() => assertSameOrigin(req({ host: "localhost:3000" }))).not.toThrow();
  });

  it("refuses a POST that a different site's page sent", () => {
    for (const origin of ["https://evil.example", "null", "not a url"]) {
      try {
        assertSameOrigin(req({ host: "localhost:3000", origin }));
        expect.unreachable(origin);
      } catch (err) {
        expect((err as ApiError).status).toBe(403);
        expect((err as ApiError).code).toBe("cross_origin");
      }
    }
  });

  it("accepts a custom checkpoint locally only through a loopback host name", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(() => assertLoopbackHost(req({ host }))).not.toThrow();
    }
    // A DNS-rebinding page is same-origin with itself, so only the host name
    // tells it apart from the developer's own browser tab.
    for (const host of ["rebind.evil.example:3000", "192.168.1.20:3000", "localhost.evil.example"]) {
      expect(() => assertLoopbackHost(req({ host }))).toThrow(ApiError);
    }
  });

  it("does not let forwarded headers vouch for a non-loopback client (D94)", () => {
    // X-Forwarded-Host is the client's to set when no proxy is in front.
    expect(() => assertLoopbackHost(req({ host: "192.168.1.20:3000", "x-forwarded-host": "localhost:3000" }))).toThrow(
      ApiError,
    );
    // Next fills X-Forwarded-For from the socket when the client sent none: a LAN peer shows up there.
    expect(() => assertLoopbackHost(req({ host: "localhost:3000", "x-forwarded-for": "192.168.1.9" }))).toThrow(ApiError);
    for (const xff of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(() => assertLoopbackHost(req({ host: "localhost:3000", "x-forwarded-for": xff }))).not.toThrow();
    }
  });

  it("answers python_unavailable when the local Python cannot start, on the synchronous path too (D147)", async () => {
    const { runPythonJson } = await import("@/lib/server/backend");
    const before = process.env.SIMPLEATOM_PYTHON;
    process.env.SIMPLEATOM_PYTHON = "/nonexistent/simpleatom-python";
    try {
      await runPythonJson("calculate_local.py", ["--capabilities"], { profile: "local", timeoutMs: 10_000 });
      expect.unreachable("a missing interpreter must be refused");
    } catch (err) {
      expect((err as ApiError).status).toBe(503);
      expect((err as ApiError).code).toBe("python_unavailable");
    } finally {
      if (before === undefined) delete process.env.SIMPLEATOM_PYTHON;
      else process.env.SIMPLEATOM_PYTHON = before;
    }
  });

  it("binds the dev server to loopback", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.dev).toMatch(/--hostname 127\.0\.0\.1\b/);
  });

  it("binds `npm start` to loopback too (D94: the Host header check is spoofable from the LAN)", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.start).toMatch(/--hostname 127\.0\.0\.1\b/);
  });
});

describe("upload names and benchmark uploads (D96, D99, D100)", () => {
  it("drops bidi and other format controls, as Python's isprintable() does", async () => {
    expect(displayName("evil‮txt.xyz")).toBe("eviltxt.xyz");
    expect(displayName("a‍b⁦c.cif")).toBe("abc.cif");
    expect(displayName("non breaking.xyz")).toBe("nonbreaking.xyz");
    expect(displayName("ethanol.xyz")).toBe("ethanol.xyz");
  });

  it("gives every uploaded structure a distinct id, even when stems collide", async () => {
    const { uniqueUploadIds } = await import("@/lib/server/backend");
    expect(uniqueUploadIds(["a.xyz", "a.cif", "b.xyz", "a.pdb"])).toEqual(["user-a", "user-a-2", "user-b", "user-a-3"]);
  });

  it("never gives a suffixed id that a later stem already uses (D99)", async () => {
    const { uniqueUploadIds } = await import("@/lib/server/backend");
    const ids = uniqueUploadIds(["a.xyz", "a.cif", "a-2.xyz", "a-2.cif"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a hosted benchmark's uploads under Vercel's 4.5 MB request limit", async () => {
    const { profile } = await import("@/lib/contract");
    const { checkUploadTotal } = await import("@/lib/server/backend");
    const cap = (profile("hosted") as { maxBenchmarkUploadBytes: number }).maxBenchmarkUploadBytes;
    expect(cap).toBeLessThanOrEqual(4_500_000);
    expect(() => checkUploadTotal([new Blob([new Uint8Array(cap)]), new Blob(["x"])], cap)).toThrow(ApiError);
    expect(() => checkUploadTotal([new Blob(["x"])], cap)).not.toThrow();
  });
});
