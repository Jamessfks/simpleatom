import { CONTRACT } from "@/lib/contract";

const signed = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n)}`;

/**
 * MACE-OFF's typical energy per atom relative to the model's own isolated
 * atoms, as the docs print it ("−6 to −0.5"). The registry is the only place
 * the numbers live (D52); raw E/N has no element-independent band for this
 * model, so none is stored or quoted.
 */
export function offTypicalBandText(): string {
  const { minEvPerAtom, maxEvPerAtom } = CONTRACT.energyConventions.off.relativeToIsolatedAtoms.typical;
  return `${signed(minEvPerAtom)} to ${signed(maxEvPerAtom)}`;
}

/** The band the validator enforces for the same quantity, as "−10 and +1". */
export function offEnforcedBandText(): string {
  const { minEvPerAtom, maxEvPerAtom } = CONTRACT.energyConventions.off.relativeToIsolatedAtoms.enforced;
  return `${signed(minEvPerAtom)} and +${maxEvPerAtom}`;
}
