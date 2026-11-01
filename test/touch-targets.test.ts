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

// D69: the footer's links dropped to their text height (15-20 px) from 640 px up.
describe("footer links are 44 px targets at every width (D69)", () => {
  const footer = read("components/site-footer.tsx");

  it("the product and resource lists keep min-h-11 on desktop", () => {
    expect(footer).not.toMatch(/sm:min-h-0/);
    expect(footer.match(/className="flex min-h-11 items-center text-sm/g)).toHaveLength(2);
  });

  it("the attribution links reach 44 px with padding that does not move the text", () => {
    expect(footer.match(/underline-offset-2 hover:underline/g)).toHaveLength(2);
    expect(footer.match(/py-3\.5 text-text-secondary underline-offset-2/g)).toHaveLength(2);
  });
});
