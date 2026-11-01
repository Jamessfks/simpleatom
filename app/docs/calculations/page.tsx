import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "Calculations & parameters",
  description:
    "Single-point energy, geometry optimization (BFGS, fmax), and molecular dynamics (NVE/NVT/NPT) in SimpleAtom — parameters, precision, device, D3 dispersion, and the Web UI to MACE parameter mapping.",
};

export default function CalculationsPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-accent-strong">
          Science
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-text-primary">
          Calculations &amp; parameters
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-text-secondary">
          SimpleAtom exposes three calculation types, each a thin,
          browser-friendly layer over ASE and the underlying{" "}
          <code>MACECalculator</code>. This page explains what each type
          computes, which parameters control it, and how those parameters
          map onto the MACE Python API.
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="single-point">Single-point energy &amp; forces</h2>
        <p>
          Computes the total energy and the per-atom forces at the current
          geometry, with no optimization or dynamics. This is the fastest
          calculation type and the natural first step for any new structure
          — use it to sanity-check a structure before committing to a longer
          optimization or MD run.
        </p>

        <h2 id="optimization">Geometry optimization</h2>
        <p>
          Relaxes atomic positions to a nearby local minimum with the BFGS
          quasi-Newton algorithm, which steps along a direction built from
          the forces and a running estimate of the curvature, until the
          largest force on any atom is at or below a threshold,{" "}
          <code>fmax</code>.
        </p>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Default</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Optimizer</td>
              <td>BFGS</td>
              <td>
                Fixed &mdash; BFGS is the only optimizer, and it is not
                selectable. If it struggles to converge, loosen{" "}
                <code>fmax</code>, raise <code>maxOptSteps</code>, or start
                from a cleaner geometry.
              </td>
            </tr>
            <tr>
              <td>
                <code>fmax</code> (eV/Å)
              </td>
              <td>0.05</td>
              <td>
                0.01 for production results; 0.005 if the relaxed geometry will
                be handed to an external vibrational analysis.
              </td>
            </tr>
            <tr>
              <td>
                <code>maxOptSteps</code>
              </td>
              <td>500</td>
              <td>
                Always set a limit to prevent an infinite loop; increase for
                large or difficult-to-converge systems.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Only atomic positions are optimized — cell optimization is not yet
          supported. Watch the RMS force during optimization: it should
          trend downward as the structure approaches a minimum, though BFGS
          does not guarantee a decrease at every step.
        </p>

        <h2 id="md">Molecular dynamics</h2>
        <p>
          Propagates a trajectory over time under one of three ensembles.
          Initial velocities are always drawn from a Maxwell&ndash;Boltzmann
          distribution at the target temperature.
        </p>
        <table>
          <thead>
            <tr>
              <th>Ensemble</th>
              <th>Thermostat / barostat</th>
              <th>Requires</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>NVE</td>
              <td>None (microcanonical)</td>
              <td>
                Any system. Total energy (potential + kinetic) should stay
                conserved; potential energy alone should not, and does not.
              </td>
            </tr>
            <tr>
              <td>NVT</td>
              <td>Langevin thermostat (friction parameter)</td>
              <td>
                Target temperature (K). The thermostat exchanges energy with a
                heat bath, so temperature fluctuates around the target rather
                than holding fixed, and total energy is not conserved.
              </td>
            </tr>
            <tr>
              <td>NPT</td>
              <td>Barostat</td>
              <td>
                Temperature (K), pressure (GPa), and a fully periodic cell
                (refused otherwise). ASE&rsquo;s Melchionna integrator with a
                75 fs barostat time and a 100 GPa bulk-modulus estimate.
              </td>
            </tr>
          </tbody>
        </table>
        <ul>
          <li>
            <strong>Timestep:</strong> typically 0.5&ndash;2.0 fs; use a
            smaller timestep for systems containing light elements such as
            hydrogen.
          </li>
          <li>
            <strong>Steps:</strong> total number of MD steps to run.
          </li>
          <li>
            <strong>Temperature (K):</strong> the target for the initial
            Maxwell&ndash;Boltzmann velocity distribution and for the NVT/NPT
            thermostat.
          </li>
          <li>
            <strong>Langevin friction:</strong> controls how strongly the
            NVT thermostat couples the system to the target temperature.
          </li>
          <li>
            <strong>Reported temperature:</strong> the kinetic temperature over
            the degrees of freedom that actually carry energy — 3N for NVT,
            where the thermostat acts on every mode, and 3N&minus;3 for NVE and
            NPT, where the centre-of-mass momentum stays at zero. The number
            used is recorded with the result. (Before v2.2.0 an ASE default
            made NVT runs on molecules with mixed masses equilibrate roughly
            40% above the target; that is fixed.)
          </li>
          <li>
            <strong>Pressure (GPa):</strong> the NPT target pressure,
            entered in GPa and converted internally — see{" "}
            <Link href="/docs/units">Units &amp; conventions</Link>.
          </li>
          <li>
            <strong>Random seed:</strong> MD has two stochastic sources — the
            initial Maxwell&ndash;Boltzmann velocities and the Langevin random
            forces. Both are driven by a single seed, which defaults to{" "}
            <code>42</code>, so a run is reproducible bit-for-bit. The seed
            used is recorded in the result message and parameters, so a shared
            trajectory can always be re-run exactly. Enter a different whole
            number in the <em>Random seed</em> box (molecular dynamics
            section) to generate an independent replica of the same system;
            leave it blank for the default.
          </li>
          <li>
            <strong>What a trajectory records:</strong> potential energy,
            kinetic energy, total energy and the instantaneous temperature for
            each recorded frame. Long runs on large structures record every
            k-th step so the result stays a manageable size; the stride is
            stated in the result when it is above one. The Energy tab plots total energy and potential energy
            as separate, named series, so the NVE claim above is one you can
            check on the chart rather than take on trust; the Summary tab
            reports the total-energy drift over the run and the mean
            temperature against your target.
          </li>
        </ul>
        <Callout type="note" title="Phonon spectrum — not supported">
          Phonon and vibrational analysis are not implemented in SimpleAtom;
          a request for one is refused with an error rather than answered
          with something else. Run it on a fully converged geometry with an
          external workflow.
        </Callout>

        <h2 id="limits">Progress, cancelling and limits</h2>
        <p>
          A calculation runs as a job. While it runs you see its real stage
          (reading the structure, loading the model, computing) and, for an
          optimisation or MD run, the current step — with the maximum force or
          the temperature — reported by the backend, not estimated. Cancel
          stops the computation itself, not just the page.
        </p>
        <p>
          The public site shares one CPU between everyone, so it caps the
          structure size and run length (for example 1,000 atoms and 10,000
          steps for MD) and gives each run a time budget. A run that reaches
          the budget ends with the steps it completed, clearly marked as
          stopped early — an optimisation stopped that way is reported as not
          converged. Running SimpleAtom locally lifts these limits. The exact
          numbers are in the{" "}
          <a href="https://github.com/Jamessfks/simpleatom/blob/main/docs/reference/contract.md">
            request contract
          </a>
          .
        </p>

        <h2 id="dispersion">D3 dispersion correction</h2>
        <p>
          Adds Grimme&rsquo;s semi-empirical DFT-D3 van der Waals correction
          on top of MACE-MPA-0 or MACE-MP-0 predictions. It matters for layered materials,
          molecular adsorption, and molecular crystals where dispersion
          forces are significant.
        </p>
        <Callout type="warning" title="D3 is for the MACE-MP family only">
          D3 dispersion is only meaningful for MACE-MPA-0 and MACE-MP-0. MACE-OFF is
          trained on &omega;B97M-D3BJ reference data, which already includes
          dispersion — enabling D3 on top of it double-counts the
          correction. SimpleAtom disables the D3 toggle automatically when
          MACE-OFF is selected.
        </Callout>

        <h2 id="precision">Precision</h2>
        <p>
          Precision is the <code>default_dtype</code> handed to MACE. The
          default setting is <strong>Auto</strong>, which applies upstream
          MACE&rsquo;s own choice rather than a SimpleAtom opinion:
        </p>
        <ul>
          <li>
            <strong>float32</strong> — faster, less accurate. Upstream
            recommends it for molecular dynamics.
          </li>
          <li>
            <strong>float64</strong> — slower, more accurate. Upstream
            recommends it for geometry optimization, and{" "}
            <code>mace_off()</code> defaults to it for the whole MACE-OFF
            family.
          </li>
        </ul>
        <p>
          Both <code>mace_mp()</code> and <code>mace_off()</code> print this
          guidance at construction time, on every run:{" "}
          <em>
            float32 &hellip; faster but less accurate. Recommended for MD. Use
            float64 for geometry optimization.
          </em>{" "}
          Auto follows it: float64 for MACE-OFF and for geometry optimization,
          float32 otherwise.
        </p>
        <Callout type="note" title="An explicit choice is honoured, and reported">
          Picking float32 or float64 explicitly overrides Auto — upstream
          honours whatever <code>default_dtype</code> it is handed, and so does
          SimpleAtom. When the choice lands below upstream&rsquo;s
          recommendation, the result carries a warning saying so. A custom
          <code>.model</code> checkpoint is a special case: it keeps the dtype
          it was saved in, because MACE adopts the checkpoint&rsquo;s own dtype
          when no <code>default_dtype</code> is passed. Either way, the
          precision shown in a result is the dtype the loaded model was
          actually running in, read back off the model — not the dtype that was
          requested.
        </Callout>

        <h2 id="device">Device</h2>
        <p>
          Calculations run on <code>cpu</code> by default, and the Device
          selector offers only what the deployment reports it can run on. The
          public server is CPU-only, so it shows CUDA as unavailable, and a
          request for <code>cuda</code> sent to it directly is refused with{" "}
          <code>device_unavailable</code>. Locally, CUDA is offered when PyTorch
          can see a GPU. If you ask for CUDA and PyTorch cannot see one, the run
          falls back to CPU and the result says so: a warning, plus{" "}
          <code>requestedDevice</code> next to the <code>device</code> that ran.
          If the GPU runs out of memory, the run stops with{" "}
          <code>cuda_out_of_memory</code>. It is not retried on CPU.
          SimpleAtom has measured no GPU speed-up, so it claims none.
        </p>

        <h2 id="mapping">Web UI &rarr; MACE parameter mapping</h2>
        <p>
          Under the hood, SimpleAtom drives the same{" "}
          <code>MACECalculator</code> and <code>mace_mp()</code> /{" "}
          <code>mace_off()</code> factory functions you would use from a
          Python script. The web parameters map directly onto that API:
        </p>
        <table>
          <thead>
            <tr>
              <th>Web UI parameter</th>
              <th>Maps to</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Model Type</td>
              <td>
                <code>mace_mp()</code> / <code>mace_off()</code> / custom
                upload
              </td>
              <td>Selects the foundation model or a user checkpoint.</td>
            </tr>
            <tr>
              <td>Model Size</td>
              <td>
                <code>model</code> argument
              </td>
              <td>
                <code>&quot;small&quot;</code>, <code>&quot;medium&quot;</code>
                , <code>&quot;large&quot;</code>.
              </td>
            </tr>
            <tr>
              <td>Precision</td>
              <td>
                <code>default_dtype</code>
              </td>
              <td>
                <code>&quot;float32&quot;</code> or{" "}
                <code>&quot;float64&quot;</code>. Auto passes no{" "}
                <code>default_dtype</code>, so upstream&rsquo;s own default
                applies.
              </td>
            </tr>
            <tr>
              <td>Device</td>
              <td>
                <code>device</code>
              </td>
              <td>
                <code>&quot;cpu&quot;</code> or <code>&quot;cuda&quot;</code>.
              </td>
            </tr>
            <tr>
              <td>D3 Dispersion</td>
              <td>
                <code>dispersion</code>
              </td>
              <td>On/off toggle; MACE-MPA-0 and MACE-MP-0 only.</td>
            </tr>
            <tr>
              <td>Custom Model Upload</td>
              <td>
                <code>model_paths</code>
              </td>
              <td>User-supplied <code>.model</code> checkpoint file.</td>
            </tr>
          </tbody>
        </table>
        <p>
          Lower-level parameters — <code>compile_mode</code>,{" "}
          <code>enable_cueq</code>, <code>charges_key</code>,{" "}
          <code>info_keys</code>, and the unit-conversion factors — are
          handled automatically by the backend and are not exposed in the
          UI, since they require no configuration for standard workflows.
        </p>
      </article>

      <DocsPager pathname="/docs/calculations" />
    </>
  );
}
