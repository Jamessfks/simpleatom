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
   * energies. MACE-MP-0 is trained on PBE DFT, so it inherits PBE's
   * differences from experiment, which depend on the material and the
   * property. These values provide CONTEXT for researchers, not a
   * scoring target.
   * Direct comparison of MACE total energy/atom to experimental
   * cohesive energy is scientifically invalid without accounting for
   * the isolated atom reference and the DFT functional's known biases.
   *
   * Sources: lattice constants are COD records (Crystallography Open
   * Database); cohesive energies are Kittel "Introduction to Solid State
   * Physics" 8th ed. as tabulated by KnowledgeDoor, Farid & Godby PRB 43
   * 14248 (Si), and NIST-JANAF (NaCl). Each entry's `source` string names
   * the record, temperature and conversion.
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
/**
 * The cohesive energies of Si, C, Cu and Fe are the values in Kittel's table
 * (8th ed., 2005) as the KnowledgeDoor Elements Handbook reproduces it
 * (https://www.knowledgedoor.com/2/elements_handbook/cohesive_energy.html),
 * which is where they were read from (docs/v2/validation/structure-references.json).
 */
const KITTEL = "Exp (Kittel, 8th ed., as tabulated by KnowledgeDoor Elements Handbook)";

export const MLPEG_CATALOG: CatalogCategory[] = [
  // =========================================================================
  // BULK CRYSTALS — ml_peg/app/bulk_crystal/
  // =========================================================================
  {
    id: "bulk-crystals",
    name: "Bulk Crystals",
    description: "Bulk crystals at their experimental lattice constants, for single-point, relaxation and molecular-dynamics tests.",
    mlpegPath: "ml_peg/app/bulk_crystal/",
    entries: [
      {
        // 8-atom conventional diamond cell at the experimental a = 5.430941 Å
        // (COD 9011998, Hom, Kiszenick & Post 1975, 298.15 K). Built with
        // ase.build.bulk("Si", "diamond", a=5.430941, cubic=True) (ASE 3.27.0),
        // written to 8 decimals; geometry checked by test/mlpeg-catalog.test.ts
        // (D57: was a 2-atom basis in a cubic cell; D71: cell = cited value).
        id: "si-diamond",
        name: "Silicon (diamond)",
        description: "Diamond cubic silicon — the most common semiconductor benchmark.",
        formula: "Si",
        atomCount: 8,
        elements: ["Si"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -4.63, source: `${KITTEL}, cf. Farid & Godby PRB 43 14248: 4.62±0.08` },
          latticeConstant: { value: 5.430941, source: "Exp (COD 9011998, Hom, Kiszenick & Post 1975, J. Appl. Cryst. 8, 457; 298.15 K)" },
        },
        xyzData: `8
Lattice="5.43094100 0.00000000 0.00000000 0.00000000 5.43094100 0.00000000 0.00000000 0.00000000 5.43094100" Properties=species:S:1:pos:R:3 pbc="T T T"
Si 0.00000000 0.00000000 0.00000000
Si 1.35773525 1.35773525 1.35773525
Si 0.00000000 2.71547050 2.71547050
Si 1.35773525 4.07320575 4.07320575
Si 2.71547050 0.00000000 2.71547050
Si 4.07320575 1.35773525 4.07320575
Si 2.71547050 2.71547050 0.00000000
Si 4.07320575 4.07320575 1.35773525`,
      },
      {
        // 4-atom conventional fcc cell at the experimental a = 3.613 Å
        // (COD 9013014, Suh, Ohta & Waseda 1988, 293 K). Built with
        // ase.build.bulk("Cu", "fcc", a=3.613, cubic=True) (ASE 3.27.0).
        id: "cu-fcc",
        name: "Copper (FCC)",
        description: "Face-centered cubic copper — standard metal benchmark.",
        formula: "Cu",
        atomCount: 4,
        elements: ["Cu"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -3.49, source: KITTEL },
          latticeConstant: { value: 3.613, source: "Exp (COD 9013014, Suh, Ohta & Waseda 1988, J. Mater. Sci. 23, 757; 293 K)" },
        },
        xyzData: `4
Lattice="3.61300000 0.00000000 0.00000000 0.00000000 3.61300000 0.00000000 0.00000000 0.00000000 3.61300000" Properties=species:S:1:pos:R:3 pbc="T T T"
Cu 0.00000000 0.00000000 0.00000000
Cu 0.00000000 1.80650000 1.80650000
Cu 1.80650000 0.00000000 1.80650000
Cu 1.80650000 1.80650000 0.00000000`,
      },
      {
        // 8-atom conventional rocksalt cell at the experimental a = 5.6401 Å
        // (COD 9003308, Walker et al. 2004, 298.15 K). Built with
        // ase.build.bulk("NaCl", "rocksalt", a=5.6401, cubic=True) (ASE 3.27.0).
        id: "nacl-rocksalt",
        name: "Sodium Chloride (rocksalt)",
        description: "NaCl in rocksalt structure — ionic crystal benchmark.",
        formula: "NaCl",
        atomCount: 8,
        elements: ["Na", "Cl"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          // NIST-JANAF atomization energy against free neutral atoms at 0 K:
          // dfH0[Na(g)] + dfH0[Cl(g)] - dfH0[NaCl(cr)] = 107.549 + 119.621 + 410.693
          // = 637.863 kJ/mol (tables Na-005, Cl-001, Cl-053) / 96.4853 kJ/mol per eV
          // = 6.611 eV per formula unit, ÷ 2 atoms = 3.3055 eV/atom. At 298.15 K the
          // enthalpy is 6.6303 eV per formula unit. The old -6.68 eV/f.u. ("CRC
          // Handbook") could not be traced to any source.
          cohesiveEnergy: { value: -3.3055, source: "Exp (NIST-JANAF, 0 K, vs free neutral atoms: 6.611 eV/formula unit ÷ 2 atoms; 6.630 eV/f.u. at 298.15 K)" },
          latticeConstant: { value: 5.6401, source: "Exp (COD 9003308, Walker et al. 2004, Am. Mineral. 89, 204; 298.15 K)" },
        },
        xyzData: `8
Lattice="5.64010000 0.00000000 0.00000000 0.00000000 5.64010000 0.00000000 0.00000000 0.00000000 5.64010000" Properties=species:S:1:pos:R:3 pbc="T T T"
Na 0.00000000 0.00000000 0.00000000
Cl 2.82005000 0.00000000 0.00000000
Na 0.00000000 2.82005000 2.82005000
Cl 2.82005000 2.82005000 2.82005000
Na 2.82005000 0.00000000 2.82005000
Cl 0.00000000 0.00000000 2.82005000
Na 2.82005000 2.82005000 0.00000000
Cl 0.00000000 2.82005000 0.00000000`,
      },
      {
        // 2-atom conventional bcc cell at the experimental a = 2.8665 Å
        // (COD 9008536, Wyckoff 1963, 298 K). Built with
        // ase.build.bulk("Fe", "bcc", a=2.8665, cubic=True) (ASE 3.27.0).
        id: "fe-bcc",
        name: "Iron (BCC)",
        description: "Body-centered cubic iron — magnetic metal benchmark.",
        formula: "Fe",
        atomCount: 2,
        elements: ["Fe"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -4.28, source: KITTEL },
          latticeConstant: { value: 2.8665, source: "Exp (COD 9008536, Wyckoff 1963, Crystal Structures, 2nd ed., vol. 1; 298 K)" },
        },
        xyzData: `2
Lattice="2.86650000 0.00000000 0.00000000 0.00000000 2.86650000 0.00000000 0.00000000 0.00000000 2.86650000" Properties=species:S:1:pos:R:3 pbc="T T T"
Fe 0.00000000 0.00000000 0.00000000
Fe 1.43325000 1.43325000 1.43325000`,
      },
      {
        // 8-atom conventional diamond cell at the experimental a = 3.566986 Å
        // (COD 9011997, Hom, Kiszenick & Post 1975, 298.15 K). Built with
        // ase.build.bulk("C", "diamond", a=3.566986, cubic=True) (ASE 3.27.0);
        // geometry checked by test/mlpeg-catalog.test.ts (D57).
        id: "c-diamond",
        name: "Diamond (carbon)",
        description: "Diamond cubic carbon — hard material benchmark.",
        formula: "C",
        atomCount: 8,
        elements: ["C"],
        recommendedModel: "MACE-MPA-0",
        reference: {
          cohesiveEnergy: { value: -7.37, source: KITTEL },
          latticeConstant: { value: 3.566986, source: "Exp (COD 9011997, Hom, Kiszenick & Post 1975, J. Appl. Cryst. 8, 457; 298.15 K)" },
        },
        xyzData: `8
Lattice="3.56698600 0.00000000 0.00000000 0.00000000 3.56698600 0.00000000 0.00000000 0.00000000 3.56698600" Properties=species:S:1:pos:R:3 pbc="T T T"
C 0.00000000 0.00000000 0.00000000
C 0.89174650 0.89174650 0.89174650
C 0.00000000 1.78349300 1.78349300
C 0.89174650 2.67523950 2.67523950
C 1.78349300 0.00000000 1.78349300
C 2.67523950 0.89174650 2.67523950
C 1.78349300 1.78349300 0.00000000
C 2.67523950 2.67523950 0.89174650`,
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
        // A hand-entered model geometry: O-H 0.9686 Å, H-O-H 104.0°. The measured
        // gas-phase geometry is r(OH) 0.958 Å, ∠HOH 104.4776° (NIST CCCBDB,
        // cccbdb.nist.gov/expgeom2x.asp?casno=7732185).
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
        // A hand-entered trans geometry: C-C 1.522 Å, C-O 1.437 Å, O-H 0.967 Å.
        // NIST CCCBDB lists r(CC) 1.512 Å, r(CO) 1.431 Å, r(OH) 0.971 Å
        // (cccbdb.nist.gov/expgeom2x.asp?casno=64175; geometry type not stated).
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
        // Tetrahedral (Td) model geometry with C-H 1.0896 Å; NIST CCCBDB lists
        // r(CH) 1.087 Å (cccbdb.nist.gov/expgeom2x.asp?casno=74828).
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
        // Planar D6h, a regular hexagon built from NIST CCCBDB's r(CC) = 1.397 Å
        // and r(CH) = 1.084 Å (cccbdb.nist.gov/expgeom2x.asp?casno=71432; the page
        // does not say whether these are re, r0 or rs). All six C-C and all six
        // C-H bonds are equal by construction, written to 8 decimals (D71: the
        // old hand-rounded cell had C-H of 1.0869 Å on four bonds and 1.0880 Å on two).
        id: "benzene",
        name: "Benzene (C₆H₆)",
        description: "Benzene ring — aromatic molecule benchmark.",
        formula: "C6H6",
        atomCount: 12,
        elements: ["C", "H"],
        recommendedModel: "MACE-OFF",
        xyzData: `12
Benzene molecule
C 0.00000000 1.39700000 0.00000000
C 1.20983749 0.69850000 0.00000000
C 1.20983749 -0.69850000 0.00000000
C 0.00000000 -1.39700000 0.00000000
C -1.20983749 -0.69850000 0.00000000
C -1.20983749 0.69850000 0.00000000
H 0.00000000 2.48100000 0.00000000
H 2.14860903 1.24050000 0.00000000
H 2.14860903 -1.24050000 0.00000000
H 0.00000000 -2.48100000 0.00000000
H -2.14860903 -1.24050000 0.00000000
H -2.14860903 1.24050000 0.00000000`,
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
        // S22 entry 2, water dimer (Cs), CCSD(T)/cc-pVQZ geometry: O···O 2.9104 Å
        // (BEGDB id 82; Jurečka, Šponer, Černý & Hobza, Phys. Chem. Chem. Phys. 8,
        // 1985 (2006), doi 10.1039/b600027d). Coordinates identical to psi4's S22.py.
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
        // S22 entry 8, methane dimer (D3d), CCSD(T)/cc-pVTZ geometry: C···C 3.7183 Å
        // (BEGDB id 89). Source: Jurečka, Šponer, Černý & Hobza,
        // Phys. Chem. Chem. Phys. 8, 1985 (2006), doi 10.1039/b600027d.
        // Coordinates identical to psi4's S22.py.
        id: "methane-dimer",
        name: "Methane dimer",
        description: "Two methane molecules (S22 entry 8) — weak dispersion interaction benchmark.",
        formula: "(CH4)2",
        atomCount: 10,
        elements: ["C", "H"],
        recommendedModel: "MACE-OFF",
        xyzData: `10
Methane dimer - S22 #8, D3d, CCSD(T)/cc-pVTZ (Jurecka et al., PCCP 2006)
C 0.00000000 -0.00014000 1.85916100
H -0.88855100 0.51306000 1.49468500
H 0.88855100 0.51306000 1.49468500
H 0.00000000 -1.02633900 1.49486800
H 0.00000000 0.00008900 2.94828400
C 0.00000000 0.00014000 -1.85916100
H 0.00000000 -0.00008900 -2.94828400
H -0.88855100 -0.51306000 -1.49468500
H 0.88855100 -0.51306000 -1.49468500
H 0.00000000 1.02633900 -1.49486800`,
      },
    ],
  },

  // =========================================================================
  // SURFACES — ml_peg/app/surfaces/
  // =========================================================================
  {
    id: "surfaces",
    name: "Surfaces",
    description: "Unrelaxed 3-layer Cu(111) and 2-bilayer Si(111) slabs, periodic in the surface plane, for relaxation and adsorption tests, not converged surface energies.",
    mlpegPath: "ml_peg/app/surfaces/",
    entries: [
      {
        // Three close-packed layers, unrelaxed, built from the cited a = 3.613 Å with
        // ase.build.fcc111("Cu", size=(1, 1, 3), a=3.613, vacuum=None, orthogonal=False)
        // (ASE 3.27.0), then a 20 Å cell height with the slab centred: in-plane
        // a/√2 = 2.554777 Å at exactly 60°, interlayer a/√3 = 2.085967 Å, a vacuum
        // gap of 15.83 Å. Periodic in x and y only (D70: pbc "T T T" gave a stress
        // for a slab, which has no cell volume along z).
        id: "cu-111",
        name: "Cu(111) surface",
        description: "3-layer Cu(111) slab — standard surface benchmark.",
        formula: "Cu (slab)",
        atomCount: 3,
        elements: ["Cu"],
        recommendedModel: "MACE-MPA-0",
        xyzData: `3
Lattice="2.55477680 0.00000000 0.00000000 1.27738840 2.21250161 0.00000000 0.00000000 0.00000000 20.00000000" Properties=species:S:1:pos:R:3 pbc="T T F"
Cu 1.27738840 0.73750054 7.91403348
Cu 0.00000000 1.47500107 10.00000000
Cu 0.00000000 0.00000000 12.08596652`,
      },
      {
        // Two intact diamond (111) bilayers at the cited a = 5.430941 Å: in-plane
        // a/√2 = 3.840255 Å at 60°, vertical gaps 0.783889 (inside a bilayer),
        // 2.351666 (between) and 0.783889 Å, bond a√3/4 = 2.351666 Å, a vacuum gap
        // of 21.08 Å. Layers 1-4 of ase.build.diamond111("Si", size=(1, 1, 6),
        // a=5.430941, vacuum=None, orthogonal=False) (ASE 3.27.0): ASE's own
        // 4-layer slab starts mid-bilayer and leaves the outer atoms one bond each.
        // Periodic in x and y only (D70). Checked by test/mlpeg-catalog.test.ts
        // (D57: spacing and stacking were wrong).
        id: "si-111",
        name: "Si(111) surface",
        description: "Silicon (111) surface slab — semiconductor surface benchmark.",
        formula: "Si (slab)",
        atomCount: 4,
        elements: ["Si"],
        recommendedModel: "MACE-MPA-0",
        xyzData: `4
Lattice="3.84025521 0.00000000 0.00000000 1.92012760 3.32575857 0.00000000 0.00000000 0.00000000 25.00000000" Properties=species:S:1:pos:R:3 pbc="T T F"
Si 1.92012760 1.10858619 10.54027797
Si 0.00000000 2.21717238 11.32416678
Si 0.00000000 2.21717238 13.67583322
Si 0.00000000 0.00000000 14.45972203`,
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
