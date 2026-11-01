# Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `MACE_API_URL` | Vercel | for remote mode | Backend base URL. Unset → local mode (spawns Python). |
| `MACE_API_TOKEN` | Vercel **and** the Space | **yes, on hosted** | Shared secret. The backend then accepts compute requests only from the front end, and trusts the visitor IP the front end forwards (D43). Without it, every proxied visitor shares one per-visitor limit, and the Space logs a warning at start-up. Set it on both sides before deploying. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | for sharing | Supabase project URL. Without it, sharing reports "unavailable" and nothing else breaks. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | for sharing | Used only until `SUPABASE_SERVICE_ROLE_KEY` is set. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (secret) | recommended | Server-only MACE Link storage; required before applying `supabase/migrations/0003_lockdown.sql`. Never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | Vercel | no | Canonical origin for share and citation links. |
| `SIMPLEATOM_PROFILE` | both | no | `hosted` or `local` (see the [contract](contract.md#deployment-profiles)). Defaults: the Space and a Next.js server with `MACE_API_URL` → `hosted`; local mode → `local`. |
| `SIMPLEATOM_PYTHON` | local | recommended | The Python local mode runs, e.g. `~/.cache/simpleatom/venv311/bin/python` built from `mace-api/requirements.lock.txt`. Default `python3` on PATH; a run on a stack that differs from the pins carries a warning. |
| `ALLOW_CUSTOM_MODELS` | both | no | `1` allows uploaded `.model` checkpoints (they execute code from the file). Off by default on every profile; locally, uploads are then accepted only from a loopback host name (D40). |
| `OMP_NUM_THREADS` | the Space | no | torch threads (image default 2). |
| `KMP_DUPLICATE_LIB_OK` | local, macOS | yes on macOS | `TRUE`, or PyTorch aborts with OMP Error #15. The routes set it for you. |

A template is in [`.env.example`](https://github.com/Jamessfks/simpleatom/blob/main/.env.example).
