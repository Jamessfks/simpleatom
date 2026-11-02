# External facts for SimpleAtom ADRs

Fetched: 2026-10-28 (all items below were read on this date, read-only, no sign-ups, logins or form submissions).
Method notes: HTML pages were read through the Tavily extractor, WebFetch, or plain HTTPS GET. Where a rendered
docs page dropped list items or code, the same page's source in `huggingface/hub-docs` (GitHub raw, `main`) was read
as a cross-check; GitHub `main` can be ahead of the deployed site, and differences are called out.
Anything not fetched is labelled UNVERIFIED. No personal information was placed in any request.

---------------------------------------------------------------------------------------------------

## TOPIC 1 - Hugging Face GPU options

### 1.1 ZeroGPU - https://huggingface.co/docs/hub/spaces-zerogpu (fetched 2026-10-28)
Cross-checked against https://raw.githubusercontent.com/huggingface/hub-docs/main/docs/hub/spaces-zerogpu.md (2026-10-28); identical content.

| Item | What the page says |
|---|---|
| SDK compatibility | Gradio SDK only. Quote: "exclusively compatible with the **Gradio SDK**". A Docker/FastAPI Space cannot use ZeroGPU as it stands. |
| Gradio / PyTorch / Python | Gradio 4+. PyTorch "almost all versions from 2.8.0 to latest"; full list printed: 2.8.0, 2.9.1, 2.10.0, 2.11.0, 2.12.1, 2.13.0. Python: 3.12.12 and 3.10.13. |
| GPU type | NVIDIA RTX Pro 6000 Blackwell, not H200 and not A100. Two sizes: `large` (default) = half a card, 48 GB VRAM, 1x quota cost; `xlarge` = full card, 96 GB, 2x quota cost. |
| Daily quota per tier | Unauthenticated 2 min (low priority); Free account 5 min (medium); PRO 40 min "extensible" (highest); Team org member 40 min extensible; Enterprise org member 60 min extensible. Quota resets exactly 24 h after first GPU use. |
| Beyond quota | PRO/Team/Enterprise only, pre-paid credits at $1 per 10 minutes of GPU time. Free accounts cannot buy extra. |
| Default per-call duration | 60 s. Raise with `@spaces.GPU(duration=120)`; dynamic duration via a callable that returns seconds. A hard maximum duration is not stated on this page (UNVERIFIED). Shorter durations improve queue priority. |
| Hosting limits | Free personal accounts: max 2 ZeroGPU Spaces, "accounts in good standing (verified email, account older than 30 days)". PRO personal: max 10. Team/Enterprise orgs: max 50. |
| Other | `torch.compile` is not supported (ahead-of-time compilation works on torch 2.8+). Models must be placed on `cuda` at module level (CUDA emulation outside `@spaces.GPU`). |
| Whose quota is charged on API/proxy calls | NOT stated on the Hub page ("X-IP-Token" appears nowhere on it or on spaces-overview, spaces-gpus, spaces-sdks-docker). See 1.5. |

Stale-source warning: the Gradio client doc (1.5) still says A100, and a third-party Medium article says H200. The Hub doc above is the current statement (RTX Pro 6000 Blackwell). A HF forum thread (https://discuss.huggingface.co/t/getting-you-have-exceeded-your-pro-gpu-quota-error-even-with-credits-loaded/174850) cites "25 minutes per day for PRO", which conflicts with the Hub doc's 40 minutes; trust the Hub doc, treat the forum figure as outdated (UNVERIFIED which is older).

### 1.2 Docker-Space GPU hardware and prices - https://huggingface.co/docs/hub/spaces-gpus (fetched 2026-10-28)
Hourly prices as printed (billed per minute while the Space is Starting or Running; no charge during build):

| Hardware | vCPU / RAM / GPU mem / disk | $/h |
|---|---|---|
| CPU Basic | 2 vCPU / 16 GB / - / 50 GB | Free |
| CPU Upgrade | 8 vCPU / 32 GB / - / 50 GB | 0.03 |
| Nvidia T4 small | 4 / 15 GB / 16 GB / 50 GB | 0.40 |
| Nvidia T4 medium | 8 / 30 GB / 16 GB / 100 GB | 0.60 |
| 1x Nvidia L4 | 8 / 30 GB / 24 GB / 400 GB | 0.80 |
| 4x Nvidia L4 | 48 / 186 GB / 96 GB / 3200 GB | 3.80 |
| 1x Nvidia L40S | 8 / 62 GB / 48 GB / 380 GB | 1.80 |
| 4x / 8x L40S | 48 / 382 GB / 192 GB; 192 / 1534 GB / 384 GB | 8.30 / 23.50 |
| Nvidia A10G small | 4 / 15 GB / 24 GB / 110 GB | 1.00 |
| Nvidia A10G large | 12 / 46 GB / 24 GB / 200 GB | 1.50 |
| 2x / 4x A10G large | 24 / 92 GB / 48 GB; 48 / 184 GB / 96 GB | 3.00 / 5.00 |
| Nvidia A100 large | 12 / 142 GB / 80 GB / 1000 GB | 2.50 |
| 4x / 8x A100 | 48 / 568 GB / 320 GB; 96 / 1136 GB / 640 GB | 10.00 / 20.00 |
| H100 and 8x H100 | struck through, "removed December 2025" | n/a |

- Paid-plan statement (one quote): "a new Space that runs on compute (Gradio or Docker) requires a paid plan". Sentence context: "CPU Basic has no hourly cost, but creating a new Space ... requires a paid plan. Static Spaces are free for everyone."
- Sleep / pause: free hardware is "suspended automatically if not used for an extended period (e.g. two days)"; `cpu-basic` sleeps after "currently, 48 hours" of inactivity and any visitor restarts it. Upgraded Spaces run indefinitely by default unless a custom sleep time is set; no hardware charge while asleep. `pause` = Space on hold, unbilled, restartable only by the owner (rendered page). GitHub `main` of spaces-overview words this as "until someone with write access restarts it" - minor wording difference.
- Replicas exist only on upgraded (paid) hardware, each billed independently.
- Community GPU grants: apply from the Space's Settings > hardware section (link in the lower left under "sleep time settings"); the page gives no criteria or approval odds, beyond "see if yours makes the cut".
- GitHub `main` (https://raw.githubusercontent.com/huggingface/hub-docs/main/docs/hub/spaces-overview.md, 2026-10-28) also lists RTX PRO 6000 Spaces rows (1x: 23 vCPU, 256 GB, 96 GB VRAM, $2.75/h; 2x $5.50; 4x $11.00; 8x $22.00). The deployed spaces-gpus and spaces-overview pages did not show these rows on 2026-10-28.

### 1.3 cpu-basic spec and creation rule - https://huggingface.co/docs/hub/spaces-overview (fetched 2026-10-28)
- Default limits per Space: 16 GB RAM, 2 CPU cores, 50 GB non-persistent disk. CPU Basic = 2 vCPU / 16 GB, free.
- Creation rule (one quote): "Gradio and Docker Spaces run on compute and require a paid plan to create". Paid plan = PRO for personal accounts, Team or Enterprise for orgs. The same paragraph then says "Free personal accounts in good standing can still host up to 2 Gradio Spaces running on ZeroGPU."
- Duplicating a Gradio or Docker Space follows the same rule (paid plan needed, same ZeroGPU free exception).
- Networking: outbound only on ports 80, 443, 8080. Free hardware goes to sleep when unused.
- https://huggingface.co/docs/hub/spaces-sdks-docker (GitHub raw source read 2026-10-28): GPU Docker Spaces use the GPU hardware tiers above; no GPU at Docker build time. No cpu-basic spec or sleep statement on that page.

### 1.4 Pricing - https://huggingface.co/pricing (fetched 2026-10-28)
- Spaces hardware table lists CPU Basic free, CPU Upgrade $0.03/h, and a row "ZeroGPU: dynamic CPU/RAM, Nvidia RTX Pro 6000 Blackwell, up to 96 GB, FREE", then the same T4/L4/L40S/A10G/A100 prices as 1.2.
- PRO account: "$9/month". Benefits listed include "Host your own ZeroGPU, Gradio & Docker Spaces on compute" and "8x ZeroGPU quota and highest queue priority".
- The same page's Inference Endpoints table lists H100/H200/B200/RTX PRO 6000 on AWS; these are Inference Endpoints, not Spaces.

### 1.5 Whose quota is charged when a ZeroGPU Space is called via API or proxy
Source: https://gradio.app/docs/python-client/using-zero-gpu-spaces (fetched 2026-10-28). Third-party-to-HF-Hub-docs, so lower authority than 1.1.
- The limit is driven by a header `X-IP-Token` that Hub infrastructure adds to requests reaching a Space; its value "changes depending on the user who makes a request". A caller that omits it is "treated as unauthenticated" (the 2-minute tier).
- A Space that calls another ZeroGPU Space must read the end user's `x-ip-token` from its own incoming request and pass it as a header to the client, otherwise all downstream traffic shares the unauthenticated limit.
- Reading: quota follows the identity attached to the request (the end user via `X-IP-Token`, or a token holder), not the Space owner. The doc does not say what happens for a server-to-server call from Vercel that carries no HF user identity beyond "unauthenticated". Passing an `hf_token` to `gradio_client.Client(...)` is shown in a forum answer (https://discuss.huggingface.co/t/zerogpu-quota-shows-0s-left-despite-active-pro-subscription/173970) as an authenticated path; UNVERIFIED whether that charges the token owner's quota (forum answer, not official doc).
- Inference for the memo (not a fetched statement): a Vercel route handler has no `X-IP-Token` from a browser visitor, so a ZeroGPU backend would start at the unauthenticated tier unless it sends an HF token.
- Gradio page still says ZeroGPU runs "A100 GPUs": stale versus 1.1.

### 1.6 Reconciliation: "paid plan to create" versus "free accounts can host 2 ZeroGPU Spaces"
Each page, exactly:
- spaces-overview and spaces-gpus: creating a Gradio or Docker compute Space needs a paid plan; static Spaces free; free personal accounts in good standing "can still host up to 2 Gradio Spaces running on ZeroGPU".
- spaces-zerogpu: free personal accounts (verified email, older than 30 days) can host up to 2 ZeroGPU Spaces; ZeroGPU is Gradio-SDK-only.
- They do not contradict each other. The free exception is narrow: Gradio SDK plus ZeroGPU hardware only. A new free Docker Space (SimpleAtom's current type) is not creatable under these rules. None of the fetched pages states whether Docker cpu-basic Spaces that already exist are grandfathered (UNVERIFIED).

---------------------------------------------------------------------------------------------------

## TOPIC 2 - Resend via Vercel Marketplace

### 2.1 npm package - https://registry.npmjs.org/resend/latest (fetched 2026-10-28)
- `resend` latest = **6.35.0**, `engines`: `{ "node": ">=20" }`. Types entry `./dist/index.d.mts` (read from https://cdn.jsdelivr.net/npm/resend@6.35.0/dist/index.d.mts, 2026-10-28).

### 2.2 Node SDK send API
Sources: https://resend.com/docs/api-reference/emails/send-email.md and https://resend.com/docs/send-with-nextjs.md and the 6.35.0 type declarations above (all 2026-10-28).
- Call: `const { data, error } = await resend.emails.send({ from, to, subject, text|html|react, ... })`.
- Required: `from` (accepts `Name <addr@domain>`), `to` (string or string[], max 50), `subject`; plus a body (`html`, `text` or `react`; `text` auto-generated from `html` if omitted).
- Optional: `cc`, `bcc`, `replyTo`, `headers`, `attachments` (max 40 MB after Base64), `tags` (ASCII letters/digits/underscore/dash, max 256 chars), `scheduledAt`, `topicId`, `template`.
- **Naming**: the Node SDK uses camelCase `replyTo` (`replyTo?: string | string[]` in `CreateEmailBaseOptions`); Resend's own Next.js page says to use camelCase and not `reply_to`. The REST/template docs use snake_case `reply_to`. A type for a raw REST body elsewhere in the same .d.ts also contains `reply_to`, so do not mix the two.
- **Response shape**: SDK returns `{ data, error, headers }`; on failure `data: null` and `error: { message: string, statusCode: number | null, name: <error code> }`. Success `data` is `{ id: "<uuid>" }`. The SDK does not throw for API errors; check `error`.
- **Error names** (`RESEND_ERROR_CODE_KEY`): invalid_idempotency_key, validation_error, missing_api_key, restricted_api_key, invalid_api_key, not_found, method_not_allowed, invalid_idempotent_request, concurrent_idempotent_requests, invalid_attachment, invalid_from_address, invalid_access, invalid_parameter, invalid_region, missing_required_field, monthly_quota_exceeded, daily_quota_exceeded, rate_limit_exceeded, security_error, application_error, internal_server_error. HTTP codes from https://resend.com/docs/api-reference/errors.md: 400/401/403 validation and key errors, 409 idempotency conflicts, 422 field errors, 429 for `rate_limit_exceeded` / `daily_quota_exceeded` / `monthly_quota_exceeded`, 500 `application_error`, 503 `service_unavailable`.
- **Idempotency**: Node: second argument `{ idempotencyKey: '...' }` (https://resend.com/docs/dashboard/emails/idempotency-keys.md); sent as `Idempotency-Key` header. Keys are 1-256 characters, unique per request, kept 24 hours. Same key with a changed body returns 409 `invalid_idempotent_request`.

### 2.3 Free plan limits - https://resend.com/docs/knowledge-base/account-quotas-and-limits.md and https://resend.com/docs/api-reference/rate-limit.md (2026-10-28)
- Transactional: 100 emails/day and 3,000 emails/month; sent and received (inbound) both count; each To/CC/BCC recipient counts separately. Daily quota is a UTC calendar day, reset at 00:00 UTC.
- Up to 3 verified domains, 3 inboxes, marketing up to 1,000 contacts.
- API rate limit 10 requests/second per team (shared across all API keys; excess gets 429). Headers: `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after`; quota headers `x-resend-daily-quota` (free plan only) and `x-resend-monthly-quota`.
- Bounce rate must stay under 4%, spam rate under 0.08%. Data retention 30 days.
- Test addresses `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, `suppressed@resend.dev` exist (https://resend.com/docs/dashboard/emails/send-test-emails.md); test sends count against quota.

### 2.4 The test sender `onboarding@resend.dev` - https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.md (2026-10-28)
- One quote: the `resend.dev` domain "can only send emails to the email address associated with your Resend account". Sending to anyone else returns HTTP 403 `validation_error` ("You can only send testing emails to your own email address ..."; see https://resend.com/docs/api-reference/errors.md).
- Consequence for a Feedback form: with the test sender and no verified domain, the only deliverable recipient is the Resend account's own address. Delivery to an arbitrary maintainer inbox requires a verified domain.

### 2.5 Domain verification - https://resend.com/docs/add-a-domain.md and https://resend.com/docs/dashboard/domains/introduction.md (2026-10-28)
- Resend sends only from a domain you own and have verified. Subdomain recommended (e.g. `updates.example.com`) for reputation isolation.
- DNS records: DKIM and SPF supplied as `TXT` and `MX` (or `CNAME`) records, copied exactly from the dashboard "Records" tab. Return-Path defaults to `send.example.com` (customisable). Do not proxy CNAME records (Cloudflare orange cloud blocks verification).
- Verification usually within about 15 minutes, up to 72 hours; the `dns.email` tool checks public visibility. After verification, add DMARC as a TXT record at `_dmarc` (https://resend.com/docs/dashboard/domains/dmarc.md).
- The exact record names and values are generated per domain inside a Resend account: UNVERIFIED (not fetchable without an account).

### 2.6 Vercel Marketplace integration
Sources: https://vercel.com/marketplace/resend and https://resend.com/docs/guides/vercel-marketplace-integration.md (2026-10-28).
- Env var provisioned: **`RESEND_API_KEY`**. Install steps listed by Vercel: load your Vercel projects, create a new Resend API key, store it as a Vercel environment variable.
- Resend's guide: install creates a new Resend account linked to the Vercel account and connects it to the chosen project; full Resend dashboard remains available.
- Prerequisites in Resend's guide: a Vercel account with a project, and "a domain purchased in Vercel". The install flow asks you to choose a domain already on your Vercel account (or buy one), a send region (default us-east-1; also eu-west-1, sa-east-1, ap-northeast-1), and a plan (free or paid). CLI path: `vc i resend`, then "Auto configure" adds DNS records to a Vercel-managed domain.
- Billing: Marketplace accounts are billed by Vercel; discounts, promo codes and credits do not apply. Marketplace page says "Pro plans available from $20".
- Is a dashboard step needed? Install itself happens in Vercel (the Install button on the page redirects to Vercel login). Whether a free-plan Marketplace install still insists on a domain: the guide says domain selection is a step; UNVERIFIED whether it can be skipped for the free plan.
- Quota note: errors page says teams billed through Vercel cannot enable pay-as-you-go inboxes (irrelevant to sending).

---------------------------------------------------------------------------------------------------

## TOPIC 3 - Matbench Discovery (MACE-MP-0 and MACE-MPA-0)

Sources: server-rendered HTML of https://matbench-discovery.materialsproject.org/ (leaderboard) and https://matbench-discovery.materialsproject.org/models (model cards); cross-checked with YAML in https://github.com/janosh/matbench-discovery (`models/mace/mace-mp-0.yml`, `models/mace/mace-mpa-0.yml`, raw main, 2026-10-28). Latest repo commit seen: 2026-10-19 ("Add BAM-MP-DeNS, supersede BAM-MP-core ...").
The site HTML was readable without JavaScript; the YAML agreed with it.

Leaderboard default view = "Unique Prototypes" discovery test set, sorted by CPS, "43 of 53 eligible models" shown (filter: require forces). The models page lists 67 model cards (counted; approximate), and ranks CPS out of 42, F1 out of 53, RMSD out of 43.
CPS = 50% F1 + 10% geometry RMSD + 40% phonon kappa SRME (as stated on the leaderboard page).

| Metric (unique prototypes) | MACE-MP-0 | MACE-MPA-0 |
|---|---|---|
| Leaderboard row / rank by CPS | 36 of 43 listed (models page: #36 of 42) | 22 of 43 listed (models page: #22 of 42) |
| CPS | 0.637 | 0.795 |
| F1 | 0.669 (F1 rank #41/53) | 0.852 (F1 rank #25/53) |
| DAF | 3.777 | 5.582 |
| kappa SRME (lower is better) | 0.682 (YAML 0.6823) | 0.412 (YAML 0.4123) |
| Other columns | Acc 0.878, Prec 0.577, MAE 0.057 eV/atom, R2 0.697, RMSD 0.0915, CMDS 0.633, CDS 0.627 | Acc 0.954, Prec 0.853, MAE 0.028, R2 0.842, RMSD 0.0731, CMDS 0.659, CDS 0.728 |
| Params / training data | 4.69M / MPtrj | 9.06M / MPtrj + sAlex |
| Added | 2023-07-14 | 2024-12-09 |

Full-test-set discovery numbers (YAML, differ from the default leaderboard view): MACE-MP-0 F1 0.668, DAF 3.4; MACE-MPA-0 F1 0.836, DAF 4.869.
Current #1 by CPS: Prophet-OAME-MBD, CPS 0.912, added 2026-09-13. No other MACE variant has its own directory in the repo besides these two (`models/mace/`).
Caveat: the 43 versus 42 count difference between the two pages is as printed; filter differences are the likely cause (UNVERIFIED).

---------------------------------------------------------------------------------------------------

## TOPIC 4 - Reference data fetchability

### 4.1 NIST CCCBDB experimental vibrational frequencies (fetchable by plain GET, no form POST needed)
Working URL pattern: `https://cccbdb.nist.gov/expvibs2x.asp?casno=<CAS>` (the `exp2x.asp?casno=7732185` page you named loads but is the "listing of experimental data" index; the frequency table lives at `expvibs2x.asp`). All fetched 2026-10-28. The data are for the neutral molecules; the page header oddly reads "(water anion)" / "(Carbon dioxide anion)" / "(formaldehyde anion)" even with `&charge=0`, a page-title quirk, and the values match the neutral-molecule literature and NIST WebBook (4.2). Treat the header label as a CCCBDB display bug, not a data problem (UNVERIFIED cause).

H2O (https://cccbdb.nist.gov/expvibs2x.asp?casno=7732185), cm-1; fundamental / harmonic:
- nu1 A1 O-H symmetric stretch: 3657.0 / 3832.2 (IR intensity 2.93 km/mol)
- nu2 A1 bend: 1595.0 / 1648.5 (62.5 km/mol)
- nu3 B2 O-H antisymmetric stretch: 3756.0 / 3942.5 (41.7 km/mol)
- Sources listed on the page: Shimanouchi NSRDS-NBS 39 (fundamentals), Huber and Herzberg 1979, Culot and Lievin 1992.

CO2 (https://cccbdb.nist.gov/expvibs2x.asp?casno=124389&charge=0): sigma-g 1333.0 / 1351.2; sigma-u 2349.0 / 2396.4; pi-u 667.0 / 672.2 (Herzberg 1945).
H2CO (https://cccbdb.nist.gov/expvibs2x.asp?casno=50000&charge=0): fundamentals 2782.0, 1746.0, 1500.0, 1167.0, 2843.0, 1249.0 (Nakanaga et al. 1982); harmonic column empty.
Validation note: CCCBDB gives both fundamental and harmonic values. A harmonic Hessian-derived frequency from a MACE model should be compared with the harmonic column; comparing it to the fundamentals mixes anharmonicity into the error.

### 4.2 NIST Chemistry WebBook H2O (backup) - https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Mask=800 (2026-10-28)
Shimanouchi 1972 selected values, cm-1: a1 symmetric stretch 3657 (IR gas 3656.65, Raman gas 3654); a1 bend 1595 (IR gas 1594.59); b2 antisymmetric stretch 3756 (IR gas 3755.79). Page notes "0~1 cm-1 uncertainty". Agrees with CCCBDB fundamentals.

### 4.3 Materials Project via OPTIMADE (no key) - https://optimade.materialsproject.org/v1/structures/mp-149 (2026-10-28)
- Returns HTTP 200 JSON, OPTIMADE API version 1.2.0, `id: mp-149`, formula Si, 2 sites, `last_modified: 2023-03-11`.
- `lattice_vectors` (Angstrom, primitive fcc cell): [3.333573, 0.0, 1.924639], [1.111191, 3.142924, 1.924639], [0.0, 0.0, 3.849278]. Vector lengths 3.84928 A each, all inter-vector angles 60.000 deg, cell volume 40.3295 A^3 (20.165 A^3/atom).
- Derived (my calculation, not printed by the page): conventional cubic a = (4V)^(1/3) = 5.4437 A.
- **Functional of this structure is not stated**: the response carries `_mp_stability` entries for `gga_gga+u`, `r2scan` and `gga_gga+u_r2scan` (all with energy_above_hull 0.0 and formation energy 0.0 eV/atom), but nothing says which calculation produced `lattice_vectors`. A conventional a of 5.4437 A is below the value usually quoted for PBE silicon (UNVERIFIED, from memory), so this structure could be r2SCAN-relaxed. Do not label it "PBE" in an ADR without confirming.
- Attributes returned (full list): _mp_chemical_system, _mp_stability, assemblies, cartesian_site_positions, chemical_formula_anonymous/descriptive/hill/reduced, dimension_types, elements, elements_ratios, immutable_id, last_modified, lattice_vectors, nelements, nperiodic_dimensions, nsites, space_group_* (null here), species, species_at_sites, structure_features.
- **No total energy, no bulk modulus, no elastic data** in OPTIMADE; only `_mp_stability` formation energy and energy above hull.
- https://api.materialsproject.org/docs is a Swagger UI (HTTP 200, public). Its schema https://api.materialsproject.org/openapi.json (title "Materials Project API", version 0.88.1) lists `/materials/elasticity/` and declares header auth `X-API-KEY`. An unauthenticated GET to `https://api.materialsproject.org/materials/elasticity/?material_ids=mp-149&_fields=material_id,k_voigt,k_reuss,k_vrh` returned HTTP 401 `{"message":"No API key found in request"}`. So elasticity/bulk modulus **requires a key**; a key needs an MP account, which was not created (out of scope). MP's PBE bulk modulus for Si: UNVERIFIED.

### 4.4 Experimental silicon constants
- Lattice constant: https://physics.nist.gov/cgi-bin/cuu/Value?asil, NIST CODATA 2022 "lattice parameter of silicon" = 5.431 020 511(89) x 10^-10 m (relative standard uncertainty 1.6 x 10^-8). Measurement temperature/pressure conditions were not in the extracted text: UNVERIFIED. This confirms the 5.431 A figure.
- Bulk modulus: https://sites.engineering.ucsb.edu/~sumita/courses/Courses/ME141B/HopcroftJMEMS.pdf (Hopcroft, Nix and Kenny, J. MEMS, "What is the Young's Modulus of Silicon?", a copy on a UCSB course site): "For silicon, B = 97.8 GPa", from B = (c11 + 2 c12)/3 with c11 = 165.7 GPa and c12 = 63.9 GPa (stiffness values as shown in the same PDF). This is slightly below the "98-99 GPa" range in the brief; cite 97.8 GPa as printed. The temperature of the underlying elastic constants was not confirmed from the extract (UNVERIFIED, likely room temperature).
- Not fetchable: Ioffe Institute silicon pages (https://www.ioffe.ru/SVA/NSM/Semicond/Si/mechanic.html and https://www.ioffe.ru/SVA/NSM/Semicond/Si/basic.html) failed with "self signed certificate in certificate chain" in curl and WebFetch; TLS verification was not bypassed. Their values are UNVERIFIED.
- Weak source seen, not recommended: a vendor page (https://www.shalomeo.com/Si-Silicon.html) lists bulk modulus 102 GPa, which shows the literature spread; prefer 4.4's handbook-style value.

---------------------------------------------------------------------------------------------------

## Summary table of decision-relevant facts (all fetched 2026-10-28)
- ZeroGPU = Gradio-only, RTX Pro 6000 Blackwell, 5 min/day free, 40 min/day PRO ($9/month), 60 s default per call; unauthenticated callers get 2 min/day.
- New Docker/Gradio compute Spaces need PRO ($9/month) or Team/Enterprise; free exception = 2 ZeroGPU (Gradio) Spaces.
- Cheapest always-on Docker GPU: T4 small $0.40/h (about $288/month if never slept; 720 h x 0.40, my arithmetic); sleep time can stop billing when idle.
- Resend free: 100/day, 3,000/month, 10 req/s; `onboarding@resend.dev` reaches only the account owner's address; custom domain required for other recipients; Node SDK uses `replyTo`; `resend` 6.35.0 needs Node >= 20; Vercel Marketplace provisions `RESEND_API_KEY`.
- Matbench Discovery: MACE-MPA-0 CPS 0.795 (row 22), MACE-MP-0 CPS 0.637 (row 36); leaderboard shows 43 of 53 eligible.
- H2O experimental fundamentals 3657/1595/3756 cm-1 (harmonic 3832.2/1648.5/3942.5); Si experimental a = 5.431 A, B = 97.8 GPa; MP elasticity needs an API key; MP OPTIMADE mp-149 conventional a = 5.4437 A (functional unstated).
