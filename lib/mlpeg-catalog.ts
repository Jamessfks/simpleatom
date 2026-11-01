/**
 * ml-peg Structure Catalog — Curated benchmark structures from the MACE team.
 *
 * SOURCE:
 *   ml-peg (ML Performance and Extrapolation Guide) is a testing framework
 *   for ML interatomic potentials, developed by the MACE team.
 *   Repository: https://github.com/ddmms/ml-peg
 *   Live guide:  https://ml-peg.stfc.ac.uk
 *
 * PURPOSE:
 *   Provide a set of well-known benchmark structures that users can select
 *   from a menu instead of uploading their own files. This:
 *     - Lets users try the MACE calculator without having structure files
 *     - Provides standard test cases (bulk crystals, molecules, surfaces)
 *     - Connects our web calculator with the ml-peg ecosystem
 *     - Addresses the MACE founder's suggestion for future integration
 *
 * HOW STRUCTURES ARE STORED:
 *   Structures are embedded as XYZ strings in this file. This avoids:
 *     - CORS issues when fetching from ml-peg's S3 bucket
 *     - Network dependency (works offline / in local mode)
 *     - Complexity of parsing ml-peg's internal data formats
 *
 *   The structures here are written by hand to model the systems in ml-peg's
 *   benchmark set (see ml_peg/calcs/bulk_crystal/lattice_constants/
 *   calc_lattice_constants.py). They are not copies of ml-peg's files, so
 *   nothing here is ml-peg data or carries its licence; check a geometry
 *   against ASE's `bulk()` before relying on it.
 *
 * CATEGORIES (matching ml-peg's app/ folder structure):
 *   - Bulk Crystals       (ml_peg/app/bulk_crystal/)
 *   - Molecular Systems   (ml_peg/app/molecular/)
 *   - Conformers          (ml_peg/app/conformers/)
 *   - Surfaces            (ml_peg/app/surfaces/)
 *   - Non-Covalent        (ml_peg/app/non_covalent_interactions/)
 *
 * EXTENDING:
 *   To add more structures:
 *   1. Generate the XYZ string (e.g. from ASE: atoms.write('struct.xyz'))
 *   2. Add a new entry to the appropriate category in MLPEG_CATALOG below
 *   3. Include: id, name, description, formula, atomCount, elements,
 *      recommendedModel, and xyzData
 *
 * FUTURE:
 *   When ml-peg provides a public API or CORS-enabled S3 access, this
 *   catalog can be replaced with dynamic fetching. The CatalogEntry
 *   interface will remain the same.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single structure entry in the catalog. */
export interface CatalogEntry {
  /** Unique identifier (e.g. "si-diamond") */
  id: string;
  /** Human-readable name (e.g. "Silicon (diamond)") */
  name: string;
  /** Short description */
  description: string;
  /** Chemical formula (e.g. "Si", "C2H5OH") */
  formula: string;
  /** Number of atoms in the structure */
  atomCount: number;
  /** List of unique elements */
  elements: string[];
  /** Recommended MACE model type for this structure */
  recommendedModel: "MACE-MPA-0" | "MACE-OFF";
  /** XYZ-formatted string of the structure */
  xyzData: string;
  /**
   * Known experimental/DFT reference values for validation context.
   *
   * IMPORTANT: These are EXPERIMENTAL cohesive energies — not DFT total
   * energies. MACE-MP-0 is trained on PBE DFT, which systematically
   * overbinds vs experiment (typical error 0.1–0.5 eV/atom). These
   * values provide CONTEXT for researchers, not a scoring target.
   * Direct comparison of MACE total energy/atom to experimental
   * cohesive energy is scientifically invalid without accounting for
   * the isolated atom reference and the DFT functional's known biases.
   *
   * Sources: Kittel "Introduction to Solid State Physics" 8th ed.,
   * CRC Handbook of Chemistry and Physics, Farid & Godby PRB 43 14248.
   * See also: Miret et al. arXiv:2502.03660 on MLIP evaluation.
   */
  reference?: {
    cohesiveEnergy?: { value: number; source: string };
    latticeConstant?: { value: number; source: string };
  };
}

/** A category of structures (e.g. "Bulk Crystals"). */
export interface CatalogCategory {
  /** Category identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** ml-peg folder path for reference */
  mlpegPath: string;
  /** Structures in this category */
  entries: CatalogEntry[];
}

// ---------------------------------------------------------------------------
// Catalog Data
// ---------------------------------------------------------------------------

/**
 * The full ml-peg structure catalog.
 *
 * Each category matches a folder in ml-peg's app/ directory.
 * Structures are standard benchmark systems used by the MACE team.
 * XYZ coordinates are from ASE's bulk() builder or standard databases.
 */
export const MLPEG_CATALOG: CatalogCategory[] = [
  // =========================================================================
  // BULK CRYSTALS — ml_peg/app/bulk_crystal/
  // =========================================================================
  {
    id: "bulk-crystals",
    name: "Bulk Crystals",
    description: "Bulk crystal structures for lattice constants, elasticity, and phonon benchmarks.",
    mlpegPath: "ml_peg/app/bulk_crystal/",
    entries: [
      {
        // 8-atom conventional diamond cell, a = 5.43 Å; geometry checked by
        // test/mlpeg-catalog.test.ts (D57: was a 2-atom basis in a cubic cell).
        id: "si-diamond",
        name: "Silicon (diamond)",
        description: "Diamond cubic silicon — the most common semiconductor benchmark.",
        formula: "Si",
        atomCount: 8,
        elements: ["Si"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -4.63, source: "Exp (Kittel, 8th ed.; Farid & Godby PRB 43 14248: 4.62±0.08)" },
          latticeConstant: { value: 5.431, source: "Exp (Kittel, 8th ed.)" },
        },
        xyzData: `8
Lattice="5.43 0.0 0.0 0.0 5.43 0.0 0.0 0.0 5.43" Properties=species:S:1:pos:R:3 pbc="T T T"
Si 0.000000 0.000000 0.000000
Si 1.357500 1.357500 1.357500
Si 0.000000 2.715000 2.715000
Si 1.357500 4.072500 4.072500
Si 2.715000 0.000000 2.715000
Si 4.072500 1.357500 4.072500
Si 2.715000 2.715000 0.000000
Si 4.072500 4.072500 1.357500`,
      },
      {
        // Verified: a=3.615 Å (exp), 4 atoms at FCC sites
        id: "cu-fcc",
        name: "Copper (FCC)",
        description: "Face-centered cubic copper — standard metal benchmark.",
        formula: "Cu",
        atomCount: 4,
        elements: ["Cu"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -3.49, source: "Exp (Kittel, 8th ed.)" },
          latticeConstant: { value: 3.615, source: "Exp (Kittel, 8th ed.)" },
        },
        xyzData: `4
Lattice="3.615 0.0 0.0 0.0 3.615 0.0 0.0 0.0 3.615" Properties=species:S:1:pos:R:3 pbc="T T T"
Cu 0.000000 0.000000 0.000000
Cu 0.000000 1.807500 1.807500
Cu 1.807500 0.000000 1.807500
Cu 1.807500 1.807500 0.000000`,
      },
      {
        // Verified: a=5.64 Å (exp), 8 atoms (4 Na FCC + 4 Cl offset)
        id: "nacl-rocksalt",
        name: "Sodium Chloride (rocksalt)",
        description: "NaCl in rocksalt structure — ionic crystal benchmark.",
        formula: "NaCl",
        atomCount: 8,
        elements: ["Na", "Cl"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -3.34, source: "Exp (CRC Handbook; -6.68 eV/formula unit ÷ 2 atoms)" },
          latticeConstant: { value: 5.640, source: "Exp (CRC Handbook)" },
        },
        xyzData: `8
Lattice="5.64 0.0 0.0 0.0 5.64 0.0 0.0 0.0 5.64" Properties=species:S:1:pos:R:3 pbc="T T T"
Na 0.000000 0.000000 0.000000
Na 0.000000 2.820000 2.820000
Na 2.820000 0.000000 2.820000
Na 2.820000 2.820000 0.000000
Cl 2.820000 0.000000 0.000000
Cl 0.000000 2.820000 0.000000
Cl 0.000000 0.000000 2.820000
Cl 2.820000 2.820000 2.820000`,
      },
      {
        // Verified: a=2.87 Å (exp), 2 atoms at (0,0,0) and (a/2,a/2,a/2)
        id: "fe-bcc",
        name: "Iron (BCC)",
        description: "Body-centered cubic iron — magnetic metal benchmark.",
        formula: "Fe",
        atomCount: 2,
        elements: ["Fe"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -4.28, source: "Exp (Kittel, 8th ed.)" },
          latticeConstant: { value: 2.870, source: "Exp (Kittel, 8th ed.)" },
        },
        xyzData: `2
Lattice="2.87 0.0 0.0 0.0 2.87 0.0 0.0 0.0 2.87" Properties=species:S:1:pos:R:3 pbc="T T T"
Fe 0.000000 0.000000 0.000000
Fe 1.435000 1.435000 1.435000`,
      },
      {
        // 8-atom conventional diamond cell, a = 3.567 Å; geometry checked by
        // test/mlpeg-catalog.test.ts (D57: was a 2-atom basis in a cubic cell).
        id: "c-diamond",
        name: "Diamond (carbon)",
        description: "Diamond cubic carbon — hard material benchmark.",
        formula: "C",
        atomCount: 8,
        elements: ["C"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -7.37, source: "Exp (Kittel, 8th ed.)" },
          latticeConstant: { value: 3.567, source: "Exp (Kittel, 8th ed.)" },
        },
        xyzData: `8
Lattice="3.567 0.0 0.0 0.0 3.567 0.0 0.0 0.0 3.567" Properties=species:S:1:pos:R:3 pbc="T T T"
C 0.000000 0.000000 0.000000
C 0.891750 0.891750 0.891750
C 0.000000 1.783500 1.783500
C 0.891750 2.675250 2.675250
C 1.783500 0.000000 1.783500
C 2.675250 0.891750 2.675250
C 1.783500 1.783500 0.000000
C 2.675250 2.675250 0.891750`,
      },
    ],
  },

  // =========================================================================
  // MOLECULAR SYSTEMS — ml_peg/app/molecular/
  // =========================================================================
  {
    id: "molecular",
    name: "Molecular Systems",
    description: "Small molecules for energy and force benchmarks (GMTKN55, Wiggle150).",
    mlpegPath: "ml_peg/app/molecular/",
    entries: [
      {
        // Verified: O-H ≈ 0.969 Å, H-O-H ≈ 104° (standard computational geometry)
        id: "water",
        name: "Water (H₂O)",
        description: "Single water molecule — simplest benchmark for MACE-OFF.",
        formula: "H2O",
        atomCount: 3,
        elements: ["H", "O"],
        recommendedModel: "MACE-OFF",
        xyzData: `3
Water molecule
O 0.000000 0.000000 0.119262
H 0.000000 0.763239 -0.477047
H 0.000000 -0.763239 -0.477047`,
      },
      {
        // Verified: C-C=1.52 Å, C-O=1.44 Å, O-H=0.97 Å — standard bond lengths
        id: "ethanol",
        name: "Ethanol (C₂H₅OH)",
        description: "Ethanol molecule — standard organic benchmark.",
        formula: "C2H5OH",
        atomCount: 9,
        elements: ["C", "H", "O"],
        recommendedModel: "MACE-OFF",
        xyzData: `9
Ethanol molecule
C -0.047600 1.406300 0.000000
C 0.002300 -0.115100 0.000000
O 1.367500 -0.563700 0.000000
H -1.086000 1.761400 0.000000
H 0.437200 1.838700 -0.891400
H 0.437200 1.838700 0.891400
H -0.520100 -0.505100 0.891400
H -0.520100 -0.505100 -0.891400
H 1.379400 -1.530400 0.000000`,
      },
      {
        // Verified: C-H=1.089 Å (exp 1.089), tetrahedral symmetry (Td)
        id: "methane",
        name: "Methane (CH₄)",
        description: "Methane molecule — minimal organic benchmark.",
        formula: "CH4",
        atomCount: 5,
        elements: ["C", "H"],
        recommendedModel: "MACE-OFF",
        xyzData: `5
Methane molecule
C 0.000000 0.000000 0.000000
H 0.629118 0.629118 0.629118
H -0.629118 -0.629118 0.629118
H -0.629118 0.629118 -0.629118
H 0.629118 -0.629118 -0.629118`,
      },
      {
        // Verified: C-C=1.396 Å (exp 1.397), C-H=1.088 Å (exp 1.084), planar D6h
        id: "benzene",
        name: "Benzene (C₆H₆)",
        description: "Benzene ring — aromatic molecule benchmark.",
        formula: "C6H6",
        atomCount: 12,
        elements: ["C", "H"],
        recommendedModel: "MACE-OFF",
        xyzData: `12
Benzene molecule
C 0.000000 1.396000 0.000000
C 1.209000 0.698000 0.000000
C 1.209000 -0.698000 0.000000
C 0.000000 -1.396000 0.000000
C -1.209000 -0.698000 0.000000
C -1.209000 0.698000 0.000000
H 0.000000 2.484000 0.000000
H 2.150000 1.242000 0.000000
H 2.150000 -1.242000 0.000000
H 0.000000 -2.484000 0.000000
H -2.150000 -1.242000 0.000000
H -2.150000 1.242000 0.000000`,
      },
      {
        // Source: PubChem CID 2244 (MMFF94 3D conformer). 4O + 9C + 8H = 21 atoms.
        // Previous data was WRONG: had 8C + 5O (not aspirin), all z=0 (flat).
        id: "aspirin",
        name: "Aspirin (C₉H₈O₄)",
        description: "Aspirin (acetylsalicylic acid) — medium organic molecule.",
        formula: "C9H8O4",
        atomCount: 21,
        elements: ["C", "H", "O"],
        recommendedModel: "MACE-OFF",
        xyzData: `21
Aspirin (acetylsalicylic acid) C9H8O4
O  1.2333  0.5540  0.7792
O -0.6952 -2.7148 -0.7502
O  0.7958 -2.1843  0.8685
O  1.7813  0.8105 -1.4821
C -0.0857  0.6088  0.4403
C -0.7927 -0.5515  0.1244
C -0.7288  1.8464  0.4133
C -2.1426 -0.4741 -0.2184
C -2.0787  1.9238  0.0706
C -2.7855  0.7636 -0.2453
C -0.1409 -1.8536  0.1477
C  2.1094  0.6715 -0.3113
C  3.5305  0.5996  0.1635
H -0.1851  2.7545  0.6593
H -2.7247 -1.3605 -0.4564
H -2.5797  2.8872  0.0506
H -3.8374  0.8238 -0.5090
H  3.7290  1.4184  0.8593
H  4.2045  0.6969 -0.6924
H  3.7105 -0.3659  0.6426
H -0.2555 -3.5916 -0.7337`,
      },
    ],
  },

  // =========================================================================
  // NON-COVALENT INTERACTIONS — ml_peg/app/non_covalent_interactions/
  // =========================================================================
  {
    id: "non-covalent",
    name: "Non-Covalent Interactions",
    description: "Dimers and complexes for testing van der Waals and hydrogen bonding.",
    mlpegPath: "ml_peg/app/non_covalent_interactions/",
    entries: [
      {
        // Verified: O···O ≈ 2.91 Å, consistent with S22 benchmark geometry
        id: "water-dimer",
        name: "Water dimer",
        description: "Two water molecules with hydrogen bond — key H-bond benchmark.",
        formula: "(H2O)2",
        atomCount: 6,
        elements: ["H", "O"],
        recommendedModel: "MACE-OFF",
        xyzData: `6
Water dimer - hydrogen bonded
O -1.551007 -0.114520 0.000000
H -1.934259 0.762503 0.000000
H -0.599677 0.040712 0.000000
O 1.350625 0.111469 0.000000
H 1.680398 -0.373741 -0.758561
H 1.680398 -0.373741 0.758561`,
      },
      {
        // Verified: C···C=3.7 Å, each CH4 tetrahedral with C-H=1.089 Å
        id: "methane-dimer",
        name: "Methane dimer",
        description: "Two methane molecules — weak dispersion interaction benchmark.",
        formula: "(CH4)2",
        atomCount: 10,
        elements: ["C", "H"],
        recommendedModel: "MACE-OFF",
        xyzData: `10
Methane dimer - dispersion interaction
C -1.850000 0.000000 0.000000
H -1.220882 0.629118 0.629118
H -2.479118 -0.629118 0.629118
H -2.479118 0.629118 -0.629118
H -1.220882 -0.629118 -0.629118
C 1.850000 0.000000 0.000000
H 2.479118 0.629118 0.629118
H 1.220882 -0.629118 0.629118
H 1.220882 0.629118 -0.629118
H 2.479118 -0.629118 -0.629118`,
      },
    ],
  },

  // =========================================================================
  // SURFACES — ml_peg/app/surfaces/
  // =========================================================================
  {
    id: "surfaces",
    name: "Surfaces",
    description: "Surface slabs for adsorption and surface energy benchmarks.",
    mlpegPath: "ml_peg/app/surfaces/",
    entries: [
      {
        // Verified: a_surf=a/√2=2.556 Å, interlayer d=a/√3=2.087 Å, 20 Å vacuum
        id: "cu-111",
        name: "Cu(111) surface",
        description: "3-layer Cu(111) slab — standard surface benchmark.",
        formula: "Cu (slab)",
        atomCount: 3,
        elements: ["Cu"],
        recommendedModel: "MACE-MPA-0",
        xyzData: `3
Lattice="2.556 0.0 0.0 1.278 2.213 0.0 0.0 0.0 20.0" Properties=species:S:1:pos:R:3 pbc="T T T"
Cu 0.000000 0.000000 10.000000
Cu 1.278000 0.737700 12.087000
Cu 2.556000 1.475400 14.174000`,
      },
      {
        // Two bulk-terminated diamond (111) bilayers, a = 5.43 Å: in-plane
        // a/√2, bilayer spacing a/(4√3) = 0.784 Å, bond a√3/4 = 2.351 Å;
        // checked by test/mlpeg-catalog.test.ts (D57: spacing and stacking were wrong).
        id: "si-111",
        name: "Si(111) surface",
        description: "Silicon (111) surface slab — semiconductor surface benchmark.",
        formula: "Si (slab)",
        atomCount: 4,
        elements: ["Si"],
        recommendedModel: "MACE-MPA-0",
        xyzData: `4
Lattice="3.839590 0.0 0.0 1.919795 3.325182 0.0 0.0 0.0 25.0" Properties=species:S:1:pos:R:3 pbc="T T T"
Si 1.919795 1.108394 10.000000
Si 3.839590 2.216788 10.783753
Si 3.839590 2.216788 13.135012
Si 0.000000 0.000000 13.918765`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Get all categories. */
export function getCategories(): CatalogCategory[] {
  return MLPEG_CATALOG;
}

/** Get all entries across all categories. */
export function getAllEntries(): CatalogEntry[] {
  return MLPEG_CATALOG.flatMap((cat) => cat.entries);
}

/** Find an entry by ID. */
export function getEntryById(id: string): CatalogEntry | undefined {
  return getAllEntries().find((entry) => entry.id === id);
}

/** Get total number of structures in the catalog. */
export function getCatalogSize(): number {
  return getAllEntries().length;
}

/**
 * Convert a CatalogEntry's XYZ data into a File object.
 * This allows catalog entries to be used in the same upload flow
 * as user-uploaded files — no special handling needed downstream.
 */
export function catalogEntryToFile(entry: CatalogEntry): File {
  const blob = new Blob([entry.xyzData], { type: "chemical/x-xyz" });
  return new File([blob], `${entry.id}.xyz`, { type: "chemical/x-xyz" });
}

/** Find multiple entries by their IDs. Returns found entries in input order. */
export function getEntriesByIds(ids: string[]): (CatalogEntry & { category: string })[] {
  const all = MLPEG_CATALOG.flatMap((cat) =>
    cat.entries.map((e) => ({ ...e, category: cat.id }))
  );
  const map = new Map(all.map((e) => [e.id, e]));
  return ids.flatMap((id) => {
    const entry = map.get(id);
    return entry ? [entry] : [];
  });
}

/** Get the category name for a given category id. */
export function getCategoryName(categoryId: string): string {
  return MLPEG_CATALOG.find((c) => c.id === categoryId)?.name ?? categoryId;
}
