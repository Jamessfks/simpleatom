import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// F27 (D69): what the two 3D viewers' effects must do, read off the source (the
// repo has no DOM test environment). The pure parts are tested in
// trajectory-frames.test.ts and latest-request.test.ts.

const source = (f: string) => readFileSync(f, "utf8");
const player = source("components/calculate/trajectory/trajectory-viewer.tsx");
const preview = source("components/calculate/structure-preview.tsx");

describe("the trajectory player's effects (F27)", () => {
  it("builds the XYZ with useMemo on the trajectory and the symbols, not into a ref during render", () => {
    expect(player).not.toMatch(/xyzDataRef/);
    expect(player).toMatch(/useMemo\(\s*\(\) => buildTrajectoryXYZ\(symbols, traj\),\s*\[symbols, traj\]\s*\)/);
  });

  it("remounts the player when the trajectory changes, so the viewer, frame and playback restart", () => {
    expect(player).toMatch(/<TrajectoryPlayer\s+key=\{/);
  });

  it("stops the 3Dmol import from creating a viewer and a ResizeObserver after the effect was cleaned up", () => {
    expect(player).toMatch(/let cancelled = false/);
    expect(player).toMatch(/if \(cancelled \|\| !viewerRef\.current\) return/);
    expect(player).toMatch(/cancelled = true/);
    expect(player).toMatch(/resizeObserverRef\.current\?\.disconnect\(\)/);
  });

  it("does not call setPlaying from inside a state updater", () => {
    expect(player).not.toMatch(/setCurrentFrame\(\(prev\) => \{[^]*?setPlaying/);
    expect(player).toMatch(/advanceFrame\(/);
  });
});

describe("the structure preview's effects (F27)", () => {
  it("ignores a parse that finished after a newer request or a reset", () => {
    expect(preview).toMatch(/createLatestRequest/);
    expect(preview).toMatch(/const isLatest = latest\.begin\(\)/);
    expect(preview).toMatch(/if \(!isLatest\(\)\) return/);
  });

  it("cancels the request in flight when the files change and when the panel closes", () => {
    const reset = preview.slice(preview.indexOf("// Reset when files change"), preview.indexOf("// Parse the first file"));
    expect(reset).toMatch(/latest\.cancel\(\)/);
    const close = preview.slice(preview.indexOf("const handleClose"), preview.indexOf("// Render 3Dmol viewer"));
    expect(close).toMatch(/latest\.cancel\(\)/);
  });

  it("stops the 3Dmol import from creating a viewer after the effect was cleaned up", () => {
    expect(preview).toMatch(/let cancelled = false/);
    expect(preview).toMatch(/if \(cancelled \|\| !viewerRef\.current\) return/);
    expect(preview).toMatch(/cancelled = true/);
  });
});
