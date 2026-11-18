// Barra de etapas del productor con ETA (estilo OpusClip) y medidor de costo con tope.
// El servidor manda las etapas, la actual, desde cuándo corre el reloj (runningSince), los tiempos típicos (typicalMs)
// y el ETA (etaMs); aquí se recalcula localmente cada 15 s entre actualizaciones. El reloj se pausa mientras espera al usuario.
import { useEffect, useRef, useState } from "react";
import type { Production, ProductionStatus } from "../../../../shared/types.ts";
import { cn } from "@/lib/utils.ts";
import { money } from "../../ui.tsx";
import { usdShort } from "./Estimate.tsx";

const TICK_MS = 15_000;
const MIN = 60_000;

// Brillo que recorre el segmento actual; sin animación si el sistema pide movimiento reducido.
const SEG_CSS = `
@media (prefers-reduced-motion: no-preference){
  .prog-seg-live{background-image:linear-gradient(90deg,transparent 0%,color-mix(in oklab,white 45%,transparent) 50%,transparent 100%);background-size:200% 100%;background-repeat:no-repeat;animation:prog-seg 1.8s linear infinite}
}
@keyframes prog-seg{from{background-position:150% 0}to{background-position:-50% 0}}
`;

/** 8 min · 1 h 05 min · menos de 1 min */
function fmtMin(ms: number): string {
  if (ms < MIN) return "menos de 1 min";
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
}

/** Hora actual que se refresca cada 15 s mientras `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(iv);
  }, [active]);
  return now;
}

/** Costo mostrado: lo contabilizado + lo provisional del turno en curso. */
export function spentOf(prod: Production | null | undefined): { spent: number; live: boolean } {
  const live = Math.max(0, prod?.liveUsd || 0);
  return { spent: (prod?.costUsd || 0) + live, live: live > 0 };
}

export function ProgressBar({ prod, status, defaultCapUsd }: {
  prod: Production; status: ProductionStatus;
  /** tope de Ajustes (maxCostPerVideo) cuando la producción no tiene uno propio */
  defaultCapUsd?: number;
}) {
  const pg = prod.progress;
  const stages = pg?.stages || [];
  const current = pg?.current ?? -1;
  const ticking = status === "running" && !!pg?.runningSince;
  const now = useNow(ticking);

  // Región viva: anuncia solo los cambios de etapa (no cada tic del reloj).
  const [announce, setAnnounce] = useState("");
  const prevStage = useRef<number | null>(null);
  useEffect(() => {
    if (prevStage.current !== null && prevStage.current !== current && current >= 0 && stages[current]) {
      setAnnounce(`Etapa ${current + 1} de ${stages.length}: ${stages[current].label}`);
    }
    prevStage.current = current;
  }, [current, stages]);

  if (!pg || !stages.length || (current < 0 && status !== "running")) return null;

  const finished = status === "done" && current === stages.length - 1;
  const doneCount = finished ? stages.length : stages.filter((s, i) => i < current || (i !== current && !!s.endedAt)).length;
  const cur = current >= 0 ? stages[current] : null;

  // Tiempo activo: etapas cerradas + lo contado en la actual + lo que corre desde runningSince.
  const runMs = pg.runningSince ? Math.max(0, now - new Date(pg.runningSince).getTime()) : 0;
  const elapsedMs = stages.reduce((a, s, i) => a + (i === current ? 0 : s.activeMs || 0), 0) + (pg.currentActiveMs || 0) + (isNaN(runMs) ? 0 : runMs);

  // ETA local con los tiempos típicos del servidor: lo que le queda a la etapa actual (al menos 1 min mientras no
  // termine) + las etapas futuras. Así una etapa que se alarga no se «come» las que faltan. Sin typicalMs se usa
  // el etaMs del servidor menos lo que corrió desde runningSince.
  const run = ticking && !isNaN(runMs) ? runMs : 0;
  const typ = pg.typicalMs;
  let left: number | null = null;
  let overLast = false; // la última etapa ya pasó su tiempo típico
  if (cur && typ && stages.every((s) => typeof typ[s.key] === "number")) {
    const curElapsed = (pg.currentActiveMs || 0) + run;
    const curTyp = typ[cur.key] as number;
    left = (cur.endedAt ? 0 : Math.max(curTyp - curElapsed, MIN)) + stages.slice(current + 1).reduce((a, s) => a + (typ[s.key] as number), 0);
    overLast = current === stages.length - 1 && curElapsed >= curTyp;
  } else if (typeof pg.etaMs === "number") {
    left = pg.etaMs - run;
    overLast = left <= 0;
  }
  let eta = "";
  let etaWords = "";
  if (status === "running") {
    if (left !== null) {
      if (overLast) { eta = "Casi listo…"; etaWords = "casi listo"; }
      else { eta = `Faltan ≈ ${fmtMin(left)}`; etaWords = left < MIN ? "falta menos de 1 minuto" : `faltan unos ${Math.round(left / MIN)} minutos`; }
    } else { eta = "Calculando…"; etaWords = "calculando el tiempo restante"; }
  } else if (status === "waiting") { eta = "Esperando tu respuesta · el reloj está en pausa"; etaWords = "esperando tu respuesta"; }
  // «Listo» solo con la producción terminada en la última etapa; un turno que acaba a mitad del camino queda en pausa
  else if (status === "done") { if (finished) { eta = "Listo"; etaWords = "listo"; } else { eta = "En pausa · escribe para continuar"; etaWords = "en pausa, escribe para continuar"; } }
  else if (status === "error") { eta = "En pausa"; etaWords = "en pausa"; }

  const stageText = cur ? `Etapa ${current + 1} de ${stages.length} · ${cur.label}` : "Preparando…";
  const valueText = cur ? `Etapa ${current + 1} de ${stages.length}: ${cur.label}${etaWords ? `, ${etaWords}` : ""}` : "Preparando";

  return (
    <section aria-label="Progreso de la producción" className="grid gap-2.5 rounded-xl border border-border bg-surface-1 px-4 py-3">
      <style>{SEG_CSS}</style>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
        <span className="min-w-0 font-medium sm:hidden">{stageText}</span>
        <span className="hidden min-w-0 font-medium sm:inline">{cur ? cur.label : "Preparando…"}</span>
        <span className="text-muted-foreground tabular-nums">Llevas {fmtMin(elapsedMs)}</span>
        <span className={cn("ml-auto text-right tabular-nums", status === "waiting" ? "text-warning" : "text-muted-foreground")}>{eta}</span>
      </div>

      <div
        role="progressbar"
        aria-label="Etapas de la producción"
        aria-valuemin={0}
        aria-valuemax={stages.length}
        aria-valuenow={doneCount}
        aria-valuetext={valueText}
        className="flex gap-1"
      >
        {stages.map((s, i) => {
          const done = finished || i < current || (i !== current && !!s.endedAt);
          const isCur = !finished && i === current;
          return (
            <span
              key={s.key}
              className={cn(
                "h-1.5 min-w-0 flex-1 rounded-full",
                done ? "bg-blue" : isCur ? (status === "running" ? "prog-seg-live bg-blue" : "bg-blue/50") : "bg-surface-3",
              )}
            />
          );
        })}
      </div>
      <ol className="m-0 hidden list-none gap-1 p-0 sm:flex" aria-hidden>
        {stages.map((s, i) => (
          <li
            key={s.key}
            className={cn(
              "min-w-0 flex-1 truncate text-[11px]",
              !finished && i === current ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {s.label}
          </li>
        ))}
      </ol>
      <span className="sr-only" aria-live="polite">{announce}</span>

      <CostMeter prod={prod} status={status} defaultCapUsd={defaultCapUsd} />
    </section>
  );
}

/** «≈ US$2.40 de US$15 de tope» con una barra fina; ámbar desde el 80 %. */
export function CostMeter({ prod, status, defaultCapUsd }: { prod: Production; status: ProductionStatus; defaultCapUsd?: number }) {
  const { spent, live } = spentOf(prod);
  const cap = prod.capUsd && prod.capUsd > 0 ? prod.capUsd : defaultCapUsd && defaultCapUsd > 0 ? defaultCapUsd : 0;
  const ratio = cap > 0 ? spent / cap : 0;
  const warn = cap > 0 && ratio >= 0.8;
  const approx = live && status === "running";
  return (
    <div className="grid gap-1.5 border-t border-border pt-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground tabular-nums">
        <span>Costo</span>
        <b className={cn("font-medium", warn ? "text-warning" : "text-foreground")}>{approx ? "≈ " : ""}US{money(spent)}</b>
        {cap > 0 ? <span>de {usdShort(cap)} de tope</span> : <span>· sin tope</span>}
        {warn ? <span className="text-warning">· {ratio >= 1 ? "llegaste al tope" : "cerca del tope"}</span> : null}
      </div>
      {cap > 0 ? (
        <div
          className="h-1 overflow-hidden rounded-full bg-surface-3"
          role="meter"
          aria-label="Gasto frente al tope"
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={Math.min(spent, cap)}
          aria-valuetext={`US${money(spent)} de ${usdShort(cap)}`}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", warn ? "bg-warning" : "bg-ink-faint")}
            style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
