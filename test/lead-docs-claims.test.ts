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
  });

  it("has the Unreleased section it points to (D161)", () => {
    if (/see Unreleased/.test(changelog)) expect(changelog).toMatch(/^## \[Unreleased\]/m);
  });

  it("gives the science critic no unsourced eV/atom band (D85)", () => {
    expect(critic).not.toMatch(/0\.1[–-]0\.5 eV\/atom/);
  });
});
