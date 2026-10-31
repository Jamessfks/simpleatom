# Security

## Reporting a vulnerability

Email **zhao.zic@northeastern.edu** with a description and, if you can, a
reproduction. Please do not open a public issue for an unfixed vulnerability.
You will get an acknowledgement within a week.

## Trust model

- **Anonymous use.** There are no accounts. Anyone can submit calculations to
  the public instance; it is protected by the request contract
  ([`mace-api/contract.json`](mace-api/contract.json): bounded parameters,
  atom/step/upload caps, a time budget), one calculation at a time, and
  per-visitor limits. Set `MACE_API_TOKEN` on both Vercel and the Space so the
  backend accepts compute requests only from the front end.
- **Model files execute code.** A MACE `.model` checkpoint is a pickled
  PyTorch module. The public instance unpickles only checkpoints whose SHA-256
  is pinned in the contract, and refuses uploaded checkpoints
  ([ADR-0020](docs/adr/0020-trusted-checkpoint-loading.md)). Local mode accepts
  your own files — only load checkpoints you trust.
- **Sharing is public and permanent.** A MACE Link publishes the structure,
  energies, forces, filename and provenance to anyone with the URL. The share
  route validates what it stores; once `SUPABASE_SERVICE_ROLE_KEY` is set and
  `supabase/migrations/0003_lockdown.sql` applied, the public key can neither
  list nor write the table.
- **Framing.** Only `/r/<id>/embed` may be framed by other sites; every other
  page sends `X-Frame-Options: SAMEORIGIN`.

## Known, accepted advisories

`npm audit` reports five high-severity advisories, all in
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch →
braces`. This chain is development-only lint tooling: it never runs in
production or on user input, and `braces` has no patched release. CI fails on
any high or critical advisory in production dependencies
(`npm audit --omit=dev --audit-level=high`).

## Supported versions

Only the latest release on `main` receives fixes.
