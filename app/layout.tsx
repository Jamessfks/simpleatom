import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/* Humanist UI sans — clear, warm, excellent for dense scientific data. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/* Serif display face — used sparingly for headings to add warmth. */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

/* Monospace — reserved for numeric readouts, formulae, and code. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://mace-lake.vercel.app",
  ),
  title: {
    default: "SimpleAtom — MACE force fields in your browser",
    template: "%s · SimpleAtom",
  },
  description:
    "SimpleAtom is a free, browser-based interface to MACE machine-learning interatomic potentials. Run single-point energies, geometry optimizations, and molecular dynamics with MACE foundation models (MACE-MPA-0, MACE-MP-0, MACE-OFF) — no installation, no command line, no HPC account.",
  keywords: [
    "MACE",
    "machine learning interatomic potentials",
    "computational chemistry",
    "molecular dynamics",
    "geometry optimization",
    "MACE-MPA-0",
    "MACE-MP-0",
    "MACE-OFF",
    "foundation models",
    "ASE",
  ],
  authors: [{ name: "Zicheng Zhao", url: "https://github.com/Jamessfks/simpleatom" }],
  openGraph: {
    title: "SimpleAtom — MACE force fields in your browser",
    description:
      "A free, browser-based interface to MACE machine-learning interatomic potentials. No installation, no command line, no HPC account.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
