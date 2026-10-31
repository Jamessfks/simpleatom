import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "Units & conventions",
  description:
    "The unit system used throughout SimpleAtom — energy in eV, forces in eV/Å, distance in Å, stress in eV/Å³, temperature in K, time in fs, pressure in GPa — plus conversion boundaries and common pitfalls.",
};

export default function UnitsPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-accent-strong">
          Science
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-text-primary">
          Units &amp; conventions
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-text-secondary">
          MACE and ASE share one consistent internal unit system. SimpleAtom
          displays values in these units directly — no hidden conversions —
          so what you see in a chart or an exported file is exactly what
          MACE computed.
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="unit-system">Unit system</h2>
        <table>
          <thead>
            <tr>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Energy</td>
              <td>eV</td>
              <td>Electron volts.</td>
            </tr>
            <tr>
              <td>Forces</td>
              <td>eV/Å</td>
              <td>Per-atom 3-vector.</td>
            </tr>
            <tr>
              <td>Distances / positions</td>
              <td>Å</td>
              <td>Angstroms.</td>
            </tr>
            <tr>
              <td>Stress</td>
              <td>eV/Å³</td>
              <td>Voigt notation.</td>
            </tr>
            <tr>
              <td>Temperature</td>
              <td>K</td>
              <td>Kelvin.</td>
            </tr>
            <tr>
              <td>Time</td>
              <td>fs</td>
              <td>
                Femtoseconds; converted internally via <code>ase.units.fs</code>.
              </td>
            </tr>
            <tr>
              <td>Pressure</td>
              <td>GPa (user-facing)</td>
              <td>
                1 GPa = 10,000 bar. Internally represented as eV/Å³.
              </td>
            </tr>
          </tbody>
        </table>

        <h2 id="boundaries">Conversion at boundaries</h2>
        <p>
          The same physical quantity can appear in slightly different forms
          as it moves from your input, through ASE and MACE, into the JSON
          result, and finally onto the screen. The table below tracks each
          quantity across those boundaries.
        </p>
        <table>
          <thead>
            <tr>
              <th>Boundary</th>
              <th>Energy</th>
              <th>Forces</th>
              <th>Distance</th>
              <th>Time</th>
              <th>Temperature</th>
              <th>Pressure</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>User input</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
              <td>Å</td>
              <td>fs</td>
              <td>K</td>
              <td>GPa</td>
            </tr>
            <tr>
              <td>ASE internal</td>
              <td>eV</td>
              <td>eV/Å</td>
              <td>Å</td>
              <td>ASE units</td>
              <td>K</td>
              <td>eV/Å³</td>
            </tr>
            <tr>
              <td>MACE output</td>
              <td>eV</td>
              <td>eV/Å</td>
              <td>Å</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td>JSON result</td>
              <td>eV</td>
              <td>eV/Å</td>
              <td>Å</td>
              <td>seconds</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td>Frontend display</td>
              <td>eV</td>
              <td>eV/Å</td>
              <td>Å</td>
              <td>seconds</td>
              <td>K</td>
              <td>GPa</td>
            </tr>
          </tbody>
        </table>

        <Callout type="warning" title="Critical conversion: pressure">
          Pressure is entered in GPa and converted with ASE&rsquo;s own
          constant, <code>pressure_GPa &times; ase.units.GPa</code>, into the
          eV/Å³ that ASE and MACE work in (1 GPa &asymp; 0.00624 eV/Å³). Stress
          and pressure in results are converted back to GPa. Nothing in
          SimpleAtom uses bar.
        </Callout>

        <h2 id="pitfalls">Common pitfalls</h2>
        <ul>
          <li>
            <strong>Never mix units.</strong> MACE outputs eV/Å, ASE uses
            eV/Å internally, and the frontend displays eV/Å — there is no
            silent conversion between them anywhere in the pipeline.
          </li>
          <li>
            <strong>Reference energy keys vary.</strong> Extended XYZ
            metadata can store a reference energy under{" "}
            <code>REF_energy</code>, <code>ref_energy</code>,{" "}
            <code>energy</code>, or <code>dft_energy</code> — check which
            key a given file uses before comparing to a calculated value.
          </li>
          <li>
            <strong>Benchmark catalog values are experimental, not DFT.</strong>{" "}
            Reference energies in the built-in catalog come from
            experimental sources, not density functional theory, so
            comparisons against them should note the difference in level of
            theory.
          </li>
          <li>
            <strong>
              The MACE-MP family and MACE-OFF use different energy-reference
              conventions.
            </strong>{" "}
            Their absolute energies differ by roughly an order of magnitude
            and are not directly comparable.
          </li>
        </ul>
        <Callout type="warning" title="Do not compare absolute energies across models">
          The MACE-MP family (MPA-0 and MP-0, &minus;1 to &minus;15 eV/atom)
          and MACE-OFF (&minus;100 to &minus;600 eV/atom) use different energy
          references. Never compare their absolute energies directly —
          compare energy <em>differences</em> computed with the{" "}
          <em>same</em> model instead. See{" "}
          <Link href="/docs/models">Foundation models</Link> for the full
          energy-reference conventions.
        </Callout>
      </article>

      <DocsPager pathname="/docs/units" />
    </>
  );
}
