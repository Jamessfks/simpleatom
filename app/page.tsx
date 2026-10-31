import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { IntroSection } from "@/components/intro-section";

/**
 * SimpleAtom — landing page.
 *
 * A warm, low-contrast introduction on an off-white canvas. Structure,
 * navigation, and footer are shared across the app; the hero and marketing
 * content live in IntroSection.
 */
export default function Home() {
  return (
    <div className="warm-bg min-h-screen">
      <SiteHeader />
      <main id="main">
        <IntroSection />
      </main>
      <SiteFooter />
    </div>
  );
}
