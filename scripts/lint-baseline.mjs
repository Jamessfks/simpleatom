#!/usr/bin/env node
/**
 * Fail if ESLint reports more errors or more warnings than the recorded baselines.
 *
 * The baselines live in test_scripts/daily_gate.py (LINT_ERROR_BASELINE,
 * LINT_WARNING_BASELINE) so the daily gate and CI enforce the same numbers. They
 * are separate (D88): with one total, a new error passed whenever a warning was
 * fixed in the same change. They only ever go down: when a change brings a count
 * below its baseline, lower the constant in the same commit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const gate = readFileSync("test_scripts/daily_gate.py", "utf8");
const read = (name) => Number(gate.match(new RegExp(`^${name} = (\\d+)`, "m"))?.[1]);
const baseline = { errors: read("LINT_ERROR_BASELINE"), warnings: read("LINT_WARNING_BASELINE") };
if (!Number.isFinite(baseline.errors) || !Number.isFinite(baseline.warnings)) {
  console.error("LINT_ERROR_BASELINE or LINT_WARNING_BASELINE not found in test_scripts/daily_gate.py");
  process.exit(2);
}

let output;
try {
  output = execFileSync("npx", ["eslint", ".", "-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  output = err.stdout; // eslint exits 1 when it finds problems; the JSON is still on stdout
}
const messages = JSON.parse(output).flatMap((file) => file.messages);
const count = {
  errors: messages.filter((m) => m.severity === 2).length,
  warnings: messages.filter((m) => m.severity === 1).length,
};
console.log(
  `eslint: ${count.errors} errors (baseline ${baseline.errors}), ` +
    `${count.warnings} warnings (baseline ${baseline.warnings})`,
);
let failed = false;
for (const kind of ["errors", "warnings"]) {
  if (count[kind] > baseline[kind]) {
    console.error(`Lint regressed: ${count[kind]} ${kind} > ${baseline[kind]}. Fix the new problems.`);
    failed = true;
  } else if (count[kind] < baseline[kind]) {
    const name = kind === "errors" ? "LINT_ERROR_BASELINE" : "LINT_WARNING_BASELINE";
    console.log(`Below baseline: lower ${name} to ${count[kind]} in test_scripts/daily_gate.py.`);
  }
}
process.exit(failed ? 1 : 0);
