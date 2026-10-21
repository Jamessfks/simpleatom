---
status: accepted
date: 2026-08-10
decision-makers: Zicheng Zhao
---

# 0012 — Serve embeds at /r/<id>/embed; deny framing elsewhere

## Context and problem statement

A shareable result should embed in someone else's page, but `/calculate` (which uploads files and runs jobs) must not be frameable. `X-Frame-Options` has no "any origin" value, so the exemption must avoid sending that header at all.

## Decision outcome

`next.config.ts` sends `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` on every path except exactly `/r/<id>/embed` (negative lookahead), which gets `frame-ancestors *`. Baseline headers (`nosniff`, Referrer-Policy, Permissions-Policy) apply everywhere, embed included.

### Consequences

* Good, because one read-only path is frameable; nothing with an action is.
* Bad, because the path is spelled out in three places (route, `embedPath()`, `next.config.ts`).

### Confirmation

`curl -sI /` shows `X-Frame-Options: SAMEORIGIN`; `curl -sI /r/<id>/embed` shows `frame-ancestors *` and no `X-Frame-Options`.

## More information

* next.config.ts
* lib/share.ts embedPath()
* 9187abc
