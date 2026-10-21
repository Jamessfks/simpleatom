"use client";

/**
 * TrajectoryViewer — Animated MD trajectory player with energy chart.
 *
 * PURPOSE:
 *   Let materials scientists "watch" atoms move during a molecular dynamics
 *   simulation. This is the single most requested visualization for MD —
 *   without it, trajectory data is just numbers.
 *
 * FEATURES:
 *   - 3Dmol.js viewer with frame-by-frame trajectory animation
 *   - Play / pause / step-forward / step-backward controls
 *   - Frame slider for scrubbing through the trajectory
 *   - Adjustable playback speed (0.5×, 1×, 2×, 4×)
 *   - Energy-vs-step chart synced with the current frame
 *   - Click on chart to jump to a specific frame
 *   - Current energy + frame counter display
 *
 * HOW IT WORKS:
 *   1. On mount, all trajectory frames are concatenated into a single
 *      multi-frame XYZ string.
 *   2. 3Dmol.js `addModelsAsFrames()` loads them as animation frames.
 *   3. A requestAnimationFrame loop drives playback at the chosen speed.
 *   4. Manual controls use `getModel().setFrame(n)` for instant seeking.
 *
 * DATA SOURCE:
 *   - result.trajectory.positions[frame][atom][xyz] — coordinates per frame
 *   - result.trajectory.potentialEnergies[frame] — potential energy (eV)
 *   - result.trajectory.kineticEnergies[frame]   — kinetic energy (eV)
 *   - result.trajectory.totalEnergies[frame]     — potential + kinetic (eV)
 *   - result.trajectory.temperatures[frame]      — instantaneous T (K)
 *   - result.trajectory.energies[frame] — potential energy; the original key,
 *     kept for results shared before the explicit keys existed. It was never
 *     the total energy, though this file used to call it that.
 *   - result.trajectory.step[frame] — step indices
 *   - result.symbols — element symbols (same for all frames)
 *
 * WHICH ENERGY IS SHOWN:
 *   Total energy where the backend supplied it, because that is the quantity
 *   an NVE run conserves and the one the docs tell users to check. Potential
 *   energy is plotted alongside it, named. When `totalEnergies` is absent
 *   (an older shared result) the chart shows potential energy alone and says
 *   so, rather than relabelling it.
 *
 * SHOWN ONLY WHEN:
 *   The parent (metrics-dashboard.tsx, Structure tab) renders this only when
 *   calculationType === "molecular-dynamics" AND trajectory data exists.
 *
 * DEPENDENCIES:
 *   - 3dmol (npm) — dynamically imported
 *   - ./energy-chart.tsx — SVG energy-vs-step chart
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  Gauge,
  Maximize,
  Minimize,
} from "lucide-react";
import type { GLViewer } from "3dmol";
import type { CalculationResult } from "@/types/mace";
import { EnergyChart } from "@/components/calculate/trajectory/energy-chart";
import { DATA_COLORS } from "@/components/calculate/charts/chart-config";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TrajectoryViewerProps {
  /** Full calculation result containing trajectory + symbols. */
  result: CalculationResult;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Available playback speed multipliers. */
const SPEEDS = [0.5, 1, 2, 4] as const;

/** Base interval between frames in ms (at 1× speed). */
const BASE_INTERVAL_MS = 150;

// ---------------------------------------------------------------------------
// Helper: build multi-frame XYZ string for 3Dmol.js addModelsAsFrames
// ---------------------------------------------------------------------------

/**
 * Concatenate all trajectory frames into a single multi-frame XYZ string.
 * 3Dmol.js `addModelsAsFrames` expects this format: each frame is a
 * complete XYZ block (atom count + comment + atom lines) back-to-back.
 *
 * The comment line names the quantity it carries (`E_pot=` / `E_tot=`)
 * rather than a bare `E =`, because these frames are the same bytes a user
 * can copy out of the viewer.
 */
function buildTrajectoryXYZ(
  symbols: string[],
  positions: number[][][],
  potentialEnergies: number[],
  totalEnergies: number[]
): string {
  const atomCount = symbols.length;
  let xyz = "";

  for (let f = 0; f < positions.length; f++) {
    const parts: string[] = [`Frame ${f}`];
    if (potentialEnergies[f] != null) {
      parts.push(`E_pot=${potentialEnergies[f].toFixed(6)} eV`);
    }
    if (totalEnergies[f] != null) {
      parts.push(`E_tot=${totalEnergies[f].toFixed(6)} eV`);
    }
    xyz += `${atomCount}\n`;
    xyz += `${parts.join(" | ")}\n`;
    for (let a = 0; a < atomCount; a++) {
      const [x, y, z] = positions[f][a];
      xyz += `${symbols[a]} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
    }
  }

  return xyz;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Guard only. The player's hooks live one level down so that this early
 * return cannot make them conditional — an early return ahead of
 * useState/useRef/useEffect puts every subsequent hook behind a data check,
 * which is what react-hooks/rules-of-hooks was flagging here.
 */
export function TrajectoryViewer({ result }: TrajectoryViewerProps) {
  if (!result.trajectory || !result.symbols) {
    return <div className="p-4 text-sm text-[var(--color-text-muted)]">No trajectory data available.</div>;
  }
  return (
    <TrajectoryPlayer
      traj={result.trajectory}
      symbols={result.symbols}
      targetTemperature={result.params?.temperature}
    />
  );
}

type Trajectory = NonNullable<CalculationResult["trajectory"]>;

function TrajectoryPlayer({
  traj,
  symbols,
  targetTemperature,
}: {
  traj: Trajectory;
  symbols: string[];
  /** MD target temperature (K), for the NVT "fluctuates around target" note. */
  targetTemperature?: number;
}) {
  const totalFrames = traj.positions.length;

  // `energies` is the potential energy — that is what the backend records
  // into it, and what it has always contained. `potentialEnergies` is the
  // explicit alias on newer results; prefer it, fall back to `energies` so
  // results shared before these keys existed still animate and still plot.
  const potentialEnergies = traj.potentialEnergies ?? traj.energies ?? [];
  const totalEnergies = traj.totalEnergies ?? [];
  const kineticEnergies = traj.kineticEnergies ?? [];
  const temperatures = traj.temperatures ?? [];
  const hasTotal = totalEnergies.length > 0;
  const steps =
    traj.step.length > 0 ? traj.step : potentialEnergies.map((_, i) => i);

  // ── State ──
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1); // index into SPEEDS (default 1×)
  const [viewerReady, setViewerReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerInstance = useRef<GLViewer | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Pre-build the multi-frame XYZ string (memoized via ref to avoid recompute)
  const xyzDataRef = useRef<string>("");
  if (!xyzDataRef.current) {
    xyzDataRef.current = buildTrajectoryXYZ(
      symbols,
      traj.positions,
      potentialEnergies,
      totalEnergies
    );
  }

  // ── Initialize 3Dmol.js viewer with trajectory frames ──
  useEffect(() => {
    if (!viewerRef.current) return;

    const resize = () => {
      viewerInstance.current?.resize?.();
      viewerInstance.current?.render?.();
    };

    import("3dmol").then(($3Dmol) => {
      if (!viewerRef.current) return;

      viewerRef.current.innerHTML = "";
      const viewer = $3Dmol.createViewer(viewerRef.current, {
        backgroundColor: "#FBFAF7",
      });
      viewerInstance.current = viewer;

      // Load all frames at once — 3Dmol manages frame switching internally
      viewer.addModelsAsFrames(xyzDataRef.current, "xyz");

      viewer.setStyle(
        {},
        { stick: { radius: 0.2 }, sphere: { scale: 0.25 } }
      );
      viewer.enableFog(false);
      viewer.zoomTo();
      viewer.render();

      // Responsive resize
      resizeObserverRef.current = new ResizeObserver(resize);
      resizeObserverRef.current.observe(viewerRef.current);

      setViewerReady(true);
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      viewerInstance.current?.clear?.();
    };
  }, []);

  // ── Sync 3Dmol frame when currentFrame changes ──
  useEffect(() => {
    if (!viewerReady || !viewerInstance.current) return;
    viewerInstance.current.setFrame(currentFrame);
    viewerInstance.current.render();
  }, [currentFrame, viewerReady]);

  // ── Animation loop (driven by requestAnimationFrame for smooth playback) ──
  useEffect(() => {
    if (!playing) return;

    const speed = SPEEDS[speedIdx];
    const interval = BASE_INTERVAL_MS / speed;

    const tick = (timestamp: number) => {
      if (timestamp - lastTickRef.current >= interval) {
        lastTickRef.current = timestamp;
        setCurrentFrame((prev) => {
          const next = prev + 1;
          // Stop at last frame
          if (next >= totalFrames) {
            setPlaying(false);
            return totalFrames - 1;
          }
          return next;
        });
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    lastTickRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playing, speedIdx, totalFrames]);

  // ── Playback controls ──
  const togglePlay = useCallback(() => {
    // If at end, restart from beginning
    if (currentFrame >= totalFrames - 1 && !playing) {
      setCurrentFrame(0);
    }
    setPlaying((p) => !p);
  }, [currentFrame, totalFrames, playing]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setCurrentFrame((p) => Math.min(p + 1, totalFrames - 1));
  }, [totalFrames]);

  const stepBackward = useCallback(() => {
    setPlaying(false);
    setCurrentFrame((p) => Math.max(p - 1, 0));
  }, []);

  const reset = useCallback(() => {
    setPlaying(false);
    setCurrentFrame(0);
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (fullscreen) {
      document.exitFullscreen?.();
    } else {
      containerRef.current.requestFullscreen?.();
    }
  }, [fullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setFullscreen(isFs);
      setTimeout(() => {
        viewerInstance.current?.resize?.();
        viewerInstance.current?.render?.();
      }, 100);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Derived display values ──
  const speed = SPEEDS[speedIdx];

  // Plot total energy where it exists, with potential alongside it for
  // contrast — on a real 20-step NVE run of ethanol the potential swings
  // 161 meV while the total holds to 6 meV, which is the whole point of
  // showing both. Kinetic energy is deliberately not a series here: it is
  // O(0.1 eV) against totals of O(10³ eV) and would be a flat line on this
  // axis. It is in the readout and in the Summary tab's energy budget.
  const energySeries = [
    ...(hasTotal
      ? [
          {
            label: "Total (potential + kinetic)",
            values: totalEnergies,
            color: DATA_COLORS.blue,
          },
        ]
      : []),
    {
      label: "Potential",
      values: potentialEnergies,
      color: hasTotal ? DATA_COLORS.purple : DATA_COLORS.blue,
      dashed: hasTotal,
      fill: !hasTotal,
    },
  ];

  return (
    <div
      ref={containerRef}
      className={`${fullscreen ? "flex h-screen w-screen flex-col bg-[var(--color-bg-primary)]" : "space-y-4"}`}
    >
      {/* ── 3D Viewer ── */}
      <div
        className={`relative overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] shadow-inner ${
          fullscreen ? "flex-1 rounded-none border-0" : ""
        }`}
      >
        <div
          ref={viewerRef}
          className="w-full"
          style={{
            position: "relative",
            height: fullscreen ? "100%" : 380,
            minHeight: fullscreen ? "100%" : 380,
          }}
        />
        {/* Loading overlay */}
        {!viewerReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-secondary)]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border-subtle)] border-t-[var(--color-accent-primary)]" />
          </div>
        )}

        {/* Top-right overlay: frame badge + fullscreen toggle */}
        {viewerReady && (
          <div className="absolute right-3 top-3 flex items-center gap-2">
            <div className="rounded bg-[var(--color-bg-elevated)]/70 px-2 py-1 font-mono text-xs text-[var(--color-accent-strong)] backdrop-blur-sm">
              Frame {currentFrame + 1}/{totalFrames}
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-bg-elevated)]/70 text-[var(--color-text-muted)] backdrop-blur-sm transition-colors hover:text-[var(--color-accent-strong)]"
            >
              {fullscreen ? (
                <Minimize className="h-3.5 w-3.5" />
              ) : (
                <Maximize className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        )}

        {/* Fullscreen: bottom transport bar overlay */}
        {fullscreen && viewerReady && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 bg-gradient-to-t from-[var(--color-bg-elevated)]/90 to-transparent px-4 pb-4 pt-10">
            <div className="flex items-center gap-1">
              <ControlButton onClick={reset} title="Reset to first frame">
                <RotateCcw className="h-3.5 w-3.5" />
              </ControlButton>
              <ControlButton onClick={stepBackward} title="Previous frame">
                <SkipBack className="h-3.5 w-3.5" />
              </ControlButton>
              <button
                onClick={togglePlay}
                title={playing ? "Pause" : "Play"}
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                  playing
                    ? "border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                    : "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-strong)] hover:bg-[var(--color-accent-primary)]/20"
                }`}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <ControlButton onClick={stepForward} title="Next frame">
                <SkipForward className="h-3.5 w-3.5" />
              </ControlButton>
              <ControlButton onClick={cycleSpeed} title={`Speed: ${speed}×`}>
                <Gauge className="h-3.5 w-3.5" />
              </ControlButton>
            </div>
            <span className="rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
              {speed}×
            </span>
            <input
              type="range"
              min={0}
              max={totalFrames - 1}
              value={currentFrame}
              onChange={(e) => {
                setPlaying(false);
                setCurrentFrame(Number(e.target.value));
              }}
              className="flex-1 accent-[var(--color-accent-primary)]"
              title={`Frame ${currentFrame + 1}`}
            />
            <FrameReadout
              potential={potentialEnergies[currentFrame]}
              total={totalEnergies[currentFrame]}
              kinetic={kineticEnergies[currentFrame]}
              temperature={temperatures[currentFrame]}
            />
          </div>
        )}
      </div>

      {/* ── Normal mode: Transport Controls ── */}
      {!fullscreen && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <ControlButton onClick={reset} title="Reset to first frame">
              <RotateCcw className="h-3.5 w-3.5" />
            </ControlButton>
            <ControlButton onClick={stepBackward} title="Previous frame">
              <SkipBack className="h-3.5 w-3.5" />
            </ControlButton>
            <button
              onClick={togglePlay}
              title={playing ? "Pause" : "Play"}
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                playing
                  ? "border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-strong)] hover:bg-[var(--color-accent-primary)]/20"
              }`}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <ControlButton onClick={stepForward} title="Next frame">
              <SkipForward className="h-3.5 w-3.5" />
            </ControlButton>
            <ControlButton onClick={cycleSpeed} title={`Speed: ${speed}×`}>
              <Gauge className="h-3.5 w-3.5" />
            </ControlButton>
          </div>
          <span className="rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
            {speed}×
          </span>
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => {
              setPlaying(false);
              setCurrentFrame(Number(e.target.value));
            }}
            className="flex-1 accent-[var(--color-accent-primary)]"
            title={`Frame ${currentFrame + 1}`}
          />
          <FrameReadout
            potential={potentialEnergies[currentFrame]}
            total={totalEnergies[currentFrame]}
            kinetic={kineticEnergies[currentFrame]}
            temperature={temperatures[currentFrame]}
          />
        </div>
      )}

      {/* ── Energy vs Step Chart (hidden in fullscreen) ── */}
      {!fullscreen && (
        <div className="space-y-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-[var(--color-accent-strong)]">
              Energy vs. MD Step
            </h4>
            <EnergyChart
              series={energySeries}
              steps={steps}
              currentFrame={currentFrame}
              onFrameSelect={(i) => {
                setPlaying(false);
                setCurrentFrame(i);
              }}
              yLabel="Energy (eV)"
              unit="eV"
              decimals={3}
            />
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              {hasTotal
                ? "Total energy (potential + kinetic) is what NVE conserves — judge conservation on the solid line. Potential energy alone is not conserved under any ensemble."
                : "Only potential energy was recorded for this trajectory, so energy conservation cannot be checked here. Re-run the calculation to record kinetic and total energy per frame."}
            </p>
          </div>

          {temperatures.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-[var(--color-accent-strong)]">
                Temperature vs. MD Step
              </h4>
              <EnergyChart
                series={[
                  {
                    label: "Temperature",
                    values: temperatures,
                    color: DATA_COLORS.red,
                    fill: true,
                  },
                ]}
                steps={steps}
                currentFrame={currentFrame}
                onFrameSelect={(i) => {
                  setPlaying(false);
                  setCurrentFrame(i);
                }}
                yLabel="Temperature (K)"
                unit="K"
                decimals={0}
              />
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                Under NVT this should fluctuate around the target temperature
                {targetTemperature != null ? ` (${targetTemperature} K)` : ""}
                ; under NVE it is unconstrained and free to drift.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Footer (hidden in fullscreen) ── */}
      {!fullscreen && (
        <p className="font-mono text-xs text-[var(--color-text-muted)]">
          Drag to rotate · Scroll to zoom · Click chart to jump to frame ·
          Keyboard: Space = play/pause
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame readout — the per-frame numbers, each named
// ---------------------------------------------------------------------------

/**
 * Every quantity is labelled (`E_tot`, `E_pot`, `E_kin`, `T`). The bare
 * "E = …" this replaced was the potential energy shown next to a chart
 * captioned "total energy", which is the kind of thing that turns into a
 * wrong conclusion in someone's notebook.
 */
function FrameReadout({
  potential,
  total,
  kinetic,
  temperature,
}: {
  potential?: number;
  total?: number;
  kinetic?: number;
  temperature?: number;
}) {
  return (
    <div className="shrink-0 text-right font-mono text-xs leading-tight">
      {total != null && (
        <div>
          <span className="text-[var(--color-text-muted)]">E_tot = </span>
          <span className="text-[var(--color-text-primary)]">
            {total.toFixed(4)}
          </span>
          <span className="text-[var(--color-text-muted)]"> eV</span>
        </div>
      )}
      {potential != null && (
        <div>
          <span className="text-[var(--color-text-muted)]">E_pot = </span>
          <span
            className={
              total != null
                ? "text-[var(--color-text-secondary)]"
                : "text-[var(--color-text-primary)]"
            }
          >
            {potential.toFixed(4)}
          </span>
          <span className="text-[var(--color-text-muted)]"> eV</span>
        </div>
      )}
      {kinetic != null && (
        <div>
          <span className="text-[var(--color-text-muted)]">E_kin = </span>
          <span className="text-[var(--color-text-secondary)]">
            {kinetic.toFixed(4)}
          </span>
          <span className="text-[var(--color-text-muted)]"> eV</span>
        </div>
      )}
      {temperature != null && (
        <div>
          <span className="text-[var(--color-text-muted)]">T = </span>
          <span className="text-[var(--color-text-secondary)]">
            {temperature.toFixed(0)}
          </span>
          <span className="text-[var(--color-text-muted)]"> K</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Control Button — small square toolbar button
// ---------------------------------------------------------------------------

function ControlButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent-primary)]/60 hover:text-[var(--color-accent-strong)]"
    >
      {children}
    </button>
  );
}
