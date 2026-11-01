import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";
import { offTypicalBandText } from "@/components/docs/off-energy-band";

export const metadata: Metadata = {
  title: "Foundation models",
  description:
    "MACE foundation models in SimpleAtom: MACE-MPA-0 (default) and MACE-MP-0 for materials (PBE/PBE+U, 89 elements), MACE-OFF23 for organic molecules (ωB97M-D3BJ, non-commercial licence), sizes, custom checkpoints, and energy-reference conventions.",
};

export default function ModelsPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-accent-strong">
          Science
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-text-primary">
          Foundation models
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-text-secondary">
          MACE ships pre-trained potentials for distinct chemical domains.
          Choosing the right one — and understanding its level of theory — is
          the single most important decision for a meaningful result.
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="mace-mpa-0">MACE-MPA-0 (default)</h2>
        <ul>
          <li>
            <strong>Scope:</strong> materials, crystals, surfaces, and bulk
            systems — 89 elements. Upstream MACE&rsquo;s own default for{" "}
            <code>mace_mp()</code> since v0.3.10.
          </li>
          <li>
            <strong>Training data:</strong> MPtrj plus the subsampled Alexandria
            set, PBE/PBE+U DFT.
          </li>
          <li>
            <strong>Benchmark:</strong> Matbench Discovery F1 0.852, energy MAE
            0.028 eV/atom (MACE-MP-0: 0.669 and 0.057).
          </li>
          <li>
            <strong>Size:</strong> published as <code>medium</code> only.
          </li>
          <li>
            <strong>Licence:</strong> MIT.
          </li>
        </ul>

        <h2 id="mace-mp-0">MACE-MP-0</h2>
        <ul>
          <li>
            <strong>Scope:</strong> the 2023 materials model, same 89 elements.
            Kept so earlier results can be reproduced; prefer MPA-0 for new
            work.
          </li>
          <li>
            <strong>Training data:</strong> Materials Project DFT calculations
            (PBE+U functional).
          </li>
          <li>
            <strong>Accuracy:</strong> PBE-level, like MPA-0, so it inherits
            PBE&rsquo;s differences from experiment, which depend on the
            material and the property. For silicon, MACE-MPA-0 relaxes to
            a = 5.467 Å vs 5.4309 Å measured (COD 9011998, 298 K).
          </li>
          <li>
            <strong>D3 dispersion:</strong> supported for both MPA-0 and MP-0,
            and recommended for van der Waals systems (layered materials,
            molecular crystals).
          </li>
          <li>
            <strong>Energy reference:</strong> PBE-referenced totals, shared by
            MPA-0 and MP-0. Typical range <code>−1 to −15 eV/atom</code>.
          </li>
        </ul>

        <h2 id="mace-off">MACE-OFF23</h2>
        <ul>
          <li>
            <strong>Scope:</strong> organic molecules and drug-like compounds.
          </li>
          <li>
            <strong>Supported elements:</strong> H, C, N, O, F, P, S, Cl, Br, I
            (10 elements).
          </li>
          <li>
            <strong>Training data:</strong> the SPICE dataset at the
            ωB97M-D3(BJ)/def2-TZVPPD level of DFT.
          </li>
          <li>
            <strong>Energy reference:</strong> total energies including core
            electrons — a different convention from the MACE-MP family. The
            raw energy per atom depends on the elements present (water is
            about <code>−694 eV/atom</code>, CH<sub>2</sub>Br<sub>2</sub>{" "}
            about <code>−28233 eV/atom</code>), so it has no range of its own.
            SimpleAtom judges a result relative to the model&apos;s own
            isolated atoms, typically <code>{offTypicalBandText()} eV/atom</code>.
          </li>
          <li>
            <strong>Licence:</strong> the{" "}
            <a href="https://github.com/gabor1/ASL">Academic Software License</a>
            , which does not permit commercial use. Every MACE-OFF result
            carries this notice.
          </li>
        </ul>

        <Callout type="warning" title="Do not enable D3 with MACE-OFF">
          MACE-OFF is trained on ωB97M-<strong>D3BJ</strong> data — dispersion
          is already included. Enabling the D3 correction double-counts
          dispersion interactions. SimpleAtom disables the D3 toggle
          automatically when MACE-OFF is selected.
        </Callout>

        <h2 id="sizes">Model sizes</h2>
        <p>
          MACE-MP-0 and MACE-OFF23 come in three sizes; MACE-MPA-0 in{" "}
          <code>medium</code> only:
        </p>
        <table>
          <thead>
            <tr>
              <th>Size</th>
              <th>Speed</th>
              <th>Accuracy</th>
              <th>Use case</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>small</code>
              </td>
              <td>Fastest</td>
              <td>Least accurate</td>
              <td>Quick screening, large systems</td>
            </tr>
            <tr>
              <td>
                <code>medium</code>
              </td>
              <td>Balanced</td>
              <td>Good</td>
              <td>General use (default)</td>
            </tr>
            <tr>
              <td>
                <code>large</code>
              </td>
              <td>Slowest</td>
              <td>Best</td>
              <td>Production results, publication</td>
            </tr>
          </tbody>
        </table>

        <h2 id="custom">Custom models</h2>
        <p>
          When you run SimpleAtom locally with{" "}
          <code>ALLOW_CUSTOM_MODELS=1</code> you can upload your own{" "}
          <code>.model</code> checkpoint trained with <code>mace-torch</code>{" "}
          (for example, fine-tuned with <code>mace_run_train</code>).
          SimpleAtom loads it with <code>MACECalculator</code>, runs the
          calculation identically to the foundation models, and can compare
          your model against a foundation model on the same structure: RMS
          force for each, and the RMS difference between their forces. An
          energy difference is shown only when both models use the same energy
          reference, which a custom checkpoint does not declare, so it is not
          shown for custom models.
        </p>
        <Callout type="note" title="Not on the public site">
          A <code>.model</code> file is a pickled PyTorch module: loading it
          runs code from the file. The public instance therefore only loads the
          foundation checkpoints whose SHA-256 it has pinned, and refuses
          uploaded ones. Locally, uploads are off until you opt in, and are
          then accepted only from <code>localhost</code>.
        </Callout>

        <h2 id="choosing">Choosing a model</h2>
        <pre>
          <code>{`Is your system purely organic (only H, C, N, O, F, P, S, Cl, Br, I)?
  ├─ Yes → MACE-OFF
  └─ No  → MACE-MPA-0   (or MACE-MP-0 to reproduce an older result)

Do you need van der Waals / dispersion corrections?
  ├─ MACE-MPA-0 / MP-0 → enable D3 dispersion
  └─ MACE-OFF          → do nothing (already included)`}</code>
        </pre>

        <Callout type="note" title="Reference conventions differ">
          The MACE-MP family and MACE-OFF use different energy-reference conventions, so
          their absolute energies differ by an order of magnitude. Never compare
          absolute energies across the two models — see{" "}
          <Link href="/docs/units">Units &amp; conventions</Link>.
        </Callout>
      </article>

      <DocsPager pathname="/docs/models" />
    </>
  );
}
