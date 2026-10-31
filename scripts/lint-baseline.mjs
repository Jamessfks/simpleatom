#!/usr/bin/env node
/**
 * Fail if ESLint reports more problems than the recorded baseline.
 *
 * The baseline lives in test_scripts/daily_gate.py (LINT_BASELINE) so the
 * daily gate and CI enforce the same number. It only ever goes down: when a
 * change brings the count below it, lower the constant in the same commit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const gate = readFileSync("test_scripts/daily_gate.py", "utf8");
const baseline = Number(gate.match(/^LINT_BASELINE = (\d+)/m)?.[1]);
if (!Number.isFinite(baseline)) {
  console.error("LINT_BASELINE not found in test_scripts/daily_gate.py");
  process.exit(2);
}

let output;
try {
  output = execFileSync("npx", ["eslint", ".", "-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  output = err.stdout; // eslint exits 1 when it finds problems; the JSON is still on stdout
}
const problems = JSON.parse(output).reduce((n, file) => n + file.messages.length, 0);
console.log(`eslint: ${problems} problems (baseline ${baseline})`);
if (problems > baseline) {
  console.error(`Lint regressed: ${problems} > ${baseline}. Fix the new problems.`);
  process.exit(1);
}
if (problems < baseline) {
  console.log(`Below baseline — lower LINT_BASELINE to ${problems} in test_scripts/daily_gate.py.`);
}
