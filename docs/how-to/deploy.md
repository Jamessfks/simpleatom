# Deploy

Production is a Vercel front end, a Hugging Face Docker Space backend, and a
Supabase table for MACE Link.

## Backend — Hugging Face Space (automatic)

The Space is written only by CI ([ADR-0002](../adr/0002-host-backend-on-hf-spaces.md)).
On a push to `main`, `.github/workflows/ci.yml` runs every gate and then calls
`deploy-hf-space.yml`, which:

1. stages the backend with `scripts/stage-hf-space.sh` (every tracked
   `mace-api/` file except tests, the validator, and a `GIT_COMMIT` file);
2. mirrors it into the Space repository with `rsync --delete`;
3. waits for `https://<space>.hf.space/health` to report the pushed SHA.

One-time setup: create the Space (SDK: Docker), add the repository secret
`HF_TOKEN` (write access to the Space) and an environment `hf-production`.
Set `MACE_API_TOKEN` as a Space secret if the front end will send it.

The image installs the hashed lock (`mace-api/requirements.lock.txt`) and bakes
the MIT checkpoints after checking their pins; the build fails on a mismatch.

## Front end — Vercel

Import the repository; Vercel deploys `main`. Set the variables in
[Environment](../reference/environment.md). Protect `main` so the CI checks must
pass before a merge — Vercel itself does not wait for CI.

## MACE Link — Supabase

Apply `supabase/migrations/` in order (see `supabase/README.md`). `0003_lockdown.sql`
goes last, only after this front end is deployed and `SUPABASE_SERVICE_ROLE_KEY`
is set on Vercel.

## Verify a deploy

- `/health` on the Space shows the commit you merged.
- `/calculate?demo=true` → run → the Provenance section shows the same commit
  and validation "ran".
- `/r/<id>` of a fresh share opens; `/r/zzzzzzzz` is a 404.
