# MACE on Vercel Sandbox: timing results

Run 2026-11-01 03:30-03:36Z (iad1, Pro team, project `mace`). Results JSON/logs in `results/`, spend in
`ledger.md`, doc findings in `DOCS.md`. Benchmark script `bench/bench.py`, in-sandbox script `bench/remote.sh`.

## Setup actually used
- Image `vercel/sandbox/python@sha256:ef4f11ed399b...` (`vercel/sandbox/python:3.14`), `--non-persistent`, timeout 10 min,
  one fresh sandbox per config (no snapshot: install is only 5.5-7.2 s, so a snapshot saved little and left a billed artifact).
- Python: CPython 3.11.18 fetched by `uv python install 3.11` (uv 0.13.6; the image's own python is 3.14.4).
- Packages: the repo's hashed lock `mace-api/requirements.lock.txt` installed with
  `uv pip install --require-hashes --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match`
  (81 packages; freeze identical in all three sandboxes): **torch==2.10.0+cpu** (MKL 2024.2, OpenMP), **mace-torch==0.3.16**,
  **ase==3.27.0**, **e3nn==0.4.4**, **numpy==2.4.2**, scipy==1.17.1, torch-dftd==0.5.3, matscipy==1.3.1, rdkit==2026.3.1.
- Checkpoints from upstream URLs, SHA-256 verified against contract.json before use (both OK in every sandbox):
  MACE-OFF23_medium.model 4842c52a... (18,350,596 B), mace-mpa-0-medium.model 75428afe... (79,462,305 B).
- Threads: `torch.set_num_threads(N)` with N = vCPUs; OMP_NUM_THREADS = MKL_NUM_THREADS = N.

## Sandbox CPU (lscpu)
- x86_64, KVM guest, kernel 6.18.56. This run: "Intel(R) Xeon(R) Processor @ 2.90GHz", AVX-512 incl. VNNI/VBMI/IFMA
  (Ice Lake-class by its flags), L3 54 MiB. The 2026-10-31 run landed on "Intel(R) Xeon(R) Processor @ 2.50GHz",
  family 6 model 85 stepping 7 (Cascade Lake-class), AVX-512 VNNI.
- **Thread(s) per core: 2.** N vCPUs = N/2 physical cores with hyperthreading (2 vCPU = 1 core, 4 = 2 cores, 8 = 4 cores).

## Results (median of 3 for a-c; wall = model load + compute; cost UB = wall x (N x $0.128 + 2N x $0.0212)/3600)
| Config | Task | Wall s (load+compute) | Compute s | Load s | Threads | Cost UB $ |
|---|---|---|---|---|---|---|
| Sandbox 2 vCPU / 4 GB | (a) ethanol SP, OFF-med f64 | 0.344 | 0.239 (runs 0.239, 0.357, 0.140) | 0.104 | 2 | 0.00003 |
| Sandbox 2 vCPU / 4 GB | (b) Si8 SP, MPA-0-med f64 | 0.286 | 0.178 (runs 0.178, 0.180, 0.148) | 0.108 | 2 | 0.00003 |
| Sandbox 2 vCPU / 4 GB | (c) Si64 SP, MPA-0-med f64 | 1.022 | 1.022 (runs 1.144, 1.022, 0.804) | 0.000 (reused) | 2 | 0.00010 |
| Sandbox 2 vCPU / 4 GB | (d) ethanol NVT 1000 steps, f32; 62.9 ms/step | 62.974 | 62.880 | 0.094 | 2 | 0.00596 |
| Sandbox 2 vCPU / 4 GB | (e) ethanol BFGS fmax 0.01, f64; 64 steps, converged=True | 8.849 | 8.849 | 0.000 (reused) | 2 | 0.00084 |
| Sandbox 2 vCPU / 4 GB | python import torch+mace (cold process) | 10.38 | - | - | 2 | - |
| Sandbox 4 vCPU / 8 GB | (a) ethanol SP, OFF-med f64 | 0.297 | 0.204 (runs 0.204, 0.303, 0.119) | 0.093 | 4 | 0.00006 |
| Sandbox 4 vCPU / 8 GB | (b) Si8 SP, MPA-0-med f64 | 0.220 | 0.117 (runs 0.117, 0.118, 0.088) | 0.102 | 4 | 0.00004 |
| Sandbox 4 vCPU / 8 GB | (c) Si64 SP, MPA-0-med f64 | 0.515 | 0.515 (runs 0.579, 0.515, 0.496) | 0.000 (reused) | 4 | 0.00010 |
| Sandbox 4 vCPU / 8 GB | (d) ethanol NVT 1000 steps, f32; 37.1 ms/step | 37.162 | 37.077 | 0.084 | 4 | 0.00704 |
| Sandbox 4 vCPU / 8 GB | (e) ethanol BFGS fmax 0.01, f64; 64 steps, converged=True | 7.553 | 7.553 | 0.000 (reused) | 4 | 0.00143 |
| Sandbox 4 vCPU / 8 GB | python import torch+mace (cold process) | 9.67 | - | - | 4 | - |
| Sandbox 8 vCPU / 16 GB | (a) ethanol SP, OFF-med f64 | 0.397 | 0.263 (runs 0.263, 0.643, 0.128) | 0.134 | 8 | 0.00015 |
| Sandbox 8 vCPU / 16 GB | (b) Si8 SP, MPA-0-med f64 | 0.330 | 0.158 (runs 0.158, 0.177, 0.121) | 0.172 | 8 | 0.00012 |
| Sandbox 8 vCPU / 16 GB | (c) Si64 SP, MPA-0-med f64 | 0.492 | 0.492 (runs 0.542, 0.483, 0.492) | 0.000 (reused) | 8 | 0.00019 |
| Sandbox 8 vCPU / 16 GB | (d) ethanol NVT 1000 steps, f32; 43.8 ms/step | 43.987 | 43.834 | 0.153 | 8 | 0.01666 |
| Sandbox 8 vCPU / 16 GB | (e) ethanol BFGS fmax 0.01, f64; 64 steps, converged=True | 8.578 | 8.578 | 0.000 (reused) | 8 | 0.00325 |
| Sandbox 8 vCPU / 16 GB | python import torch+mace (cold process) | 16.69 | - | - | 8 | - |
| Local M4 Pro (2 threads) | (a) ethanol SP, OFF-med f64 | 0.157 | 0.114 (runs 0.114, 0.195, 0.079) | 0.043 | 2 | - |
| Local M4 Pro (2 threads) | (b) Si8 SP, MPA-0-med f64 | 0.137 | 0.087 (runs 0.087, 0.092, 0.070) | 0.049 | 2 | - |
| Local M4 Pro (2 threads) | (c) Si64 SP, MPA-0-med f64 | 0.384 | 0.384 (runs 0.459, 0.375, 0.384) | 0.000 (reused) | 2 | - |
| Local M4 Pro (2 threads) | (d) ethanol NVT 1000 steps, f32; 25.7 ms/step | 25.702 | 25.667 | 0.034 | 2 | - |
| Local M4 Pro (2 threads) | (e) ethanol BFGS fmax 0.01, f64; 64 steps, converged=True | 2.414 | 2.414 | 0.000 (reused) | 2 | - |
| Local M4 Pro (2 threads) | python import torch+mace (cold process) | 1.71 | - | - | 2 | - |

Whole-run figures per sandbox: install 6.0 / 5.5 / 7.2 s; checkpoint download+verify 0.7 / 0.6 / 1.1 s;
benchmark process wall 87.8 / 58.2 / 73.7 s; sandbox lifetime create-to-stop 109 / 77 / 95 s (2 / 4 / 8 vCPU).
Billed per run (UB, 2-min minimum used): $0.0114 / $0.0227 / $0.0454; CLI-reported active CPU 174 / 208 / 455 s.

Local baseline: Apple M4 Pro (`hw.model` Mac16,8, 12 cores = 8P + 4E, 24 GB), macOS arm64, Python 3.11.15,
torch 2.10.0 (no MKL-DNN), same mace-torch/ase/e3nn/numpy, checkpoints from ~/.cache/mace (both SHA-256 match the pins).
The table shows the second local run (load average ~5.6 from background processes). The first local run that night
(load ~5.5) was slower: (d) 37.8 s, (e) 3.55 s, (c) 0.498 s. A quiet run on 2026-10-31 gave (a) 0.188, (b) 0.098,
(c) 0.417, (d) 24.3, (e) 2.58 s.

Physics check (identical on every platform): ethanol E = -4221.3059 eV (MACE-OFF convention, -469.0 eV/atom);
Si8 -43.2991 eV and Si64 -346.3925 eV (-5.4124 eV/atom, MP convention); BFGS 64 steps, converged, final fmax 0.0075 eV/A;
NVT 1000 steps, finite, final T 339.0 K (single-snapshot, 9 atoms).

## Spend
- Ledger upper bound (incl. the 8-vCPU sandbox interrupted on 2026-10-31 counted at its full 10-min timeout and the
  snapshot at a full month): **$0.41**. Estimate from metered CPU: **~$0.16**. Vercel's own meter so far (lagging):
  $0.05 for the Oct-31 runs. All within the Pro $20/month credit; on-demand spend $0.00.
- Spend Management is enabled (read-only `vercel budgets`): $200 team budget, active, pause-on-limit = no.

## Caveats
1. Hosts vary. Two runs a day apart landed on different Xeon generations (2.5 vs 2.9 GHz). The 2026-10-31 run gave
   benchmark process walls of 101.2 s (2 vCPU) and 84.8 s (4 vCPU), against 87.8 and 58.2 s here: 15-46% slower.
   Its per-task JSON was lost in the /private/tmp wipe, so only these totals survive.
2. vCPUs are hyperthreads. Scaling is poor for these tiny systems: 2 to 4 vCPU speeds MD 1.7x and Si64 2.0x, but
   4 to 8 vCPU is SLOWER for MD (43.8 vs 37.1 s) and no faster for Si64/BFGS. Small-molecule work wants 2-4 threads.
3. Median of 3 includes the first (cold) call. Run 1 of (a) is a warm-up outlier in some sandboxes. Per-run values are listed.
4. Model "load" here is `mace_off/mace_mp(model=<local path>)` from local disk: ~0.1 s. The real cold-start cost is
   importing torch+mace in a fresh process (9.7-16.7 s in the sandbox vs 1.7 s on the Mac), plus install (~6 s)
   and checkpoint download (~1 s) when there is no snapshot or custom image.
5. Float64 BFGS is 3.1-3.7x slower in the sandbox than on the M4 Pro, MD 1.4-2.4x slower, and single-points 1.3-2.7x slower (all still under 1.1 s).
6. Cost-per-task is an upper bound (100% CPU on every vCPU). Real active CPU was lower: 2 vCPU ran ~174 s CPU over a
   109 s life. Memory is billed per minute no matter what.
7. The first 2-vCPU attempt on 2026-11-01 (sa-bench2-2v) died when the CLI's `exec` stream dropped ("Error: terminated")
   during a quiet ~50 s phase, and its result was lost (it cost $0.0114 UB). The rerun starts the job detached
   (`setsid nohup`) and polls with short execs (`bin/run_one.sh`).
8. The Vercel CLI auto-updated its "official Vercel Claude plugin" during `vercel project ls` (CLI side effect, not requested).
