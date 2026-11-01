import { describe, expect, it } from "vitest";
import { advanceFrame, buildTrajectoryXYZ } from "@/components/calculate/trajectory/trajectory-frames";

// F27 (D69): the player built its multi-frame XYZ once into a ref, so a new
// trajectory under a mounted player kept drawing the old frames (and ESLint's
// react-hooks/refs flagged the read during render). The builder is now a pure
// function the player memoises on the trajectory and the symbols.

const frame0 = [[0, 0, 0], [0.96, 0, 0]];
const frame1 = [[0, 0, 0.1], [0.96, 0, 0.2]];

describe("buildTrajectoryXYZ writes one XYZ block per frame, back to back", () => {
  it("names the energies it carries", () => {
    const xyz = buildTrajectoryXYZ(["O", "H"], {
      positions: [frame0, frame1],
      potentialEnergies: [-1.5, -1.25],
      totalEnergies: [-1.4, -1.35],
    });
    expect(xyz).toBe(
      [
        "2",
        "Frame 0 | E_pot=-1.500000 eV | E_tot=-1.400000 eV",
        "O 0.000000 0.000000 0.000000",
        "H 0.960000 0.000000 0.000000",
        "2",
        "Frame 1 | E_pot=-1.250000 eV | E_tot=-1.350000 eV",
        "O 0.000000 0.000000 0.100000",
        "H 0.960000 0.000000 0.200000",
        "",
      ].join("\n"),
    );
  });

  it("falls back to `energies`, the potential energy of rows shared before the explicit keys", () => {
    const xyz = buildTrajectoryXYZ(["O", "H"], { positions: [frame0], energies: [-2] });
    expect(xyz.split("\n")[1]).toBe("Frame 0 | E_pot=-2.000000 eV");
  });

  it("prefers `potentialEnergies` over `energies`", () => {
    const xyz = buildTrajectoryXYZ(["O", "H"], { positions: [frame0], energies: [-2], potentialEnergies: [-3] });
    expect(xyz.split("\n")[1]).toBe("Frame 0 | E_pot=-3.000000 eV");
  });

  it("writes a bare frame comment when no energy was recorded", () => {
    const xyz = buildTrajectoryXYZ(["O", "H"], { positions: [frame0] });
    expect(xyz.split("\n")[1]).toBe("Frame 0");
  });

  it("is a different string for a different trajectory or different symbols", () => {
    const a = buildTrajectoryXYZ(["O", "H"], { positions: [frame0] });
    expect(buildTrajectoryXYZ(["O", "H"], { positions: [frame1] })).not.toBe(a);
    expect(buildTrajectoryXYZ(["N", "H"], { positions: [frame0] })).not.toBe(a);
    expect(buildTrajectoryXYZ(["O", "H"], { positions: [frame0, frame1] })).not.toBe(a);
  });

  it("is empty for a trajectory with no frames", () => {
    expect(buildTrajectoryXYZ(["O", "H"], { positions: [] })).toBe("");
  });
});

// F27 (c): the animation loop called setPlaying(false) from inside the updater it
// passed to setCurrentFrame. The step is now computed outside any updater.
describe("advanceFrame steps the player and says when it has reached the end", () => {
  it("moves one frame on", () => {
    expect(advanceFrame(0, 5)).toEqual({ frame: 1, done: false });
    expect(advanceFrame(2, 5)).toEqual({ frame: 3, done: false });
  });

  it("stops on the last frame", () => {
    expect(advanceFrame(3, 5)).toEqual({ frame: 4, done: true });
    expect(advanceFrame(4, 5)).toEqual({ frame: 4, done: true });
  });

  it("stays on a frame that is already past the end, and on a single-frame trajectory", () => {
    expect(advanceFrame(9, 5)).toEqual({ frame: 4, done: true });
    expect(advanceFrame(0, 1)).toEqual({ frame: 0, done: true });
  });

  it("never returns a negative frame", () => {
    expect(advanceFrame(0, 0)).toEqual({ frame: 0, done: true });
  });
});
