---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0005 — Default precision follows upstream; overrides are recorded

## Context and problem statement

The UI once pinned float32 for everything, and an internal rule claimed float64 was "required" for Hessians — a SimpleAtom convention, not an upstream rule. Upstream's actual defaults: `mace_off()` uses float64, `mace_mp()` float32, and both print "Use float64 for geometry optimization".

## Decision outcome

With no explicit precision, use the model's `upstreamDefaultDtype` from the registry, and float64 for geometry optimisation. An explicit request is honoured (upstream honours whatever it is handed) but a warning is attached when it is below the recommendation. The dtype actually running is read back off the loaded model, and torch's process-global default dtype is reset to match it (a long-lived server would otherwise leak one request's dtype into the next).

### Consequences

* Good, because results state the precision that actually ran, not the one requested.
* Bad, because an MPA-0 single-point prints upstream's float64→float32 conversion warning, because its checkpoint is stored in float64.

### Confirmation

`test_provenance.py` golden energies (MACE-OFF float64, MP-0 float32) and the `params.precision` echo.

## History

Supersedes the UI-pinned float32 default and the internal 'float64 required for Hessians' rule.

## More information

* mace-api/calculate.py upstream_default_precision()
* bars/acesuit-mace.md
* 997f95b
* 0a2eb81
