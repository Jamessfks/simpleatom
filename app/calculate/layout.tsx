import type { Metadata } from "next";

// The page is a client component and cannot export metadata itself; without
// this, /calculate shared the home page's title.
export const metadata: Metadata = {
  title: "Calculator",
  description:
    "Run a MACE single-point, geometry optimization or molecular dynamics calculation on your own structure.",
};

export default function CalculateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
