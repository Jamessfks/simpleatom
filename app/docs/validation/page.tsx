import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "Validation & reproducibility",
  description:
    "How SimpleAtom validates scientific results — the validator's self-test and what each of its five tests does and does not assert, physical-bounds checks, a manual verification checklist, citing MACE, and known limitations of foundation models.",
};

export default function ValidationPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-accent-strong">
          Science
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-text-primary">
          Validation &amp; reproducibility
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-text-secondary">
          A number that comes out of a calculator is only useful if you
          trust it. SimpleAtom includes an automated validator for physical
          plausibility, and every shared result is a permanent, citable
          artifact.
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="automated-suite">Automated validation suite</h2>
        <p>Run the full suite from the backend:</p>
        <pre>
          <code>python test_scripts/validate_calculation.py --test</code>
        </pre>
        <p>
          This runs five self-tests with real MACE calculations. It loads
          MACE-MP-0 (small) and MACE-OFF (small), not the default MACE-MPA-0,
          so it checks the calculation plumbing and the validator, not the
          default model&rsquo;s accuracy. Three tests assert something; two
          only record numbers:
        </p>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>What it does</th>
              <th>Asserted?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>MACE-MP-0 Si bulk</td>
              <td>
                Single-point on a 2-atom diamond cell (a = 5.43 &Aring;).
                Records the energy per atom and the largest force.
              </td>
              <td>
                No. It records the energy and the force without checking
                either, so it cannot fail on physics.
              </td>
            </tr>
            <tr>
              <td>MACE-OFF H&#8322;O</td>
              <td>
                Single-point on an isolated water molecule. Records the
                energy and the largest force.
              </td>
              <td>No. It records the numbers without checking them.</td>
            </tr>
            <tr>
              <td>Ethanol geometry optimization</td>
              <td>
                MACE-OFF, up to 100 BFGS steps with fmax 0.05 eV/&Aring;.
              </td>
              <td>
                Yes, but only that the energy does not rise: the final energy
                must be no more than 0.001 eV above the starting energy. It
                does not check that the optimization converged, or that the
                energy fell at every step.
              </td>
            </tr>
            <tr>
              <td>Force conservation</td>
              <td>
                The net force on the isolated water molecule, a
                translation-invariance check.
              </td>
              <td>Yes: it must be below 0.01 eV/&Aring;.</td>
            </tr>
            <tr>
              <td>Result validation</td>
              <td>
                The physical-bounds checks listed below, run on the silicon
                single-point result.
              </td>
              <td>Yes: the validator must report the result valid.</td>
            </tr>
          </tbody>
        </table>
        <p>You can also validate a single result directly:</p>
        <pre>
          <code>{`# From a JSON string
python test_scripts/validate_calculation.py '<result_json>'

# From a file
python test_scripts/validate_calculation.py result.json`}</code>
        </pre>

        <h2 id="what-it-checks">What the validator checks</h2>
        <ul>
          <li>
            <strong>Energy bounds (model-aware):</strong> the MACE-MP family
            (MPA-0 and MP-0) between &minus;20 and +100 eV/atom; MACE-OFF
            between &minus;800 and +100 eV/atom; skipped for a custom
            checkpoint, whose reference convention is unknown. Below the
            minimum is a warning, above the maximum an issue. These are the
            enforced bounds; the typical ranges are narrower (below).
          </li>
          <li>
            <strong>Force magnitude:</strong> max force &lt; 50 eV/Å warns,
            &lt; 200 eV/Å errors — forces above 50 eV/Å generally indicate
            overlapping atoms.
          </li>
          <li>
            <strong>Force conservation:</strong> net force should be
            approximately zero for an isolated molecule.
          </li>
          <li>
            <strong>Interatomic distances:</strong> minimum distance &gt;
            0.4 Å (overlap detection).
          </li>
          <li>
            <strong>Lattice:</strong> positive volume and a valid 3&times;3
            matrix for periodic systems.
          </li>
          <li>
            <strong>Trajectory:</strong> no NaN/Inf values, bounded energy
            fluctuation across an MD run.
          </li>
          <li>
            <strong>Consistency:</strong> the number of symbols, positions,
            and forces all match.
          </li>
        </ul>
        <p>
          The validator also flags parameter-level issues: D3 dispersion
          enabled together with MACE-OFF (double-counting), <code>float32</code>{" "}
          precision requested alongside a phonon/Hessian calculation,
          extreme timestep or temperature values, and overly loose{" "}
          <code>fmax</code> thresholds.
        </p>

        <h2 id="manual-checklist">Manual verification checklist</h2>
        <p>
          Beyond the automated suite, a quick manual sanity check catches
          most real-world mistakes:
        </p>
        <ol>
          <li>
            Energy in the typical range for the model: MACE-MPA-0 or MP-0
            &rarr; &minus;1 to &minus;15 eV/atom; MACE-OFF &rarr; &minus;100
            to &minus;600 eV/atom (more negative with Br or I).
          </li>
          <li>
            Forces &lt; 10 eV/Å for a reasonable structure — forces above 50
            eV/Å usually mean overlapping atoms.
          </li>
          <li>
            RMS force trends downward during optimization. BFGS does not
            guarantee a decrease at every step; a run that ends above the{" "}
            <code>fmax</code> target did not converge.
          </li>
          <li>
            MD energy is conserved in NVE; it fluctuates around the target
            temperature in NVT.
          </li>
          <li>Lattice vectors form a right-handed coordinate system.</li>
          <li>Volume is positive for periodic systems.</li>
        </ol>

        <h2 id="reproducibility">Reproducibility &amp; citing</h2>
        <p>
          Every result can be published as a permanent{" "}
          <Link href="/docs/getting-started#sharing">MACE Link</Link> —
          shared results are stored immutably, so a link always reproduces
          the exact same result it did when it was created. This makes MACE
          Links suitable for citation in a paper, lab notebook, or
          supplementary material.
        </p>
        <p>
          If you use SimpleAtom or the underlying MACE models in published
          work, please cite the MACE architecture:
        </p>
        <blockquote>
          Batatia, I. et al. &ldquo;MACE: Higher Order Equivariant Message
          Passing Neural Networks for Fast and Accurate Force Fields.&rdquo;
          NeurIPS 2022.
        </blockquote>

        <h2 id="limitations">Known limitations</h2>
        <Callout type="warning" title="Foundation models are general-purpose">
          MACE-MP-0 is trained at the PBE level of DFT, so it inherits
          PBE&rsquo;s differences from experiment, which depend on the
          material and the property.
          Foundation models generalize well across chemistries, but they are
          not a substitute for system-specific validation against
          higher-level reference data when the application demands it.
        </Callout>
      </article>

      <DocsPager pathname="/docs/validation" />
    </>
  );
}
