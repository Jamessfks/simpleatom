/**
 * The pure parts of the trajectory player (F27, D69), kept apart from the
 * component so they can be tested and so the player can memoise on them.
 */

import type { CalculationResult } from "@/types/mace";

type Trajectory = NonNullable<CalculationResult["trajectory"]>;

/** The part of a trajectory the multi-frame XYZ is built from. */
export type XyzTrajectory = Pick<Trajectory, "positions"> &
  Partial<Pick<Trajectory, "potentialEnergies" | "energies" | "totalEnergies">>;

/**
 * Concatenate all trajectory frames into a single multi-frame XYZ string.
 * 3Dmol.js `addModelsAsFrames` expects this format: each frame is a
 * complete XYZ block (atom count + comment + atom lines) back-to-back.
 *
 * The comment line names the quantity it carries (`E_pot=` / `E_tot=`)
 * rather than a bare `E =`, because these frames are the same bytes a user
 * can copy out of the viewer. `energies` is the potential energy kept under
 * its original key for results shared before `potentialEnergies` existed.
 */
export function buildTrajectoryXYZ(symbols: string[], traj: XyzTrajectory): string {
  const potentialEnergies = traj.potentialEnergies ?? traj.energies ?? [];
  const totalEnergies = traj.totalEnergies ?? [];
  const atomCount = symbols.length;
  let xyz = "";

  for (let f = 0; f < traj.positions.length; f++) {
    const parts: string[] = [`Frame ${f}`];
    if (potentialEnergies[f] != null) {
      parts.push(`E_pot=${potentialEnergies[f].toFixed(6)} eV`);
    }
    if (totalEnergies[f] != null) {
      parts.push(`E_tot=${totalEnergies[f].toFixed(6)} eV`);
    }
    xyz += `${atomCount}\n`;
    xyz += `${parts.join(" | ")}\n`;
    for (let a = 0; a < atomCount; a++) {
      const [x, y, z] = traj.positions[f][a];
      xyz += `${symbols[a]} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
    }
  }

  return xyz;
}

/**
 * The frame after `current` in a trajectory of `total` frames, and whether it
 * is the last one, where playback stops. Pure, so the animation loop can decide
 * to stop without calling one state setter from inside another's updater.
 */
export function advanceFrame(current: number, total: number): { frame: number; done: boolean } {
  const last = Math.max(0, total - 1);
  const frame = Math.min(current + 1, last);
  return { frame, done: frame >= last };
}
