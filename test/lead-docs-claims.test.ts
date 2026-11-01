import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D84 and D161 residuals, and the D85 band in the science critic's brief.
const read = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
const readme = read("README.md");
const contributing = read("CONTRIBUTING.md");
const changelog = readFileSync("CHANGELOG.md", "utf8");
const critic = read(".claude/agents/science-critic.md");

describe("what the repository's own docs claim", () => {
  it("does not say only pinned checkpoints are ever unpickled without the local opt-in (D84)", () => {
    expect(readme).not.toMatch(/Only pinned checkpoints are ever unpickled\./);
    expect(readme).toMatch(/ALLOW_CUSTOM_MODELS=1/);
    expect(changelog.replace(/\s+/g, " ")).not.toMatch(/are ever unpickled; custom/);
  });

  it("does not claim CI runs on every push or gates every merge (D161)", () => {
    expect(contributing).not.toMatch(/every push/);
    expect(readme).not.toMatch(/CI gates every merge/);
    expect(changelog).not.toMatch(/CI on every push/);
    expect(read("docs/adr/0030-mace-v1-migration.md")).not.toMatch(/on every push/);
  });

  it("has the Unreleased section it points to (D161)", () => {
    if (/see Unreleased/.test(changelog)) expect(changelog).toMatch(/^## \[Unreleased\]/m);
  });

  it("gives the science critic no unsourced eV/atom band (D85)", () => {
    expect(critic).not.toMatch(/0\.1[–-]0\.5 eV\/atom/);
  });
});

describe("batch-5 doc facts (D168-D172)", () => {
  const claude = read("CLAUDE.md");
  it("states the overlap threshold the contract enforces (D168)", () => {
    expect(claude).not.toMatch(/overlap < 0\.4/);
    expect(claude).toMatch(/overlap < 0\.5 Å/);
  });

  it("points the unrelaxed and golden ethanol at the fixture, not the demo (D169)", () => {
    expect(read("docs/adr/0032-molecular-vibrations-thermochemistry.md")).toMatch(/unrelaxed `test\/fixtures\/ethanol-golden\.xyz`/);
    expect(read(".claude/skills/verify-science/SKILL.md")).toMatch(/test\/fixtures\/ethanol-golden\.xyz/);
  });

  it("gives the strained file's measured force (D170)", () => {
    const evidence = read("docs/v2/evidence/2026-11-01/demo-ethanol/README.md");
    expect(evidence).not.toMatch(/1\.69 eV\/Å/);
    expect(evidence).toMatch(/2\.04 eV\/Å/);
  });

  it("binds a local uvicorn to loopback and says custom models never go on another bind (D171)", () => {
    for (const doc of [claude, read("mace-api/README.md")]) {
      expect(doc).toMatch(/uvicorn main:app[^\n]*--host 127\.0\.0\.1/);
      expect(doc).toMatch(/ALLOW_CUSTOM_MODELS[^.]*never[^.]*(non-loopback|0\.0\.0\.0)/i);
    }
  });

  it("quotes the demo ethanol's agreement with CCCBDB in full, O-H and H-O-C included", () => {
    for (const doc of ["docs/v2/CONTINUE.md", "docs/v2/reports/morning-2026-11-01.md"]) {
      const text = read(doc);
      if (/CCCBDB/.test(text)) expect(text).toMatch(/O–H/);
    }
  });

  it("lists every CLAUDE.md rule change for the owner, the device policy included (D172)", () => {
    const report = read("docs/v2/reports/morning-2026-11-01.md");
    for (const topic of [/device/i, /isolated atoms/, /0\.1–0\.5/, /timestep/i, /validator/i]) expect(report).toMatch(topic);
    expect(report).not.toMatch(/No other rule text changed\./);
  });
});
