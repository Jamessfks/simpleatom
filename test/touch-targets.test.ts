import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Design review of the result view: the result's action buttons were 32 px
// tall on a pointer device (44 px only on touch), and the status pill was
// hidden below 640 px, so on a phone the page header said nothing about the
// state of the run. CLAUDE.md: touch targets are at least 44 px at every width.
// (No DOM in the test environment, so these read the source.)
const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("result actions are 44 px targets", () => {
  it("Share result, PDF report, CSV and JSON", () => {
    const page = read("app/calculate/page.tsx");
    expect(page).toMatch(/<Button onClick=\{\(\) => setConfirmShareOpen\(true\)\}[^>]*className="min-h-11"/);
    expect(read("components/calculate/pdf-report.tsx")).toMatch(/<Button[^>]*size="sm" className="min-h-11"/);
    const dash = read("components/calculate/metrics-dashboard.tsx");
    expect(dash).toMatch(/onClick=\{downloadCSV\}[^>]*className="min-h-11"/);
    expect(dash).toMatch(/onClick=\{downloadJSON\}[^>]*className="min-h-11"/);
  });

  it("Details in the run ledger", () => {
    expect(read("components/calculate/run-ledger.tsx")).toMatch(/onClick=\{\(\) => setExpanded\(true\)\} className="min-h-11/);
  });
});

describe("the status pill is shown at every width", () => {
  it("is not hidden below 640 px, and the page header wraps to make room", () => {
    const page = read("app/calculate/page.tsx");
    const pill = page.slice(page.indexOf("function StatusPill"));
    expect(pill).not.toMatch(/className="hidden/);
    expect(page).toMatch(/mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between/);
  });
});
