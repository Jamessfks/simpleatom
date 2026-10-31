"use client";

/**
 * WeasViewer — WEAS (Web Environment for Atomistic Simulations) viewer.
 *
 * PURPOSE:
 *   Renders atomic structures using the same WEAS library used by ml-peg
 *   (https://github.com/ddmms/ml-peg). This aligns our viewer with the MACE
 *   team's tooling and enables future integration between the two projects.
 *
 * HOW IT WORKS:
 *   WEAS is a pure JavaScript library loaded from CDN (unpkg.com/weas).
 *   We generate a self-contained HTML document that:
 *     1. Embeds the WEAS import from CDN
 *     2. Includes the XYZ data inline (via a Blob URL)
 *     3. Parses and renders the structure in a full-page viewer
 *   This HTML is rendered inside a sandboxed <iframe> using a Blob URL.
 *   This is the same approach ml-peg uses (see ml_peg/app/utils/weas.py).
 *
 * REFERENCE:
 *   - WEAS library: https://github.com/superstar54/weas
 *   - ml-peg usage: https://github.com/ddmms/ml-peg/blob/main/ml_peg/app/utils/weas.py
 *   - CDN import:   https://unpkg.com/weas/dist/index.mjs
 *
 * PROPS:
 *   - xyzData: string — XYZ-formatted string of the structure to render.
 *     Must include atom count, comment line, and atom lines.
 *   - height: number — Height of the viewer in pixels (default 420).
 *
 * NOTES:
 *   - No npm dependency needed — WEAS is loaded from CDN at runtime.
 *   - Runs in an iframe so WEAS's global state doesn't interfere with React.
 *   - The iframe is sandboxed with allow-scripts for security.
 *   - CIF support: pass CIF-formatted text and set format="cif".
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WeasViewerProps {
  /** XYZ or CIF formatted string of the structure. */
  structureData: string;
  /** File format: "xyz" or "cif". Default "xyz". */
  format?: "xyz" | "cif";
  /** Height of the viewer in pixels. Default 420. */
  height?: number;
}

// ---------------------------------------------------------------------------
// HTML generator (mirrors ml-peg's generate_weas_html approach)
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained HTML page that loads WEAS from CDN and renders
 * the given structure data. The structure is embedded inline as a JS string.
 *
 * This mirrors the approach in ml_peg/app/utils/weas.py but embeds the data
 * directly instead of fetching from a URL (since we already have the data).
 */
/**
 * Pinned WEAS build. The viewer used to import `unpkg.com/weas/dist/...` with
 * no version, i.e. whatever was published last, with no integrity check — any
 * new upstream release (or a compromised one) ran inside this page. The pin
 * plus a Subresource Integrity hash means only this exact file executes. To
 * upgrade: change the version, recompute
 * `openssl dgst -sha384 -binary index.mjs | openssl base64 -A`, verify.
 */
const WEAS_URL = "https://unpkg.com/weas@0.2.10/dist/index.mjs";
const WEAS_SRI = "sha384-efVjXe8Nmdlz3NBXJGqnS1ku5f6aE8PKCASUrdS120Se5ysqMUTurEQf1TPNgMH1";

/**
 * A JS string literal that is safe inside an inline <script>. JSON handles
 * quotes, backslashes and newlines; escaping `<` stops a `</script>` in the
 * data — which can come from a shared, world-writable MACE Link row — from
 * closing the script element early.
 */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function generateWeasHTML(
  structureData: string,
  format: "xyz" | "cif"
): string {

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #FBFAF7; }
    #viewer { width: 100%; height: 100%; }
    /* Hide only the zoom button — it doesn't work in iframe context.
       Keep all other WEAS control buttons (settings, etc.) */
    button[title*="oom"], button[title*="Zoom"],
    button[aria-label*="oom"], button[aria-label*="Zoom"] {
      display: none !important;
    }
  </style>
</head>
<body>
  <div id="viewer"></div>

  <script type="importmap">
    ${JSON.stringify({ imports: { weas: WEAS_URL }, integrity: { [WEAS_URL]: WEAS_SRI } })}
  </script>
  <script type="module">
    /**
     * WEAS viewer — loaded from CDN (same source as ml-peg).
     * Supports XYZ and CIF formats.
     * See: https://github.com/superstar54/weas
     */
    import { WEAS, parseXYZ, parseCIF } from 'weas';

    const domElement = document.getElementById("viewer");

    // Configure WEAS: keep GUI buttons enabled except zoom (broken in iframe)
    const guiConfig = {};
    const editor = new WEAS({
      domElement,
      viewerConfig: { _modelStyle: 1 },
      guiConfig,
    });

    // Remove zoom button after WEAS renders (it doesn't work in iframe)
    setTimeout(() => {
      const allBtns = document.querySelectorAll('button');
      allBtns.forEach(btn => {
        const text = (btn.textContent || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        if (text.includes('zoom') || title.includes('zoom')) {
          btn.remove();
        }
      });
    }, 500);

    // Structure data embedded inline
    const structureData = ${scriptLiteral(structureData)};
    const format = ${scriptLiteral(format)};

    try {
      if (format === "cif") {
        // CIF format: parse and render with VESTA colors and bonds
        const atoms = parseCIF(structureData);
        editor.avr.atoms = atoms;
        editor.avr.showBondedAtoms = true;
        editor.avr.colorType = "VESTA";
        editor.avr.boundary = [[-0.01, 1.01], [-0.01, 1.01], [-0.01, 1.01]];
        editor.avr.modelStyle = 2;
      } else {
        // XYZ format (default): parse and render with ball-and-stick
        const atoms = parseXYZ(structureData);
        editor.avr.atoms = atoms;
        editor.avr.modelStyle = 1;
      }

      editor.render();
    } catch (err) {
      domElement.innerText = "WEAS viewer error: " + err.message;
      domElement.style.color = "#C0392B";
      domElement.style.padding = "20px";
      domElement.style.fontFamily = "monospace";
      domElement.style.fontSize = "12px";
    }
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeasViewer({
  structureData,
  format = "xyz",
  height = 420,
}: WeasViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Generate the WEAS HTML and create a Blob URL for the iframe
  useEffect(() => {
    if (!structureData) return;

    setLoading(true);

    const html = generateWeasHTML(structureData, format);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);

    // Cleanup previous Blob URL on change
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [structureData, format]);

  // Mark loading complete when iframe loads
  const handleLoad = () => setLoading(false);

  return (
    <div className="relative" style={{ height, minHeight: height }}>
      {blobUrl && (
        <iframe
          ref={iframeRef}
          src={blobUrl}
          onLoad={handleLoad}
          title="WEAS Structure Viewer"
          sandbox="allow-scripts"
          className="h-full w-full border-0"
          style={{ height, minHeight: height, background: "#FBFAF7" }}
        />
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/80">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-primary/30 border-t-accent-primary" />
        </div>
      )}
    </div>
  );
}

/*
 * ============================================================================
 * DOCUMENTATION: WEAS Viewer Component
 * ============================================================================
 *
 * WHAT IS WEAS:
 *   WEAS (Web Environment for Atomistic Simulations) is an open-source
 *   JavaScript library for rendering atomic structures in the browser.
 *   Repository: https://github.com/superstar54/weas
 *
 * WHY WEAS:
 *   The MACE team's ml-peg tool (https://github.com/ddmms/ml-peg) uses WEAS
 *   for structure visualization. By using the same viewer, our tool:
 *     - Shares the same look and feel as ml-peg
 *     - Makes future integration easier (e.g. loading structures from ml-peg)
 *     - Aligns with the MACE ecosystem
 *
 * HOW IT'S LOADED:
 *   WEAS is NOT an npm dependency. It's loaded from CDN at runtime:
 *     import { WEAS, parseXYZ, parseCIF } from 'https://unpkg.com/weas/dist/index.mjs'
 *   This runs inside a sandboxed <iframe> to isolate it from React.
 *
 * HOW IT WORKS:
 *   1. React component receives XYZ/CIF data as a string prop.
 *   2. generateWeasHTML() builds a complete HTML page with:
 *      - WEAS CDN import
 *      - Structure data embedded as a JS template literal
 *      - Parser call (parseXYZ or parseCIF)
 *      - Render call
 *   3. The HTML is turned into a Blob URL.
 *   4. An <iframe> renders the Blob URL.
 *
 * COMPARISON WITH 3Dmol.js:
 *   | Feature          | 3Dmol.js              | WEAS                    |
 *   |------------------|-----------------------|-------------------------|
 *   | npm package      | Yes (3dmol)           | No (CDN only)           |
 *   | React integration| Direct DOM control    | iframe (isolated)       |
 *   | Used by ml-peg   | No                    | Yes                     |
 *   | Force vectors    | Yes (addArrow)        | Not built-in            |
 *   | XYZ support      | Yes                   | Yes                     |
 *   | CIF support      | Yes                   | Yes (with VESTA colors) |
 *   | Trajectory       | Limited               | Yes (built-in)          |
 *
 * EXTENDING:
 *   - To add more formats, add parser calls in generateWeasHTML().
 *   - To change the style (e.g. modelStyle), edit the editor.avr settings.
 *   - To enable WEAS GUI buttons, set buttons.enabled to true in guiConfig.
 *   - To support trajectories, pass multi-frame XYZ and use editor.avr.currentFrame.
 *
 * USAGE:
 *   <WeasViewer structureData={xyzString} format="xyz" height={400} />
 *   <WeasViewer structureData={cifString} format="cif" height={400} />
 * ============================================================================
 */
