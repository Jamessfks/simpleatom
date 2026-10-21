/**
 * Client-side structure file parser.
 *
 * Parses .xyz and basic .cif/.poscar/.pdb files to extract atom symbols and
 * positions WITHOUT a backend. Used by the "Preview Structure" feature so
 * users can inspect their upload before running a MACE calculation.
 *
 * Supported formats:
 *   - XYZ / Extended XYZ (full support)
 *   - CIF  (extracts _atom_site positions — basic support)
 *   - PDB  (extracts ATOM/HETATM records)
 *   - POSCAR/CONTCAR (extracts atom types + direct/cartesian coords)
 *
 * ARCHITECTURE NOTE:
 *   This runs entirely in the browser (no server call). It reads the uploaded
 *   File object via FileReader, parses the text, and returns a ParsedStructure.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of parsing a structure file on the client side. */
export interface ParsedStructure {
  /** Atom count */
  atomCount: number;
  /** Element symbols, one per atom (e.g. ["O", "H", "H"]) */
  symbols: string[];
  /** Cartesian positions [x, y, z] per atom (Angstroms) */
  positions: number[][];
  /** Set of unique elements (e.g. ["O", "H"]) */
  elements: string[];
  /** Per-element atom counts, e.g. { C: 9, H: 8, O: 4 } */
  elementCounts: Record<string, number>;
  /** Empirical formula string derived from atom data, e.g. "C₉H₈O₄" */
  empiricalFormula: string;
  /** Bounding box: { min: [x,y,z], max: [x,y,z], size: [dx,dy,dz] } */
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  /** Shortest distance (Å) between any two atoms; Infinity if <2 atoms */
  minNeighborDist: number;
  /** Whether all atoms lie in a single plane (z-range < 0.01 Å) */
  isPlanar: boolean;
  /**
   * Unit-cell vectors as a 3x3 row-major matrix (Å), when the source format
   * declares one: extended-XYZ `Lattice="..."`, CIF `_cell_length_*`, or the
   * POSCAR header. Undefined for isolated molecules.
   */
  lattice?: number[][];
  /**
   * Whether this structure can be treated as periodic. True only when a cell
   * is present AND encloses a positive volume — CLAUDE.md's validation rules
   * require positive cell volume, and a degenerate cell is not periodic.
   * Gates NPT, which cannot run without a cell.
   */
  isPeriodic: boolean;
  /** Number of frames detected (for multi-frame XYZ); we parse only frame 1 */
  frameCount: number;
  /** Original filename */
  filename: string;
  /** Reference energy extracted from extxyz comment line (eV). */
  referenceEnergy?: number;
  /** Reference forces extracted from extxyz per-atom properties (eV/A). */
  referenceForces?: number[][];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a File object and parse it into a ParsedStructure.
 * Only the first frame is parsed for multi-frame files.
 */
export async function parseStructureFile(file: File): Promise<ParsedStructure> {
  return parseStructureText(await file.text(), file.name);
}

/**
 * Parse structure text, choosing the format from the filename's extension.
 * Pure — no File, no DOM — so it can be tested directly against fixtures
 * (test/parse-structure.test.ts checks public/demo/silicon.cif).
 */
export function parseStructureText(text: string, filename: string): ParsedStructure {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  let symbols: string[];
  let positions: number[][];
  let frameCount = 1;

  let referenceEnergy: number | undefined;
  let referenceForces: number[][] | undefined;
  let lattice: number[][] | undefined;

  if (ext === "xyz" || ext === "extxyz") {
    const xyzResult = parseXYZ(text);
    symbols = xyzResult.symbols;
    positions = xyzResult.positions;
    frameCount = xyzResult.frameCount;
    referenceEnergy = xyzResult.referenceEnergy;
    referenceForces = xyzResult.referenceForces;
    lattice = xyzResult.lattice;
  } else if (ext === "cif") {
    ({ symbols, positions, lattice } = parseCIF(text));
  } else if (ext === "pdb") {
    ({ symbols, positions } = parsePDB(text));
  } else if (["poscar", "vasp", "contcar"].includes(ext)) {
    ({ symbols, positions, lattice } = parsePOSCAR(text));
  } else {
    // Fallback: try XYZ
    ({ symbols, positions, frameCount, lattice } = parseXYZ(text));
  }

  const elements = [...new Set(symbols)].sort();
  const elementCounts = countElements(symbols);
  const empiricalFormula = buildFormula(elementCounts);
  const boundingBox = computeBoundingBox(positions);
  const minNeighborDist = computeMinDistance(positions);
  const isPlanar = checkPlanarity(positions);

  return {
    atomCount: symbols.length,
    symbols,
    positions,
    elements,
    elementCounts,
    empiricalFormula,
    boundingBox,
    minNeighborDist,
    isPlanar,
    lattice,
    isPeriodic: hasPositiveVolume(lattice),
    frameCount,
    filename,
    referenceEnergy,
    referenceForces,
  };
}

/**
 * A cell only makes a structure periodic if it encloses real space. Guards
 * against the degenerate cases seen in the wild: a missing cell, an all-zero
 * `Lattice="0 0 0 ..."` header, or coplanar vectors. Uses |det| so a
 * left-handed cell still counts as periodic rather than being rejected for
 * vector ordering.
 */
function hasPositiveVolume(lattice?: number[][]): boolean {
  if (!lattice || lattice.length !== 3) return false;
  if (lattice.some((row) => row.length !== 3 || row.some((v) => !isFinite(v)))) {
    return false;
  }
  const [a, b, c] = lattice;
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  // 1e-6 Å³ is far below any physical cell and well above float noise.
  return Math.abs(det) > 1e-6;
}

// ---------------------------------------------------------------------------
// Format parsers
// ---------------------------------------------------------------------------

/**
 * Parse standard or extended XYZ format.
 * First line = atom count, second line = comment, then atom lines.
 */
function parseXYZ(text: string): {
  symbols: string[];
  positions: number[][];
  frameCount: number;
  referenceEnergy?: number;
  referenceForces?: number[][];
  lattice?: number[][];
} {
  const lines = text.split("\n").map((l) => l.trim());
  const symbols: string[] = [];
  const positions: number[][] = [];

  const atomCount = parseInt(lines[0], 10);
  if (isNaN(atomCount) || atomCount <= 0) {
    throw new Error("Invalid XYZ file: first line must be the atom count.");
  }

  // Extract reference energy from comment line (line 1).
  // Supports: energy=X, REF_energy=X, Energy=X
  let referenceEnergy: number | undefined;
  const commentLine = lines[1] ?? "";
  const energyMatch = commentLine.match(
    /(?:REF_energy|energy)\s*=\s*([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)/i
  );
  if (energyMatch) {
    const val = parseFloat(energyMatch[1]);
    if (!isNaN(val)) referenceEnergy = val;
  }

  // Extended XYZ declares the cell on the comment line as
  // Lattice="ax ay az bx by bz cx cy cz" (row-major, Å).
  let lattice: number[][] | undefined;
  const latticeMatch = commentLine.match(/Lattice\s*=\s*"([^"]*)"/i);
  if (latticeMatch) {
    const v = latticeMatch[1]
      .trim()
      .split(/\s+/)
      .map(parseFloat)
      .filter((n) => !isNaN(n));
    if (v.length === 9) {
      lattice = [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
    }
  }

  // Detect if the comment line defines per-atom property columns
  // (extended XYZ format: Properties=species:S:1:pos:R:3:forces:R:3 ...)
  let forceColStart = -1;
  const propsMatch = commentLine.match(/Properties\s*=\s*(\S+)/i);
  if (propsMatch) {
    const propDef = propsMatch[1];
    const fields = propDef.split(":");
    let colIdx = 0;
    for (let f = 0; f < fields.length; f += 3) {
      const name = fields[f]?.toLowerCase();
      const count = parseInt(fields[f + 2], 10) || 1;
      if (name === "forces" || name === "ref_forces") {
        forceColStart = colIdx;
      }
      colIdx += count;
    }
  }

  const referenceForces: number[][] = [];

  for (let i = 2; i < 2 + atomCount && i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length < 4) continue;

    const sym = parts[0];
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    const z = parseFloat(parts[3]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;

    symbols.push(sym);
    positions.push([x, y, z]);

    // Extract reference forces if column position is known
    if (forceColStart >= 0 && parts.length > forceColStart + 2) {
      const fx = parseFloat(parts[forceColStart]);
      const fy = parseFloat(parts[forceColStart + 1]);
      const fz = parseFloat(parts[forceColStart + 2]);
      if (!isNaN(fx) && !isNaN(fy) && !isNaN(fz)) {
        referenceForces.push([fx, fy, fz]);
      }
    }
  }

  const linesPerFrame = atomCount + 2;
  const nonEmptyLines = lines.filter((l) => l.length > 0).length;
  const frameCount = Math.max(1, Math.floor(nonEmptyLines / linesPerFrame));

  return {
    symbols,
    positions,
    frameCount,
    referenceEnergy,
    referenceForces: referenceForces.length > 0 ? referenceForces : undefined,
    lattice,
  };
}

/**
 * Parse basic CIF: extract _atom_site_type_symbol and fract/Cartn coords.
 * This handles common CIF output from materials databases.
 */
function parseCIF(text: string): {
  symbols: string[];
  positions: number[][];
  lattice?: number[][];
} {
  const symbols: string[] = [];
  const positions: number[][] = [];
  const lines = text.split("\n");

  // Cell parameters. CIF values may carry an uncertainty suffix, e.g.
  // "5.4309(5)" — strip it before parsing.
  const cell: Record<string, number> = {};
  const cellRe =
    /^_cell_(length_a|length_b|length_c|angle_alpha|angle_beta|angle_gamma)\s+([-\d.eE+]+)/i;
  for (const line of lines) {
    const m = line.trim().replace(/\(\d+\)/g, "").match(cellRe);
    if (m) {
      const v = parseFloat(m[2]);
      if (!isNaN(v)) cell[m[1].toLowerCase()] = v;
    }
  }
  const lattice = buildLatticeFromCell(cell);

  // Find _atom_site loop
  let inLoop = false;
  let headers: string[] = [];
  let symIdx = -1;
  let xIdx = -1;
  let yIdx = -1;
  let zIdx = -1;
  // CIF may give either fractional or Cartesian coordinates. Fractional must
  // be multiplied through the cell or every distance is meaningless.
  let coordsAreFractional = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "loop_") {
      inLoop = true;
      headers = [];
      continue;
    }

    if (inLoop && trimmed.startsWith("_atom_site")) {
      headers.push(trimmed);
      // Track column indices
      const h = trimmed.toLowerCase();
      const idx = headers.length - 1;
      if (h === "_atom_site_type_symbol" || h === "_atom_site_label") {
        if (symIdx === -1) symIdx = idx;
      }
      if (h.includes("fract_x") || h.includes("cartn_x")) {
        xIdx = idx;
        coordsAreFractional = h.includes("fract_x");
      }
      if (h.includes("fract_y") || h.includes("cartn_y")) yIdx = idx;
      if (h.includes("fract_z") || h.includes("cartn_z")) zIdx = idx;
      continue;
    }

    // Data row inside the atom_site loop
    if (inLoop && headers.length > 0 && !trimmed.startsWith("_") && trimmed.length > 0 && !trimmed.startsWith("#")) {
      if (trimmed.startsWith("loop_") || trimmed.startsWith("data_")) {
        inLoop = false;
        continue;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length < headers.length) continue;

      if (symIdx >= 0 && xIdx >= 0 && yIdx >= 0 && zIdx >= 0) {
        // Strip digits from symbol (e.g. "O1" -> "O")
        const sym = parts[symIdx].replace(/[0-9]+$/, "");
        const x = parseFloat(parts[xIdx]);
        const y = parseFloat(parts[yIdx]);
        const z = parseFloat(parts[zIdx]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          symbols.push(sym);
          if (coordsAreFractional && lattice) {
            // r_cart = f_a * a + f_b * b + f_c * c
            positions.push([
              x * lattice[0][0] + y * lattice[1][0] + z * lattice[2][0],
              x * lattice[0][1] + y * lattice[1][1] + z * lattice[2][1],
              x * lattice[0][2] + y * lattice[1][2] + z * lattice[2][2],
            ]);
          } else {
            positions.push([x, y, z]);
          }
        }
      }
    }
  }

  if (coordsAreFractional && !lattice) {
    throw new Error(
      "CIF declares fractional coordinates but no readable unit cell " +
        "(_cell_length_a/b/c, _cell_angle_alpha/beta/gamma). Without the cell " +
        "the coordinates cannot be converted to Ångströms."
    );
  }

  return { symbols, positions, lattice };
}

/**
 * Build 3x3 cell vectors (Å) from CIF lengths and angles, using the standard
 * crystallographic setting: a along x, b in the xy-plane, c completing it.
 * Returns undefined unless all six parameters are present and physical.
 */
function buildLatticeFromCell(
  cell: Record<string, number>
): number[][] | undefined {
  const a = cell["length_a"];
  const b = cell["length_b"];
  const c = cell["length_c"];
  const alpha = cell["angle_alpha"];
  const beta = cell["angle_beta"];
  const gamma = cell["angle_gamma"];
  if ([a, b, c, alpha, beta, gamma].some((v) => v === undefined || isNaN(v))) {
    return undefined;
  }
  if (a <= 0 || b <= 0 || c <= 0) return undefined;

  const rad = (d: number) => (d * Math.PI) / 180;
  const ca = Math.cos(rad(alpha));
  const cb = Math.cos(rad(beta));
  const cg = Math.cos(rad(gamma));
  const sg = Math.sin(rad(gamma));
  if (Math.abs(sg) < 1e-9) return undefined; // degenerate gamma

  const cx = c * cb;
  const cy = (c * (ca - cb * cg)) / sg;
  const czSq = c * c - cx * cx - cy * cy;
  if (czSq <= 0) return undefined; // angles do not close a real cell

  return [
    [a, 0, 0],
    [b * cg, b * sg, 0],
    [cx, cy, Math.sqrt(czSq)],
  ];
}

/**
 * Parse PDB format: extract ATOM / HETATM records.
 */
function parsePDB(text: string): { symbols: string[]; positions: number[][] } {
  const symbols: string[] = [];
  const positions: number[][] = [];

  for (const line of text.split("\n")) {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;

    // PDB fixed-width columns: x=30-38, y=38-46, z=46-54, element=76-78
    const x = parseFloat(line.substring(30, 38));
    const y = parseFloat(line.substring(38, 46));
    const z = parseFloat(line.substring(46, 54));

    // Element symbol: columns 76-78, or fallback to atom name cols 12-16
    let sym = line.substring(76, 78).trim();
    if (!sym) {
      sym = line.substring(12, 16).trim().replace(/[0-9]/g, "");
    }

    if (sym && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
      symbols.push(sym);
      positions.push([x, y, z]);
    }
  }

  return { symbols, positions };
}

/**
 * Parse POSCAR / CONTCAR (VASP format).
 * Line layout: comment, scale, 3x lattice, elements, counts, coord type, positions.
 */
function parsePOSCAR(text: string): {
  symbols: string[];
  positions: number[][];
  lattice?: number[][];
} {
  const lines = text.split("\n").map((l) => l.trim());
  const symbols: string[] = [];
  const positions: number[][] = [];

  if (lines.length < 8) return { symbols, positions };

  const scale = parseFloat(lines[1]) || 1.0;

  // Lattice vectors (lines 2-4)
  const lattice: number[][] = [];
  for (let i = 2; i < 5; i++) {
    const parts = lines[i].split(/\s+/).map(Number);
    lattice.push(parts.map((v) => v * scale));
  }

  // Element names (line 5) and counts (line 6)
  const elementNames = lines[5].split(/\s+/);
  const counts = lines[6].split(/\s+/).map(Number);

  // Build symbol list from element names and counts
  elementNames.forEach((el, i) => {
    const count = counts[i] || 0;
    for (let j = 0; j < count; j++) symbols.push(el);
  });

  // Coordinate type: line 7 (may be "Selective dynamics", then line 8)
  let coordLineIdx = 7;
  if (lines[7].toLowerCase().startsWith("s")) {
    coordLineIdx = 8; // Skip "Selective dynamics"
  }
  const isDirect = lines[coordLineIdx].toLowerCase().startsWith("d");

  // Parse positions
  const totalAtoms = counts.reduce((s, c) => s + c, 0);
  for (let i = 0; i < totalAtoms; i++) {
    const lineIdx = coordLineIdx + 1 + i;
    if (lineIdx >= lines.length) break;
    const parts = lines[lineIdx].split(/\s+/).map(Number);
    if (parts.length < 3) continue;

    let [x, y, z] = parts;

    // Convert fractional to Cartesian
    if (isDirect) {
      const cx =
        x * lattice[0][0] + y * lattice[1][0] + z * lattice[2][0];
      const cy =
        x * lattice[0][1] + y * lattice[1][1] + z * lattice[2][1];
      const cz =
        x * lattice[0][2] + y * lattice[1][2] + z * lattice[2][2];
      x = cx;
      y = cy;
      z = cz;
    }

    positions.push([x, y, z]);
  }

  return { symbols, positions, lattice };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count atoms per element, e.g. { C: 9, H: 8, O: 4 }. */
function countElements(symbols: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sym of symbols) {
    counts[sym] = (counts[sym] || 0) + 1;
  }
  return counts;
}

/** Unicode subscript digits for formula rendering. */
const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
};

/**
 * Build empirical formula from element counts using Hill system order:
 * C first, H second, then all others alphabetically. Counts of 1 are omitted.
 * Example: { C: 9, H: 8, O: 4 } → "C₉H₈O₄"
 */
function buildFormula(counts: Record<string, number>): string {
  // Hill system: C first, H second, then alphabetical
  const keys = Object.keys(counts).sort((a, b) => {
    if (a === "C") return -1;
    if (b === "C") return 1;
    if (a === "H") return -1;
    if (b === "H") return 1;
    return a.localeCompare(b);
  });

  return keys
    .map((el) => {
      const n = counts[el];
      if (n === 1) return el;
      // Convert count digits to unicode subscripts
      const sub = String(n)
        .split("")
        .map((d) => SUBSCRIPTS[d] || d)
        .join("");
      return `${el}${sub}`;
    })
    .join("");
}

/**
 * Find the shortest distance (Å) between any two atoms.
 * Returns Infinity if fewer than 2 atoms. Uses O(n²) — fine for <10k atoms.
 */
function computeMinDistance(positions: number[][]): number {
  if (positions.length < 2) return Infinity;

  let minDist = Infinity;
  // Cap at first 2000 atoms to keep UI responsive
  const n = Math.min(positions.length, 2000);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[i][0] - positions[j][0];
      const dy = positions[i][1] - positions[j][1];
      const dz = positions[i][2] - positions[j][2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < minDist) minDist = d2;
    }
  }
  return Math.sqrt(minDist);
}

/**
 * Check if the structure is essentially flat (all atoms in the same plane).
 * Returns true if the z-range is < 0.01 Å AND the structure has >3 atoms
 * (a water molecule being planar is fine; a 21-atom "aspirin" being flat is not).
 */
function checkPlanarity(positions: number[][]): boolean {
  if (positions.length <= 3) return false;

  // Check z-range (most common case: all z=0)
  let minZ = Infinity, maxZ = -Infinity;
  for (const [, , z] of positions) {
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (maxZ - minZ < 0.01) return true;

  // Also check x-range and y-range (flat in other planes)
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const [x, y] of positions) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX - minX < 0.01) return true;
  if (maxY - minY < 0.01) return true;

  return false;
}

/** Compute axis-aligned bounding box from positions. */
function computeBoundingBox(positions: number[][]): ParsedStructure["boundingBox"] {
  if (positions.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
    };
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const [x, y, z] of positions) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }

  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}
