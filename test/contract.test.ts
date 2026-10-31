import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_TYPE,
  checkCalculationParams,
  findModel,
  modelSizes,
  type ProfileName,
} from "@/lib/contract";

interface Case {
  name: string;
  profile: ProfileName;
  params: Record<string, unknown>;
  hasModelFile?: boolean;
  expect: string;
}

const { cases } = JSON.parse(readFileSync("test/fixtures/contract-requests.json", "utf8")) as { cases: Case[] };

describe("checkCalculationParams agrees with mace-api/contract.py on every fixture", () => {
  afterEach(() => {
    delete process.env.ALLOW_CUSTOM_MODELS;
  });
  it.each(cases)("$name", (c) => {
    const violation = checkCalculationParams(c.params, c.profile, c.hasModelFile ?? false);
    expect(violation?.code ?? "ok").toBe(c.expect);
  });
});

describe("model registry", () => {
  it("defaults to MACE-MPA-0, MIT-licensed", () => {
    expect(DEFAULT_MODEL_TYPE).toBe("MACE-MPA-0");
    expect(findModel(DEFAULT_MODEL_TYPE)?.license.id).toBe("MIT");
  });
  it("resolves the MACE-OFF23 alias to the canonical id", () => {
    expect(findModel("MACE-OFF23")?.id).toBe("MACE-OFF");
  });
  it("lists MPA-0 in one size only", () => {
    expect(modelSizes("MACE-MPA-0")).toEqual(["medium"]);
  });
  it("pins every foundation checkpoint by SHA-256", () => {
    for (const model of ["MACE-MPA-0", "MACE-MP-0", "MACE-OFF"]) {
      for (const size of modelSizes(model)) {
        const spec = (findModel(model)!.sizes as Record<string, { sha256: string }>)[size];
        expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
