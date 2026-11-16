// Tarjeta de exportación: mientras el motor exporta muestra la etapa, el porcentaje y el tiempo que falta;
// cuando hay videos, un selector de formato (9:16 · 1:1 · 4:5 · 16:9) y el reproductor de revisión.
import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { Format, Job, RenderOutput } from "../../../shared/types.ts";
import { VideoPlayer } from "@/components/VideoPlayer.tsx";
import { useElapsed, fmtElapsed } from "@/hooks/use-elapsed.ts";
import { cn } from "@/lib/utils.ts";
import { LOCALE } from "@/lib/locale.ts";

export const FORMAT_LABEL: Record<Format, string> = { "9x16": "9:16", "1x1": "1:1", "4x5": "4:5", "16x9": "16:9" };
export const FORMAT_HINT: Record<Format, string> = { "9x16": "Reels, TikTok, Shorts", "1x1": "Feed cuadrado", "4x5": "Feed vertical", "16x9": "YouTube, web" };
const ASPECT: Record<Format, string> = { "9x16": "9 / 16", "1x1": "1 / 1", "4x5": "4 / 5", "16x9": "16 / 9" };
const ORDER: Format[] = ["9x16", "4x5", "1x1", "16x9"];

/** Ícono con la forma real del formato. */
function FormatShape({ fmt }: { fmt: Format }) {
  const [w, h] = fmt.split("x").map(Number);
  const s = 14 / Math.max(w, h);
  return <span aria-hidden className="inline-block rounded-[2px] border-[1.5px] border-current" style={{ width: Math.round(w * s), height: Math.round(h * s) }} />;
}

/** Selector segmentado de formato (radiogroup). */
export function FormatPicker({ formats, value, onChange, disabled }: { formats: Format[]; value: Format; onChange: (f: Format) => void; disabled?: Format[] }) {
  return (
    <div role="radiogroup" aria-label="Formato" className="inline-flex flex-wrap gap-0.5 rounded-full bg-surface-2 p-[3px]">
      {formats.map((f) => {
        const on = f === value;
        const off = disabled?.includes(f);
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            title={FORMAT_HINT[f]}
            onClick={() => onChange(f)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40",
              on ? "bg-foreground text-black" : "text-muted-foreground enabled:hover:text-foreground",
            )}
          >
            <FormatShape fmt={f} />{FORMAT_LABEL[f]}
          </button>
        );
      })}
    </div>
  );
}

/** Lee "Render 9x16: 62%" / "Render 9x16: listo" del paso del trabajo y lleva el avance por formato. */
function useRenderProgress(job: Job | null | undefined) {
  const per = useRef<Record<string, number>>({});
  const key = job?.startedAt || "";
  const [, force] = useState(0);
  useEffect(() => { per.current = {}; }, [key]);
  useEffect(() => {
    const step = job?.step || "";
    const m = /Render (\d+x\d+): (\d+)%/.exec(step);
    const done = /Render (\d+x\d+): listo/.exec(step);
    if (m) per.current[m[1]] = Number(m[2]);
    if (done) per.current[done[1]] = 100;
    // formatos pedidos: "Render final: 9x16, 4x5, 16x9…" / "Borrador: 9x16…"
    const asked = /(?:Render final|Borrador): ([\dx, ]+)/.exec(step);
    if (asked) for (const f of asked[1].split(",").map((x) => x.trim()).filter(Boolean)) if (!(f in per.current)) per.current[f] = 0;
    force((n) => n + 1);
  }, [job?.step]);
  const vals = Object.values(per.current);
  const pct = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  return { pct, queued: /En cola/.test(job?.step || "") };
}

export interface ExportCardProps {
  job?: Job | null;
  renders: RenderOutput[];
  /** convierte la ruta del render en URL servible */
  urlOf: (r: RenderOutput) => string;
  /** fotos por segundo del video (para el avance cuadro a cuadro) */
  fps?: number;
  className?: string;
}

export function ExportCard({ job, renders, urlOf, fps = 30, className }: ExportCardProps) {
  // el render más reciente de cada formato; si hay final y borrador, el final
  const latest = useMemo(() => {
    const by = new Map<Format, RenderOutput>();
    const sorted = [...renders].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    for (const r of sorted) {
      const cur = by.get(r.fmt);
      if (!cur || (cur.mode === "draft" && r.mode === "final" && (r.at || "") >= (cur.at || ""))) by.set(r.fmt, r);
    }
    return by;
  }, [renders]);
  const formats = ORDER.filter((f) => latest.has(f));
  const [fmt, setFmt] = useState<Format | null>(null);
  const shown: Format | null = fmt && latest.has(fmt) ? fmt : formats[0] || null;
  const r = shown ? latest.get(shown)! : null;

  const running = job?.status === "running";
  const elapsed = useElapsed(job?.startedAt, running);
  const { pct, queued } = useRenderProgress(running ? job : null);
  const eta = running && pct && pct > 3 && pct < 100 ? Math.round((elapsed * (100 - pct)) / pct) : null;

  return (
    <div className={cn("grid gap-4", className)}>
      {running ? (
        <div className="grid gap-2 rounded-xl bg-surface-2 p-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <b className="text-[14px] font-semibold">{queued ? "En cola" : "Exportando"}</b>
            <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
              {pct !== null ? `${pct} %` : "preparando…"}{eta ? ` · faltan ≈ ${fmtElapsed(eta)}` : ""} · {fmtElapsed(elapsed)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="Avance de la exportación">
            <div className={cn("h-full rounded-full bg-blue transition-[width] duration-500", pct === null && "w-1/3 animate-pulse")} style={pct !== null ? { width: `${pct}%` } : undefined} />
          </div>
          <span className="text-[12px] text-muted-foreground">{job?.step}. Te avisamos aunque estés en otra pantalla.</span>
        </div>
      ) : null}

      {r ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FormatPicker formats={formats} value={shown!} onChange={setFmt} />
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className={cn("rounded-full px-2 py-0.5 font-medium", r.mode === "final" ? "bg-success/15 text-success" : "bg-surface-2")}>{r.mode === "final" ? "Final" : "Vista previa"}</span>
              {r.seconds ? <span className="tabular-nums">{r.seconds.toFixed(1)} s</span> : null}
              {r.at ? <span>{new Date(r.at).toLocaleString(LOCALE, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
              <a href={urlOf(r)} download className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 px-2.5 font-medium text-foreground hover:bg-surface-3" aria-label={`Descargar ${FORMAT_LABEL[r.fmt]}`}>
                <Download className="size-3.5" />Descargar
              </a>
            </div>
          </div>
          <div className={cn("mx-auto w-full", r.fmt === "16x9" ? "max-w-[860px]" : r.fmt === "9x16" ? "max-w-[360px]" : "max-w-[460px]")}>
            <VideoPlayer key={urlOf(r)} src={urlOf(r)} aspect={ASPECT[r.fmt]} fps={fps} label={`Video ${FORMAT_LABEL[r.fmt]}`} />
          </div>
        </div>
      ) : !running ? (
        <p className="m-0 text-[13px] text-muted-foreground">Aún no hay videos exportados.</p>
      ) : null}
    </div>
  );
}
