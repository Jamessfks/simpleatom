---
status: accepted
date: 2026-02-09
decision-makers: Zicheng Zhao
---

# 0013 — Keep two 3D viewers: 3Dmol.js and a pinned WEAS

## Context and problem statement

3Dmol.js (npm) gives force arrows, selection and measurement; WEAS matches the ml-peg project's rendering for upload previews.

## Decision outcome

Results use 3Dmol.js; previews default to WEAS in a sandboxed iframe. WEAS is pinned to an exact version with a Subresource Integrity hash (it used to import whatever unpkg served last), and structure data is embedded as a JSON-escaped literal so a `</script>` in a shared row cannot break out.

### Consequences

* Good, because each engine does what it is best at.
* Bad, because two rendering stacks to keep consistent.

### Confirmation

`components/calculate/weas-viewer.tsx` WEAS_URL is versioned and WEAS_SRI is set; `test/share.test.ts` rejects non-element symbols at the share boundary.

## More information

* components/calculate/molecule-viewer-3d.tsx
* components/calculate/weas-viewer.tsx
