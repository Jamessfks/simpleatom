import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocsSidebar } from "@/components/docs/docs-nav";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "SimpleAtom documentation — foundation models, calculation types, units and conventions, validation, and reproducibility for MACE machine-learning interatomic potentials.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          <aside className="mb-8 lg:mb-0 lg:sticky lg:top-20 lg:self-start">
            <DocsSidebar />
          </aside>
          <main id="main" className="min-w-0">{children}</main>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
