import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "Getting started",
  description:
    "Run your first MACE calculation in SimpleAtom: use the hosted version with no install, provide a structure by upload, catalog, SMILES, or drawing, and share your result with a permanent link.",
};

export default function GettingStartedPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-[var(--color-accent-strong)]">
          Introduction
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Getting started
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-[var(--color-text-secondary)]">
          The fastest way to run a MACE calculation is the hosted version —
          there is nothing to install. This page also covers running
          SimpleAtom locally, the four ways to provide a structure, and how
          to share a result.
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="hosted">Using the hosted version</h2>
        <p>
          The live app at{" "}
          <a
            href="https://mace-lake.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            mace-lake.vercel.app
          </a>{" "}
          runs calculations on a remote backend. There is no local Python, no
          command line, and no account required — open the link and go
          straight to the calculator.
        </p>
        <Callout type="note" title="First calculation is slower">
          The first calculation on a given model takes roughly 30 seconds
          while the model checkpoint downloads. It is cached afterward, so
          subsequent runs are fast. See{" "}
          <Link href="/docs/faq">FAQ &amp; troubleshooting</Link> for details.
        </Callout>

        <h2 id="local">Running locally</h2>
        <p>
          If you prefer to run SimpleAtom on your own machine — for example
          to use a local GPU, or to work offline — you&rsquo;ll need Node.js
          18+ for the frontend and Python 3.10+ for the backend.
        </p>
        <pre>
          <code>{`git clone https://github.com/Jamessfks/simpleatom.git && cd simpleatom
npm install                    # frontend dependencies
pip install mace-torch ase     # backend (MACE + ASE)

npm run dev                    # starts the dev server`}</code>
        </pre>
        <p>
          Open{" "}
          <a
            href="http://localhost:3000"
            target="_blank"
            rel="noopener noreferrer"
          >
            http://localhost:3000
          </a>
          . Model checkpoints (~2 GB total across sizes) download on first use
          and are cached locally afterward. To confirm your local
          installation is scientifically correct, run the automated
          validation suite — see{" "}
          <Link href="/docs/validation">Validation &amp; reproducibility</Link>.
        </p>
        <pre>
          <code>python test_scripts/validate_calculation.py --test</code>
        </pre>

        <h2 id="providing-a-structure">Providing a structure</h2>
        <p>
          The calculator at <code>/calculate</code> accepts a structure four
          ways:
        </p>
        <ul>
          <li>
            <strong>Upload a file</strong> — drag and drop <code>.xyz</code>,{" "}
            <code>.cif</code>, <code>.poscar</code>, or <code>.pdb</code>.
            The parser auto-detects the format from the extension and reads
            atom count, chemical formula, bounding box, lattice vectors (for
            periodic systems), and any reference energies/forces embedded in
            extended XYZ metadata.
          </li>
          <li>
            <strong>Pick from the catalog</strong> — choose one of 14
            built-in benchmark structures spanning five categories, useful
            for quick tests or comparing models on a known system.
          </li>
          <li>
            <strong>Paste a SMILES string</strong> — enter a SMILES notation
            for a molecule and SimpleAtom converts it to a 3D structure
            automatically.
          </li>
          <li>
            <strong>Draw a molecule</strong> — use the built-in 2D/3D
            molecular editor to sketch a structure directly in the browser.
          </li>
        </ul>
        <Callout type="note">
          Structures larger than 500 atoms may run slowly. If a file
          contains multiple frames (a trajectory), only the first frame is
          used.
        </Callout>

        <h2 id="first-calculation">Running your first calculation</h2>
        <ol>
          <li>Provide a structure using any of the four methods above.</li>
          <li>
            Choose a foundation model (<Link href="/docs/models">MACE-MPA-0,
            MACE-MP-0 or MACE-OFF</Link>; your own checkpoint when running
            locally), a model
            size, and a{" "}
            <Link href="/docs/calculations">calculation type</Link> —
            single-point, geometry optimization, or molecular dynamics.
          </li>
          <li>Click Calculate and wait for the result.</li>
          <li>
            Explore the five-tab dashboard — Summary, Forces, Energy,
            Structure and Raw data — with an interactive 3D viewer and
            charts.
          </li>
        </ol>

        <h2 id="guided-demo">The guided demo</h2>
        <p>
          Not sure where to start? Visit{" "}
          <code>/calculate?demo=true</code> — it preloads an ethanol molecule
          and walks you through each step of the interface, from structure
          to results.
        </p>

        <h2 id="sharing">Sharing results</h2>
        <p>
          Every calculation can be published as a permanent, citable link
          (a &ldquo;MACE Link&rdquo;) — for example{" "}
          <code>mace-lake.vercel.app/r/gK7tabOE</code>. Click{" "}
          <strong>Share Result</strong> after a run completes. Anyone with
          the link can view the full result dashboard, no login required,
          and shared results are immutable once created — the same link
          always shows the same result, which keeps citations stable.
        </p>

        <Callout type="tip" title="Next steps">
          Once you have a result you trust, read{" "}
          <Link href="/docs/units">Units &amp; conventions</Link> to
          interpret the numbers correctly, and{" "}
          <Link href="/docs/validation">
            Validation &amp; reproducibility
          </Link>{" "}
          to sanity-check it.
        </Callout>
      </article>

      <DocsPager pathname="/docs/getting-started" />
    </>
  );
}
