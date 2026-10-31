import type { Metadata } from "next";

// The page is a client component and cannot export metadata itself.
export const metadata: Metadata = {
  title: "Benchmark",
  description:
    "Compare MACE foundation models across ml-peg reference structures and Materials Project formation energies.",
};

export default function BenchmarkLayout({ children }: { children: React.ReactNode }) {
  return children;
}
