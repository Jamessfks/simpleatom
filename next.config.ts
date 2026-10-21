import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Acknowledge Turbopack (Next.js 16 default). Webpack config below applies when using --webpack.
  // Some browser bundles still reference Node built-ins in dead code; stub them.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/empty-module.js" },
      path: { browser: "./lib/empty-module.js" },
      "plotly.js/dist/plotly": "plotly.js-dist-min",
    },
  },
  /**
   * FRAMING POLICY.
   *
   * `/r/<id>/embed` exists to be dropped into someone else's page — the whole
   * point of the primitive (docs/v2/bars/rowan.md; the bar embeds exactly this
   * in its own homepage hero). Everything else must not be framable
   * cross-origin.
   *
   * Before this block the app sent no framing headers at all, so EVERY page —
   * including /calculate, which uploads files and runs jobs — could be framed
   * by any site. This is therefore a tightening, not a relaxation: the site
   * gains `frame-ancestors 'self'`, and one read-only path is carved out of it.
   *
   * Why the carve-out is safe for that path: it renders a public, read-only
   * calculation that `/r/<id>` already serves to anyone with the URL. There is
   * no authentication anywhere in this app, no cookie or token to ride along
   * with a framed request, and no state-changing control on the page — so there
   * is no privileged action for a framing site to hijack and nothing it could
   * not fetch directly. Clickjacking needs an action worth stealing.
   *
   * MECHANICS. `X-Frame-Options` has no "any origin" value, so the embed must
   * not receive that header at all — hence the negative lookahead on the
   * site-wide source rather than a permissive override (a later rule can
   * replace a header's value but cannot delete it). The source string mirrors
   * the route at app/r/[id]/embed and `embedPath()` in lib/share.ts; all three
   * spell the path out because next.config cannot import from lib (that module
   * pulls in the Supabase client).
   */
  async headers() {
    return [
      {
        // Every route, embed included: baseline hardening that changes nothing
        // a legitimate page relies on. A full Content-Security-Policy is a
        // separate change (WEAS iframe blobs, Ketcher wasm, Plotly) — see
        // docs/adr/0029 follow-ups.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
      {
        // Everything except exactly /r/<id>/embed. The `$` matters: without it
        // a path that merely STARTS that way (`/r/x/embedded`, `/r/x/embed/y`)
        // would also lose the strict policy. Verified against Next's own route
        // matcher rather than by eye.
        source: "/((?!r/[^/]+/embed$).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        // The embeddable viewer: framable anywhere, deliberately.
        source: "/r/:id/embed",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
  // Stub Node built-ins out for browser builds.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    // Same alias Turbopack uses above; without it `next build --webpack`
    // could not resolve react-plotly.js's import.
    config.resolve.alias = {
      ...config.resolve.alias,
      "plotly.js/dist/plotly": "plotly.js-dist-min",
    };
    return config;
  },
};

export default nextConfig;
