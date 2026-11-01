/**
 * MATERIALS PROJECT REFERENCE SET — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   python test_scripts/fetch_mp_reference.py --fetch
 *
 * Every number here came from the Materials Project's unauthenticated OPTIMADE
 * endpoint. Nothing is hand-entered, and nothing is invented. The generator
 * refuses to write this file unless four invariants hold — see
 * test_scripts/fetch_mp_reference.py for the full argument:
 *
 *   1. each element-reference entry has MP formation_energy_per_atom == 0,
 *      proving it IS MP's reference phase for that element;
 *   2. each compound is an MP hull ground state;
 *   3. no compound contains an element that attracts MP2020 anion corrections;
 *   4. every element of every compound has a reference structure in this set.
 *
 * Geometries are the structures MP's OPTIMADE endpoint serves for each id, as
 * lattice_vectors + cartesian_site_positions. MP serves the structure from its
 * best-ranked calculation (r2SCAN, then GGA+U, then GGA), so 12 of the 13 cells
 * here are r2SCAN-relaxed. Only mp-1048 (NiTi) has no r2SCAN entry, and its cell
 * is from the GGA/GGA+U calculation. They are not PBE cells: for the four
 * ids with archived GGA-era pages (Cu, Ni, AlNi, AlFe) the served conventional
 * cell is 0.87-1.21 % smaller than MP's own GGA cell
 * (docs/v2/validation/structure-references.json, H1). Each cell is written twice,
 * as extended XYZ (positions in A to 8 decimal places) and as an ASE-generated CIF.
 *
 * The benchmark sends the CIF (lib/benchmark-structures.ts). The extended XYZ
 * would compute the same thing: mace-api/calculate.py reads a ".xyz" with ASE's
 * extended-XYZ reader, which honours the `Lattice=` and `pbc="T T T"` on the
 * comment line. The 2026-10-31 structure audit confirmed each pair describes one
 * structure (energy difference at most 3.3e-9 eV). Each CIF was also checked to
 * survive a write/read round trip with no loss of minimum-image interatomic
 * distances or cell parameters; the measured deviations are below.
 *
 * Formation energies are from MP's own `_mp_stability["gga_gga+u"]` —
 * PBE / PBE+U, matching MACE-MP-0's training level of theory. The r2SCAN keys
 * MP also exposes are deliberately not used. So the cells (r2SCAN) and the
 * energies compared with them (GGA/GGA+U) come from different functionals.
 */

/** One Materials Project entry: a structure plus MP's published value for it. */
export interface MpReferenceEntry {
  /** SimpleAtom structure id, used as the benchmark selection key. */
  id: string;
  /** Materials Project id, e.g. "mp-1487". */
  mpId: string;
  /** Display name. */
  name: string;
  /** MP's reduced formula (alphabetical, e.g. "AlNi"). */
  formula: string;
  /** MP's descriptive formula. */
  formulaDescriptive: string;
  /**
   * "compound" rows are scored against MP.
   * "element-reference" rows exist only to supply e_ref for the same-model
   * formation energy; MP reports 0 eV/atom for them by construction.
   */
  role: "compound" | "element-reference";
  /** For element-reference rows: which element this is the reference phase for. */
  element?: string;
  elements: string[];
  /** Atom counts per element in this cell. The formation energy stoichiometry. */
  composition: Record<string, number>;
  atomCount: number;
  /** MP published formation energy for the gga_gga+u dataset, eV/atom. */
  mpFormationEnergyPerAtom: number;
  /** MP energy above hull, eV/atom. 0 means hull ground state. */
  mpEnergyAboveHull: number;
  /** MP thermo document id the two numbers above came from. */
  mpThermoId: string;
  /** MP's own last-updated stamp for that thermo document. */
  mpThermoLastUpdated: string;
  /** Extended XYZ of the served cell (r2SCAN-relaxed except mp-1048). This is what the benchmark sends. */
  xyzData: string;
  /** ASE-generated CIF of the same cell, kept as a cross-check; it gives the same energy as `xyzData`. */
  cifData: string;
  /**
   * Round-trip fidelity of `cifData`, measured at generation time:
   * largest change in any minimum-image interatomic distance (A) and in any
   * cell parameter (A or degrees) after writing and re-reading the CIF.
   */
  cifRoundTrip: { maxDistanceDeviationA: number; maxCellparDeviation: number };
}

/** Where this data came from, so a reader can re-derive it. */
export const MP_REFERENCE_PROVENANCE = {
  endpoint: "https://optimade.materialsproject.org/v1/structures",
  infoEndpoint: "https://optimade.materialsproject.org/v1/info",
  optimadeApiVersion: "1.2.0",
  /** MP thermo dataset key. PBE / PBE+U — the level MACE-MP-0 was trained on. */
  datasetKey: "gga_gga+u",
  datasetLabel: "PBE / PBE+U (GGA, GGA+U)",
  authentication: "none — MP's OPTIMADE endpoint requires no API key",
  fetchedAtUtc: "2026-08-10T06:27:43Z",
  generator: "test_scripts/fetch_mp_reference.py",
  /** MP material pages, for a reader who wants to check a row by hand. */
  materialUrlPrefix: "https://next-gen.materialsproject.org/materials/",
} as const;

export const MP_REFERENCE_ENTRIES: MpReferenceEntry[] = [
  {
    id: "mp-aucu3",
    mpId: "mp-2258",
    name: "AuCu3 (mp-2258)",
    formula: "AuCu3",
    formulaDescriptive: "AuCu3",
    role: "compound",
    elements: ["Au", "Cu"],
    composition: {"Cu": 3, "Au": 1},
    atomCount: 4,
    mpFormationEnergyPerAtom: -0.03656425250000028,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-2258_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:14:25.435000",
    xyzData: `4
Lattice="3.73538756 -0.00000000 0.00000000 0.00000000 3.73538756 0.00000000 0.00000000 0.00000000 3.73538756" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-2258 source=optimade.materialsproject.org
Cu 0.00000000 1.86769378 1.86769378
Cu 1.86769378 1.86769378 0.00000000
Cu 1.86769378 0.00000000 1.86769378
Au 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       Cu3Au
_chemical_formula_sum              "Cu3 Au1"
_cell_length_a       3.73538756
_cell_length_b       3.73538756
_cell_length_c       3.73538756
_cell_angle_alpha    90.0
_cell_angle_beta     90.0
_cell_angle_gamma    90.0

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Cu  Cu1       1.0  0.0  0.5  0.5  1.0000
  Cu  Cu2       1.0  0.5  0.5  0.0  1.0000
  Cu  Cu3       1.0  0.5  0.0  0.5  1.0000
  Au  Au1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-al2cu",
    mpId: "mp-985806",
    name: "Al2Cu (mp-985806)",
    formula: "Al2Cu",
    formulaDescriptive: "Al2Cu",
    role: "compound",
    elements: ["Al", "Cu"],
    composition: {"Al": 2, "Cu": 1},
    atomCount: 3,
    mpFormationEnergyPerAtom: -0.17806622999999946,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-985806_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:15:30.286000",
    xyzData: `3
Lattice="0.00000000 4.06067500 0.00000000 2.85109400 -2.03033800 2.03033800 0.00000000 0.00000000 -4.06067500" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-985806 source=optimade.materialsproject.org
Al 0.00000000 0.00000000 0.00000000
Al 0.00000000 2.03033750 -2.03033750
Cu 1.42554700 -0.00000025 -2.03033725`,
    cifData: `data_image0
_chemical_formula_structural       Al2Cu
_chemical_formula_sum              "Al2 Cu1"
_cell_length_a       4.060675
_cell_length_b       4.046391205175792
_cell_length_c       4.060675
_cell_angle_alpha    120.11684878459329
_cell_angle_beta     90.0
_cell_angle_gamma    120.11684878459329

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Al  Al1       1.0  0.0  0.0  0.0  1.0000
  Al  Al2       1.0  0.5  0.0  0.5  1.0000
  Cu  Cu1       1.0  0.25  0.5  0.75  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 8.881784197001252e-16, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-alfe",
    mpId: "mp-2658",
    name: "AlFe (mp-2658)",
    formula: "AlFe",
    formulaDescriptive: "AlFe",
    role: "compound",
    elements: ["Al", "Fe"],
    composition: {"Al": 1, "Fe": 1},
    atomCount: 2,
    mpFormationEnergyPerAtom: -0.3268870149999996,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-2658_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:15:40.557000",
    xyzData: `2
Lattice="2.84550600 0.00000000 0.00000000 0.00000000 2.84550600 0.00000000 0.00000000 0.00000000 2.84550600" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-2658 source=optimade.materialsproject.org
Al 0.00000000 0.00000000 0.00000000
Fe 1.42275300 1.42275300 1.42275300`,
    cifData: `data_image0
_chemical_formula_structural       AlFe
_chemical_formula_sum              "Al1 Fe1"
_cell_length_a       2.845506
_cell_length_b       2.845506
_cell_length_c       2.845506
_cell_angle_alpha    90.0
_cell_angle_beta     90.0
_cell_angle_gamma    90.0

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Al  Al1       1.0  0.0  0.0  0.0  1.0000
  Fe  Fe1       1.0  0.5  0.5  0.5  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-niti",
    mpId: "mp-1048",
    name: "NiTi (mp-1048)",
    formula: "NiTi",
    formulaDescriptive: "NiTi",
    role: "compound",
    elements: ["Ni", "Ti"],
    composition: {"Ti": 2, "Ni": 2},
    atomCount: 4,
    mpFormationEnergyPerAtom: -0.3958550266666663,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-1048_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:15:04.513000",
    xyzData: `4
Lattice="2.83050293 0.00000000 -0.59169651 0.00000000 3.96696035 0.00000000 -0.28806889 0.00000000 4.81702090" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-1048 source=optimade.materialsproject.org
Ti 1.55895958 2.97522026 3.39833561
Ti 0.98347446 0.99174009 0.82698878
Ni 2.51887850 2.97522026 1.03794793
Ni 0.02355554 0.99174009 3.18737646`,
    cifData: `data_image0
_chemical_formula_structural       Ti2Ni2
_chemical_formula_sum              "Ti2 Ni2"
_cell_length_a       2.891686635284807
_cell_length_b       3.96696035
_cell_length_c       4.825626802439517
_cell_angle_alpha    90.0
_cell_angle_beta     105.2295898585317
_cell_angle_gamma    90.0

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Ti  Ti1       1.0  0.63045201  0.7499999999999999  0.7829262000000001  1.0000
  Ti  Ti2       1.0  0.36954799  0.24999999999999997  0.21707380000000004  1.0000
  Ni  Ni1       1.0  0.92337785  0.7499999999999999  0.32889776000000004  1.0000
  Ni  Ni2       1.0  0.07662214999999999  0.24999999999999997  0.67110224  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 8.881784197001252e-16, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-alti",
    mpId: "mp-1953",
    name: "AlTi (mp-1953)",
    formula: "AlTi",
    formulaDescriptive: "AlTi",
    role: "compound",
    elements: ["Al", "Ti"],
    composition: {"Ti": 1, "Al": 1},
    atomCount: 2,
    mpFormationEnergyPerAtom: -0.40694453166666733,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-1953_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:12:26.747000",
    xyzData: `2
Lattice="2.81075181 0.00000000 0.00000000 0.00000000 2.81075181 -0.00000000 0.00000000 -0.00000000 4.06642192" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-1953 source=optimade.materialsproject.org
Ti 1.40537591 1.40537591 2.03321096
Al 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       TiAl
_chemical_formula_sum              "Ti1 Al1"
_cell_length_a       2.81075181
_cell_length_b       2.81075181
_cell_length_c       4.06642192
_cell_angle_alpha    90.0
_cell_angle_beta     90.0
_cell_angle_gamma    90.0

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Ti  Ti1       1.0  0.5  0.5  0.5  1.0000
  Al  Al1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-al3ni",
    mpId: "mp-622209",
    name: "Al3Ni (mp-622209)",
    formula: "Al3Ni",
    formulaDescriptive: "Al12Ni4",
    role: "compound",
    elements: ["Al", "Ni"],
    composition: {"Al": 12, "Ni": 4},
    atomCount: 16,
    mpFormationEnergyPerAtom: -0.4049159087500005,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-622209_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:16:24.565000",
    xyzData: `16
Lattice="4.77057136 0.00001090 0.00000000 0.00001583 6.55890518 0.00000000 0.00000000 0.00000000 7.30433827" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-622209 source=optimade.materialsproject.org
Al 4.36847323 0.06812428 1.82608457
Al 1.73555575 1.12368636 3.24238648
Al 1.73555575 1.12368636 0.40978265
Al 4.12080542 2.15576918 4.06197282
Al 0.64978177 4.40314690 3.24236545
Al 3.03503144 5.43522972 6.89455562
Al 0.64978177 4.40314690 0.40980369
Al 3.03503144 5.43522972 4.06195179
Al 4.12080542 2.15576918 6.89453458
Al 2.78737860 3.34758139 1.82608457
Al 0.40211396 6.49079180 5.47825370
Al 1.98320859 3.21133469 5.47825370
Ni 2.11950384 5.71333413 1.82608457
Ni 0.26580417 2.43386576 1.82608457
Ni 2.65108335 0.84558195 5.47825370
Ni 4.50478302 4.12505032 5.47825370`,
    cifData: `data_image0
_chemical_formula_structural       Al12Ni4
_chemical_formula_sum              "Al12 Ni4"
_cell_length_a       4.770571360012452
_cell_length_b       6.558905180019103
_cell_length_c       7.30433827
_cell_angle_alpha    90.0
_cell_angle_beta     90.0
_cell_angle_gamma    89.99973080413504

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Al  Al1       1.0  0.91571276  0.01038501  0.24999999999999997  1.0000
  Al  Al2       1.0  0.36380402  0.17132164  0.44389872999999996  1.0000
  Al  Al3       1.0  0.36380402  0.17132164  0.05610127  1.0000
  Al  Al4       1.0  0.8637959500000001  0.32867677  0.55610415  1.0000
  Al  Al5       1.0  0.13620405000000002  0.6713232299999999  0.44389585  1.0000
  Al  Al6       1.0  0.63619598  0.82867836  0.94389873  1.0000
  Al  Al7       1.0  0.13620405000000002  0.6713232299999999  0.05610414999999999  1.0000
  Al  Al8       1.0  0.63619598  0.82867836  0.55610127  1.0000
  Al  Al9       1.0  0.8637959500000001  0.32867677  0.9438958499999999  1.0000
  Al  Al10      1.0  0.58428442  0.51038625  0.24999999999999997  1.0000
  Al  Al11      1.0  0.08428724  0.9896149899999999  0.75  1.0000
  Al  Al12      1.0  0.41571558  0.48961374999999996  0.75  1.0000
  Ni  Ni1       1.0  0.44428432  0.87107972  0.24999999999999997  1.0000
  Ni  Ni2       1.0  0.05571624000000001  0.37107796  0.24999999999999997  1.0000
  Ni  Ni3       1.0  0.5557156800000002  0.12892028  0.75  1.0000
  Ni  Ni4       1.0  0.94428376  0.62892204  0.75  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 1.7763568394002505e-15, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-alni",
    mpId: "mp-1487",
    name: "AlNi (mp-1487)",
    formula: "AlNi",
    formulaDescriptive: "AlNi",
    role: "compound",
    elements: ["Al", "Ni"],
    composition: {"Al": 1, "Ni": 1},
    atomCount: 2,
    mpFormationEnergyPerAtom: -0.6588399950000001,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-1487_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:16:24.529000",
    xyzData: `2
Lattice="2.85971129 0.00000000 -0.00000000 -0.00000000 2.85971129 -0.00000000 0.00000000 -0.00000000 2.85971129" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-1487 source=optimade.materialsproject.org
Al 1.42985564 1.42985564 1.42985564
Ni 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       AlNi
_chemical_formula_sum              "Al1 Ni1"
_cell_length_a       2.85971129
_cell_length_b       2.85971129
_cell_length_c       2.85971129
_cell_angle_alpha    90.0
_cell_angle_beta     90.0
_cell_angle_gamma    90.0

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Al  Al1       1.0  0.5  0.5  0.5  1.0000
  Ni  Ni1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-el-al",
    mpId: "mp-134",
    name: "Al reference (mp-134)",
    formula: "Al",
    formulaDescriptive: "Al",
    role: "element-reference",
    element: "Al",
    elements: ["Al"],
    composition: {"Al": 1},
    atomCount: 1,
    mpFormationEnergyPerAtom: 0.0,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-134_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:10:09.479000",
    xyzData: `1
Lattice="2.47332900 0.00000000 1.42797700 0.82444300 2.33187700 1.42797700 0.00000000 0.00000000 2.85595500" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-134 source=optimade.materialsproject.org
Al 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       Al
_chemical_formula_sum              "Al1"
_cell_length_a       2.8559542459167657
_cell_length_b       2.855954291634759
_cell_length_c       2.855955
_cell_angle_alpha    60.0000033779252
_cell_angle_beta     60.00000284838631
_cell_angle_gamma    60.000002428463056

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Al  Al1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 0.0 },
  },
  {
    id: "mp-el-cu",
    mpId: "mp-30",
    name: "Cu reference (mp-30)",
    formula: "Cu",
    formulaDescriptive: "Cu",
    role: "element-reference",
    element: "Cu",
    elements: ["Cu"],
    composition: {"Cu": 1},
    atomCount: 1,
    mpFormationEnergyPerAtom: 0.0,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-30_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:10:32.419000",
    xyzData: `1
Lattice="2.19071987 0.00000000 1.26481248 0.73024029 2.06543106 1.26481248 -0.00000000 -0.00000000 2.52962495" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-30 source=optimade.materialsproject.org
Cu 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       Cu
_chemical_formula_sum              "Cu1"
_cell_length_a       2.5296252999953506
_cell_length_b       2.52962585263429
_cell_length_c       2.52962495
_cell_angle_alpha    60.00001167291316
_cell_angle_beta     60.0000044460954
_cell_angle_gamma    60.00000264091419

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Cu  Cu1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 1.4210854715202004e-14 },
  },
  {
    id: "mp-el-au",
    mpId: "mp-81",
    name: "Au reference (mp-81)",
    formula: "Au",
    formulaDescriptive: "Au",
    role: "element-reference",
    element: "Au",
    elements: ["Au"],
    composition: {"Au": 1},
    atomCount: 1,
    mpFormationEnergyPerAtom: 0.0,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-81_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:10:10.889000",
    xyzData: `1
Lattice="2.55438200 0.00000000 1.47477300 0.85146100 2.40829500 1.47477300 0.00000000 0.00000000 2.94954600" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-81 source=optimade.materialsproject.org
Au 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       Au
_chemical_formula_sum              "Au1"
_cell_length_a       2.9495462029697044
_cell_length_b       2.9495467521426066
_cell_length_c       2.949546
_cell_angle_alpha    60.00000843542354
_cell_angle_beta     60.000002276344645
_cell_angle_gamma    60.00000120154804

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Au  Au1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 1.4210854715202004e-14 },
  },
  {
    id: "mp-el-ni",
    mpId: "mp-23",
    name: "Ni reference (mp-23)",
    formula: "Ni",
    formulaDescriptive: "Ni",
    role: "element-reference",
    element: "Ni",
    elements: ["Ni"],
    composition: {"Ni": 1},
    atomCount: 1,
    mpFormationEnergyPerAtom: 0.0,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-23_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:11:00.588000",
    xyzData: `1
Lattice="2.12808334 -0.00000000 1.22864943 0.70936078 2.00637688 1.22864943 -0.00000000 -0.00000000 2.45729885" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-23 source=optimade.materialsproject.org
Ni 0.00000000 0.00000000 0.00000000`,
    cifData: `data_image0
_chemical_formula_structural       Ni
_chemical_formula_sum              "Ni1"
_cell_length_a       2.457298948810437
_cell_length_b       2.457299396215298
_cell_length_c       2.45729885
_cell_angle_alpha    60.00000721843609
_cell_angle_beta     60.00000119555076
_cell_angle_gamma    60.00001459210662

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Ni  Ni1       1.0  0.0  0.0  0.0  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 0.0, maxCellparDeviation: 7.105427357601002e-15 },
  },
  {
    id: "mp-el-ti",
    mpId: "mp-72",
    name: "Ti reference (mp-72)",
    formula: "Ti",
    formulaDescriptive: "Ti",
    role: "element-reference",
    element: "Ti",
    elements: ["Ti"],
    composition: {"Ti": 3},
    atomCount: 3,
    mpFormationEnergyPerAtom: 0.0,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-72_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:11:44.630000",
    xyzData: `3
Lattice="4.56737542 0.00000001 0.00000000 -2.28368669 3.95546237 0.00000000 -0.00000000 0.00000000 2.82624427" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-72 source=optimade.materialsproject.org
Ti 0.00000000 0.00000000 0.00000000
Ti -0.00000160 2.63697624 1.41312214
Ti 2.28369033 1.31848614 1.41312214`,
    cifData: `data_image0
_chemical_formula_structural       Ti3
_chemical_formula_sum              "Ti3"
_cell_length_a       4.56737542
_cell_length_b       4.56737424113343
_cell_length_c       2.82624427
_cell_angle_alpha    90.0
_cell_angle_beta     90.0
_cell_angle_gamma    119.99999363769646

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Ti  Ti1       1.0  0.0  0.0  0.0  1.0000
  Ti  Ti2       1.0  0.33333299999999993  0.666667  0.5  1.0000
  Ti  Ti3       1.0  0.6666669999999999  0.33333299999999993  0.5  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 1.7763568394002505e-15, maxCellparDeviation: 1.4210854715202004e-14 },
  },
  {
    id: "mp-el-fe",
    mpId: "mp-13",
    name: "Fe reference (mp-13)",
    formula: "Fe",
    formulaDescriptive: "Fe",
    role: "element-reference",
    element: "Fe",
    elements: ["Fe"],
    composition: {"Fe": 2},
    atomCount: 2,
    mpFormationEnergyPerAtom: 0.0,
    mpEnergyAboveHull: 0.0,
    mpThermoId: "mp-13_GGA_GGA+U",
    mpThermoLastUpdated: "2023-04-27T01:10:34.101000",
    xyzData: `2
Lattice="2.33614509 0.00011167 -0.82582293 -1.16807798 2.02304724 -0.82608220 1.17007387 2.02730500 3.31032796" Properties=species:S:1:pos:R:3 pbc="T T T" mp_id=mp-13 source=optimade.materialsproject.org
Fe 1.16907043 2.02523210 0.82921130
Fe 1.16806717 2.02315877 -1.65190501`,
    cifData: `data_image0
_chemical_formula_structural       Fe2
_chemical_formula_sum              "Fe2"
_cell_length_a       2.477813028804854
_cell_length_b       2.477809133849768
_cell_length_c       4.054295207189474
_cell_angle_alpha    90.00003845025343
_cell_angle_beta     90.00031950636807
_cell_angle_gamma    109.46983668329798

_space_group_name_H-M_alt    "P 1"
_space_group_IT_number       1

loop_
  _space_group_symop_operation_xyz
  'x, y, z'

loop_
  _atom_site_type_symbol
  _atom_site_label
  _atom_site_symmetry_multiplicity
  _atom_site_fract_x
  _atom_site_fract_y
  _atom_site_fract_z
  _atom_site_occupancy
  Fe  Fe1       1.0  0.50000002  0.5000000799999998  0.49999999  1.0000
  Fe  Fe2       1.0  0.9999999799999999  0.99999992  9.999999914433127e-09  1.0000`,
    cifRoundTrip: { maxDistanceDeviationA: 8.881784197001252e-16, maxCellparDeviation: 1.4210854715202004e-14 },
  },
];

/** Compounds scored against MP. */
export const MP_COMPOUNDS = MP_REFERENCE_ENTRIES.filter((e) => e.role === "compound");

/** Elemental reference phases, keyed by element symbol. */
export const MP_ELEMENT_REFERENCES = new Map(
  MP_REFERENCE_ENTRIES.filter((e) => e.role === "element-reference").map((e) => [
    e.element as string,
    e,
  ]),
);
