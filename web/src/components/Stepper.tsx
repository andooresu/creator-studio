// Stepper de etapas: siempre se ve en qué paso estás y qué sigue. En pantallas anchas muestra todos los pasos;
// en el teléfono, «Paso 3 de 7 · Guion» con una barra de progreso y los pasos como fila desplazable.
import { useEffect, useRef } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils.ts";

export interface StepItem { id: string; label: string; hint?: string }

export function Stepper({ steps, current, viewing, onSelect, label = "Etapas del proyecto", lockFuture = true }: {
  steps: StepItem[];
  /** índice de la etapa real del proyecto (las anteriores están hechas) */
  current: number;
  /** id del paso que se está mirando (puede ser uno anterior) */
  viewing?: string;
  onSelect?: (id: string) => void;
  label?: string;
  /** los pasos futuros no se pueden abrir */
  lockFuture?: boolean;
}) {
  const curStep = steps[Math.min(current, steps.length - 1)];
  const pct = Math.round((Math.min(current, steps.length) / steps.length) * 100);
  const olRef = useRef<HTMLOListElement>(null);
  const focusRef = useRef<HTMLLIElement>(null);
  // en el teléfono la fila se desplaza en horizontal: centra el paso que se mira (o el actual).
  // Solo toca ol.scrollLeft — scrollIntoView desplazaría también la página en vertical.
  useEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    const center = () => {
      const li = focusRef.current;
      if (!li || ol.scrollWidth <= ol.clientWidth) return;
      const target = li.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2;
      ol.scrollLeft = Math.max(0, Math.min(ol.scrollWidth - ol.clientWidth, target));
    };
    center();
    // el diseño puede asentarse después (la barra lateral decide si es teléfono tras el primer render)
    const ro = new ResizeObserver(center);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [current, viewing, steps.length]);
  return (
    <nav aria-label={label} className="mb-4">
      <div className="mb-2 flex items-baseline justify-between gap-3 md:hidden">
        <span className="text-[13px] text-muted-foreground">Paso {Math.min(current + 1, steps.length)} de {steps.length}</span>
        <b className="text-[14px] font-semibold tracking-[-0.02em]">{curStep?.label}</b>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-2 md:hidden" aria-hidden><div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} /></div>
      <ol ref={olRef} tabIndex={onSelect ? undefined : 0} aria-label={onSelect ? undefined : `${label}: paso ${Math.min(current + 1, steps.length)} de ${steps.length}`} className="relative flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:overflow-visible" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const done = i < current;
          const isCur = i === current;
          const locked = lockFuture && i > current;
          const isView = viewing ? s.id === viewing : isCur;
          return (
            <li key={s.id} ref={isView ? focusRef : undefined} className="min-w-[118px] md:min-w-0">
              <button
                type="button"
                disabled={!onSelect}
                aria-disabled={locked || undefined}
                onClick={() => { if (!locked) onSelect?.(s.id); }}
                aria-current={isCur ? "step" : undefined}
                aria-pressed={isView}
                title={s.hint || s.label}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors",
                  "bg-surface-1 text-muted-foreground enabled:hover:bg-surface-2 disabled:cursor-default aria-disabled:cursor-default aria-disabled:hover:bg-surface-1",
                  done && "text-foreground",
                  isCur && "text-foreground",
                  isView && "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_var(--blue)]",
                  locked && "text-ink-faint",
                )}
              >
                <span className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                  done ? "bg-success text-black" : isCur ? "bg-foreground text-black" : "bg-surface-3 text-muted-foreground",
                )} aria-hidden>
                  {done ? <Check className="size-3" strokeWidth={3} /> : locked ? <Lock className="size-2.5" /> : i + 1}
                </span>
                <span className="truncate">{s.label}</span>
                <span className="sr-only">{done ? " (hecho)" : isCur ? " (paso actual)" : locked ? " (bloqueado)" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
