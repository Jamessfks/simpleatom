# Scientific integrity

SimpleAtom wraps [MACE](https://github.com/ACEsuit/mace). A wrapper's main risk
is not crashing — it is returning a plausible number for something that never
ran. Every rule on this page exists because that happened.

## Refuse, never fall through

| What looked fine | What it actually did | Fixed |
|---|---|---|
| `calculationType` dispatch | An unknown type ran a single-point and returned it as the requested calculation | v2.0 |
| `modelType` dispatch | `custom` with no checkpoint returned MACE-MP-0 numbers labelled custom | v2.0 |
| The validator's energy bounds | Never fired: results did not say which model produced them | v2.0 |
| `parseCIF` | Fractional coordinates never multiplied through the cell: silicon at 0.433 Å instead of 2.3516 Å | v2.0 |
| The comparison baseline | Chosen by matching the *filename* against "off" — crossing energy conventions | v2.1 (D1) |
| `mdEnsemble` | An unknown ensemble ran NVE under the requested label | v2.2 |
| `dispersion` | `bool("false")` is True, so a string "false" switched D3 on | v2.2 |
| NVT thermostat | ASE's default `Langevin(fixcm=True)` ran mixed-mass molecules ~39% hot | v2.2 (D18) |

An unsupported request fails loudly with a code and a field
([ADR-0004](../adr/0004-refuse-unsupported-requests.md)). Check it yourself — each must
return `status: "error"`:

```bash
export KMP_DUPLICATE_LIB_OK=TRUE
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"calculationType":"phonon"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"custom"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"MACE-MP"}'
python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"modelType":"MACE-MP-0","modelSize":"https://example.invalid/x.model"}'
```

## What the models are, and are not

The default materials model is **MACE-MPA-0** (upstream's own default since
v0.3.10; Matbench Discovery F1 0.852, energy MAE 0.028 eV/atom). MACE-MP-0
remains available (F1 0.669, MAE 0.057 eV/atom) so earlier results can be
reproduced. Both are trained on PBE/PBE+U DFT data and inherit PBE's differences
from experiment, which depend on the material and the property: MACE-MPA-0 relaxes
silicon to a = 5.467 Å against 5.4309 Å measured at 298 K (COD 9011998; the model value
is `docs/v2/evidence/2026-10-28/feasibility.json`). MACE-OFF23 is trained on ωB97M-D3(BJ)
DFT (SPICE) for organic molecules and is licensed for non-commercial use only.
None of them is "quantum-accurate", and SimpleAtom does not claim they are.

Energies from different models live on different reference conventions
(−1 to −15 eV/atom for the MP family; for MACE-OFF, E/N depends on the elements present, so
it is judged relative to the model's own isolated atoms, typically −6 to −0.5 eV/atom). Never compare
totals across models; the [contract reference](../reference/contract.md#energy-conventions)
lists the bands the validator applies.

## Reproducibility

Every result carries a manifest: the SHA-256 of the checkpoint actually loaded,
library versions, the structure hash, device and precision, the git commit,
and for MD the seed ([ADR-0009](../adr/0009-reproducibility-manifest.md)). MD
is seeded from one generator (default 42) and the seed is in the result message,
which survives sharing and PDF export ([ADR-0007](../adr/0007-reproducible-honest-md.md)).

## What SimpleAtom deliberately cannot do

MACE is an interatomic potential with no electron density, so orbitals, partial
charges, Fukui indices, pKa and NMR shifts are absent rather than approximated.
`phonon` is refused, not stubbed. There is no cell relaxation yet
([ADR-0018](../adr/0018-scope-mace-only.md)).
