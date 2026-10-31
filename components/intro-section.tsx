"use client";

/**
 * IntroSection — landing content for SimpleAtom.
 *
 * A calm, humanist introduction that leads with the product's reason to
 * exist: making DFT-trained machine-learning simulation accessible without installation,
 * a command line, or an HPC allocation. Sections:
 *   1. Hero            — split layout: positioning + CTAs on the left, a
 *                         real, live, interactive MACE structure on the
 *                         right (lazy-loaded so it never blocks first paint).
 *                         Genuine, checkable proof (provenance + license/
 *                         access facts) is promoted directly under the left
 *                         column's CTAs, not a separate strip — see the
 *                         "Proof, promoted" comment below for why
 *   2. Workflow        — the four-step path from structure to insight
 *   3. Capabilities    — what you can actually compute
 *   4. Foundation models — MACE-MP-0 vs MACE-OFF, described scientifically
 *   5. Accessibility   — why a browser-native interface matters
 *   6. Call to action  — enter the calculator
 *
 * Density/rhythm follows a measured reference (docs/v2/bars/rowan.md):
 * 1024px (max-w-5xl) content width, 24px gutters, 96px section rhythm, a
 * 48px / leading-none h1, and 16px/24px body and button text.
 *
 * Radius scale — one dominant value with three deliberate exceptions,
 * mirroring the reference's 6/4/8/pill distribution rather than our
 * previous flat spread of six competing values:
 *   6px   dominant — cards, tiles, icon chips, buttons
 *   8px   the 3D viewer frame only (and its loading placeholder)
 *   4px   small controls inside the viewer
 *   pill  the eyebrow badge, the Support pill, list bullets
 * Note: the 4px instances and the viewer frame live in
 * components/calculate/molecule-viewer-3d.tsx, which currently renders that
 * frame at `rounded-lg` (12px) — that file is owned elsewhere and still
 * needs to come down to 8px for this scale to actually close.
 *
 * Typeface, palette, and copy remain SimpleAtom's own.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { CalculationResult } from "@/types/mace";
import {
  Upload,
  SlidersHorizontal,
  Cpu,
  LineChart,
  Layers,
  Orbit,
  Waves,
  Box,
  GitCompareArrows,
  Share2,
  ArrowRight,
  Check,
} from "lucide-react";

/* ── Hero molecule: a real structure, not a mock ──────────────────────────
 * Coordinates copied verbatim from public/demo/ethanol.xyz (the same demo
 * structure used on the calculate page). No calculation is run for the
 * hero — there is no energy/forces yet — but the geometry is genuine, and
 * the viewer below is the actual production 3Dmol.js/WEAS component, fully
 * interactive (drag to rotate, scroll to zoom).
 */
const HERO_STRUCTURE: CalculationResult = {
  status: "success",
  symbols: ["C", "C", "O", "H", "H", "H", "H", "H", "H"],
  positions: [
    [-0.748466, -0.015294, 0.024493],
    [0.726935, 0.055088, -0.032919],
    [1.267942, -0.536699, 1.135318],
    [-1.145635, 0.990252, -0.108102],
    [-1.109182, -0.586387, -0.836565],
    [-1.142804, -0.473195, 0.93518],
    [1.084173, 1.094437, -0.067561],
    [1.078203, -0.428093, -0.951279],
    [0.944338, -1.450389, 1.119877],
  ],
};

/* Lazy-load the 3D viewer (3Dmol.js + WEAS + Three.js are heavy). Splitting
 * it into its own chunk with `ssr: false` keeps it off the critical path
 * for first paint — the hero text and CTAs render immediately, and the
 * viewer streams in behind a lightweight placeholder of the same size. */
const LazyMoleculeViewer3D = dynamic(
  () =>
    import("@/components/calculate/molecule-viewer-3d").then(
      (mod) => mod.MoleculeViewer3D
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex w-full items-center justify-center rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]"
        style={{ minHeight: 492 }}
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border-subtle)] border-t-[var(--color-accent-primary)]" />
      </div>
    ),
  }
);

/* ── Primary/secondary call-to-action sizing ──────────────────────────────
 * The base `Button` (components/ui/button.tsx, shared — not edited here)
 * ships a 14px label on a 10px radius. Both are one step off the measured
 * reference, which sets buttons at 16px/24px on a 6px radius, so each
 * landing CTA overrides them locally.
 *
 * `has-[>svg]:px-7` is not decoration: the shared `lg` size drops padding
 * to 16px when the button contains an icon, so "Launch the calculator"
 * (which has an arrow) was rendering visibly narrower-padded than the
 * plain-text button beside it. This pins both to the same 28px.
 */
const CTA_CLASS = "h-11 rounded-[6px] px-7 text-base has-[>svg]:px-7";

/* ── Four-step workflow (structure → method → run → results) ── */
const WORKFLOW = [
  {
    icon: Upload,
    title: "Provide a structure",
    description:
      "Upload XYZ, CIF, POSCAR, or PDB files, paste a SMILES string, sketch a molecule, or pick from a curated benchmark catalog.",
  },
  {
    icon: SlidersHorizontal,
    title: "Choose a model & calculation",
    description:
      "Select a MACE foundation model (or your own fine-tuned checkpoint), then a single-point energy, geometry optimization, or molecular-dynamics run.",
  },
  {
    icon: Cpu,
    title: "Run the calculation",
    description:
      "The structure is evaluated with ASE and mace-torch on managed compute — no local install, no queue script, no cluster account.",
  },
  {
    icon: LineChart,
    title: "Explore & share results",
    description:
      "Inspect energies, forces, and trajectories in interactive 3D and publication-quality charts, then export or share a permanent link.",
  },
];

/* ── Core capabilities ── */
const CAPABILITIES = [
  {
    icon: Layers,
    title: "Foundation models",
    description:
      "Run MACE-MP-0 and MACE-OFF out of the box, or upload a fine-tuned .model checkpoint for a custom potential.",
  },
  {
    icon: Orbit,
    title: "Geometry optimization",
    description:
      "Relax structures to a local minimum with BFGS, converging forces to a target threshold in eV/Å.",
  },
  {
    icon: Waves,
    title: "Molecular dynamics",
    description:
      "Propagate NVE, NVT (Langevin), or NPT trajectories with Maxwell–Boltzmann initial velocities and femtosecond timesteps.",
  },
  {
    icon: Box,
    title: "Interactive 3D structures",
    description:
      "Visualize geometries and per-atom force vectors, and animate MD trajectories with dual rendering engines.",
  },
  {
    icon: GitCompareArrows,
    title: "Model benchmarking",
    description:
      "Compare foundation models and your own checkpoints across reference structures on energy and force error metrics.",
  },
  {
    icon: Share2,
    title: "Reproducible sharing",
    description:
      "Every result can be exported (CSV, JSON, PDF) or published as a permanent, read-only link for collaborators.",
  },
];

/* ── Proof, promoted ──────────────────────────────────────────────────────
 * Round 2 shipped a four-tile stat grid ("3 Calculation types", "4
 * Structure file formats", …) as a full-width strip below the hero grid.
 * Measured against docs/v2/bars/rowan.md, that lost on two counts:
 *
 *   1. Single-digit counts read as anti-proof — they draw the eye to how
 *      small the numbers are, in the exact slot where the reference puts a
 *      twelve-logo customer marquee.
 *   2. The strip's vertical position was inherited from the hero grid's
 *      row height, which is set by whichever column is taller. The 3D
 *      viewer column (components/calculate/molecule-viewer-3d.tsx, owned
 *      elsewhere in this round) is the tall one, so the strip's position
 *      depended on a file this component doesn't control: it measured at
 *      104px tall starting at y=791, with only 9px clearing an 800px fold.
 *
 * Fix: no separate strip. The strongest true claim on the page — built on
 * MACE, from the University of Cambridge — is promoted out of a buried
 * 14px attribution line into its own sentence directly under the CTAs,
 * followed by the rest of what's actually true and verifiable (free,
 * MIT-licensed, no account, runs in the browser) as a short checked list.
 * Living inside the left column instead of below the full grid — combined
 * with `items-start` instead of `items-center` on the hero grid below —
 * means its position is a function of this file's own type sizes only,
 * never the viewer column's rendered height.
 *
 * No usage numbers, customer counts, or logos appear here. SimpleAtom has
 * none to show, and inventing any would be worse than this shorter list.
 */
const PROOF_CLAIMS = [
  "Free",
  "Open source (MIT)",
  "No account required",
  // Not "runs entirely in your browser": the interface does, the MACE
  // calculation runs on a server. A claim the page itself contradicted.
  "Nothing to install",
];

/* ── Foundation model cards ── */
const MODELS = [
  {
    name: "MACE-MPA-0",
    domain: "Materials & inorganic chemistry",
    theory: "Trained on PBE/PBE+U DFT (MPtrj + sAlex) · MACE-MP-0 also available",
    points: [
      "Crystals, surfaces, and bulk systems across 89 elements",
      "Periodic boundary conditions and cell-aware dynamics",
      "Optional D3 dispersion correction",
    ],
  },
  {
    name: "MACE-OFF",
    domain: "Organic molecules",
    theory: "Trained on ωB97M-D3BJ DFT (SPICE) · Academic Software License",
    points: [
      "Neutral organic molecules (H, C, N, O, F, P, S, Cl, Br, I)",
      "Dispersion already included — no separate D3 term",
      "Conformers and drug-like molecules; non-commercial use only",
    ],
  },
];

export function IntroSection() {
  return (
    <>
      {/* ═══════════════════════════ Hero ═══════════════════════════ */}
      <section className="relative overflow-hidden">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
            {/* ── Left: positioning + CTAs ── */}
            <div>
              <span className="inline-flex items-center rounded-full border border-[var(--color-border-emphasis)] bg-[var(--color-accent-soft)] px-4 py-1.5 text-xs font-medium tracking-wide text-[var(--color-accent-strong)]">
                Machine-learning interatomic potentials
              </span>

              {/* No hard <br/>: at the 456px hero column an explicit break
                * turned an intended two-line headline into four, ending on
                * a lone word. `text-balance` lets the browser even out the
                * rag instead, and reclaims a full 48px line of vertical. */}
              <h1 className="mt-6 text-balance font-serif text-4xl font-semibold leading-none tracking-tight text-[var(--color-text-primary)] sm:text-5xl">
                DFT-trained force fields, right in your browser.
              </h1>

              <p className="mt-6 max-w-xl text-base text-[var(--color-text-secondary)]">
                SimpleAtom is a free, open interface to{" "}
                <span className="text-[var(--color-text-primary)]">MACE</span>{" "}
                machine-learning force fields. Compute energies, relax geometries,
                and run molecular dynamics on your molecules and materials — with
                no installation, no command line, and no supercomputer account.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className={CTA_CLASS}>
                  <Link href="/calculate">
                    Launch the calculator
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className={CTA_CLASS}
                >
                  <Link href="/calculate?demo=true">See a guided demo</Link>
                </Button>
              </div>

              {/* Promoted proof — see the "Proof, promoted" comment above
                * PROOF_CLAIMS. Replaces both the old 14px attribution line
                * and the four-tile stat strip that used to sit below the
                * grid: the strongest true claim gets its own sentence, the
                * rest of what's true and verifiable follows as a checked
                * list, and none of it restates the lead paragraph. */}
              <p className="mt-8 text-base font-medium text-[var(--color-text-primary)]">
                Built on{" "}
                <span className="text-[var(--color-accent-strong)]">
                  MACE
                </span>
                , the open-source machine-learning potential developed at
                the University of Cambridge.
              </p>
              {/* Explicit 2x2 grid, not `flex flex-wrap`: at the 456px column
                * width, flex-wrap left the fourth claim alone on row two,
                * reading as an accidental orphan rather than a deliberate
                * break. `grid-cols-[auto_auto]` (content-sized columns, not
                * 1fr) sizes each column to its widest item, so both rows hold
                * exactly two items and the break reads as intentional. The
                * fourth claim used to be "Runs entirely in your browser",
                * which was false — the calculation runs on a server — and is
                * now "Nothing to install" (v2.2.0). */}
              <ul className="mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5">
                {PROOF_CLAIMS.map((claim) => (
                  <li
                    key={claim}
                    className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]"
                  >
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                    {claim}
                  </li>
                ))}
              </ul>
            </div>

            {/* ── Right: a real, live molecule ── */}
            <div className="mx-auto w-full max-w-md lg:mx-0">
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)] lg:text-left">
                Live in your browser · ethanol, C₂H₅OH
              </p>
              <LazyMoleculeViewer3D result={HERO_STRUCTURE} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ Workflow ═══════════════════════ */}
      <section className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              From structure to insight in four steps
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)]">
              A guided workflow that mirrors how computational chemists actually
              work — without the setup that usually stands in the way.
            </p>
          </div>

          <ol className="mt-14 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW.map((step, i) => (
              <li key={step.title} className="relative">
                <span className="font-mono text-sm font-medium text-[var(--color-accent-primary)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="mt-4 flex h-11 w-11 items-center justify-center rounded-[6px] bg-[var(--color-accent-soft)] text-[var(--color-accent-primary)]">
                  <step.icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">
                  {step.title}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-[var(--color-text-secondary)]">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ═══════════════════ Capabilities ═══════════════════ */}
      <section className="border-t border-[var(--color-border-subtle)]">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Built for real computational chemistry
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)]">
              The methods practitioners rely on, wrapped in an interface that
              anyone can pick up — from experimentalists to students.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((cap) => (
              <div
                key={cap.title}
                className="result-card rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-6"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-[6px] bg-[var(--color-accent-soft)] text-[var(--color-accent-primary)]">
                  <cap.icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[var(--color-text-primary)]">
                  {cap.title}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-[var(--color-text-secondary)]">
                  {cap.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ Foundation models ═══════════════ */}
      <section className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
        <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              Two foundation models, one interface
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--color-text-secondary)]">
              MACE ships pre-trained potentials for distinct chemical domains.
              SimpleAtom picks sensible defaults, and explains the trade-offs so
              you choose deliberately.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {MODELS.map((model) => (
              <div
                key={model.name}
                className="rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-8"
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-mono text-lg font-semibold text-[var(--color-text-primary)]">
                    {model.name}
                  </h3>
                </div>
                <p className="mt-1 text-base font-medium text-[var(--color-accent-strong)]">
                  {model.domain}
                </p>
                <p className="mt-3 text-base text-[var(--color-text-secondary)]">
                  {model.theory}
                </p>
                <ul className="mt-5 space-y-2.5">
                  {model.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-2.5 text-base leading-relaxed text-[var(--color-text-secondary)]"
                    >
                      <span
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent-primary)]"
                        aria-hidden
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ Accessibility positioning ═══════════════ */}
      <section className="border-t border-[var(--color-border-subtle)]">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center sm:py-24">
          <p className="font-serif text-2xl font-medium leading-snug text-[var(--color-text-primary)] sm:text-3xl">
            &ldquo;Computational chemistry has long lived on remote clusters,
            behind the command line. SimpleAtom moves the first step into the
            browser — so a good idea doesn&rsquo;t have to wait on an
            installation.&rdquo;
          </p>
          <p className="mt-6 text-sm text-[var(--color-text-muted)]">
            Designed for accessibility, reproducibility, and teaching
          </p>
        </div>
      </section>

      {/* ═══════════════════════ CTA band ═══════════════════════ */}
      <section className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-24">
          <h2 className="font-serif text-3xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
            Run your first calculation
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--color-text-secondary)]">
            Start with a demo molecule or bring your own structure. No account,
            no setup — results in seconds.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className={CTA_CLASS}>
              <Link href="/calculate">
                Launch the calculator
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className={CTA_CLASS}>
              <Link href="/docs">Read the documentation</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
