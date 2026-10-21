## What and why

<!-- What changes, and which defect, audit finding or ADR it relates to. -->

## Verified by execution

<!-- Commands you ran and what they printed. "Looks right" is not verification. -->

- [ ] `npm run check:contract && npm run typecheck && npm test && npm run build`
- [ ] Lint not above the baseline (`node scripts/lint-baseline.mjs`)
- [ ] Backend changes: `validate_calculation.py --test` passes; contract / provenance / science suites pass
- [ ] New or changed accepted input: `contract.json` + `npm run gen:contract` + a fixture case
- [ ] UI changes: checked at 1440 and 375 px, keyboard focus visible, no console errors
- [ ] A recorded decision changed → ADR added or amended
- [ ] User-visible change → CHANGELOG entry
