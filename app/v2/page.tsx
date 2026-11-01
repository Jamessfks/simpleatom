import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { APP_VERSION } from "@/lib/contract";
import { barText } from "./bars";

// Always re-read the manifest from disk so the page reflects the live run.
export const dynamic = "force-dynamic";

// An internal process dashboard (defect backlog, competitor bars): reachable
// by URL, but it should not be indexed as if it were product documentation.
export const metadata: Metadata = {
  title: "Gauntlet progress",
  robots: { index: false, follow: false },
};

type Piece = {
  id: string;
  name: string;
  bar: string;
  judge: string;
  files: string[];
  status: "pending" | "building" | "judging" | "won" | "blocked";
  rounds: number;
  verdict: string | null;
  gap: string | null;
  blockedBy?: string;
};

type Defect = { sev: string; what: string; where: string };

type Progress = {
  version: string;
  branch: string;
  updated: string;
  bars: { name: string; url: string; role: string; viewerBar?: string; fetchable: string }[];
  pieces: Piece[];
  defectsFixed?: Defect[];
  notes: string[];
};

const SEV_STYLE: Record<string, string> = {
  CRITICAL: "bg-[#F6EEEE] text-[#8A3A3A] border-[#E0BFBF]",
  HIGH: "bg-[#FFF6E5] text-[#8A6A1F] border-[#EBD9AE]",
  MEDIUM: "bg-bg-secondary text-text-secondary border-[#E4DFD3]",
};

const STATUS_STYLE: Record<Piece["status"], string> = {
  pending: "bg-bg-secondary text-text-muted border-[#E4DFD3]",
  building: "bg-[#FFF6E5] text-[#8A6A1F] border-[#EBD9AE]",
  judging: "bg-[#EAF1FB] text-[#2F5C93] border-[#CBDDF2]",
  won: "bg-[#EAF4EB] text-accent-strong border-[#C6E0C8]",
  blocked: "bg-[#F6EEEE] text-[#8A5252] border-[#E4CACA]",
};

export default async function V2ProgressPage() {
  const file = path.join(process.cwd(), "docs/v2/progress.json");
  const data: Progress = JSON.parse(await readFile(file, "utf8"));

  const won = data.pieces.filter((p) => p.status === "won").length;
  const total = data.pieces.length;
  const pct = total ? Math.round((won / total) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-widest text-text-muted">
          {data.branch} · gauntlet loop
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-none text-text-primary">
          SimpleAtom v{APP_VERSION} progress
        </h1>
        <p className="mt-4 max-w-2xl text-text-secondary">
          Each piece runs a builder and a separate critic. A piece is only{" "}
          <span className="text-accent-strong">won</span> when the critic picks ours over the
          bar in a blind comparison — not after a fixed number of rounds.
        </p>

        {/* Overall */}
        <div className="mt-8 rounded-lg border border-[#E4DFD3] bg-white p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-text-primary">
              {won} of {total} pieces winning blind
            </span>
            <span className="font-mono text-sm text-text-muted">{pct}%</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-secondary">
            <div
              className="h-full rounded-full bg-accent-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-3 font-mono text-xs text-text-muted">
            updated {new Date(data.updated).toLocaleString()}
          </p>
          <p className="mt-3 border-t border-bg-secondary pt-3 text-sm text-text-secondary">
            This counter only moves when a critic picks ours over the bar. It is
            deliberately strict and says nothing about the{" "}
            <span className="text-accent-strong">
              {data.defectsFixed?.length ?? 0} scientific defects
            </span>{" "}
            fixed below, which is where most of the work has gone.
          </p>
        </div>

        {/* Defects — the work the piece counter does not capture */}
        {data.defectsFixed && data.defectsFixed.length > 0 && (
          <>
            <h2 className="mt-12 font-serif text-2xl text-text-primary">
              Defects found and fixed
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">
              Found by auditing against the bars rather than by reading the diff.
              Every one of these reviewed as correct code.
            </p>
            <div className="mt-4 space-y-2">
              {data.defectsFixed.map((d) => (
                <div
                  key={d.what}
                  className="flex gap-3 rounded-lg border border-[#E4DFD3] bg-white p-4"
                >
                  <span
                    className={`h-fit shrink-0 rounded border px-2 py-0.5 font-mono text-xs tracking-wide ${
                      SEV_STYLE[d.sev] ?? SEV_STYLE.MEDIUM
                    }`}
                  >
                    {d.sev}
                  </span>
                  <div>
                    <p className="text-sm text-text-primary">{d.what}</p>
                    <p className="mt-1 font-mono text-xs text-text-muted">
                      {d.where}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Bars */}
        <h2 className="mt-12 font-serif text-2xl text-text-primary">The bars</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {data.bars.map((b) => (
            <div key={b.name} className="rounded-lg border border-[#E4DFD3] bg-white p-5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-primary">{b.name}</span>
                <a
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-accent-strong underline underline-offset-2"
                >
                  open
                </a>
              </div>
              <p className="mt-1 text-sm text-text-secondary">{b.role}</p>
              <p className="mt-3 text-xs leading-relaxed text-text-muted">{barText(b)}</p>
            </div>
          ))}
        </div>

        {/* Pieces */}
        <h2 className="mt-12 font-serif text-2xl text-text-primary">Pieces</h2>
        <div className="mt-4 space-y-3">
          {data.pieces.map((p) => (
            <div key={p.id} className="rounded-lg border border-[#E4DFD3] bg-white p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${STATUS_STYLE[p.status]}`}
                >
                  {p.status}
                </span>
                <span className="font-medium text-text-primary">{p.name}</span>
                {p.rounds > 0 && (
                  <span className="font-mono text-xs text-text-muted">
                    round {p.rounds}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-text-secondary">
                <span className="text-text-muted">bar · </span>
                {p.bar}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                <span className="text-text-muted">judged on · </span>
                {p.judge}
              </p>
              {p.gap && (
                <p className="mt-3 border-l-2 border-[#EBD9AE] pl-3 text-sm text-[#8A6A1F]">
                  biggest remaining gap — {p.gap}
                </p>
              )}
              {p.blockedBy && (
                <p className="mt-2 font-mono text-xs text-[#8A5252]">
                  waits on {p.blockedBy} (same file)
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Notes */}
        <h2 className="mt-12 font-serif text-2xl text-text-primary">Scope notes</h2>
        <ul className="mt-4 space-y-2">
          {data.notes.map((n) => (
            <li key={n} className="flex gap-3 text-sm text-text-secondary">
              <span className="text-text-muted">—</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
