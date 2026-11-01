# Demo ethanol (D119)

The demo and hero ethanol was strained: C–C 1.478 Å, max |F| 2.04 eV/Å under MACE-OFF23
medium (2.00 eV/Å under small), and 0.296 eV above its relaxed geometry. That file now lives
at `test/fixtures/ethanol-golden.xyz`. It still carries the golden energies, docker-smoke and
the science regressions, so no golden number changed. `public/demo/ethanol.xyz` becomes the
relaxed trans conformer below.

Command, with the pinned stack:

    KMP_DUPLICATE_LIB_OK=TRUE python docs/v2/evidence/2026-11-01/demo-ethanol/relax_ethanol.py

Method: MACE-OFF23 medium, float64, CPU; BFGS to fmax 0.001 eV/Å, positions only. As it
stands, the strained file falls into the gauche conformer. With the hydroxyl H turned to
180° it relaxes to trans (anti), the conformer of CCCBDB's experimental geometry. Trans is
lower, by 1.0 meV.

| | trans (demo) | gauche | CCCBDB experimental (trans) |
|---|---|---|---|
| r(C–C) Å | 1.5116 | 1.5170 | 1.512 |
| r(C–O) Å | 1.4250 | 1.4228 | 1.431 |
| r(O–H) Å | 0.9577 | 0.9588 | 0.971 |
| ∠C–C–O ° | 107.98 | 112.67 | 107.8 |
| ∠H–O–C ° | 108.82 | 108.37 | 105.4 |
| C–C–O–H ° | 179.99 | 60.11 | 180 |
| E (eV) | −4221.6030 | −4221.6020 | — |
| max \|F\| (eV/Å) | < 0.001 | < 0.001 | — |

The CCCBDB values come from `docs/v2/validation/structure-references.json` (record
`ethanol`, retrieved 2026-10-31; source https://cccbdb.nist.gov/expgeom2x.asp?casno=64175&charge=0).
Raw numbers: `results.json`; geometry: `relaxed.xyz`.
