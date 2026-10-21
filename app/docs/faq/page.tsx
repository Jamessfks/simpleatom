import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { DocsPager } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "FAQ & troubleshooting",
  description:
    "Frequently asked questions about SimpleAtom: slow first calculations, CUDA out-of-memory errors, MACE-OFF element restrictions, shared links, choosing a model, cost, accounts, and accuracy.",
};

export default function FaqPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-sm font-medium text-accent-strong">
          Help
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight text-text-primary">
          FAQ &amp; troubleshooting
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-text-secondary">
          Answers to the questions that come up most often, from
          &ldquo;why is this slow&rdquo; to &ldquo;which model should I
          use.&rdquo;
        </p>
      </header>

      <article className="docs-prose">
        <h2 id="performance">Performance</h2>

        <h3 id="slow-first-run">Why is my first calculation so slow?</h3>
        <p>
          This is normal. The first calculation on a given model downloads
          its checkpoint (up to ~2 GB across all sizes), which takes roughly
          30 seconds. The model is cached afterward, so every subsequent
          calculation is fast.
        </p>

        <h3 id="cuda-oom">I&rsquo;m getting a CUDA out-of-memory error</h3>
        <p>
          Switch <strong>Device</strong> to CPU in the parameter panel, or
          choose a smaller model size (<code>small</code> instead of{" "}
          <code>medium</code> or <code>large</code>). Both reduce memory
          pressure at some cost to speed or accuracy.
        </p>

        <h2 id="errors">Errors</h2>

        <h3 id="mace-off-element">
          I got an element error with MACE-OFF
        </h3>
        <p>
          MACE-OFF only supports ten organic elements: H, C, N, O, F, P, S,
          Cl, Br, and I. If your structure contains a metal or any other
          inorganic element, switch to{" "}
          <Link href="/docs/models">MACE-MPA-0</Link>, which covers 89
          elements.
        </p>

        <h3 id="shared-link-not-found">
          A shared link shows &ldquo;not found&rdquo;
        </h3>
        <p>
          The result ID in the link may be invalid or mistyped — double-check
          the URL was copied in full. Shared results are permanent once
          created. If the page says sharing is <em>unavailable</em> rather than
          not found, the sharing database could not be reached and the link
          itself is probably fine; try again later.
        </p>

        <h2 id="choosing">Choosing a model</h2>
        <p>Two questions settle almost every choice:</p>
        <ol>
          <li>
            <strong>Is your system purely organic</strong> (only H, C, N, O,
            F, P, S, Cl, Br, I)? If yes, use{" "}
            <Link href="/docs/models">MACE-OFF</Link>. If it contains a
            metal, a mineral, or any other element, use MACE-MPA-0.
          </li>
          <li>
            <strong>Do you need van der Waals / dispersion corrections</strong>{" "}
            (layered materials, molecular crystals, adsorption)? With
            MACE-MPA-0 or MP-0, enable D3 dispersion. With MACE-OFF, do nothing —
            dispersion is already included in training.
          </li>
        </ol>
        <p>
          Within either family, <code>small</code> is fastest and best for
          quick screening or large systems; <code>medium</code> is the
          balanced default; <code>large</code> is the most accurate and best
          suited to production or publication-quality results.
        </p>

        <h2 id="cost-and-accounts">Cost &amp; accounts</h2>

        <h3 id="is-it-free">Is SimpleAtom free? Do I need an account?</h3>
        <p>
          Yes, it&rsquo;s free, and no account is required. You can run
          calculations and generate shareable MACE Links entirely
          anonymously — there is no sign-up or login anywhere in the
          workflow.
        </p>

        <h2 id="accuracy">Accuracy</h2>

        <h3 id="how-accurate">How accurate are the results?</h3>
        <p>
          MACE foundation models are trained to reproduce DFT, and are only
          as good as that DFT for the chemistries they were trained on.
          MACE-MPA-0 (the default) and MACE-MP-0 are trained at the PBE/PBE+U
          level, which typically overbinds by roughly 0.1&ndash;0.5 eV/atom
          relative to experiment; on the Matbench Discovery benchmark MPA-0
          scores F1 0.852 against MP-0&rsquo;s 0.669. MACE-OFF23 is trained on
          &omega;B97M-D3(BJ) DFT data for organic molecules. All are
          general-purpose foundation models,
          not a replacement for system-specific validation when your
          application demands the highest confidence — see{" "}
          <Link href="/docs/validation">Validation &amp; reproducibility</Link>.
        </p>

        <Callout type="tip" title="Still stuck?">
          Check <Link href="/docs/units">Units &amp; conventions</Link> if a
          number looks like it&rsquo;s in the wrong range, or{" "}
          <Link href="/docs/calculations">Calculations &amp; parameters</Link>{" "}
          if you&rsquo;re unsure what a setting does.
        </Callout>
      </article>

      <DocsPager pathname="/docs/faq" />
    </>
  );
}
