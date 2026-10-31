/**
 * Materials Project comparison — the numeric half of SimpleAtom's quality bar.
 *
 * WHAT IS BEING MEASURED
 *   For each compound in the MP reference set we form a formation energy from
 *   the benchmark run's own MACE energies:
 *
 *     E_f = [ E(compound) - SUM_i n_i * e_ref(element_i) ] / N_atoms
 *
 *   and compare it against the value the Materials Project publishes for the
 *   same mp-id in its `gga_gga+u` (PBE / PBE+U) thermo dataset.
 *
 * WHY NOT TOTAL ENERGIES
 *   MP total energies come from VASP with PAW reference states; MACE has its
 *   own absolute scale. The two numbers are not on the same axis and never
 *   will be. Only formation energies and energy differences are comparable.
 *
 * WHY e_ref MUST COME FROM THE SAME RUN
 *   A formation energy is only meaningful if the elemental references were
 *   computed with the same model as the compound. Mixing a MACE compound
 *   energy with an MP elemental reference silently smuggles the entire
 *   VASP-vs-MACE offset into the answer. So this module refuses to invent
 *   e_ref: it reads the elemental reference phases out of the same benchmark
 *   batch, at the same model and settings, and if one is absent the row is
 *   reported unscored with the missing element named.
 *
 * WHAT AGREEMENT DOES AND DOES NOT PROVE
 *   MACE-MP-0 was trained on Materials Project PBE data. Agreement therefore
 *   measures how well the model reproduces PBE — its own training target — and
 *   says nothing about agreement with experiment. PBE itself carries roughly
 *   0.1-0.5 eV/atom of overbinding against measured energetics.
 *
 * See docs/v2/bars/materials-project.md for the caveats this module enforces,
 * and test_scripts/fetch_mp_reference.py for how the reference data is built
 * and re-checked offline.
 */

import { findModel, isMaceOffModel } from "@/lib/contract";
import type { BenchmarkResult, ModelSize, ModelType } from "@/types/mace";
import {
  MP_COMPOUNDS,
  MP_ELEMENT_REFERENCES,
  MP_REFERENCE_ENTRIES,
  type MpReferenceEntry,
} from "./mp-reference-data";
import { MLPEG_CATALOG } from "./mlpeg-catalog";

export { MP_REFERENCE_PROVENANCE } from "./mp-reference-data";
export type { MpReferenceEntry } from "./mp-reference-data";
export { MP_REFERENCE_ENTRIES, MP_COMPOUNDS } from "./mp-reference-data";

// ---------------------------------------------------------------------------
// The declared tolerance
// ---------------------------------------------------------------------------

/**
 * Pass threshold on |E_f(MACE) - E_f(MP)|, in eV/atom.
 *
 * This is a DECLARED engineering threshold, not a published error bar. It is
 * set at the scale on which a formation-energy difference stops changing any
 * thermodynamic conclusion: the Materials Project itself treats phases within
 * a few tens of meV/atom of the convex hull as effectively degenerate, and
 * 25-50 meV/atom is the band used for stability screening built on MP data.
 * A deviation inside this band leaves every hull decision intact; a deviation
 * outside it can flip one.
 *
 * Deliberately not derived from MACE-MP-0's published test-set error, which
 * would make the bar self-referential — the model would be graded against its
 * own reported accuracy instead of against a consequence.
 *
 * Kept in sync with TOLERANCE_EV_PER_ATOM in test_scripts/fetch_mp_reference.py
 * so the offline run and the on-screen verdict cannot disagree.
 */
export const MP_TOLERANCE_EV_PER_ATOM = 0.05;

/** A tighter band, reported separately. Not the pass/fail line. */
export const MP_TIGHT_EV_PER_ATOM = 0.025;

export const MP_TOLERANCE_RATIONALE =
  "Declared threshold, not a published error bar: 50 meV/atom is the scale at which a " +
  "formation-energy difference stops changing a thermodynamic conclusion, since MP treats " +
  "phases within a few tens of meV/atom of the convex hull as effectively degenerate.";

/**
 * The caveats that decide whether this comparison means anything. These are
 * rendered on screen, not left in code comments — a reader who cannot see them
 * cannot judge the number.
 */
export const MP_CAVEATS: { title: string; body: string }[] = [
  {
    title: "This tests agreement with PBE, not with experiment",
    body:
      "MACE-MP-0 was trained on Materials Project PBE(+U) data. Reproducing MP means the " +
      "model fits its own training target. PBE itself overbinds relative to measured " +
      "energetics by roughly 0.1-0.5 eV/atom, and that error is not visible here.",
  },
  {
    title: "Formation energies only — never total energies",
    body:
      "MP total energies use VASP PAW reference states and are not on the same absolute " +
      "scale as MACE's. Only formation energies and energy differences are comparable, so " +
      "no total energy is compared anywhere on this page.",
  },
  {
    title: "Elemental references are computed with the same model, in this run",
    body:
      "Every e_ref below comes from running the same MACE model on MP's own reference " +
      "phase for that element, inside this same batch. No MP elemental energy is mixed in. " +
      "If a reference is missing from the run, the affected row is left unscored.",
  },
  {
    title: "MP dataset key: gga_gga+u (PBE / PBE+U)",
    body:
      "MP also publishes r2SCAN formation energies. Those are not used: MACE-MP-0 was " +
      "trained at the PBE level, so r2SCAN would be the wrong yardstick.",
  },
  {
    title: "Single-point energies at MP's relaxed geometry",
    body:
      "Structures are MP's PBE-relaxed cells, evaluated without further relaxation. The " +
      "comparison therefore probes the energy surface at MP's minimum rather than at MACE's.",
  },
  {
    title: "Scored set is metal-metal only",
    body:
      "MP post-processes GGA formation energies with composition-dependent corrections for " +
      "compounds containing anions such as O, N, S and the halogens. Every scored compound " +
      "here is metal-metal, which sidesteps that mismatch. Anion-bearing structures are " +
      "listed as excluded below with their reason.",
  },
  {
    title: "No band gap is shown",
    body:
      "MP publishes a band gap for every material; MACE cannot compute one. There is no " +
      "electronic structure in a machine-learned interatomic potential, so only " +
      "energy-like quantities appear here.",
  },
];

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type MpRowVerdict = "pass-tight" | "pass" | "fail" | "unscored";

export interface MpCompoundRow {
  entry: MpReferenceEntry;
  /** MP published value, eV/atom. */
  mpFormationEnergyPerAtom: number;
  /** Formation energy from this run's MACE energies, eV/atom. */
  maceFormationEnergyPerAtom: number | null;
  /** MACE total energy for the compound cell, eV. */
  maceTotalEnergy: number | null;
  /** MACE minus MP, eV/atom. */
  deviation: number | null;
  verdict: MpRowVerdict;
  /** Present whenever verdict is "unscored". */
  unscoredReason?: string;
}

export interface MpElementReferenceUsed {
  element: string;
  mpId: string;
  /** eV/atom, from this run. */
  energyPerAtom: number;
}

export interface MpModelStats {
  scored: number;
  passed: number;
  withinTight: number;
  /** Mean absolute deviation, eV/atom. */
  mae: number;
  /** Signed mean deviation (MACE minus MP), eV/atom. */
  bias: number;
  /** Largest |deviation|, eV/atom. */
  maxAbs: number;
}

export interface MpModelComparison {
  modelLabel: string;
  modelType: ModelType;
  modelSize: ModelSize;
  /** False when the model is not trained against MP PBE data. */
  scorable: boolean;
  notScorableReason?: string;
  elementReferences: MpElementReferenceUsed[];
  /** Elements needed by selected compounds whose reference phase was not run. */
  missingElementReferences: string[];
  rows: MpCompoundRow[];
  stats: MpModelStats | null;
}

export interface MpExclusion {
  structureId: string;
  name: string;
  reason: string;
}

export interface MpComparison {
  /** True when the run contained at least one MP reference-set compound. */
  hasCompounds: boolean;
  /** Compounds present in the run. */
  compoundsInRun: number;
  models: MpModelComparison[];
  /** Structures in the run that cannot be compared, each with its reason. */
  exclusions: MpExclusion[];
  /** Compounds in the reference set that were not part of this run. */
  compoundsNotRun: MpReferenceEntry[];
}

// ---------------------------------------------------------------------------
// Exclusion reasons — stated, never silent
// ---------------------------------------------------------------------------

/**
 * Why a given ml-peg catalog structure is not compared against MP.
 *
 * Keyed by catalog id so each reason is specific. Falling back to a
 * category-level reason is fine; falling back to silence is not.
 */
const EXCLUSION_BY_ID: Record<string, string> = {
  "si-diamond":
    "Si diamond is MP's own reference phase for silicon (mp-149), so its formation energy " +
    "is 0 eV/atom by definition on both sides — there is nothing to test. The cell here " +
    "also uses the experimental lattice constant, not MP's relaxed one.",
  "cu-fcc":
    "FCC Cu is MP's reference phase for copper (mp-30): formation energy is 0 eV/atom by " +
    "definition on both sides. The cell also uses the experimental lattice constant.",
  "fe-bcc":
    "BCC Fe is MP's reference phase for iron (mp-13): formation energy is 0 eV/atom by " +
    "definition on both sides. The cell also uses the experimental lattice constant.",
  "c-diamond":
    "Diamond is not MP's carbon reference phase, so a formation energy needs MP's carbon " +
    "reference (mp-2516584) computed with the same model. That structure is not in the " +
    "comparison set, so no formation energy can be formed.",
  "nacl-rocksalt":
    "A chloride. MP applies composition-dependent corrections to halide formation energies, " +
    "so the published value and a raw MACE formation energy are not the same quantity. The " +
    "cell also uses the experimental lattice constant rather than MP's relaxed one.",
  "cu-111":
    "A slab with vacuum. MP catalogues bulk crystals; a surface energy is not a formation " +
    "energy and has no MP counterpart to compare against.",
  "si-111":
    "A slab with vacuum. MP catalogues bulk crystals; a surface energy is not a formation " +
    "energy and has no MP counterpart to compare against.",
};

const EXCLUSION_BY_CATEGORY: Record<string, string> = {
  molecular:
    "An isolated molecule. MP contains periodic crystals only, so there is no MP entry and " +
    "no formation energy against MP's elemental reference phases.",
  "non-covalent":
    "An isolated molecular complex. MP contains periodic crystals only — no MP counterpart.",
  surfaces:
    "A surface slab. MP catalogues bulk crystals; surface energies are a different quantity.",
  uploaded:
    "A user-supplied structure with no Materials Project identifier. Nothing to compare it to.",
};

function exclusionReason(structureId: string, category: string): string {
  return (
    EXCLUSION_BY_ID[structureId] ??
    EXCLUSION_BY_CATEGORY[category] ??
    "Not part of the Materials Project comparison set: no mp-id and no MP published value."
  );
}

// ---------------------------------------------------------------------------
// Model eligibility
// ---------------------------------------------------------------------------

function scorability(type: ModelType): { scorable: boolean; reason?: string } {
  // Every model trained on Materials Project PBE data (the MACE-MP family:
  // MPA-0 and MP-0) targets the convention MP publishes.
  if (findModel(type)?.energyConvention === "mp") return { scorable: true };
  if (isMaceOffModel(type)) {
    return {
      scorable: false,
      reason:
        "MACE-OFF is trained on wB97M-D3BJ for organic molecules, not on Materials Project " +
        "PBE data, and does not support most metals. Comparing it to MP values would be " +
        "comparing against the wrong level of theory.",
    };
  }
  return {
    scorable: false,
    reason:
      "A custom model's training data is unknown to SimpleAtom. Agreement with MP can only " +
      "be claimed for a model known to target MP's PBE data.",
  };
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

const MP_ENTRY_BY_ID = new Map(MP_REFERENCE_ENTRIES.map((e) => [e.id, e]));

/** All catalog ids, so exclusions can be described accurately. */
const CATALOG_CATEGORY_BY_ID = new Map(
  MLPEG_CATALOG.flatMap((c) => c.entries.map((e) => [e.id, c.id] as const)),
);

export function isMpReferenceId(id: string): boolean {
  return MP_ENTRY_BY_ID.has(id);
}

/**
 * Build the MP comparison for a completed benchmark run.
 *
 * Reads only what the run actually produced. Every number returned is either
 * MP's published value or arithmetic on this run's MACE energies — nothing is
 * cached, defaulted, or carried over from a previous run.
 */
export function buildMpComparison(result: BenchmarkResult): MpComparison {
  const byStructureId = new Map(result.results.map((r) => [r.structureId, r]));

  const compoundsInRun = MP_COMPOUNDS.filter((c) => byStructureId.has(c.id));
  const compoundsNotRun = MP_COMPOUNDS.filter((c) => !byStructureId.has(c.id));

  // Which model columns exist. Every structure row carries the same model list.
  const modelTemplates = result.results[0]?.models ?? [];

  const models: MpModelComparison[] = modelTemplates.map((template, modelIndex) => {
    const { scorable, reason } = scorability(template.modelType);

    // e_ref per element, from this run, this model.
    const elementReferences: MpElementReferenceUsed[] = [];
    const eRef = new Map<string, number>();
    for (const [element, entry] of MP_ELEMENT_REFERENCES) {
      const row = byStructureId.get(entry.id);
      const m = row?.models[modelIndex];
      if (!row || !m || m.status !== "success" || m.energy == null) continue;
      const n = m.symbols?.length ?? entry.atomCount;
      if (n <= 0) continue;
      const perAtom = m.energy / n;
      eRef.set(element, perAtom);
      elementReferences.push({ element, mpId: entry.mpId, energyPerAtom: perAtom });
    }
    elementReferences.sort((a, b) => a.element.localeCompare(b.element));

    const neededElements = new Set(compoundsInRun.flatMap((c) => c.elements));
    const missingElementReferences = [...neededElements]
      .filter((el) => !eRef.has(el))
      .sort();

    const rows: MpCompoundRow[] = compoundsInRun.map((entry) => {
      const base: MpCompoundRow = {
        entry,
        mpFormationEnergyPerAtom: entry.mpFormationEnergyPerAtom,
        maceFormationEnergyPerAtom: null,
        maceTotalEnergy: null,
        deviation: null,
        verdict: "unscored",
      };

      if (!scorable) {
        // Short reason in the row; the full argument is stated once per model
        // block rather than repeated down every row.
        return {
          ...base,
          unscoredReason: "model not comparable to MP — see note above",
        };
      }

      const row = byStructureId.get(entry.id);
      const m = row?.models[modelIndex];
      if (!m || m.status !== "success" || m.energy == null) {
        return {
          ...base,
          unscoredReason:
            m?.error != null
              ? `Calculation failed: ${m.error}`
              : "No energy returned for this structure.",
        };
      }

      const missing = Object.keys(entry.composition).filter((el) => !eRef.has(el));
      if (missing.length > 0) {
        return {
          ...base,
          maceTotalEnergy: m.energy,
          unscoredReason:
            `Elemental reference missing from this run: ${missing.join(", ")}. ` +
            "A formation energy cannot be formed without it, and MP's own elemental " +
            "energies must not be substituted.",
        };
      }

      let refSum = 0;
      let nAtoms = 0;
      for (const [el, count] of Object.entries(entry.composition)) {
        refSum += count * (eRef.get(el) as number);
        nAtoms += count;
      }
      if (nAtoms <= 0) {
        return { ...base, maceTotalEnergy: m.energy, unscoredReason: "Empty composition." };
      }

      const ef = (m.energy - refSum) / nAtoms;
      const deviation = ef - entry.mpFormationEnergyPerAtom;
      const abs = Math.abs(deviation);
      const verdict: MpRowVerdict =
        abs <= MP_TIGHT_EV_PER_ATOM
          ? "pass-tight"
          : abs <= MP_TOLERANCE_EV_PER_ATOM
            ? "pass"
            : "fail";

      return {
        ...base,
        maceTotalEnergy: m.energy,
        maceFormationEnergyPerAtom: ef,
        deviation,
        verdict,
      };
    });

    const scoredDeviations = rows
      .filter((r) => r.deviation != null)
      .map((r) => r.deviation as number);

    const stats: MpModelStats | null =
      scoredDeviations.length > 0
        ? {
            scored: scoredDeviations.length,
            passed: rows.filter((r) => r.verdict === "pass" || r.verdict === "pass-tight").length,
            withinTight: rows.filter((r) => r.verdict === "pass-tight").length,
            mae:
              scoredDeviations.reduce((s, d) => s + Math.abs(d), 0) / scoredDeviations.length,
            bias: scoredDeviations.reduce((s, d) => s + d, 0) / scoredDeviations.length,
            maxAbs: Math.max(...scoredDeviations.map(Math.abs)),
          }
        : null;

    return {
      modelLabel: template.modelLabel,
      modelType: template.modelType,
      modelSize: template.modelSize,
      scorable,
      notScorableReason: reason,
      elementReferences,
      missingElementReferences,
      rows,
      stats,
    };
  });

  // Everything in the run that is not part of the MP comparison, with a reason.
  const exclusions: MpExclusion[] = result.results
    .filter((r) => !MP_ENTRY_BY_ID.has(r.structureId))
    .map((r) => ({
      structureId: r.structureId,
      name: r.structureName,
      reason: exclusionReason(
        r.structureId,
        CATALOG_CATEGORY_BY_ID.get(r.structureId) ?? r.category,
      ),
    }));

  return {
    hasCompounds: compoundsInRun.length > 0,
    compoundsInRun: compoundsInRun.length,
    models,
    exclusions,
    compoundsNotRun,
  };
}

/** eV/atom formatted with an explicit sign, for signed quantities. */
export function formatSigned(value: number, digits = 4): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/** Convert eV/atom to meV/atom for the deviation column. */
export function toMeV(value: number): number {
  return value * 1000;
}
