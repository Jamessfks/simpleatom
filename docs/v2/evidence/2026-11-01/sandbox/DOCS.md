# Vercel Sandbox: findings from the official docs (read 2026-10-31; re-written 2026-11-01 after the /private/tmp wipe)

Only what the docs state, plus what was verified at runtime (marked "verified").
- https://vercel.com/docs/sandbox
- https://vercel.com/docs/sandbox/quickstart
- https://vercel.com/docs/sandbox/concepts/authentication
- https://vercel.com/docs/sandbox/cli-reference and https://vercel.com/docs/cli/sandbox
- https://vercel.com/docs/sandbox/working-with-sandbox
- https://vercel.com/docs/sandbox/concepts
- https://vercel.com/docs/sandbox/concepts/images
- https://vercel.com/docs/sandbox/concepts/persistent-sandboxes
- https://vercel.com/docs/sandbox/concepts/snapshots
- https://vercel.com/docs/sandbox/pricing

## Authentication
- OIDC (recommended): `vercel link` then `vercel env pull` gives `VERCEL_OIDC_TOKEN` (default `.env.local`;
  `vercel env pull <file>` for a custom file). "The token expires after 12 hours".
- Access-token alternative: `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.
- CLI: `vercel sandbox ...` (bundled in Vercel CLI 60.1.3, reports Sandbox CLI 4.1.0) or the `sandbox` npm package.
  `--token <pat_or_oidc>`; project/scope "Can be inferred from VERCEL_OIDC_TOKEN" (from `vercel sandbox create --help`).
- Verified: CLI 60.1.3 `vercel link --yes` ALSO auto-downloads a fresh OIDC token into `.env.local` in the linked dir.

## Commands used (all documented)
- `sandbox create --name N --image vercel/sandbox/python:3.14 --vcpus N --timeout 10m --non-persistent --region iad1`
- `sandbox exec [--timeout 8m] [--env K=V] <name> -- <cmd>` (foreground only; "The CLI has no detached mode")
- `sandbox copy <local> <name>:<path>` and reverse (one file, no parent dir creation)
- `sandbox stop <name>`, `sandbox list --all`, `sandbox remove <name>`
- `sandbox snapshot <name> --stop --expiration 1d`, `sandbox create --snapshot <id>`, `sandbox snapshots list|delete`
- SDK equivalents: `Sandbox.create({ resources: { vcpus }, timeout: <ms>, persistent: false, image, source })`,
  `runCommand`, `writeFiles`, `downloadFile`, `stop()`, `snapshot()`, `snapshot.delete()`.

## Persistence (cost-relevant)
- "Persistence is the default": persistent sandboxes auto-snapshot on every stop (billed Snapshot Storage).
  `--non-persistent` / `persistent: false` opts out. Deleting a sandbox keeps its snapshots; delete them separately.

## Environment
- Firecracker microVM; default image `vercel/sandbox/universal:latest` (Ubuntu 26.04 base, Node 24, Python 3.14).
  `vercel/sandbox/python:3.14` = "Python 3.14 (pinned), pip, venv, uv". No Python 3.11 image documented.
- Architecture: docs only imply it (custom images must have a `linux/amd64` build; non-amd64 "cannot be used in Sandbox").
  Verified `uname -m` = x86_64, so the lock's manylinux x86_64 wheels apply.
- Verified: working dir/HOME `/vercel`, user `ubuntu` with sudo, `curl` NOT present in the python image, uv 0.13.6 present.
- 64 GB ephemeral NVMe; default region iad1.

## Pricing (iad1, Pro)
Active CPU $0.128/vCPU-h (I/O wait not counted); Provisioned memory $0.0212/GB-h, 2 GB per vCPU,
"billed in 1 minute minimum increments"; Creations $0.60/1M; Snapshot storage $0.08/GB-month;
downloads into the sandbox free. Pro usage draws on the $20/month credit first. Pro max 8 vCPU / 16 GB,
24 h session; Hobby max 4 vCPU, 45 min. vCPUs: 1 or even 2..32; default 2; default timeout 5 min.
