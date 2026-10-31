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

  it("binds the dev server to loopback", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.dev).toMatch(/--hostname 127\.0\.0\.1\b/);
  });
});
