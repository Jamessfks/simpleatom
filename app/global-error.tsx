"use client";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * whole document, so it cannot rely on the app's fonts or stylesheet.
 */

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#FBFAF7", color: "#262521" }}>
        <main style={{ maxWidth: 480, margin: "20vh auto", padding: "0 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>SimpleAtom hit an unexpected error</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#5C574E" }}>
            Reload the page to continue. Nothing you entered has been sent anywhere.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 16, minHeight: 44, padding: "0 20px", borderRadius: 999, border: "1px solid #3A7A40", background: "#3A7A40", color: "#fff", fontSize: 15, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
