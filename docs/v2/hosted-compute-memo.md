# Hosted compute: where should SimpleAtom's calculations run, and what does Vercel Pro add?

Analysis only; nothing here is provisioned. Written 2026-10-28 (as the hosted-GPU memo) and
revised 2026-10-30 after the owner confirmed the team is on **Vercel Pro**.

* Every Vercel fact cites a page fetched on 2026-10-30. The full notes, with each URL, are in
  [`evidence/2026-10-30/vercel-pro-facts.md`](evidence/2026-10-30/vercel-pro-facts.md).
* Hugging Face facts were fetched on 2026-10-28
  ([`evidence/2026-10-28/reviews/adr-external-facts.md`](evidence/2026-10-28/reviews/adr-external-facts.md)).
* Anything not fetched or not measured is marked UNVERIFIED.
* **No speed gain is claimed anywhere.** Nothing has been measured on Vercel.

## Recommendation

1. **Compute stays on the Hugging Face `cpu-basic` Space for now** (free, 2 vCPU, 16 GB).
   This assumes S3 is contained and v2.2 is deployed.
2. **Use Vercel Pro now for what costs little and closes real gaps:**
   * WAF rate limiting, as the edge half of D41 and for `/api/feedback`;
   * Spend Management, configured before anything metered;
   * Web Analytics custom events, for the usage data Phase 1 could not get.
3. **Next experiment, after the owner's yes and with a small spend:** run the existing backend
   image on Vercel's **container runtime** as a Preview deployment, and measure cold start,
   wall time, peak memory and billed Active CPU on the golden cases. Move compute only on
   those numbers.
4. **Sandbox is not for ordinary runs.** Its value is isolation, so it is a candidate only
   for re-enabling custom `.model` uploads on hosted. That is a security decision for the
   owner, with the preconditions below.
5. **No GPU.** None of the Vercel Functions, container-runtime or Sandbox pages offer one,
   and the Hugging Face options in the 2026-10-28 memo are unchanged: paid T4 at $0.40/h,
   ZeroGPU only for Gradio, or a community grant.

## The options side by side

| | HF Space `cpu-basic` (today) | Vercel Functions (Python runtime) | Vercel container runtime (beta) | Vercel Sandbox |
|---|---|---|---|---|
| **CPU / memory** | 2 vCPU / 16 GB | Pro: up to **2 vCPU / 4 GB** (default 1 / 2 GB) ([limitations](https://vercel.com/docs/functions/limitations)) | same as Functions: "the same limits and Active CPU pricing model … apply" ([container runtime](https://vercel.com/docs/functions/runtimes/container)) | Pro: up to **8 vCPU / 16 GB**, 64 GB disk ([sandbox pricing](https://vercel.com/docs/sandbox/pricing)) |
| **Time per run** | our 240 s budget | 300 s default, **800 s** max (1800 s beta) | as Functions | up to 24 h per session; default timeout 5 min |
| **Python** | 3.11, as the lock pins | **3.12 (default), 3.13, 3.14**; 3.11 is not offered ([python runtime](https://vercel.com/docs/functions/runtimes/python)). Needs a 3.12 lock, which is an ADR-0025 bump gated on the physics suite | whatever the image contains: the existing 3.11 image as is | any image from Vercel Container Registry (linux/amd64) |
| **Size** | the image is 857 MB (containment session's `docker build`, 2026-10-28) | 500 MB Python bundle, so this needs **Large Functions** (beta, up to 5 GB) ([limitations#large-functions-beta](https://vercel.com/docs/functions/limitations#large-functions-beta)) | the Functions size limit applies; the docs disagree on whether container images get the 5 GB beta: UNVERIFIED | registry caps: 2 GB per compressed layer, 15 GB per image |
| **Request body** | profile cap 2 MB | **4.5 MB** | 4.5 MB | files go in through the SDK, not a request body |
| **Concurrency** | **one worker** (`jobs.py`): a second visitor waits or gets 429 | one request per instance. In-function concurrency stays **off**, because torch's default dtype is process-global | as Functions | one job per microVM |
| **Idle behaviour** | sleeps after 48 h; the first visitor wakes it | paused between requests | scales to zero after **5 min** without traffic in production; cold start not published (UNVERIFIED) | creation latency not published ("milliseconds"; UNVERIFIED) |
| **Price** | free | Active CPU **$0.128/h** + memory **$0.0106/GB-h** + $0.60 per 1M invocations (iad1) ([usage and pricing](https://vercel.com/docs/functions/usage-and-pricing)); **Pro includes no allowance**, only the $20 monthly credit | as Functions | Active CPU **$0.128/h** + memory **$0.0212/GB-h**, billed in 1-minute minimum increments, + $0.60 per 1M creations, charged against the $20 credit |
| **Isolation** | one container for every visitor | per-instance | per-instance | **Firecracker microVM**, egress `deny-all` possible, including DNS ([sandbox firewall](https://vercel.com/docs/sandbox/concepts/firewall)) |

### Cost per run: arithmetic, not measurement

**Inputs.** Wall times were measured with `/usr/bin/time` on `calculate_local.py` on an Apple
M4 Pro with `OMP_NUM_THREADS=2`, including Python start-up and the cached checkpoint load
(`docs/v2/evidence/2026-10-28/`). The vibrations figure is relax plus Hessian from the
feasibility run.

**Assumptions.**
* The CPU is busy the whole time. MACE is CPU-bound, so the "Active CPU" discount does not
  apply.
* Both vCPUs bill. Vercel does not state how a 2-vCPU instance is counted (UNVERIFIED), so
  this is the upper bound.
* Each instance is sized at 2 vCPU / 4 GB.
* Vercel's CPUs are as fast as this machine (UNVERIFIED).

| Workload (wall time) | Functions or container runtime per run | Sandbox per run (new microVM; 1-minute memory minimum) | HF Space |
|---|---|---|---|
| Single point, 9 atoms (2.5 s) | 2.5/3600 × (2 × 0.128 + 4 × 0.0106) = **$0.00021** | 0.00018 CPU + 0.00141 memory = **$0.0016** | $0 |
| NVT MD, ethanol, 4,000 steps (64.4 s) | **$0.0053** | 0.0046 + 0.0028 = **$0.0074** | $0 |
| Relax + Hessian, 74 atoms (≈ 75 s) | **$0.0062** | 0.0053 + 0.0028 = **$0.0081** | $0 |
| Runs per $20 of credit (heavy runs) | ≈ 3,200–3,700 | ≈ 2,500–2,700 | unlimited, but serial |

Sandbox costs more per short run (the memory minimum plus a microVM per run, whose boot time
is unmeasured) and buys nothing for ordinary runs, because our runs need neither 16 GB nor
24 h.

**What a move to Vercel compute would buy, if measurement bears it out:**
* parallel runs instead of one queue;
* no 48 h sleep;
* one platform.

**What it would cost:**
* metered spend instead of free;
* a 4 GB memory cap instead of 16 GB, so the hosted `maxAtoms` caps (500 opt / 1000 MD)
  need a peak-memory measurement;
* a cold start after 5 idle minutes.

### Measurement plan for the container-runtime pilot (owner action, Preview only)

1. Deploy the existing `mace-api/Dockerfile` image, with `acf14fa`'s lock fix, as a
   **Preview** deployment using the container runtime. Production is untouched, and
   `MACE_API_TOKEN` is set on that Preview.
2. Turn on Spend Management first (below).
3. Run the golden cases from `.claude/skills/verify-science/SKILL.md` ten times each. Record:
   * cold start and warm wall time;
   * peak memory from the function logs;
   * Active CPU and GB-hours from the Usage dashboard;
   * that numbers match the `science-critic` golden values exactly (same weights, same dtype).
4. Compare with the same cases on the Space after deploy. Decide using the per-run cost
   from the measured Active CPU, not the table above.

## Can Sandbox isolation make custom `.model` uploads safe on hosted? (owner decision)

A `.model` file is a pickle, and loading it runs whatever code it carries. That is S3's
attack surface, and ADR-0020 settled it by never unpickling an upload on infrastructure we
operate. A Firecracker microVM with `deny-all` egress changes what that code can reach. It
does not change the fact that the code runs.

**What Sandbox would contain.**
* The code runs in a disposable VM with its own kernel and no network, DNS included.
* No secret is placed inside it, so it cannot exfiltrate data or reach our backend, Supabase
  or Resend.
* One sandbox per job, persistence off, destroyed after the run. Nothing carries over to the
  next visitor.

**What it would not contain:**

1. **Our bill.** The uploader's code can burn CPU until the timeout. The only bounds are
   per-visitor limits, a short timeout and Spend Management. Pause stops *production
   deployments*, and whether it stops Sandbox creation is UNVERIFIED.
2. **The result.** The code can return any numbers it likes. That is acceptable only because
   the result is labelled `custom` and attributed to the uploader's own file. The Function
   must treat everything that comes out of the sandbox as untrusted: size caps, schema
   validation, no HTML.
3. **The upload path.** Checkpoints are 7–134 MB (the registry's own `bytes`), above the
   4.5 MB Function body limit. They would need direct client uploads to Vercel Blob: a new
   store, cost and retention policy.
4. **Escape bugs.** Firecracker is a strong boundary, but a VM escape is Vercel's risk and
   ours. We would be relying on it on purpose.
5. **Filtering caveats.** The docs say plain HTTP cannot be filtered by domain, and SNI
   allow-lists permit domain fronting. `deny-all` avoids both, so use nothing else. Whether
   file transfer keeps working under `deny-all` is inferred from the docs' own example, not
   stated (UNVERIFIED).

**Recommendation: do not enable it now.** The engineering is a second execution path: Blob
upload, a sandbox image with the full engine, output validation and quotas. Every run's cost
is driven by the uploader. Local mode already serves people with their own checkpoints, and
since D40 it is opt-in and loopback-only. If the owner wants it later, it needs a **new ADR
that amends ADR-0020**, with these preconditions:
* `deny-all` egress;
* no env or secrets in the VM;
* one sandbox per job, persistence off;
* 2 vCPU / 4 GB, with a timeout equal to the hosted budget;
* WAF and per-visitor quotas;
* Spend Management pause on, plus an in-code daily sandbox cap;
* schema-validated output;
* the result labelled `custom` with the licence and provenance it can actually prove
  (the file hash, not the model's identity).

## WAF rate limiting: the edge half of D41, and Feedback's first line

D41's code fix (forward the visitor IP; trust it only with the proxy key) makes the
backend's per-visitor limits work. A WAF rule stops floods before they reach a Function at
all, and denied or rate-limited traffic incurs no CDN request or data transfer.

**Pro limits** ([rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)):
* 40 rules per project;
* keys are IP or JA4 only;
* fixed window of 10 s to 10 min;
* actions: 429, log, deny, challenge;
* counters are **per region**, so a distributed client can exceed a rule;
* price $0.50 per 1M allowed requests (the iad1 figure is UNVERIFIED).

**Rules cannot be declared in `vercel.json` or `vercel.ts`.** They are created in the
dashboard, and `@vercel/firewall` `checkRateLimit()` can enforce a dashboard rule from code.

Proposed rules. The owner creates them, starting with the **Log** action for a week and
then switching to 429:

| Rule | Condition | Limit (per IP, fixed window) | Why |
|---|---|---|---|
| calc | `POST` on `/api/jobs` or `/api/calculate` | 20 / 10 min | above any human pace, below a script; the backend's 30/h and one-active-job limits stay authoritative |
| benchmark | `POST /api/benchmark` | 3 / 10 min | one benchmark fans out to many calculations (D42) |
| smiles | `POST /api/smiles-to-xyz` | 30 / 10 min | P4: SMILES bypasses the job queue |
| share | `POST /api/share` | 10 / 10 min | matches the in-code 20/h |
| feedback | `POST /api/feedback` | 3 / 10 min | ADR-0033's per-visitor limit, enforced before the Function runs; the in-code HMAC'd limits and the daily cap remain |

## Spend Management: a prerequisite for anything metered

Facts ([spend management](https://vercel.com/docs/spend-management),
[pro plan](https://vercel.com/docs/plans/pro-plan)):
* Pro sends notifications by default at **$200** per cycle.
* "Setting a spend amount does not stop usage on its own." A hard stop needs **Pause
  production deployments**, which pauses every project's production and is unpaused by hand.
* Checks run every few minutes, so set the amount below the true maximum.
* Whether pause stops Sandbox creation is UNVERIFIED.

**Owner action before the container-runtime pilot, Web Analytics custom events, WAF usage
or any Sandbox use:**
* set an on-demand budget the owner is comfortable with;
* turn on notifications and the webhook;
* decide whether a hard pause is preferable to an outage. For a free public tool it
  probably is.

## Web Analytics: the usage data Phase 1 lacked

`@vercel/analytics` is already installed and mounted (`app/layout.tsx:75-76`).

Facts ([limits and pricing](https://vercel.com/docs/analytics/limits-and-pricing),
[privacy](https://vercel.com/docs/analytics/privacy-policy),
[custom events](https://vercel.com/docs/analytics/custom-events)):
* Pro includes **no events**: each costs $0.03 per 1,000, with 12-month retention.
* Custom events are included on Pro, with **2 properties per event**; values are string,
  number, boolean or null, each up to 255 characters.
* No cookies: visitors are a hash that resets daily.
* Per-route page views are visible in the dashboard (CSV up to 250 rows) and queryable
  through the Web Analytics REST API grouped by `route`.

**First step, no code:** the owner exports per-route page views for `/calculate`,
`/benchmark`, `/docs/*` and `/r/[id]` over the retention window. That is the usage evidence
Phase 1 had to mark unavailable.

**Second step (code, after approval):** two custom events, with no personal data and within
the 2-property limit:
* `calculation_submitted {calculationType, modelType}`;
* `calculation_refused {code, profile}`.

Refusal codes such as `device_unavailable`, `limit_exceeded` and `custom_models_disabled` are
exactly the demand evidence the GPU and custom-model decisions need. Arithmetic: 10,000
calculations a month is about 20,000 events, which is **$0.60**.
