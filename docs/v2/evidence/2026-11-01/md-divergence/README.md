# MD divergence at long timesteps (D130)

At which step does SimpleAtom's `md_diverged` check stop an MD run on a relaxed
molecule? Everything runs through the engine (`calculate.run_calculation`) on the
pinned stack: MACE-OFF small, float64, seed 42, NVT at 300 K with the contract's
default friction, 1000 steps, profile `local`.

```
KMP_DUPLICATE_LIB_OK=TRUE python docs/v2/evidence/2026-11-01/md-divergence/run_divergence.py
```

Run on 2026-11-01 with Python 3.11.15, torch 2.10.0, mace-torch 0.3.16 and ASE 3.27.0
on macOS arm64 (8 torch threads). It took 184 s of CPU, about 2.5 minutes of wall time.
Every run, including the ones that stay bound, is the full 1000 steps. Full
output is in `results.json`.

**Inputs.** Ethanol is the strained demo file (max |F| 2.04 eV/Å, D119), kept
byte for byte as `test/fixtures/ethanol-golden.xyz`. Water is `public/demo/water.xyz`.
The script relaxes both with SimpleAtom's geometry-opt (BFGS, fmax 0.005 eV/Å, float64).
Ethanol converged in 66 steps (final max |F| 0.0050 eV/Å) and water in 4 (0.0007 eV/Å).

**The limit.** In NVT, `md_diverged` fires when the kinetic temperature exceeds
max(10 × target, 5000 K), which is 5000 K here. In NVE it also fires when the total
energy has moved more than 0.1 eV/atom.

## Relaxed molecules, NVT 300 K

| timestep | ethanol: stopped at step | water: stopped at step |
|---|---|---|
| 1.5 fs | none (max T 582 K) | none (max T 627 K) |
| 2.0 fs | 587 | 902 (T first above 3000 K at step 894) |
| 2.5 fs | 75 | 35 |
| 3.0 fs | 7 | 6 |
| 4.0 fs | 3 | 3 |

These match the numbers in the D130 fix commit (c560533) step for step.

## Controls: no false triggers

| structure | run | outcome |
|---|---|---|
| relaxed ethanol | NVT 0.5 fs | completed, max T 581 K |
| relaxed ethanol | NVT 1.0 fs | completed, max T 546 K |
| relaxed ethanol | NVE 1.0 fs | completed, max T 191 K |
| relaxed water | NVT 0.5 fs | completed, max T 660 K |
| relaxed water | NVT 1.0 fs | completed, max T 739 K |
| relaxed water | NVE 1.0 fs | completed, max T 275 K |
| strained demo ethanol | NVT 1.0 fs | completed, max T 474 K |
| strained demo ethanol | NVT 2.0 fs | **stopped at step 218** (62,221 K at that step; it was at most 2214 K before) |

The strained demo at 2.0 fs is the reviewer's original case: "T > 3000 K at step 218".
It jumps from below 2214 K to 62,221 K in one step, so the 5000 K limit fires on the
same step. The two relaxed molecules diverge later at 2.0 fs than the strained file does.

## Caveats

- MD is chaotic. The late divergence steps (587 and 902) depend on round-off and may
  move on another CPU, BLAS or thread count. The early ones (3–75) will not move much.
  What carries over is the pattern: everything at 1.5 fs or less stays bound for
  1000 steps, and every run at 2.0 fs or more comes apart within them.
- These are two small molecules with one model at 300 K. They do not show that
  1.5 fs is safe for every system.
