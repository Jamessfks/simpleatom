# Vercel Pro facts for SimpleAtom (verified 2026-10-30)

Method: read-only documentation research. Every page below was fetched on **2026-10-30** with `tavily_extract` (advanced depth). No sign-in, no forms, no changes. The extractor drops some table cells and dynamic selectors (for example the region picker on the WAF pricing table), and where that happened I say so. "UNVERIFIED" means the page text I could read does not state it. "Derived" means my own arithmetic from page prices, not a page statement. Quotes are under 15 words, at most one per source.

Context: SimpleAtom's backend is a CPU-bound Python 3.11 / PyTorch / MACE service, today on a free Hugging Face cpu-basic Space (2 vCPU, 16 GB).

---

## 0. Verdict table (colleague claims)

| # | Claim | Verdict |
|---|---|---|
| 1a | Pro max 4 GB / 2 vCPU, default 2 GB / 1 vCPU | CONFIRMED |
| 1b | Max duration 800 s GA, 1800 s beta (Pro, Fluid) | CONFIRMED (default is 300 s; 1800 s needs per-function config and supported runtime versions) |
| 1c | Python bundle 500 MB uncompressed | CONFIRMED |
| 1d | Large Functions beta up to 5 GB via `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` | CORRECTED: new projects are eligible by default, and the env var is the opt-in or opt-out. See 1.3 |
| 1e | Request/response body 4.5 MB | CONFIRMED |
| 1f | Billing = active CPU + provisioned memory | CONFIRMED, plus invocations |
| 1g | Prices (iad1) | CONFIRMED: see 1.5. Pro has no included allowance on these lines; the $20/month credit offsets them |
| 2a | Python 3.12 default, 3.13, 3.14; no 3.11 | CONFIRMED (3.11 is not listed) |
| 2b | In-function concurrency for Python | CONFIRMED on the Fluid compute page; the Python runtime page itself says nothing about it |
| 3a | Container runtime is beta, all plans | CONFIRMED |
| 3b | Function limits apply | CONFIRMED |
| 3c | Scales down after 5 min idle | CONFIRMED (production). It is 30 s in preview. No cold-start figure is published |
| 3d | Image size limit | PARTLY UNVERIFIED: see 3.4 (VCR caps, plus a discrepancy over the 5 GB Large Functions path) |
| 4a | Sandbox Pro 8 vCPU / 16 GB | CONFIRMED |
| 4b | 24 h max session | CONFIRMED, but it is per session, not per sandbox lifetime |
| 4c | 64 GB disk | CONFIRMED |
| 4d | 10,000 concurrent | CONFIRMED |
| 4e | Firecracker microVM | CONFIRMED |
| 4f | Custom images via Vercel Container Registry | CONFIRMED (linux/amd64 only) |
| 4g | Egress can be disabled or restricted | CONFIRMED: `deny-all` or a domain allowlist, changeable on a running sandbox. See 4.4 |
| 4h | Prices $0.128 / $0.0212 / $0.60 per 1M | CONFIRMED |
| 4i | Draws from the $20/month Pro credit | CONFIRMED |
| 4j | Creation latency | UNVERIFIED as a number. Docs say only "milliseconds" |
| 5a | 40 rate-limit rules per Pro project | CONFIRMED |
| 5b | Keys IP, JA4 (others?) | CONFIRMED: Pro keys are IP and JA4 Digest only. User Agent and arbitrary Header keys are Enterprise |
| 5c | Window 10 s to 10 min fixed window | CONFIRMED. Token bucket and a 1 h window are Enterprise only |
| 5d | Rules defined in code | PARTLY: see 5.6. `vercel.json` `routes`/`mitigate` supports only deny and challenge. Rate limits in code go through the `@vercel/firewall` SDK |
| 6 | Spend Management | See section 6. A $200 notification-only default exists for new customers |
| 7 | Web Analytics on Pro | See section 7. Pro has NO included events: $0.03 per 1K from the first event, offset by the credit |
| 8 | GPU | No GPU offering is mentioned on any of the requested pages. See section 8 |

---

## 1. Vercel Functions limits and pricing

Sources (fetched 2026-10-30):
- https://vercel.com/docs/functions/limitations (page says Fluid compute limits)
- https://vercel.com/docs/functions/usage-and-pricing ("Fluid compute pricing")
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/docs/functions/configuring-functions/memory
- https://vercel.com/docs/fluid-compute
- https://vercel.com/docs/plans/pro-plan
- https://vercel.com/kb/guide/troubleshooting-function-250mb-limit

### 1.1 Memory and CPU (CONFIRMED)
- Hobby: 2 GB / 1 vCPU, fixed.
- Pro and Enterprise: default 2 GB / 1 vCPU, maximum 4 GB / 2 vCPU. The memory page names the tiers "Standard" (2 GB / 1 vCPU) and "Performance" (4 GB / 2 vCPUs).
- Pro/Enterprise can set the default size in the dashboard. It cannot be set in `vercel.json`: the memory page says a build-time warning appears if you try.
- Implication: a Function tops out at 4 GB RAM and 2 vCPU. That is below the current 16 GB Hugging Face Space, so large MACE models and big structures may not fit.

### 1.2 Duration (CONFIRMED)
- Pro: default 300 s, maximum 800 s (generally available), extended maximum 1800 s (30 min), **beta**.
- Above 800 s: configure `maxDuration` per function in code or `vercel.json` (project-level defaults above 800 s are not supported). Supported runtimes during the beta include `python3.12`, `python3.13`, `python3.14`, `nodejs22.x`, `nodejs24.x` and Bun 1.x. Secure Compute and Static IPs do not support durations above 800 s.
- Timeout returns 504 `FUNCTION_INVOCATION_TIMEOUT`.
- Discrepancy: the KB page https://vercel.com/kb/guide/vercel-docker-python-apps says the "standard maximum" for Pro is 1800 s. The limitations, duration and Fluid pages all say 800 s GA and 1800 s beta. I treat the docs pages as authoritative.
- For unbounded time, the page points to Vercel Workflows.

### 1.3 Bundle size and Large Functions (CORRECTED nuance)
- Standard: 250 MB uncompressed; Python: 500 MB uncompressed. Python bundles include every file reachable at build time, with no tree-shaking (Python runtime page).
- **Large functions (Beta)**: up to 5 GB uncompressed. Link: https://vercel.com/docs/functions/limitations#large-functions-beta
  - Requires Fluid compute with Active CPU enabled.
  - "New projects are eligible for large functions by default." Existing projects opt in with env var `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`; `0` disables. The env var always wins over the project default.
  - Vercel uses the large-function path only for Functions that exceed the standard limit.
  - Limitations page lists runtimes `nodejs` and `python`. The KB page https://vercel.com/kb/guide/troubleshooting-function-250mb-limit also lists Bun and container images, and says projects created after 2026-06-30 are auto-enrolled.
  - Not supported with Secure Compute or Static IPs.
  - Not stated on these pages: cold-start impact of multi-GB bundles (UNVERIFIED).

### 1.4 Body size (CONFIRMED)
- Request and response body max 4.5 MB, error 413 `FUNCTION_PAYLOAD_TOO_LARGE`. The limitations page links a KB guide on bypassing it. A Vercel KB page recommends Blob client uploads for larger files.
- Other limits on the page: 1,024 file descriptors shared across concurrent executions; auto-scale concurrency up to 30,000 on Hobby and Pro; default region `iad1`.

### 1.5 Billing model and per-unit prices (CONFIRMED)
- Billed on Active CPU time (ms of CPU actually used; I/O wait is not billed), Provisioned Memory (GB x time while any request is in flight), and Invocations.
- Memory keeps billing while waiting on I/O; between requests the instance is paused and nothing is billed.
- **iad1 (Washington D.C.) rates**: Active CPU **$0.128 per hour**; Provisioned Memory **$0.0106 per GB-hour**. cle1 and pdx1 show the same rates.
- Invocations on Pro: **$0.60 per million** (the page's example text).
- Included amounts: Hobby gets 4 h Active CPU, 360 GB-hr memory, 1M invocations. For **Pro the table shows "N/A" included**: usage is on-demand, offset by the monthly Pro credit. Pro platform fee is $20/month with $20 monthly usage credit (https://vercel.com/docs/plans/pro-plan). Credit expires at month end.
- The pages do not state how Active CPU is counted for a multi-vCPU instance (does one busy wall-clock hour on a 2-vCPU Function bill one or two CPU-hours?). UNVERIFIED: check the Usage dashboard on a test run before budgeting. Derived (my arithmetic): provisioned memory alone for a 4 GB instance kept busy for one hour is 4 x $0.0106 = about $0.042.

---

## 2. Python runtime

Sources (fetched 2026-10-30):
- https://vercel.com/docs/functions/runtimes/python (last updated August 12, 2026)
- https://vercel.com/docs/functions/runtimes/python/python-version (last updated April 10, 2026)
- https://vercel.com/changelog/python-support-added-to-in-function-concurrency-beta
- https://vercel.com/docs/fluid-compute

- **Versions (CONFIRMED)**: 3.12 (default), 3.13, 3.14. 3.11 is not listed. If the required version is missing or unsupported, Vercel uses the default (3.12). The SimpleAtom backend targets Python 3.11, so it would run on 3.12 or later, and the pinned `requirements.lock.txt` hashes and mace-torch/torch wheels would need re-checking.
- **How the version is chosen**: `requires-python` in `pyproject.toml`, a `.python-version` file, or `Pipfile.lock`; then redeploy.
- **Dependencies**: `pyproject.toml` (with or without `uv.lock`), `requirements.txt`, or `Pipfile` + `Pipfile.lock`.
- **Frameworks**: ASGI/WSGI. FastAPI, Flask and Django are named presets. Entry file such as `app.py`, `main.py`, `index.py` with a top-level `app`, or `tool.vercel.entrypoint` in `pyproject.toml`. Streaming supported.
- **Bundle**: 500 MB standard; Large Functions to 5 GB (public beta, Fluid). Vercel compiles `.pyc` bytecode into the bundle when space allows.
- **In-function concurrency**: the Python runtime page does not mention it (UNVERIFIED there). The Fluid compute page states optimized concurrency (multiple invocations in one instance) "can be used with the Node.js and Python runtimes". The changelog entry "Python support added to in-function concurrency beta" says Python joined the public beta for Pro and Enterprise, enabled via the dashboard; its publish date is not on the extracted text (UNVERIFIED), and the current Fluid page no longer calls it beta. For CPU-bound MACE work, concurrent requests on one instance would share 1-2 vCPU; the docs frame the feature as helping I/O-bound workloads.

---

## 3. Container runtime (OCI image as a Vercel Function)

Sources (fetched 2026-10-30):
- https://vercel.com/docs/functions/container-images and https://vercel.com/docs/functions/runtimes/container (both "Container Runtime", last updated July 7, 2026)
- https://vercel.com/kb/guide/docker ("Running Docker on Vercel")
- https://vercel.com/kb/guide/does-vercel-support-docker-deployments
- https://vercel.com/kb/guide/vercel-docker-python-apps
- https://vercel.com/docs/container-registry/limits-and-pricing (read from a search result excerpt, not a full extract)

1. **Status and plans (CONFIRMED)**: Beta, available on all plans.
2. **Limits (CONFIRMED)**: "The same limits and Active CPU pricing model of Vercel Functions apply." So Pro caps at 4 GB / 2 vCPU, 800 s (1800 s beta), 4.5 MB bodies. Secure Compute and Static IPs are not yet supported.
3. **Behavior**: the container must serve HTTP (default port 80, override with `PORT`); stateless; scales to zero. Scale-in: no traffic for **5 minutes in production, 30 seconds in preview**, then `SIGTERM` with a 30-second grace period (CONFIRMED). **Cold-start time: not published (UNVERIFIED).** Logs are broadcast to all in-flight requests of the instance.
4. **Image size**: the Functions size limit applies (250 MB uncompressed standard; Large Functions beta up to 5 GB, and the KB pages list container images as supported there; the limitations page lists only Node.js and Python, so I flag this as a doc inconsistency). Separately, Vercel Container Registry caps: compressed layer 2 GB, total image 15 GB, manifest body 4 MB; layers must use gzip or zstd; VCR image storage $0.10 per GB. The runtime page also mentions "optimization limits" capping the number of entries in an image (the numbers were not on the text I read).
5. **Dockerfile naming**: the `container-images` page and the KB guides say `Dockerfile.vercel` (or `Containerfile.vercel`) at project root. The newer `runtimes/container` page says a root `Dockerfile`/`Containerfile` is enough when no other framework is detected, and `Dockerfile.vercel` makes the Container preset win over another detected framework.
6. **Related**: https://vercel.com/docs/daemons (Public Beta, all plans) runs long-running container processes (queue consumers, workers) but "cannot receive inbound network traffic"; production only; no autoscaling or persistent storage; Daemons Active CPU shown on the pricing page at $0.128/h from the search snippet of https://vercel.com/pricing. I did not verify daemon memory or CPU limits.

---

## 4. Vercel Sandbox

Sources (fetched 2026-10-30):
- https://vercel.com/docs/sandbox
- https://vercel.com/docs/sandbox/pricing (last updated September 10, 2026)
- https://vercel.com/docs/sandbox/concepts (last updated August 25, 2026)
- https://vercel.com/docs/sandbox/concepts/firewall (last updated September 16, 2026)
- https://vercel.com/docs/sandbox/concepts/images
- https://vercel.com/docs/sandbox/sdk-reference (partial text only, via a query-focused extract)

### 4.1 Pro limits (CONFIRMED)
| Item | Pro |
|---|---|
| Max vCPUs / memory | 8 vCPU / 16 GB (each vCPU includes 2 GB; you pick 1 or an even number 2-32 by plan; default 2) |
| Disk | 64 GB ephemeral NVMe (SDK 3.0.0+ or custom images; 32 GB for the deprecated runtimes) |
| Max session duration | 24 hours per session (limit resets when a persistent sandbox stops and resumes); default timeout 5 minutes |
| Concurrent sandboxes | 10,000 |
| Max open ports | 15 |
| vCPU allocation rate | starts 150/min, ramps +500/min, up to 5,000/min after sustained use; back to start after 10 idle minutes |
| Control plane quota | 10,000 requests/min; deletions 20/s |
| Regions | 19; default `iad1` |

### 4.2 Isolation and images
- Each sandbox is a **Firecracker microVM** with a dedicated kernel, own filesystem and network namespace, root/sudo inside. Docker can run inside it.
- Default image `vercel/sandbox/universal` (Node LTS, Python 3.14, coding agents); managed images include `vercel/sandbox/python:3.14`. Custom images: OCI images pushed to **Vercel Container Registry**; VCR serves only a prepared `linux/amd64` build; Docker `ENTRYPOINT`/`CMD` are not run (start processes with `runCommand`).
- Persistent by default: filesystem is snapshotted on stop and restored on resume. Snapshots expire 30 days after last use by default.

### 4.3 How code and files move in and out
- JS SDK `@vercel/sandbox`, Python SDK (`vercel.sandbox` in the `vercel` package), and a `sandbox` CLI.
- `sandbox.writeFiles([...])` uploads files (default dir `/vercel/sandbox`); `sandbox.fs.writeFile/readFile`; a download call copies a sandbox path to a local path; `runCommand` returns stdout.
- Auth: Vercel OIDC token (recommended) or access tokens.
- I could not find an explicit statement that file transfer and command execution keep working while egress is `deny-all`. The firewall page's own example runs `sandbox exec` after setting `deny-all`, which implies the control plane is unaffected. Treat as inferred, not stated.

### 4.4 Network egress control (CONFIRMED, important)
Firewall page, three modes, updatable on a running sandbox without restart:
- `allow-all` (default): unrestricted internet.
- `deny-all`: "Denies all outbound network access, including DNS." Set at creation with `networkPolicy: 'deny-all'` or `sandbox create --network-policy deny-all`.
- User-defined: deny by default, allow by domain (SNI match, wildcards must replace a whole DNS label), allow CIDR ranges, deny CIDR ranges (deny wins).
Caveats stated on the page:
- Plain-text HTTP cannot be filtered by domain, only by IP range.
- Domain matching uses SNI, so domain fronting is possible against shared infrastructure; prefer narrow single-purpose hostnames.
- A policy with `subnets.allow` and no allowed domains leaves DNS unrestricted (DNS exfiltration possible). An empty policy behaves as `deny-all`.
- Exposed ports are reachable via a public URL.
- Credential brokering (`transform`) and request proxying (`forwardURL`) exist for allowed domains.
- Secure Compute can attach a sandbox to static IPs and VPC peering (a separate feature; Enterprise per the Secure Compute docs, not verified here).

### 4.5 Prices (CONFIRMED, iad1, Pro)
- Active CPU **$0.128 per hour**; Provisioned Memory **$0.0212 per GB-hour** (billed in 1-minute minimum increments); Sandbox Creations **$0.60 per 1M**.
- Data your sandbox sends to the internet plus exposed-port traffic is billable by the GB; Pro lists Sandbox Data Transfer as "Included in Flat Rate CDN". Downloads into the sandbox are free. Snapshot storage $0.08/GB-month; drive storage $0.05/GB-month.
- Hobby includes 5 h CPU, 420 GB-h, 5,000 creations, 45-minute sessions, max 4 vCPU / 8 GB.
- **Pro usage is charged against the $20/month credit**, then billed at the rates above. The page recommends Spend Management to alert or pause.
- The pricing page's own worked examples (assume 10% CPU utilization): 2 min / 1 vCPU / 2 GB about $0.0018; 5 min / 2 vCPU / 4 GB about $0.0092; 30 min / 4 vCPU / 8 GB about $0.1104; 2 h / 8 vCPU / 16 GB about $0.8832.
- Derived (my arithmetic, 100% CPU busy, Active CPU counted per vCPU): 2 vCPU / 4 GB is about $0.34 per hour; 8 vCPU / 16 GB is about $1.36 per hour. For CPU-bound MACE runs the Active CPU discount largely does not apply, because the CPU is busy.

### 4.6 Startup latency
- Docs say sandboxes "start in milliseconds" and snapshot resume is faster than a fresh start. **No numeric creation latency (p50 or p99) is published (UNVERIFIED).**

---

## 5. WAF rate limiting

Sources (fetched 2026-10-30):
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting (last updated August 28, 2026)
- https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules (last updated September 10, 2026)
- https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk
- https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
- https://vercel.com/docs/vercel-firewall/firewall-api
- https://vercel.com/docs/project-configuration/vercel-ts

1. **Availability and limits table (CONFIRMED)**, Pro column: counting keys **IP and JA4 Digest**; algorithm **fixed window**; window **10 s minimum, 10 min maximum**; **40 rules per project**; requests "Usage-based". (Hobby: 1 rule, 1,000,000 allowed requests included. Enterprise: adds User Agent and arbitrary Header keys, Token bucket, 1 h window, 250 rules.)
2. **Defaults in the UI**: window 60 s, limit 100 requests. Strategy is chosen per rule (Fixed Window on all plans).
3. **Per-region counters**: "tracked on a per-region basis"; traffic for one key spread across regions can exceed the configured limit for any single region.
4. **Actions**: default 429 response, or Log, Deny, Challenge. Log does not block (use it to test first). Persistent actions (time-based block on the client IP) are available on Pro and Enterprise for challenge, deny and rate-limit actions; default 1 minute.
5. **Targeting path and method (CONFIRMED)**: conditions include Request Path, Method, Query, Cookie, Header, IP, Country, ASN, JA3/JA4 and more, combined with AND/OR. The custom-rules page's own example prompts include a rate limit on `POST /auth/login`, so a rule like "POST /api/feedback" is a supported pattern.
6. **Defined in code?**
   - Dashboard rules (and the Firewall REST API / Terraform `vercel_firewall_config`) are the main route. Whether the REST API or Terraform can create *rate-limit* rules specifically is not stated on the page I read (UNVERIFIED). Changes take effect on publish, with no redeploy.
   - `vercel.json` `routes` with a `mitigate` block supports only `deny` and `challenge`. The page says log, bypass and redirect are not supported there, and rate limiting is not listed, so you cannot declare a rate-limit rule in `vercel.json`.
   - **`@vercel/firewall` SDK** (`checkRateLimit('rule-id', { request, rateLimitKey })`): you first create a dashboard rule whose condition uses the `@vercel/firewall` parameter and a Rate limit ID, then enforce it from code. The code can pass its own key (user ID, org ID), replacing the default per-IP bucket.
   - `vercel.ts`: the config option list I could read (build, crons, headers, rewrites, redirects, regions, functions and so on) shows no firewall/WAF key. Not found, so treat as UNVERIFIED.
7. **Pricing**: **$0.50 per 1,000,000 allowed requests** (the displayed rate; the table has a region selector and I could not read a per-region value for iad1, so the iad1 figure is UNVERIFIED). Whether `checkRateLimit` calls from code are billed the same way is not stated (UNVERIFIED). Deny, challenge and rate-limit-mitigated traffic does not incur CDN requests or Fast Data Transfer. Custom rules themselves and DDoS mitigation are free on all plans.

---

## 6. Spend Management

Sources (fetched 2026-10-30): https://vercel.com/docs/spend-management (last updated September 18, 2026); https://vercel.com/docs/plans/pro-plan (last updated September 15, 2026); https://vercel.com/docs/sandbox/pricing

- Available on Pro (no extra cost) and Enterprise Flexible Commitment. Owner or Billing role needed.
- Actions at the spend amount (the "On-Demand Budget"): notify (web and email at 50%, 75%, 100%; SMS at 100%), trigger a webhook (HTTPS POST), and optionally **pause the production deployment of all projects** (503 `DEPLOYMENT_PAUSED`). The page is blunt: "Setting a spend amount does not stop usage on its own." You must turn on Pause Production Deployments for a hard stop.
- Checks run "every few minutes", so notification or pause can lag; the page advises setting the amount below your true maximum. Unpausing is manual per project (dashboard or REST API), and raising the amount does not auto-unpause.
- What counts: Pro: metered usage that goes beyond the monthly credit, across all projects on the team. Excludes seats, Marketplace integrations and add-ons.
- Pause limits: affects production deployments only. It does not stop AI Gateway or v0 usage, and stored resources (including Container Registry image storage and Blob) keep billing.
- **Covers Sandbox and Functions?** Functions are production deployments, so pause applies. For Sandbox, the pricing page says to use Spend Management to "receive alerts or pause projects", but the Spend Management page does not state that Sandbox creation stops when projects are paused, because Sandbox is not a deployment (UNVERIFIED). Sandbox usage does count toward the spend amount as metered usage (pricing page: charged against the credit, then billed).
- **Default**: per the Pro plan page, Vercel enables spend-management **notifications** for new customers at **$200 per billing cycle**. The page does not say pause is on by default (UNVERIFIED; the Spend Management page describes enabling it with a toggle). Pro also sends a notification at 75% of the monthly credit.

---

## 7. Web Analytics and Speed Insights

Sources (fetched 2026-10-30):
- https://vercel.com/docs/analytics (last updated August 11, 2026)
- https://vercel.com/docs/analytics/limits-and-pricing (last updated August 25, 2026)
- https://vercel.com/docs/analytics/privacy-policy (last updated June 26, 2026)
- https://vercel.com/docs/analytics/custom-events (last updated June 26, 2026)
- https://vercel.com/docs/analytics/using-web-analytics
- https://vercel.com/docs/analytics/web-analytics-api
- https://vercel.com/docs/speed-insights/limits-and-pricing

### 7.1 What is collected and privacy
- No cookies. Visitors are identified by a hash made from the request; it is valid for one day, then reset, so visitors cannot be tracked across days or across sites. Bots (by User-Agent) are not counted.
- Per data point (privacy page): event timestamp, URL, dynamic path (route), referrer, filtered query params, geolocation (country, region, city), device OS and version, browser and version, device type, script version.
- IP: the privacy page says recording is anonymous and "not tied to ... any individual, customer, or IP address". It does not state whether IPs are discarded after hashing (UNVERIFIED as a storage statement). Sensitive URLs and params can be redacted with `beforeSend`.
- Custom event data must not include personal information; you control what you send.

### 7.2 Pricing and limits by plan (limits-and-pricing page)
| | Hobby | Pro | Pro + Web Analytics Plus | Enterprise |
|---|---|---|---|---|
| Included events | 50,000 per month | **None** | N/A | None |
| Extra events | not purchasable (collection pauses) | **$0.03 per 1K events** | $0.03 per 1K | Custom |
| Reporting window (retention) | 1 month | **12 months** | 24 months | 24 months |
| Custom events | not available | **Included** | Included | Included |
| Properties per custom event | - | **2** | 8 | 8 |
| UTM parameters | - | not available | Included | Included |
- Plus add-on: $10/month per team. Events are shared across all projects in the team. An event is a page view or a custom event.
- Pro usage is charged subject to the monthly Pro credit. Derived: 100,000 events per month is about $3 at the stated rate. Spend Management can alert or pause.
- Custom events: `track()` from `@vercel/analytics` (v1.1.0+); a server-side `track` from `@vercel/analytics/server` also exists. Data values may be string, number, boolean or null; no nested objects; event name, keys and values max 255 characters each.

### 7.3 Per-route page views and export
- Dashboard panels break down by Pages (URL without query), Route (framework pattern such as `/blog/[slug]`), Hostname, Referrers, Country, Browser, Device and OS. Custom events do not count toward bounce rate.
- **CSV export**: any panel exports up to 250 entries (three-dot menu, Export as CSV).
- **Web Analytics API** (REST) and a CLI exist: `visits/count`, `visits/aggregate`, `events/count`, `events/aggregate`; group by `route`, `requestPath`, `country` and more; filter with OData syntax. Count endpoints query production data; aggregate endpoints are bounded by the plan's reporting window. So per-route page views are queryable programmatically (needs a Vercel access token and projectId; I did not call it).

### 7.4 Speed Insights (https://vercel.com/docs/speed-insights/limits-and-pricing)
- Free tier on all plans: 10,000 events over a rolling 30 days, shared across the team; collection pauses at the limit (at least 14 days); Real Experience Score only; date ranges 24 h and 7 days.
- Speed Insights Plus on Pro: $10 per project per month, plus $0.65 per 10,000 events with no included events; all Core Web Vitals, 30-day range, Drains.

---

## 8. GPU

- None of the requested pages (Functions limits, Python runtime, Container runtime, Sandbox overview and pricing, Sandbox concepts and firewall) mention GPUs. Function memory and CPU options are only Standard (2 GB / 1 vCPU) and Performance (4 GB / 2 vCPU). Sandbox sizes are vCPU plus 2 GB per vCPU, with no GPU option listed.
- Secondary evidence on vercel.com (a search-result excerpt, not a full read): the comparison article https://vercel.com/i/e2b-alternatives lists Vercel Sandbox as having "No memory snapshots or GPU option" and says GPU jobs need a separate provider; the KB comparison https://vercel.com/kb/guide/vercel-vs-northflank says teams that need GPU hardware pair Vercel with a dedicated GPU provider. Treat these as marketing-adjacent, but they are consistent with the product pages.

---

## Open items worth a human check before relying on them
1. Container image Large Functions support (5 GB): limitations page lists Node.js and Python only; KB pages also list container images.
2. Multi-vCPU Active CPU accounting for Functions and Sandbox (does a 2-vCPU instance bill 2 CPU-hours per busy hour?). Not stated.
3. Per-region WAF rate-limit price for iad1 (region picker not captured).
4. Whether Spend Management pause stops new Sandbox creations.
5. Python 3.11 dependency pins versus Vercel's 3.12+ runtime.
