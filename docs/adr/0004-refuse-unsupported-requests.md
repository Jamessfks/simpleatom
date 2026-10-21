---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0004 — Refuse unsupported requests instead of falling through

## Context and problem statement

Six defects returned plausible numbers for runs that never happened: an unknown `calculationType` ran a single-point, `custom` without a checkpoint returned MACE-MP-0 numbers labelled custom, an unknown `mdEnsemble` ran NVE under the requested label, `bool("false")` switched D3 on, and an unvalidated `modelSize` was handed to upstream, which treats unknown strings as a URL or path to download and unpickle. Those numbers were shareable and exportable.

## Decision outcome

Every enumerated input is an allow-list from `contract.json` — calculation type, model id and size, precision, device, ensemble — and every number must be finite and in range. Anything else raises `ContractError` with a code, a field and an HTTP status, before any I/O. There is no default branch that computes something else.

### Consequences

* Good, because an unsupported request is visible as an error; a fabricated result is not visible at all.
* Bad, because callers that relied on lenient parsing (e.g. `dispersion: "yes"`) now get a 400.

### Confirmation

The refusal guards: `python3 mace-api/calculate_local.py public/demo/ethanol.xyz '{"calculationType":"phonon"}'` (and the custom/bad-model/URL-size/NPH cases in `TestCliGuards`) must all return `status: "error"` with a 4xx.

## More information

* mace-api/contract.py
* mace-api/calculate.py validate_request()
* c27e0c9
* 997f95b
