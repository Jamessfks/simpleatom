---
status: accepted
date: 2026-08-09
decision-makers: Zicheng Zhao
---

# 0003 — The Python backend is the security boundary

## Context and problem statement

The hosted API is a public URL; anything the browser can send, anyone can send directly. Checks that live only in the UI or in the Next.js route protect nothing.

## Decision outcome

Every rule that protects correctness or the server is enforced in Python (`mace-api/contract.py`, `calculate.validate_request()`, `safe_load.py`). The TypeScript checks (`lib/contract.ts`) are a fast, friendly mirror so a bad request fails before an upload — never a substitute. With `MACE_API_TOKEN` set, the backend additionally refuses callers that are not the Vercel proxy.

### Consequences

* Good, because A direct caller gets exactly the same refusals as the UI.
* Bad, because rules exist twice; drift is caught by shared fixtures (ADR-0022), not by construction.

### Confirmation

`test/fixtures/contract-requests.json` is checked against both implementations (`test_backend_contract.py::TestSharedFixtures`, `test/contract.test.ts`).

## More information

* mace-api/contract.py
* lib/contract.ts
* c27e0c9
