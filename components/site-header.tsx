"use client";

/**
 * SiteHeader — shared top navigation for SimpleAtom.
 *
 * Warm, minimal, sticky. Replaces the per-page inline headers so branding
 * and navigation stay consistent across the app. Highlights the active
 * route, surfaces the calculator as a single solid primary CTA (mirroring
 * the "one obvious next action" hierarchy from docs/v2/bars/rowan.md
 * without copying its wording or type), collapses to a disclosure menu on
 * small screens, and sizes its content column per-route via
 * `CHROME_WIDTH_CLASS`, one width for every route.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Atom, Github, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Secondary links only — the calculator is promoted to the primary CTA
// button rendered separately below, so it isn't duplicated in this list.
const NAV = [
  { href: "/benchmark", label: "Benchmark" },
  { href: "/docs", label: "Docs" },
];

const GITHUB_URL = "https://github.com/Jamessfks/mace";

/** Active-route test: exact match, or any nested path under it. */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * ONE width for the whole site, deliberately.
 *
 * This previously derived the chrome width per route so the header lined up
 * with each page's own content column. That was measured and rejected: it put
 * the wordmark at three different x positions (144.5 on `/`, 81 on `/docs`,
 * 24 on `/calculate`), so clicking our own primary CTA slid the logo 120px
 * left in the same frame the content changed.
 *
 * A jump in persistent chrome is noticed. A static misalignment between the
 * header and the column beneath it is not. The bar (rowansci.com) makes the
 * same trade — one `max-w-7xl` header on every route, accepting that it does
 * not align with their narrower hero column.
 *
 * Exported so SiteFooter uses the identical value and the two cannot drift.
 */
export const CHROME_WIDTH_CLASS = "max-w-7xl";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "group inline-flex items-center gap-2 text-lg font-semibold tracking-tight",
        className,
      )}
      aria-label="SimpleAtom home"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent-primary)] transition-colors group-hover:bg-[var(--color-accent-primary)] group-hover:text-white">
        <Atom className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <span>
        <span className="text-[var(--color-text-primary)]">Simple</span>
        <span className="text-[var(--color-accent-strong)]">Atom</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => isUnder(pathname, href);

  const widthClass = CHROME_WIDTH_CLASS;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]/85 backdrop-blur-md">
      <div
        className={cn(
          "mx-auto flex h-16 items-center justify-between px-6",
          widthClass,
        )}
      >
        <Wordmark />

        {/* Desktop navigation */}
        <nav
          className="hidden items-center gap-1 md:flex"
          aria-label="Primary"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]",
              )}
            >
              {item.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 rounded-md p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
            aria-label="View source on GitHub"
          >
            <Github className="h-5 w-5" strokeWidth={1.75} />
          </a>
          <Button asChild className="ml-2">
            <Link
              href="/calculate"
              aria-current={isActive("/calculate") ? "page" : undefined}
            >
              Calculator
            </Link>
          </Button>
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)] md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile disclosure panel */}
      {open && (
        <nav
          className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] px-6 py-3 md:hidden"
          aria-label="Primary mobile"
        >
          <ul className="flex flex-col gap-1">
            <li>
              <Button asChild className="w-full">
                <Link
                  href="/calculate"
                  onClick={() => setOpen(false)}
                  aria-current={isActive("/calculate") ? "page" : undefined}
                >
                  Calculator
                </Link>
              </Button>
            </li>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <Github className="h-4 w-4" /> GitHub
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
