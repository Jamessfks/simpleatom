---
status: accepted
date: 2026-08-10
decision-makers: Zicheng Zhao
---

# 0009 — Attach a reproducibility manifest; never fabricate

## Context and problem statement

"MACE-OFF small" is a download URL, not a fixed set of weights. A result needs the identity of the bytes that were actually loaded, the library versions and the code version — and a field that could not be measured must say so rather than be guessed.

## Decision outcome

`mace-api/provenance.py` builds `result.provenance`: the SHA-256 of the checkpoint `torch.load` actually opened (observed, not re-derived), package versions, input file and structure hashes, device, precision, seed, and the git commit (pinned into the image at deploy time). Anything unknowable is `null` with a reason.

### Consequences

* Good, because A digest is a reproducible identifier; a model name is not.
* Bad, because manifest fields must stay nullable everywhere they are read.

### Confirmation

`python3 -m unittest discover -s test_scripts -p test_provenance.py` — at least 40 tests, counted by the daily gate.

## More information

* mace-api/provenance.py
* 1ed8177
* bdfb7af
* 9187abc
