---
status: accepted
date: 2026-08-10
decision-makers: Zicheng Zhao
---

# 0010 — Run the validator on every result, advisory only

## Context and problem statement

The validator's checks are plausibility heuristics with legitimate counterexamples (a strained geometry is a normal thing to ask MACE about). Throwing away a completed calculation because a heuristic disliked it would be worse than reporting it with a warning. The checks that must block already run before any model loads (ADR-0004).

## Decision outcome

`attach_validation()` runs `validate_calculation.py` on every result and attaches its findings as `result.validation`; it never rejects. If the validator is missing or throws, status is `unavailable` with the reason. Energy bounds come from the model registry's convention for the model that ran; a custom checkpoint (unknown convention) skips the range check rather than being judged against MP bounds.

### Consequences

* Good, because users see a second opinion without losing results.
* Bad, because heuristic warnings can be ignored.

### Confirmation

`python3 test_scripts/validate_calculation.py --test` → `all_passed: true`; CI `docker-smoke` asserts `validation.status == "ran"` in the deployed image (D2).

## More information

* mace-api/calculate.py attach_validation()
* test_scripts/validate_calculation.py
