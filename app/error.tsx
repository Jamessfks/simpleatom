"use client";

/**
 * Route-level error boundary. Without it an unexpected exception in any page
 * fell through to Next's bare default screen with no way back.
 */

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="flex min-h-[60vh] items-center justify-center px-6 py-20">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-text-primary">
          Something went wrong
        </h1>
        <p className="text-sm text-text-secondary">
          This page hit an unexpected error. Nothing you entered has been sent anywhere.
          {error.digest ? (
            <>
              {" "}Reference <code className="font-mono">{error.digest}</code>.
            </>
          ) : null}
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
