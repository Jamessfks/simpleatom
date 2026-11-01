# Sandbox spend ledger (rebuilt 2026-11-01T03:26Z after the Mac reboot wiped /private/tmp)

Rates (iad1, Pro list prices, https://vercel.com/docs/sandbox/pricing): Active CPU $0.128/vCPU-h;
Provisioned memory $0.0212/GB-h (2 GB per vCPU, 1-minute minimum increments); Creations $0.60/1M;
Snapshot storage $0.08/GB-month. Upper bound (UB) = every provisioned vCPU 100% busy for the whole
wall time. Pro usage draws first on the $20/month credit. Plan <= $3; hard stop if spent-UB +
worst-case + next projection would exceed $4.

## Inventory of everything created before the interruption (from my transcript)
| Resource | Created (UTC) | Config | Timeout | How it ended |
|---|---|---|---|---|
| sandbox `sa-bench-2v` | 2026-10-31T15:21:31Z | 2 vCPU / 4 GB, image vercel/sandbox/python:3.14, --non-persistent, iad1 | 20 min | stopped by `sandbox snapshot --stop` at 15:24:28Z (verified `stopped`); 178 s wall |
| snapshot `snap_sD5O9JWV5RsxG9IalHlPTWWPXmBK` | 2026-10-31T15:24:28Z | 607 MB, iad1 | expiry 24 h after last use | still `created` at 03:26Z; deleted in cleanup below |
| sandbox `sa-bench-4v` | 2026-10-31T15:24:43Z | 4 vCPU / 8 GB, from the snapshot, --non-persistent | 10 min | stopped by me at 15:26:29Z (CLI: duration 103.99 s, active CPU 286.923 s) |
| sandbox `sa-bench-8v` | 2026-10-31T15:26:39Z | 8 vCPU / 16 GB, from the snapshot, --non-persistent | 10 min | NOT stopped by me (interrupted right after creation). Found `stopped` at 03:26Z; CLI active CPU 329.161 s; `sandbox sessions list` returns no rows, so its duration cannot be read -> worst case = full 10-min timeout |

State check 2026-11-01T03:26Z (`sandbox list --all`, `sandbox snapshots list`): 0 running sandboxes;
3 stopped (above); 1 snapshot (above). Nothing else exists in project `mace`.

## Ledger
| # | Item | vCPU | GB | Billed min | CPU UB $ | Mem $ | Other $ | Row UB $ | Cum. UB $ | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | pre-check 2026-10-31T15:18Z: no sandboxes, no snapshots | - | - | 0 | 0 | 0 | 0 | 0.0000 | 0.0000 | |
| 1 | sa-bench-2v (setup + bench + snapshot/stop) | 2 | 4 | 3 | 0.0128 | 0.0042 | 0.0000006 | 0.0170 | 0.0170 | actual CPU 216.5 s = $0.0077 |
| 2 | snapshot 607 MB, ~12 h | - | 0.607 | - | - | - | 0.0486 | 0.0486 | 0.0656 | full-month UB; 1-day prorate = $0.0016 |
| 3 | sa-bench-4v (bench + stop) | 4 | 8 | 2 | 0.0171 | 0.0057 | 0.0000006 | 0.0227 | 0.0883 | actual CPU 286.9 s = $0.0102 |
| 4 | sa-bench-8v (unaccounted -> full timeout) | 8 | 16 | 10 | 0.1707 | 0.0565 | 0.0000006 | 0.2272 | 0.3155 | actual CPU 329.2 s = $0.0117 |

Spent + worst case so far: **$0.3155** (UB). Actual CPU so far: $0.0296.

Lost in the wipe: the 2v/4v result JSON files (only their process wall times survive in my
transcript: 2v 101.18 s, 4v 84.83 s) and the local baseline JSON. All three sandbox configs are re-run below.

Cleanup 2026-11-01T03:26:49Z: `sandbox snapshots delete snap_sD5O9JWV5RsxG9IalHlPTWWPXmBK` (now `deleted`);
`sandbox remove sa-bench-2v sa-bench-4v sa-bench-8v`. `sandbox list --all` now empty.

## Resume plan (fresh install per sandbox; no snapshot, so nothing billed lingers if interrupted again)
Install is cheap (~11 s for the lock with uv, ~3 s for checkpoints), so the snapshot saved little.
| Run | Config | Timeout | Projection UB $ | Cum. UB if it runs $ |
|---|---|---|---|---|
| R1 | 2 vCPU / 4 GB | 10 min | 0.0568 | 0.3723 |
| R2 | 4 vCPU / 8 GB | 10 min | 0.1136 | 0.4859 |
| R3 | 8 vCPU / 16 GB | 10 min | 0.2272 | 0.7131 |

## Resumed runs (actuals)
| # | Item | vCPU | GB | Billed min | CPU UB $ | Mem $ | Other $ | Row UB $ | Cum. UB $ | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | R1 sa-bench2-2v 03:28:55-03:30:11Z (76 s): install+ckpt OK, bench killed when the CLI exec stream died ("Error: terminated"); trap stopped it; no result | 2 | 4 | 2 | 0.0085 | 0.0028 | 0.0000006 | 0.0114 | 0.3269 | actual CPU 125.8 s = $0.0045 |
| 6 | R1b sa-bench2-2vb 03:30:55-03:32:44Z (109 s), detached run + polling, OK | 2 | 4 | 2 | 0.0085 | 0.0028 | 0.0000006 | 0.0114 | 0.3383 | actual CPU 174.2 s = $0.0062 |
| 7 | R2 sa-bench2-4vb 03:32:51-03:34:08Z (77 s), OK | 4 | 8 | 2 | 0.0171 | 0.0057 | 0.0000006 | 0.0227 | 0.3610 | actual CPU 207.8 s = $0.0074 |
| 8 | R3 sa-bench2-8vb 03:34:13-03:35:48Z (95 s), OK | 8 | 16 | 2 | 0.0341 | 0.0113 | 0.0000006 | 0.0454 | 0.4064 | actual CPU 455.4 s = $0.0162 |

## Totals (2026-11-01T03:38Z)
- Ledger upper bound (100% CPU, billed minutes, sa-bench-8v at full 10-min timeout, snapshot at a full month): **$0.4064**
- Estimate from CLI-reported active CPU (1795.8 s total = $0.0639) + billed memory (252 GB-min = $0.0890,
  still assuming the 10-min worst case for sa-bench-8v) + snapshot 1-day prorate ($0.0016): **~$0.155**
- Vercel's own meter (`vercel usage`, accrued through Nov 1, lagging; shows only the 3 Oct-31 creations):
  Sandbox Active CPU 0.23 h $0.03, Provisioned Memory 1.02 GB-h $0.02, Snapshot Storage 0.64 GB <$0.01,
  Creations 3 <$0.01. 1.02 GB-h implies sa-bench-8v actually ran ~2 min, not 10, so the worst case above overstates it.
- All of it draws on the Pro $20/month credit (credit used $0.21 of $20.00 this cycle, all products).
- Spend Management (read-only `vercel budgets list` / `inspect`): team budget $200, status active, pause = no;
  current on-demand spend $0.00 (0%).

## Cleanup
- 03:26:49Z: snapshot snap_sD5O9JWV5RsxG9IalHlPTWWPXmBK deleted; sa-bench-2v/4v/8v removed.
- 03:37:54Z: sa-bench2-2v, -2vb, -4vb, -8vb (all already stopped) removed. `sandbox list --all` empty;
  only snapshot listed is the deleted one. `.env.sandbox` deleted. `.vercel/` link metadata kept.
