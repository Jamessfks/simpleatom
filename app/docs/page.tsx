import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "SimpleAtom is a free, browser-based interface to MACE machine-learning interatomic potentials — DFT-trained energies, forces, and dynamics with no installation, command line, or HPC account.",
};

export default function DocsOverviewPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-accent-strong">
          Documentation
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-text-primary">
          Overview
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-text-secondary">
          SimpleAtom is a free, browser-based interface to the{" "}
          <a
            href="https://github.com/ACEsuit/mace"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-strong underline underline-offset-2"
          >
            MACE
          </a>{" "}
          family of machine-learning interatomic potentials.
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="what-is-simpleatom">What is SimpleAtom?</h2>
        <p>
          SimpleAtom lets you run DFT-trained atomistic calculations —
          single-point energies and forces, geometry optimizations, and
          molecular dynamics — directly in your web browser. You upload or
          sketch a structure, choose a pre-trained MACE model, and read back
          energies, per-atom forces, and trajectories with interactive 3D
          visualization and publication-quality charts.
        </p>
        <p>
          There is <strong>nothing to install</strong>: no Python environment,
          no command line, and no high-performance-computing (HPC) allocation.
          Calculations are executed server-side with{" "}
          <a
            href="https://wiki.fysik.dtu.dk/ase/"
            target="_blank"
            rel="noopener noreferrer"
          >
            ASE
          </a>{" "}
          (the Atomic Simulation Environment) and{" "}
          <code>mace-torch</code>, and returned to the browser as structured
          results.
        </p>

        <h2 id="what-are-mlips">
          What are machine-learning interatomic potentials?
        </h2>
        <p>
          Interatomic potentials predict a system&rsquo;s potential energy (and
          its gradient, the forces on each atom) as a function of atomic
          positions. Classical force fields are fast but approximate; density
          functional theory (DFT) is accurate but expensive. Machine-learning
          interatomic potentials (MLIPs) are trained on DFT (or higher-level)
          reference data to reproduce that accuracy while running orders of
          magnitude faster.
        </p>
        <p>
          <strong>MACE</strong> (Multi-Atomic Cluster Expansion) is a
          higher-order equivariant message-passing neural network introduced by
          Batatia et al. (NeurIPS 2022). Its <em>foundation models</em> are
          pre-trained on large DFT datasets and generalize across chemistries
          out of the box, which is what makes a zero-configuration web interface
          possible.
        </p>

        <h2 id="mission">The mission: accessible computational chemistry</h2>
        <p>
          MLIPs have reached DFT-level accuracy, yet using them still typically
          demands Python scripting, command-line fluency, and cluster access —
          barriers that exclude experimentalists, students, researchers in
          under-resourced labs, and scientists with accessibility needs.
          SimpleAtom exists to remove that first barrier and put a good idea one
          click away from a result.
        </p>
        <Callout type="note" title="Why this matters">
          The interface is built with accessibility as a first principle:
          keyboard navigation, ARIA semantics, a colorblind-safe data palette
          (Paul Tol), and a calm, low-contrast visual design.
        </Callout>

        <h2 id="how-it-works">How it works</h2>
        <p>The workflow mirrors how computational chemists actually work:</p>
        <ol>
          <li>
            <strong>Provide a structure</strong> — upload a file (XYZ, CIF,
            POSCAR, PDB), paste a SMILES string, sketch a molecule, or pick from
            a benchmark catalog.
          </li>
          <li>
            <strong>Choose a model &amp; calculation</strong> — a MACE
            foundation model (or your own fine-tuned checkpoint), then a
            single-point, geometry-optimization, or molecular-dynamics run.
          </li>
          <li>
            <strong>Run</strong> — the structure is evaluated server-side with
            ASE + mace-torch.
          </li>
          <li>
            <strong>Explore &amp; share</strong> — inspect results in 3D and in
            charts, export (CSV, JSON, PDF), or publish a permanent shareable
            link.
          </li>
        </ol>

        <h2 id="next">Where to next</h2>
        <ul>
          <li>
            <Link href="/docs/getting-started">Getting started</Link> — run your
            first calculation.
          </li>
          <li>
            <Link href="/docs/models">Foundation models</Link> — pick the right
            model for your system.
          </li>
          <li>
            <Link href="/docs/calculations">Calculations &amp; parameters</Link>{" "}
            — what each calculation type does and how to configure it.
          </li>
          <li>
            <Link href="/docs/units">Units &amp; conventions</Link> — the eV /
            Å / K / fs conventions used throughout.
          </li>
        </ul>
      </article>

      <DocsPager pathname="/docs" />
    </>
  );
}
