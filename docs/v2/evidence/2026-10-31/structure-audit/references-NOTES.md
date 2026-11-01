# Methods notes: structure-references.json

Retrieved 2026-10-31. Only anonymous public GET requests were made: curl with its default User-Agent, plus Tavily search for discovery. WebFetch was loaded but not needed. No personal data was sent. Raw responses are in `raw/` and scripts in `scripts/`. Analysis used `<pinned venv311>/bin/python -I` (spglib 2.8.0, ASE 3.27.0, RDKit 2026.03.1).

The first pass was written to the session scratchpad. That directory was wiped mid-task, so every source was re-fetched into this directory. Values come only from the second fetch.

## Sources that worked
- **MP OPTIMADE**: `https://optimade.materialsproject.org/v1/structures/<id>` for all 13 fixture ids, plus mp-998 and mp-46, `/v1/info`, `/v1/info/structures`, and filter queries for all Ti and all Al2Cu entries. The served `space_group_*` fields are null, so space groups were derived with spglib. The only MP-specific fields are `_mp_chemical_system` and `_mp_stability` (with `gga_gga+u`, `gga_gga+u_r2scan` and `r2scan` keys).
- **MP provenance (H1)**:
  - emmet source on GitHub main: the OPTIMADE builder takes `mat_doc["structure"]` (`emmet-builders-legacy/.../materials/optimade.py`).
  - The MaterialsDoc structure is ranked by `VASP_STRUCTURE_QUALITY_SCORES = {"r2SCAN": 5, "SCAN": 4, "GGA+U": 3, "GGA": 2, "PBEsol": 1}`.
  - MP docs (`.md` versions): database-versions, r2scan-calculations, querying-data.
- **GGA-era MP cells**: Wayback Machine snapshots (2021-03 to 2022-06, all before the r2SCAN integration in v2022.10.28) of the legacy `materialsproject.org/materials/<id>/` pages. Each page shows "Run Type GGA". Atom coordinates come from the embedded `material-viz-data` scene JSON:
  - mp-30, mp-23, mp-1487 and mp-2658 for H1;
  - mp-72, mp-46, mp-998 and mp-985806 for tags, ICSD IDs and E_hull.
- **COD**: CIFs 9011998 and 9011997 (Hom 1975, 298.15 K), 9008565, 9008564, 9013014 (Suh 1988, 293 K), 9008468, 5000216, 9012043, 9003308 (Walker 2004, 298.15 K), 9008536 (298 K), 9006587 (298 K) and 9013463. The COD JSON search (`/cod/result?...&format=json`) worked for Si, Cu, NaCl, Fe and the Hom-1975 text search.
- **PubChem PUG-REST**: name lookups, a CID batch, and structure lookups of each app SMILES (`/compound/smiles/<urlencoded>/property/...`). PubChem no longer returns `IsomericSMILES`; the isomeric SMILES comes back under `SMILES`, and the canonical form under `ConnectivitySMILES`.
- **NIST CCCBDB**: `expgeom2x.asp?casno=<CAS>&charge=0` for water, methane, ethanol and benzene. Values are quoted verbatim in the JSON.
- **S22**: BEGDB molecule pages id=82 (water dimer) and id=89 (methane dimer) carry the xyz, the optimisation level and the dataset reference. psi4's `S22.py` has identical coordinates and the S22 index. Crossref confirms the Jurečka/Šponer/Černý/Hobza PCCP 8, 1985 (2006) metadata.
- **Cohesive energies**: the KnowledgeDoor Elements Handbook cohesive-energy table, which cites Kittel 8th ed. (2005), and the Farid & Godby PRB 43, 14248 abstract on journals.aps.org (Crossref for metadata).
- **NaCl thermochemistry**: NIST-JANAF tables Cl-053 (NaCl cr), Na-005 (Na g) and Cl-001 (Cl g), and the NIST WebBook NaCl condensed-phase page. CODATA Faraday constant from physics.nist.gov.

## Sources that failed or were missing
- The COD search API timed out for formula=C, for `Al2 Cu` and `Ti` (both retried), and for COD's OPTIMADE. The diamond entry was found through the Hom-1975 text search instead. Experimental identities for theta-Al2Cu and omega-Ti come from MP's own archived tags and ICSD IDs, not from COD.
- No authorised, fetchable copy of Kittel's lattice-constant tables was found, so the app's attribution of lattice constants to Kittel is UNVERIFIED. The values were checked against COD instead (all within 0.12%; Fe 2.870 vs 2.8665 is the largest gap).
  - Unverified lead, not used as data: a search-result snippet from an unofficial textbook copy suggests Kittel quotes Si as 5.430, not 5.431.
- NaCl −6.68 eV per formula unit: no fetched source states it. JANAF gives 6.611 eV/f.u. at 0 K and 6.630 eV/f.u. at 298.15 K, relative to free neutral atoms (3.31 eV/atom). The claimed CRC source was not reachable. A zero-point correction could plausibly explain the gap, but no source documents it.
- KnowledgeDoor's lattice-constants page returned 404.
- CCCBDB has no aspirin geometry: CAS 50782 returned "Molecule problem. Defaulted to H 2 CO".
- The CCCBDB ethanol and benzene entries do not state the geometry type (re/r0/rs).
- The MP API needs a key, so no r2SCAN-relaxed cell was fetched directly. GGA cells were taken only for the 4 ids requested, plus mp-985806.

## Derived quantities (formula in each field)
- Nearest-neighbour distance: diamond a√3/4, fcc a/√2, rocksalt a/2, bcc a√3/2.
- (111) spacing: a/√3.
- Diamond (111) bilayer: a√3/12 within a bilayer and a√3/4 between bilayers.
- Coordination numbers and Wyckoff letters: ASE neighbour list and spglib on the CIF.
- MP served-vs-GGA %: (served conventional a / archived GGA a − 1) × 100.
