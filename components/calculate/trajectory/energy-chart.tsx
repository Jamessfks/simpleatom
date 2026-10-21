"use client";

/**
 * EnergyChart — SVG multi-series line chart vs. MD step.
 *
 * PURPOSE:
 *   Visualize how a per-frame quantity evolves over MD steps. A materials
 *   scientist uses this to check equilibration, detect instabilities, and
 *   verify energy conservation (NVE) or thermostat behavior (NVT/NPT).
 *
 * WHAT IT PLOTS — AND WHY IT TAKES SERIES, NOT ONE ARRAY:
 *   This chart used to take a single `energies` array and call it "total
 *   energy". It was the POTENTIAL energy: the backend recorded
 *   `atoms.get_potential_energy()` and nothing else. Potential energy is not
 *   conserved under any ensemble — it trades against kinetic energy every
 *   step — so an NVE run looked wildly non-conserving on this chart while
 *   being conserved to a few meV. Measured on a 20-step MACE-OFF NVE run of
 *   ethanol: potential swung 161 meV, total held to 6 meV.
 *
 *   The backend now records potential, kinetic and total energy plus the
 *   instantaneous temperature per frame, so the caller passes the series it
 *   means. Total and potential share a sensible eV axis (they differ by the
 *   kinetic energy, a fraction of an eV); plotting them together is what
 *   makes "flat total, swinging potential" visible at a glance. Kinetic
 *   energy sits near zero against totals of order 10³ eV and would be a flat
 *   line on that axis — report it numerically instead, or give it its own
 *   chart with its own `yLabel`.
 *
 * FEATURES:
 *   - One SVG path per series, Paul Tol colorblind-safe colors, optional fill
 *   - Current-frame indicator (vertical line + dot on the primary series)
 *   - Hover crosshair showing every series' value at the hovered step
 *   - Auto-scaled axes (over all series) with labeled ticks
 *   - Responsive width (fills container)
 *
 * DESIGN:
 *   Pure SVG — no charting library dependency. This keeps the bundle small
 *   and gives full control over the warm, light theme aesthetic.
 */

import { useRef, useState, useCallback, useId, useMemo } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChartSeries {
  /** Legend/tooltip label, e.g. "Total (PE + KE)". */
  label: string;
  /** One value per frame; same length as `steps`. */
  values: number[];
  /** Stroke color (use the Paul Tol palette in charts/chart-config.ts). */
  color: string;
  /** Dashed stroke — for secondary series. */
  dashed?: boolean;
  /** Fill the area under this series (only sensible for one series). */
  fill?: boolean;
}

interface EnergyChartProps {
  /** Series to plot. All share one y-axis, so pass commensurate quantities. */
  series: ChartSeries[];
  /** Step indices (same length as each series' values). */
  steps: number[];
  /** Currently active frame index (highlighted on chart). */
  currentFrame: number;
  /** Optional callback when user clicks a point on the chart. */
  onFrameSelect?: (frameIndex: number) => void;
  /** Y-axis caption, including the unit. */
  yLabel?: string;
  /** Unit suffix used in the hover tooltip. */
  unit?: string;
  /** Decimal places for axis ticks and tooltip values. */
  decimals?: number;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 180;
const PADDING = { top: 12, right: 16, bottom: 32, left: 64 };
const VIEWBOX_WIDTH = 600;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EnergyChart({
  series,
  steps,
  currentFrame,
  onFrameSelect,
  yLabel = "Energy (eV)",
  unit = "eV",
  decimals = 3,
}: EnergyChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  // SVG def ids must be unique per instance — more than one of these charts
  // can be on screen at once (energy and temperature), and a shared id would
  // make the second chart adopt the first one's gradient color.
  const uid = useId().replace(/:/g, "");
  const fillId = `energyFill-${uid}`;
  const glowId = `glow-${uid}`;

  // Series that actually carry data. A caller may pass an optional series
  // (e.g. totalEnergies from an older shared result) that is simply absent.
  const plotted = useMemo(
    () => series.filter((s) => s.values.length > 0),
    [series],
  );

  // Number of data points — driven by the primary (first) series.
  const n = plotted[0]?.values.length ?? 0;

  // Axis ranges span EVERY series, with 5% padding on the y-axis.
  // Reduced rather than spread into Math.min: MD steps go up to 100 000 in
  // the UI, and `Math.min(...arr)` throws a RangeError once the array is
  // larger than the engine's argument limit.
  const { yMin, yMax, xMin, xMax } = useMemo(() => {
    let eMin = Infinity;
    let eMax = -Infinity;
    for (const s of plotted) {
      for (const v of s.values) {
        if (v < eMin) eMin = v;
        if (v > eMax) eMax = v;
      }
    }
    if (!Number.isFinite(eMin)) {
      eMin = 0;
      eMax = 1;
    }
    const yPad = (eMax - eMin) * 0.05 || 0.001; // avoid zero-range
    return {
      yMin: eMin - yPad,
      yMax: eMax + yPad,
      xMin: steps[0] ?? 0,
      xMax: steps[n - 1] ?? n - 1,
    };
  }, [plotted, steps, n]);

  const plotW = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
  const plotH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const toX = useCallback(
    (step: number) =>
      PADDING.left + ((step - xMin) / (xMax - xMin || 1)) * plotW,
    [xMin, xMax, plotW]
  );
  const toY = useCallback(
    (value: number) =>
      PADDING.top + (1 - (value - yMin) / (yMax - yMin || 1)) * plotH,
    [yMin, yMax, plotH]
  );

  // Build one SVG path per series (plus an optional closed fill path).
  const paths = useMemo(
    () =>
      plotted.map((s) => {
        const line = s.values
          .map((v, i) => `${i === 0 ? "M" : "L"}${toX(steps[i] ?? i)},${toY(v)}`)
          .join(" ");
        const bottomY = PADDING.top + plotH;
        const fill =
          s.fill && s.values.length > 1
            ? `${line} L${toX(steps[s.values.length - 1] ?? s.values.length - 1)},${bottomY} L${toX(steps[0] ?? 0)},${bottomY} Z`
            : null;
        return { series: s, line, fill };
      }),
    [plotted, steps, toX, toY, plotH]
  );

  // Y-axis tick values (5 ticks)
  const yTicks = useMemo(() => {
    const count = 5;
    return Array.from({ length: count }, (_, i) => yMin + ((yMax - yMin) * i) / (count - 1));
  }, [yMin, yMax]);

  // Handle mouse move for hover crosshair
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || n === 0) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
      // Find nearest data point
      const dataX = xMin + ((svgX - PADDING.left) / plotW) * (xMax - xMin);
      let closest = 0;
      let minDist = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs((steps[i] ?? i) - dataX);
        if (d < minDist) {
          minDist = d;
          closest = i;
        }
      }
      setHover({ x: toX(steps[closest] ?? closest), idx: closest });
    },
    [n, xMin, xMax, plotW, steps, toX]
  );

  const handleClick = useCallback(() => {
    if (hover && onFrameSelect) onFrameSelect(hover.idx);
  }, [hover, onFrameSelect]);

  // Current frame marker position — on the primary series.
  const frameIdx = Math.min(currentFrame, n - 1);
  const cfX = n > 0 ? toX(steps[frameIdx] ?? frameIdx) : 0;
  const cfY = n > 0 ? toY(plotted[0].values[frameIdx]) : 0;
  const primaryColor = plotted[0]?.color ?? "#4477AA";

  if (n === 0) return null;

  return (
    <div className="w-full">
      {/* ── Legend — named series, so no quantity is guessed at ── */}
      {plotted.length > 1 && (
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {plotted.map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-secondary)]"
            >
              <svg width="14" height="6" aria-hidden>
                <line
                  x1="0"
                  y1="3"
                  x2="14"
                  y2="3"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeDasharray={s.dashed ? "3,2" : undefined}
                />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${CHART_HEIGHT}`}
        className="w-full select-none"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
        style={{ cursor: onFrameSelect ? "crosshair" : "default" }}
      >
        <defs>
          {/* Gradient fill under the primary line (Paul Tol blue — data mark) */}
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.20" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0.02" />
          </linearGradient>
          {/* Glow filter for the current-frame dot */}
          <filter id={glowId}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Grid lines ── */}
        {yTicks.map((t) => (
          <line
            key={t}
            x1={PADDING.left}
            y1={toY(t)}
            x2={VIEWBOX_WIDTH - PADDING.right}
            y2={toY(t)}
            stroke="#EAE6DD"
            strokeWidth="0.5"
          />
        ))}

        {/* ── Gradient fill under the filled series ── */}
        {paths.map(
          ({ series: s, fill }) =>
            fill && <path key={`fill-${s.label}`} d={fill} fill={`url(#${fillId})`} />
        )}

        {/* ── One line per series ── */}
        {paths.map(({ series: s, line }) => (
          <path
            key={`line-${s.label}`}
            d={line}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            strokeDasharray={s.dashed ? "4,3" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* ── Current frame indicator (vertical line + glowing dot) ── */}
        <line
          x1={cfX}
          y1={PADDING.top}
          x2={cfX}
          y2={PADDING.top + plotH}
          stroke={primaryColor}
          strokeWidth="1"
          strokeDasharray="3,3"
          opacity="0.5"
        />
        <circle cx={cfX} cy={cfY} r="4" fill={primaryColor} filter={`url(#${glowId})`} />

        {/* ── Hover crosshair ── */}
        {hover && (
          <>
            <line
              x1={hover.x}
              y1={PADDING.top}
              x2={hover.x}
              y2={PADDING.top + plotH}
              stroke="#D8D2C6"
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
            {plotted.map((s) => (
              <circle
                key={`hover-${s.label}`}
                cx={hover.x}
                cy={toY(s.values[hover.idx])}
                r="3"
                fill="#FFFFFF"
                stroke={s.color}
                strokeWidth="1"
              />
            ))}
            {/* Hover tooltip — one line per series, each named */}
            <text
              x={hover.x + 6}
              y={PADDING.top + 10}
              fill="#5C574E"
              fontSize="9"
              fontFamily="monospace"
            >
              Step {steps[hover.idx] ?? hover.idx}
            </text>
            {plotted.map((s, i) => (
              <text
                key={`tip-${s.label}`}
                x={hover.x + 6}
                y={PADDING.top + 20 + i * 10}
                fill={s.color}
                fontSize="9"
                fontFamily="monospace"
              >
                {s.label} {s.values[hover.idx]?.toFixed(decimals)} {unit}
              </text>
            ))}
          </>
        )}

        {/* ── Y-axis labels ── */}
        {yTicks.map((t) => (
          <text
            key={t}
            x={PADDING.left - 6}
            y={toY(t) + 3}
            fill="#5C574E"
            fontSize="8"
            fontFamily="monospace"
            textAnchor="end"
          >
            {t.toFixed(decimals)}
          </text>
        ))}

        {/* ── X-axis labels (first, middle, last) ── */}
        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text
            key={i}
            x={toX(steps[i] ?? i)}
            y={CHART_HEIGHT - 4}
            fill="#5C574E"
            fontSize="8"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {steps[i] ?? i}
          </text>
        ))}

        {/* ── Axis labels ── */}
        <text
          x={VIEWBOX_WIDTH / 2}
          y={CHART_HEIGHT - 18}
          fill="#8A8478"
          fontSize="8"
          fontFamily="monospace"
          textAnchor="middle"
        >
          MD Step
        </text>
        <text
          x={12}
          y={CHART_HEIGHT / 2}
          fill="#8A8478"
          fontSize="8"
          fontFamily="monospace"
          textAnchor="middle"
          transform={`rotate(-90, 12, ${CHART_HEIGHT / 2})`}
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
}
