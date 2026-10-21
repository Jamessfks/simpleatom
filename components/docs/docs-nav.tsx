"use client";

/**
 * Docs navigation — grouped sidebar with active-route highlighting.
 * DOCS_NAV is the single source of truth for the /docs information architecture.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface DocLink {
  title: string;
  href: string;
}

export interface DocSection {
  title: string;
  items: DocLink[];
}

export const DOCS_NAV: DocSection[] = [
  {
    title: "Introduction",
    items: [
      { title: "Overview", href: "/docs" },
      { title: "Getting started", href: "/docs/getting-started" },
    ],
  },
  {
    title: "Science",
    items: [
      { title: "Foundation models", href: "/docs/models" },
      { title: "Calculations & parameters", href: "/docs/calculations" },
      { title: "Units & conventions", href: "/docs/units" },
      { title: "Validation & reproducibility", href: "/docs/validation" },
    ],
  },
  {
    title: "Help",
    items: [{ title: "FAQ & troubleshooting", href: "/docs/faq" }],
  },
];

/** Flattened order for prev/next navigation. */
export const DOCS_ORDER: DocLink[] = DOCS_NAV.flatMap((s) => s.items);

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className="space-y-6">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent-strong)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Prev/next pager rendered at the bottom of each doc page. */
export function DocsPager({ pathname }: { pathname: string }) {
  const idx = DOCS_ORDER.findIndex((d) => d.href === pathname);
  if (idx === -1) return null;
  const prev = idx > 0 ? DOCS_ORDER[idx - 1] : null;
  const next = idx < DOCS_ORDER.length - 1 ? DOCS_ORDER[idx + 1] : null;

  return (
    <div className="mt-12 flex items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-6">
      {prev ? (
        <Link
          href={prev.href}
          className="group flex flex-col text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-strong)]"
        >
          <span className="text-xs text-[var(--color-text-muted)]">
            Previous
          </span>
          <span className="font-medium">← {prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={next.href}
          className="group flex flex-col text-right text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-strong)]"
        >
          <span className="text-xs text-[var(--color-text-muted)]">Next</span>
          <span className="font-medium">{next.title} →</span>
        </Link>
      )}
    </div>
  );
}
