---
status: accepted
date: 2026-08-10
decision-makers: Zicheng Zhao
---

# 0015 — One chrome width site-wide

## Context and problem statement

The logo sat at three different x positions across routes because each page chose its own container width.

## Decision outcome

The header and footer use one width (`CHROME_WIDTH_CLASS`, max-w-7xl with px-6) on every route; page bodies may be narrower or wider underneath.

### Consequences

* Good, because navigation never jumps between pages (a blind comparison against Rowan was won on this).
* Bad: none recorded.

### Confirmation

Visual check in `verify-ui`: the wordmark's x position is identical on /, /calculate, /benchmark, /docs.

## History

Supersedes per-route chrome widths.

## More information

* components/site-header.tsx
* 97e8bb5
* 0eb8626
