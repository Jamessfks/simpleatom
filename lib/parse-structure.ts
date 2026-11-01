/**
 * Client-side structure file parser.
 *
 * Parses .xyz and basic .cif/.poscar/.pdb files to extract atom symbols and
 * positions WITHOUT a backend. Used by the "Preview Structure" feature so
 * users can inspect their upload before running a MACE calculation.
 *
 * Supported formats:
 *   - XYZ / Extended XYZ (full support)
 *   - CIF  (extracts _atom_site positions and expands the listed symmetry
 *           operations, so a database CIF's asymmetric unit becomes the full cell)
 *   - PDB  (extracts ATOM/HETATM records)
 *   - POSCAR/CONTCAR (extracts atom types + direct/cartesian coords)
 *
 * THE RULE THIS FILE FOLLOWS: the preview must show the structure the server
 * will compute, and the server computes whatever ASE reads
 * (mace-api/calculate.py `_read_structure`: `read(path, format, index=0)`).
 * So each reader below copies ASE's rules, including its case-sensitive
 * extended-XYZ keys, its POSCAR scale factors and its CIF element regex.
 * test/parser-agreement.test.ts holds every reader to ASE's own reading of
 * every shipped structure and every adversarial fixture
 * (test/fixtures/parser-reference.json, written by
 * test_scripts/gen_parser_reference.py). Where ASE is itself wrong — upper-case
 * CIF element symbols, origin-choice-2 coordinates, partial occupancy, the
 * wwPDB `CRYST1 1 1 1` placeholder — the preview refuses or flags the file
 * instead of drawing a structure the run would not honour.
 *
 * ARCHITECTURE NOTE:
 *   This runs entirely in the browser (no server call). It reads the uploaded
 *   File object via FileReader, parses the text, and returns a ParsedStructure.
 *   A file the server would refuse throws an Error whose message says why.
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
  /**
   * Shortest distance (Å) between any two atoms, across the cell boundary on
   * every periodic axis (minimum image); Infinity if there is no other atom
   * and no periodic image to measure to.
   */
  minNeighborDist: number;
  /** Whether all atoms lie in a single plane (z-range < 0.01 Å) */
  isPlanar: boolean;
  /**
   * Unit-cell vectors as a 3x3 row-major matrix (Å), when the source format
   * declares one: extended-XYZ `Lattice="..."`, CIF `_cell_length_*`, the
   * POSCAR header, or a real PDB `CRYST1`. Undefined for isolated molecules.
   */
  lattice?: number[][];
  /**
   * The axes along which the structure is periodic, as ASE reads them (the
   * extended-XYZ `pbc="T T F"` key; all true for CIF, POSCAR and a PDB with a
   * cell). A slab is [true, true, false]: it has a lattice and is not fully
   * periodic.
   */
  pbc: [boolean, boolean, boolean];
  /**
   * Whether this structure is fully periodic: every axis periodic AND a cell
   * that encloses a positive volume. This is the rule the server applies to
   * stress and NPT (calculate.py), so it gates NPT here too. A molecule in a
   * `pbc="F F F"` box, a slab and an all-zero `Lattice` are not periodic.
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
  /**
   * Things the reader had to decide that the user should know, in plain
   * sentences: a file read as plain XYZ after the extended-XYZ comment line
   * failed, an ignored lower-case key, a CIF whose symmetry the preview
   * cannot expand, a placeholder cell treated as no cell. Empty when the file
   * says exactly what it means.
   */
  notes: string[];
}

/** What a format reader returns; everything else in ParsedStructure is derived. */
interface RawStructure {
  symbols: string[];
  positions: number[][];
  lattice?: number[][];
  pbc: [boolean, boolean, boolean];
  frameCount: number;
  notes: string[];
  referenceEnergy?: number;
  referenceForces?: number[][];
}

const NOT_PERIODIC: [boolean, boolean, boolean] = [false, false, false];
const ALL_PERIODIC: [boolean, boolean, boolean] = [true, true, true];

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
 * (test/parse-structure.test.ts, test/parser-agreement.test.ts).
 */
export function parseStructureText(text: string, filename: string): ParsedStructure {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  let raw: RawStructure;
  if (ext === "xyz" || ext === "extxyz") {
    raw = parseExtendedXYZ(text);
  } else if (ext === "cif") {
    raw = parseCIF(text);
  } else if (ext === "pdb") {
    raw = parsePDB(text);
  } else if (["poscar", "vasp", "contcar"].includes(ext)) {
    raw = parsePOSCAR(text);
  } else {
    // Any other name: the server reads it with ASE's plain xyz reader.
    raw = parsePlainXYZ(text, []);
  }

  const { symbols, positions, lattice, pbc } = raw;
  const elements = [...new Set(symbols)].sort();
  const elementCounts = countElements(symbols);
  const empiricalFormula = buildFormula(elementCounts);
  const boundingBox = computeBoundingBox(positions);
  const minNeighborDist = computeMinDistance(positions, lattice, pbc);
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
    pbc,
    isPeriodic: pbc.every(Boolean) && hasPositiveVolume(lattice),
    frameCount: raw.frameCount,
    filename,
    referenceEnergy: raw.referenceEnergy,
    referenceForces: raw.referenceForces,
    notes: raw.notes,
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
  // 1e-6 Å³ is far below any physical cell and well above float noise.
  return Math.abs(det3(lattice)) > 1e-6;
}

function det3(m: number[][]): number {
  const [a, b, c] = m;
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** The chemical symbols ASE accepts (Z = 1 … 118), index = Z - 1. */
const CHEMICAL_SYMBOLS = (
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
  "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu " +
  "Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr " +
  "Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
).split(" ");
const SYMBOL_SET: ReadonlySet<string> = new Set(CHEMICAL_SYMBOLS);

/** Python's str.capitalize(): "FE" and "fe" are both "Fe". extended XYZ does this to every species. */
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function requireElement(symbol: string, where: string): string {
  if (!SYMBOL_SET.has(symbol)) {
    throw new Error(`"${symbol}" ${where} is not a chemical element symbol.`);
  }
  return symbol;
}

/**
 * ASE's `label_to_symbol` (ase/io/espresso.py), which its PDB reader applies
 * to the element column and then to the atom name: first letter upper-case,
 * second lower-case if that is an element, else the first letter alone.
 * Returns null when neither is an element.
 */
function labelToSymbol(label: string): string | null {
  if (label.length >= 2) {
    const two = label[0].toUpperCase() + label[1].toLowerCase();
    if (SYMBOL_SET.has(two)) return two;
  }
  if (label.length >= 1) {
    const one = label[0].toUpperCase();
    if (SYMBOL_SET.has(one)) return one;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A decimal float as Python's float() reads it (no hex, no Fortran D exponent, no blank). */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Number from text, or null when it is not a plain finite decimal. */
function decimal(text: string): number | null {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function requireDecimal(text: string, what: string): number {
  const v = decimal(text);
  if (v === null) throw new Error(`${what}: "${text}" is not a number.`);
  return v;
}

// ---------------------------------------------------------------------------
// XYZ and extended XYZ
// ---------------------------------------------------------------------------

/** The extended-XYZ comment line could not be read the way ASE's extxyz reader reads it. */
class ExtxyzError extends Error {}

/** Number of frames: count headers, hopping `natoms + 2` lines at a time. */
function countXyzFrames(lines: string[]): number {
  let frames = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    const n = /^\d+$/.test(lines[i].trim()) ? parseInt(lines[i].trim(), 10) : NaN;
    if (!Number.isFinite(n)) break;
    frames++;
    i += n + 2;
  }
  return Math.max(1, frames);
}

function splitLines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
}

function atomCountLine(lines: string[]): number {
  const n = /^\s*(\d+)\s*$/.test(lines[0] ?? "") ? parseInt(lines[0], 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Invalid XYZ file: first line must be the atom count.");
  }
  return n;
}

/**
 * ASE's plain xyz reader: line 1 the count, line 2 a comment that is thrown
 * away, then `symbol x y z`. This is also what the server falls back to when
 * the extended-XYZ reader rejects a file, so a `Lattice`, a `pbc` and any
 * reference data on the comment line are lost — `notes` says so.
 */
function parsePlainXYZ(text: string, notes: string[]): RawStructure {
  const lines = splitLines(text);
  const n = atomCountLine(lines);
  if (lines.length < n + 2) {
    throw new Error(`XYZ frame has ${Math.max(0, lines.length - 2)} atom lines but the header says ${n}.`);
  }
  const symbols: string[] = [];
  const positions: number[][] = [];
  for (let i = 0; i < n; i++) {
    const parts = lines[2 + i].trim().split(/\s+/);
    if (parts.length < 4) {
      throw new Error(`XYZ atom line ${i + 1} needs a symbol and three coordinates: "${lines[2 + i].trim()}".`);
    }
    symbols.push(requireElement(capitalize(parts[0]), `on atom line ${i + 1}`));
    positions.push(
      [1, 2, 3].map((k) => requireDecimal(parts[k], `XYZ atom line ${i + 1}`)),
    );
  }
  return { symbols, positions, pbc: NOT_PERIODIC, frameCount: countXyzFrames(lines), notes };
}

/**
 * ASE's `key_val_str_to_dict` (ase/io/extxyz.py): split the comment line into
 * `key=value` pairs. A value may be quoted ("…", '…') or bracketed ({…}, […]);
 * a bare key means True. Keys are case-sensitive. Values stay strings here.
 */
function commentLineKeys(comment: string): Map<string, string> {
  const closers: Record<string, string> = { "'": "'", '"': '"', "{": "}", "[": "]" };
  const pairs: string[][][] = [[[]]]; // pair -> [key chars, value chars…] -> chars
  let closer: string | null = null;
  let escaped = false;
  const last = () => pairs[pairs.length - 1];
  for (const ch of comment.trim()) {
    if (escaped) {
      last()[last().length - 1].push(ch);
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (closer) {
      if (ch === closer) closer = null;
      else last()[last().length - 1].push(ch);
    } else if (ch in closers) {
      closer = closers[ch];
    } else if (/\s/.test(ch)) {
      if (last()[last().length - 1].length === 0) continue;
      pairs.push([[]]);
    } else if (ch === "=") {
      if (last().length === 1 && last()[0].length === 0 && pairs.length > 1) pairs.pop();
      last().push([]);
    } else {
      last()[last().length - 1].push(ch);
    }
  }
  const out = new Map<string, string>();
  for (const pair of pairs) {
    if (pair.length === 0 || (pair.length === 1 && pair[0].length === 0)) continue;
    const key = pair[0].join("");
    const value = pair.length === 1 ? "T" : pair.slice(1).map((c) => c.join("")).join("=");
    out.set(key, value);
  }
  return out;
}

const PYTHON_BOOLEANS: Record<string, boolean> = {
  T: true, F: false, true: true, false: false, True: true, False: false, TRUE: true, FALSE: false,
};

/**
 * The `pbc` key as ASE reads it: "T T F", "F", "True False True". A value it
 * cannot read as booleans is kept as a string, and a non-empty string is
 * truthy in numpy, so every axis comes out periodic.
 */
function parsePbc(value: string): [boolean, boolean, boolean] {
  const tokens = value.match(/[^\s,]+/g) ?? [];
  const flags: boolean[] = [];
  for (const tok of tokens) {
    if (tok in PYTHON_BOOLEANS) flags.push(PYTHON_BOOLEANS[tok]);
    else if (decimal(tok) !== null) flags.push(decimal(tok) !== 0);
    else return [true, true, true];
  }
  if (flags.length === 1) return [flags[0], flags[0], flags[0]];
  if (flags.length === 3) return [flags[0], flags[1], flags[2]];
  throw new ExtxyzError(`pbc="${value}" must give one or three values.`);
}

/** ASE's `parse_properties`: "species:S:1:pos:R:3:forces:R:3" -> columns. */
function parseProperties(spec: string): { name: string; type: string; count: number; start: number }[] {
  const fields = spec.split(":");
  if (fields.length % 3 !== 0) throw new ExtxyzError(`Properties="${spec}" is not name:type:count triples.`);
  const out: { name: string; type: string; count: number; start: number }[] = [];
  let start = 0;
  for (let f = 0; f < fields.length; f += 3) {
    const count = parseInt(fields[f + 2], 10);
    if (!/^[RISL]$/.test(fields[f + 1]) || !Number.isInteger(count) || count < 1) {
      throw new ExtxyzError(`Properties="${spec}" has a malformed entry "${fields.slice(f, f + 3).join(":")}".`);
    }
    out.push({ name: fields[f], type: fields[f + 1], count, start });
    start += count;
  }
  return out;
}

/** The extended-XYZ reference-data keys, in the order the backend reads them (extract_reference_data). */
const REFERENCE_ENERGY_KEYS = ["REF_energy", "ref_energy", "energy", "dft_energy"];
const REFERENCE_FORCE_KEYS = ["REF_forces", "ref_forces", "forces", "dft_forces"];

/** First frame of extended XYZ, the way ASE's extxyz reader reads it; throws ExtxyzError where ASE would raise. */
function readExtendedFrame(lines: string[]): RawStructure {
  const n = atomCountLine(lines);
  const comment = (lines[1] ?? "").trim();
  const notes: string[] = [];
  const keys = comment ? commentLineKeys(comment) : new Map<string, string>();

  // Keys are case-sensitive in ASE: `lattice=` and `properties=` are ordinary
  // info keys it ignores. Say so, because the file plainly means the cell.
  for (const [wrong, right] of [["lattice", "Lattice"], ["properties", "Properties"]]) {
    for (const key of keys.keys()) {
      if (key !== right && key.toLowerCase() === wrong) {
        notes.push(
          `The comment line says ${key}=, but extended XYZ keys are case-sensitive: ${right}= is the one that is read, so ${key}= is ignored.`,
        );
      }
    }
  }

  let lattice: number[][] | undefined;
  if (keys.has("Lattice")) {
    const tokens = keys.get("Lattice")!.match(/[^\s,]+/g) ?? [];
    const values = tokens.map(decimal);
    if (values.length !== 9 || values.some((v) => v === null)) {
      throw new ExtxyzError(`Lattice="${keys.get("Lattice")}" is not nine numbers.`);
    }
    const v = values as number[];
    lattice = [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
  }

  let pbc: [boolean, boolean, boolean];
  if (keys.has("pbc")) pbc = parsePbc(keys.get("pbc")!);
  else pbc = lattice ? [...ALL_PERIODIC] : [...NOT_PERIODIC];

  const columns = parseProperties(keys.get("Properties") ?? "species:S:1:pos:R:3");
  const speciesCol = columns.find((c) => c.name === "species" || c.name === "Z");
  const posCol = columns.find((c) => c.name === "pos");
  if (!speciesCol || !posCol || posCol.count !== 3 || speciesCol.count !== 1) {
    throw new ExtxyzError("Properties must name a species (or Z) column and a three-column pos.");
  }
  const columnCount = columns.reduce((s, c) => s + c.count, 0);
  const forceCol = REFERENCE_FORCE_KEYS.map((k) => columns.find((c) => c.name === k && c.type === "R" && c.count === 3)).find(
    Boolean,
  );

  if (lines.length < 2 + n) throw new ExtxyzError(`Frame has ${Math.max(0, lines.length - 2)} atoms, expected ${n}.`);
  const symbols: string[] = [];
  const positions: number[][] = [];
  const forces: number[][] = [];
  for (let i = 0; i < n; i++) {
    const parts = lines[2 + i].trim().split(/\s+/);
    if (parts.length < columnCount) throw new ExtxyzError(`Atom line ${i + 1} has ${parts.length} columns, Properties declares ${columnCount}.`);
    const raw = parts[speciesCol.start];
    if (speciesCol.name === "Z") {
      const z = /^\d+$/.test(raw) ? parseInt(raw, 10) : 0;
      if (z < 1 || z > CHEMICAL_SYMBOLS.length) throw new ExtxyzError(`Atom line ${i + 1}: Z=${raw} is not an element.`);
      symbols.push(CHEMICAL_SYMBOLS[z - 1]);
    } else {
      symbols.push(requireElement(capitalize(raw), `on atom line ${i + 1}`));
    }
    const read3 = (start: number): number[] =>
      [0, 1, 2].map((k) => {
        const v = decimal(parts[start + k]);
        if (v === null) throw new ExtxyzError(`Atom line ${i + 1}: "${parts[start + k]}" is not a number.`);
        return v;
      });
    positions.push(read3(posCol.start));
    if (forceCol) forces.push(read3(forceCol.start));
  }

  let referenceEnergy: number | undefined;
  for (const key of REFERENCE_ENERGY_KEYS) {
    const v = keys.has(key) ? decimal(keys.get(key)!) : null;
    if (v !== null) {
      referenceEnergy = v;
      break;
    }
  }

  return {
    symbols,
    positions,
    lattice,
    pbc,
    frameCount: countXyzFrames(lines),
    notes,
    referenceEnergy,
    referenceForces: forces.length > 0 ? forces : undefined,
  };
}

/**
 * Extended XYZ, with the server's fallback: when ASE's extxyz reader rejects a
 * file it reads it again with the plain xyz reader, which ignores the comment
 * line — so a bad `Lattice`, `Properties` or `pbc` costs the cell, the
 * periodicity and the reference data, and the result is an isolated molecule.
 */
function parseExtendedXYZ(text: string): RawStructure {
  const lines = splitLines(text);
  try {
    return readExtendedFrame(lines);
  } catch (err) {
    if (!(err instanceof ExtxyzError)) throw err;
    return parsePlainXYZ(text, [
      `The comment line could not be read as extended XYZ (${err.message}) so the file was read as plain XYZ: ` +
        "any Lattice, pbc and reference energies or forces are ignored and the structure is treated as an isolated molecule.",
    ]);
  }
}

// ---------------------------------------------------------------------------
// CIF
// ---------------------------------------------------------------------------

interface CifToken {
  text: string;
  quoted: boolean;
}

/** CIF 1.1 tokens: bare words, 'quoted' and "quoted" strings, ;text fields; `#` starts a comment. */
function tokenizeCif(text: string): CifToken[] {
  const tokens: CifToken[] = [];
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(";")) {
      const body = [line.slice(1)];
      i++;
      while (i < lines.length && !lines[i].startsWith(";")) body.push(lines[i++]);
      tokens.push({ text: body.join("\n").trim(), quoted: true });
      continue;
    }
    let p = 0;
    while (p < line.length) {
      const ch = line[p];
      if (/\s/.test(ch)) {
        p++;
      } else if (ch === "#") {
        break;
      } else if (ch === "'" || ch === '"') {
        // A quote closes only when whitespace or the end of the line follows it.
        let q = p + 1;
        while (q < line.length && !(line[q] === ch && (q + 1 === line.length || /\s/.test(line[q + 1])))) q++;
        tokens.push({ text: line.slice(p + 1, q), quoted: true });
        p = q + 1;
      } else {
        let q = p;
        while (q < line.length && !/\s/.test(line[q])) q++;
        tokens.push({ text: line.slice(p, q), quoted: false });
        p = q;
      }
    }
  }
  return tokens;
}

/** One `data_` block: lower-cased tag -> its values (one for `_tag value`, one per row for a loop). */
interface CifBlock {
  items: Map<string, string[]>;
}

function parseCifBlocks(text: string): CifBlock[] {
  const tokens = tokenizeCif(text);
  const blocks: CifBlock[] = [];
  let block: CifBlock | null = null;
  const isKeyword = (t: CifToken) =>
    !t.quoted && (t.text.startsWith("_") || /^loop_$/i.test(t.text) || /^data_/i.test(t.text));

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.quoted && /^data_/i.test(t.text)) {
      block = { items: new Map() };
      blocks.push(block);
      i++;
    } else if (!t.quoted && /^loop_$/i.test(t.text)) {
      if (!block) blocks.push((block = { items: new Map() }));
      i++;
      // Every `loop_` starts afresh: its own headers, its own column indices.
      const headers: string[] = [];
      while (i < tokens.length && !tokens[i].quoted && tokens[i].text.startsWith("_")) {
        headers.push(tokens[i++].text.toLowerCase());
      }
      const values: string[] = [];
      while (i < tokens.length && !isKeyword(tokens[i])) values.push(tokens[i++].text);
      if (headers.length > 0) {
        if (values.length % headers.length !== 0) {
          throw new Error(
            `The CIF loop that starts with ${headers[0]} has ${values.length} values for ${headers.length} columns; a row is incomplete.`,
          );
        }
        const rows = values.length / headers.length;
        headers.forEach((h, c) => {
          block!.items.set(h, Array.from({ length: rows }, (_, r) => values[r * headers.length + c]));
        });
      }
    } else if (!t.quoted && t.text.startsWith("_")) {
      if (!block) blocks.push((block = { items: new Map() }));
      const next = tokens[i + 1];
      if (next && !isKeyword(next)) {
        block.items.set(t.text.toLowerCase(), [next.text]);
        i += 2;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return blocks;
}

/** A CIF number: "5.4309(5)" -> 5.4309. */
function cifNumber(text: string | undefined): number | null {
  return text === undefined ? null : decimal(text.replace(/\(\d+\)$/, ""));
}

/** The first of `tags` the block has, as ASE's `_get_any`. */
function cifFirst(block: CifBlock, tags: string[]): string[] | undefined {
  for (const tag of tags) {
    const v = block.items.get(tag);
    if (v) return v;
  }
  return undefined;
}

/**
 * The element of one `_atom_site_type_symbol` or `_atom_site_label` value, by
 * ASE's rule (ase/io/cif.py): the first capital letter and an optional
 * lower-case one, so "Fe2+" is Fe and "H1A" is H. ASE applies that rule to an
 * all-capitals symbol too, and reads NA as N, CL as C, FE as F — D113. A type
 * symbol that is not written Na, Cl, Fe (optionally with a charge) is refused.
 */
function cifElement(raw: string, fromTypeSymbol: boolean): string {
  if (raw === "." || raw === "?") {
    throw new Error("The CIF leaves an atom's element undetermined ('.' or '?').");
  }
  if (fromTypeSymbol) {
    const core = raw.replace(/(?:\d*[+-]|[+-]\d+)$/, "");
    if (!/^[A-Z][a-z]?\d*$/.test(core)) {
      throw new Error(
        `The CIF writes an element as "${raw}", with the wrong capitalisation. ASE would read NA as N, CL as C and FE as F, ` +
          "so the structure would not be the one you see. Write each symbol with a capital first letter and a lower-case " +
          "second letter (Na, Cl, Fe), then upload again.",
      );
    }
  }
  const match = raw.match(/[A-Z][a-z]?/);
  if (!match) throw new Error(`The CIF writes an element as "${raw}", which has no element symbol in it.`);
  return requireElement(match[0] === "D" ? "H" : match[0], "in the CIF");
}

/** The 24 space groups with two origin choices (ITA), by number and normalised Hermann-Mauguin symbol. */
const TWO_ORIGIN_NUMBERS: ReadonlySet<number> = new Set([
  48, 50, 59, 68, 70, 85, 86, 88, 125, 126, 129, 130, 133, 134, 137, 138, 141, 142, 201, 203, 222, 224, 227, 228,
]);
const TWO_ORIGIN_SYMBOLS: ReadonlySet<string> = new Set([
  "pnnn", "pban", "pmmn", "ccce", "fddd", "p4/n", "p42/n", "i41/a", "p4/nbm", "p4/nnc", "p4/nmm", "p4/ncc",
  "p42/nbc", "p42/nnm", "p42/nmc", "p42/ncm", "i41/amd", "i41/acd", "pn-3", "fd-3", "pn-3n", "pn-3m", "fd-3m", "fd-3c",
]);

/** 3x3 inverse of row vectors (Å), or null for a singular cell. */
function invert3(m: number[][]): number[][] | null {
  const d = det3(m);
  if (Math.abs(d) < 1e-12) return null;
  const [a, b, c] = m;
  const cof = [
    [b[1] * c[2] - b[2] * c[1], a[2] * c[1] - a[1] * c[2], a[1] * b[2] - a[2] * b[1]],
    [b[2] * c[0] - b[0] * c[2], a[0] * c[2] - a[2] * c[0], a[2] * b[0] - a[0] * b[2]],
    [b[0] * c[1] - b[1] * c[0], a[1] * c[0] - a[0] * c[1], a[0] * b[1] - a[1] * b[0]],
  ];
  return cof.map((row) => row.map((v) => v / d));
}

/** The structure in one CIF block, or null when the block has no atom sites. Throws on what the server refuses. */
function readCifBlock(block: CifBlock, notes: string[]): Omit<RawStructure, "frameCount" | "notes"> | null {
  const typeColumn = block.items.get("_atom_site_type_symbol");
  const symbolColumn = typeColumn ?? block.items.get("_atom_site_label");
  const column = (tags: string[]) => {
    const cols = tags.map((t) => block.items.get(t));
    return cols.every(Boolean) ? (cols as string[][]) : null;
  };
  // ASE prefers fractional coordinates when a block has both.
  const fractional = column(["_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z"]);
  const coordinates = fractional ?? column(["_atom_site_cartn_x", "_atom_site_cartn_y", "_atom_site_cartn_z"]);
  if (!symbolColumn || !coordinates) return null;
  const n = symbolColumn.length;
  if (coordinates.some((c) => c.length !== n)) {
    throw new Error("The CIF's _atom_site loop has columns of different lengths.");
  }

  // D115: ASE keeps the occupancy only as metadata and computes every site as
  // fully occupied, so a disordered or vacant site is a different material.
  const occupancy = block.items.get("_atom_site_occupancy");
  if (occupancy?.some((o) => {
    const v = cifNumber(o);
    return v !== null && Math.abs(v - 1) > 1e-6;
  })) {
    throw new Error(
      "The CIF lists sites with an occupancy other than 1 (a disordered or partly vacant structure). " +
        "The calculation would treat every site as fully occupied, which is a different material, so this file is refused. " +
        "Choose one ordered arrangement, write it out with occupancy 1, and upload that.",
    );
  }

  const symbols = symbolColumn.map((s) => cifElement(s, typeColumn !== undefined));
  const coords = Array.from({ length: n }, (_, i) =>
    coordinates.map((col) => {
      const v = cifNumber(col[i]);
      if (v === null) throw new Error(`The CIF has a coordinate "${col[i]}" that is not a number.`);
      return v;
    }),
  );

  const cellTags = ["_cell_length_a", "_cell_length_b", "_cell_length_c", "_cell_angle_alpha", "_cell_angle_beta", "_cell_angle_gamma"];
  const cellValues = cellTags.map((t) => cifNumber(block.items.get(t)?.[0]));
  const cell: Record<string, number> = {};
  if (cellValues.every((v) => v !== null)) {
    ["length_a", "length_b", "length_c", "angle_alpha", "angle_beta", "angle_gamma"].forEach((k, i) => {
      cell[k] = cellValues[i] as number;
    });
  }
  const lattice = buildLatticeFromCell(cell);

  if (!lattice) {
    if (fractional) {
      throw new Error(
        "CIF declares fractional coordinates but no readable unit cell " +
          "(_cell_length_a/b/c, _cell_angle_alpha/beta/gamma). Without the cell " +
          "the coordinates cannot be converted to Ångströms.",
      );
    }
    return { symbols, positions: coords, pbc: [...NOT_PERIODIC] };
  }

  // Everything below works in fractional coordinates, as ASE's `crystal()`
  // does: it wraps every site into the cell, applies the symmetry operations
  // and drops repeats.
  let frac: [number, number, number][];
  if (fractional) {
    frac = coords as [number, number, number][];
  } else {
    const inv = invert3(lattice)!;
    frac = coords.map(
      (r) => [0, 1, 2].map((k) => r[0] * inv[0][k] + r[1] * inv[1][k] + r[2] * inv[2][k]) as [number, number, number],
    );
  }
  const sites = symbols.map((symbol, i) => ({ symbol, frac: frac[i] }));

  const opColumn = cifFirst(block, ["_space_group_symop_operation_xyz", "_space_group_symop.operation_xyz", "_symmetry_equiv_pos_as_xyz"]);
  const ops = (opColumn ?? []).map(parseSymmetryOp).filter((o): o is SymOp => o !== null);
  if (ops.length <= 1) checkSymbolOnlySymmetry(block, notes, sites.length);

  const expanded = expandSymmetry(sites, ops);
  const symbolsOut: string[] = [];
  const positions: number[][] = [];
  for (const site of expanded) {
    const [x, y, z] = site.frac;
    symbolsOut.push(site.symbol);
    // r_cart = f_a * a + f_b * b + f_c * c
    positions.push([
      x * lattice[0][0] + y * lattice[1][0] + z * lattice[2][0],
      x * lattice[0][1] + y * lattice[1][1] + z * lattice[2][1],
      x * lattice[0][2] + y * lattice[1][2] + z * lattice[2][2],
    ]);
  }
  return { symbols: symbolsOut, positions, lattice, pbc: [...ALL_PERIODIC] };
}

/**
 * A CIF with no symmetry operations but a space group other than P1 gives
 * ASE's space-group table the job of expanding the sites. The browser has no
 * such table, so the preview draws only the listed sites and says so. A symbol
 * that ends ":2" asks for origin choice 2, which ASE ignores: it expands with
 * origin-1 operators and builds the wrong crystal (D114), so that file is
 * refused. Without the suffix a group with two origins (Fd-3m, Fddd, Pn-3m, …)
 * cannot say which one the coordinates use; ASE assumes origin 1, and the note
 * tells the user to check.
 */
function checkSymbolOnlySymmetry(block: CifBlock, notes: string[], listedSites: number): void {
  const numberColumn = cifFirst(block, ["_space_group.it_number", "_space_group_it_number", "_symmetry_int_tables_number"]);
  const nameColumn = cifFirst(block, ["_space_group_name_h-m_alt", "_symmetry_space_group_name_h-m"]);
  const number = numberColumn ? parseInt(numberColumn[0], 10) : NaN;
  const name = nameColumn?.[0];
  const compact = name?.toLowerCase().replace(/[\s_'"]/g, "").replace(/:.*$/, "");
  const isP1 = number === 1 || compact === "p1";
  if (isP1 || (Number.isNaN(number) && !name)) return;

  const group = name ? `"${name}"` : `number ${number}`;
  if (/:\s*2\s*$/.test(name ?? "")) {
    throw new Error(
      `The CIF asks for origin choice 2 of space group ${group} but gives no symmetry operations. The calculation ignores the ":2" and ` +
        "builds the crystal with origin choice 1, which is a different structure. Add the symmetry operations " +
        "(_space_group_symop_operation_xyz) or write the full cell in P1, then upload again.",
    );
  }
  const twoOrigins = TWO_ORIGIN_NUMBERS.has(number) || (compact !== undefined && TWO_ORIGIN_SYMBOLS.has(compact));
  notes.push(
    `The CIF names space group ${group} (a Hermann-Mauguin symbol or number) without listing its symmetry operations. ` +
      `The preview cannot expand it and shows only the ${listedSites} listed site${listedSites === 1 ? "" : "s"}; ` +
      "the calculation applies the group's operations to them, so its atom count may be larger." +
      (twoOrigins
        ? " This group has two origin choices and the symbol does not say which one the coordinates use; the calculation assumes origin 1, so check that yours does."
        : ""),
  );
}

function parseCIF(text: string): RawStructure {
  const blocks = parseCifBlocks(text);
  const notes: string[] = [];
  type CifAtoms = Omit<RawStructure, "frameCount" | "notes">;
  let first: CifAtoms | null = null;
  let withAtoms = 0;
  for (const block of blocks) {
    const atoms: CifAtoms | null = first === null ? readCifBlock(block, notes) : null;
    if (atoms) first = atoms;
    if (
      (block.items.has("_atom_site_type_symbol") || block.items.has("_atom_site_label")) &&
      (block.items.has("_atom_site_fract_x") || block.items.has("_atom_site_cartn_x"))
    ) {
      withAtoms++;
    }
  }
  if (!first) {
    throw new Error("No atom sites found in the CIF: it needs an _atom_site loop with element symbols and coordinates.");
  }
  if (withAtoms > 1) {
    notes.push(`The CIF has ${withAtoms} data blocks with atoms; only the first is used, as the calculation does.`);
  }
  return { ...first, frameCount: Math.max(1, withAtoms), notes };
}

// ---------------------------------------------------------------------------
// CIF symmetry operations
// ---------------------------------------------------------------------------

/** One operation f' = R f + t on fractional coordinates. */
interface SymOp {
  rot: number[][];
  trans: number[];
}

/** "-x+1/2, y, z+0.25" -> rotation rows and translation, or null if unreadable. */
function parseSymmetryOp(text: string): SymOp | null {
  const comps = text.toLowerCase().replace(/[\s'"]/g, "").split(",");
  if (comps.length !== 3) return null;
  const rot: number[][] = [];
  const trans: number[] = [];
  for (const comp of comps) {
    const row = [0, 0, 0];
    let t = 0;
    let consumed = 0;
    for (const m of comp.matchAll(/([+-]?)(?:(\d+(?:\.\d+)?)(?:\/(\d+))?|([xyz]))/g)) {
      consumed += m[0].length;
      const sign = m[1] === "-" ? -1 : 1;
      if (m[4]) row["xyz".indexOf(m[4])] += sign;
      else t += (sign * parseFloat(m[2])) / (m[3] ? parseFloat(m[3]) : 1);
    }
    if (consumed !== comp.length || comp.length === 0) return null;
    rot.push(row);
    trans.push(t);
  }
  return { rot, trans };
}

/** Fractional coordinate wrapped into [0, 1), with values within eps below 1 taken as 0. */
const wrapUnit = (v: number): number => {
  const w = v - Math.floor(v);
  return w > 1 - 1e-8 ? 0 : w;
};

/**
 * Most images (listed sites x symmetry operations) the preview will expand. A
 * database CIF lists a few dozen sites under at most 192 operations; a file
 * past this is a symmetry bomb that would freeze the browser tab (the server
 * refuses the same files, D133).
 */
const MAX_SYMMETRY_IMAGES = 100_000;

/**
 * What `expandCifSites` did, counted so a test can check that the work grows
 * linearly with the number of images without reading a clock (a slow CI runner
 * made a wall-clock bound flaky): images generated, and candidate atoms an
 * image was compared with before it was kept or dropped.
 */
export interface ExpansionWork {
  images: number;
  comparisons: number;
}

/**
 * The expansion the CIF reader performs, on listed sites and operation strings
 * such as "-x+1/2, y, z". Exported only so a test can drive it without the
 * nearest-neighbour search that `parseStructureText` runs afterwards.
 */
export function expandCifSites<T extends { symbol: string; frac: [number, number, number] }>(
  sites: T[],
  operations: string[],
  work?: ExpansionWork,
): T[] {
  return expandSymmetry(
    sites,
    operations.map(parseSymmetryOp).filter((o): o is SymOp => o !== null),
    work,
  );
}

/**
 * Apply `ops` to every listed site and drop repeats, as ASE's `crystal()`
 * does: every image is wrapped into the cell, and one within 0.001 of an
 * earlier one (fractional, modulo the cell) is dropped — whichever listed site
 * it came from. With no operations the sites are only wrapped. Sites stay
 * grouped by the listed site they came from, as ASE orders them. Repeats are
 * found through a hash grid of 1/1000 cells, so the cost is linear in the
 * number of images.
 */
function expandSymmetry<T extends { symbol: string; frac: [number, number, number] }>(
  sites: T[],
  ops: SymOp[],
  work?: ExpansionWork,
): T[] {
  const operations: SymOp[] = ops.length > 0 ? ops : [{ rot: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], trans: [0, 0, 0] }];
  if (sites.length * operations.length > MAX_SYMMETRY_IMAGES) {
    throw new Error(
      `The CIF lists ${sites.length.toLocaleString()} sites and ${operations.length} symmetry operations, which would expand to up to ` +
        `${(sites.length * operations.length).toLocaleString()} atoms. That is more than this page or the calculation will expand ` +
        `(${MAX_SYMMETRY_IMAGES.toLocaleString()} images at most). Upload the unit cell with its atoms written out.`,
    );
  }
  const out: T[] = [];
  const grid = new Map<number, number[]>();
  const bucket = (c: number) => Math.floor(c * 1000);
  const key = (x: number, y: number, z: number) => ((x + 1000) % 1000) * 1_000_000 + ((y + 1000) % 1000) * 1000 + ((z + 1000) % 1000);
  const near = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, 1 - d) < 1e-3;
  };
  for (const site of sites) {
    for (const { rot, trans } of operations) {
      const f = site.frac;
      const image = rot.map((row, k) => wrapUnit(row[0] * f[0] + row[1] * f[1] + row[2] * f[2] + trans[k])) as [
        number,
        number,
        number,
      ];
      if (work) work.images++;
      const [bx, by, bz] = image.map(bucket);
      let seen = false;
      for (let dx = -1; dx <= 1 && !seen; dx++)
        for (let dy = -1; dy <= 1 && !seen; dy++)
          for (let dz = -1; dz <= 1 && !seen; dz++) {
            for (const index of grid.get(key(bx + dx, by + dy, bz + dz)) ?? []) {
              if (work) work.comparisons++;
              const o = out[index].frac;
              if (near(o[0], image[0]) && near(o[1], image[1]) && near(o[2], image[2])) {
                seen = true;
                break;
              }
            }
          }
      if (!seen) {
        const k = key(bx, by, bz);
        const list = grid.get(k);
        if (list) list.push(out.length);
        else grid.set(k, [out.length]);
        out.push({ ...site, frac: image });
      }
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// PDB
// ---------------------------------------------------------------------------

/**
 * Parse PDB format the way ASE's `proteindatabank` reader does: the first
 * model (reading stops at the first record starting with END, which includes
 * ENDMDL), ATOM/HETATM coordinates from the fixed columns, the element from
 * columns 77-78 and, failing that, from the atom name. A `CRYST1` record makes
 * the structure periodic — except the wwPDB placeholder, below.
 */
function parsePDB(text: string): RawStructure {
  const lines = splitLines(text);
  const symbols: string[] = [];
  const positions: number[][] = [];
  const notes: string[] = [];
  let cellpar: number[] | null = null;

  const column = (line: string, from: number, to: number, what: string): number => {
    const v = decimal(line.substring(from, to));
    if (v === null) throw new Error(`PDB ${what} "${line.substring(from, to).trim()}" is not a number.`);
    return v;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("CRYST1")) {
      cellpar = [
        column(line, 6, 15, "cell length a"), column(line, 15, 24, "cell length b"), column(line, 24, 33, "cell length c"),
        column(line, 33, 40, "cell angle alpha"), column(line, 40, 47, "cell angle beta"), column(line, 47, 54, "cell angle gamma"),
      ];
    }
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const record = line.substring(0, 6);
      if (record !== "ATOM  " && record !== "HETATM") {
        throw new Error(`PDB line ${i + 1} starts with "${record.trim()}" but only ATOM and HETATM records can be read.`);
      }
      const coords = [30, 38, 46].map((from) => column(line, from, from + 8, `coordinate on line ${i + 1}`));
      const symbol =
        labelToSymbol(line.substring(76, 78).trim()) ?? labelToSymbol(line.substring(12, 16).trim());
      if (!symbol) {
        throw new Error(`PDB line ${i + 1}: no element in columns 77-78 or in the atom name "${line.substring(12, 16).trim()}".`);
      }
      symbols.push(symbol);
      positions.push(coords);
    }
    if (line.startsWith("END")) break;
  }

  let lattice: number[][] | undefined;
  let pbc: [boolean, boolean, boolean] = [...NOT_PERIODIC];
  if (cellpar) {
    const [a, b, c, alpha, beta, gamma] = cellpar;
    const near = (v: number, target: number) => Math.abs(v - target) < 1e-3;
    if ([a, b, c].every((v) => near(v, 1)) && [alpha, beta, gamma].every((v) => near(v, 90))) {
      // The wwPDB writes this for every entry that is not a crystal (NMR models,
      // docking poses, most converters). ASE takes it for a 1 Å periodic cube.
      notes.push(
        "CRYST1 is the 1 × 1 × 1 Å, 90° placeholder that the PDB format writes for a structure that is not a crystal. " +
          "It is treated as no cell, so this is an isolated molecule.",
      );
    } else if (a <= 0 || b <= 0 || c <= 0) {
      notes.push("CRYST1 gives a cell with a zero length; it is treated as no cell, so this is an isolated molecule.");
    } else {
      lattice = buildLatticeFromCell({
        length_a: a, length_b: b, length_c: c, angle_alpha: alpha, angle_beta: beta, angle_gamma: gamma,
      });
      if (lattice) pbc = [...ALL_PERIODIC];
      else notes.push("CRYST1 gives angles that do not close a cell; it is treated as no cell, so this is an isolated molecule.");
    }
  }

  const models = lines.filter((l) => /^MODEL\b/.test(l)).length;
  return { symbols, positions, lattice, pbc, frameCount: Math.max(1, models), notes };
}

// ---------------------------------------------------------------------------
// POSCAR / CONTCAR
// ---------------------------------------------------------------------------

/** VASP 4 has no element line; ASE takes the elements from the comment line's words ("Si", "NaCl"). */
function elementsFromComment(comment: string): string[] {
  const out: string[] = [];
  for (const word of comment.split(/\s+/)) {
    const cleaned = word.replace(/-|_|,|\.|=|[0-9]/g, "");
    if (cleaned.length < 1 || !/^(?:[A-Z][a-z]?)+$/.test(cleaned)) continue;
    const symbols = cleaned.match(/[A-Z][a-z]?/g)!;
    if (symbols.every((s) => SYMBOL_SET.has(s))) out.push(...symbols);
  }
  return out;
}

/**
 * Parse POSCAR / CONTCAR (VASP format) the way ASE's `read_vasp` does.
 * Line layout: comment, scale (one factor, or three per-axis factors),
 * 3 lattice vectors, [elements], counts, [Selective dynamics], coordinate type,
 * positions. A negative scale is the target cell volume. Cartesian positions
 * are multiplied by the scale like the cell is; direct ones are not.
 */
function parsePOSCAR(text: string): RawStructure {
  const lines = splitLines(text).map((l) => l.trim());
  if (lines.length < 8) throw new Error("POSCAR is too short: it needs a header, a cell, element counts and positions.");

  const scaleTokens = lines[1].split(/\s+/).filter(Boolean);
  if (scaleTokens.length !== 1 && scaleTokens.length !== 3) {
    throw new Error(`POSCAR line 2 must hold one scale factor or three, not ${scaleTokens.length}.`);
  }
  const scale = scaleTokens.map((t) => requireDecimal(t, "POSCAR scale factor"));

  const cell = [2, 3, 4].map((i) => {
    const parts = lines[i].split(/\s+/).filter(Boolean);
    if (parts.length < 3) throw new Error(`POSCAR line ${i + 1} must hold three cell-vector components.`);
    return parts.slice(0, 3).map((t) => requireDecimal(t, `POSCAR line ${i + 1}`));
  });
  // Negative: the volume the cell should have, so the factor is its cube root.
  const factors = scale[0] < 0 ? scale.map((s) => Math.cbrt(-s / det3(cell))) : scale;
  const axisScale = factors.length === 3 ? factors : [factors[0], factors[0], factors[0]];
  const lattice = cell.map((row) => row.map((v, j) => v * axisScale[j]));

  // Line 6 is the element line (VASP 5) or already the counts (VASP 4).
  const first = lines[5].split(/\s+/).filter(Boolean);
  const vasp5 = !/^\d+$/.test(first[0] ?? "");
  const countTokens = (vasp5 ? lines[6] : lines[5]).split(/\s+/).filter(Boolean);
  const bang = countTokens.findIndex((t) => t.includes("!"));
  const counts = (bang >= 0 ? countTokens.slice(0, bang) : countTokens).map((t) => {
    if (!/^\d+$/.test(t)) throw new Error(`POSCAR atom count "${t}" is not a whole number.`);
    return parseInt(t, 10);
  });

  let species: string[];
  if (vasp5) {
    species = first;
  } else {
    species = elementsFromComment(lines[0]);
    if (species.length < counts.length) {
      throw new Error(
        "This POSCAR is in the older VASP 4 format, which has no line naming the elements, and its first line does not name them either. " +
          "Add an element line (for example Si) above the atom counts, or put the symbols on the first line.",
      );
    }
  }
  const symbols: string[] = [];
  counts.forEach((count, i) => {
    const symbol = species[i];
    if (symbol === undefined) throw new Error("POSCAR lists more atom counts than element symbols.");
    requireElement(symbol, "in the POSCAR element line");
    for (let j = 0; j < count; j++) symbols.push(symbol);
  });

  // Coordinate type: "Selective dynamics" may come first; only C/c/K/k means Cartesian.
  let row = vasp5 ? 7 : 6;
  if (lines[row].toLowerCase().startsWith("s")) row++;
  const cartesian = "ck".includes(lines[row].toLowerCase()[0] ?? "");
  row++;

  const positions: number[][] = [];
  for (let i = 0; i < symbols.length; i++) {
    const parts = (lines[row + i] ?? "").split(/\s+/).filter(Boolean);
    if (parts.length < 3) throw new Error(`POSCAR position line ${i + 1} must hold three coordinates.`);
    const [x, y, z] = parts.slice(0, 3).map((t) => requireDecimal(t, `POSCAR position ${i + 1}`));
    positions.push(
      cartesian
        ? [x * axisScale[0], y * axisScale[1], z * axisScale[2]]
        : [0, 1, 2].map((k) => x * lattice[0][k] + y * lattice[1][k] + z * lattice[2][k]),
    );
  }

  return { symbols, positions, lattice, pbc: [...ALL_PERIODIC], frameCount: 1, notes: [] };
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
 * Shortest distance (Å) between any two atoms, minimum-image on every periodic
 * axis (D117): a contact across the cell boundary is as real as one inside it,
 * and an atom in a one-atom cell is bound to its own image. Isolated systems
 * and non-periodic axes are measured directly. Infinity when there is nothing
 * to measure to. O(n²) over at most the first 2000 atoms.
 */
function computeMinDistance(
  positions: number[][],
  lattice: number[][] | undefined,
  pbc: [boolean, boolean, boolean],
): number {
  const periodic = lattice !== undefined && hasPositiveVolume(lattice) && pbc.some(Boolean);
  if (positions.length < 2 && !periodic) return Infinity;

  // Lattice translations to test: -1, 0, 1 on each periodic axis. After the
  // fractional difference is wrapped into [-1/2, 1/2) these cover the nearest
  // image for any cell that is not extremely skewed.
  const shifts: number[][] = [];
  if (periodic) {
    const range = (axis: number) => (pbc[axis] ? [-1, 0, 1] : [0]);
    for (const i of range(0))
      for (const j of range(1))
        for (const k of range(2))
          shifts.push([0, 1, 2].map((c) => i * lattice![0][c] + j * lattice![1][c] + k * lattice![2][c]));
  }
  const inverse = periodic ? invert3(lattice!) : null;

  let minDist = Infinity;
  // Cap at first 2000 atoms to keep UI responsive
  const n = Math.min(positions.length, 2000);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let dx = positions[j][0] - positions[i][0];
      let dy = positions[j][1] - positions[i][1];
      let dz = positions[j][2] - positions[i][2];
      if (inverse) {
        // Wrap the difference into the cell on the periodic axes only.
        const f = [0, 1, 2].map((k) => dx * inverse[0][k] + dy * inverse[1][k] + dz * inverse[2][k]);
        for (let a = 0; a < 3; a++) if (pbc[a]) f[a] -= Math.round(f[a]);
        dx = f[0] * lattice![0][0] + f[1] * lattice![1][0] + f[2] * lattice![2][0];
        dy = f[0] * lattice![0][1] + f[1] * lattice![1][1] + f[2] * lattice![2][1];
        dz = f[0] * lattice![0][2] + f[1] * lattice![1][2] + f[2] * lattice![2][2];
        for (const [sx, sy, sz] of shifts) {
          if (i === j && sx === 0 && sy === 0 && sz === 0) continue;
          const d2 = (dx + sx) ** 2 + (dy + sy) ** 2 + (dz + sz) ** 2;
          if (d2 < minDist) minDist = d2;
        }
      } else if (i !== j) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minDist) minDist = d2;
      }
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
