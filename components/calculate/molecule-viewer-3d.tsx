"use client";

/**
 * MoleculeViewer3D — Dual-engine 3D structure viewer.
 *
 * VIEWER ENGINES:
 *   1. 3Dmol.js (npm) — Full-featured: representations, force vectors, spin,
 *      atom selection + geometry measurement, C–H hiding, PNG export.
 *   2. WEAS (CDN) — Matches ml-peg (https://github.com/ddmms/ml-peg).
 *      Used for compatibility with the MACE team's ecosystem.
 *      See: https://github.com/superstar54/weas
 *
 * The user can toggle between the two engines via a button in the toolbar.
 * Both engines receive the same XYZ data built from the CalculationResult.
 *
 * NOTE ON FORCE VECTORS:
 *   Only 3Dmol.js supports force arrow overlays. When WEAS is active, the
 *   force toggle button is disabled.
 *
 * RENDER QUALITY CONTRACT (see docs/v2/bars/rowan.md):
 *   1. Retina — the WebGL backing store is always >= 2x the CSS box.
 *      3Dmol's Renderer.setSize() reads window.devicePixelRatio and, when
 *      `upscale` is on, floors it at 2. Both `antialias` and `upscale` are
 *      passed EXPLICITLY below so this does not depend on a library default.
 *      setSize() only runs from viewer.resize(), which 3Dmol fires on CSS-box
 *      changes only — so we additionally watch devicePixelRatio itself
 *      (see watchPixelRatio) and re-resize when it changes with no relayout
 *      (browser zoom, dragging the window to a display of different density).
 *   2. Framing — the ATOMS are measured in screen space and fitted to
 *      TARGET_FILL of the canvas. 3Dmol's own zoomTo() leaves a small molecule
 *      at ~28% and cannot be corrected with a constant (see the framing block
 *      below). The fit is re-solved on every size change, including entering
 *      and leaving fullscreen. Force arrows are an overlay, not the subject:
 *      they are excluded from the fit and bounded in length instead, by a
 *      measured screen-space ceiling (ARROW_TIP_SAFE_FILL). Atoms hidden by
 *      "Hide C–H bonds" are STILL fitted, so hiding them changes nothing about
 *      the framing — the atoms that remain do not move by a pixel. The fit also
 *      RE-CENTRES on the projected bounding box, so a lopsided silhouette still
 *      fills the frame. Auto-rotation solves the SAME fit and then checks the
 *      swept volume as a CEILING (SWEEP_SAFE_FILL), so the spinning and still
 *      framings are identical wherever the sweep already fits — which for the
 *      default view it does.
 *   3. Shading — renderer-level dark contact outline + screen-space ambient
 *      occlusion, so overlapping atoms separate and contacts darken.
 *   4. Colours — Jmol CPK (C grey, H off-white, N blue, O red), with a
 *      luminance ceiling so nothing renders at the background colour. 3Dmol's
 *      built-in default is the washed-out RasMol table (C #C8C8C8, N #8F8FFF).
 *   5. Background — the canvas is TRANSPARENT (backgroundAlpha 0), so the
 *      molecule sits on whatever surface hosts the component instead of on an
 *      opaque rectangle of its own. This component therefore draws no card and
 *      no well: its callers own the surface. PNG export composites onto an
 *      opaque colour before download (see handleDownloadPng).
 *   6. Shape — the viewer box is `aspect-square` (capped in height), not a
 *      fixed 420 px. A fixed height makes a phone-width box 291x420 portrait,
 *      where a correct fit binds on the 291 px axis and leaves 45% of the box
 *      empty. The bar uses `aspect-square w-full max-w-md`.
 *
 * DEPENDENCIES:
 *   - 3dmol (npm)         — dynamically imported for 3Dmol.js mode
 *   - weas (CDN via iframe) — loaded at runtime for WEAS mode
 *   - ./weas-viewer.tsx   — WEAS iframe wrapper component
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  Eye,
  EyeOff,
  Circle,
  Box,
  Boxes,
  Settings2,
  Check,
  Download,
  Ruler,
  X,
  HelpCircle,
} from "lucide-react";
import type { AtomSpec, AtomStyleSpec, GLViewer } from "3dmol";
import type { CalculationResult } from "@/types/mace";
import { WeasViewer } from "./weas-viewer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Representation = "ball-and-stick" | "stick" | "spacefill";
type ViewerEngine = "3dmol" | "weas";

interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface MoleculeViewer3DProps {
  result: CalculationResult;
}

/**
 * Snapshot of one 3Dmol atom taken once at load. Measurement and box-select
 * read this instead of re-querying the viewer, so a style rebuild mid-gesture
 * cannot change the coordinates a measurement was computed from.
 */
interface AtomRecord {
  /** 3Dmol's own atom index — the key used by every selection spec here. */
  index: number;
  elem: string;
  x: number;
  y: number;
  z: number;
  /** Indices of the atoms 3Dmol PERCEIVED a bond to (distance-based). */
  bonds: number[];
}

/**
 * Everything the renderer needs to know about what should currently be drawn,
 * plus the one thing only the FRAMING path reads.
 */
interface ViewOptions {
  representation: Representation;
  showForces: boolean;
  hideNonpolarH: boolean;
  /** Ordered 3Dmol atom indices. Order is load-bearing: it sets the
   *  angle vertex and the dihedral sign. */
  selection: number[];
  /**
   * Auto-rotation. Changes nothing about what is DRAWN — applyView must never
   * read it, or toggling the rotation would tear down and rebuild every arrow.
   * It is here only so the imperative resize path can pick the same sweep
   * ceiling the React effects would (FrameSpec.spinning).
   */
  spin: boolean;
}

/**
 * The subset of ViewOptions that changes what is DRAWN. applyView takes THIS, so
 * that "the renderer cannot read the spin state" is enforced by the compiler
 * rather than by a comment. A full ViewOptions is assignable to it.
 */
type RenderOptions = Omit<ViewOptions, "spin">;

// ---------------------------------------------------------------------------
// 3Dmol.js render-quality settings
// ---------------------------------------------------------------------------

/**
 * Ceiling on the BASE colour's luminance, in 0-255. Jmol's hydrogen is
 * #FFFFFF, so without this every hydrogen's lit cap rendered at the background
 * colour and the atom dissolved into it, surviving only on its outline —
 * measured at 108 pixels of exactly (255,255,255) inside the silhouette.
 *
 * Set to 237 rather than 240: the canvas is now transparent and composites
 * onto the page tint #FBFAF7, whose luminance is ~250, not 255. The bar keeps
 * about 13 levels of headroom (its brightest pixel is 242 on a 255 page), and
 * 237 against 250 reproduces that same margin.
 *
 * This caps the base colour, NOT the rendered pixel. An earlier version of
 * this comment claimed 3Dmol's scene has a single directional light with no
 * ambient term, so output could never exceed base — that is false, and a
 * critic disproved it: oxygen's base is #FF0D0D yet its brightest rendered
 * pixel is (235,176,176), so green and blue land 163 above base. There is a
 * specular term. Grey and white are capped as intended (max measured exactly
 * 240); saturated colours can still blow toward pale. Ours reaches
 * (235,176,176) on oxygen where the bar holds (236,82,82) and keeps its hue —
 * their specular is tighter. Unfixed, and NOT addressed by this constant.
 *
 * Capping *luminance* (not per channel) darkens only the near-white entries and
 * leaves saturated colours alone: a red oxygen pixel at (255,13,13) has
 * luminance 64 and can never be confused with the background. Over the whole
 * 204-entry Jmol table this touches exactly four elements —
 *   H  #FFFFFF -> #F0F0F0     He #D9FFFF -> #D3F8F8
 *   Ce #FFFFC7 -> #F4F4BE     Pr #D9FFC7 -> #D6FCC5
 * C, N, O, F, P, S, Cl and every metal are unchanged.
 */
const WHITE_CEILING = 237;

/**
 * Ball-and-stick proportions. 3Dmol's `sphere.scale` multiplies the element's
 * van der Waals radius, so the ratio below is per element:
 *   C  (r_vdW 1.70) -> 0.374 A sphere / 0.15 A bond  = 2.49
 *   N  (r_vdW 1.55) -> 0.341 A                       = 2.27
 *   O  (r_vdW 1.52) -> 0.334 A                       = 2.23
 *   H  (r_vdW 1.20) -> 0.264 A                       = 1.76
 * Previously 0.30 / 0.25 — chunky spheres on very fat bonds. The bar renders
 * small spheres against a substantial bond radius; these numbers are the knob
 * to turn if a side-by-side still reads too heavy or too spindly.
 */
const SPHERE_SCALE = 0.22;
const BOND_RADIUS = 0.15;
const LICORICE_RADIUS = 0.18;
const SPACEFILL_SCALE = 1.0;

/** Fallback van der Waals radius, in Angstroms, for an element 3Dmol has no
 *  entry for. 1.2 A is hydrogen's — the smallest in the table, so an unknown
 *  element can only ever be UNDER-padded by the framing solver, never over. */
const FALLBACK_VDW = 1.2;

/**
 * Jmol CPK with the white cap applied — C grey, H off-white, N blue, O red.
 * 3Dmol's *default* table is RasMol (C #C8C8C8, N #8F8FFF, O #F00000), whose
 * carbon and nitrogen read as washed-out pastels on a white canvas.
 *
 * Built lazily because the source table lives on the dynamically imported
 * module. `{ prop, map }` is the shape 3Dmol uses for its own built-in schemes
 * (see getColorFromStyle in 3dmol/src/utilities.ts).
 */
type ElementScheme = { prop: "elem"; map: Record<string, number> };
let cpkScheme: ElementScheme | null = null;

/** van der Waals radii, cached off the imported module for framing maths. */
let vdwRadii: Record<string, number | undefined> | null = null;

/**
 * Dark contact outline — what separates overlapping atoms and keeps white
 * hydrogens visible against a white canvas.
 *
 * `width` is in view-space Angstroms, `maxpixels` caps the result in CSS pixels
 * (3Dmol multiplies the cap by devicePixelRatio internally, so the outline has
 * the same apparent weight at 1x and 2x). At typical framing — a ~12 A molecule
 * across an ~800 px canvas, so ~66 px/A — 0.05 A would project to ~3 px, and
 * the cap is what actually sets the weight. Zoomed out on a large slab the
 * width term takes over and the outline thins instead of swallowing the atoms.
 */
const OUTLINE = { width: 0.05, color: "#14171C", maxpixels: 2 };

/**
 * Screen-space ambient occlusion — soft contact shading where atoms meet.
 * `radius` is the occlusion sampling ray length in Angstroms (view space, not
 * pixels), so the width of the rim band ON SCREEN scales with radius x the
 * current pixels-per-Angstrom. Framing now fills the canvas ~2.7x more than it
 * used to, which would have widened the rim by the same factor and turned the
 * shading into an embossed vignette around every atom; 0.9 A holds the band at
 * roughly its previous absolute pixel width while the atoms themselves grew,
 * so it reads as contact shading rather than an outline glow. It also shrinks
 * the SSAO halo that leaks around silhouette edges (the depth-discontinuity
 * artifact behind occluded bonds). 3Dmol's default 5.0 A is longer than a whole
 * small molecule; strength 1.0 (also the default) crushes crevices to black.
 * WebGL2 only; also gated on atom count below.
 */
const AMBIENT_OCCLUSION = { strength: 0.6, radius: 0.9 };

/** Above this many atoms the SSAO depth pre-pass costs more than it buys. */
const AO_MAX_ATOMS = 600;

/** How long the pointer must rest on an atom before the info box appears. */
const HOVER_DURATION_MS = 140;

// ── Framing ────────────────────────────────────────────────────────────────
//
// 3Dmol's zoomTo() is badly under-zoomed for small structures. It sets the
// camera so the viewport half-height equals the largest centre-to-atom distance
// (3dmol/src/GLViewer.ts, zoomTo) — a 3D bounding-sphere radius, floored at
// `minimumZoomToDistance` = 5 A. Ethanol's atoms all sit within ~2.2 A of the
// centroid, so the floor wins outright and the molecule occupies ~28% of the
// short axis. It also ignores orientation: a flat molecule seen face-on gets
// the same fit as edge-on.
//
// Rather than multiplying by a constant (right for 9 atoms, clips at 75), the
// framing below measures the actual projected silhouette and solves for the
// zoom that lands it at TARGET_FILL, then re-measures. Cropping is impossible
// by construction for any structure size.

/**
 * Fraction of the binding axis the silhouette should span.
 *
 * WHY 0.82, AND WHY THE OLD 0.76 WAS CALIBRATED AGAINST A WRONG NUMBER:
 * this constant used to read "Bar measures 0.739" — a figure that appears
 * nowhere in docs/v2/bars/rowan.md and carries no record of the box it was
 * measured in. Fill on the binding axis is aspect-dependent, so a number
 * without its aspect ratio is not a target. The measurement that IS recorded
 * (docs/v2/progress.json) has the bar at 0.825 on its binding axis in an
 * 824x840 backing buffer — a 412x420 CSS box at DPR 2, byte-identical to the
 * buffer this component gets in the hero. So 0.76 was not "just under the
 * bar": it was 3% over an unattributed number and 8% under the only
 * attributed one.
 *
 * 0.82, not 0.825, because the remaining 18% of the box has to absorb things
 * the solver deliberately does not measure:
 *   - the contact outline, ~2 CSS px per side (OUTLINE.maxpixels);
 *   - the selection highlight, which draws a selected atom +SELECTION_HALO_PAD
 *     (0.10 A) larger than usual and is NOT re-framed when you click, so it
 *     must fit in the margin — ~4 px on spacefill, ~8 px on stick at a typical
 *     fit;
 *   - FRAMING_TOLERANCE, up to 0.5% of the fit;
 *   - the bar's own 0.825 being a single-aspect measurement of a single
 *     molecule. Matching it to three digits would be calibrating to noise for
 *     the second time.
 * At 412 CSS px that leaves ~37 px of margin per side on the binding axis,
 * against a worst case of roughly 10 px. Nothing above is aspect-dependent:
 * the solver takes min(width constraint, height constraint), so the binding
 * axis lands on TARGET_FILL and the other axis lands below it, at any shape
 * of box.
 *
 * Force arrows are NOT in that list. They are an overlay and are allowed to
 * overflow the frame; their length is clamped instead so the overflow stays
 * bounded (MAX_FORCE_ARROW_FRACTION).
 *
 * FORMERLY A "KNOWN LIMIT", NOW FIXED — see frameView(): zoomTo() centres the
 * atoms' CENTROID (getExtent()[2] is the mean of the coordinates), which is not
 * the centre of the PROJECTED silhouette at an arbitrary rotation, and the old
 * solver fitted a
 * centre-symmetric envelope so that neither side could crop. A structure whose
 * projected bbox centre sat far from that point therefore landed below
 * TARGET_FILL by exactly the asymmetry (measured: hiding five C–H hydrogens on
 * ethanol dropped the fill from 0.806 to 0.591 — a declutter control that made
 * the subject smaller). The old note here claimed the correction required
 * panning the model off 3Dmol's rotation centre. That is true of
 * translateScene(), which moves modelGroup INSIDE rotationGroup and therefore
 * turns rotate() into an orbit; it is not true of rotationGroup's own x/y
 * offset, which is applied AFTER the rotation quaternion. frameView() uses the
 * latter, so the molecule still turns about its own centre.
 *
 * HIDDEN ATOMS ARE FITTED TOO. The fill above is the fill of the WHOLE
 * structure, hidden C–H hydrogens included. Fitting only the drawn subset
 * re-zoomed the view every time "Hide C–H bonds" was toggled: measured on
 * ethanol at 766x520, 131.9 -> 186.5 px/A, a 1.41x magnification of the atoms
 * that stayed, which in the 664 px box it was reported in clipped the arrows at
 * both edges. The bar for
 * the controls (Mol*) is that toggling any control changes apparent size by 0%,
 * and a declutter control cannot meet that if it also reframes. So with C–H
 * hidden the remaining atoms fill less of the box than 0.82 — by exactly the
 * hydrogens that are gone — and stay where they were.
 */
const TARGET_FILL = 0.82;

/** Extra screen-pixel allowance for the outline, which sits outside the atom. */
const OUTLINE_PAD_PX = 3;

/** Measure/correct passes. Two is normally enough; the rest are insurance. */
const FRAMING_PASSES = 4;

/** Stop once the correction is this close to 1. */
const FRAMING_TOLERANCE = 0.005;

/** Stop re-centring once the projected bbox centre is this close to the view
 *  centre, in CSS pixels. Sub-pixel corrections are not visible. */
const FRAMING_PAN_TOLERANCE_PX = 0.5;

/**
 * Hard ceiling on total zoom applied after zoomTo(), against runaway fits.
 *
 * Legitimate need is at most ~6x: zoomTo()'s `minimumZoomToDistance` floor of
 * 5 A leaves a small molecule at ~28% of the short axis (2.9x short of the
 * 0.82 target), and zoomTo() ALSO folds every shape's bounding box into its
 * own extent — including the force arrows — so with arrows on it starts
 * further out again. 12 keeps ~2x of headroom while still catching a
 * degenerate measurement (all atoms projecting to one pixel would otherwise
 * ask for a zoom of several hundred).
 */
const MAX_TOTAL_FRAMING_ZOOM = 12;

/** Floor, so a structure that would crop can always be pulled back. */
const MIN_TOTAL_FRAMING_ZOOM = 0.2;

/**
 * ROTATION SAFETY, AND WHY IT IS A CEILING RATHER THAN A FILL TARGET.
 *
 * A silhouette fit is correct for exactly one orientation. Rotating the
 * structure changes its projected extent, so a static per-orientation fit
 * drifts: measured over 32 samples of a spin, the fill swung 0.7365 to 0.9221 —
 * up to 12% OVER TARGET_FILL, which is the direction that clips.
 *
 * The previous fix swapped the fit for a rotation-invariant envelope WHILE
 * SPINNING, and fitted that envelope to TARGET_FILL. It delivered no clipping
 * at any angle, and it cost 27% of the apparent size the instant the rotation
 * was engaged — measured 843 px static against 593-663 px spinning, with the
 * molecule popping back when the spin stopped. Two different envelopes fitted
 * to the same target CANNOT agree; that is arithmetic, not tuning. Reproduced
 * here from the geometry alone: ethanol's centroid-centred bounding sphere is
 * 4.196 A across where its silhouette is 3.07 A, so a sphere fitted to 0.82
 * lands the silhouette at 0.60 — a 26.8% shrink, which is the measurement.
 *
 * TWO CHANGES, AND WHICH ONE MATTERS.
 *
 * 1. The envelope is no longer a SPHERE. `spin(true)` is `rotate(1, 'y')`
 *    (3dmol/src/GLViewer.ts), which PRE-multiplies the view quaternion and so
 *    turns the model about ITS OWN y axis through the rotation centre. The swept
 *    volume is therefore bounded by a CYLINDER about that axis, not by a sphere:
 *    for ethanol 3.734 x 3.129 A against the sphere's 4.196 x 4.196. The sphere
 *    was throwing away a quarter of the frame for nothing.
 *
 * 2. It is a CEILING, not a fill target, and it runs only while the rotation is
 *    actually on. TARGET_FILL is an aesthetic target for the subject; "cannot
 *    clip while spinning" only asks that the swept volume stay INSIDE the canvas.
 *    So both states solve the same per-orientation fit, and the spinning one is
 *    pulled back afterwards only if the sweep would leave the frame.
 *
 * Together those are what close the gap, and the arithmetic says by how much. In
 * the 664 x 514 box the defect was measured in, ethanol's static fit needs
 * 137.2 px/A and its y-axis sweep permits 164.3 — the ceiling does not bind, so
 * the framing while spinning is IDENTICAL to the framing while still and the
 * 27-30% pop is zero. In a 470 x 470 hero box: 125.4 needed against 125.9
 * permitted, also zero. Neither number is a tuned constant; both fall out of the
 * geometry.
 *
 * FORMERLY NOT FIXED, NOW GONE WITH ITS CAUSE. With "Hide C–H bonds" on, the
 * fit used to be solved for the four drawn atoms (2.14 A tall), magnifying to
 * 196.6 px/A, while the swept cylinder stayed 3.73 A wide because its radial
 * extreme is the OXYGEN — so engaging the rotation in that sub-state stepped
 * down ~16%, and no spin axis could avoid it. Both the fit and the sweep are now
 * taken over EVERY atom, hidden ones included (see TARGET_FILL), so hiding C–H
 * leaves both exactly as they are without it, and the step is the default
 * view's. Measured at 766x520: rotation engages at the same zoom with C–H hidden
 * as without, both a 1.05% pull-back — this box is one where the sweep ceiling
 * binds slightly — and at 291x291 both at 0%.
 */
const SWEEP_SAFE_FILL = 0.99;

/**
 * Rim samples per circle when measuring the swept cylinder. The radius is
 * inflated by 1/cos(pi/N) so the sampled polygon CIRCUMSCRIBES the circle and
 * the measurement cannot under-report the sweep; at 32 that is a 0.5% inflation.
 */
const SWEEP_RING_SAMPLES = 32;

/** Ceiling on Angstroms drawn per eV/A of force, reached by large structures. */
const FORCE_ARROW_SCALE = 5;

/**
 * The force, in eV/A, whose arrow is drawn at MAX_FORCE_ARROW_FRACTION of the
 * structure's own span (see structureSpan and referenceArrowScale).
 *
 * WHY A FIXED REFERENCE FORCE AND NOT THE LARGEST FORCE (D9). The scale used to
 * be set so that the LONGEST arrow came out at 0.45 of the span — that is, it
 * divided by |F|max. That makes the scale a property of the FORCES, and so of the
 * model: MACE-MP-0 and MACE-OFF on the demo ethanol have |F|max of 1.62 and
 * 2.04 eV/A, which put them at 1.02 and 0.81 A per eV/A (the reported "1.0 vs
 * 0.82") and, once rounded to a rung, at 1.0 and 0.50. Measured at 766x520, the
 * longest arrow was then 1.62 A under MP-0 and 1.02 A under OFF: the LARGER force
 * drew the SHORTER arrow, normalising away exactly the difference a comparison is
 * for.
 *
 * Dividing by a fixed force instead makes the scale a property of the GEOMETRY
 * alone. Two results for one structure now draw at one scale whatever model
 * produced them (both 1.0 A per eV/A on ethanol, so the OFF arrows are 26%
 * longer, as its forces are), and so do a structure before and after
 * optimisation: a relaxed result's arrows really are short, on the same ruler as
 * the unrelaxed ones.
 *
 * 1 eV/A because it is the round number in the middle of what a single-point on
 * an unrelaxed input produces, and 0.45 of the span because an arrow for it is
 * then a little under half the molecule: clearly visible against the structure.
 * The scale is still bounded on screen (ARROW_TIP_SAFE_FILL), since a few
 * eV/A on a small molecule would otherwise draw past the frame — and that bound
 * depends on the forces again, so when it binds the legend says so and prints
 * the scale it cut from. On ethanol it does not bind at 766x520 under either
 * model; in the 291 px phone box it cuts both to 0.50, and the legend says so.
 */
const ARROW_REFERENCE_FORCE = 1;
const MAX_FORCE_ARROW_FRACTION = 0.45;

/**
 * Fraction of the canvas half-extent an arrow TIP may reach.
 *
 * Measured after the fit and applied by shortening the arrows — never by
 * zooming out. That distinction is the whole point: the fit is solved from the
 * atoms alone, so showing or hiding the arrows leaves the molecule's size
 * byte-identical (measured: centroid moves 0.02 px, fill 0.8106 either way). A
 * guard that zoomed out to make room for arrows would destroy exactly that
 * property. Shortening an arrow costs nothing that is not already printed in the
 * legend; shrinking the molecule costs the subject.
 *
 * Hence also why this is 0.98 while SWEEP_SAFE_FILL is 0.99 — the two margins
 * are not the same kind of thing. This one is free, so it is generous.
 */
const ARROW_TIP_SAFE_FILL = 0.98;

/**
 * Rungs the arrow scale is rounded DOWN to, per decade — a map scale bar's
 * ladder. Two purposes:
 *
 *   1. STABILITY. The scale now has a measured screen-space ceiling, so without
 *      quantisation the printed number would drift with the window width.
 *      Rounding to a rung makes it reproducible.
 *   2. ROUNDNESS. "0.5 A per eV/A" reads as a chosen scale; "0.82" reads as an
 *      accident, which is how the reported defect looked.
 *
 * Rounding is NOT what makes two results comparable — no quantisation of a
 * force-dependent number can be, since any ladder has a rung between some pair of
 * results. That is done by taking the forces out of the scale altogether (see
 * ARROW_REFERENCE_FORCE). Where the screen-space ceiling still brings them back,
 * the legend names the cut and the length-reference tick, whose drawn length IS
 * the scale, shows it.
 */
const ARROW_SCALE_RUNGS = [1, 2, 5];

/**
 * Reference forces for the legend's length tick, in eV/A, and the CSS-pixel band
 * the tick may occupy.
 *
 * POWERS OF TEN ONLY, AND THAT IS THE WHOLE POINT. The tick exists so that two
 * results drawn at different arrow scales — different structures, or one whose
 * arrows were cut to fit the frame — LOOK different. A
 * reference chosen to normalise the tick to a comfortable length would defeat
 * that exactly: both would draw a ~36 px rule and only the label beside it would
 * change, which is the defect over again. With a decade ladder the rung is stable
 * across any scale change under 10x, so the tick's LENGTH is directly
 * proportional to the scale — 0.5 A per eV/A draws half the rule that 1.0 does,
 * visible at a glance, with the same "1 eV/A" label under both.
 *
 * The band is generous at the top for the same reason: clipping the tick short
 * would re-normalise it. 1e-3 to 1e3 keeps every label out of exponent notation.
 */
const TICK_FORCE_DECADES = [0.001, 0.01, 0.1, 1, 10, 100, 1000];
const TICK_MIN_PX = 8;
const TICK_MAX_PX = 140;

/** Floor on the structure span used by the arrow scale, in Angstroms. Without
 *  it a single atom (span 0) would draw every arrow at zero length. */
const MIN_STRUCTURE_SPAN = 2;

/** Shaft radius of a force arrow, in Angstroms. */
const FORCE_ARROW_RADIUS = 0.08;

/** Fallback canvas background if the theme token cannot be resolved. */
const FALLBACK_BACKGROUND = "#FFFFFF";

// ── Selection & measurement ────────────────────────────────────────────────

/** SimpleAtom's own accent green (--color-accent-primary), NOT Rowan's. */
const SELECTION_COLOUR = "#4F9A54";

/**
 * Angstroms a SELECTED atom is drawn larger than its unselected self.
 *
 * WHY THERE IS NO TRANSLUCENT SHELL ANY MORE (D13). The highlight used to be a
 * green sphere at opacity 0.62 drawn 0.10 A outside the atom, as a halo. Over the
 * page that halo was measured at (243,240,232) -> (235,235,228): the green
 * channel FELL by 5, so the ring read as nothing at all. The cause is 3Dmol, not
 * the number: with a transparent canvas (backgroundAlpha 0) a translucent shape
 * is blended against the canvas's own clear colour — white at alpha 0 — rather
 * than against the page behind it, so it composites close to white and close to
 * transparent. Measured effective alpha is ~0.04 at a nominal 0.62 and ~0.5 at
 * 0.9; no opacity both reads as green and stays a halo. Disabling ambient
 * occlusion or the outline changes nothing, so neither is the cause.
 *
 * So the highlight is OPAQUE: the selected atom itself is redrawn in the accent
 * green at its normal radius plus this pad (see selectedStyle). Opaque geometry
 * composites exactly, so the footprint the halo was for — larger than the atom,
 * visible against the page and against a neighbour — is now actually green: the
 * same ring of pixels, now the shaded rim of the enlarged ball, measures
 * (29,56,31), and the atom's centre (76,148,81).
 */
const SELECTION_HALO_PAD = 0.1;

/** Floor on the selected-atom radius, so the stick rep still shows a ball. */
const SELECTION_HALO_MIN = 0.3;

/** Drag shorter than this (CSS px) counts as a click, not a box-select. */
const MARQUEE_CLICK_SLOP_PX = 4;

/**
 * Extra CSS pixels of slack around a stick when deciding "did the user click
 * the bond rather than the atom". 3Dmol reports the nearer ATOM for a click
 * anywhere on that atom's half-cylinder and never says which geometry was hit,
 * so the atom-vs-bond distinction has to be re-derived in screen space here.
 */
const BOND_PICK_SLOP_PX = 3;

// ---------------------------------------------------------------------------
// Helpers — theme, WebGL, colour
// ---------------------------------------------------------------------------

/**
 * Resolve the canvas background from the theme instead of hard-coding it.
 * Light theme -> #FFFFFF (matches the bar); .dark -> the dark elevated surface.
 * 3Dmol's colour parser treats an unrecognised string as black, so anything
 * that is not an unambiguous hex/rgb() value falls back to white.
 */
function readCanvasBackground(host: HTMLElement): string {
  if (typeof window === "undefined") return FALLBACK_BACKGROUND;
  try {
    const value = window
      .getComputedStyle(host)
      .getPropertyValue("--color-bg-elevated")
      .trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
    if (/^rgba?\(/i.test(value)) return value;
  } catch {
    /* getComputedStyle can throw on detached nodes — use the fallback */
  }
  return FALLBACK_BACKGROUND;
}

/**
 * 3Dmol's ambient-occlusion path allocates depth/shading attachments that only
 * exist on a WebGL2 context; on WebGL1 it silently no-ops at best. Asking an
 * already-initialised canvas for "webgl2" returns the existing context if it is
 * WebGL2 and null otherwise — no second context is created.
 */
function rendersWithWebGL2(viewer: GLViewer): boolean {
  try {
    const renderer = viewer.getRenderer();
    if (!renderer) return false;

    // Ask the renderer what it actually created. Do NOT probe the visible
    // canvas: `upscale: true` makes 3Dmol render into an OffscreenCanvas and
    // blit the result, so the visible canvas holds a `bitmaprenderer` context
    // and getContext("webgl2") returns null even on a WebGL2 machine. That
    // false negative disabled ambient occlusion on every single load, which
    // in turn made the AO radius constant dead code.
    const version = (renderer as unknown as { _webglversion?: number })
      ._webglversion;
    if (typeof version === "number") return version === 2;

    // Older 3Dmol builds do not expose _webglversion. Fall back to the visible
    // canvas, which is only meaningful when we are not rendering offscreen.
    const canvas = renderer.getCanvas?.() as HTMLCanvasElement | undefined;
    return !!canvas?.getContext?.("webgl2");
  } catch {
    return false;
  }
}

/**
 * Scale a packed 0xRRGGBB colour down until its Rec.709 luminance is at most
 * WHITE_CEILING. Hue and saturation are preserved because all three channels
 * are scaled by the same factor.
 */
function capLuminance(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance <= WHITE_CEILING) return hex;
  const k = WHITE_CEILING / luminance;
  return (
    (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k)
  );
}

/**
 * Cache the Jmol table (white-capped) and the vdW radii off the imported
 * module. Both are static data on a singleton module, so building once is safe.
 */
function cacheColourTables($3Dmol: typeof import("3dmol")): void {
  if (!cpkScheme) {
    const jmol = $3Dmol.elementColors?.Jmol as
      | Record<string, number>
      | undefined;
    const map: Record<string, number> = {};
    for (const [element, colour] of Object.entries(jmol ?? {})) {
      if (typeof colour === "number") map[element] = capLuminance(colour);
    }
    cpkScheme = { prop: "elem", map };
  }
  if (!vdwRadii) {
    vdwRadii = $3Dmol.GLModel?.vdwRadii as
      | Record<string, number | undefined>
      | null;
  }
}

// ---------------------------------------------------------------------------
// Helpers — representation geometry
// ---------------------------------------------------------------------------

/** Style spec for a representation, using the white-capped CPK scheme. */
function repStyle(rep: Representation): AtomStyleSpec {
  // Falls back to the built-in scheme name if the module has not loaded yet;
  // in practice applyView only runs after cacheColourTables().
  const scheme = cpkScheme ?? "Jmol";
  switch (rep) {
    case "spacefill":
      // True van der Waals spacefill. Was 0.6, which is not spacefill.
      return { sphere: { scale: SPACEFILL_SCALE, colorscheme: scheme } };
    case "stick":
      // Licorice. showNonBonded keeps isolated atoms visible when 3Dmol's
      // distance-based bond perception finds no neighbours (ions, lone atoms).
      return {
        stick: {
          radius: LICORICE_RADIUS,
          colorscheme: scheme,
          showNonBonded: true,
        },
      };
    default:
      return {
        stick: { radius: BOND_RADIUS, colorscheme: scheme },
        sphere: { scale: SPHERE_SCALE, colorscheme: scheme },
      };
  }
}

/**
 * The same representation as repStyle(), painted in the accent green instead of
 * by element and drawn selectionHaloRadius() across instead of at its normal
 * radius. Applied to each SELECTED atom on top of the base style; per atom,
 * because the radius depends on the element.
 *
 * The sphere is given as an absolute `radius` with no `scale`, because 3Dmol
 * multiplies the two (GLModel.getRadiusFromStyle) and the radius here is already
 * the finished one. In the stick rep the sphere is ADDED: licorice has no ball to
 * enlarge, and without one the selection is a green joint 0.18 A across.
 *
 * `colorscheme` is deliberately absent rather than set alongside `color`:
 * 3Dmol's getColorFromStyle() applies the scheme AFTER `style.color`, and its
 * own type doc says "colorscheme to use on atoms; overrides color". Passing
 * both would silently keep CPK and the highlight would not appear at all.
 *
 * Half of each stick to a selected atom turns green too, because 3Dmol draws a
 * bond as two half-cylinders coloured by their own atom. That is a feature
 * here: it makes a bond-click selection visible along the bond.
 */
function selectedStyle(
  elem: string | undefined,
  rep: Representation
): AtomStyleSpec {
  const sphere = {
    radius: selectionHaloRadius(elem, rep),
    color: SELECTION_COLOUR,
  };
  switch (rep) {
    case "spacefill":
      return { sphere };
    case "stick":
      return {
        stick: {
          radius: LICORICE_RADIUS,
          color: SELECTION_COLOUR,
          showNonBonded: true,
        },
        sphere,
      };
    default:
      return {
        stick: { radius: BOND_RADIUS, color: SELECTION_COLOUR },
        sphere,
      };
  }
}

/** van der Waals radius in Angstroms for one element symbol. */
function vdwRadius(elem: string | undefined): number {
  const e = elem ?? "C";
  const r =
    vdwRadii?.[e] ??
    vdwRadii?.[e.charAt(0).toUpperCase() + e.slice(1).toLowerCase()];
  return typeof r === "number" && r > 0 ? r : FALLBACK_VDW;
}

/**
 * Radius, in Angstroms, that THIS atom is actually drawn at in THIS
 * representation.
 *
 * THE FRAMING BUG THIS REPLACES: the old maxDrawnRadius() returned the largest
 * radius over every element PRESENT, and measureProjectedExtent added that one
 * number to the extreme projected coordinate — and to the force-arrow tips,
 * which have no sphere at all. The estimated silhouette was therefore
 *     max_i |x_i - centre|  +  max_i r_i
 * where the true silhouette is
 *     max_i ( |x_i - centre| + r_i ).
 * Those are equal only when the outermost atom is also the fattest one. The
 * gap is (max_i r_i - r_outermost) and it scales with the radii, so the
 * bulkier the representation the more the solver over-padded and the more it
 * under-zoomed: measured fill was stick 0.732 > ball-and-stick 0.703 >
 * spacefill 0.669 against a 0.76 target — the bulkiest representation came out
 * SMALLEST, which is backwards. With force arrows visible it was worse still,
 * because every arrow tip was padded by a full spacefill sphere radius (1.7 A
 * for carbon) that is not drawn anywhere near it.
 *
 * Per-atom radii make the estimate tight for every representation, so the
 * three now converge on the same fill instead of ranking by bulk.
 */
function drawnRadius(elem: string | undefined, rep: Representation): number {
  if (rep === "stick") return LICORICE_RADIUS;
  if (rep === "spacefill") return vdwRadius(elem) * SPACEFILL_SCALE;
  // Ball-and-stick: the sphere normally wins, but never report less than the
  // bond radius — the stick is drawn right through the atom centre.
  return Math.max(vdwRadius(elem) * SPHERE_SCALE, BOND_RADIUS);
}

/** Radius, in Angstroms, a selected atom is drawn at — see SELECTION_HALO_PAD. */
function selectionHaloRadius(elem: string | undefined, rep: Representation) {
  return Math.max(
    drawnRadius(elem, rep) + SELECTION_HALO_PAD,
    SELECTION_HALO_MIN
  );
}

// ---------------------------------------------------------------------------
// Helpers — projection & framing
// ---------------------------------------------------------------------------

/**
 * The projected silhouette, as SIGNED CSS-pixel offsets from the centre of the
 * viewport. Signed, not folded to a half-extent, because the solver needs both
 * the size (max - min) and the asymmetry (min + max) — the second is what the
 * old symmetric-envelope fit threw away.
 */
interface ProjectedExtent {
  /** Left/right edges of the silhouette, negative = left of the view centre. */
  minX: number;
  maxX: number;
  /** Top/bottom edges, negative = above the view centre (screen y is down). */
  minY: number;
  maxY: number;
  viewHalfWidth: number;
  viewHalfHeight: number;
  /** CSS pixels per Angstrom at the drawn atoms' centroid. */
  pxPerAngstrom: number;
}

/**
 * What the framing solver has to keep inside the frame.
 *
 * `spinning` selects a CEILING, not a different fit — see SWEEP_SAFE_FILL. The
 * fit itself is the same per-orientation solve in both states, which is why the
 * two states agree wherever the ceiling does not bind. Do not turn it back into a
 * mode switch.
 *
 * There is deliberately no hidden-atom set here: hidden atoms are framed as if
 * drawn (see TARGET_FILL), so "Hide C–H bonds" is not a framing input at all.
 */
interface FrameSpec {
  rep: Representation;
  /** Auto-rotate is on, so the swept volume must also fit the canvas. */
  spinning?: boolean;
}

/**
 * What a completed fit tells the rest of the component. `pxPerAngstrom` is what
 * lets the legend draw a length reference that is true in pixels.
 */
interface FrameMetrics {
  pxPerAngstrom: number;
  viewHalfWidth: number;
  viewHalfHeight: number;
}

/** Screen-space basis of the current projection, in CSS pixels per Angstrom. */
interface ProjectionBasis {
  /** Pixels per Angstrom at the probe point (perspective: depth-dependent). */
  pxPerAngstrom: number;
  /** Model-space unit vector that projects to screen +x with no y component. */
  screenX: Point3;
  /** Model-space unit vector that projects to screen +y with no x component. */
  screenY: Point3;
}

/**
 * Probe 3Dmol's own projection at `origin` and recover the screen basis.
 *
 * For a model rotation R followed by dropping the depth component, the screen
 * images of the model unit axes are the first two ROWS of R (times the scale).
 * So the model-space direction that maps to screen +x is the COLUMN vector
 * (a.x, b.x, c.x) where a, b, c are the projected images of e_x, e_y, e_z —
 * and it is perpendicular to the view axis by construction, which is what
 * makes it safe to offset a sphere along it under a perspective camera: the
 * offset changes screen x only, not depth. sum|P R e_i|^2 = 2 gives the scale
 * with no assumption about how the model is rotated.
 */
function probeProjection(
  viewer: GLViewer,
  origin: Point3
): ProjectionBasis | null {
  const probes = [
    origin,
    { x: origin.x + 1, y: origin.y, z: origin.z },
    { x: origin.x, y: origin.y + 1, z: origin.z },
    { x: origin.x, y: origin.y, z: origin.z + 1 },
  ];
  const screen = viewer.modelToScreen(probes) as Array<{
    x: number;
    y: number;
  }>;
  if (!Array.isArray(screen) || screen.length !== 4) return null;

  const o = screen[0];
  const ax = screen[1].x - o.x;
  const ay = screen[1].y - o.y;
  const bx = screen[2].x - o.x;
  const by = screen[2].y - o.y;
  const cx = screen[3].x - o.x;
  const cy = screen[3].y - o.y;

  const sumSquares = ax * ax + ay * ay + bx * bx + by * by + cx * cx + cy * cy;
  const pxPerAngstrom = Math.sqrt(sumSquares / 2);
  if (!Number.isFinite(pxPerAngstrom) || pxPerAngstrom <= 0) return null;

  const ux = ax;
  const uy = bx;
  const uz = cx;
  const un = Math.hypot(ux, uy, uz);
  const vx = ay;
  const vy = by;
  const vz = cy;
  const vn = Math.hypot(vx, vy, vz);
  if (!un || !vn) return null;

  return {
    pxPerAngstrom,
    screenX: { x: ux / un, y: uy / un, z: uz / un },
    screenY: { x: vx / vn, y: vy / vn, z: vz / vn },
  };
}

/** One point's signed CSS-pixel offset from the centre of the viewport. */
interface ScreenOffset {
  x: number;
  y: number;
}

/** Per-point screen offsets plus the viewport half-size, in CSS pixels. */
interface ProjectedPoints {
  offsets: ScreenOffset[];
  viewHalfWidth: number;
  viewHalfHeight: number;
}

/**
 * Project model points through 3Dmol's OWN projection and return their offsets
 * from the centre of the viewport.
 *
 * The single primitive every measurement here is built on, so the silhouette
 * fit, the rotation-sweep ceiling and the arrow-tip ceiling cannot disagree
 * about where the centre of the canvas is. modelToScreen returns PAGE
 * coordinates, so the viewport centre is rebuilt the way 3Dmol's own
 * canvasOffset() does.
 */
function projectedPoints(
  viewer: GLViewer,
  points: Point3[]
): ProjectedPoints | null {
  if (points.length === 0) return null;
  const canvas = viewer.getRenderer()?.getCanvas() as
    | HTMLCanvasElement
    | undefined;
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const screen = viewer.modelToScreen(points) as Array<{
    x: number;
    y: number;
  }>;
  if (!Array.isArray(screen) || screen.length !== points.length) return null;

  const doc = canvas.ownerDocument.documentElement;
  const left = rect.left + window.scrollX - doc.clientLeft;
  const top = rect.top + window.scrollY - doc.clientTop;
  const centreX = left + rect.width / 2;
  const centreY = top + rect.height / 2;

  const offsets: ScreenOffset[] = [];
  for (const s of screen) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
    offsets.push({ x: s.x - centreX, y: s.y - centreY });
  }

  return {
    offsets,
    viewHalfWidth: rect.width / 2,
    viewHalfHeight: rect.height / 2,
  };
}

/**
 * The largest fraction of a canvas half-extent any of `offsets` reaches. 1.0
 * means something touches the edge; above 1.0 it is clipped. The padded
 * comparison is symmetric (max of |min| and |max| per axis), so the answer does
 * not depend on which side the overflow is on.
 */
function overflowFraction(
  projected: ProjectedPoints,
  safeFill: number
): number {
  let maxX = 0;
  let maxY = 0;
  for (const o of projected.offsets) {
    maxX = Math.max(maxX, Math.abs(o.x));
    maxY = Math.max(maxY, Math.abs(o.y));
  }
  const limitX = projected.viewHalfWidth * safeFill - OUTLINE_PAD_PX;
  const limitY = projected.viewHalfHeight * safeFill - OUTLINE_PAD_PX;
  if (limitX <= 0 || limitY <= 0) return 1;
  return Math.max(maxX / limitX, maxY / limitY);
}

/**
 * Every atom in the model, with the radius it is drawn at in this
 * representation, and the centroid of the whole model.
 *
 * EVERY atom, hidden ones included, with the radius it would be drawn at if
 * shown. Hiding a hydrogen changes its style, not its existence, and the framing
 * is solved for the structure, not for the current declutter setting — see
 * TARGET_FILL for the 1.41x re-zoom that taking only the drawn subset produced.
 *
 * The centroid is the point zoomTo() parks at the centre of the viewport AND the
 * point the spin turns about — GLViewer.zoomTo sets modelGroup.position to
 * -getExtent()[2], which is the mean of the coordinates (not the bounding-box
 * centre) of the atoms alone, before shapes are folded into the slab.
 */
function collectFramed(
  viewer: GLViewer,
  spec: FrameSpec
): { atoms: Array<{ p: Point3; r: number }>; centre: Point3 } | null {
  const atoms: Array<{ p: Point3; r: number }> = [];
  let ax = 0;
  let ay = 0;
  let az = 0;

  for (const a of viewer.selectedAtoms({})) {
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      !Number.isFinite(a.z)
    ) {
      continue;
    }
    const p = { x: a.x as number, y: a.y as number, z: a.z as number };
    ax += p.x;
    ay += p.y;
    az += p.z;
    atoms.push({ p, r: drawnRadius(a.elem, spec.rep) });
  }
  if (atoms.length === 0) return null;
  const n = atoms.length;
  return { atoms, centre: { x: ax / n, y: ay / n, z: az / n } };
}

/**
 * How far outside the canvas the SPIN would carry the structure, as a fraction
 * of the safe area — see SWEEP_SAFE_FILL. At or below 1.0 nothing can clip at
 * any rotation angle reachable from the current orientation.
 *
 * `spin(true)` is `rotate(1, 'y')`, which does `quaternion.multiply(q)` — a
 * PRE-multiplication, so q acts in model space and the structure turns about its
 * own y axis through the rotation centre. The volume swept over a full turn is
 * therefore contained in the cylinder about that axis with
 *     radius     = max over all atoms of ( hypot(dx, dz) + r )
 *     y from     = min ( y - r )  to  max ( y + r )
 * where dx, dz are measured from the rotation centre. The cylinder is convex, so
 * the extreme point of its projection always lies on one of the two rim circles;
 * a middle ring is sampled as well because under a perspective camera the
 * nearest-depth point matters, not only the extreme y. Sampling is O(1) in atom
 * count, which is why this can run on every fit.
 *
 * NOT a fill target. It only ever pulls the fit back, never pushes it in.
 */
function measureSpinSweep(viewer: GLViewer, spec: FrameSpec): number {
  const collected = collectFramed(viewer, spec);
  if (!collected) return 0;
  const { atoms, centre } = collected;

  let radius = 0;
  let yTop = -Infinity;
  let yBottom = Infinity;
  for (const { p, r } of atoms) {
    radius = Math.max(radius, Math.hypot(p.x - centre.x, p.z - centre.z) + r);
    yTop = Math.max(yTop, p.y + r);
    yBottom = Math.min(yBottom, p.y - r);
  }
  if (!Number.isFinite(yTop) || !Number.isFinite(yBottom)) return 0;

  const n = SWEEP_RING_SAMPLES;
  // Circumscribe rather than inscribe, so the polygon cannot under-report.
  const sampled = radius / Math.cos(Math.PI / n);
  const heights = [yBottom, (yTop + yBottom) / 2, yTop];
  const rim: Point3[] = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n;
    const dx = sampled * Math.cos(theta);
    const dz = sampled * Math.sin(theta);
    for (const y of heights) {
      rim.push({ x: centre.x + dx, y, z: centre.z + dz });
    }
  }

  const projected = projectedPoints(viewer, rim);
  if (!projected) return 0;
  return overflowFraction(projected, SWEEP_SAFE_FILL);
}

/**
 * Signed extent of the ATOM silhouette — every atom, hidden ones included (see
 * collectFramed) — and of the viewport, both in CSS pixels, measured through
 * 3Dmol's own projection. Returns null when the viewer is not in a measurable
 * state.
 *
 * Each atom contributes FOUR probes — its centre offset by its own
 * radius along +/-screenX and +/-screenY — so the sphere edge is projected by
 * 3Dmol rather than approximated with one shared radius and one shared scale.
 * That makes the estimate correct per atom AND correct under perspective (an
 * atom nearer the camera projects its own radius larger, and the probe follows
 * it), which is what the single `pad` term got wrong.
 *
 * Force arrows are NOT probed. They used to be, and that is what made the
 * DEFAULT result view unreadable: FORCE_ARROW_SCALE puts a tip tens of
 * Angstroms out on an unrelaxed single-point, the solver dutifully fitted the
 * tips, and the molecule was measured at 79.5 x 83 px in a 664 x 520 box —
 * 12% of the width, a 4.03x shrink versus the same structure with the arrows
 * hidden. The arrows are a legend-backed overlay; the structure is the subject.
 * They get a ceiling of their own instead — see measureArrowCeiling.
 */
function measureProjectedExtent(
  viewer: GLViewer,
  spec: FrameSpec
): ProjectedExtent | null {
  const collected = collectFramed(viewer, spec);
  if (!collected) return null;
  const { atoms, centre } = collected;

  // Probe the projection at the centroid — a point that is always inside the
  // molecule, so pxPerAngstrom is measured where the structure actually is.
  const basis = probeProjection(viewer, centre);
  if (!basis) return null;

  const { screenX: u, screenY: v } = basis;
  const probes: Point3[] = [];
  for (const { p, r } of atoms) {
    probes.push(
      { x: p.x + r * u.x, y: p.y + r * u.y, z: p.z + r * u.z },
      { x: p.x - r * u.x, y: p.y - r * u.y, z: p.z - r * u.z },
      { x: p.x + r * v.x, y: p.y + r * v.y, z: p.z + r * v.z },
      { x: p.x - r * v.x, y: p.y - r * v.y, z: p.z - r * v.z }
    );
  }

  const projected = projectedPoints(viewer, probes);
  if (!projected) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const o of projected.offsets) {
    minX = Math.min(minX, o.x);
    maxX = Math.max(maxX, o.x);
    minY = Math.min(minY, o.y);
    maxY = Math.max(maxY, o.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    minX: minX - OUTLINE_PAD_PX,
    maxX: maxX + OUTLINE_PAD_PX,
    minY: minY - OUTLINE_PAD_PX,
    maxY: maxY + OUTLINE_PAD_PX,
    viewHalfWidth: projected.viewHalfWidth,
    viewHalfHeight: projected.viewHalfHeight,
    pxPerAngstrom: basis.pxPerAngstrom,
  };
}

/**
 * The longest arrow scale, in Angstroms per eV/A, that keeps every force-arrow
 * TIP inside ARROW_TIP_SAFE_FILL of the canvas at the CURRENT fit. Returns null
 * when nothing constrains it.
 *
 * Measured, not derived, because it cannot be derived: see
 * MAX_FORCE_ARROW_FRACTION. Each atom contributes two projected points, its
 * centre and its tip at `probeScale`, and the answer is the largest k for which
 * `centre + k * (tip - centre)` stays inside the safe box on both axes — one
 * linear inequality per atom per axis. Exact under an orthographic camera and
 * close under 3Dmol's default 20-degree perspective, which is what the 2% margin
 * in ARROW_TIP_SAFE_FILL is there to absorb.
 *
 * Atoms whose CENTRE is already outside the safe box do not constrain anything:
 * that is a framing failure (a fit that hit MAX_TOTAL_FRAMING_ZOOM, say), and
 * answering it by deleting the arrows would hide it rather than fix it.
 *
 * The arrows of HIDDEN atoms constrain it too, although they are not drawn. That
 * keeps the scale, like the fit, independent of "Hide C–H bonds": hiding can only
 * remove arrows, so measuring the drawn subset alone would let the arrows that
 * remain GROW on the toggle — a control that rescales what it did not touch.
 */
function measureArrowCeiling(
  viewer: GLViewer,
  result: CalculationResult,
  probeScale: number
): number | null {
  const forces = result.forces;
  const positions = result.positions;
  if (!forces || !positions || !(probeScale > 0)) return null;

  const points: Point3[] = [];
  for (let i = 0; i < forces.length; i++) {
    const p = positions[i];
    const f = forces[i];
    if (!p || !f) continue;
    if (!Math.hypot(f[0], f[1], f[2])) continue;
    points.push(
      { x: p[0], y: p[1], z: p[2] },
      {
        x: p[0] + f[0] * probeScale,
        y: p[1] + f[1] * probeScale,
        z: p[2] + f[2] * probeScale,
      }
    );
  }
  if (points.length === 0) return null;

  const projected = projectedPoints(viewer, points);
  if (!projected) return null;

  const limitX = projected.viewHalfWidth * ARROW_TIP_SAFE_FILL - OUTLINE_PAD_PX;
  const limitY = projected.viewHalfHeight * ARROW_TIP_SAFE_FILL - OUTLINE_PAD_PX;
  if (limitX <= 0 || limitY <= 0) return null;

  /** Largest k >= 0 with |a + k*d| <= limit, or Infinity when unconstrained. */
  const axisLimit = (a: number, d: number, limit: number): number => {
    if (Math.abs(a) >= limit) return Infinity;
    if (d === 0) return Infinity;
    return (limit - Math.sign(d) * a) / Math.abs(d);
  };

  let k = Infinity;
  for (let i = 0; i + 1 < projected.offsets.length; i += 2) {
    const centre = projected.offsets[i];
    const tip = projected.offsets[i + 1];
    k = Math.min(
      k,
      axisLimit(centre.x, tip.x - centre.x, limitX),
      axisLimit(centre.y, tip.y - centre.y, limitY)
    );
  }
  if (!Number.isFinite(k)) return null;
  return Math.max(0, k) * probeScale;
}

/**
 * Offset the whole scene by (x, y) MODEL Angstroms without moving 3Dmol's
 * centre of rotation.
 *
 * 3Dmol's scene is `scene -> rotationGroup -> modelGroup`. The tumble
 * quaternion lives on rotationGroup and the model's centring offset lives on
 * modelGroup.position, so a point p is drawn at q * (p + modelPos) +
 * rotationPos: the quaternion is applied BEFORE rotationPos and AFTER
 * modelPos. Moving modelGroup (what translateScene() does, and what the old
 * "known limit" note assumed was the only option) moves the model away from
 * the point the quaternion turns about, which is why 3Dmol's own docs for
 * translateScene say `viewer.rotate(90,'z'); // will no longer be around model
 * center`. Moving rotationGroup cannot do that: it is a rigid post-rotation
 * shift of the finished picture, so the molecule still turns about its own
 * centre and only the framing moves.
 *
 * rotationGroup.position.x/y is reachable through the public API only as the
 * optional 9th and 10th elements of setView() (GLViewer.setView reads arg[8]
 * and arg[9]); getView() returns eight, so the current value cannot be read
 * back. frameView therefore always rewrites it from zero and never accumulates
 * across calls. 3Dmol's own mouse handling never touches these two fields —
 * middle-drag pan writes modelGroup.position instead — so this channel is not
 * shared with the user's gestures.
 */
function setFramingPan(viewer: GLViewer, x: number, y: number): void {
  const view = viewer.getView();
  if (!Array.isArray(view) || view.length < 8) return;
  viewer.setView([...view.slice(0, 8), x, y]);
}

/**
 * Put the model back at its default orientation. zoomTo() and zoom() never
 * touch the rotation quaternion, so a fit alone leaves the molecule wherever
 * the user tumbled it to — measured: atom 0 at (786.9,383.6), drag to
 * (958.4,475.2), "Reset view" -> (956.3,472.9), i.e. no reset at all. The
 * current zoom is preserved here because frameView() re-solves it immediately
 * afterwards; passing 0 would render one frame at a nonsense zoom first.
 */
function resetOrientation(viewer: GLViewer): void {
  const view = viewer.getView();
  if (!Array.isArray(view) || view.length < 8) return;
  viewer.setView([view[0], view[1], view[2], view[3], 0, 0, 0, 1, 0, 0]);
}

/**
 * Fit the ATOMS to TARGET_FILL of the canvas, centred on their projected
 * bounding box. zoomTo() first (it centres the model in model space and sets
 * the slab), then measure the projected silhouette, re-centre it and correct
 * the zoom. Measuring after each correction absorbs perspective
 * non-linearity and representation changes, so the same code frames a 9-atom
 * molecule and a 300-atom slab without clipping either. Used on load, on
 * representation change, on resize and on "reset view", so framing never
 * differs between them.
 *
 * WHY RE-CENTRE, AND WHY IT IS SAFE: see the TARGET_FILL note and
 * setFramingPan. zoomTo() centres the atoms' CENTROID, which is not the centre
 * of the projected silhouette at an arbitrary rotation. Fitting the
 * centroid-symmetric envelope (the old behaviour) is the only way to guarantee
 * no crop WITHOUT re-centring, and it costs exactly the asymmetry in fill — up
 * to 27% of the target, measured. Re-centring first makes the symmetric
 * envelope equal to the true extent, so no-crop and fill-the-frame stop being
 * in tension.
 *
 * Pan and zoom do not fight each other: zoom() moves rotationGroup along the
 * camera axis, which scales the pan offset and the silhouette by the same
 * factor, so a pan solved before a zoom is still correct after it. That is why
 * two passes normally converge.
 *
 * The final pass is two no-crop CEILINGS rather than a fit, and neither of them
 * can ever zoom IN:
 *   1. the SYMMETRIC atom envelope (max of |min| and |max| per axis), so
 *      "nothing is ever clipped at this orientation" stays a checked property of
 *      the final state even if the pan was clamped or did not converge;
 *   2. while auto-rotate is on, the SPIN SWEEP (measureSpinSweep), so "nothing
 *      can clip at any rotation angle" is a checked property too. It is a ceiling
 *      and not a second fit, which is what lets the spinning and still framings
 *      come out identical whenever it does not bind — see SWEEP_SAFE_FILL.
 * Both are folded into one zoom-out so the two cannot fight.
 *
 * WHAT THE GUARDS DO NOT COVER, stated rather than implied:
 *   - the fit is solved for the orientation it is called at, and nothing
 *     re-frames while the USER drags, so dragging by hand can still push part of
 *     the structure out of frame. "Reset view" is the way back, and it resets the
 *     orientation too;
 *   - FORCE ARROWS are bounded per-orientation (measureArrowCeiling), not per
 *     sweep. Folding the tips into the sweep would make `showForces` change the
 *     molecule's size, which is a defect this file already fixed. So while
 *     spinning, an arrow tip can pass outside the frame at some angles. The
 *     arrows are the overlay; the structure is the subject.
 *
 * Returns the metrics of the final state, or null if it was never measurable.
 */
function frameView(viewer: GLViewer, spec: FrameSpec): FrameMetrics | null {
  viewer.zoomTo();
  // Start from no pan: setFramingPan cannot read the current offset back, so
  // frameView owns it outright rather than accumulating across calls.
  setFramingPan(viewer, 0, 0);

  let panX = 0;
  let panY = 0;
  let applied = 1;

  // Convergence bookkeeping for the re-centring, so a pan that makes things
  // WORSE cannot oscillate. The offset is compared in Angstroms, not pixels:
  // pixels scale with the zoom applied later in the same pass, so a pixel
  // comparison across passes would read a successful correction as a
  // regression. If a step fails to reduce it, the best pan seen is restored and
  // panning stops for the rest of the solve — degrading to the old
  // centre-symmetric behaviour rather than flinging the molecule about.
  let bestOffsetAngstrom = Infinity;
  let bestPanX = 0;
  let bestPanY = 0;
  let panAllowed = true;

  for (let pass = 0; pass < FRAMING_PASSES; pass++) {
    const extent = measureProjectedExtent(viewer, spec);
    if (!extent) break;

    const halfWidth = (extent.maxX - extent.minX) / 2;
    const halfHeight = (extent.maxY - extent.minY) / 2;
    if (halfWidth <= 0 || halfHeight <= 0) break;

    // ── Re-centre: bring the projected bbox centre to the view centre ──
    let panned = false;
    if (panAllowed && extent.pxPerAngstrom > 0) {
      const offX = (extent.minX + extent.maxX) / 2;
      const offY = (extent.minY + extent.maxY) / 2;
      const offsetPx = Math.hypot(offX, offY);
      const offsetAngstrom = offsetPx / extent.pxPerAngstrom;

      if (offsetAngstrom < bestOffsetAngstrom) {
        bestOffsetAngstrom = offsetAngstrom;
        bestPanX = panX;
        bestPanY = panY;
        if (offsetPx > FRAMING_PAN_TOLERANCE_PX) {
          // Screen +y is down, world +y is up, hence the sign flip. The limit
          // is one viewport half-size expressed in Angstroms: a legitimate
          // bbox-centre offset can never exceed that, so anything larger is a
          // bad measurement rather than a lopsided molecule.
          const limit =
            Math.max(extent.viewHalfWidth, extent.viewHalfHeight) /
            extent.pxPerAngstrom;
          const nextX = panX - offX / extent.pxPerAngstrom;
          const nextY = panY + offY / extent.pxPerAngstrom;
          panX = Math.min(limit, Math.max(-limit, nextX));
          panY = Math.min(limit, Math.max(-limit, nextY));
          setFramingPan(viewer, panX, panY);
          panned = true;
        }
      } else {
        panAllowed = false;
        if (panX !== bestPanX || panY !== bestPanY) {
          panX = bestPanX;
          panY = bestPanY;
          setFramingPan(viewer, panX, panY);
          panned = true;
        }
      }
    }

    // ── Fit: the binding axis lands on TARGET_FILL, the other one below it ──
    const wanted = Math.min(
      (extent.viewHalfWidth * TARGET_FILL) / halfWidth,
      (extent.viewHalfHeight * TARGET_FILL) / halfHeight
    );
    if (!Number.isFinite(wanted) || wanted <= 0) break;

    // Clamp the cumulative zoom, not just this step, so repeated passes can
    // never compound into a runaway.
    const step = Math.min(
      Math.max(wanted, MIN_TOTAL_FRAMING_ZOOM / applied),
      MAX_TOTAL_FRAMING_ZOOM / applied
    );
    const zoomed = Math.abs(step - 1) >= FRAMING_TOLERANCE;
    if (zoomed) {
      viewer.zoom(step);
      applied *= step;
    }
    if (!zoomed && !panned) break;
  }

  // ── Ceilings: this orientation must not clip, and neither must any rotation
  //    reachable from it. Measured, folded into ONE zoom-out, never zoom-in.
  let extent = measureProjectedExtent(viewer, spec);
  let worst = 1;
  if (extent) {
    const overflow = Math.max(
      Math.max(-extent.minX, extent.maxX) / extent.viewHalfWidth,
      Math.max(-extent.minY, extent.maxY) / extent.viewHalfHeight
    );
    if (Number.isFinite(overflow)) worst = Math.max(worst, overflow);
  }
  if (spec.spinning) {
    const sweep = measureSpinSweep(viewer, spec);
    if (Number.isFinite(sweep)) worst = Math.max(worst, sweep);
  }
  if (worst > 1) {
    viewer.zoom(1 / worst);
    extent = measureProjectedExtent(viewer, spec);
  }

  viewer.render();

  if (!extent) return null;
  return {
    pxPerAngstrom: extent.pxPerAngstrom,
    viewHalfWidth: extent.viewHalfWidth,
    viewHalfHeight: extent.viewHalfHeight,
  };
}

/**
 * Fit, then measure everything the component needs to describe what it drew.
 *
 * One function for all three entry points (load, the re-frame effect, resize)
 * so that the framing and the arrow ceiling can never be solved from different
 * states of the viewer.
 */
function frameAndMeasure(
  viewer: GLViewer,
  result: CalculationResult,
  spec: FrameSpec,
  nominalArrowScale: number
): { metrics: FrameMetrics | null; arrowCeiling: number | null } {
  const metrics = frameView(viewer, spec);
  const arrowCeiling = measureArrowCeiling(viewer, result, nominalArrowScale);
  return { metrics, arrowCeiling };
}

/**
 * Fire `onChange` whenever window.devicePixelRatio changes.
 *
 * 3Dmol recomputes the canvas backing store inside Renderer.setSize(), which
 * only runs from viewer.resize() — and 3Dmol only calls resize() when the CSS
 * box changes (its own ResizeObserver / window resize). Browser zoom and moving
 * the window between displays of different density change devicePixelRatio
 * WITHOUT changing the CSS box, so without this watcher the canvas keeps a
 * stale backing store and the render is visibly soft until an unrelated
 * relayout happens. Returns a disposer.
 */
function watchPixelRatio(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  let query: MediaQueryList | null = null;
  let disposed = false;

  function arm() {
    if (disposed) return;
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    if (typeof query.addEventListener !== "function") {
      query = null;
      return;
    }
    query.addEventListener("change", handle, { once: true });
  }

  function handle() {
    if (disposed) return;
    onChange();
    // The old query no longer matches; re-arm against the new ratio.
    arm();
  }

  arm();

  return () => {
    disposed = true;
    query?.removeEventListener("change", handle);
    query = null;
  };
}

/**
 * True when the element has a non-zero CSS box.
 *
 * 3Dmol sizes its framebuffer attachments from container.offsetWidth/Height at
 * createViewer() time and again on every resize(). A zero-size container
 * produces a zero-size attachment and the driver logs
 * `GL_INVALID_FRAMEBUFFER_OPERATION ... Attachment has zero size` on every
 * draw — 39 of them per Fast Refresh remount, because the replacement tree
 * mounts before layout. Every entry point that can reach setSize() is gated
 * on this.
 */
function hasSize(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
}

// ---------------------------------------------------------------------------
// Helpers — structure data
// ---------------------------------------------------------------------------

/**
 * The structure's own size in ANGSTROMS: twice the largest centroid-to-atom
 * distance. Only used to set the force-arrow scale, so a rotation-invariant
 * scalar is what is wanted here — not a projected extent.
 */
function structureSpan(result: CalculationResult): number {
  const positions = result.positions;
  if (!positions || positions.length === 0) return MIN_STRUCTURE_SPAN;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of positions) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= positions.length;
  cy /= positions.length;
  cz /= positions.length;
  let far = 0;
  for (const p of positions) {
    far = Math.max(far, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  }
  return Math.max(MIN_STRUCTURE_SPAN, 2 * far);
}

/**
 * Angstroms drawn per eV/A of force for THIS structure, before the screen-space
 * ceiling: an arrow for ARROW_REFERENCE_FORCE is MAX_FORCE_ARROW_FRACTION of the
 * structure's span, capped at FORCE_ARROW_SCALE.
 *
 * Reads the GEOMETRY only, never the forces — that is the D9 fix, see
 * ARROW_REFERENCE_FORCE. So every result for one structure starts from the same
 * scale, whichever model produced it and however relaxed it is: a relaxed
 * geometry has near-zero forces and looks it, on the same ruler.
 */
function referenceArrowScale(result: CalculationResult): number {
  const cap =
    (MAX_FORCE_ARROW_FRACTION * structureSpan(result)) / ARROW_REFERENCE_FORCE;
  return Math.min(FORCE_ARROW_SCALE, cap);
}

/**
 * Round `value` DOWN to the largest entry of a 1-2-5-style ladder, so a computed
 * quantity can be printed as a chosen one. Never rounds up: every ladder here
 * expresses a ceiling, and rounding a ceiling up would breach it.
 */
function roundDownToRung(value: number, rungs: readonly number[]): number {
  if (!(value > 0) || !Number.isFinite(value)) return 0;
  const decade = Math.pow(10, Math.floor(Math.log10(value)));
  let best = 0;
  for (const step of [decade / 10, decade, decade * 10]) {
    for (const rung of rungs) {
      const candidate = rung * step;
      if (candidate <= value && candidate > best) best = candidate;
    }
  }
  return best > 0 ? best : value;
}

/**
 * The Angstroms-per-eV/A the arrows are actually drawn at: the nominal scale,
 * cut to the measured screen-space ceiling if there is one, then rounded down to
 * a ladder rung — see ARROW_SCALE_RUNGS for why it is quantised at all.
 */
function effectiveArrowScale(
  nominal: number,
  ceiling: number | null
): number {
  const allowed =
    ceiling !== null && Number.isFinite(ceiling)
      ? Math.min(nominal, ceiling)
      : nominal;
  return roundDownToRung(allowed, ARROW_SCALE_RUNGS);
}

/**
 * The legend's length-reference tick: a round force, and the TRUE on-screen
 * length of an arrow of that force in CSS pixels.
 *
 * This is what makes two results of the same molecule comparable when their arrow
 * scales differ, which cannot be prevented (see ARROW_SCALE_RUNGS): the printed
 * number can be read, but the drawn LENGTH can be compared without reading
 * anything. The rule is "the largest decade that still fits the band", so the
 * label holds still while the length tracks the scale — see TICK_FORCE_DECADES.
 */
function arrowReferenceTick(
  arrowScale: number,
  pxPerAngstrom: number
): { force: number; px: number } | null {
  if (!(arrowScale > 0) || !(pxPerAngstrom > 0)) return null;
  const pxFor = (force: number) => force * arrowScale * pxPerAngstrom;

  let chosen: number | null = null;
  for (const force of TICK_FORCE_DECADES) {
    if (pxFor(force) <= TICK_MAX_PX) chosen = force;
  }
  // Everything is too long even at the smallest decade, or the chosen one is too
  // short to see: step to the neighbour rather than clipping the tick, which
  // would make its length a lie.
  if (chosen === null) chosen = TICK_FORCE_DECADES[0];
  while (pxFor(chosen) < TICK_MIN_PX) {
    const next = TICK_FORCE_DECADES.find((f) => f > (chosen as number));
    if (next === undefined) break;
    chosen = next;
  }

  const px = pxFor(chosen);
  if (!Number.isFinite(px) || px <= 0) return null;
  return { force: chosen, px };
}

/** An arrow scale as the legend prints it: "1.0", "0.50", "0.020". */
function formatArrowScale(scale: number): string {
  if (scale >= 1) return scale.toFixed(1);
  return scale.toPrecision(2);
}

function buildXYZ(result: CalculationResult): string {
  if (!result.symbols || !result.positions) return "";
  const atomCount = result.symbols.length;
  let xyzData = `${atomCount}\n`;
  xyzData += `Energy: ${result.energy ?? "N/A"} eV\n`;
  result.symbols.forEach((symbol, i) => {
    const pos = result.positions![i];
    xyzData += `${symbol} ${pos[0].toFixed(6)} ${pos[1].toFixed(6)} ${pos[2].toFixed(6)}\n`;
  });
  return xyzData;
}

/** Snapshot the loaded model, including the bonds 3Dmol perceived. */
function collectAtoms(viewer: GLViewer): AtomRecord[] {
  const out: AtomRecord[] = [];
  for (const a of viewer.selectedAtoms({}) as AtomSpec[]) {
    if (typeof a.index !== "number") continue;
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      !Number.isFinite(a.z)
    ) {
      continue;
    }
    out.push({
      index: a.index,
      elem: a.elem ?? "X",
      x: a.x as number,
      y: a.y as number,
      z: a.z as number,
      bonds: Array.isArray(a.bonds) ? [...a.bonds] : [],
    });
  }
  return out;
}

/**
 * Indices of hydrogens whose every perceived bond is to carbon.
 *
 * The bar's gear item is labelled "Hide C–H bonds"; what that conventionally
 * means in a structure viewer is hiding the nonpolar hydrogens themselves, not
 * leaving them floating unbonded. Hiding the atom hides the bond too:
 * GLModel.drawBondSticks skips a bond whose partner has no stick style
 * (`if (!style2.stick || style2.stick.hidden) continue`), so styling these
 * atoms to {} removes both ends. Polar hydrogens (O–H, N–H, S–H) and isolated
 * hydrogens are kept — they are the chemically interesting ones.
 */
function nonpolarHydrogens(atoms: AtomRecord[]): number[] {
  const byIndex = new Map<number, AtomRecord>();
  for (const a of atoms) byIndex.set(a.index, a);
  const out: number[] = [];
  for (const a of atoms) {
    if (a.elem !== "H") continue;
    if (a.bonds.length === 0) continue;
    if (a.bonds.every((b) => byIndex.get(b)?.elem === "C")) out.push(a.index);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers — geometry measurement (Angstroms and degrees)
// ---------------------------------------------------------------------------

function sub(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function norm(a: Point3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function scale(a: Point3, k: number): Point3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

/** Straight-line separation in ANGSTROMS. Says nothing about bonding. */
function distanceAngstrom(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Angle at vertex `b`, in DEGREES, in [0, 180]. */
function angleDegrees(a: Point3, b: Point3, c: Point3): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const nu = norm(u);
  const nv = norm(v);
  if (nu === 0 || nv === 0) return NaN;
  const cosine = Math.min(1, Math.max(-1, dot(u, v) / (nu * nv)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * Signed torsion a-b-c-d about the b-c axis, in DEGREES, in (-180, 180].
 * Standard IUPAC sign convention; swapping the order of the four atoms flips
 * the sign, which is exactly why selection ORDER is preserved.
 */
function dihedralDegrees(a: Point3, b: Point3, c: Point3, d: Point3): number {
  const b0 = sub(a, b);
  const b1raw = sub(c, b);
  const b2 = sub(d, c);
  const n1 = norm(b1raw);
  if (n1 === 0) return NaN;
  const b1 = scale(b1raw, 1 / n1);
  const v = sub(b0, scale(b1, dot(b0, b1)));
  const w = sub(b2, scale(b1, dot(b2, b1)));
  if (norm(v) === 0 || norm(w) === 0) return NaN;
  const x = dot(v, w);
  const y = dot(cross(b1, v), w);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** "C3" — element plus 1-based position in the XYZ, which is what users see. */
function atomLabel(a: AtomRecord): string {
  return `${a.elem}${a.index + 1}`;
}

interface Measurement {
  /** e.g. "Bond length", "Distance", "Angle", "Dihedral". */
  kind: string;
  /** Formatted value INCLUDING its unit. Never a bare number. */
  value: string;
  /** e.g. "C3 – C2 – O1". */
  path: string;
  /** Present when the readout needs a caveat (unbonded pair, too many atoms). */
  note?: string;
}

/**
 * Turn an ordered selection into a measurement.
 *
 * Deliberately conservative about chemistry: two atoms are reported as a
 * "Bond length" only when 3Dmol's own distance-based perception put a bond
 * between them, and as a plain "Distance" otherwise. MACE does not give us
 * bond orders and this component must not invent them.
 */
function describeSelection(
  selected: AtomRecord[]
): Measurement | null {
  if (selected.length < 2) return null;
  const path = selected.map(atomLabel).join(" – ");

  if (selected.length === 2) {
    const [a, b] = selected;
    const bonded = a.bonds.includes(b.index) || b.bonds.includes(a.index);
    return {
      kind: bonded ? "Bond length" : "Distance",
      value: `${distanceAngstrom(a, b).toFixed(3)} Å`,
      path,
      note: bonded
        ? undefined
        : "3Dmol perceived no bond here — geometric separation only",
    };
  }

  if (selected.length === 3) {
    const [a, b, c] = selected;
    return {
      kind: "Angle",
      value: `${angleDegrees(a, b, c).toFixed(2)}°`,
      path,
      note: `vertex ${atomLabel(b)}`,
    };
  }

  if (selected.length === 4) {
    const [a, b, c, d] = selected;
    return {
      kind: "Dihedral",
      value: `${dihedralDegrees(a, b, c, d).toFixed(2)}°`,
      path,
      note: `about ${atomLabel(b)}–${atomLabel(c)}`,
    };
  }

  return {
    kind: `${selected.length} atoms selected`,
    value: "—",
    path,
    note: "select 2, 3 or 4 atoms to measure",
  };
}

// ---------------------------------------------------------------------------
// Helpers — picking
// ---------------------------------------------------------------------------

/** Page coordinates of a mouse or touch event, or null if it has none. */
function eventPagePoint(
  event: MouseEvent | TouchEvent | undefined
): { x: number; y: number } | null {
  if (!event) return null;
  const touchEvent = event as TouchEvent;
  const touch =
    touchEvent.changedTouches?.[0] ?? touchEvent.touches?.[0] ?? undefined;
  const source = touch ?? (event as MouseEvent);
  const cx = (source as { clientX?: number }).clientX;
  const cy = (source as { clientY?: number }).clientY;
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return { x: cx + window.scrollX, y: cy + window.scrollY };
}

/**
 * Decide whether a click on `atom` landed on the atom itself or on one of its
 * bonds, and return the atoms to select.
 *
 * 3Dmol reports the nearer ATOM for a click anywhere on that atom's half of a
 * stick and does not say which geometry was hit, so the distinction is
 * re-derived here in screen space: inside the projected sphere -> the atom;
 * otherwise, whichever bonded neighbour's projected segment the click sits on
 * -> both atoms of that bond, in [clicked, neighbour] order.
 *
 * Falls back to the single atom whenever the geometry cannot be resolved.
 */
function resolvePick(
  viewer: GLViewer,
  atom: AtomRecord,
  byIndex: Map<number, AtomRecord>,
  hidden: ReadonlySet<number>,
  rep: Representation,
  event: MouseEvent | TouchEvent | undefined
): number[] {
  const click = eventPagePoint(event);
  if (!click || rep === "spacefill") return [atom.index];

  const basis = probeProjection(viewer, atom);
  if (!basis) return [atom.index];

  const neighbours = atom.bonds
    .map((b) => byIndex.get(b))
    .filter((n): n is AtomRecord => !!n && !hidden.has(n.index));

  const points = [atom, ...neighbours].map((a) => ({
    x: a.x,
    y: a.y,
    z: a.z,
  }));
  const screen = viewer.modelToScreen(points) as Array<{
    x: number;
    y: number;
  }>;
  if (!Array.isArray(screen) || screen.length !== points.length) {
    return [atom.index];
  }

  const atomScreen = screen[0];
  const atomRadiusPx = drawnRadius(atom.elem, rep) * basis.pxPerAngstrom;
  const distToCentre = Math.hypot(
    click.x - atomScreen.x,
    click.y - atomScreen.y
  );
  if (distToCentre <= atomRadiusPx) return [atom.index];

  const stickPx =
    (rep === "stick" ? LICORICE_RADIUS : BOND_RADIUS) * basis.pxPerAngstrom +
    BOND_PICK_SLOP_PX;

  let best: { index: number; d: number } | null = null;
  for (let i = 0; i < neighbours.length; i++) {
    const nScreen = screen[i + 1];
    const d = pointToSegmentDistance(click, atomScreen, nScreen);
    if (d <= stickPx && (!best || d < best.d)) {
      best = { index: neighbours[i].index, d };
    }
  }

  return best ? [atom.index, best.index] : [atom.index];
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * Toggle semantics for a pick. A pick is one atom (atom click) or two (bond
 * click). Clicking something already selected removes it; otherwise it is
 * appended, so ORDER follows the clicks — which is what makes the angle vertex
 * and the dihedral sign predictable.
 */
function togglePick(current: number[], picked: number[]): number[] {
  if (picked.length === 0) return current;
  const allPresent = picked.every((i) => current.includes(i));
  if (allPresent) return current.filter((i) => !picked.includes(i));
  const next = [...current];
  for (const i of picked) if (!next.includes(i)) next.push(i);
  return next;
}

// ---------------------------------------------------------------------------
// Helpers — rendering the current view
// ---------------------------------------------------------------------------

/**
 * Apply representation, C–H hiding, force arrows and the selection highlight.
 *
 * Everything drawn as a SHAPE (the arrows) is torn down and rebuilt here,
 * because 3Dmol has no per-shape identity we can diff against. Order matters:
 * the base style, then the green selected style, then the hidden set on top of
 * both — setStyle replaces rather than merges when `add` is falsy, so the last
 * write to an atom wins and a hidden atom stays hidden even if it is somehow
 * still in the selection.
 */
function applyView(
  viewer: GLViewer,
  result: CalculationResult,
  atoms: AtomRecord[],
  opts: RenderOptions,
  hidden: readonly number[],
  arrowScale: number
): void {
  viewer.removeAllShapes();
  viewer.setStyle({}, repStyle(opts.representation));
  const byIndex = new Map(atoms.map((a) => [a.index, a]));
  for (const index of opts.selection) {
    viewer.setStyle(
      { index },
      selectedStyle(byIndex.get(index)?.elem, opts.representation)
    );
  }
  const hiddenSet = opts.hideNonpolarH ? new Set(hidden) : new Set<number>();
  if (hiddenSet.size > 0) {
    viewer.setStyle({ index: [...hiddenSet] }, {});
  }
  viewer.render();

  if (result.forces && result.positions && opts.showForces && arrowScale > 0) {
    result.forces.forEach((force, i) => {
      const pos = result.positions![i];
      if (!pos) return;
      // No arrow on an atom that is not drawn (D11). A green vector sprouting
      // from where a hidden hydrogen ISN'T is not a force reading, it is a line
      // from nowhere. Its force still bounds the arrow scale, though — see
      // measureArrowCeiling — so hiding cannot rescale the arrows that remain.
      if (hiddenSet.has(i)) return;
      viewer.addArrow({
        start: { x: pos[0], y: pos[1], z: pos[2] },
        end: {
          x: pos[0] + force[0] * arrowScale,
          y: pos[1] + force[1] * arrowScale,
          z: pos[2] + force[2] * arrowScale,
        },
        radius: FORCE_ARROW_RADIUS,
        color: "#228833", // Paul Tol green — matches "force vectors" legend
      });
    });
  }

  viewer.render();
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

/**
 * Hit-target class for every viewer control.
 *
 * 32x32 is below the 44x44 touch minimum in every published guideline (Apple
 * HIG, WCAG 2.5.5 AAA / 2.5.8 AA at 24), and all seven toolbar buttons measured
 * exactly 32x32 on a real 375x812 touch device. The size is switched on the
 * POINTER, not on the viewport width: an 820 px tablet is a coarse-pointer
 * device that a `max-sm:` breakpoint would have missed, and a 375 px desktop
 * window is not a touch device. Growing the box rather than padding it keeps
 * neighbouring hit areas from overlapping — with gap-2 (8 px) between buttons,
 * a padding-only expansion to 44 would have each button claiming 6 px of that
 * 8 px gap and overlapping its neighbour by 4 px.
 */
const HIT_SQUARE = "h-11 w-11";
const HIT_SQUARE_FINE = "h-8 w-8";

/**
 * Square icon button. Module scope, not a closure inside the component: a
 * component identity that changes every render remounts every button on every
 * keystroke, which drops focus and restarts CSS transitions.
 */
function ToolbarButton({
  onClick,
  title,
  active,
  children,
  disabled,
  pressed,
  expanded,
  hasPopup,
  coarse,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  /** Sets aria-pressed. Omit for buttons that are actions, not toggles. */
  pressed?: boolean;
  expanded?: boolean;
  hasPopup?: "menu";
  /** True when the device has no fine pointer — see HIT_SQUARE. */
  coarse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      className={`flex items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        coarse ? HIT_SQUARE : HIT_SQUARE_FINE
      } ${
        active
          ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-strong)]"
          : "border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] hover:border-[var(--color-accent-primary)]/60 hover:text-[var(--color-accent-strong)]"
      }`}
    >
      {children}
    </button>
  );
}

/** One row of the gear menu. */
function MenuItem({
  onClick,
  label,
  hint,
  checked,
  icon,
  disabled,
  coarse,
}: {
  onClick: () => void;
  label: string;
  hint?: string;
  /** Present => rendered as a checkable item with role="menuitemcheckbox". */
  checked?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** True when the device has no fine pointer — see HIT_SQUARE. */
  coarse?: boolean;
}) {
  const checkable = typeof checked === "boolean";
  return (
    <button
      type="button"
      role={checkable ? "menuitemcheckbox" : "menuitem"}
      aria-checked={checkable ? checked : undefined}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`flex w-full items-center gap-2 px-3 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-accent-primary)]/10 disabled:cursor-not-allowed disabled:opacity-40 ${
        coarse ? "min-h-[44px] py-3" : "py-2"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-accent-strong)]">
        {checkable ? checked ? <Check className="h-3.5 w-3.5" /> : null : icon}
      </span>
      <span className="flex-1 whitespace-nowrap font-mono">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MoleculeViewer3D({ result }: MoleculeViewer3DProps) {
  // Viewer engine: user can toggle between 3Dmol.js and WEAS
  const [engine, setEngine] = useState<ViewerEngine>("3dmol");

  // 3Dmol.js state
  const viewerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const viewerInstance = useRef<GLViewer | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pixelRatioWatcherRef = useRef<(() => void) | null>(null);
  /** Latest resize+reframe closure, so fullscreen changes can re-solve the fit. */
  const resizeRef = useRef<() => void>(() => {});

  const [representation, setRepresentation] =
    useState<Representation>("ball-and-stick");
  const [showForces, setShowForces] = useState(true);
  const [hideNonpolarH, setHideNonpolarH] = useState(false);
  const [selection, setSelection] = useState<number[]>([]);
  const [spin, setSpin] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Atom snapshot + derived sets. Populated once the model is parsed.
  const [atoms, setAtoms] = useState<AtomRecord[]>([]);
  const atomsRef = useRef<AtomRecord[]>([]);
  const hiddenRef = useRef<number[]>([]);

  /**
   * What the last completed fit measured. Written by every framing entry point;
   * read only by the legend (the arrow length ceiling and the reference tick).
   *
   * Neither of these is a framing input, which is what keeps this loop-free: the
   * framing effect writes them, the style effect reads them, and the framing
   * effect does not depend on either.
   */
  const [pxPerAngstrom, setPxPerAngstrom] = useState<number | null>(null);
  const [arrowCeiling, setArrowCeiling] = useState<number | null>(null);

  /**
   * The arrow scale the shapes currently on screen were built with.
   *
   * A ref, not state, because the arrows have to be rebuilt in the SAME tick as
   * the fit that measured their new ceiling. Passive effects run after paint, so
   * waiting for the state round-trip would paint exactly one frame with the old
   * arrow length at the new zoom — the clipped frame this whole fix is about, and
   * a frame a screenshot taken right after the toggle would catch.
   */
  const drawnArrowScaleRef = useRef<number | null>(null);

  // The viewer-init effect and the 3Dmol click/hover callbacks are registered
  // once, so they cannot close over state. They read this instead.
  const optionsRef = useRef<ViewOptions>({
    representation,
    showForces,
    hideNonpolarH,
    selection,
    spin,
  });

  // Hover info box, positioned relative to the viewer box.
  const [hover, setHover] = useState<{
    text: string;
    detail: string;
    x: number;
    y: number;
  } | null>(null);

  // Ctrl/Cmd-drag rectangular multiselect.
  const [modifierHeld, setModifierHeld] = useState(false);
  /**
   * Sticky box-select, for devices with no Ctrl/Cmd key. A touch device can
   * hold no modifier, so without this the footer was advertising a gesture the
   * hardware cannot perform. Armed from the gear menu, cleared by Escape or by
   * the menu item; on a mouse it is simply an alternative to holding Ctrl/Cmd.
   */
  const [marqueeArmed, setMarqueeArmed] = useState(false);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);

  /**
   * False when the device has NO fine pointer — i.e. touch-only. Drives both
   * the hit-target size and the footer copy, so there is one source of truth
   * for "can this user right-drag, middle-drag, hold Ctrl or press Esc".
   *
   * Starts true so the server-rendered markup and the first client render
   * agree; the effect corrects it on mount. `any-pointer` rather than
   * `pointer`, so a laptop with a touchscreen still counts as fine.
   */
  const [pointerFine, setPointerFine] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(any-pointer: fine)");
    const sync = () => setPointerFine(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);
  const coarse = !pointerFine;

  /**
   * Live width of the viewer box, in CSS px. Only used to size the WEAS
   * iframe: WeasViewer takes a NUMBER of pixels, so it cannot inherit the
   * `aspect-square` box the 3Dmol path uses and would otherwise render 420 px
   * tall inside a 291 px box on a phone and be clipped by overflow-hidden.
   */
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setBoxWidth(box.clientWidth);
    });
    observer.observe(box);
    setBoxWidth(box.clientWidth);
    return () => observer.disconnect();
  }, []);

  const xyzData = useMemo(() => buildXYZ(result), [result]);
  const hasForces = !!result.forces?.length;
  const is3Dmol = engine === "3dmol";

  /**
   * The Angstroms-per-eV/A the arrows WOULD be drawn at from the structure's
   * geometry alone, before the measured screen-space ceiling. Not from the
   * forces: see ARROW_REFERENCE_FORCE.
   */
  const nominalArrowScale = useMemo(() => referenceArrowScale(result), [result]);

  /**
   * The scale they are ACTUALLY drawn at, and the one the legend prints: the
   * nominal scale, cut to whatever keeps the tips on the canvas, rounded to a
   * ladder rung. This is a single source of truth on purpose — an arrow length
   * that encodes a quantity is unreadable if the number beside it is a different
   * number from the one that was drawn.
   */
  const arrowScale = useMemo(
    () => effectiveArrowScale(nominalArrowScale, arrowCeiling),
    [nominalArrowScale, arrowCeiling]
  );

  /**
   * The rung the geometry alone would give, with no screen-space ceiling. When the
   * drawn scale is below it the ceiling has cut the arrows, and that cut is the
   * one way the scale can still differ between two results for one structure —
   * so the legend names it rather than letting it pass silently.
   */
  const uncutArrowScale = useMemo(
    () => effectiveArrowScale(nominalArrowScale, null),
    [nominalArrowScale]
  );
  const arrowScaleCut = arrowScale < uncutArrowScale;

  /** Length reference for the legend — see arrowReferenceTick. */
  const arrowTick = useMemo(
    () => arrowReferenceTick(arrowScale, pxPerAngstrom ?? 0),
    [arrowScale, pxPerAngstrom]
  );

  /** Hydrogens the "Hide C–H bonds" item can hide, derived from the model. */
  const hiddenIndices = useMemo(() => nonpolarHydrogens(atoms), [atoms]);

  /** Empty unless hiding is on — this is what "currently not drawn" means. */
  const hiddenSet = useMemo(
    () => (hideNonpolarH ? new Set(hiddenIndices) : new Set<number>()),
    [hideNonpolarH, hiddenIndices]
  );

  // Mirror for the imperative paths (3Dmol click/hover callbacks and the
  // resize closure) that are registered once and cannot see React state.
  useEffect(() => {
    hiddenRef.current = hiddenIndices;
  }, [hiddenIndices]);

  const selectedAtoms = useMemo(() => {
    const byIndex = new Map(atoms.map((a) => [a.index, a]));
    return selection
      .map((i) => byIndex.get(i))
      .filter((a): a is AtomRecord => !!a);
  }, [atoms, selection]);

  const measurement = useMemo(
    () => describeSelection(selectedAtoms),
    [selectedAtoms]
  );

  // ── Keep the ref the 3Dmol callbacks read in sync ──
  // Declared FIRST so it runs before the effects below in the same commit.
  useEffect(() => {
    optionsRef.current = {
      representation,
      showForces,
      hideNonpolarH,
      selection,
      spin,
    };
  }, [representation, showForces, hideNonpolarH, selection, spin]);

  // ── 3Dmol.js: initialize viewer ──
  useEffect(() => {
    // Only run when 3Dmol engine is active
    if (engine !== "3dmol") return;
    const host = viewerRef.current;
    if (!host || !result.positions || !result.symbols) return;

    setLoading(true);

    // resize() -> Renderer.setSize() -> canvas.width = cssWidth * dpr.
    // This is the only place the backing-store resolution is recomputed, so it
    // is driven by BOTH the ResizeObserver (CSS box) and the DPR watcher.
    const resize = () => {
      const v = viewerInstance.current;
      // Size guard: a zero-size container makes 3Dmol allocate a zero-size
      // framebuffer attachment, which the driver rejects on every draw.
      if (!v || !hasSize(viewerRef.current)) return;
      v.resize();
      // Re-solve the fit. Without this a 1280 -> 375 change takes the fill from
      // 0.705 to 0.998 with the molecule clipped at both edges, because the fit
      // was solved for the old aspect ratio and zoom is not recomputed by
      // resize(). Measured; Reset view recovered it, which is what identified
      // this as a missing frameView() rather than a solver bug.
      const opts = optionsRef.current;
      // Re-solve the arrow ceiling too: it is a SCREEN-space bound, so a change
      // of canvas size changes it even though the structure has not moved.
      const nominal = referenceArrowScale(result);
      const solved = frameAndMeasure(
        v,
        result,
        { rep: opts.representation, spinning: opts.spin },
        nominal
      );
      setPxPerAngstrom(solved.metrics?.pxPerAngstrom ?? null);
      setArrowCeiling(solved.arrowCeiling);
      // Rebuild now, before paint — see drawnArrowScaleRef.
      const nextScale = effectiveArrowScale(nominal, solved.arrowCeiling);
      if (drawnArrowScaleRef.current !== nextScale) {
        applyView(v, result, atomsRef.current, opts, hiddenRef.current, nextScale);
        drawnArrowScaleRef.current = nextScale;
      }
      v.render();
    };
    resizeRef.current = resize;

    let cancelled = false;
    let sizeWatcher: ResizeObserver | null = null;

    const boot = ($3Dmol: typeof import("3dmol")) => {
      if (cancelled || !result.symbols || !result.positions) return;
      if (!hasSize(host)) return;

      host.innerHTML = "";
      cacheColourTables($3Dmol);

      const atomCount = result.symbols.length;
      const viewer = $3Dmol.createViewer(host, {
        // Transparent canvas. The bar renders its molecule straight onto the
        // page; ours was an opaque rectangle inside a card on a warm canvas —
        // three background values and a hard-edged box, which read as a pasted
        // screenshot rather than an object. backgroundColor is still supplied
        // because it is the colour PNG export composites onto (3Dmol itself
        // does NOT use it for export — pngURI() just reads the transparent
        // canvas, so the compositing happens in handleDownloadPng).
        backgroundColor: readCanvasBackground(host),
        backgroundAlpha: 0,
        // Retina. antialias defaults to true inside GLViewer today and upscale
        // defaults to antialias, but both are stated here so the >= 2x backing
        // store is a property of this component, not of a library default.
        antialias: true,
        upscale: true,
        // Dark contact outline around every atom and bond.
        outline: OUTLINE,
        // Soft contact shading. Skipped for large systems (extra depth pass).
        ambientOcclusion:
          atomCount <= AO_MAX_ATOMS ? AMBIENT_OCCLUSION : undefined,
        // 3Dmol's default is 500 ms, which reads as an unresponsive tooltip.
        hoverDuration: HOVER_DURATION_MS,
      });
      viewerInstance.current = viewer;

      // AO needs the WebGL2 framebuffer attachments; drop it otherwise.
      if (!rendersWithWebGL2(viewer)) {
        viewer.getRenderer()?.disableAmbientOcclusion();
      }

      viewer.addModel(xyzData, "xyz");
      viewer.enableFog(false);

      const records = collectAtoms(viewer);
      atomsRef.current = records;
      hiddenRef.current = nonpolarHydrogens(records);
      setAtoms(records);
      setSelection([]);

      const byIndex = new Map(records.map((a) => [a.index, a]));

      // ── Click: select an atom, or both atoms of a bond ──
      viewer.setClickable(
        {},
        true,
        (
          clicked: AtomSpec,
          _v: GLViewer,
          event: MouseEvent | TouchEvent | undefined
        ) => {
          if (typeof clicked.index !== "number") return;
          const atom = byIndex.get(clicked.index);
          if (!atom) return;
          const opts = optionsRef.current;
          const hiddenNow = opts.hideNonpolarH
            ? new Set(hiddenRef.current)
            : new Set<number>();
          if (hiddenNow.has(atom.index)) return;
          const picked = resolvePick(
            viewer,
            atom,
            byIndex,
            hiddenNow,
            opts.representation,
            event
          );
          setSelection((current) => togglePick(current, picked));
        }
      );

      // ── Hover: identity + coordinates + force magnitude, all with units ──
      viewer.setHoverable(
        {},
        true,
        (
          hovered: AtomSpec,
          _v: GLViewer,
          event: MouseEvent | TouchEvent | undefined
        ) => {
          if (typeof hovered.index !== "number") return;
          const atom = byIndex.get(hovered.index);
          const box = boxRef.current;
          if (!atom || !box) return;
          const point = eventPagePoint(event);
          if (!point) return;
          const rect = box.getBoundingClientRect();
          const force = result.forces?.[atom.index];
          const magnitude = force
            ? Math.hypot(force[0], force[1], force[2])
            : null;
          // Clamp so the info box cannot hang off either edge of the viewer.
          const localX = point.x - window.scrollX - rect.left;
          const localY = point.y - window.scrollY - rect.top;
          setHover({
            text: atomLabel(atom),
            detail:
              `${atom.x.toFixed(3)}, ${atom.y.toFixed(3)}, ${atom.z.toFixed(3)} Å` +
              (magnitude === null ? "" : ` · |F| ${magnitude.toFixed(3)} eV/Å`),
            x: Math.min(Math.max(localX, 90), Math.max(90, rect.width - 90)),
            y: Math.min(Math.max(localY, 40), rect.height),
          });
        },
        () => setHover(null)
      );

      // setSelection([]) above will not have reached optionsRef yet — the sync
      // effect runs on the next commit — and resize() below reads the ref, so the
      // cleared selection is written through here rather than patched at one
      // call site. Without this a reload could re-apply the previous result's
      // selection indices to a different molecule.
      optionsRef.current = { ...optionsRef.current, selection: [] };
      const opts = optionsRef.current;

      // First paint uses the nominal arrow scale; resize() immediately below
      // solves the fit, measures the ceiling and rebuilds the arrows if it binds.
      const bootScale = effectiveArrowScale(referenceArrowScale(result), null);
      applyView(viewer, result, records, opts, hiddenRef.current, bootScale);
      drawnArrowScaleRef.current = bootScale;

      resize();
      resizeObserverRef.current = new ResizeObserver(resize);
      resizeObserverRef.current.observe(host);
      pixelRatioWatcherRef.current = watchPixelRatio(resize);
      setLoading(false);
    };

    import("3dmol").then(($3Dmol) => {
      if (cancelled) return;
      if (hasSize(host)) {
        boot($3Dmol);
        return;
      }
      // Zero-size container — typically the Fast Refresh remount path, where
      // the replacement tree mounts before layout. Wait rather than creating a
      // viewer against a zero-size framebuffer.
      sizeWatcher = new ResizeObserver(() => {
        if (cancelled || !hasSize(host)) return;
        sizeWatcher?.disconnect();
        sizeWatcher = null;
        boot($3Dmol);
      });
      sizeWatcher.observe(host);
    });

    return () => {
      cancelled = true;
      sizeWatcher?.disconnect();
      sizeWatcher = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      pixelRatioWatcherRef.current?.();
      pixelRatioWatcherRef.current = null;
      // 3Dmol installs its OWN ResizeObserver and IntersectionObserver on the
      // container and never removes them. On unmount the container collapses
      // to 0x0, those observers fire, and resize() reallocates a zero-size
      // framebuffer on a viewer nobody is looking at. Reaching into the
      // private fields is deliberate; both accesses are optional.
      const dying = viewerInstance.current as unknown as {
        divwatcher?: { disconnect?: () => void };
        intwatcher?: { disconnect?: () => void };
      } | null;
      dying?.divwatcher?.disconnect?.();
      dying?.intwatcher?.disconnect?.();
      viewerInstance.current?.clear();
      viewerInstance.current = null;
      // `host`, not viewerRef.current: the ref may already point elsewhere by
      // the time cleanup runs.
      host.innerHTML = "";
      setHover(null);
    };
  }, [result, engine, xyzData]);

  // ── 3Dmol.js: re-apply style / arrows / selection highlight ──
  useEffect(() => {
    if (engine !== "3dmol") return;
    const v = viewerInstance.current;
    if (!v || atoms.length === 0) return;
    applyView(
      v,
      result,
      atoms,
      { representation, showForces, hideNonpolarH, selection },
      hiddenIndices,
      arrowScale
    );
    drawnArrowScaleRef.current = arrowScale;
  }, [
    engine,
    result,
    atoms,
    hiddenIndices,
    representation,
    showForces,
    hideNonpolarH,
    selection,
    arrowScale,
  ]);

  // ── 3Dmol.js: re-frame ──
  // Separate from the style effect and NOT keyed on `selection`: spacefill
  // spheres are ~4.5x the radius of ball-and-stick ones, so a fit made for one
  // representation crops in the other — but the view must not jump every time
  // someone clicks an atom.
  //
  // NOT keyed on `showForces` either, and that is the point of the fix: the fit
  // is solved from the atoms alone, so showing or hiding the arrows cannot
  // change the molecule's size at all. It used to re-frame here and the default
  // state (arrows on) came out 4.03x smaller than the same structure with them
  // off.
  //
  // Keyed on `spin`, but for a CEILING now, not for a different envelope. It used
  // to switch between a rotation-invariant sphere fitted to TARGET_FILL and the
  // tight per-orientation silhouette — two envelopes, one target, which cannot
  // agree, and which rescaled the molecule 27% the moment auto-rotate was
  // engaged. Now both states solve the same fit and the sweep only pulls it back
  // if it would actually clip, which for the default view it does not: 137 px/A
  // needed against 164 permitted. See SWEEP_SAFE_FILL.
  //
  // NOT keyed on `hideNonpolarH`: hidden atoms are framed as if drawn (see
  // TARGET_FILL), so hiding C–H is a restyle, not a re-frame. Keying it here is
  // what magnified the remaining atoms 1.41x on every toggle.
  //
  // NOT keyed on `arrowScale`: the ceiling is an OUTPUT of the fit, and feeding
  // it back in would be a loop.
  useEffect(() => {
    if (engine !== "3dmol") return;
    const v = viewerInstance.current;
    if (!v || atoms.length === 0) return;
    const solved = frameAndMeasure(
      v,
      result,
      { rep: representation, spinning: spin },
      nominalArrowScale
    );
    setPxPerAngstrom(solved.metrics?.pxPerAngstrom ?? null);
    setArrowCeiling(solved.arrowCeiling);

    // Rebuild the arrows NOW if the new fit shortened them, rather than on the
    // state round-trip a frame later — see drawnArrowScaleRef. optionsRef is read
    // instead of the state so that `showForces` and `selection` do not become
    // framing dependencies; the sync effect that fills it is declared first, so
    // it already holds this commit's values.
    const nextScale = effectiveArrowScale(nominalArrowScale, solved.arrowCeiling);
    if (drawnArrowScaleRef.current !== nextScale) {
      applyView(v, result, atoms, optionsRef.current, hiddenIndices, nextScale);
      drawnArrowScaleRef.current = nextScale;
    }
  }, [
    engine,
    result,
    atoms,
    hiddenIndices,
    representation,
    spin,
    nominalArrowScale,
  ]);

  // ── 3Dmol.js: spin toggle ──
  useEffect(() => {
    if (engine !== "3dmol") return;
    viewerInstance.current?.spin(spin);
  }, [engine, spin]);

  // ── Ctrl/Cmd tracking for the box-select overlay ──
  useEffect(() => {
    if (engine !== "3dmol") return;
    const sync = (e: KeyboardEvent) => setModifierHeld(e.ctrlKey || e.metaKey);
    const clear = () => setModifierHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, [engine]);

  // ── Escape clears the selection and disarms sticky box-select ──
  useEffect(() => {
    if (selection.length === 0 && !marqueeArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelection([]);
      setMarqueeArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection.length, marqueeArmed]);

  // ── Gear menu and gestures popover: outside click / Escape ──
  // One effect for both, so a click that opens one closes the other and Escape
  // is not registered twice.
  useEffect(() => {
    if (!menuOpen && !helpOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target)) setMenuOpen(false);
      if (!helpRef.current?.contains(target)) setHelpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setHelpOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, helpOpen]);

  // ── Reset view ──
  // Orientation FIRST, then the fit. frameView alone leaves the tumble
  // untouched (3Dmol's zoomTo preserves the rotation matrix), so before this
  // there was no way back to the canonical orientation once a user had dragged.
  const handleReset = useCallback(() => {
    if (engine !== "3dmol") return;
    const v = viewerInstance.current;
    if (!v) return;
    resetOrientation(v);
    const solved = frameAndMeasure(
      v,
      result,
      { rep: representation, spinning: spin },
      nominalArrowScale
    );
    setPxPerAngstrom(solved.metrics?.pxPerAngstrom ?? null);
    setArrowCeiling(solved.arrowCeiling);
    // Same-tick rebuild — see drawnArrowScaleRef.
    const nextScale = effectiveArrowScale(nominalArrowScale, solved.arrowCeiling);
    if (drawnArrowScaleRef.current !== nextScale) {
      applyView(v, result, atoms, optionsRef.current, hiddenIndices, nextScale);
      drawnArrowScaleRef.current = nextScale;
    }
  }, [
    engine,
    result,
    atoms,
    hiddenIndices,
    representation,
    spin,
    nominalArrowScale,
  ]);

  // ── Fullscreen ──
  // State is driven ONLY by the fullscreenchange event. The old code flipped
  // it optimistically and dropped the promise, so a rejected request (iframe
  // without allow="fullscreen", a permissions policy, a non-user gesture) left
  // the component in CSS fullscreen inside its original column, clipped on all
  // four sides with no way back.
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const target = el as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const active = document.fullscreenElement ?? doc.webkitFullscreenElement;
    try {
      if (active) {
        Promise.resolve(
          document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.()
        ).catch(() => {});
      } else {
        Promise.resolve(
          target.requestFullscreen?.() ?? target.webkitRequestFullscreen?.()
        ).catch(() => {});
      }
    } catch {
      /* Synchronous throw in older engines — state stays event-driven. */
    }
  }, []);

  useEffect(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    const onChange = () => {
      const active = document.fullscreenElement ?? doc.webkitFullscreenElement;
      setFullscreen(active === containerRef.current);
      // The box changed size; re-solve the fit once layout has settled. The
      // ResizeObserver normally covers this, but entering fullscreen on a
      // display of different density also changes the backing store.
      requestAnimationFrame(() => resizeRef.current());
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // ── Hide C–H bonds ──
  const toggleHideNonpolarH = useCallback(() => {
    setHideNonpolarH((current) => {
      const next = !current;
      if (next) {
        const gone = new Set(hiddenIndices);
        setSelection((sel) => sel.filter((i) => !gone.has(i)));
      }
      return next;
    });
  }, [hiddenIndices]);

  // ── PNG export ──
  // The canvas is transparent (backgroundAlpha 0), and a transparent PNG
  // dropped into a figure or a slide picks up whatever is behind it — usually
  // not what anyone wants. So the frame is composited onto an OPAQUE colour
  // first: the theme's `--color-bg-elevated`, which is #FFFFFF in the light
  // theme and the dark elevated surface under `.dark`. That is the same value
  // already handed to createViewer as `backgroundColor`, so there is one
  // source of truth for "what colour is behind the molecule in an export".
  const handleDownloadPng = useCallback(() => {
    const v = viewerInstance.current;
    const host = viewerRef.current;
    if (!v || !host) return;
    v.render();
    let uri: string;
    try {
      uri = v.pngURI();
    } catch {
      return;
    }
    const background = readCanvasBackground(host);
    const image = new window.Image();
    image.onload = () => {
      const out = document.createElement("canvas");
      out.width = image.naturalWidth || image.width;
      out.height = image.naturalHeight || image.height;
      const ctx = out.getContext("2d");
      if (!ctx || !out.width || !out.height) return;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(image, 0, 0);
      const link = document.createElement("a");
      link.href = out.toDataURL("image/png");
      link.download = `simpleatom-structure-${atoms.length || result.symbols?.length || 0}-atoms.png`;
      // Firefox only honours a programmatic click on an anchor that is in the
      // document.
      document.body.appendChild(link);
      link.click();
      link.remove();
    };
    image.src = uri;
  }, [atoms.length, result.symbols?.length]);

  // ── Box select (Ctrl/Cmd + drag, or the sticky gear-menu mode) ──
  const marqueeActive = modifierHeld || marqueeArmed || marquee !== null;

  const onMarqueeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    marqueeStart.current = { x, y };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, []);

  const onMarqueeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = marqueeStart.current;
    const box = boxRef.current;
    if (!start || !box) return;
    const rect = box.getBoundingClientRect();
    setMarquee({
      x0: start.x,
      y0: start.y,
      x1: e.clientX - rect.left,
      y1: e.clientY - rect.top,
    });
  }, []);

  const onMarqueeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = marqueeStart.current;
      marqueeStart.current = null;
      setMarquee(null);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const box = boxRef.current;
      const v = viewerInstance.current;
      if (!start || !box || !v) return;

      const rect = box.getBoundingClientRect();
      const x1 = e.clientX - rect.left;
      const y1 = e.clientY - rect.top;
      if (
        Math.abs(x1 - start.x) < MARQUEE_CLICK_SLOP_PX &&
        Math.abs(y1 - start.y) < MARQUEE_CLICK_SLOP_PX
      ) {
        // Modifier-click with no drag: treat as "clear".
        setSelection([]);
        return;
      }

      const left = rect.left + window.scrollX + Math.min(start.x, x1);
      const right = rect.left + window.scrollX + Math.max(start.x, x1);
      const top = rect.top + window.scrollY + Math.min(start.y, y1);
      const bottom = rect.top + window.scrollY + Math.max(start.y, y1);

      const candidates = atomsRef.current.filter(
        (a) => !hiddenSet.has(a.index)
      );
      if (candidates.length === 0) return;
      const screen = v.modelToScreen(
        candidates.map((a) => ({ x: a.x, y: a.y, z: a.z }))
      ) as Array<{ x: number; y: number }>;
      if (!Array.isArray(screen) || screen.length !== candidates.length) return;

      const picked: number[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const s = screen[i];
        if (s.x >= left && s.x <= right && s.y >= top && s.y <= bottom) {
          picked.push(candidates[i].index);
        }
      }
      setSelection(picked);
    },
    [hiddenSet]
  );

  const canHideCH = hiddenIndices.length > 0;

  /** Square-ish WEAS box, clamped to the same 260-520 px band as the 3Dmol one. */
  const weasHeight = fullscreen
    ? 600
    : Math.round(Math.max(260, Math.min(boxWidth || 420, 520)));

  return (
    <div
      ref={containerRef}
      className={`group relative rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-4 transition-all ${
        fullscreen ? "flex h-screen flex-col" : ""
      }`}
    >
      {/* ── Header & toolbar ── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            3D structure viewer
          </h3>
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {result.symbols?.length || 0} atoms
          </span>
        </div>

        {/* flex-wrap here as well as on the header row. Without it the inner
            group is a single 364 px line starting at left 41, so at a 375 px
            viewport the last control sits at x = 373-405: outside the
            viewport, not focusable by pointer, and silently clipped because
            the row has no scrollbar. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* ── Engine toggle: 3Dmol ↔ WEAS ── */}
          <div
            role="radiogroup"
            aria-label="Viewer engine"
            className="flex rounded border border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)]"
          >
            <button
              type="button"
              role="radio"
              aria-checked={is3Dmol}
              onClick={() => setEngine("3dmol")}
              title="3Dmol.js viewer (force arrows supported)"
              className={`flex items-center justify-center rounded-l font-mono text-xs transition-colors ${
                coarse ? "h-11 px-3" : "h-8 px-2"
              } ${
                is3Dmol
                  ? "bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-strong)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-accent-strong)]"
              }`}
            >
              3Dmol
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!is3Dmol}
              onClick={() => setEngine("weas")}
              title="WEAS viewer (ml-peg compatible)"
              className={`flex items-center justify-center rounded-r font-mono text-xs transition-colors ${
                coarse ? "h-11 px-3" : "h-8 px-2"
              } ${
                !is3Dmol
                  ? "bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-strong)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-accent-strong)]"
              }`}
            >
              WEAS
            </button>
          </div>

          {/* ── 3Dmol.js-only controls: representation + forces + reset ── */}
          {is3Dmol && (
            <>
              <div
                role="radiogroup"
                aria-label="Representation"
                className="flex rounded border border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)]"
              >
                {(
                  [
                    ["ball-and-stick", Boxes, "Ball-and-stick"],
                    ["stick", Box, "Stick"],
                    ["spacefill", Circle, "Spacefill"],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={representation === key}
                    onClick={() => setRepresentation(key)}
                    title={label}
                    aria-label={label}
                    className={`flex items-center justify-center transition-colors ${
                      coarse ? HIT_SQUARE : HIT_SQUARE_FINE
                    } ${
                      representation === key
                        ? "bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-strong)]"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-accent-strong)]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <ToolbarButton
                  onClick={() => setShowForces(!showForces)}
                  title={showForces ? "Hide force vectors" : "Show force vectors"}
                  active={showForces}
                  pressed={showForces}
                  disabled={!hasForces}
                  coarse={coarse}
                >
                  {showForces ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </ToolbarButton>
                <ToolbarButton
                  onClick={handleReset}
                  title="Reset view (orientation and zoom)"
                  coarse={coarse}
                >
                  <RotateCcw className="h-4 w-4" />
                </ToolbarButton>

                {/* ── Settings (gear) ── mirrors the bar's menu: rotate,
                    hide C–H bonds, download PNG. Kept as a menu rather than
                    three more toolbar buttons: the row already wraps at
                    375 px and each added button costs another 36 px. */}
                <div className="relative" ref={menuRef}>
                  <ToolbarButton
                    onClick={() => setMenuOpen((o) => !o)}
                    title="Viewer settings"
                    active={menuOpen}
                    expanded={menuOpen}
                    hasPopup="menu"
                    coarse={coarse}
                  >
                    <Settings2 className="h-4 w-4" />
                  </ToolbarButton>
                  {menuOpen && (
                    <div
                      role="menu"
                      aria-label="Viewer settings"
                      className={`absolute right-0 z-30 min-w-[13rem] overflow-hidden rounded border border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)] py-1 shadow-lg ${
                        coarse ? "top-12" : "top-9"
                      }`}
                    >
                      <MenuItem
                        label="Rotate structure"
                        checked={spin}
                        onClick={() => setSpin((s) => !s)}
                        hint="Continuous auto-rotation"
                        coarse={coarse}
                      />
                      <MenuItem
                        label="Hide C–H bonds"
                        checked={hideNonpolarH}
                        disabled={!canHideCH}
                        onClick={toggleHideNonpolarH}
                        hint={
                          canHideCH
                            ? "Hide hydrogens whose only bonds are to carbon (and those bonds). Polar O–H / N–H hydrogens stay."
                            : "No carbon-bound hydrogens in this structure"
                        }
                        coarse={coarse}
                      />
                      <MenuItem
                        label="Box-select mode"
                        checked={marqueeArmed}
                        onClick={() => setMarqueeArmed((m) => !m)}
                        hint={
                          pointerFine
                            ? "Drag to select several atoms. Same as holding Ctrl/Cmd while dragging; rotation is off while it is on."
                            : "Drag to select several atoms. Rotation is off while it is on."
                        }
                        coarse={coarse}
                      />
                      <MenuItem
                        label="Clear selection"
                        icon={<X className="h-3.5 w-3.5" />}
                        disabled={selection.length === 0}
                        onClick={() => setSelection([])}
                        hint={pointerFine ? "Also bound to Escape" : undefined}
                        coarse={coarse}
                      />
                      <MenuItem
                        label="Download PNG"
                        icon={<Download className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setMenuOpen(false);
                          handleDownloadPng();
                        }}
                        hint="Composited onto an opaque background"
                        coarse={coarse}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Fullscreen (both engines) ── */}
          <ToolbarButton
            onClick={toggleFullscreen}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            active={fullscreen}
            pressed={fullscreen}
            coarse={coarse}
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </ToolbarButton>
        </div>
      </div>

      {/* ── Viewer canvas ──
          NO background and NO border. The canvas is transparent
          (backgroundAlpha 0), so whatever sits here shows through — and a
          white well made that transparency a pixel-level no-op: the well
          painted exactly the white the opaque canvas used to paint, measured
          identical. Stacking an elevated surface inside a secondary surface on
          the page tint gave three backgrounds and two borders around the
          molecule, which read as a screenshot in a box rather than an object
          on the page. The bar's wrapper is a bare rounded box with no fill and
          no border. Callers own the surface.

          SHAPE: aspect-square, capped at 520 px tall, instead of a fixed 420.
          At 375 px the old box was 291x420 portrait; the fit binds on the
          291 px axis, so the molecule reached 48% of the height and 11% of the
          area and the rest was scroll. Square wastes none of it and keeps the
          molecule the same size on screen. On a wide results column the height
          cap keeps it from becoming a full-page square. The bar uses
          `aspect-square w-full max-w-md`.

          WEAS takes a pixel height rather than filling its parent, so in WEAS
          mode the box stays auto-height and the same 260-520 band is applied
          to the iframe instead (weasHeight). */}
      <div
        ref={boxRef}
        className={`relative overflow-hidden rounded-lg ${
          fullscreen
            ? "min-h-0 flex-1"
            : is3Dmol
              ? "aspect-square max-h-[520px] min-h-[260px] w-full"
              : "w-full"
        }`}
      >
        {/* 3Dmol.js viewer (shown when engine === "3dmol") */}
        {is3Dmol && (
          <div
            ref={viewerRef}
            className="h-full w-full"
            style={{ position: "relative", height: "100%", width: "100%" }}
          />
        )}

        {/* WEAS viewer (shown when engine === "weas") */}
        {!is3Dmol && xyzData && (
          <WeasViewer structureData={xyzData} format="xyz" height={weasHeight} />
        )}

        {/* ── Box-select overlay ──
            Transparent, and pointer-transparent unless Ctrl/Cmd is held or the
            gear menu's sticky "Box-select mode" is on, so 3Dmol keeps every
            gesture it normally owns. When it IS armed it swallows the drag,
            which is why Ctrl-drag no longer pans (3Dmol binds pan to ctrlKey as
            well as to middle-drag; middle-drag still pans). Any button is
            accepted, because on macOS Ctrl+click is a SECONDARY click — the
            pointerdown arrives with button 2 — and the context menu is
            suppressed for the same reason.

            The sticky mode is the TOUCH route: a touch device has no modifier
            key, so Ctrl/Cmd-drag is unreachable there. Pointer events fire for
            touch, so a one-finger drag over this overlay draws the same
            marquee. */}
        {is3Dmol && (
          <div
            className="absolute inset-0 z-10 touch-none"
            style={{
              pointerEvents: marqueeActive ? "auto" : "none",
              cursor: marqueeActive ? "crosshair" : "default",
            }}
            onPointerDown={onMarqueeDown}
            onPointerMove={onMarqueeMove}
            onPointerUp={onMarqueeUp}
            onPointerCancel={onMarqueeUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            {marquee && (
              <div
                className="absolute border border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/15"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
          </div>
        )}

        {/* ── Measurement readout (top-left, like the bar) ── */}
        {is3Dmol && selection.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 z-20 max-w-[calc(100%-1rem)]">
            <div className="rounded border border-[var(--color-accent-primary)]/60 bg-[var(--color-bg-elevated)]/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Ruler className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-strong)]" />
                <div className="min-w-0">
                  {measurement ? (
                    <>
                      <p className="font-mono text-xs font-bold text-[var(--color-accent-strong)]">
                        {measurement.kind}
                        {measurement.value !== "—" && (
                          <span className="text-[var(--color-text-primary)]">
                            {" "}
                            {measurement.value}
                          </span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-[var(--color-text-muted)]">
                        {measurement.path}
                        {measurement.note ? ` · ${measurement.note}` : ""}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-mono text-xs font-bold text-[var(--color-accent-strong)]">
                        {selectedAtoms[0]
                          ? atomLabel(selectedAtoms[0])
                          : "1 atom"}{" "}
                        selected
                      </p>
                      <p className="font-mono text-xs text-[var(--color-text-muted)]">
                        add a 2nd atom for a distance in Å
                      </p>
                    </>
                  )}
                </div>
                {/* The only interactive thing in a pointer-events-none
                    overlay, so there is no neighbour for an expanded hit area
                    to collide with: `after:-inset-3` grows the tap target to
                    44x44 (20 + 2x12) without growing the readout itself, which
                    has to stay small enough not to cover the molecule. */}
                <button
                  type="button"
                  onClick={() => setSelection([])}
                  title={pointerFine ? "Clear selection (Esc)" : "Clear selection"}
                  aria-label="Clear selection"
                  className="pointer-events-auto relative ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors after:absolute after:-inset-3 after:content-[''] hover:bg-[var(--color-accent-primary)]/10 hover:text-[var(--color-accent-strong)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Hover info box ── */}
        {is3Dmol && hover && !marquee && (
          <div
            className="pointer-events-none absolute z-20 max-w-[16rem] -translate-x-1/2 -translate-y-full rounded border border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)]/95 px-2 py-1 shadow-sm"
            style={{
              left: Math.max(8, hover.x),
              top: Math.max(24, hover.y - 8),
            }}
          >
            <p className="font-mono text-xs font-bold text-[var(--color-text-primary)]">
              {hover.text}
            </p>
            <p className="whitespace-nowrap font-mono text-xs text-[var(--color-text-muted)]">
              {hover.detail}
            </p>
          </div>
        )}

        {/* ── Box-select mode badge ──
            The crosshair cursor is the desktop affordance for this mode and a
            touch device has no cursor, so the state needs to be visible on the
            canvas: otherwise "my drag stopped rotating the molecule" has no
            explanation on a phone.

            Width-capped so it cannot reach the "?" in the opposite corner: this
            line is ~54 characters at 10px mono, wider than the whole box at a
            375 px viewport, and two overlapping controls in one corner is worse
            than a wrapped label. */}
        {is3Dmol && marqueeArmed && (
          <div className="absolute bottom-2 left-2 z-20 max-w-[calc(100%-3.5rem)]">
            <button
              type="button"
              onClick={() => setMarqueeArmed(false)}
              className={`flex items-center gap-1.5 rounded border border-[var(--color-accent-primary)]/60 bg-[var(--color-bg-elevated)]/95 px-2 text-left font-mono text-xs text-[var(--color-accent-strong)] shadow-sm ${
                coarse ? "min-h-[44px] py-2" : "py-1"
              }`}
            >
              <Ruler className="h-3 w-3 shrink-0" />
              <span>
                Box-select on — drag to select ·{" "}
                {pointerFine ? "click" : "tap"} here to turn off
              </span>
            </button>
          </div>
        )}

        {/* ── Gestures, on demand ──
            WHY THIS IS A "?" AND NOT A CAPTION. The gesture list used to be
            printed under the viewer as a permanent 4-line, 12px monospace
            manual: 64 px tall on desktop, 96 px at 375 px, and on the landing
            page it was the LOWEST element above the fold — the hero's last word
            was an instruction sheet for a control the reader had not touched
            yet. The reference embed shows zero instructions. So the list moves
            behind an affordance and the hero reclaims the space outright: with
            no forces to legend (the hero has none) the caption below now renders
            nothing at all.

            Inside the canvas rather than in the toolbar, deliberately: the
            toolbar already wraps at 375 px, so an eighth button there could add
            a row and give back the height this is meant to reclaim. The corner
            costs no layout at all. Bottom-RIGHT because bottom-left is the
            box-select badge and top-left is the measurement readout.

            The content still lists only gestures the device can perform — see
            `pointerFine`. Do not merge the two branches. */}
        {!loading && (
          <div ref={helpRef} className="absolute bottom-2 right-2 z-20">
            {helpOpen && (
              <div
                id="viewer-gestures"
                role="group"
                aria-label="Gestures and controls"
                className="absolute bottom-full right-0 mb-2 w-[16rem] rounded border border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)]/95 p-2.5 shadow-lg backdrop-blur-sm"
              >
                <ul className="space-y-1 font-mono text-xs leading-snug text-[var(--color-text-muted)]">
                  {(is3Dmol
                    ? pointerFine
                      ? [
                          "Drag to rotate",
                          "Scroll or right-drag to zoom",
                          "Middle-drag to pan",
                          "Click an atom to select — 2 give a distance in Å, 3 an angle, 4 a dihedral",
                          "Ctrl/Cmd-drag to box-select",
                          "Esc to clear the selection",
                        ]
                      : [
                          "Drag to rotate",
                          "Pinch to zoom",
                          "Three-finger drag to pan",
                          "Tap an atom to select — 2 give a distance in Å, 3 an angle, 4 a dihedral",
                          "Tap × on the readout to clear",
                          "Box-select: turn it on in the gear menu",
                        ]
                    : [
                        "WEAS viewer (ml-peg compatible)",
                        "Drag to rotate",
                        "Scroll to zoom",
                      ]
                  ).map((line) => (
                    <li key={line} className="flex gap-1.5">
                      <span
                        aria-hidden="true"
                        className="text-[var(--color-accent-strong)]"
                      >
                        ·
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => setHelpOpen((o) => !o)}
              title="Gestures and controls"
              aria-label="Gestures and controls"
              aria-expanded={helpOpen}
              aria-controls="viewer-gestures"
              className={`flex items-center justify-center rounded-full border transition-colors ${
                coarse ? HIT_SQUARE : "h-7 w-7"
              } ${
                helpOpen
                  ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-strong)]"
                  : "border-[var(--color-border-emphasis)] bg-[var(--color-bg-elevated)]/90 text-[var(--color-text-muted)] hover:border-[var(--color-accent-primary)]/60 hover:text-[var(--color-accent-strong)]"
              }`}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Loading spinner (3Dmol only — WEAS has its own) */}
        {is3Dmol && loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-bg-elevated)]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border-subtle)] border-t-[var(--color-accent-primary)]" />
          </div>
        )}
      </div>

      {/* ── Force-vector legend ──
          All that is left under the viewer, and only when there is something to
          legend. An arrow length that encodes a quantity is not readable without
          its scale, so this stays visible rather than moving into the popover
          with the gestures.

          The scale is set by the GEOMETRY (see ARROW_REFERENCE_FORCE), so two
          results for one structure print the same number whichever model ran.
          It used to be set by |F|max: the same ethanol geometry printed "1.0 Å
          per eV/Å" under MACE-MP-0 and "0.50" under MACE-OFF, and the larger
          forces drew the shorter arrows. The one thing that can still move it is
          the screen-space ceiling, and when that cuts the arrows the legend says
          so, with the scale it cut from. The TICK backs the number up: a
          reference of known force whose drawn length IS the scale, so a cut
          scale is visible without reading anything. */}
      {is3Dmol && hasForces && showForces && arrowScale > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-[var(--color-text-muted)]">
          <span>
            Green arrows = force vectors · {formatArrowScale(arrowScale)} Å per
            eV/Å
            {arrowScaleCut &&
              ` (cut from ${formatArrowScale(uncutArrowScale)} to fit the frame)`}
          </span>
          {arrowTick && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true">·</span>
              <span
                aria-hidden="true"
                className="inline-block h-[3px] rounded-sm bg-[#228833]"
                style={{ width: `${arrowTick.px.toFixed(1)}px` }}
              />
              <span>= {arrowTick.force} eV/Å</span>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/*
 * ============================================================================
 * DOCUMENTATION: Dual-Engine Viewer (3Dmol.js + WEAS)
 * ============================================================================
 *
 * OVERVIEW:
 *   The viewer supports two rendering engines that users can toggle between:
 *
 *   1. 3Dmol.js — Full-featured viewer with:
 *      - Ball-and-stick, stick, spacefill representations
 *      - Force vector arrows (green, scaled)
 *      - Auto-rotate (spin), reset view, fullscreen
 *      - Atom / bond selection with distance, angle and dihedral readout
 *      - Hide C–H bonds, PNG export
 *      Loaded from npm (3dmol package), rendered via direct DOM control.
 *
 *   2. WEAS — ml-peg compatible viewer with:
 *      - Ball-and-stick rendering
 *      - XYZ and CIF format support
 *      - Trajectory support (future)
 *      - Same look as https://ml-peg.stfc.ac.uk
 *      Loaded from CDN (unpkg.com/weas), rendered in a sandboxed iframe.
 *
 * WHEN TO USE WHICH:
 *   - 3Dmol.js: Default. Use when you need force arrows or advanced controls.
 *   - WEAS: Use when you want ml-peg compatibility or plan to integrate with
 *     the MACE team's tooling.
 *
 * TOOLBAR LAYOUT:
 *   [3Dmol | WEAS] | [Ball-and-stick | Stick | Spacefill] | [Forces] [Reset]
 *   [Gear] | [Fullscreen]
 *   The gear menu holds Rotate structure, Hide C–H bonds, Box-select mode,
 *   Clear selection and Download PNG — the bar's own menu is Rotate structure /
 *   Manage molecule view / Hide C–H bonds / Download PNG. "Manage molecule
 *   view" is the representation switcher, which stays visible in the toolbar
 *   here.
 *   ON THE CANVAS, not in the toolbar: the "?" gesture list (bottom-right) and
 *   the box-select badge (bottom-left). Both are there because the toolbar row
 *   already wraps at 375 px, so anything added to it can cost a row of height —
 *   and the "?" exists to RECLAIM height. Do not migrate them into the toolbar.
 *
 * TOUCH:
 *   Every control switches to a 44 px hit target when the device reports no
 *   fine pointer (see HIT_SQUARE), and the "?" popover swaps to a touch gesture
 *   list. Do NOT put right-drag, middle-drag, Ctrl/Cmd or Esc back into the
 *   shared copy: a touch device can perform none of them. 3Dmol's touch handling
 *   is one finger to rotate, two to pinch-zoom, three to pan
 *   (GLViewer._handleMouseMove, branching on ev.targetTouches.length); there is
 *   no native touch gesture for box-select, which is why box-select is a MODE in
 *   the gear menu rather than a gesture in the list.
 *
 * WHERE THE GESTURE LIST LIVES, AND WHY IT IS NOT A CAPTION:
 *   Behind a "?" in the bottom-right of the canvas. It used to be printed under
 *   the viewer permanently — four 12px monospace lines, 64 px tall, six lines and
 *   96 px at 375 px, and on the landing page it was the lowest element above the
 *   fold. A hero should not end in an instruction sheet for a control the reader
 *   has not touched; the reference embed shows no instructions at all. Only the
 *   force-vector legend is still printed below the viewer, and only when there
 *   are arrows to legend — so a viewer with no forces (the landing hero) now has
 *   no caption whatsoever. Do not put the gestures back into the caption.
 *
 * SELECTION & MEASUREMENT:
 *   Click an atom to select it: it is redrawn, opaque, in the accent green and
 *   0.10 A larger than its neighbours (SELECTION_HALO_PAD). There is no
 *   translucent shell: on this transparent canvas 3Dmol blends translucent shapes
 *   against its white clear colour, and a 0.62-opacity halo measured a green
 *   channel 5 BELOW the page it sat on. Do not bring one back without measuring
 *   its pixels over the page. Clicking a bond selects both of its atoms.
 *   Ctrl/Cmd-drag (or gear > Box-select mode, which is the touch route)
 *   box-selects. 2 atoms give a distance in Å, 3 an angle in degrees about the
 *   middle atom, 4 a signed dihedral in degrees — selection ORDER sets the
 *   vertex and the sign, so the selection is a list, not a set. Two atoms are
 *   only called a "bond length" when 3Dmol's distance-based perception actually
 *   put a bond there; otherwise the readout says "Distance" and says why. MACE
 *   gives no bond orders and none are invented here.
 *
 * FILES:
 *   - molecule-viewer-3d.tsx (this file) — Main viewer with engine toggle
 *   - weas-viewer.tsx — WEAS iframe wrapper component
 *
 * RENDER SETTINGS — DO NOT DROP WHEN ADDING FEATURES:
 *   The ViewerSpec passed to createViewer() carries five deliberate options:
 *   `antialias` + `upscale` (>= 2x backing store), `outline` (dark contact
 *   outline), `ambientOcclusion` (soft contact shading) and `hoverDuration`.
 *   Together with frameView(), repStyle()'s white-capped CPK scheme and the
 *   theme-derived background, these are the render-quality bar from
 *   docs/v2/bars/rowan.md.
 *
 * FRAMING — WHY THE PAD IS PER-ATOM:
 *   See drawnRadius() and measureProjectedExtent(). The short version: a
 *   single shared "largest radius" pad overestimates the silhouette by
 *   (largest radius - outermost atom's radius), which grows with the
 *   representation's bulk, so the solver under-zoomed most where the atoms
 *   were fattest and spacefill came out SMALLER than ball-and-stick. Do not
 *   reintroduce a single shared pad, and do not special-case spacefill.
 *
 * FRAMING — WHAT THE FIT IS SOLVED FOR, AND WHAT IT IGNORES:
 *   Six rules, each of which was a measured defect before it was a rule.
 *   1. Fit the ATOMS. Force arrows are not probed and the framing effect is not
 *      keyed on `showForces`, so toggling the arrows cannot change the
 *      molecule's size by even a pixel. Feeding arrow TIPS to the solver is
 *      what left the default result view at 12% of the box width.
 *   2. Bound the arrows instead, with ONE shared scale so lengths stay
 *      proportional to |F|, and print the resulting Å-per-eV/Å in the legend.
 *      The scale comes from the GEOMETRY, never from |F|max, so every result for
 *      one structure is drawn on one ruler (ARROW_REFERENCE_FORCE); the bound is
 *      MEASURED in screen space (ARROW_TIP_SAFE_FILL), and when it cuts the
 *      scale the legend says so.
 *   3. Re-centre on the projected bounding box, via rotationGroup's post-
 *      rotation x/y offset (setFramingPan) — NOT translateScene, which would
 *      turn rotate() into an orbit.
 *   4. Handle auto-rotation as a CEILING, not as a second fit. Both states solve
 *      the same per-orientation fit; while spinning, the swept cylinder about the
 *      model's own y axis (the axis spin(true) turns about) must additionally fit
 *      the canvas. Where it already does — the default view, 137 px/Å needed
 *      against 164 permitted — the two framings are identical and there is no
 *      pop. Fitting a rotation-invariant SPHERE to TARGET_FILL instead is what
 *      cost 27% of the apparent size the instant auto-rotate was engaged.
 *      See SWEEP_SAFE_FILL, including what this still does not fix.
 *   5. Never let a ceiling zoom IN. Ceilings only ever pull the fit back.
 *   6. Frame the STRUCTURE, not the declutter setting. Hidden C–H hydrogens are
 *      fitted, swept and arrow-bounded as if drawn, so "Hide C–H bonds" moves no
 *      remaining atom and rescales no remaining arrow. Fitting the drawn subset
 *      magnified it 1.41x on every toggle.
 *
 * SPECULAR HIGHLIGHTS — SETTLED, DO NOT RE-OPEN:
 *   An earlier round listed "no gloss" as a gap needing a 3Dmol fork. It is
 *   not a gap. The bar was measured pixel-by-pixel and has no specular term
 *   either: its brightest pixel anywhere in the molecule is 242/255 and zero
 *   pixels reach 245. What reads as gloss there is a hard dark contour over a
 *   flat mid-grey fill — a graphic-design effect, not a shading model. Our
 *   render is already the more strongly lit of the two (carbon spans ~117
 *   luminance levels against the bar's ~34).
 *
 *   Forking 3Dmol to add a specular term would therefore buy no visible
 *   quality AND would actively regress the white-ceiling fix above, since a
 *   specular lobe adds exactly the blown-out near-background pixels that
 *   WHITE_CEILING exists to prevent. Rejected on measurement, not on effort.
 *
 * FUTURE ml-peg INTEGRATION:
 *   Using the same WEAS viewer as ml-peg means structures will look identical
 *   in both tools. A future "Browse ml-peg structures" feature could load
 *   benchmark structures directly into this viewer.
 *   See: https://github.com/ddmms/ml-peg
 * ============================================================================
 */
