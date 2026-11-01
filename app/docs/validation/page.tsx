import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";
import { mpTypicalBandText, offEnforcedBandText, offTypicalBandText } from "@/components/docs/energy-bands";

export const metadata: Metadata = {
  title: "Validation & reproducibility",
  description:
    "How SimpleAtom validates scientific results — the validator's self-test and what each of its five tests asserts, physical-bounds checks, a manual verification checklist, citing MACE, and known limitations of foundation models.",
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
          This runs five self-tests through SimpleAtom&rsquo;s own calculation
          engine, the code the calculator calls, with real MACE calculations.
          It loads the default MACE-MPA-0 (medium) for silicon and MACE-OFF
          (small) for the molecules. It checks that the calculation plumbing
          and the validator give physically plausible results, not either
          model&rsquo;s accuracy against a reference. All five checks assert
          something, and a run that fails or never finishes fails its check.
          The command exits with status 1 unless every check passed.
        </p>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>What it does</th>
              <th>Asserted</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>MACE-MPA-0 (medium) Si bulk</td>
              <td>
                Single-point on the 8-atom conventional diamond-cubic cell
                (a = 5.43 &Aring;).
              </td>
              <td>
                The largest force must be below 0.001 eV/&Aring; (it vanishes
                by symmetry) and the energy per atom must lie in{" "}
                {mpTypicalBandText()} eV/atom, the MACE-MP family&rsquo;s
                typical range.
              </td>
            </tr>
            <tr>
              <td>MACE-OFF (small) H&#8322;O</td>
              <td>
                Single-point on an isolated water molecule, 5 &Aring; of
                vacuum, not periodic.
              </td>
              <td>
                The result must name MACE-OFF as its model and its energy
                must be finite.
              </td>
            </tr>
            <tr>
              <td>Ethanol geometry optimization</td>
              <td>
                MACE-OFF (small), up to 200 BFGS steps with fmax 0.05
                eV/&Aring;.
              </td>
              <td>
                The optimization must have converged, in float64 (read from
                the precision the result reports). The final energy must be
                no higher than the starting energy, to within 10&#8315;&#8313;
                eV, and the final largest force below 0.05 eV/&Aring;. It
                does not check that the energy fell at every step.
              </td>
            </tr>
            <tr>
              <td>Force conservation</td>
              <td>
                The net force on the water result, a translation-invariance
                check.
              </td>
              <td>It must be below 0.01 eV/&Aring;.</td>
            </tr>
            <tr>
              <td>Result validation</td>
              <td>
                The physical-bounds checks listed below, run on both the
                silicon and the water results.
              </td>
              <td>The validator must report both results valid.</td>
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
            (MPA-0 and MP-0) between &minus;20 and +100 eV/atom, where below
            the minimum is a warning and above the maximum an issue. MACE-OFF
            has no such band, because its raw energy per atom depends on the
            elements present, so it is judged by its energy per atom relative
            to the model&apos;s own isolated atoms: between{" "}
            {offEnforcedBandText()} eV/atom, and an issue outside it. The
            check is skipped for a custom checkpoint, whose reference
            convention is unknown, and for a MACE-OFF result that does not
            carry the relative energy. These are the enforced bounds; the
            typical ranges are narrower (below).
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
            <strong>Interatomic distances:</strong> every pair of atoms is
            checked, at the minimum image when the result has a cell, so a
            contact across the cell boundary counts. A distance below 0.4 Å is
            an issue (overlapping atoms).
          </li>
          <li>
            <strong>Lattice:</strong> positive volume and a valid 3&times;3
            matrix for periodic systems.
          </li>
          <li>
            <strong>Trajectory:</strong> no NaN/Inf values in the potential,
            total and temperature series. NVE is judged by the total
            energy&rsquo;s largest excursion from its start per atom (an issue
            above 0.05 eV/atom, a warning above 5 meV/atom), and the fitted
            drift is reported in meV/atom/ps. NVT/NPT is judged by the
            second-half mean temperature against the target (an issue above
            2&times;, a warning above 1.5&times;).
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
            &rarr; &minus;1 to &minus;15 eV/atom; MACE-OFF &rarr; its energy
            per atom relative to the model&apos;s own isolated atoms,{" "}
            {offTypicalBandText()} eV/atom (the raw value depends on which
            elements are present).
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
