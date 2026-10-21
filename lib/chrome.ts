/**
 * The site chrome's single width (ADR-0015), shared by SiteHeader and
 * SiteFooter.
 *
 * It lives in a plain module, not in site-header.tsx: that file is a client
 * module, and a server component that imports a value from a "use client"
 * file receives a client reference, not the string. The footer, rendered on
 * the server by `/`, `/docs`, `/r/[id]` and the 404 pages, silently lost its
 * max-width that way and ran edge to edge while the header stayed centred.
 */
export const CHROME_WIDTH_CLASS = "max-w-7xl";
