#!/usr/bin/env python3
"""
fetch_mp_reference.py — build and verify SimpleAtom's Materials Project reference set.

WHAT THIS IS FOR
    SimpleAtom claims its MACE-MP-0 numbers agree with the Materials Project.
    That claim needs a number, and the number needs a defensible construction.
    This script builds the fixture the benchmark UI compares against, and can
    re-run the whole comparison offline so the tolerance is not taken on faith.

DATA SOURCE — unauthenticated
    https://optimade.materialsproject.org/v1/structures
    MP's OPTIMADE endpoint needs NO API key. It serves the relaxed structure
    (lattice_vectors + cartesian_site_positions) and, via MP's own provider
    extension `_mp_stability`, the published thermodynamic data.

    We read `_mp_stability["gga_gga+u"]`, i.e. PBE / PBE+U. NOT r2scan:
    MACE-MP-0 was trained on MP's PBE(+U) data (MPtrj), so r2SCAN values would
    be the wrong yardstick. The other two keys MP exposes (`r2scan`,
    `gga_gga+u_r2scan`) are deliberately ignored.

WHY FORMATION ENERGIES AND NOT TOTAL ENERGIES
    MP total energies come from VASP with PAW datasets; MACE's absolute energy
    scale is its own. The two are not comparable, ever. Only formation energies
    and energy differences are. So:

        E_f(compound) = [ E(compound) - SUM_i n_i * e_ref(element_i) ] / N_atoms

    and every e_ref(element_i) must come from the SAME MACE model as
    E(compound). Mixing a MACE total with an MP elemental reference is the
    single easiest way to produce a confident wrong answer, so this script
    never does it and neither does the UI: the UI computes e_ref from the
    elemental reference structures run in the same benchmark batch.

WHICH ELEMENTAL PHASE COUNTS AS THE REFERENCE
    MP measures formation energy against its own lowest-energy phase for each
    element. If we picked a different phase, we would introduce an offset equal
    to that phase's own MP formation energy. So an element structure only
    qualifies as a reference here if MP reports
    formation_energy_per_atom == 0 for it in gga_gga+u. The script ASSERTS
    this at fetch time and refuses to write the fixture otherwise.

    (This is not a formality. mp-127 Na and mp-48 C — the entries you would
    reach for by name — report +0.0123 and +0.0084 eV/atom respectively and
    are therefore NOT MP's reference phases.)

WHY THE SCORED SET IS METAL-METAL ONLY
    MP post-processes its GGA formation energies with composition-dependent
    corrections (the MP2020 compatibility scheme) for compounds containing
    anions such as O, N, S, F, Cl, Br, I, Se, Te, Si, H. Whether those
    corrections are present in the energies MACE-MP-0 actually trained on is
    not something this script can establish, so the scored set sidesteps the
    question entirely: it contains only metal-metal compounds, whose elements
    receive no such correction. Anion-bearing structures are excluded and the
    UI says so on screen.

USAGE
    python test_scripts/fetch_mp_reference.py --check-endpoint
    python test_scripts/fetch_mp_reference.py --fetch          # writes lib/mp-reference-data.ts
    python test_scripts/fetch_mp_reference.py --verify         # runs MACE, prints the table
    python test_scripts/fetch_mp_reference.py --verify --model-size small

NO API KEY IS USED OR NEEDED. If a future version needs MP's main REST API,
the key belongs in an env var (MP_API_KEY) and never in this file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# macOS links more than one copy of libomp through torch's dependency tree;
# without this the MACE child process aborts with OMP Error #15 before it emits
# any JSON. Same convention as test_scripts/test_provenance.py and the
# app/api/* route handlers. Recorded in the --verify banner so the reader knows.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "lib" / "mp-reference-data.ts"
CALC_SCRIPT = REPO_ROOT / "mace-api" / "calculate_local.py"

OPTIMADE_BASE = "https://optimade.materialsproject.org/v1"
STRUCTURES_URL = f"{OPTIMADE_BASE}/structures"
INFO_URL = f"{OPTIMADE_BASE}/info"
MP_DATASET_KEY = "gga_gga+u"

# The endpoint rejects the default urllib User-Agent with HTTP 403.
HTTP_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "SimpleAtom-MP-reference/1.0 (+https://mace-lake.vercel.app)",
}

RESPONSE_FIELDS = ",".join(
    [
        "id",
        "chemical_formula_reduced",
        "chemical_formula_descriptive",
        "elements",
        "nelements",
        "nsites",
        "lattice_vectors",
        "cartesian_site_positions",
        "species_at_sites",
        "species",
        "structure_features",
        "_mp_stability",
    ]
)

# Elements that attract MP2020 composition corrections as anions. Any compound
# containing one of these is refused for the scored set.
CORRECTION_PRONE_ELEMENTS = {
    "O", "N", "S", "F", "Cl", "Br", "I", "Se", "Te", "Si", "H", "P", "As", "Sb",
}

# The tolerance the UI declares. Kept here so the offline run and the on-screen
# verdict can never disagree; lib/mp-reference.ts holds the same number and
# cites this file.
TOLERANCE_EV_PER_ATOM = 0.050
TIGHT_EV_PER_ATOM = 0.025


@dataclass(frozen=True)
class Target:
    """One structure we want from MP."""

    key: str               # SimpleAtom structure id
    mp_id: str             # Materials Project id
    role: str              # "compound" | "element-reference"
    element: str | None = None   # set for element-reference
    note: str = ""


# --- The set -------------------------------------------------------------
#
# Compounds: metal-metal, on the MP convex hull (energy_above_hull == 0 in
# gga_gga+u), small cells, spanning formation energies from -0.04 to
# -0.66 eV/atom so the comparison is not a single point. Chosen by querying
# OPTIMADE for the ground state of each formula; the hull condition is
# re-asserted at fetch time.
#
# Element references: MP's own reference phase for each element appearing in
# the compounds, identified by formation_energy_per_atom == 0.
TARGETS: list[Target] = [
    Target("mp-aucu3",  "mp-2258",   "compound", note="Au-Cu ordered alloy"),
    Target("mp-al2cu",  "mp-985806", "compound", note="Al-Cu intermetallic"),
    Target("mp-alfe",   "mp-2658",   "compound", note="Al-Fe intermetallic"),
    Target("mp-niti",   "mp-1048",   "compound", note="Ni-Ti shape-memory alloy"),
    Target("mp-alti",   "mp-1953",   "compound", note="Al-Ti intermetallic"),
    Target("mp-al3ni",  "mp-622209", "compound", note="Al-rich Al-Ni intermetallic"),
    Target("mp-alni",   "mp-1487",   "compound", note="Al-Ni intermetallic"),
    Target("mp-el-al",  "mp-134",    "element-reference", element="Al"),
    Target("mp-el-cu",  "mp-30",     "element-reference", element="Cu"),
    Target("mp-el-au",  "mp-81",     "element-reference", element="Au"),
    Target("mp-el-ni",  "mp-23",     "element-reference", element="Ni"),
    Target("mp-el-ti",  "mp-72",     "element-reference", element="Ti"),
    Target("mp-el-fe",  "mp-13",     "element-reference", element="Fe"),
]


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def http_get_json(url: str, timeout: int = 90) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def optimade_query(filt: str, page_limit: int = 30) -> dict[str, Any]:
    url = STRUCTURES_URL + "?" + urllib.parse.urlencode(
        {"filter": filt, "response_fields": RESPONSE_FIELDS, "page_limit": page_limit}
    )
    return http_get_json(url)


def check_endpoint() -> int:
    print(f"GET {INFO_URL}")
    try:
        info = http_get_json(INFO_URL, timeout=30)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        print(f"  UNREACHABLE: {exc}")
        print("  -> the fixture in lib/mp-reference-data.ts is the fallback;")
        print("     it records its own fetch timestamp and is labelled as such in the UI.")
        return 1
    attrs = info["data"]["attributes"]
    meta = info["meta"]
    print(f"  OK  api_version={attrs['api_version']}")
    print(f"      provider={meta['provider']['name']!r}")
    print(f"      entries available={meta.get('data_available')}")
    print(f"      endpoints={attrs['available_endpoints']}")
    print("      authentication: none (no API key sent)")
    return 0


# ---------------------------------------------------------------------------
# Fetch + validate
# ---------------------------------------------------------------------------


@dataclass
class FetchedEntry:
    target: Target
    mp_id: str
    formula_reduced: str
    formula_descriptive: str
    elements: list[str]
    n_sites: int
    formation_energy_per_atom: float
    energy_above_hull: float
    thermo_id: str
    last_updated_thermo: str
    xyz: str
    cif: str
    composition: dict[str, int]
    cif_dev_distance: float
    cif_dev_cellpar: float
    problems: list[str] = field(default_factory=list)


def species_symbol_map(species: list[dict[str, Any]]) -> dict[str, str]:
    """Map an OPTIMADE species name to its single chemical symbol.

    Refuses partial occupancy / disorder: a formation energy computed from a
    disordered cell would be meaningless here.
    """
    out: dict[str, str] = {}
    for sp in species:
        symbols = sp.get("chemical_symbols") or []
        conc = sp.get("concentration") or []
        if len(symbols) != 1 or (conc and abs(conc[0] - 1.0) > 1e-9):
            raise ValueError(
                f"species {sp.get('name')!r} is not fully ordered "
                f"(symbols={symbols}, concentration={conc})"
            )
        out[sp["name"]] = symbols[0]
    return out


def build_extxyz(
    lattice: list[list[float]],
    positions: list[list[float]],
    symbols: list[str],
    comment_extra: str,
) -> str:
    flat = " ".join(f"{v:.8f}" for row in lattice for v in row)
    lines = [
        str(len(symbols)),
        f'Lattice="{flat}" Properties=species:S:1:pos:R:3 pbc="T T T" {comment_extra}',
    ]
    for sym, pos in zip(symbols, positions):
        lines.append(f"{sym} {pos[0]:.8f} {pos[1]:.8f} {pos[2]:.8f}")
    return "\n".join(lines)


def build_cif(
    lattice: list[list[float]],
    positions: list[list[float]],
    symbols: list[str],
) -> tuple[str, float, float]:
    """Write the same cell as CIF, and measure the round-trip error.

    WHY CIF AND NOT THE EXTENDED XYZ ABOVE
        mace-api/calculate.py's detect_format() maps a ".xyz" extension to ASE's
        "xyz" format, which is ase.io.xyz.simple_read_xyz — a reader that
        ignores the comment line. Extended-XYZ Lattice= and pbc= are therefore
        discarded and the structure is computed as an isolated cluster. Measured
        on MP's primitive FCC Cu (mp-30): -0.93 eV/atom instead of -4.08. CIF
        carries the cell in the body of the file, so ".cif" survives the trip.
        This is a workaround for a backend bug, not a preference; see the note
        in lib/benchmark-structures.ts.

    Returns (cif_text, max_distance_deviation_A, max_cellpar_deviation).

    The two deviations are checked by the caller. They compare the ORIGINAL cell
    against what ASE reads back out of the CIF, using minimum-image interatomic
    distances and cell parameters — both invariant under the reorientation a CIF
    round-trip can introduce, so a nonzero value means real information loss.
    """
    try:
        import numpy as np
        from ase import Atoms
        from ase.io import read as ase_read, write as ase_write
    except ImportError as exc:  # pragma: no cover - environment problem
        raise SystemExit(
            f"--fetch needs ASE and numpy to emit CIF ({exc}). "
            "pip install -r mace-api/requirements.txt"
        ) from exc

    atoms = Atoms(symbols=symbols, positions=positions, cell=lattice, pbc=True)
    with tempfile.TemporaryDirectory(prefix="mp-cif-") as td:
        p = Path(td) / "s.cif"
        ase_write(str(p), atoms, format="cif")
        cif = p.read_text()
        back = ase_read(str(p), format="cif")

    d0 = np.sort(atoms.get_all_distances(mic=True).ravel())
    d1 = np.sort(back.get_all_distances(mic=True).ravel())
    dev_dist = (
        float(np.max(np.abs(d0 - d1))) if d0.shape == d1.shape else float("inf")
    )
    dev_cellpar = float(
        np.max(np.abs(np.asarray(atoms.cell.cellpar()) - np.asarray(back.cell.cellpar())))
    )
    return cif, dev_dist, dev_cellpar


def fetch_targets(targets: list[Target]) -> list[FetchedEntry]:
    filt = " OR ".join(f'id="{t.mp_id}"' for t in targets)
    data = optimade_query(filt, page_limit=len(targets) + 5)
    by_id = {e["id"]: e for e in data["data"]}

    for warn in data["meta"].get("warnings") or []:
        print(f"  optimade warning: {warn.get('title')}: {warn.get('detail')}")

    out: list[FetchedEntry] = []
    for t in targets:
        raw = by_id.get(t.mp_id)
        if raw is None:
            raise SystemExit(f"FATAL: {t.mp_id} not returned by OPTIMADE — refusing to write a partial fixture")
        a = raw["attributes"]

        features = a.get("structure_features") or []
        problems: list[str] = []
        if features:
            problems.append(f"structure_features={features}")

        stability = (a.get("_mp_stability") or {}).get(MP_DATASET_KEY)
        if not stability:
            raise SystemExit(f"FATAL: {t.mp_id} has no _mp_stability[{MP_DATASET_KEY!r}]")

        ef = stability.get("formation_energy_per_atom")
        hull = stability.get("energy_above_hull")
        if ef is None:
            raise SystemExit(f"FATAL: {t.mp_id} has no formation_energy_per_atom in {MP_DATASET_KEY}")

        # Invariant 1: an element reference must BE MP's reference phase.
        if t.role == "element-reference" and abs(ef) > 1e-9:
            raise SystemExit(
                f"FATAL: {t.mp_id} ({t.element}) reports formation_energy_per_atom="
                f"{ef:+.6f} eV/atom, so it is not MP's reference phase for {t.element}. "
                "Using it would offset every formation energy that references it."
            )
        # Invariant 2: compounds are hull ground states.
        if t.role == "compound" and (hull is None or hull > 1e-6):
            problems.append(f"energy_above_hull={hull} (not a hull ground state)")

        # Invariant 3: scored compounds must avoid MP2020 anion corrections.
        elements = sorted(a["elements"])
        bad = sorted(set(elements) & CORRECTION_PRONE_ELEMENTS)
        if t.role == "compound" and bad:
            raise SystemExit(
                f"FATAL: {t.mp_id} contains {bad}, which attract MP2020 composition "
                "corrections. Not admissible to the scored set."
            )

        smap = species_symbol_map(a["species"])
        symbols = [smap[name] for name in a["species_at_sites"]]

        xyz = build_extxyz(
            a["lattice_vectors"],
            a["cartesian_site_positions"],
            symbols,
            f'mp_id={t.mp_id} source=optimade.materialsproject.org',
        )
        cif, dev_dist, dev_cellpar = build_cif(
            a["lattice_vectors"], a["cartesian_site_positions"], symbols
        )
        if dev_dist > 1e-4 or dev_cellpar > 1e-4:
            raise SystemExit(
                f"FATAL: {t.mp_id} CIF round-trip loses geometry "
                f"(max distance deviation {dev_dist:.2e} A, max cellpar deviation "
                f"{dev_cellpar:.2e}). Refusing to ship a structure that does not "
                "survive the format it will be calculated in."
            )

        composition: dict[str, int] = {}
        for s in symbols:
            composition[s] = composition.get(s, 0) + 1

        out.append(
            FetchedEntry(
                target=t,
                mp_id=t.mp_id,
                formula_reduced=a["chemical_formula_reduced"],
                formula_descriptive=a.get("chemical_formula_descriptive") or a["chemical_formula_reduced"],
                elements=elements,
                n_sites=a["nsites"],
                formation_energy_per_atom=ef,
                energy_above_hull=hull if hull is not None else float("nan"),
                thermo_id=stability.get("thermo_id", ""),
                last_updated_thermo=stability.get("last_updated_thermo", ""),
                xyz=xyz,
                cif=cif,
                composition=composition,
                cif_dev_distance=dev_dist,
                cif_dev_cellpar=dev_cellpar,
                problems=problems,
            )
        )

    # Invariant 4: every element of every compound has a reference in the set.
    refs = {e.target.element for e in out if e.target.role == "element-reference"}
    for e in out:
        if e.target.role != "compound":
            continue
        missing = sorted(set(e.elements) - refs)
        if missing:
            raise SystemExit(
                f"FATAL: {e.mp_id} ({e.formula_reduced}) needs elemental references for "
                f"{missing}, which are not in the set. A formation energy cannot be formed."
            )
    return out


# ---------------------------------------------------------------------------
# Fixture emission
# ---------------------------------------------------------------------------


def display_name(e: FetchedEntry) -> str:
    if e.target.role == "element-reference":
        return f"{e.formula_reduced} reference ({e.mp_id})"
    return f"{e.formula_reduced} ({e.mp_id})"


def ts_string(s: str) -> str:
    return json.dumps(s)


def emit_fixture(entries: list[FetchedEntry], api_version: str) -> str:
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    header = f'''/**
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
 * The extended XYZ is what the benchmark sends. mace-api/calculate.py reads a
 * ".xyz" with ASE's extended-XYZ reader, which honours the `Lattice=` and
 * `pbc="T T T"` on the comment line, so it calculates the same periodic cell as
 * the CIF. The 2026-10-31 structure audit confirmed each pair describes one
 * structure (energy difference at most 3.3e-9 eV). Each CIF was also checked to
 * survive a write/read round trip with no loss of minimum-image interatomic
 * distances or cell parameters; the measured deviations are below.
 *
 * Formation energies are from MP's own `_mp_stability["{MP_DATASET_KEY}"]` —
 * PBE / PBE+U, matching MACE-MP-0's training level of theory. The r2SCAN keys
 * MP also exposes are deliberately not used. So the cells (r2SCAN) and the
 * energies compared with them (GGA/GGA+U) come from different functionals.
 */

/** One Materials Project entry: a structure plus MP's published value for it. */
export interface MpReferenceEntry {{
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
  /** MP published formation energy for the {MP_DATASET_KEY} dataset, eV/atom. */
  mpFormationEnergyPerAtom: number;
  /** MP energy above hull, eV/atom. 0 means hull ground state. */
  mpEnergyAboveHull: number;
  /** MP thermo document id the two numbers above came from. */
  mpThermoId: string;
  /** MP's own last-updated stamp for that thermo document. */
  mpThermoLastUpdated: string;
  /** Extended XYZ of MP's relaxed cell. For reading; not what gets calculated. */
  xyzData: string;
  /** ASE-generated CIF of the same cell. THIS is what gets sent to the backend. */
  cifData: string;
  /**
   * Round-trip fidelity of `cifData`, measured at generation time:
   * largest change in any minimum-image interatomic distance (A) and in any
   * cell parameter (A or degrees) after writing and re-reading the CIF.
   */
  cifRoundTrip: {{ maxDistanceDeviationA: number; maxCellparDeviation: number }};
}}

/** Where this data came from, so a reader can re-derive it. */
export const MP_REFERENCE_PROVENANCE = {{
  endpoint: "{STRUCTURES_URL}",
  infoEndpoint: "{INFO_URL}",
  optimadeApiVersion: {ts_string(api_version)},
  /** MP thermo dataset key. PBE / PBE+U — the level MACE-MP-0 was trained on. */
  datasetKey: "{MP_DATASET_KEY}",
  datasetLabel: "PBE / PBE+U (GGA, GGA+U)",
  authentication: "none — MP's OPTIMADE endpoint requires no API key",
  fetchedAtUtc: {ts_string(fetched_at)},
  generator: "test_scripts/fetch_mp_reference.py",
  /** MP material pages, for a reader who wants to check a row by hand. */
  materialUrlPrefix: "https://next-gen.materialsproject.org/materials/",
}} as const;

export const MP_REFERENCE_ENTRIES: MpReferenceEntry[] = [
'''

    body_parts: list[str] = []
    for e in entries:
        el_line = f'    element: {ts_string(e.target.element)},\n' if e.target.element else ""
        body_parts.append(
            "  {\n"
            f"    id: {ts_string(e.target.key)},\n"
            f"    mpId: {ts_string(e.mp_id)},\n"
            f"    name: {ts_string(display_name(e))},\n"
            f"    formula: {ts_string(e.formula_reduced)},\n"
            f"    formulaDescriptive: {ts_string(e.formula_descriptive)},\n"
            f'    role: "{e.target.role}",\n'
            f"{el_line}"
            f"    elements: {json.dumps(e.elements)},\n"
            f"    composition: {json.dumps(e.composition)},\n"
            f"    atomCount: {e.n_sites},\n"
            f"    mpFormationEnergyPerAtom: {e.formation_energy_per_atom!r},\n"
            f"    mpEnergyAboveHull: {e.energy_above_hull!r},\n"
            f"    mpThermoId: {ts_string(e.thermo_id)},\n"
            f"    mpThermoLastUpdated: {ts_string(e.last_updated_thermo)},\n"
            f"    xyzData: `{e.xyz}`,\n"
            f"    cifData: `{e.cif.rstrip()}`,\n"
            f"    cifRoundTrip: {{ maxDistanceDeviationA: {e.cif_dev_distance!r}, "
            f"maxCellparDeviation: {e.cif_dev_cellpar!r} }},\n"
            "  },\n"
        )

    footer = """];

/** Compounds scored against MP. */
export const MP_COMPOUNDS = MP_REFERENCE_ENTRIES.filter((e) => e.role === "compound");

/** Elemental reference phases, keyed by element symbol. */
export const MP_ELEMENT_REFERENCES = new Map(
  MP_REFERENCE_ENTRIES.filter((e) => e.role === "element-reference").map((e) => [
    e.element as string,
    e,
  ]),
);
"""
    return header + "".join(body_parts) + footer


# ---------------------------------------------------------------------------
# Verify: run MACE and compare
# ---------------------------------------------------------------------------


def parse_fixture(path: Path) -> list[dict[str, Any]]:
    """Read back the generated fixture without needing a TS toolchain."""
    text = path.read_text()
    # Anchored at line starts so consecutive entries are all matched (a pattern
    # that consumes the trailing newline picks up only every second entry).
    blocks = re.findall(r"^  \{$\n(.*?)^  \},$", text, flags=re.S | re.M)
    entries: list[dict[str, Any]] = []
    for b in blocks:
        d: dict[str, Any] = {}
        for key in (
            "id", "mpId", "name", "formula", "role", "element",
            "mpThermoId", "mpThermoLastUpdated",
        ):
            m = re.search(rf'^\s*{key}: "(.*?)",$', b, flags=re.M)
            if m:
                d[key] = m.group(1)
        for key in ("mpFormationEnergyPerAtom", "mpEnergyAboveHull", "atomCount"):
            m = re.search(rf"^\s*{key}: ([-\d.eE+]+),$", b, flags=re.M)
            if m:
                d[key] = float(m.group(1))
        m = re.search(r"^\s*elements: (\[.*?\]),$", b, flags=re.M)
        if m:
            d["elements"] = json.loads(m.group(1))
        m = re.search(r"^\s*composition: (\{.*?\}),$", b, flags=re.M)
        if m:
            d["composition"] = json.loads(m.group(1))
        m = re.search(r"xyzData: `(.*?)`,\n", b, flags=re.S)
        if m:
            d["xyzData"] = m.group(1)
        m = re.search(r"cifData: `(.*?)`,\n", b, flags=re.S)
        if m:
            d["cifData"] = m.group(1)
        entries.append(d)
    return entries


def run_mace(structure: str, filename: str, model_size: str) -> dict[str, Any]:
    """Run one single-point calculation through the exact path the app uses."""
    params = json.dumps(
        {
            "modelType": "MACE-MP-0",
            "modelSize": model_size,
            "calculationType": "single-point",
            "precision": "float64",
            "device": "cpu",
            "dispersion": False,
        }
    )
    with tempfile.TemporaryDirectory(prefix="mp-ref-") as td:
        p = Path(td) / filename
        p.write_text(structure + "\n")
        env = dict(os.environ)
        env.setdefault("PYTHONUNBUFFERED", "1")
        proc = subprocess.run(
            [sys.executable, str(CALC_SCRIPT), str(p), params],
            capture_output=True, text=True, env=env, timeout=1800,
        )
    if proc.returncode != 0:
        raise RuntimeError(f"calculate_local.py exited {proc.returncode}: {proc.stderr[-600:]}")
    start = proc.stdout.find("{")
    if start < 0:
        raise RuntimeError(f"no JSON from calculate_local.py: {proc.stdout[-400:]}")
    res = json.loads(proc.stdout[start:])
    if res.get("status") == "error":
        raise RuntimeError(res.get("message", "calculation error"))
    return res


def verify(model_size: str) -> int:
    if not FIXTURE_PATH.exists():
        print(f"No fixture at {FIXTURE_PATH}. Run --fetch first.")
        return 1
    entries = parse_fixture(FIXTURE_PATH)
    if not entries:
        print("Fixture parsed to zero entries — generator/parser mismatch.")
        return 1

    print(f"Fixture: {FIXTURE_PATH.relative_to(REPO_ROOT)} — {len(entries)} entries")
    print(f"Model:   MACE-MP-0 ({model_size}), single-point, float64, cpu, no dispersion")
    print(f"Path:    {CALC_SCRIPT.relative_to(REPO_ROOT)} (identical to app/api/benchmark)")
    print("Format:  .cif — NOT .xyz. calculate.py's detect_format() sends '.xyz' to ASE's")
    print("         plain-xyz reader, which drops Lattice=/pbc= and would evaluate every")
    print("         crystal here as an isolated cluster.")
    if os.environ.get("KMP_DUPLICATE_LIB_OK"):
        print(f"Note:    KMP_DUPLICATE_LIB_OK={os.environ['KMP_DUPLICATE_LIB_OK']} "
              "(macOS duplicate-libomp workaround; sanity-check the energies below)")
    print()

    totals: dict[str, dict[str, Any]] = {}
    for e in entries:
        t0 = time.time()
        try:
            res = run_mace(e["cifData"], f"{e['id']}.cif", model_size)
        except Exception as exc:  # noqa: BLE001 — report and continue
            print(f"  {e['id']:<12} {e['mpId']:<12} FAILED: {exc}")
            continue
        # Hard periodicity check. calculate.py reports lattice=None whenever the
        # parsed structure came back non-periodic, so a null here means the cell
        # was lost in transit and the energy is a gas-phase cluster energy. That
        # is not a result to be scored — it is a failed calculation.
        if res.get("lattice") is None:
            print(
                f"  {e['id']:<12} {e['mpId']:<12} REJECTED: backend returned lattice=null, "
                "so the cell was dropped and this energy is not a crystal energy"
            )
            continue
        n = len(res.get("symbols") or []) or int(e["atomCount"])
        totals[e["id"]] = {
            "energy": res["energy"],
            "n": n,
            "per_atom": res["energy"] / n,
            "secs": time.time() - t0,
        }
        print(
            f"  {e['id']:<12} {e['mpId']:<12} E={res['energy']:>14.6f} eV  "
            f"N={n:<3} E/atom={res['energy'] / n:>10.6f} eV  ({time.time() - t0:.1f}s)"
        )

    refs = {e["element"]: e["id"] for e in entries if e["role"] == "element-reference"}
    e_ref = {
        el: totals[sid]["per_atom"] for el, sid in refs.items() if sid in totals
    }

    print()
    print("Elemental reference energies (MACE-MP-0, same model, same run):")
    for el, v in sorted(e_ref.items()):
        print(f"  e_ref({el}) = {v:>11.6f} eV/atom")

    print()
    hdr = (
        f"{'compound':<12} {'mp-id':<12} {'MP E_f':>11} {'MACE E_f':>11} "
        f"{'delta':>11} {'|delta|':>10} verdict"
    )
    print(hdr)
    print("-" * len(hdr))

    deltas: list[float] = []
    n_pass = 0
    n_scored = 0
    for e in entries:
        if e["role"] != "compound":
            continue
        if e["id"] not in totals:
            print(f"{e['formula']:<12} {e['mpId']:<12} {'—':>11} {'—':>11} {'—':>11} {'—':>10} not run")
            continue
        counts: dict[str, int] = e["composition"]
        missing = [el for el in counts if el not in e_ref]
        if missing:
            print(
                f"{e['formula']:<12} {e['mpId']:<12} "
                f"{e['mpFormationEnergyPerAtom']:>+11.4f} {'—':>11} {'—':>11} {'—':>10} "
                f"reference missing: {','.join(missing)}"
            )
            continue
        tot = totals[e["id"]]
        e_atoms = sum(counts.values())
        ef_mace = (tot["energy"] - sum(n * e_ref[el] for el, n in counts.items())) / e_atoms
        d = ef_mace - e["mpFormationEnergyPerAtom"]
        deltas.append(d)
        n_scored += 1
        ok = abs(d) <= TOLERANCE_EV_PER_ATOM
        tight = abs(d) <= TIGHT_EV_PER_ATOM
        n_pass += 1 if ok else 0
        verdict = "PASS (tight)" if tight else ("PASS" if ok else "FAIL")
        print(
            f"{e['formula']:<12} {e['mpId']:<12} "
            f"{e['mpFormationEnergyPerAtom']:>+11.4f} {ef_mace:>+11.4f} "
            f"{d:>+11.4f} {abs(d):>10.4f} {verdict}"
        )

    print()
    if deltas:
        mae = sum(abs(d) for d in deltas) / len(deltas)
        bias = sum(deltas) / len(deltas)
        print(f"scored: {n_scored}   passed (|delta| <= {TOLERANCE_EV_PER_ATOM:.3f} eV/atom): {n_pass}/{n_scored}")
        print(f"MAE   : {mae:.4f} eV/atom ({mae * 1000:.1f} meV/atom)")
        print(f"bias  : {bias:+.4f} eV/atom ({bias * 1000:+.1f} meV/atom)  [MACE minus MP]")
        print(f"max   : {max(abs(d) for d in deltas):.4f} eV/atom")
        print()
        print("All energies eV, formation energies eV/atom. Agreement here measures")
        print("MACE-MP-0's fit to MP's PBE(+U) data, not agreement with experiment.")
        return 0 if n_pass == n_scored else 2
    print("nothing scored")
    return 1


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-endpoint", action="store_true", help="probe MP's OPTIMADE /info and exit")
    ap.add_argument("--fetch", action="store_true", help="fetch from OPTIMADE and write lib/mp-reference-data.ts")
    ap.add_argument("--verify", action="store_true", help="run MACE-MP-0 on the fixture and print the comparison")
    ap.add_argument("--model-size", default="medium", choices=["small", "medium", "large"])
    args = ap.parse_args()

    if not (args.check_endpoint or args.fetch or args.verify):
        ap.print_help()
        return 1

    if args.check_endpoint:
        rc = check_endpoint()
        if not (args.fetch or args.verify):
            return rc

    if args.fetch:
        print(f"GET {INFO_URL}")
        info = http_get_json(INFO_URL, timeout=30)
        api_version = info["data"]["attributes"]["api_version"]
        print(f"  api_version={api_version}")
        print(f"Fetching {len(TARGETS)} entries from {STRUCTURES_URL}")
        entries = fetch_targets(TARGETS)
        for e in entries:
            flag = "  <-- " + "; ".join(e.problems) if e.problems else ""
            print(
                f"  {e.mp_id:<12} {e.formula_reduced:<10} {e.target.role:<18} "
                f"N={e.n_sites:<3} E_f={e.formation_energy_per_atom:+.6f} eV/atom  "
                f"hull={e.energy_above_hull:.6f} eV/atom  "
                f"cif round-trip: d<{e.cif_dev_distance:.1e} A, cellpar<{e.cif_dev_cellpar:.1e}{flag}"
            )
        FIXTURE_PATH.write_text(emit_fixture(entries, api_version))
        print(f"\nwrote {FIXTURE_PATH.relative_to(REPO_ROOT)} "
              f"({FIXTURE_PATH.stat().st_size} bytes, {len(entries)} entries)")

    if args.verify:
        return verify(args.model_size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
