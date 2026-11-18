// Estimación antes de producir (costo, minutos y preguntas) y el campo «Tope para este video».
// La estimación es cálculo puro en el servidor (historial o referencia por modo): no llama a la IA.
// La usan StartCard (reel/clase), EditStage (talking) y el medidor de costo de la barra de progreso.
import { useEffect, useState } from "react";
import type { ProductionEstimate, ProjectKind } from "../../../../shared/types.ts";
import { api } from "../../api.ts";
import { cn } from "@/lib/utils.ts";

/** 2.5 → «US$2.5»; 15 → «US$15»; 2.437 → «US$2.44» (cifras cortas para estimados y topes). */
export const usdShort = (n: number | null | undefined): string => {
  const v = Math.max(0, n || 0);
  return `US$${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")}`;
};

/** GET /production/estimate. Si el servidor aún no lo ofrece o falla, queda en null y la interfaz lo omite. */
export function useEstimate(pid: string, mode?: ProjectKind | null, enabled = true): ProductionEstimate | null {
  const [est, setEst] = useState<ProductionEstimate | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const q = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    api<ProductionEstimate>(`/api/projects/${pid}/production/estimate${q}`)
      .then((r) => { if (alive && r && typeof r.typicalUsd === "number") setEst(r); })
      .catch(() => { if (alive) setEst(null); });
    return () => { alive = false; };
  }, [pid, mode, enabled]);
  return est;
}

/** «≈ US$a–b · unos N min · te hará como máximo Q preguntas». */
export function EstimateLine({ est, className }: { est: ProductionEstimate | null; className?: string }) {
  if (!est) return null;
  const range = est.lowUsd === est.highUsd ? usdShort(est.typicalUsd) : `${usdShort(est.lowUsd)}–${usdShort(est.highUsd)}`;
  const mins = Math.max(1, Math.round(est.minutes));
  const qs = est.maxQuestionRounds === 1
    ? `te hará como máximo 1 ronda de hasta ${Math.max(1, est.maxQuestions)} preguntas`
    : est.maxQuestions > 0 ? `te hará como máximo ${est.maxQuestions} preguntas` : "no te hará preguntas";
  const basis = est.basis === "historial"
    ? `Según ${est.samples} ${est.samples === 1 ? "video anterior" : "videos anteriores"} de este tipo.`
    : "Estimación de referencia: se ajusta con tus videos terminados.";
  return (
    <p className={cn("m-0 text-[13px] text-muted-foreground tabular-nums", className)} title={basis}>
      <span className="font-medium text-foreground">≈ {range}</span> · unos {mins} min · {qs}
      <span className="sr-only"> ({basis})</span>
    </p>
  );
}

/** Texto del campo → número (≥ 0) o undefined si está vacío o no es válido (el servidor usa el de Ajustes). */
export const parseCap = (v: string): number | undefined => {
  const t = v.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
};
/** true si el campo tiene texto que no es un tope válido (hay que corregirlo antes de iniciar, no se descarta en silencio). */
export const capInvalid = (v: string): boolean => v.trim() !== "" && parseCap(v) === undefined;

/**
 * Valor del campo de tope: se rellena con el tope de la producción (si ya tenía uno) o con el de Ajustes
 * que trae la estimación, mientras el usuario no lo haya tocado.
 */
export function useCapValue(est: ProductionEstimate | null, current?: number): [string, (v: string) => void] {
  const [val, setVal] = useState("");
  const [touched, setTouched] = useState(false);
  const fill = current && current > 0 ? current : est?.capUsd;
  useEffect(() => { if (!touched && typeof fill === "number") setVal(String(fill)); }, [fill, touched]);
  return [val, (v: string) => { setTouched(true); setVal(v); }];
}

export function CapField({ id, value, onChange, disabled, className, defaultCap }: {
  id: string; value: string; onChange: (v: string) => void; disabled?: boolean; className?: string;
  /** tope de Ajustes (maxCostPerVideo, viene en la estimación): el servidor lo usa con el campo vacío o en 0 */
  defaultCap?: number;
}) {
  const invalid = capInvalid(value);
  // 0 o vacío = el tope de Ajustes (así lo interpreta el servidor); solo Ajustes en 0 deja sin tope
  const fallback = typeof defaultCap === "number" ? (defaultCap > 0 ? ` (${usdShort(defaultCap)})` : " (hoy sin tope)") : "";
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="m-0! text-[13px]! font-medium! text-foreground!">Tope para este video (US$)</label>
      <input
        id={id}
        type="number"
        min="0"
        step="0.5"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-[160px] rounded-lg border border-border bg-surface-2 px-3 py-2 text-[14px] text-foreground tabular-nums outline-none transition-colors focus-visible:border-blue focus-visible:ring-[3px] focus-visible:ring-blue/30 disabled:opacity-60"
      />
      <span id={`${id}-help`} className="text-[12px] text-muted-foreground">
        {invalid ? "Escribe un número igual o mayor que 0." : `El productor se pausa y te pregunta antes de pasarlo. Vacío o 0 = el tope de Ajustes${fallback}.`}
      </span>
    </div>
  );
}
