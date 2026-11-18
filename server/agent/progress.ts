// Progreso del productor (barra de etapas con ETA, estilo OpusClip): etapas fijas por modo, reloj que se pausa
// mientras se espera al usuario, ETA con la mediana de producciones anteriores e inferencia de etapa por herramientas.
// Las funciones de etapas y reloj son puras sobre ProductionProgress (reciben `now` en ms); el historial vive en el kv
// "progressStats" de SQLite ({ [modo]: { [etapa]: ms[] } }, últimas 12 muestras por etapa).
import { kvGet, kvSet } from "../db.ts";
import type { ProductionMode } from "./prompt.ts";
import type { ProductionProgress, ProgressStage, ProgressStageKey } from "../../shared/types.ts";

/** Rondas de preguntas (ask_user) permitidas por modo; cada ronda trae como máximo QUESTIONS_PER_ROUND preguntas. */
export const MAX_QUESTION_ROUNDS: Record<ProductionMode, number> = { talking: 1, reel: 2, clase: 2 };
export const QUESTIONS_PER_ROUND = 3;

/** Todas las claves de etapa (para el esquema de la herramienta progress). */
export const STAGE_KEYS: ProgressStageKey[] = ["preparacion", "brief", "estilo", "propuesta", "audio", "construccion", "revision", "render"];

// En reel/clase la música va ANTES del shotlist, como en el método del prompt («grilla de beats y música → shotlist y
// APROBACIÓN»): con el orden al revés, el primer audio_music saltaba el Shotlist y su aprobación ya no movía la barra.
const ORDER: Record<ProductionMode, [ProgressStageKey, string][]> = {
  talking: [["preparacion", "Preparación"], ["propuesta", "Propuesta visual"], ["audio", "Audio y música"], ["construccion", "Construcción"], ["revision", "Revisión"], ["render", "Video final"]],
  reel: [["brief", "Brief"], ["estilo", "Marca y estilo"], ["audio", "Música y voz"], ["propuesta", "Shotlist"], ["construccion", "Construcción"], ["revision", "Crítica y pulido"], ["render", "Video final"]],
  clase: [["brief", "Brief"], ["estilo", "Marca y estilo"], ["audio", "Música y voz"], ["propuesta", "Shotlist"], ["construccion", "Construcción"], ["revision", "Crítica y pulido"], ["render", "Video final"]],
};

/** Minutos activos típicos por etapa cuando todavía no hay historial. */
export const DEFAULT_TYPICAL_MIN: Record<ProgressStageKey, number> = { preparacion: 2, brief: 4, estilo: 3, propuesta: 4, audio: 4, construccion: 12, revision: 6, render: 4 };

const MIN_SAMPLE_MS = 30_000; // etapas más cortas no cuentan como muestra (saltos o etapas casi vacías)
const MAX_SAMPLES = 12;
const STATS_KEY = "progressStats";
/** si la etapa actual ya pasó su tiempo típico, se le reserva al menos esto mientras no termine */
const MIN_REMAINING_MS = 60_000;

/** Lista ordenada de etapas del modo (nuevas, sin tiempos). */
export function stagesFor(mode: ProductionMode): ProgressStage[] {
  return (ORDER[mode] || ORDER.talking).map(([key, label]) => ({ key, label }));
}

/** Etiqueta de una etapa en ese modo (o la clave si no existe en el modo). */
export function stageLabel(mode: ProductionMode, key: ProgressStageKey): string {
  return (ORDER[mode] || ORDER.talking).find(([k]) => k === key)?.[1] || key;
}

/** Progreso nuevo para el modo (antes de la primera etapa). */
export function initProgress(mode: ProductionMode): ProductionProgress {
  return { stages: stagesFor(mode), current: -1, runningSince: null, currentActiveMs: 0, etaMs: null, typicalMs: typicalMs(mode) };
}

/** true si el progreso guardado tiene exactamente las etapas del modo (si no, hay que reiniciarlo). */
export function sameStages(pr: ProductionProgress | null | undefined, mode: ProductionMode): boolean {
  const want = stagesFor(mode);
  return Boolean(pr && Array.isArray(pr.stages) && pr.stages.length === want.length && pr.stages.every((s, i) => s.key === want[i].key));
}

const iso = (now: number): string => new Date(now).toISOString();

/** ms contados en la etapa actual hasta `now` (lo acumulado + lo que corre desde runningSince). */
export function elapsedCurrent(pr: ProductionProgress, now: number): number {
  const since = pr.runningSince ? Date.parse(pr.runningSince) : NaN;
  return Math.max(0, (pr.currentActiveMs || 0) + (Number.isFinite(since) ? Math.max(0, now - since) : 0));
}

/**
 * Avanza a la etapa `key` (solo hacia adelante: una etapa anterior o la misma se ignora). Cierra la etapa actual
 * (endedAt, activeMs) y marca las saltadas como terminadas con 0 ms. `onClose` recibe cada etapa cerrada con su tiempo
 * (para el historial). El reloj de la etapa nueva corre si el de la anterior corría (o si es la primera).
 * Devuelve true si cambió de etapa.
 */
export function startStage(pr: ProductionProgress, key: ProgressStageKey, now: number, onClose?: (key: ProgressStageKey, ms: number) => void): boolean {
  const idx = pr.stages.findIndex((s) => s.key === key);
  if (idx < 0 || idx <= pr.current) return false;
  const at = iso(now);
  const wasRunning = pr.current < 0 || Boolean(pr.runningSince);
  if (pr.current >= 0) {
    const cur = pr.stages[pr.current];
    const ms = elapsedCurrent(pr, now);
    const already = Boolean(cur.endedAt);
    cur.activeMs = ms;
    cur.endedAt = at;
    if (!already) onClose?.(cur.key, ms);
  }
  for (let i = Math.max(0, pr.current + 1); i < idx; i++) {
    const s = pr.stages[i];
    s.startedAt = s.startedAt || at;
    s.endedAt = at;
    s.activeMs = 0;
  }
  const next = pr.stages[idx];
  next.startedAt = at;
  delete next.endedAt;
  delete next.activeMs;
  pr.current = idx;
  pr.currentActiveMs = 0;
  pr.runningSince = wasRunning ? at : null;
  return true;
}

/** Pausa el reloj (esperando al usuario o turno terminado): lo corrido pasa a currentActiveMs. */
export function pauseClock(pr: ProductionProgress, now: number): boolean {
  if (!pr.runningSince) return false;
  pr.currentActiveMs = elapsedCurrent(pr, now);
  pr.runningSince = null;
  return true;
}

/** Reanuda el reloj de la etapa actual (si hay una). Una etapa final cerrada que vuelve a trabajar se reabre. */
export function resumeClock(pr: ProductionProgress, now: number): boolean {
  if (pr.current < 0 || pr.runningSince) return false;
  const cur = pr.stages[pr.current];
  if (cur?.endedAt) { delete cur.endedAt; pr.currentActiveMs = cur.activeMs || pr.currentActiveMs || 0; delete cur.activeMs; }
  pr.runningSince = iso(now);
  return true;
}

/**
 * Cierra la etapa actual sin avanzar (al terminar la producción en la última etapa): guarda su tiempo y lo pasa
 * a `onClose` una sola vez. El reloj queda en pausa.
 */
export function closeCurrent(pr: ProductionProgress, now: number, onClose?: (key: ProgressStageKey, ms: number) => void): boolean {
  if (pr.current < 0) return false;
  const cur = pr.stages[pr.current];
  if (cur.endedAt) return false;
  const ms = elapsedCurrent(pr, now);
  pr.currentActiveMs = ms;
  pr.runningSince = null;
  cur.activeMs = ms;
  cur.endedAt = iso(now);
  onClose?.(cur.key, ms);
  return true;
}

// ---------------------------------------------------------------- historial (kv progressStats)
type Stats = Partial<Record<ProductionMode, Partial<Record<ProgressStageKey, number[]>>>>;

function readStats(): Stats {
  try {
    const s = kvGet<Stats>(STATS_KEY);
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  } catch { return {}; }
}

/** Guarda una muestra de tiempo activo de una etapa (solo si duró ≥ 30 s); conserva las últimas 12 por etapa. */
export function recordSample(mode: ProductionMode, key: ProgressStageKey, ms: number): void {
  if (!(ms >= MIN_SAMPLE_MS) || !Number.isFinite(ms)) return;
  const stats = readStats();
  const byMode = (stats[mode] = { ...(stats[mode] || {}) });
  const list = [...(byMode[key] || []).filter((x) => Number.isFinite(x)), Math.round(ms)];
  byMode[key] = list.slice(-MAX_SAMPLES);
  try { kvSet(STATS_KEY, stats); } catch {}
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** ms activos típicos por etapa del modo: mediana del historial o el valor por defecto. */
export function typicalMs(mode: ProductionMode): Partial<Record<ProgressStageKey, number>> {
  const hist = readStats()[mode] || {};
  const out: Partial<Record<ProgressStageKey, number>> = {};
  for (const s of stagesFor(mode)) {
    const xs = (hist[s.key] || []).filter((x) => Number.isFinite(x) && x > 0);
    out[s.key] = xs.length ? Math.round(median(xs)) : DEFAULT_TYPICAL_MIN[s.key] * 60_000;
  }
  return out;
}

/**
 * ms activos que faltan: lo que le queda a la etapa actual (al menos 1 min si aún no termina) + las etapas futuras.
 * null si todavía no empezó ninguna etapa.
 */
export function computeEta(pr: ProductionProgress, typical: Partial<Record<ProgressStageKey, number>>, now: number): number | null {
  if (pr.current < 0 || pr.current >= pr.stages.length) return null;
  const typ = (k: ProgressStageKey): number => typical[k] ?? DEFAULT_TYPICAL_MIN[k] * 60_000;
  const cur = pr.stages[pr.current];
  const rest = cur.endedAt ? 0 : Math.max(typ(cur.key) - elapsedCurrent(pr, now), MIN_REMAINING_MS);
  let future = 0;
  for (let i = pr.current + 1; i < pr.stages.length; i++) future += typ(pr.stages[i].key);
  return Math.round(rest + future);
}

/**
 * Recalcula typicalMs y etaMs del progreso (en cada cambio). Con el reloj corriendo, etaMs es lo que faltaba en el
 * instante runningSince: la interfaz descuenta (ahora − runningSince) y así no resta dos veces lo ya corrido.
 */
export function refreshEta(pr: ProductionProgress, mode: ProductionMode, now: number): void {
  pr.typicalMs = typicalMs(mode);
  const since = pr.runningSince ? Date.parse(pr.runningSince) : NaN;
  pr.etaMs = computeEta(pr, pr.typicalMs, Number.isFinite(since) && since <= now ? since : now);
}

// ---------------------------------------------------------------- inferencia por herramientas (si el agente no llama a progress)
/**
 * Etapa que sugiere una herramienta usada por el agente (o null). El runner solo la aplica hacia adelante y solo si
 * la etapa existe en el modo.
 */
export function inferStage(toolName: string, input: Record<string, unknown>): ProgressStageKey | null {
  const s = (k: string): string => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (toolName) {
    case "mcp__studio__request_approval": return s("kind") === "concepto" || s("kind") === "shotlist" ? "propuesta" : null;
    // audio_voices no cuenta: solo lista voces (el agente lo usa en la entrevista para ofrecer opciones de voz)
    case "mcp__studio__audio_music": case "mcp__studio__audio_tts": case "mcp__studio__audio_sfx": return "audio";
    case "mcp__studio__render": return s("mode") === "final" ? "render" : null;
    case "mcp__studio__sheet": case "mcp__studio__render_check": case "mcp__studio__lint": return "revision";
    case "mcp__studio__capture_site": return "estilo";
    case "Task": case "Agent": return /critic/i.test(s("subagent_type")) ? "revision" : null;
    case "Write": case "Edit": case "MultiEdit": {
      const f = s("file_path").replace(/\\/g, "/");
      return /(^|\/)film\//.test(f) ? "construccion" : null;
    }
    default: return null;
  }
}
