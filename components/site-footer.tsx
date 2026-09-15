/**
 * SiteFooter — shared footer for SimpleAtom.
 *
 * Carries navigation, external references (MACE, ASE), scientific
 * attribution, and the current release. Warm and low-contrast to match
 * the rest of the interface. Sizes its content column per-route with the
 * same `CHROME_WIDTH_CLASS` SiteHeader uses, so the two stay in sync
 * and both line up with the page content between them.
 */

import Link from "next/link";
import { Atom } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHROME_WIDTH_CLASS } from "@/components/site-header";

const APP_VERSION = "1.3.0";

const PRODUCT_LINKS = [
  { href: "/calculate", label: "Calculator" },
  { href: "/benchmark", label: "Benchmark" },
  { href: "/docs", label: "Documentation" },
];

const RESOURCE_LINKS = [
  { href: "https://mace-docs.readthedocs.io/en/latest/", label: "MACE docs" },
  { href: "https://github.com/ACEsuit/mace", label: "MACE on GitHub" },
  { href: "https://wiki.fysik.dtu.dk/ase/", label: "ASE" },
  { href: "https://github.com/Jamessfks/mace", label: "Source code" },
];

export function SiteFooter() {
  const widthClass = CHROME_WIDTH_CLASS;

  return (
    <footer className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
      <div className={cn("mx-auto px-6 py-12", widthClass)}>
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand + tagline */}
          <div className="lg:col-span-2">
            <div className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent-primary)]">
                <Atom className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <span>
                <span className="text-[var(--color-text-primary)]">Simple</span>
                <span className="text-[var(--color-accent-strong)]">Atom</span>
              </span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--color-text-secondary)]">
              A free, browser-based interface to MACE machine-learning
              interatomic potentials. Quantum-accurate simulation without the
              installation, command line, or supercomputer.
            </p>
          </div>

          {/* Product */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Product
            </h2>
            <ul className="mt-4 space-y-2.5">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-strong)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Resources
            </h2>
            <ul className="mt-4 space-y-2.5">
              {RESOURCE_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-strong)]"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Attribution + release */}
        <div className="mt-10 flex flex-col gap-4 border-t border-[var(--color-border-subtle)] pt-6 text-xs text-[var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl leading-relaxed">
            Powered by the{" "}
            <a
              href="https://github.com/ACEsuit/mace"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
            >
              MACE
            </a>{" "}
            framework (Batatia et al., NeurIPS 2022). Built by{" "}
            <a
              href="https://github.com/Jamessfks/mace"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
            >
              Zicheng Zhao
            </a>
            , Northeastern University.
          </p>
          <p className="font-mono">SimpleAtom v{APP_VERSION}</p>
        </div>
      </div>
    </footer>
  );
}
