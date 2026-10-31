import { describe, expect, it } from "vitest";
import { ApiError, displayName, parseParams, structureSuffix } from "@/lib/server/backend";

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
