// Estimación de costo y tiempo antes de producir (sin llamar a la IA): historial de producciones terminadas del mismo
// modo, reescalado al precio del modelo actual del productor; sin historial suficiente, valores de referencia por modo.
import { load } from "../db.ts";
import { priceFor } from "../ai.ts";
import { modeOf } from "./prompt.ts";
import type { ProductionMode } from "./prompt.ts";
import { MAX_QUESTION_ROUNDS, QUESTIONS_PER_ROUND, typicalMs, median } from "./progress.ts";
import type { Project, ProductionEstimate } from "../../shared/types.ts";

/** Referencia por modo (US$ producidos con REF_MODEL, el productor por defecto): típico, bajo, alto. */
const REFERENCE: Record<ProductionMode, { typical: number; low: number; high: number }> = {
  talking: { typical: 4, low: 2, high: 8 },
  reel: { typical: 12, low: 6, high: 20 },
  clase: { typical: 10, low: 5, high: 18 },
};
/** Modelo con el que se midió la referencia. Su peso sale de la misma tabla de precios que el modelo actual, así con el
 *  productor por defecto la referencia queda tal cual (reel 12, 6–20) y otro modelo se reescala en proporción. */
const REF_MODEL = "claude-opus-5-5";
/** peso de precio si REF_MODEL no tuviera precio: US$5/M de entrada + 5 × US$25/M de salida */
const REF_WEIGHT_FALLBACK = 5 + 25 * 5;
const MIN_SAMPLE_USD = 0.05;

const weightOf = (model: string): number => {
  const p = priceFor(model);
  return (p.in || 0) + (p.out || 0) * 5;
};
const round05 = (x: number): number => Math.max(0.5, Math.round(x * 2) / 2);

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Modelo con más gasto registrado en las filas de producción de un proyecto (o null). */
function modelOfProject(pid: string): string | null {
  const by = new Map<string, number>();
  for (const u of load().usage) if (u.projectId === pid && u.stage === "produccion" && u.model) by.set(u.model, (by.get(u.model) || 0) + (u.cost || 0));
  let best: string | null = null;
  let max = -1;
  for (const [m, c] of by) if (c > max) { max = c; best = m; }
  return best;
}

/** Estimación de costo, minutos y preguntas para producir `p` en `mode`. Cálculo puro sobre datos locales. */
export function estimateProduction(p: Project, mode: ProductionMode): ProductionEstimate {
  const db = load();
  const model = db.settings.producerModel || "claude-opus-5-5";
  const wNow = weightOf(model);
  const samples: number[] = [];
  for (const q of db.projects) {
    const prod = q.production as (Project["production"] & { mode?: ProductionMode }) | null | undefined;
    if (!prod || prod.status !== "done") continue;
    // solo el gasto de la grabación actual (costUsd es el total del proyecto, con las grabaciones anteriores)
    const spent = Math.max(0, (prod.costUsd || 0) - (prod.capBaseUsd || 0));
    if (!(spent > MIN_SAMPLE_USD)) continue;
    if ((prod.mode || modeOf(q)) !== mode) continue;
    const rec = modelOfProject(q.id);
    const wRec = rec ? weightOf(rec) : 0;
    const ratio = wRec > 0 && wNow > 0 ? wNow / wRec : 1;
    samples.push(spent * ratio);
  }
  let typical: number, low: number, high: number;
  const basis: ProductionEstimate["basis"] = samples.length >= 3 ? "historial" : "referencia";
  if (basis === "historial") {
    typical = median(samples);
    low = quantile(samples, 0.25);
    high = Math.max(quantile(samples, 0.75) * 1.3, typical);
  } else {
    const ref = REFERENCE[mode] || REFERENCE.talking;
    const wRef = weightOf(REF_MODEL) || REF_WEIGHT_FALLBACK;
    const scale = wNow > 0 ? wNow / wRef : 1;
    typical = ref.typical * scale; low = ref.low * scale; high = ref.high * scale;
  }
  const typ = typicalMs(mode);
  const minutes = Math.max(1, Math.round(Object.values(typ).reduce((a, b) => a + (b || 0), 0) / 60_000));
  const rounds = MAX_QUESTION_ROUNDS[mode] ?? 1;
  const lowUsd = round05(low);
  const typicalUsd = Math.max(lowUsd, round05(typical));
  return {
    lowUsd,
    highUsd: Math.max(typicalUsd, round05(high)),
    typicalUsd,
    minutes,
    basis,
    samples: samples.length,
    maxQuestionRounds: rounds,
    maxQuestions: rounds * QUESTIONS_PER_ROUND,
    capUsd: Math.max(0, Number(db.settings.maxCostPerVideo) || 0),
  };
}
