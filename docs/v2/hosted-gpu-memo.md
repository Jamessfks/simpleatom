# Hosted GPU: should the public SimpleAtom server get one?

Analysis only; nothing here is implemented. Written 2026-10-28 for [ADR-0031](../adr/0031-device-honesty.md).
Every price and limit below was fetched on 2026-10-28 from the page cited next to it.
Anything not fetched is marked UNVERIFIED.

**Recommendation: stay on CPU (`cpu-basic`, free).** Make the device choice honest
(ADR-0031), document GPU use through a local install, and revisit only if usage data shows
hosted demand that the 240 s CPU budget cannot serve. If that happens, the first step is a
community GPU grant. Paid hardware comes only after float64 has been measured on it.

## Where things stand

| Fact | Evidence |
|---|---|
| The Space runs Docker on `cpu-basic` (2 vCPU, 16 GB), with free hardware sleeping after 48 h idle | `GET https://huggingface.co/api/spaces/Jamessfks/mace-api` → `runtime.hardware.current: "cpu-basic"`, `gcTimeout: 172800` (2026-10-28); [spaces-gpus](https://huggingface.co/docs/hub/spaces-gpus) |
| The hosted image is CPU-only by construction | `mace-api/requirements.lock.txt:1946` `torch==2.10.0+cpu` |
| Hosted time budget is 240 s per request | `/capabilities` under `SIMPLEATOM_PROFILE=hosted` → `timeBudgetSeconds: 240` (run 2026-10-28) |
| A new Docker or Gradio compute Space needs a paid plan | [spaces-overview](https://huggingface.co/docs/hub/spaces-overview): "Gradio and Docker Spaces run on compute and require a paid plan to create". **Consequence: never delete the existing free Space. Pause it if it must be contained.** Whether existing free Spaces are grandfathered is UNVERIFIED |

## The four options

| | 1. Stay on CPU | 2. Paid Docker GPU | 3. Separate Gradio ZeroGPU worker | 4. Community GPU grant |
|---|---|---|---|---|
| **Cost** | $0 | T4 small is $0.40/h ([spaces-gpus](https://huggingface.co/docs/hub/spaces-gpus)). Always on (730 h/month) costs **$292/month**. With a custom sleep time, billing runs only while the Space is Starting or Running, so 2 h/day active costs about **$24/month** | Free account: 5 min GPU/day. PRO ($9/month, [pricing](https://huggingface.co/pricing)): 40 min/day, plus $1 per 10 min ([spaces-zerogpu](https://huggingface.co/docs/hub/spaces-zerogpu)) | $0 if granted. No criteria are published ("see if yours makes the cut", spaces-gpus) |
| **Engineering** | None beyond ADR-0031 | A second lock with CUDA wheels, a CUDA base image, and a CI job for it. Precision, out-of-memory and timing rules come into play (ADR-0031 §5) | A second service: **Gradio SDK only** ("exclusively compatible with the Gradio SDK"), **Python 3.10.13 or 3.12.12** where the backend pins 3.11, and PyTorch 2.8–2.13. It needs its own lock, its own contract enforcement (ADR-0003: the backend is the security boundary) and its own deploy | The same as option 2 once granted |
| **Per-call limits** | 240 s budget (ours) | Ours | **60 s default per call**, raised with `@spaces.GPU(duration=…)`; no hard maximum is stated (UNVERIFIED) | Ours |
| **Whose quota** | n/a | n/a | It follows the `X-IP-Token` header ([Gradio client docs](https://gradio.app/docs/python-client/using-zero-gpu-spaces)). A Vercel route handler has no visitor token, so every proxied visitor shares the **unauthenticated 2 min/day** tier. Sending the owner's HF token would likely charge the owner's quota (UNVERIFIED, forum answer only) | n/a |
| **Latency** | Warm: measured `timeTaken` 0.09–0.19 s for a 9-atom single point on an M4 Pro. The hosted figure is UNVERIFIED | A cold start after sleep loads a multi-GB CUDA image and the checkpoints (UNVERIFIED duration) | Queueing for a GPU slice, plus the proxy hop (UNVERIFIED) | As option 2 |
| **Does it help the science?** | Hosted caps are sized for CPU (`maxAtoms` 500 opt / 1000 MD) | **Unmeasured.** Geometry optimisation must stay float64 (ADR-0005), and float64 throughput on a T4 is low (vendor spec, UNVERIFIED). A GPU may not beat 2 vCPU in float64 | As option 2, on an RTX Pro 6000 Blackwell slice; float64 is unmeasured | As option 2 |
| **Creation rule** | Existing Space | Changing hardware on the existing Space; no new Space needed | A free account can host 2 ZeroGPU Spaces ("verified email, account older than 30 days") | Existing Space |

## Why stay on CPU

1. **No demand evidence for a hosted GPU.** Phase 1 found about 5 inference GPU threads in
   `ACEsuit/mace`, none of them about a browser front end, and no usage analytics were
   available (`docs/v2/needs-2026-10-28.md` §C).
2. **The work fits the CPU budget.** On an Apple M4 Pro at `OMP_NUM_THREADS=2`:
   * a 74-atom molecule relaxes in 38 s, and its analytic Hessian takes 37 s;
   * a 64-atom Si cell relaxes in 4.6 s;
   * an 11-point EOS takes 5 s.

   (Scripts: `docs/v2/evidence/2026-10-28/feasibility.py`.) The hosted 2-vCPU slowdown
   factor is UNVERIFIED and must be measured on the Space after v2.2 deploys.
3. **A GPU gives float64 work no measured gain.** That leaves an unmeasured claim and a
   recurring bill.
4. **ZeroGPU is a second backend.** It brings a different Python and its own security
   boundary, and under a proxy every visitor shares one 2-minute daily quota. It is the
   worst fit for a public, anonymous tool.

## When to revisit

* Vercel analytics show sustained refusals for `time_budget` or `too_many_atoms` on hosted.
  That needs ADR-0031's error codes, plus page views, which are owner-visible only.
* A community GPU grant is approved, after an owner application under Space Settings →
  hardware.
* Then, before anything is advertised: measure float64 geometry optimisation and float32 MD
  on the granted card against `cpu-basic`, on the golden cases in
  `.claude/skills/verify-science/SKILL.md`.
