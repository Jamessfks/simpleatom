# Frontend review: SimpleAtom v2.2.0 (branch audit-next-feature, daed8bc)

Scope: app/ (not app/api), components/, lib/ (not lib/server), types/. Read-only. The dev server on :3100 was used for GET requests, a few rejected POSTs and Browser-pane checks. No calculation was started and nothing in the repo was written.

Status key. CONFIRMED means I executed something and quote its output. PLAUSIBLE means I read the code and reasoned, and have not run it.

Provenance. The `code-review` skill (high effort, `main...v2.2` limited to the frontend paths) produced 8 candidate findings. I re-verified each one. Two are narrowed (F16, F22) and one is dropped (`totalSteps` null; see F22). All other findings come from the specific checks.

Commands run:
- `npx tsc --noEmit --incremental false`: clean.
- `npx vitest run`: 4 files, 40/40 pass.
- `npx eslint app components lib types`: 15 problems (14 errors, 1 warning), listed below.

Severity key:
- HIGH: wrong science or data, or a false statement about what the product does.
- MED: broken behaviour or an accessibility failure on a primary flow.
- LOW: polish or hardening.

---

## HIGH

### F1. HIGH. Catalog "Silicon (diamond)" and "Diamond (carbon)" are not diamond lattices
- Where: `lib/mlpeg-catalog.ts:128-141` (si-diamond), `:208-225` (c-diamond), `:428-440` (si-111).
- Status: CONFIRMED (executed).
- Evidence. Both entries put 2 atoms at (0,0,0) and (a/4,a/4,a/4) inside a **cubic** a×a×a cell. That basis belongs to the 2-atom primitive FCC cell. A conventional diamond cell has 8 atoms. The source comments say "Verified: a=5.43 Å … 2 atoms", but they are wrong.
  Command: read the catalog XYZ with ASE and compare against `ase.build.bulk(..., cubic=True)`. Output:
  ```
  catalog si-diamond         atoms 2  V/atom 80.05 A^3  NN(<2.6A) per atom [1, 1]
  ASE bulk Si diamond cubic  atoms 8  V/atom 20.01 A^3  NN(<2.6A) per atom [4, 4, 4, 4, 4, 4, 4, 4]
  ```
  - c-diamond has V/atom 22.69 Å^3, against 5.67 for real diamond.
  - The metadata table (atomCount, elements) is consistent for all 14 entries. Only the Si and C geometry is wrong.
  - `public/demo/silicon.cif` is the correct 8-atom cell, so the repo already has the right data.
  - cu-fcc, nacl-rocksalt and fe-bcc check out (correct atom counts and V/atom).
  - si-111 is stretched. Its first interlayer gap is 1.246 Å where 0.784 Å is expected. The nearest-neighbour bond comes out at 2.543 Å against 2.351 Å in bulk Si, about 8% long. The "Verified: diamond bilayer spacing" comment is false.
- Impact. These are "Silicon (diamond)" and "Diamond (carbon)" in the calculator catalog and the benchmark. Each carries an experimental cohesive energy (-4.63 and -7.37 eV/atom). Benchmark ΔE and every "MACE vs experiment" statement for them is computed on a 4×-too-sparse, 1-coordinate lattice. The label tells the user it is diamond.
- howToVerify: `python -I -c "..."` as above. Or dump `MLPEG_CATALOG` with `node --experimental-strip-types` and run `ase.io.read(io.StringIO(xyz), format="extxyz")`, then compare `get_volume()/len(atoms)` and `neighbor_list` coordination with `bulk('Si','diamond',a=5.43,cubic=True)`.
- Fix:
  - Use the 8-atom conventional cell: add (0,½,½), (½,0,½), (½,½,0) and their +(¼,¼,¼) partners.
  - Alternatively use the 2-atom cell with FCC primitive vectors.
  - Correct the si-111 bilayer to 0.784 Å intra and 2.351 Å inter spacing.
  - Add a vitest that asserts V/atom and coordination for each periodic entry, so the "Verified" comments become executable.

### F2. HIGH. Docs promise a CPU fallback on out-of-memory that does not exist, and the FAQ advises something the default model cannot do
- Where: `app/docs/calculations/page.tsx:276-281`, `app/docs/faq/page.tsx:9` (SEO description), `:39-45`.
- Status: CONFIRMED (executed grep plus data).
- Evidence. The docs say: "SimpleAtom falls back to CPU automatically if CUDA is unavailable or runs out of memory."
  - `resolve_device` (`mace-api/calculate.py:374-384`) only tests `torch.cuda.is_available()`.
  - `grep -niE "memory|OutOfMemory|oom" mace-api/*.py` has one hit, a comment in `jobs.py:14`. There is no OOM handler anywhere.
  - FAQ "I'm getting a CUDA out-of-memory error" says to "choose a smaller model size (small instead of medium or large)". MACE-MPA-0, the default, ships only `medium` (`contract.json`: sizes `['medium']`). The size select is disabled for it.
  - The hosted API is a shared CPU (contract hosted profile text). A CUDA OOM cannot occur there, yet the FAQ and its meta description advertise it.
  - "[a GPU] can significantly speed up larger systems" is generic. Nothing in the repo measures or checks it.
- howToVerify: `grep -niE "memory|OutOfMemory|oom" mace-api/*.py`; `python3 -c "import json;print([ (m['id'],list(m['sizes'])) for m in json.load(open('mace-api/contract.json'))['models']])"`.
- Fix. Delete "or runs out of memory". Say "falls back to CPU if CUDA is unavailable; the result's run configuration shows which device ran". Rewrite the FAQ entry as local-GPU only (set Device to CPU; model sizes apply to MP-0 and MACE-OFF only). Or implement a real catch-and-retry-on-CPU plus a result warning, then keep the sentence.

### F3. HIGH. A result is not pinned to the run that made it: filename, Share and "Compare with foundation model" all read live form state
- Where: `app/calculate/page.tsx:704` (`filename={uploadedFiles[0]?.name}` on the dashboard), `:490` (`saveResult(result, uploadedFiles[0]?.name)`), `:392-406` (`handleRunFoundation` closes over the current `uploadedFiles`, `params`, `parsedStructure`), `:748` (`{isCustomModel && <ModelComparison …>}` where `isCustomModel` is the form's current model type).
- Status: PLAUSIBLE (read-only, high confidence). `result` is cleared only inside `handleCalculate` (`setResult(null)`). `handleFilesChange` and `ParameterPanel` never clear it.
- Scenario. Run a custom-model calculation on A.xyz, then upload B.xyz without re-running. The panel still shows A's numbers.
  - The banner and the PDF/JSON naming say B.xyz.
  - "Share result" posts the A result with filename B.xyz as a permanent public link.
  - "Compare" runs the foundation model on **B** with the **current** form params, then prints ΔE against A's custom result.
  - Run MACE-OFF, then switch the form to "custom": a ModelComparison card appears for a MACE-OFF result, labelled "Custom model".
- howToVerify: run `/calculate?demo=true`, upload a different file after the result appears, click Share and read the stored `filename` (a local build with Supabase). The dashboard badge changes immediately.
- Fix. Snapshot `{files, params, filename, structure}` into a `lastRun` state when the run starts. Feed the dashboard, share, compare and `isCustom` from it (use `result.params.modelType`). Optionally mark the result stale when the form diverges.

---

## MED

### F4. MED. SMILES box and Ketcher "Use in calculator" show "[object Object]" for every server error
- Where: `components/calculate/smiles-input.tsx:61-66, 72`, `components/calculate/ketcher-editor.tsx:83-88, 94`.
- Status: CONFIRMED (executed).
- Evidence. The routes now return `error` as an object:
  ```
  curl -s -X POST :3100/api/smiles-to-xyz -d '{"smiles":"not a smiles @@@"}'
  {"status":"error","message":"Invalid SMILES: …","error":{"code":"backend_error","message":"Invalid SMILES: …","field":null}}   HTTP 400
  ```
  The client does `throw new Error(data?.error || …)`. `node -e 'new Error({code:"x"}).message'` prints `[object Object]`. An invalid SMILES, a missing field and a too-long string (422 `limit_exceeded`) all hit this.
  `readError`/`postJson` in `lib/api-client.ts` were written for this. Their header comment says the SMILES box and editor use them. `grep -rn "readError\|postJson"` shows only `lib/share.ts` and `lib/api-client.ts` itself use them. `postJson` has no callers.
- howToVerify: type `@@@` into the SMILES tab and press Convert.
- Fix: use `postJson("/api/smiles-to-xyz", {smiles})` and show `err.message`. Also take `caps.limits.maxSmilesLength` (hosted 500) as an input `maxLength`.

### F5. MED. Benchmark page: error body parsed with the old shape, hosted users offered a custom-model upload, and the failure text is false
- Where: `app/benchmark/page.tsx:105-109` and `:114-132`, `:186-192`; `components/benchmark/benchmark-config.tsx:437-444`; `:463` (separate wording issue, see F20).
- Status: CONFIRMED by executed curl plus code reading.
- Evidence:
  - `new Error(err.error || …)` receives an object. `await response.json()` throws on a non-JSON 413 page.
  - The catch discards the message and sets `{status:"error", results:[]}`. The results view then prints "All calculations returned errors. Check that the Python backend is running." That is false for 400/403/413/422. Example: `POST /api/benchmark` with no models returns `{"error":{"code":"invalid_models","message":"Provide 2 or 3 models to benchmark."…}}` (HTTP 400).
  - `grep -n "useCapabilities\|customModels" components/benchmark/*.tsx app/benchmark/*.tsx` is empty. The "Upload .model file" control is offered on the hosted profile, where the server answers 403 `custom_models_disabled`. The user then sees the "backend not running" text.
- Fix: use `readError(response)`, show `err.message`, and gate the control on `useCapabilities().customModels`.

### F6. MED. Device control: "CUDA (GPU)" is always offered and silently runs on CPU. The ledger never shows the device.
- Where: `components/calculate/parameter-panel.tsx:422-437` (always both options); `components/calculate/run-ledger.tsx:155-185` (rows are Structure, Model, Calculation, Precision; no Device and no D3 line); `components/calculate/metrics-dashboard.tsx:1847-1873` (device only as a token inside the "Run configuration" sentence); `app/calculate/page.tsx:212` (`{...filtered, ...echoed}`: requested `device` is kept when the backend echo lacks it).
- Status: CONFIRMED (executed).
  - `GET :3100/api/calculate` returns `{name, version, mode, profile, customModels, limits…}`. There is no device or CUDA field, so the UI cannot know whether a GPU exists.
  - `resolve_device` returns `"cpu"` with no entry in `result["warnings"]` (`grep -n "CUDA\|cuda" mace-api/calculate.py` has no warning append).
  - The hosted profile is "one shared CPU", so CUDA is never real there.
- Other places that imply GPU. After a run of an older or remote backend with no `params.device` echo, the dashboard and the PDF print the **requested** `cuda` as if it ran. The docs table (`calculations/page.tsx:333-336`) lists `"cuda"` unconditionally. FAQ and getting-started speak of GPUs. The Recent-history entry does not record the device.
- Fix:
  - Add `devices`/`cudaAvailable` to the capabilities payload and hide CUDA unless it is true.
  - Add a result warning ("CUDA requested; ran on CPU") on fallback.
  - Add Device (and D3, MD seed) rows to the ledger.
  - Show the resolved device as a result badge.

### F7. MED. Green "Calculation complete" banner and "Complete" pill for a non-converged optimisation or a run stopped by the time budget. The step-limit wording is wrong for the budget case.
- Where: `components/calculate/metrics-dashboard.tsx:297-302` (banner is unconditional), `:2046-2052` ("No — stopped at the step limit"); `app/calculate/page.tsx:824-860` (StatusPill); `app/r/[id]/result-context.ts:217-222` ("Stopped at the step ceiling…"). `result.stoppedEarly` and `params.stoppedEarly` are typed (`types/mace.ts:98,204`) and set by the backend (`calculate.py:1038-1043, 1174, 1365`) but nothing reads them (`grep -rn stoppedEarly` has no UI hit).
- Status: PLAUSIBLE (read-only). Mitigation: the backend also appends a "Stopped early…" string to `result.warnings`, which `ResultWarnings` (`:378`) prints.
- Problem. The repo's own rule says a not-relaxed result reported as "completed" is the same class of error as a calculation that never ran. The banner stays green. For a budget stop on a geometry optimisation, the Converged row and the shared-page sentence blame the "step limit" and "step ceiling", but the cause was the time budget. For MD the "MD steps" in the run-configuration string is the requested count, not `atStep`.
- Fix: derive banner state from `converged`/`stoppedEarly` ("Stopped at the time budget after N of M steps"); read `stoppedEarly.reason` when wording the cause; show `atStep` instead of the requested step count.

### F8. MED. Static "Limitations and uncertainty" box is wrong or misleading on most results
- Where: `components/calculate/metrics-dashboard.tsx:660-685`.
- Status: CONFIRMED by quoted lines.
- Evidence:
  - "MACE-OFF scope: … Not suitable for metals, radicals, ions" is printed on every result, including MACE-MPA-0 crystals.
  - "No uncertainty estimates … Consider running multiple model sizes (small/medium/large) and comparing results to gauge robustness". MACE-MPA-0 (the default) has one size, so the advice is not actionable. An unweighted spread over three sizes is not an uncertainty estimate.
- Fix: render model-specific rows (use `findModel(params.modelType)`). Replace the size advice with "compare MP-0 and MPA-0, or fine-tune and validate against your reference".

### F9. MED. "Compare with foundation model" prints a cross-convention ΔE and does not say which foundation model ran. The docs promise metrics that are never computed.
- Where: `components/calculate/model-comparison.tsx:103-107, 148-181`; `app/docs/models/page.tsx:158-163`; `components/calculate/metrics-dashboard.tsx:206-215` (`energyR2` is always null).
- Status: PLAUSIBLE (read-only).
- Evidence:
  - The ΔE row is `custom.energy − foundation.energy` as "N meV" (`deltaE*1000`), with "custom higher / foundation higher". There is no per-atom value, no unit scaling and no convention note.
  - A fine-tuned checkpoint and MACE-OFF (the baseline for any isolated molecule, via `foundationModelFor`) use different energy references. The repo's own docs and `EnergyReferenceNote` say never to compare those absolute totals. The result is a number such as "-3604521.3 meV".
  - The card heading is the static string "Foundation Model". The user is never told whether MPA-0 or MACE-OFF ran.
  - The docs say the comparison reports "agreement metrics (MAE, RMSE, R²)". There is no R² in the comparison, and the dashboard deliberately leaves `energyR2` null.
- Fix: show the foundation model label and size, hide ΔE unless both conventions are the same (or add a "conventions differ" caption), report per-atom, and correct the docs sentence.

### F10. MED. Accessibility: all Select triggers and all NumberField inputs have no accessible name
- Where: `components/calculate/parameter-panel.tsx:667-690` (`Field`: `<Label>` with no `htmlFor`, children get no `id`), `:742-760` (`NumberField`: `<Label>` beside `<Input>`, no `id`/`htmlFor`).
- Status: CONFIRMED (executed in the Browser pane).
  - On `/calculate`: `[role=combobox]` ×4 gave `labels.length 0, aria-label null, aria-labelledby null`. The labels "Model type, Model size, Precision, Device" had `htmlFor ""` and `control null`.
  - `read_page` lists `combobox [ref_40]`, `[ref_44]`, `[ref_49]`, `[ref_53]` with no name.
  - After selecting MD: 4 `input[type=number]` all with `labels 0`, no `aria-label`.
  - The ensemble Select is unnamed too. Only the D3 switch (`htmlFor="dispersion"`) is associated.
  - Also: 4 identical "More information" buttons (`InfoTip`).
- Fix: `useId()` in `Field`/`NumberField`, pass `htmlFor`, and give `SelectTrigger`/`Input` the `id`. Make `InfoTip` aria-label include the field ("More information about Precision").

### F11. MED. Accessibility: keyboard and focus failures on file inputs and tab panels
- Where: `components/benchmark/benchmark-config.tsx:439-441` (input `className="hidden"` inside a `<label>`); `components/calculate/file-upload-section.tsx:92-96`, `components/calculate/parameter-panel.tsx:298-305`, `components/benchmark/benchmark-config.tsx:657-661` (`absolute inset-0 opacity-0`); `components/ui/tabs.tsx` + `app/globals.css:262-267` (global focus rule omits `[role=tabpanel]`).
- Status: CONFIRMED (executed in the Browser pane).
  - On `/benchmark`: input list gave `{cls:"hidden", display:"none", tabbable:false}`. A keyboard-only user cannot reach "Upload .model file" (a label is not focusable).
  - On `/calculate`, pressing Tab until `input[type=file]` was active gave `{type:"file", opacity:"0", outline:"solid 2px", focusVisible:true}`. The outline exists but opacity 0 hides it, so focus is invisible on the structure drop zone.
  - `[role=tabpanel]` elements have `tabindex=0` and class `outline-none`. The outer calculator panel is a tab stop with no visible focus (`DIV outline none 1px fv true`).
- Fix:
  - Make the benchmark input `sr-only` (not `display:none`) with `peer-focus-visible` styling on its label.
  - Add `focus-within:outline` on the drop-zone wrappers.
  - Add `[role=tabpanel]` to the global focus-visible selector, or drop `outline-none` and add a visible ring on `TabsContent`.

### F12. MED. Accessibility: job-progress live region and completion announcement
- Where: `app/calculate/page.tsx:608-611` (`{isCalculating && <div aria-live="polite">…}` contains the ticking "Elapsed {n} s" at `:659-663`); `:824-860` (StatusPill is `hidden … sm:inline-flex` and the only status for completion); `:585` (focused Run button becomes `disabled`); `:629-653` (stage state is icon-only).
- Status: PLAUSIBLE (screen-reader behaviour not run).
- Evidence and consequences:
  - The live region is inserted already containing content, so most screen readers do not announce its first text.
  - The elapsed counter inside it changes every second, which is chatty for a polite region.
  - On phones (<640 px) the StatusPill is `display:none`, so nothing announces completion. The result appears below the fold, and `scrollIntoView` does not move focus.
  - The focused Run button is disabled mid-run, so keyboard focus falls to `<body>`.
  - The stage `<ol>` has no `aria-current="step"`. Done/active/pending is conveyed only by icons.
- Fix:
  - Keep a persistent, visually-hidden `role="status"` region. Update it only on stage changes and completion ("Calculation complete. Energy …").
  - Take the elapsed timer out of the live region.
  - Move focus to the results heading on success.
  - Keep the Run button focusable (`aria-disabled`).

### F13. MED. Client CIF parser does not expand symmetry, so atom count, formula, limits and overlap warnings are wrong for the usual database CIF
- Where: `lib/parse-structure.ts:278-385` (`parseCIF` reads only `_atom_site` rows). The consumers are `components/calculate/run-ledger.tsx` (`limitProblem`, "What will run"), `structure-info.tsx`, `structure-preview.tsx`, and the NPT/OFF guards in `parameter-panel.tsx`.
- Status: CONFIRMED (executed).
  - Rock-salt NaCl as COD/Materials Project write it (asymmetric unit plus `_symmetry_equiv_pos_as_xyz`), with the client parser run on a scratch copy of `lib/parse-structure.ts`: `{"atomCount":2,"formula":"ClNa","isPeriodic":true,"minNeighborDist":4.88}`.
  - The same CIF through ASE (what the backend uses): `8 Cl4Na4`. Real min distance is 2.82 Å.
  - The tests only cover `public/demo/silicon.cif`, which lists all 8 atoms explicitly.
- Impact. "What will run: ClNa, 2 atoms" while 8 atoms run. Atom-count and atom-step limit warnings under-count. Structure info shows a wrong formula and a 4.88 Å min distance. The 3D preview shows 2 atoms.
- Fix: expand `_symmetry_equiv_pos_as_xyz` / `_space_group_symop_operation_xyz` (small op parser), or say "asymmetric unit only" when symop loops exist, or delegate parsing to the backend (ASE) for the preview.
- Related (LOW, PLAUSIBLE): `parsePOSCAR` multiplies the lattice by the scale factor but not Cartesian coordinates (`lib/parse-structure.ts:465, 501-514`), which breaks when scale ≠ 1 and the file is Cartesian. It also misparses VASP4 files with no element line. Lines `:465` (scale) and `:501-514` (direct-to-Cartesian only).

### F14. MED. Share button publishes permanently with no disclosure. The client hard-codes `consent: true`.
- Where: `lib/share.ts:34`; `app/calculate/page.tsx:486-499`, `:700-735`; server requires consent at `app/api/share/route.ts:95-97`.
- Status: PLAUSIBLE (read-only; `grep -rn consent app components lib` shows no consent UI).
- Evidence. The server insists on consent because "Sharing publishes this result permanently". The client asserts it unconditionally. The "Share result" button states no permanence, public access, filename disclosure (the file name is stored) or the full coordinates and forces being published.
- Fix: a one-line confirm step ("Anyone with the link can see this structure, its filename and results. It cannot be deleted from the app") before `saveResult`, and send `consent` from that choice.

### F15. MED. MACE Link renders unverified, client-supplied fields as facts, and a crafted row can break or freeze the page
- Where: `app/r/[id]/shared-result-view.tsx:264-275` (the "Reproducibility manifest attached… checkpoint SHA-256, library versions, source commit" paragraph), `:155-156` (citation includes `provenance.timestampUtc` verbatim), `app/r/[id]/result-context.ts:212` (`params.finalFmax.toFixed`), `:314, 319` (`timestampUtc`, `checkpointSha`; the embed later calls `.slice` on it), `components/calculate/metrics-dashboard.tsx:1599-1609` (`${REPO_URL}/commit/${code.gitCommit}`), `:1782-1832` (`ForcesTable` renders every row).
- Status: PLAUSIBLE (read-only). `app/api/share/route.ts` `validateResult` checks only status, symbols, positions, forces, energy, trajectory length and params-is-object. Everything else (provenance, validation, warnings, message, trajectory contents) is stored verbatim up to 3 MB, and anyone can POST.
- Consequences:
  - No XSS: no `dangerouslySetInnerHTML`/`eval`/`document.write`; React escapes all text. The WEAS iframe literal is JSON- and `<`-escaped, sandboxed without same-origin, version-pinned with SRI. The embed snippet escapes attribute values.
  - A forged row can show "Reproducibility manifest attached" with an invented checkpoint hash, "All automated checks passed", and a citation line for numbers SimpleAtom never computed. There is no "client-submitted, not verified" caveat.
  - `gitCommit = "../../../x/y/pull/1"` yields the "view" link `https://github.com/<owner>/<repo>/commit/../../../x/y/pull/1`, which normalises to another GitHub path (stays on github.com).
  - Non-string `provenance.timestampUtc`/`finalFmax`/`checkpoint.sha256` throw in the server render of `/r/[id]` and the embed (only that link breaks).
  - A 50,000-atom row with trivial numbers fits in 3 MB. `ForcesTable` and 3Dmol then render 50,000 rows and atoms. The same unbounded table applies to any large local run.
- Fix: say "This record was submitted by a browser client. SimpleAtom does not recompute or sign it" unless the server attaches a signature or HMAC of what it ran. Validate shapes server-side. Check `gitCommit` against `/^[0-9a-f]{7,40}$/` on both sides. Cap or virtualise the forces table.

### F16. MED. Run lifecycle: navigating away does not stop the job, one failed poll abandons it, and a Cancel during submit is lost
- Where: `app/calculate/page.tsx:264, 427, 476, 482` (`runAbort` is aborted only by the Cancel button; no unmount cleanup); `lib/api-client.ts:92-103` (`sleep`), `:112-141` (`runCalculationJob`); `components/calculate/model-comparison.tsx:41-54` / `app/calculate/page.tsx:392-406` (the compare job has no signal and no Cancel).
- Status: PLAUSIBLE (read-only).
- Evidence:
  - `lib/api-client.ts:118-120` claims "closing the panel or pressing Cancel stops the computation". Only the Cancel path does. Leaving `/calculate`, or closing the tab, leaves `runCalculationJob` polling, with `setState` on an unmounted component, until the job ends (hosted budget 240 s; local up to 3600 s). No `DELETE` is sent.
  - A single failed `GET /api/jobs/:id` (network blip, 502) throws inside `getJob`. The catch only cancels `if (signal?.aborted)`, so the job keeps running on the shared CPU while the UI says "Lost track of the calculation". The job id is never shown.
  - Cancel pressed while `submitJob` is in flight: `job` is unassigned and the server may already have created the job, so the job is orphaned.
  - `sleep` adds an `abort` listener that is never removed on normal completion. With an already-aborted signal it waits the full interval before the next fetch rejects.
- Fix: `useEffect(() => () => runAbort.current?.abort(), [])`. Retry transient poll errors 2–3 times with backoff and cancel the job when giving up. Make `sleep` check `signal.aborted` first and remove its listener. Pass an AbortSignal into the compare run.

### F17. MED. /v2 (public route) shows stale Matbench ranks and "SimpleAtom offers it nowhere"
- Where: `docs/v2/progress.json:35` rendered at `app/v2/page.tsx:159` (`{b.fetchable}`); same text in `docs/v2/SUCCESS-CRITERIA.md:93-97`.
- Status: CONFIRMED (executed): `curl -s http://localhost:3100/v2 | …` extracts "MACE-MP-0 ranks 34: F1 0.669 … MACE-MPA-0 ranks 21 and beats it on every published metric; SimpleAtom offers it nowhere."
- Problems:
  - The ranks are stale: re-fetched 2026-10-28 values are 36 and 22 of 43.
  - "SimpleAtom offers it nowhere" has been false since v2.2.0, where MPA-0 is the default.
  - `app/v2/page.tsx` uses `text-[#8A8478]` in 10 places (`:49, 68, 86, 94, 132, 159, 177, 183, 187, 209`) and `components/calculate/trajectory/energy-chart.tsx:396,406` (`fill="#8A8478"`). That is the colour the stylesheet retired at 3.3–3.7:1. It computes to about 3.6:1 on #FBFAF7, below AA.
- Fix: update the three strings (and re-date them), or render ranks from a fetched-at field. Use `text-text-muted` for those 12 spots.

### F18. MED. Docs describe verification and accuracy that the code does not provide
- Where:
  - `app/docs/validation/page.tsx` (test table).
  - `app/docs/page.tsx:85`.
  - `app/docs/calculations/page.tsx:93-95`.
  - `app/docs/validation/page.tsx` ("RMS force decreases monotonically").
- Status: CONFIRMED by reading `test_scripts/validate_calculation.py:321-400`.
- Evidence:
  - The docs say "five tests, all of which must pass" and "MACE-MP-0 Si bulk: energy/atom in the correct range (−5.37 eV), equilibrium forces near zero". Tests 1 and 2 append `"passed": True` unconditionally (`validate_calculation.py:340`, `:356`). They record numbers and assert nothing, so they cannot fail on physics.
  - "Ethanol optimisation: energy decreases monotonically and converges within the step limit". The test checks only `e_after <= e_before + 0.001`.
  - The self-test loads `mace_mp(model="small")` (MP-0), not the default MPA-0.
  - `app/docs/page.tsx:85`: "MLIPs have reached DFT-level accuracy". The project's own criterion (`docs/v2/SUCCESS-CRITERIA.md:97`) says no surface may imply DFT-equivalent accuracy without a qualifier. FAQ and models pages do carry the qualifier. This sentence does not.
  - The optimisation docs say "Watch the RMS force … it should decrease monotonically". BFGS gives no such guarantee. They also describe it as "moving atoms in the direction of the forces", which is steepest descent, not BFGS.
- Fix: assert the documented ranges in tests 1–2 (and test MPA-0), or reword the docs to match; qualify "DFT-level accuracy" ("approaches DFT accuracy on in-domain systems"); soften "monotonically" to "should trend down".

---

## LOW

### F19. LOW. EnergyReferenceNote and "Model accuracy" state conventions loosely
- Where: `components/calculate/metrics-dashboard.tsx:1747` ("total electronic energy … including all-electron atomic contributions", printed for every model); `:502-535, 600-612` ("Model accuracy": Energy MAE/error vs the file's `energy`/`ref_energy` key).
- Status: PLAUSIBLE.
- Evidence. "All-electron" is true for MACE-OFF (def2-TZVPPD). The MP family is referenced to VASP PAW (valence-only), which the models page itself calls "PBE-referenced totals". The accuracy card compares against whatever energy sits in the uploaded file's metadata, with no check that it is on the same convention as the model, and no caveat on the card.
- Fix: make the note model-specific; add "reference energy taken from file key `energy`; valid only if it uses this model's convention".

### F20. LOW. Benchmark labels and wording
- Where: `components/benchmark/benchmark-heatmap.tsx:144-148` (`shortenLabel` only handles "MACE-MP-0", so MPA-0 labels stay long); `components/benchmark/benchmark-config.tsx:463` (says non-OFF structures "will only run on MACE-MP-0"); `:236-282` + `:578-593` (they are actually excluded and disabled whenever any OFF model is selected).
- Status: CONFIRMED by reading.
- Fix: derive the short label from the registry; reword to "excluded while a MACE-OFF model is selected".

### F21. LOW. Export and clipboard failures are swallowed
- Where: `components/calculate/pdf-report.tsx:22-34` and `components/benchmark/benchmark-export.tsx:85` (dynamic `import()` with no `catch`); `app/calculate/page.tsx:500-505` (`navigator.clipboard.writeText` unhandled, "copied" state set regardless); PDF omits `result.warnings`, `converged` and the licence notice (`pdf-report-document.tsx:94-148`; the "Note" row carries `message`, which covers the not-converged case only).
- Status: PLAUSIBLE.
- Fix: `catch` with a visible error; mirror the try/catch used in `HashValue`; add warnings and convergence to the PDF.

### F22. LOW. Progress stages claim a phase before the backend reports one
- Where: `app/calculate/page.tsx:96-103` (`stageIndex` returns 3 for any running job without a phase); `lib/server/local-jobs.ts:77-79,159` (`progress: {}` while Python starts).
- Status: CONFIRMED by reading. The queued→running flip happens at spawn, before imports finish.
- Evidence. "Reading structure ✓ Loading model ✓ Computing" is shown during Python import time, contradicting the comment "every value shown now comes from the backend".
- Note on a dropped candidate: `stepSummary` with `totalSteps: null` ("of at most null") is not reachable today. `calculate.py:101,109` always sends a total with a numeric step. A null guard is still cheap.
- Fix: treat "running with no phase" as a "Starting" stage.

### F23. LOW. Compare run reuses a stale `modelSize`
- Where: `app/calculate/page.tsx:400-403`; `components/calculate/parameter-panel.tsx:171-197` (size reset skips models with no sizes, i.e. custom).
- Status: PLAUSIBLE. `contract.json` gives MPA-0 sizes `['medium']`, and `checkCalculationParams` refuses `unsupported_model_size` otherwise.
- Scenario. Pick MP-0 "large", switch to Custom (the size stays "large", select disabled), run, click Compare on a periodic structure: `{modelType:'MACE-MPA-0', modelSize:'large'}` is rejected.
- Fix: set `modelSize` from the chosen foundation model's `defaultSize`.

### F24. LOW. Model is switched by filename prefix
- Where: `app/calculate/page.tsx:305-317` (`files[0].name.startsWith("smiles_")` forces MACE-OFF).
- Status: PLAUSIBLE.
- Evidence. This is the pattern D1 removed elsewhere ("picked from the parsed structure, never from the FILENAME"). A user file named `smiles_x.cif`, or a SMILES with an element outside OFF's ten, gets MACE-OFF silently over the user's earlier model choice.
- Fix: mark SMILES-generated Files with an explicit flag, not a name prefix.

### F25. LOW. Upload accepts fewer extensions than the contract
- Where: `components/calculate/file-upload-section.tsx:38` (`.xyz .cif .poscar .contcar .pdb`) versus `contract.json` `structureExtensions` (adds `.extxyz`, `.vasp`) and bare `POSCAR`/`CONTCAR`.
- Status: CONFIRMED by reading. The `accept` attribute greys out bare `POSCAR` files in the picker.
- Fix: build `accept` from `CONTRACT.structureExtensions`; docs say the same four.

### F26. LOW. Attribution text for the catalog contradicts the source header
- Where: `components/calculate/mlpeg-catalog.tsx:160-173` ("Structures from ml-peg v0.2.2 · GPL-3.0 license"); `lib/mlpeg-catalog.ts:15-22` ("generated using ASE's bulk() builder … matching what ml-peg uses").
- Status: PLAUSIBLE.
- Evidence. The two cannot both be true. F1 shows these are hand-written approximations, not ml-peg files, so "from ml-peg v0.2.2" and a GPL notice overstate their provenance.
- Fix: say "modelled on ml-peg's benchmark set"; keep the GPL notice only if files really are copied.

### F27. LOW. Viewer effects
- Where: `components/calculate/trajectory/trajectory-viewer.tsx:195-203` (XYZ built once into a ref, never rebuilt if `traj`/`symbols` change; ESLint `react-hooks/refs` error), `:215-243` (async `import("3dmol")` with no cancel flag, so a ResizeObserver created after unmount is never disconnected), `:263-267` (`setPlaying` inside a state updater); `components/calculate/structure-preview.tsx:98-129` (no cancel token, so a slow parse can overwrite a newer file's preview).
- Status: PLAUSIBLE. Today the dashboard remounts per run, so the ref staleness is latent.
- Fix: `useMemo` keyed on `traj`; `let cancelled` flags.

### F28. LOW. Touch targets and names on docs pages at 375 px
- Where: docs nav links 327×32 px, pager links 36 px high, footer "MACE" link 15 px (executed on `/docs/calculations`).
- Status: CONFIRMED (executed). `/calculate` and `/benchmark` default states have none under 44 px, and no horizontal overflow (`scrollWidth 375`).
- Fix: `min-h-11` on `docs-nav`/pager anchors.

### F29. LOW. Smaller doc and copy mismatches
- "Click Calculate" and "Click Share Result" in `app/docs/getting-started/page.tsx` versus the real buttons "Run calculation" and "Share result".
- The landing CTA says "results in seconds" (`components/intro-section.tsx:487`, frozen file). Docs say the first hosted run is about 30 s.
- The benchmark note "All calculations run at float64 precision on CPU" (`benchmark-config.tsx:~470`) is true for foundation models (route sets `precision:"float64", device:"cpu"`) but not for an uploaded custom checkpoint (it keeps its own dtype).

---

## Cross-references for the backend/API reviewer (not frontend code)
- `lib/server/share-store.ts:36-41` `loadResult` does not filter `deleted_at`, although migration 0002 adds that soft-delete column. A takedown would have no effect.
- `app/api/share/route.ts:46-68` `validateResult` stores `provenance`, `validation`, `warnings`, `message` and trajectory contents unvalidated (feeds F15).
- `/r/[id]` returns HTTP 200 for the "sharing unavailable" state (executed: `/r/abcd1234` → 200 on the dev server with no Supabase). A transient outage should be 503 and uncacheable.
- `test_scripts/validate_calculation.py:340, 356` tests 1 and 2 have `"passed": True` hard-coded (feeds F18).
- Stale Matbench text in `docs/v2/SUCCESS-CRITERIA.md:93-97` and `docs/v2/progress.json:35` (feeds F17).

---

## Checked and fine
- Typecheck, tests, lint. tsc clean. Vitest 40/40. ESLint 15 problems, equal to the baseline the token-codemod commit reports. All are `react-hooks/*` plus one `no-explicit-any` (`structure-preview.tsx:85`). Only `trajectory-viewer.tsx:197` is a latent defect (F27).
- Colour-token codemod (64ad4d1). I extracted all 111 distinct semantic colour utilities used in `app/` and `components/` (excluding frozen `intro-section.tsx`) and looked each one up in the compiled CSS served by the dev server. 0 are missing. The `@theme inline reference` block works. The 51 `[var(--color-…)]` classes left in `intro-section.tsx` are valid CSS. `border-l-*`/`border-t-*` colour utilities resolve. `touch-target` exists as an `@utility`. The Turbopack `@utility` trap did not bite here.
- Contract mirror. `lib/generated/contract.ts` equals `mace-api/contract.json` (full deep compare run; only the `$comment` key differs, as the generator drops it). UI `NumberField` min/max come from `PARAMS`, further capped by `caps.limits`. They match the backend bounds (e.g. temperature 0–5000 K, timeStep 0.1–4 fs, pressure 0–1000 GPa). Every key the UI sends exists in the contract, or is an allowed label (`customModelName`). `modelSize` for custom is ignored by `checkCalculationParams`.
- Framing headers (executed `curl -D`). Only exact `/r/<id>/embed` has `frame-ancestors *` and no X-Frame-Options. `/`, `/calculate`, `/r/x`, `/r/x/embedded`, `/r/x/embed/y` all send `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`. `/r/x/embed/` redirects with 308.
- XSS and injection sinks. No `dangerouslySetInnerHTML`, `eval`, `new Function` or `document.write` anywhere in app, components or lib. `innerHTML` is only ever set to `""`. WEAS iframe: pinned version, SRI, `sandbox="allow-scripts"` only, JSON-escaped data with `<` escaped. Embed snippet title and src attributes are escaped. Prototype pollution is not a vector: `JSON.parse` own `__proto__` keys do not reach `Object.prototype`, and the code only spreads, never deep-merges.
- MACE Link route. `/r/[id]` returns a real 404 for a missing row. `SHARE_ID_PATTERN` is checked before any lookup. `generateMetadata` marks missing and unavailable states `noindex`.
- Docs claims that hold. BFGS is the only optimiser and FIRE is never mentioned. Cell optimisation is stated as unsupported. Phonon is refused consistently in the UI (disabled option and `runBlockedReason`), the docs and the backend. GPa is user-facing, with "1 GPa = 10,000 bar" and "1 GPa ≈ 0.00624 eV/Å^3" correct, and "nothing uses bar". D3 is limited to the MP family everywhere (UI toggle, docs, contract). Matbench F1/MAE numbers (0.852/0.028, 0.669/0.057) match `contract.json`. I did not re-fetch the live leaderboard for those. The hosted limits quoted in the docs (1,000 atoms / 10,000 MD steps) match the hosted profile.
- Science helpers. `computeRmsForce` uses sqrt(Σ|F|²/N_atoms), as required. `hasPositiveVolume` uses |det|. `foundationModelFor` decides from the parsed structure, not the filename (D1 stays fixed).
- Accessibility basics. Skip link, `<html lang="en">`, the progress bar has `role="progressbar"` and a label, the error box has `role="alert"`. Under `prefers-reduced-motion` spinners and shimmer fall back. The Run, Cancel and Select controls meet 44 px at 375 px.
- Polling terminates on succeeded/failed/cancelled. Cancel aborts the fetch and sends DELETE. `useCapabilities` caches one promise and resets on failure. `NumberField` clamps on blur before the click lands.
- Cleared as not defects: force RMSE/MAE use per-component counts (labelled "RMSE", a different quantity from per-atom RMS force); the "Calculation complete" wording on `result.status === "success"` is accurate for the success path.
