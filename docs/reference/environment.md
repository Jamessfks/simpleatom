# Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `MACE_API_URL` | Vercel | for remote mode | Backend base URL. Unset → local mode (spawns Python). |
| `MACE_API_TOKEN` | Vercel **and** the Space | recommended | Shared secret; the backend then accepts compute requests only from the front end. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | for sharing | Supabase project URL. Without it, sharing reports "unavailable" and nothing else breaks. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | for sharing | Used only until `SUPABASE_SERVICE_ROLE_KEY` is set. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (secret) | recommended | Server-only MACE Link storage; required before applying `supabase/migrations/0003_lockdown.sql`. Never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | Vercel | no | Canonical origin for share and citation links. |
| `SIMPLEATOM_PROFILE` | both | no | `hosted` or `local` (see the [contract](contract.md#deployment-profiles)). Defaults: the Space and a Next.js server with `MACE_API_URL` → `hosted`; local mode → `local`. |
| `ALLOW_CUSTOM_MODELS` | both | no | `1` allows uploaded `.model` checkpoints on a hosted profile (they execute code from the file — self-hosted only); `0` refuses them locally. |
| `OMP_NUM_THREADS` | the Space | no | torch threads (image default 2). |
| `KMP_DUPLICATE_LIB_OK` | local, macOS | yes on macOS | `TRUE`, or PyTorch aborts with OMP Error #15. The routes set it for you. |

A template is in [`.env.example`](https://github.com/Jamessfks/simpleatom/blob/main/.env.example).
