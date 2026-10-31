import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-text-primary">
            Page not found
          </h1>
          <p className="text-sm text-text-secondary">
            There is nothing at this address.
          </p>
          <Button asChild className="mt-2">
            <Link href="/calculate">Open the calculator</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
