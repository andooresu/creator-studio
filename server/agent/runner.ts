// Productor: una sesión del SDK de agentes de Claude por proyecto, que produce el video con el motor motion-reel
// como en las sesiones de Claude Code. Los mensajes del SDK se vuelcan a project.production.events; las preguntas
// y aprobaciones quedan en production.pending hasta que la interfaz responde (answerQuestion / decideApproval).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKMessage, SDKUserMessage, SDKResultMessage, CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { load, save, id, getProject, projectDir, APP_DIR, DATA_DIR, MOTION_DIR, PROJECTS_DIR } from "../db.ts";
import { scaffoldMotion, motionEnv, ensureLinks, copyStyle, isScaffolded, repairEngineLibs } from "../motion/kit.ts";
import { mapToCut } from "../editor.ts";
import { createStudioServer, realPrefix } from "./tools.ts";
import type { StudioContext, QuestionAnswers, ApprovalDecision } from "./tools.ts";
import { buildSystemPrompt, buildKickoff, resumeNote, modeOf, AGENT_TMP, parseStartFlags, flagsText, onlyFinalApproval, apoyoSkip } from "./prompt.ts";
import { brandPresetFor } from "./brandPreset.ts";
import type { BrandPreset } from "./brandPreset.ts";
import { getStyle as findStyleById } from "../styles/store.ts";
import { costOf } from "../ai.ts";
import { initProgress, sameStages, startStage, pauseClock, resumeClock, closeCurrent, refreshEta, recordSample, inferStage, stageLabel, MAX_QUESTION_ROUNDS } from "./progress.ts";
const findStyle = (sid: string | null | undefined) => (sid ? findStyleById(sid) ?? null : null);
import type { ProductionMode, StartFlags } from "./prompt.ts";
import type { Apoyo, PendingAction, Production, ProductionBudget, ProductionEvent, ProductionStatus, ProgressStageKey, Project, RenderOutput, UsageRow } from "../../shared/types.ts";

// Campos internos extra que se guardan junto a Production (no forman parte del contrato de la interfaz).
type ProdX = Production & {
  mode?: ProductionMode;
  /** último total acumulado visto en los resultados del SDK, para registrar solo el incremento */
  costSeen?: { session: string; usd: number; tin: number; tout: number; tcr?: number; tcw?: number };
  /** estilo con el que se preparó docs/style/ (para detectar cambios de estilo al reanudar) */
  styleId?: string | null;
  /** opciones de la tarjeta de inicio (marca, música, formatos); las leen el system prompt y las herramientas */
  flags?: StartFlags;
  /** tope (US$) para el que ya se avisó el 80 % (un aviso por valor de tope) */
  capWarned?: number;
  /**
   * costo en vivo de un turno cortado sin resultado (detener, caída, reinicio) que ya se sumó a costUsd. Si el acumulado
   * del SDK de la misma sesión lo trae en el siguiente resultado, account() lo descuenta para no contarlo dos veces.
   */
  provisionalUsd?: number;
  /** la etapa final ya dejó su muestra de tiempo (un seguimiento que la reabre no vuelve a registrarla acumulada) */
  finalSampled?: boolean;
};

const MAX_EVENTS = 500;
const IDLE_CLOSE_MS = 20 * 60_000; // tras terminar un turno, la sesión viva espera mensajes este tiempo y luego se cierra (se reanuda con resume)
const AGENT_HOME = path.join(DATA_DIR, "agent", "claude"); // CLAUDE_CONFIG_DIR propio: aislado de ~/.claude del equipo

// ---------------------------------------------------------------- cola de entrada (modo streaming del SDK)
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  closed = false;
  push(text: string): void {
    if (this.closed) return;
    const msg: SDKUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
    const w = this.waiters.shift();
    if (w) w({ value: msg, done: false });
    else this.items.push(msg);
  }
  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as SDKUserMessage, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const it = this.items.shift();
        if (it) return Promise.resolve({ value: it, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
      return: () => { this.close(); return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true }); },
    };
  }
}

interface Live {
  abort: AbortController;
  q: Query | null;
  input: InputQueue;
  resolvers: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  idle: ReturnType<typeof setTimeout> | null;
  stderr: string;
  stopped: boolean;
  /** ya se mostró un error de la API en este turno (evita repetirlo con el resultado) */
  turnError: boolean;
  /** costo en vivo ya sumado por id de mensaje del turno (el SDK repite el mismo id por cada bloque; se vacía con el resultado) */
  msgCost: Map<string, number>;
  /** tool_use_id → nombre de la herramienta (para atribuir los errores de tool_result) */
  toolNames: Map<string, string>;
  /** tool_use_id → id del mensaje del asistente que la pidió (las llamadas en paralelo de un mismo mensaje son un lote) */
  toolBatch: Map<string, string>;
  /** errores consecutivos por herramienta (se reinician con un resultado sin error o cuando el usuario escribe) */
  errStreak: Map<string, number>;
  /** último lote que ya sumó un fallo a la racha de cada herramienta (un lote en paralelo cuenta una sola vez) */
  errBatch: Map<string, string>;
  /** aún no llegó un resultado con costo de este proceso: el acumulado reanudado puede venir de un cost-state viejo */
  fresh: boolean;
  /** errores de herramientas en el turno actual (se reinicia con el resultado) */
  turnErrors: number;
  /** se interrumpió el turno por el tope de costo: el resultado que llega no es un error */
  budgetHit: boolean;
  /** se interrumpió el turno por reintentos fallidos: el resultado deja la sesión en "error" sin el error genérico */
  retryHit: boolean;
  /** hay un turno en curso (desde que entra un mensaje hasta su resultado): la carpeta del motor no se toca */
  inTurn: boolean;
  /** llegó un mensaje durante un turno y la carpeta no se preparó (se prepara al terminar el turno) */
  prepPending: boolean;
}

const MAX_TOOL_STREAK = 3; // fallos seguidos de una misma herramienta
const MAX_TURN_ERRORS = 8; // fallos de herramientas en un mismo turno
const live = new Map<string, Live>();

/** true si el proyecto tiene una sesión del agente viva en este proceso. */
export function isLive(pid: string): boolean {
  return live.has(pid);
}

// ---------------------------------------------------------------- persistencia (save() con throttle ~1/s)
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(now = false): void {
  if (now) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    save();
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1000);
}

function prodOf(pid: string): ProdX | null {
  return (getProject(pid)?.production as ProdX | null | undefined) || null;
}

function touch(pid: string): void {
  const p = getProject(pid);
  const now = new Date().toISOString();
  if (p) { p.updatedAt = now; if (p.production) { p.production.updatedAt = now; syncProgress(p, p.production as ProdX); } }
}

// ---------------------------------------------------------------- progreso (etapas, reloj y ETA)
const modeOfProd = (p: Project, prod: ProdX): ProductionMode => prod.mode || modeOf(p);

/** El reloj corre solo con la producción en "running"; en cualquier otro estado queda en pausa. Recalcula la ETA. */
function syncProgress(p: Project, prod: ProdX, at = Date.now()): void {
  const pr = prod.progress;
  if (!pr) return;
  if (prod.status === "running") resumeClock(pr, at);
  else pauseClock(pr, at);
  refreshEta(pr, modeOfProd(p, prod), at);
}

/** Avanza la barra a `key` (solo hacia adelante y si la etapa existe en el modo); guarda la muestra de la etapa cerrada. */
function advanceStage(pid: string, key: ProgressStageKey): boolean {
  const p = getProject(pid);
  const prod = p?.production as ProdX | null | undefined;
  if (!p || !prod?.progress) return false;
  const mode = modeOfProd(p, prod);
  const now = Date.now();
  const moved = startStage(prod.progress, key, now, (k, ms) => recordSample(mode, k, ms));
  if (!moved) return false;
  refreshEta(prod.progress, mode, now);
  touch(pid);
  persist();
  return true;
}

// ---------------------------------------------------------------- tope de costo por video
const usd = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(2));
/** Tope efectivo: el de la producción (o `override`) si es > 0; si no, el de Ajustes (0 = sin tope). */
function capOf(prod: ProdX, override?: number): number {
  const own = override !== undefined ? override : prod.capUsd;
  if (own !== undefined && own > 0) return own;
  return Math.max(0, Number(load().settings.maxCostPerVideo) || 0);
}
/** Gasto que cuenta contra el tope: el de la grabación actual (desde capBaseUsd). */
const spentOf = (prod: ProdX): number => Math.max(0, (prod.costUsd || 0) + (prod.liveUsd || 0) - (prod.capBaseUsd || 0));

/** Solo lectura: el error del tope si la producción ya lo alcanzó (con `override` como tope de este inicio), si no null.
 *  Para revisar antes de un trabajo pago que termina lanzando el productor (Edición con plantilla). */
export function capReached(p: Project, override?: number): string | null {
  const prod = p.production as ProdX | null | undefined;
  if (!prod) return null;
  const cap = capOf(prod, override);
  return cap > 0 && spentOf(prod) >= cap ? `Llegaste al tope de US$${usd(cap)} para este video. Súbelo para continuar.` : null;
}

/** Una pregunta pendiente que se descarta sin respuesta no gasta su ronda: el agente la volverá a hacer. */
function refundQuestion(prod: ProdX): void {
  if (prod.pending?.type === "question" && (prod.questionRounds || 0) > 0) prod.questionRounds = (prod.questionRounds || 0) - 1;
}

/**
 * La sesión dejó de estar viva sin el resultado del turno (detener, caída, reinicio): el costo en vivo no puede quedar
 * colgado en liveUsd (se mezclaría con el próximo turno). Pasa a costUsd como provisional (el tope lo sigue contando)
 * con su fila de uso, y account() descuenta el solapamiento si el acumulado de la misma sesión ya lo incluye.
 */
function settleLiveCost(pid: string, prod: ProdX): boolean {
  const l = prod.liveUsd || 0;
  if (!l) return false;
  prod.liveUsd = 0;
  if (!(l > 0)) return true;
  prod.costUsd = Math.round(((prod.costUsd || 0) + l) * 1e6) / 1e6;
  prod.provisionalUsd = Math.round(((prod.provisionalUsd || 0) + l) * 1e6) / 1e6;
  load().usage.push({ id: id(), at: new Date().toISOString(), provider: "anthropic", stage: "produccion", projectId: pid, model: load().settings.producerModel, inputTokens: 0, outputTokens: 0, cost: Math.round(l * 1e6) / 1e6, ms: 0 });
  return true;
}
function budgetData(cap: number, spent: number): ProductionBudget {
  const suggested = Math.ceil(Math.max(cap * 1.5, cap + 5, spent + 5));
  return { id: id(), capUsd: cap, spentUsd: Math.round(spent * 100) / 100, suggestedUsd: suggested };
}
const budgetText = (cap: number, spent: number): string => `Se alcanzó el tope de US$${usd(cap)} para este video (llevas US$${spent.toFixed(2)}). El productor se pausó: sube el tope o detén aquí.`;

function interruptTurn(lv: Live): void {
  try { void lv.q?.interrupt().catch(() => {}); } catch {}
}

/**
 * Revisa el gasto contra el tope: aviso único al 80 % y, con `canHit`, al llegar al tope deja un pendiente "budget"
 * (el usuario sube el tope o detiene) y, con `interrupt`, corta el turno. Mientras el pendiente "budget" siga, cada
 * gasto nuevo vuelve a interrumpir (un turno en cola que arrancó igual no corre pasado el tope). Si una herramienta
 * viva espera una pregunta/aprobación, gastar más significa trabajo en paralelo (subagentes): se interrumpe y el
 * resultado reemplaza la pregunta por el aviso de tope. Una pregunta vieja sin herramienta se reemplaza ya.
 */
function checkCap(pid: string, lv: Live, canHit: boolean, interrupt = true): void {
  const prod = prodOf(pid);
  if (!prod) return;
  const cap = capOf(prod);
  if (cap <= 0) return;
  const spent = spentOf(prod);
  if (spent >= cap * 0.8 && prod.capWarned !== cap) {
    prod.capWarned = cap;
    if (spent < cap) event(pid, { type: "status", text: `Vas en US$${spent.toFixed(2)} de tu tope de US$${usd(cap)} para este video.` });
  }
  if (!canHit || spent < cap) return;
  if (prod.pending?.type === "budget") { if (interrupt) { lv.budgetHit = true; interruptTurn(lv); } return; } // un turno en cola siguió gastando
  if (prod.pending) {
    if (lv.resolvers.has(prod.pending.data.id)) {
      if (interrupt) { lv.budgetHit = true; interruptTurn(lv); }
      return;
    }
    refundQuestion(prod); // pendiente vieja sin herramienta esperando: el aviso de tope la reemplaza
  }
  const data = budgetData(cap, spent);
  prod.pending = { type: "budget", data };
  prod.status = "waiting";
  event(pid, { type: "status", text: budgetText(cap, spent), data }, true);
  // sin interrupción (tope cruzado recién al contabilizar un turno ya terminado) no viene otro resultado: sin budgetHit
  if (interrupt) { lv.budgetHit = true; interruptTurn(lv); }
}

/**
 * Antes de lanzar o reanudar: si el gasto ya llegó al tope, deja (o conserva) el pendiente "budget" para que la
 * interfaz muestre cómo subirlo y lanza el error. Si ya no se pasa del tope, un pendiente "budget" viejo se descarta.
 * No se llama cuando una herramienta viva está esperando la respuesta (el chequeo en vivo se encarga).
 */
function guardCap(p: Project, override?: number): void {
  const prod = p.production as ProdX | null | undefined;
  if (!prod) return;
  const cap = capOf(prod, override);
  const spent = spentOf(prod);
  if (cap <= 0 || spent < cap) {
    // el tope ya no se alcanza (se subió en Ajustes o en este inicio): el aviso viejo sobra
    if (prod.pending?.type === "budget") { prod.pending = null; if (prod.status === "waiting") prod.status = "idle"; }
    return;
  }
  if (prod.pending?.type !== "budget") {
    // la pregunta que quedaba se vuelve a hacer al reanudar: su ronda no cuenta
    refundQuestion(prod);
    const data = budgetData(cap, spent);
    prod.pending = { type: "budget", data };
    prod.status = "waiting";
    event(p.id, { type: "status", text: budgetText(cap, spent), data }, true);
  }
  throw new Error(`Llegaste al tope de US$${usd(cap)} para este video. Súbelo para continuar.`);
}

/** Costo en vivo de un mensaje del asistente (también de subagentes): suma solo el incremento por id de mensaje. */
function liveUsage(pid: string, lv: Live, m: Extract<SDKMessage, { type: "assistant" }>): void {
  const msg = m.message as unknown as { id?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_creation?: { ephemeral_1h_input_tokens?: number } | null } | null };
  const u = msg?.usage;
  if (!msg?.id || !u) return;
  const prod = prodOf(pid);
  if (!prod) return;
  const cw = u.cache_creation_input_tokens || 0;
  const cw1h = Math.min(cw, u.cache_creation?.ephemeral_1h_input_tokens || 0);
  const cost = costOf(msg.model || load().settings.producerModel, { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: cw - cw1h, cacheWrite1h: cw1h });
  // los bloques de un mismo mensaje repiten el id con un uso que solo crece: se suma la diferencia, nunca dos veces
  const prev = lv.msgCost.get(msg.id) || 0;
  if (!(cost > prev)) return;
  lv.msgCost.set(msg.id, cost);
  prod.liveUsd = Math.round(((prod.liveUsd || 0) + cost - prev) * 1e6) / 1e6;
  persist();
  checkCap(pid, lv, true);
}

/** Nombre legible de una herramienta para los avisos. */
const toolLabel = (name: string): string => name.replace(/^mcp__studio__/, "").replace(/^mcp__[^_]+__/, "");

/** El usuario actuó (mensaje, respuesta, decisión, tope, inicio): los reintentos vuelven a empezar. */
function resetRetries(lv: Live): void {
  lv.errStreak.clear();
  lv.errBatch.clear();
  lv.turnErrors = 0;
}

/** Lleva la cuenta de fallos de herramientas; al pasar el límite interrumpe el turno para no gastar créditos en bucle. */
function trackToolResults(pid: string, lv: Live, content: unknown): void {
  if (!Array.isArray(content)) return;
  for (const b of content as { type: string; tool_use_id?: string; is_error?: boolean }[]) {
    if (b.type !== "tool_result") continue;
    const name = (b.tool_use_id && lv.toolNames.get(b.tool_use_id)) || "herramienta";
    if (!b.is_error) { lv.errStreak.set(name, 0); lv.errBatch.delete(name); continue; }
    lv.turnErrors++;
    // varias llamadas en paralelo del mismo mensaje que fallan juntas son un solo intento, no «veces seguidas»
    const batch = (b.tool_use_id && lv.toolBatch.get(b.tool_use_id)) || "";
    const sameBatch = Boolean(batch) && lv.errBatch.get(name) === batch;
    if (batch) lv.errBatch.set(name, batch);
    const streak = (lv.errStreak.get(name) || 0) + (sameBatch ? 0 : 1);
    lv.errStreak.set(name, streak);
    if (lv.retryHit || lv.budgetHit || (streak < MAX_TOOL_STREAK && lv.turnErrors < MAX_TURN_ERRORS)) continue;
    lv.retryHit = true;
    const why = streak >= MAX_TOOL_STREAK ? `«${toolLabel(name)}» falló ${MAX_TOOL_STREAK} veces seguidas.` : `Hubo ${MAX_TURN_ERRORS} pasos fallidos en este turno.`;
    event(pid, { type: "error", text: `${why} Pausé al productor para no gastar más créditos. Escribe qué hacer (o «sigue» para que lo intente distinto).` }, true);
    interruptTurn(lv);
  }
}

function event(pid: string, ev: { type: ProductionEvent["type"]; text: string; media?: string[]; data?: unknown }, now = false): void {
  const prod = prodOf(pid);
  if (!prod) return;
  prod.events = prod.events || [];
  prod.events.push({ id: id(), at: new Date().toISOString(), type: ev.type, text: ev.text, ...(ev.media?.length ? { media: ev.media } : {}), ...(ev.data !== undefined ? { data: ev.data } : {}) });
  if (prod.events.length > MAX_EVENTS) prod.events.splice(0, prod.events.length - MAX_EVENTS);
  touch(pid);
  persist(now);
}

function setStatus(pid: string, status: ProductionStatus): void {
  const prod = prodOf(pid);
  if (!prod) return;
  prod.status = status;
  if (status === "done") markEditRunReady(pid, prod);
  touch(pid);
  persist(true);
}

/**
 * Camino de edición por defecto (Project.editRun): cuando el productor termina con un render final, el paso «Plantilla»
 * queda «listo». Se guarda con el touch/persist de setStatus.
 */
function markEditRunReady(pid: string, prod: ProdX): void {
  const p = getProject(pid);
  const run = p?.editRun;
  if (!p || !run || run.state !== "plantilla") return;
  if (currentRenders(p, prod).some((r) => r.mode === "final")) { run.state = "listo"; delete run.error; }
}

/**
 * Renders del productor que cuentan como resultado ahora: con un EditRun de plantilla, solo los hechos después de que
 * empezó esa corrida; si no, solo los posteriores a la grabación actual (los de un corte o una grabación anteriores no
 * se ofrecen ni se aprueban). Sin grabación ni EditRun (reel/clase), todos.
 */
export function currentRenders(p: Project, prod: Production | null | undefined = p.production): RenderOutput[] {
  const run = p.editRun;
  const cutoff = run && !run.quick ? run.startedAt : p.recording?.at || "";
  return (prod?.renders || []).filter((r) => (r.at || "") >= cutoff);
}

function anthropicKey(): string {
  const k = load().settings.apiKey || process.env.ANTHROPIC_API_KEY || "";
  if (!k) throw new Error("Falta la API key de Anthropic. Agrégala en Ajustes: el productor de video usa tu propia key de Claude.");
  return k;
}

// ---------------------------------------------------------------- guardia de herramientas
export interface GuardScope {
  /** carpeta del motor (cwd del agente; único lugar donde puede escribir, además de temporales) */
  dir: string;
  /** carpeta del proyecto en la app (data/projects/<pid>): lectura (grabación, words.json, ediciones) */
  projectRoot: string;
  /** archivos o carpetas extra de solo lectura (grabación fuera del proyecto, referencias, carpeta de B-roll) */
  readExtra: string[];
}
export type GuardResult = { ok: true } | { ok: false; reason: string };

// temporal propio del agente (TMPDIR de sus procesos): el único temporal que pueden leer o escribir sus herramientas
export { AGENT_TMP };
try { fs.mkdirSync(AGENT_TMP, { recursive: true, mode: 0o700 }); fs.chmodSync(AGENT_TMP, 0o700); } catch {}
const TMP_ROOTS = [AGENT_TMP];
const SYSTEM_ROOTS = ["/usr", "/bin", "/sbin", "/opt/homebrew", "/opt/local", "/Library/Fonts", "/System/Library/Fonts", "/dev/null", "/dev/stdout", "/dev/stderr", "/dev/stdin", "/dev/zero", "/dev/urandom", "/dev/fd"];
const NODE_MODULES = path.join(APP_DIR, "node_modules");

const inside = (p: string, root: string): boolean => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
// las raíces se comparan en su forma escrita y en su forma real (/tmp → /private/tmp, carpetas con enlaces)
const realRoots = new Map<string, string>();
const realOf = (root: string): string => {
  let r = realRoots.get(root);
  if (r === undefined) { r = realPrefix(root); realRoots.set(root, r); }
  return r;
};
const within = (p: string, root: string): boolean => inside(p, root) || inside(p, realOf(root));
const withinAny = (p: string, roots: string[]): boolean => roots.some((r) => within(p, r));
const otherProjectMusic = (p: string): boolean => (within(p, PROJECTS_DIR)) && /\/motion\/audio\/music\.wav$/.test(p.split(path.sep).join("/"));

function resolveIn(dir: string, raw: string): string {
  let t = raw;
  if (t === "~" || t.startsWith("~/")) t = path.join(os.homedir(), t.slice(1));
  return path.resolve(dir, t);
}

/**
 * Resuelve una ruta como lo hace el kernel: componente por componente, siguiendo cada enlace simbólico ANTES de
 * aplicar el siguiente "..". Así node_modules/../data va a <destino del enlace>/../data y no a <proyecto>/data.
 * `dotdotAfterLink` = hubo un ".." justo después de pasar por un enlace (node_modules/.., .venv/..): se rechaza siempre.
 */
export function physicalPath(base: string, raw: string): { p: string; dotdotAfterLink: boolean } {
  let t = raw;
  if (t === "~" || t.startsWith("~/")) t = path.join(os.homedir(), t.slice(1));
  let cur = path.isAbsolute(t) ? "/" : path.resolve(base);
  try { cur = fs.realpathSync.native(cur); } catch { cur = realPrefix(cur); }
  let dotdotAfterLink = false;
  let prevLink = false;
  let exists = true; // mientras el prefijo exista se resuelven enlaces; después solo se concatena
  let hops = 0;
  for (const comp of t.split("/")) {
    if (!comp || comp === ".") continue;
    if (comp === "..") {
      if (prevLink) dotdotAfterLink = true;
      cur = path.dirname(cur);
      prevLink = false;
      continue;
    }
    const next = path.join(cur, comp);
    prevLink = false;
    if (exists) {
      let st: fs.Stats | null = null;
      try { st = fs.lstatSync(next); } catch { exists = false; }
      if (st?.isSymbolicLink()) {
        prevLink = true;
        if (++hops > 40) return { p: realPrefix(next), dotdotAfterLink: true };
        cur = realPrefix(next); // destino real (también de enlaces rotos)
        continue;
      }
    }
    cur = next;
  }
  return { p: cur, dotdotAfterLink };
}
function writableLex(p: string, s: GuardScope): boolean {
  if (within(p, path.join(s.dir, "node_modules")) || within(p, path.join(s.dir, ".venv"))) return false;
  return within(p, s.dir) || withinAny(p, TMP_ROOTS);
}
function readableLex(p: string, s: GuardScope): boolean {
  return writableLex(p, s) || within(p, s.dir) || within(p, s.projectRoot) || within(p, MOTION_DIR) || within(p, NODE_MODULES) || withinAny(p, s.readExtra) || otherProjectMusic(p);
}
// los chequeos valen para la ruta escrita Y para su ruta real (enlaces simbólicos resueltos), así un enlace no abre otra zona
function writable(p: string, s: GuardScope): boolean {
  return writableLex(p, s) && writableLex(realPrefix(p), s);
}
function readable(p: string, s: GuardScope): boolean {
  return readableLex(p, s) && readableLex(realPrefix(p), s);
}
function bashReadable(p: string, s: GuardScope): boolean {
  const ok = (x: string): boolean => readableLex(x, s) || withinAny(x, SYSTEM_ROOTS);
  return ok(p) && ok(realPrefix(p));
}

/** marca interna de una expansión de shell ($VAR, ${…}, $1…) dentro de una palabra */
const DYN = "\u0000";

/**
 * Separa una orden de shell en segmentos (por ; && || | y saltos) y palabras, respetando comillas.
 * `subst` = hay sustituciones de comandos o procesos ($(…), `…`, <(…), >(…)) fuera de comillas simples.
 * Las expansiones de variables fuera de comillas simples quedan marcadas con DYN en la palabra.
 */
function shellSegments(cmd: string): { segs: { words: string[]; redirects: string[] }[]; subst: boolean } {
  const segs: { words: string[]; redirects: string[] }[] = [];
  let words: string[] = [];
  let redirects: string[] = [];
  let cur = "";
  let has = false;
  let quote: "'" | '"' | null = null;
  let redirectNext = false;
  let subst = false;
  const endWord = (): void => {
    if (has) { (redirectNext ? redirects : words).push(cur); redirectNext = false; }
    cur = ""; has = false;
  };
  const endSeg = (): void => { endWord(); if (words.length || redirects.length) segs.push({ words, redirects }); words = []; redirects = []; };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    const next = cmd[i + 1] ?? "";
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "`") { subst = true; if (quote) { cur += ch; continue; } endSeg(); continue; }
    if (ch === "$") {
      if (next === "(") subst = true;
      if (/[A-Za-z_{(0-9@*#?!$-]/.test(next)) { cur += DYN + "$"; has = true; continue; }
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; }
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (ch === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; has = true; continue; }
    if (/\s/.test(ch)) { if (ch === "\n") endSeg(); else endWord(); continue; }
    if ((ch === "<" || ch === ">") && next === "(") subst = true;
    if (ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")" || ch === "{" && !has || ch === "}" && !has) { endSeg(); continue; }
    if (ch === ">" || ch === "<") {
      endWord();
      if (ch === ">") redirectNext = true;
      while (cmd[i + 1] === ">" || cmd[i + 1] === "&" || cmd[i + 1] === "|") i++;
      continue;
    }
    cur += ch; has = true;
  }
  endSeg();
  return { segs, subst };
}

const WRITE_CMDS = new Set(["rm", "rmdir", "mv", "tee", "touch", "mkdir", "ln", "chmod", "chown", "chflags", "truncate", "unlink", "shred", "dd", "install", "xattr", "setfacl"]);
const INTERPRETERS = /^(python[0-9.]*|pypy[0-9.]*|node|nodejs|perl[0-9.]*|ruby|php|deno|bun|lua|Rscript|tclsh|swift|jshell)$/;
const SHELLS = /^(ba|z|da|k|fi|c|tc|mk)?sh$/;
const NET_TOOLS = /(^|[\s;&|(/])(curl|wget|nc|ncat|netcat|telnet|socat|http|https|httpie|xh|aria2c|lynx|links|w3m|open|python[0-9.]*|node|nodejs|perl|ruby|php|deno|bun|osascript|openssl|ssh|scp|sftp|rsync|ftp)(\s|$)/;
const LOCAL_HOSTS = /(^|[^\w.-])(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|0x7f[0-9a-f.]*|2130706433|\[?::1\]?|\[?::ffff:127[0-9.]*\]?|[\w-]+\.localhost)(?![\w-])/i;
const DESTRUCTIVE_CODE = /rmtree|unlink|rmSync|rmdirSync|removedirs|\bremove\s*\(|\brmdir\b|rename|renameSync|writeFile|appendFile|createWriteStream|copyFile|cpSync|symlink|chmod|chown|truncate|\bopen\s*\([^)]*['"][wax+]|shutil\.(move|copy)|os\.system|subprocess|child_process|exec\s*\(|spawn|system\s*\(|`/;
const HOME_CODE = /expanduser|Path\.home|Dir\.home|homedir|process\.env|os\.environ|getenv|ENV\s*\[|\$ENV\s*\{|getpwuid|glob\s+q\{~|<~>|File\.expand_path/;

const NO_NET = "Bash no tiene acceso a internet en el productor. Para capturar un sitio usa mcp__studio__capture_site; los modelos de transcripción ya están instalados.";
const NET_CMDS = /^(curl|wget|aria2c|httpie|http|https|xh|lynx|links|w3m|nc|ncat|netcat|telnet|socat|ftp|sftp|scp|ssh)$/;

function checkBash(command: string, s: GuardScope, depth = 0): GuardResult {
  const c = command.replace(/\\\r?\n/g, " ");
  const deny = (reason: string): GuardResult => ({ ok: false, reason });
  if (depth > 4) return deny("Orden demasiado anidada.");
  const B = "(^|[\\s;&|(`])";
  if (new RegExp(`${B}sudo(\\s|$)`).test(c) || new RegExp(`${B}su\\s`).test(c) || new RegExp(`${B}doas(\\s|$)`).test(c)) return deny("No se permite sudo en el productor.");
  if (new RegExp(`${B}git(\\s|$)`).test(c)) return deny("No se permiten operaciones de git en el productor.");
  if (new RegExp(`${B}(pip3?|pipx|npm|pnpm|yarn|bun|brew|gem|cargo|apt|apt-get|port|conda|mamba|poetry)\\s+(install|add|i|ci|upgrade|update|reinstall)\\b`).test(c)
    || /\buv\s+(pip\s+install|add|sync|tool\s+install)\b/.test(c) || /-m\s+pip\s+install\b/.test(c)
    || /\bnpx\s+(-y|--yes)\b/.test(c) || /\bplaywright\s+install\b/.test(c) || /\bpyenv\.sh\b/.test(c) || /\binit\.sh\b/.test(c)) {
    return deny("No se permiten instalaciones ni reinstalar el entorno: Playwright, Chromium, ffmpeg y .venv ya están listos.");
  }
  if (/\b(curl|wget)\b[^;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(c)) return deny("No se permite ejecutar scripts descargados de internet.");
  // Bash no tiene red (sandbox sin dominios permitidos): las descargas no funcionan y no se intentan
  if (/(^|[\s;&|(/])(curl|wget|aria2c)(\s|$)/.test(c)) return deny(NO_NET);
  if (/\b(render|lint|capture)\.mjs\b/.test(c)) return deny("render.mjs, lint.mjs y capture.mjs abren Chromium y no corren en el sandbox de Bash: usa mcp__studio__render, mcp__studio__sheet, mcp__studio__render_check, mcp__studio__lint o mcp__studio__capture_site.");
  if (NET_TOOLS.test(c) && LOCAL_HOSTS.test(c)) return deny("El productor no puede conectarse a servicios locales (localhost) desde Bash.");
  if (/(^|[\s;&|(])osascript(\s|$)/.test(c)) return deny("No se permite osascript en el productor.");

  const { segs, subst } = shellSegments(c);
  if (subst) return deny("No se permiten sustituciones $(…), comillas invertidas ni <(…) en las órdenes: escribe los comandos y las rutas explícitas.");

  let cwd = s.dir; // los cd se siguen dentro de la orden
  // rutas con semántica del kernel (enlaces resueltos antes de cada ".."); un ".." tras un enlace se rechaza
  let linkDotDot = "";
  const res = (raw: string): string => {
    const r = physicalPath(cwd, raw);
    if (r.dotdotAfterLink && !linkDotDot) linkDotDot = raw;
    return r.p;
  };
  const isDyn = (w: string): boolean => w.includes(DYN);
  const shown = (w: string): string => w.split(DYN).join("");

  for (const seg of segs) {
    // salta asignaciones VAR=valor al inicio
    let k = 0;
    while (k < seg.words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg.words[k])) k++;
    // envoltorios que ejecutan otra orden: env, command, builtin, exec, nice, nohup, time, timeout N, xargs
    while (k < seg.words.length && /^(env|command|builtin|exec|nice|nohup|time|stdbuf)$/.test(seg.words[k])) {
      k++;
      while (k < seg.words.length && (seg.words[k].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg.words[k]))) k++;
    }
    if (seg.words[k] === "timeout") { k++; while (k < seg.words.length && (seg.words[k].startsWith("-") || /^\d/.test(seg.words[k]))) k++; }
    const rawCmd = seg.words[k] || "";
    if (isDyn(rawCmd)) return deny("No se permite ejecutar un comando guardado en una variable.");
    const cmdWord = rawCmd ? path.basename(rawCmd) : "";
    const args = seg.words.slice(k + 1);
    if (NET_CMDS.test(cmdWord)) return deny(NO_NET);
    // ".." después de un enlace simbólico (node_modules/.., .venv/..) sale del proyecto: se rechaza en cualquier palabra
    for (const w of [...seg.words, ...seg.redirects]) {
      const val = w.includes("=") && !w.startsWith("/") && !w.startsWith(".") ? w.split("=").slice(1).join("=") : w;
      for (const cand of new Set([w, val])) {
        if (!cand.split("/").includes("..") || isDyn(cand)) continue;
        if (physicalPath(cwd, cand).dotdotAfterLink) return deny(`No se permite ".." después de un enlace simbólico (${cand}): usa rutas dentro del proyecto o del kit sin "..".`);
      }
    }

    for (const r of seg.redirects) {
      if (/^&?\d*-?$/.test(r)) continue; // 2>&1
      if (/^\/dev\/(null|stdout|stderr)$/.test(r)) continue; // descartar salida no escribe archivos
      if (isDyn(r)) return deny(`No se permiten variables en redirecciones: escribe la ruta explícita (${shown(r)}).`);
      if (!writable(res(r), s)) return deny(`La orden escribe fuera del proyecto: ${r}`);
    }
    // variables en argumentos: solo se permiten en echo/printf/test
    if (!/^(echo|printf|test|\[|\[\[|export|true|false|:)$/.test(cmdWord)) {
      const dyn = args.find(isDyn);
      if (dyn) return deny(`No se permiten variables ni expansiones en los argumentos (${shown(dyn)}): escribe la ruta o el valor explícito.`);
    }

    if (cmdWord === "cd" || cmdWord === "pushd" || cmdWord === "popd" || cmdWord === "chdir") {
      if (cmdWord === "popd") return deny("No se permite popd: usa rutas relativas a la raíz del proyecto.");
      const target = args.filter((x) => x !== "-P" && x !== "-L" && x !== "--")[0];
      if (!target || target === "-") return deny("cd sin carpeta (o cd -) sale del proyecto: usa rutas relativas a la raíz del proyecto.");
      const p = res(target);
      if (!writable(p, s) || !within(p, s.dir) || !within(realPrefix(p), s.dir)) return deny(`No se permite cd fuera de la carpeta del proyecto (${target}). Usa rutas relativas a la raíz del proyecto.`);
      cwd = p;
      continue;
    }
    if (cmdWord === "eval" || cmdWord === "source" || cmdWord === ".") {
      if (cmdWord === "eval") { const r = checkBash(args.join(" "), s, depth + 1); if (!r.ok) return r; continue; }
      const f = args[0];
      if (f && !readable(res(f), s)) return deny(`source de un archivo fuera del proyecto: ${f}`);
    }
    if (SHELLS.test(cmdWord)) {
      const ci = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
      if (ci >= 0) { const r = checkBash(args[ci + 1] || "", s, depth + 1); if (!r.ok) return r; }
    }
    if (cmdWord === "xargs" || cmdWord === "parallel") {
      const rest = args.filter((a) => !a.startsWith("-"));
      const r = checkBash(rest.join(" "), s, depth + 1);
      if (!r.ok) return r;
      if (rest.some((a) => WRITE_CMDS.has(path.basename(a)))) return deny("No se permite xargs con órdenes que borran o modifican archivos: escribe las rutas explícitas.");
    }
    if (INTERPRETERS.test(cmdWord)) {
      const ci = args.findIndex((a) => /^(-[a-zA-Z]*[ceEpr]|--eval|--print|-ne|-pe|-le)$/.test(a));
      if (ci >= 0) {
        const code = args[ci + 1] || "";
        if (HOME_CODE.test(code)) return deny("El código en línea no puede usar la carpeta personal ni variables de entorno para armar rutas: escribe rutas relativas al proyecto.");
        const destructive = DESTRUCTIVE_CODE.test(code);
        const cands = code.match(/(?<![\w.$\/\\])(~[\w.-]*(?:\/[^\s'"`;,)}\]]*)?|\/[^\s'"`;,)}\]*?]+|\.\.(?:\/[^\s'"`;,)}\]]*)?)/g) || [];
        for (const cand of cands) {
          if (cand.startsWith("~") && cand !== "~" && !cand.startsWith("~/")) return deny(`Ruta fuera del proyecto en el código: ${cand}`);
          if (cand.startsWith("/")) {
            const top = "/" + cand.split("/")[1];
            if (!fs.existsSync(top)) continue; // no es una ruta real (p. ej. una regex /…/)
          }
          const p = res(cand);
          if (destructive ? !writable(p, s) && !withinAny(p, SYSTEM_ROOTS.filter((r) => r.startsWith("/dev/"))) : !bashReadable(p, s)) return deny(`El código en línea toca una ruta fuera del proyecto: ${cand}`);
        }
      }
    }

    if (cmdWord === "find") {
      if (args.some((a) => /^-(exec|execdir|ok|okdir)$/.test(a))) return deny("No se permite find con -exec: lista los archivos y actúa sobre rutas explícitas.");
      if (args.includes("-delete")) {
        const firstOpt = args.findIndex((a) => a.startsWith("-") || a === "(" || a === "!");
        const starts = firstOpt < 0 ? args : args.slice(0, firstOpt);
        for (const st of starts.length ? starts : ["."]) {
          const p = res(st);
          if (!writable(p, s) || p === s.dir || inside(s.dir, p)) return deny(`find -delete solo dentro de subcarpetas del proyecto (${st}).`);
        }
      }
    }
    if (cmdWord === "rm" || cmdWord === "rmdir" || cmdWord === "unlink") {
      const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive");
      for (const a of args.filter((x) => !x.startsWith("-"))) {
        const p = res(a);
        if (recursive && (p === s.dir || inside(s.dir, p) || inside(realOf(s.dir), realPrefix(p)))) return deny(`No se permite borrar la carpeta del proyecto ni sus carpetas superiores (${a}).`);
        if (!writable(p, s)) return deny(`No se permite borrar fuera del proyecto: ${a}`);
      }
    } else if (cmdWord === "ln") {
      const pos = args.filter((x) => !x.startsWith("-"));
      const symbolic = args.some((a) => /^-[a-zA-Z]*s/.test(a) || a === "--symbolic");
      if (!pos.length) continue;
      const linkArg = pos.length > 1 ? pos[pos.length - 1] : ".";
      const targets = pos.length > 1 ? pos.slice(0, -1) : pos;
      const linkAbs = res(linkArg);
      if (!writable(linkAbs, s)) return deny(`La orden crea un enlace fuera del proyecto: ${linkArg}`);
      let linkParent = path.dirname(linkAbs);
      try { if (fs.statSync(linkAbs).isDirectory()) linkParent = linkAbs; } catch {}
      for (const t of targets) {
        const tp = symbolic && !t.startsWith("/") && !t.startsWith("~") ? path.resolve(linkParent, t) : res(t);
        if (!writable(tp, s)) return deny(`No se permiten enlaces que apunten fuera de la carpeta del proyecto (${t}): copia el archivo.`);
      }
    } else if (WRITE_CMDS.has(cmdWord)) {
      const pos = args.filter((x) => !x.startsWith("-"));
      // dd: of=; el resto: todos los argumentos con ruta
      const targets = cmdWord === "dd" ? pos.filter((a) => a.startsWith("of=")).map((a) => a.slice(3)) : pos;
      for (const a of targets) {
        if ((cmdWord === "chmod" || cmdWord === "chown" || cmdWord === "chflags") && a === pos[0]) continue; // modo o dueño
        if (!writable(res(a), s)) return deny(`La orden modifica una ruta fuera del proyecto (el kit del motor es de solo lectura): ${a}`);
      }
    } else if (cmdWord === "cp" || cmdWord === "rsync" || cmdWord === "ditto" || cmdWord === "scp") {
      const pos = args.filter((x) => !x.startsWith("-"));
      const dest = pos[pos.length - 1];
      if (dest && !writable(res(dest), s)) return deny(`La copia escribe fuera del proyecto: ${dest}`);
    } else if ((cmdWord === "sed" || cmdWord === "perl") && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
      const files = args.filter((x) => !x.startsWith("-")).slice(1);
      for (const f of files) if (!writable(res(f), s)) return deny(`${cmdWord} -i sobre un archivo fuera del proyecto: ${f}`);
    }

    // argumentos relativos que pasan por un enlace simbólico: su destino real también debe ser legible
    for (const w of args) {
      if (!w || w.startsWith("-") || isDyn(w) || w.startsWith("/") || w.startsWith("~") || !/^[\w.@+-][\w.@+\/-]*$/.test(w)) continue;
      const lex = resolveIn(cwd, w);
      const real = res(w);
      if (real !== lex && !bashReadable(real, s) && !within(lex, path.join(s.dir, ".venv"))) return deny(`La orden toca una ruta fuera del proyecto a través de un enlace simbólico: ${w}`);
    }

    // cualquier ruta mencionada debe estar en una zona permitida (lectura)
    for (const w of seg.words) {
      const cands = [w, ...(w.includes("=") ? [w.split("=").slice(1).join("=")] : [])];
      for (const cand of cands) {
        if (cand.startsWith("~") && cand !== "~" && !cand.startsWith("~/")) return deny(`La orden toca una ruta fuera del proyecto: ${cand}`);
        if (!(cand.startsWith("/") || cand === "~" || cand.startsWith("~/") || cand === ".." || cand.startsWith("../") || cand.includes("/../") || cand.endsWith("/.."))) continue;
        if (cand.startsWith("/")) {
          const top = "/" + cand.split("/")[1];
          if (!fs.existsSync(top)) continue; // no es una ruta real (p. ej. un patrón /regex/)
        }
        const p = res(cand);
        if (!bashReadable(p, s)) return deny(`La orden toca una ruta fuera del proyecto y del kit del motor: ${cand}`);
      }
    }
  }
  if (linkDotDot) return deny(`No se permite ".." después de un enlace simbólico (${linkDotDot}): usa rutas dentro del proyecto o del kit sin "..".`);
  return { ok: true };
}

/** Archivos que cambian la carga de módulos de Node/Python (los scripts fuera del sandbox los respetarían). */
const FORBIDDEN_FILE = /^(package\.json|\.npmrc|\.yarnrc(\.yml)?|\.pnp\..*|sitecustomize\.py|usercustomize\.py|.*\.pth|pyvenv\.cfg|node_modules)$/i;

/** Parte fija (sin comodines) de un patrón glob absoluto. */
function globBase(pattern: string): string {
  const parts = pattern.split("/");
  const fixed: string[] = [];
  for (const part of parts) { if (/[*?[\]{}]/.test(part)) break; fixed.push(part); }
  return fixed.join("/") || "/";
}

/** Decide si el agente puede usar una herramienta con esa entrada (Bash y herramientas de archivos). */
export function guardToolUse(toolName: string, input: Record<string, unknown>, s: GuardScope): GuardResult {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  if (toolName === "Bash") return checkBash(str(input.command), s);
  if (toolName === "AskUserQuestion") return { ok: false, reason: "Usa mcp__studio__ask_user para preguntar al usuario." };
  if (/sandbox|network/i.test(toolName)) return { ok: false, reason: "El productor no puede salir del sandbox ni abrir red adicional." };
  // WebFetch corre fuera del sandbox y podría sacar datos en la URL hacia cualquier dominio: desactivado.
  // Los sitios del usuario se capturan con mcp__studio__capture_site (valida el dominio en el servidor).
  if (toolName === "WebFetch") return { ok: false, reason: "WebFetch no está disponible en el productor: para ver o capturar un sitio del usuario usa mcp__studio__capture_site." };
  const writeTools: Record<string, string> = { Write: "file_path", Edit: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path" };
  const readTools: Record<string, string> = { Read: "file_path", Glob: "path", Grep: "path", LS: "path", NotebookRead: "notebook_path" };
  if (toolName in writeTools) {
    const raw = str(input[writeTools[toolName]]);
    if (!raw) return { ok: false, reason: "Falta la ruta del archivo." };
    if (raw.includes("$") || (raw.startsWith("~") && raw !== "~" && !raw.startsWith("~/"))) return { ok: false, reason: `Escribe la ruta explícita, sin variables: ${raw}` };
    const p = resolveIn(s.dir, raw);
    const phys = physicalPath(s.dir, raw);
    if (phys.dotdotAfterLink) return { ok: false, reason: `No se permite ".." después de un enlace simbólico: ${raw}` };
    if (FORBIDDEN_FILE.test(path.basename(p))) return { ok: false, reason: `No se permite crear ${path.basename(p)} en el proyecto: cambia cómo Node o Python cargan módulos fuera del sandbox.` };
    return writable(p, s) && writable(phys.p, s) ? { ok: true } : { ok: false, reason: `Solo puedes escribir dentro de la carpeta del proyecto (${s.dir}). El kit del motor es de solo lectura.` };
  }
  if (toolName in readTools) {
    const raw = str(input[readTools[toolName]]);
    const bad = (x: string): GuardResult => ({ ok: false, reason: `Ruta fuera de las carpetas permitidas (proyecto, kit del motor, temporales): ${x}` });
    if (raw) {
      if (raw.includes("$") || (raw.startsWith("~") && raw !== "~" && !raw.startsWith("~/"))) return bad(raw);
      const phys = physicalPath(s.dir, raw);
      if (phys.dotdotAfterLink || !readable(resolveIn(s.dir, raw), s) || !readable(phys.p, s)) return bad(raw);
    }
    // el patrón de Glob y el filtro glob de Grep también pueden ser rutas
    const pats = toolName === "Glob" ? [str(input.pattern)] : toolName === "Grep" ? [str(input.glob)] : [];
    for (const pat of pats) {
      if (!pat) continue;
      if (pat.includes("..") || pat.includes("~") || pat.includes("$")) return bad(pat);
      if (pat.startsWith("/")) {
        const base = globBase(pat);
        if (!readable(path.resolve(base), s)) return bad(pat);
      }
    }
    return { ok: true };
  }
  return { ok: true };
}

function scopeFor(p: Project, dir: string): GuardScope {
  const extra: string[] = [];
  if (p.recording?.file) extra.push(path.resolve(p.recording.file));
  for (const r of p.references || []) if (r.file) extra.push(path.resolve(r.file));
  const broll = load().settings.brollDir;
  if (broll && fs.existsSync(broll)) extra.push(path.resolve(broll));
  return { dir: path.resolve(dir), projectRoot: path.resolve(projectDir(p.id)), readExtra: extra };
}

// ---------------------------------------------------------------- descripción legible de herramientas
function shown(file: string, dir: string): string {
  if (!file) return "";
  const p = path.resolve(dir, file);
  if (inside(p, dir)) return path.relative(dir, p) || ".";
  if (inside(p, MOTION_DIR)) return "kit/" + path.relative(MOTION_DIR, p);
  return path.basename(p);
}

function fmtOf(cmd: string): string {
  if (/--all\b/.test(cmd)) return "todos los formatos";
  const m = /--fmt\s+(\d+)x(\d+)/.exec(cmd);
  return m ? `${m[1]}:${m[2]}` : "";
}

export function describeTool(name: string, input: Record<string, unknown>, dir: string): string | null {
  const s = (k: string): string => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Bash": {
      const c = s("command");
      const f = fmtOf(c);
      if (/render\.mjs/.test(c)) {
        if (/--sheet/.test(c)) return `Generando hoja de contactos${f ? " " + f : ""}…`;
        if (/--verify/.test(c)) return "Verificando que el render sea determinista…";
        if (/--mux/.test(c)) return "Uniendo la mezcla de audio al video…";
        if (/--at\b/.test(c)) return "Renderizando fotogramas de control…";
        if (/--range\b/.test(c)) return "Renderizando un fragmento de control…";
        return `Renderizando ${/--draft/.test(c) ? "borrador" : "versión final"}${f ? " " + f : ""}…`;
      }
      const map: [RegExp, string][] = [
        [/lint\.mjs/, "Revisando el diseño (lint)…"], [/beats\.py/, "Midiendo el pulso de la música…"], [/sync\.mjs/, "Sincronizando la línea de tiempo…"],
        [/sfx\.mjs/, "Colocando efectos de sonido…"], [/mix\.py/, "Mezclando y masterizando el audio…"], [/vo\.py/, "Colocando la voz…"],
        [/words\.py/, "Alineando las palabras de la voz…"], [/review\.py/, "Preparando el material de revisión…"], [/capture\.mjs/, "Capturando recursos de la web…"],
        [/seq\.py/, "Importando metraje…"], [/ref_analyze\.py/, "Analizando el video de referencia…"], [/compare_music\.py/, "Comparando la música con otros proyectos…"],
        [/music\.py/, "Sintetizando música…"], [/grade\.py/, "Ajustando el color…"], [/preset\.mjs/, "Aplicando preset…"], [/\bffmpeg\b/, "Procesando audio/video con ffmpeg…"],
        [/\bffprobe\b/, "Inspeccionando un archivo de medios…"],
      ];
      for (const [re, t] of map) if (re.test(c)) return t;
      const d = s("description");
      return d ? `${d}…` : `Ejecutando: ${c.replace(/\s+/g, " ").slice(0, 90)}`;
    }
    case "Read": return `Leyendo ${shown(s("file_path"), dir)}`;
    case "Write": return `Escribiendo ${shown(s("file_path"), dir)}`;
    case "Edit": case "MultiEdit": return `Editando ${shown(s("file_path"), dir)}`;
    case "NotebookEdit": return `Editando ${shown(s("notebook_path"), dir)}`;
    case "Glob": case "Grep": case "LS": return null; // búsquedas: demasiado ruido para la sesión
    case "TodoWrite": case "TaskCreate": case "TaskUpdate": case "TaskList": case "TaskGet": return null;
    case "WebFetch": { try { return `Consultando ${new URL(s("url")).host}…`; } catch { return "Consultando una página web…"; } }
    case "WebSearch": return `Buscando en la web: ${s("query")}`;
    case "Task": case "Agent": return /critic/i.test(s("subagent_type") + s("description")) ? `Consultando al crítico: ${s("description") || "ronda de crítica"}…` : `Subagente: ${s("description") || "tarea"}…`;
    case "mcp__studio__elevenlabs_music": return `Generando música con ElevenLabs${input.variants ? ` (${input.variants} variantes)` : ""}…`;
    case "mcp__studio__elevenlabs_tts": return `Generando voz: "${s("text").slice(0, 60)}"…`;
    case "mcp__studio__elevenlabs_sfx": return `Generando efecto de sonido: ${s("prompt").slice(0, 60)}…`;
    case "mcp__studio__elevenlabs_voices": return "Buscando voces…";
    case "mcp__studio__render": {
      const f = Array.isArray(input.formats) ? (input.formats as string[]).map((x) => x.replace("x", ":")).join(", ") : "";
      return `Renderizando ${input.mode === "final" ? "versión final" : "borrador"} ${f}…`;
    }
    case "mcp__studio__sheet": return `Generando hoja de contactos ${s("fmt").replace("x", ":")}…`;
    case "mcp__studio__lint": return "Revisando el diseño (lint)…";
    case "mcp__studio__capture_site": { try { return `Capturando recursos de ${new URL(s("url")).host}…`; } catch { return "Capturando recursos de la web…"; } }
    case "mcp__studio__render_check": {
      const a = s("action");
      return a === "at" ? "Renderizando fotogramas de control…" : a === "range" ? "Renderizando un fragmento de control…" : a === "verify" ? "Verificando que el render sea determinista…" : "Uniendo la mezcla de audio al video…";
    }
    case "mcp__studio__ask_user": case "mcp__studio__request_approval": case "mcp__studio__show_media": return null; // generan sus propios eventos
    default: return name.startsWith("mcp__") ? `Herramienta ${name.replace(/^mcp__[^_]+__/, "")}…` : `${name}…`;
  }
}

// ---------------------------------------------------------------- mensajes del SDK → eventos
function textChunks(text: string, max = 2000): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out: string[] = [];
  let buf = "";
  for (const para of t.split(/\n{2,}/)) {
    if ((buf + "\n\n" + para).length > max && buf) { out.push(buf); buf = ""; }
    buf = buf ? buf + "\n\n" + para : para;
    while (buf.length > max) { out.push(buf.slice(0, max) + "…"); buf = buf.slice(max); }
  }
  if (buf) out.push(buf);
  return out.slice(0, 6);
}

function account(pid: string, lv: Live, m: SDKResultMessage): void {
  const prod = prodOf(pid);
  const p = getProject(pid);
  if (!prod || !p) return;
  // estimado en vivo de este turno: se reemplaza por el real del resultado solo cuando el delta se aplica (nunca ambos);
  // si el resultado no sirve, pasa a provisional (settleLiveCost) en vez de perderse
  const liveB = Math.max(0, prod.liveUsd || 0);
  const total = Number(m.total_cost_usd) || 0;
  let tin = 0;
  let tout = 0;
  let tcr = 0;
  let tcw = 0;
  const mu = m.modelUsage || {};
  for (const u of Object.values(mu)) {
    tin += (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0);
    tout += u.outputTokens || 0;
    tcr += u.cacheReadInputTokens || 0;
    tcw += u.cacheCreationInputTokens || 0;
  }
  // total_cost_usd y modelUsage son acumulados por sesión; al reanudar continúan del total guardado en la transcripción.
  // Los resultados de un fallo o de un error de arranque pueden venir en cero: nunca mueven la línea base hacia atrás.
  const zeroed = total === 0 && Object.keys(mu).length === 0;
  const prev = prod.costSeen || null;
  const seen = prev && prev.session === m.session_id ? prev : null;
  if (zeroed) { settleLiveCost(pid, prod); return; } // sin dato real: el estimado del turno queda como provisional
  const back = Boolean(seen && total + 1e-9 < seen.usd);
  // retroceso dentro del mismo proceso (resultado parcial): la base no se mueve y el estimado queda como provisional
  if (back && !lv.fresh) { settleLiveCost(pid, prod); return; }
  const fresh = lv.fresh;
  lv.fresh = false;
  const cont = Boolean(seen) && !back;
  let dCost: number;
  let dIn = 0;
  let dOut = 0;
  let dCr: number | undefined;
  let dCw: number | undefined;
  if (back) {
    // el proceso reanudado restauró un acumulado menor (el CLI guarda su cost-state solo al cerrar limpio): este turno
    // se cuenta por su estimado en vivo y la base pasa a este acumulado para que los siguientes cuenten completos. Lo
    // provisional anterior no está en este acumulado: queda contado tal cual, sin descontarse después.
    dCost = liveB;
    prod.provisionalUsd = undefined;
  } else {
    dCost = Math.max(0, cont ? total - seen!.usd : total);
    // costo provisional de un turno cortado (ya sumado a costUsd): solo se descuenta lo que el acumulado demuestra
    // incluir, es decir lo que el delta excede al estimado de este mismo turno; una sesión nueva no lo trae
    const prov = prod.provisionalUsd || 0;
    if (prov > 0) { if (cont) dCost -= Math.min(prov, Math.max(0, dCost - liveB)); prod.provisionalUsd = undefined; }
    // primer resultado de un proceso reanudado: la base restaurada puede estar bajo la vista, el turno nunca vale menos
    // que su propio estimado en vivo
    if (fresh && cont) dCost = Math.max(dCost, liveB);
    dIn = Math.max(0, cont && tin >= seen!.tin ? tin - seen!.tin : tin);
    dOut = Math.max(0, cont && tout >= seen!.tout ? tout - seen!.tout : tout);
    // tramos de caché: solo si la línea base ya los tenía (una base antigua sin ellos daría un delta inflado)
    const cacheKnown = !cont || (seen!.tcr !== undefined && seen!.tcw !== undefined);
    dCr = cacheKnown ? Math.max(0, cont && tcr >= seen!.tcr! ? tcr - seen!.tcr! : tcr) : undefined;
    dCw = cacheKnown ? Math.max(0, cont && tcw >= seen!.tcw! ? tcw - seen!.tcw! : tcw) : undefined;
  }
  prod.liveUsd = 0;
  prod.costSeen = back
    ? { session: m.session_id, usd: total, tin, tout, tcr, tcw }
    : { session: m.session_id, usd: total, tin: Math.max(tin, seen?.tin || 0), tout: Math.max(tout, seen?.tout || 0), tcr: Math.max(tcr, seen?.tcr || 0), tcw: Math.max(tcw, seen?.tcw || 0) };
  if (dCost <= 0 && dIn <= 0 && dOut <= 0) return;
  prod.costUsd = Math.round(((prod.costUsd || 0) + dCost) * 1e6) / 1e6;
  const models = Object.entries(mu).sort((a, b) => (b[1].costUSD || 0) - (a[1].costUSD || 0)).map(([k]) => k);
  const row: UsageRow = {
    id: id(), at: new Date().toISOString(), provider: "anthropic", stage: "produccion", projectId: pid,
    model: models[0] || load().settings.producerModel, inputTokens: dIn, outputTokens: dOut, cost: Math.round(dCost * 1e6) / 1e6, ms: m.duration_ms || 0,
    ...(dCr !== undefined && dCw !== undefined ? { cacheRead: Math.min(dCr, dIn), cacheWrite: Math.min(dCw, dIn) } : {}),
  };
  load().usage.push(row);
  event(pid, { type: "cost", text: `Costo de este tramo: US$${dCost.toFixed(2)} · total de la producción: US$${prod.costUsd.toFixed(2)}`, data: { cost: dCost, total: prod.costUsd, inputTokens: dIn, outputTokens: dOut, models } }, true);
}

/** Hay actividad del agente (nuevo turno o herramienta): cancela el cierre por inactividad y vuelve a "running" si había terminado. */
function activity(pid: string, lv: Live): void {
  if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
  const prod = prodOf(pid);
  if (prod && (prod.status === "done" || prod.status === "error") && !prod.pending) setStatus(pid, "running");
}

function sandboxError(detail: string): string {
  const d = String(detail || "").replace(/\s+/g, " ").trim().slice(-300);
  return `No se pudo activar el aislamiento (sandbox) del sistema para el productor, y la sesión no se inicia sin él por seguridad.${d ? ` Detalle: ${d}` : ""}`;
}

function handleMessage(pid: string, lv: Live, m: SDKMessage, dir: string): void {
  const prod = prodOf(pid);
  if (!prod) { lv.stopped = true; lv.abort.abort(); return; } // el proyecto se borró
  const sid = (m as { session_id?: string }).session_id;
  if (sid && prod.sessionId !== sid) { prod.sessionId = sid; persist(true); }

  if (m.type === "system" && m.subtype === "init") {
    if (m.apiKeySource && m.apiKeySource !== "ANTHROPIC_API_KEY") event(pid, { type: "status", text: `Aviso: la sesión no está usando la API key de Ajustes (origen: ${m.apiKeySource}).` });
    const studio = (m.mcp_servers || []).find((x) => x.name === "studio");
    if (studio && studio.status !== "connected") event(pid, { type: "error", text: `Las herramientas de la app no se conectaron (estado: ${studio.status}).` });
    return;
  }
  if ((m.type === "assistant" || m.type === "user") && !m.parent_tool_use_id) activity(pid, lv);
  if (m.type === "assistant") {
    // costo en vivo y nombres de herramientas: también de los subagentes (su gasto cuenta igual)
    const msgId = (m.message as unknown as { id?: string } | null)?.id || "";
    for (const b of (m.message?.content || []) as unknown as { type: string; id?: string; name?: string }[]) {
      if (b.type !== "tool_use" || !b.id || !b.name) continue;
      lv.toolNames.set(b.id, b.name);
      if (msgId) lv.toolBatch.set(b.id, msgId);
    }
    liveUsage(pid, lv, m);
    if (m.parent_tool_use_id) return; // mensajes internos de subagentes (crítico)
    if (m.error) {
      const ERR: Record<string, string> = {
        authentication_failed: "La API key de Anthropic no es válida. Revísala en Ajustes.",
        billing_error: "Tu cuenta de Anthropic no tiene saldo o hay un problema de facturación.",
        rate_limit: "Se alcanzó el límite de uso de la API de Anthropic. Espera un momento y escribe para continuar.",
        overloaded: "La API de Anthropic está saturada. Intenta de nuevo en unos minutos.",
        model_not_found: `El modelo del productor (${load().settings.producerModel}) no está disponible para tu key. Cámbialo en Ajustes.`,
        max_output_tokens: "La respuesta del modelo se cortó por longitud.",
      };
      const detail = ((m.message?.content || []) as unknown as { type: string; text?: string }[]).map((b) => (b.type === "text" ? b.text || "" : "")).join(" ").trim();
      lv.turnError = true;
      const wsHint = /not scoped to a workspace|anthropic-workspace-id/i.test(detail)
        ? "Tu API key es de organización y necesita el Workspace ID: cópialo en console.anthropic.com → Settings → Workspaces (empieza con wrkspc_) y pégalo en Ajustes → Claude (Anthropic)."
        : "";
      event(pid, { type: "error", text: wsHint || ERR[m.error] || `Error de la API (${m.error})${detail ? `: ${detail.slice(0, 300)}` : ""}` }, true);
      return;
    }
    const content = (m.message?.content || []) as unknown as { type: string; text?: string; name?: string; input?: unknown }[];
    for (const b of content) {
      if (b.type === "text" && b.text) for (const chunk of textChunks(b.text)) event(pid, { type: "assistant", text: chunk });
      else if (b.type === "tool_use" && b.name) {
        const inp = (b.input || {}) as Record<string, unknown>;
        // inferencia de etapa por si el agente no llamó a progress (solo avanza)
        const st = inferStage(b.name, inp);
        if (st) advanceStage(pid, st);
        const d = describeTool(b.name, inp, dir);
        if (d) event(pid, { type: "tool", text: d, data: { tool: b.name } });
      }
    }
    return;
  }
  if (m.type === "user") {
    // la app ya cortó el turno (tope o reintentos): los resultados que llegan son de herramientas canceladas por esa
    // interrupción, no fallos que el productor vaya a corregir ni intentos que sumen a las rachas
    if (lv.retryHit || lv.budgetHit) return;
    trackToolResults(pid, lv, m.message?.content); // también los fallos dentro de subagentes
    if (m.parent_tool_use_id) return;
    const content = m.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content as unknown as { type: string; is_error?: boolean; content?: unknown }[]) {
      if (b.type !== "tool_result" || !b.is_error) continue;
      const raw = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? (b.content as { text?: string }[]).map((x) => x.text || "").join(" ") : "";
      const msg = raw.replace(/<\/?tool_use_error>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (msg) event(pid, { type: "tool", text: `Un paso falló (el productor lo corrige): ${msg}` });
    }
    return;
  }
  if (m.type === "result") {
    account(pid, lv, m);
    const hadError = lv.turnError;
    lv.turnError = false;
    const budgetHit = lv.budgetHit;
    const retryHit = lv.retryHit;
    lv.budgetHit = false;
    lv.retryHit = false;
    lv.turnErrors = 0;
    lv.msgCost.clear();
    lv.toolNames.clear();
    lv.toolBatch.clear();
    // queued_turn_count > 0: el usuario escribió durante el turno y viene otro turno (y otro resultado) enseguida
    const queued = Number(m.queued_turn_count) || 0;
    if (budgetHit || retryHit) {
      // turno interrumpido por la app (tope o reintentos): el aviso ya se mostró; sin el error genérico.
      // Las herramientas que esperaban al usuario murieron con el turno: sus promesas se rechazan y una pregunta o
      // aprobación que siga pendiente se responde como mensaje nuevo (answerQuestion/decideApproval sin resolver).
      for (const r of lv.resolvers.values()) r.reject(new Error("El turno se interrumpió."));
      lv.resolvers.clear();
      const cur = prodOf(pid);
      if (cur && budgetHit && cur.pending?.type !== "budget") {
        // una pregunta o aprobación se coló durante la interrupción: el aviso de tope manda (la pregunta no gasta ronda)
        const cap = capOf(cur);
        const spent = spentOf(cur);
        if (cap > 0 && spent >= cap) {
          refundQuestion(cur);
          const data = budgetData(cap, spent);
          cur.pending = { type: "budget", data };
          event(pid, { type: "status", text: budgetText(cap, spent), data }, true);
        }
      }
      if (cur?.pending) { if (cur.status !== "waiting") setStatus(pid, "waiting"); else touch(pid); }
      // con un mensaje del usuario en cola el SDK corre ese turno igual: la producción sigue "running", no "error"
      else if (retryHit && cur && queued === 0) setStatus(pid, "error");
      else touch(pid);
    } else if (m.subtype === "success" && !m.is_error && !hadError) {
      const cur = prodOf(pid);
      if (cur && !cur.pending && queued === 0) {
        setStatus(pid, "done");
        // terminó en la última etapa con un render final: se cierra para el historial de tiempos
        const p = getProject(pid);
        const pr = cur.progress;
        if (p && pr && pr.current === pr.stages.length - 1 && (cur.renders || []).some((r) => r.mode === "final")) {
          const mode = modeOfProd(p, cur);
          // una sola muestra por producción: un seguimiento reabre la etapa y su cierre traería el tiempo acumulado
          closeCurrent(pr, Date.now(), cur.finalSampled ? undefined : (k, ms) => { recordSample(mode, k, ms); cur.finalSampled = true; });
          refreshEta(pr, mode, Date.now());
          persist(true);
        }
      }
    } else {
      const errs = "errors" in m && Array.isArray(m.errors) ? m.errors.join(" · ") : "";
      const sandboxFail = /sandbox/i.test(errs) || ("startup_failure_reason" in m && Boolean(m.startup_failure_reason) && /sandbox/i.test(lv.stderr));
      const why = sandboxFail ? sandboxError(errs || lv.stderr)
        : m.subtype === "error_max_turns" ? "Se alcanzó el máximo de turnos." : m.subtype === "error_max_budget_usd" ? "Se alcanzó el presupuesto máximo." : errs || ("result" in m ? String(m.result || "") : "") || "La sesión terminó con error.";
      if (!hadError) event(pid, { type: "error", text: sandboxFail ? why : `${why} Escribe un mensaje para continuar.` }, true);
      if (queued === 0 || sandboxFail) setStatus(pid, "error");
    }
    // con el costo real ya contado: aviso del 80 % y, si se llegó al tope, el pendiente "budget" (aunque el turno ya
    // haya terminado); solo si viene otro turno en cola hace falta interrumpir
    checkCap(pid, lv, true, queued > 0);
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    const cur = prodOf(pid);
    // sin otro turno en cola: recién ahora se prepara la carpeta que un mensaje de mitad de turno dejó pendiente; si
    // algo cambió (apoyos, kit), la nota entra como turno nuevo para que el agente lo aplique. Con un aviso de tope
    // pendiente o una herramienta esperando al usuario queda para el próximo mensaje (pushTurn/pushPrep la preparan)
    if (queued === 0) {
      lv.inTurn = false;
      const p = getProject(pid);
      const waits = Boolean(cur?.pending && lv.resolvers.has(cur.pending.data.id));
      if (lv.prepPending && p?.production && cur?.pending?.type !== "budget" && !waits && !lv.input.closed && !lv.stopped) {
        lv.prepPending = false;
        const prep = prepareDir(p, (p.production as ProdX).dir);
        if (prep) { noteEvent(pid, prep); lv.inTurn = true; lv.input.push(prep); setStatus(pid, "running"); }
      }
    }
    // sin una herramienta viva esperando (tope pendiente, pregunta de un turno interrumpido) el agente no espera nada:
    // la sesión se cierra por inactividad y se reanuda con la respuesta
    if (!lv.input.closed && !lv.inTurn && (!cur?.pending || !lv.resolvers.has(cur.pending.data.id))) lv.idle = setTimeout(() => lv.input.close(), IDLE_CLOSE_MS);
  }
}

// ---------------------------------------------------------------- lanzar una sesión
const DISALLOWED = [
  "AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "EnterWorktree", "ExitWorktree", "CronCreate", "CronDelete", "CronList",
  "ScheduleWakeup", "RemoteTrigger", "PushNotification", "Artifact", "SendFeedback", "ProposeSkills", "ProposeGoal", "Workflow", "Monitor",
  "WebFetch", // fuera del sandbox: podría sacar datos en la URL; los sitios del usuario van por mcp__studio__capture_site
];

// Lista blanca: solo estas variables del servidor pasan al agente (nada de claves de otros servicios ni de la app).
const ENV_ALLOW = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "TERM", "PLAYWRIGHT_BROWSERS_PATH"]);

function agentEnv(key: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (ENV_ALLOW.has(k) || /^LC_[A-Z_]+$/.test(k)) env[k] = v;
  }
  fs.mkdirSync(AGENT_HOME, { recursive: true });
  const tmp = AGENT_TMP;
  try { fs.mkdirSync(tmp, { recursive: true, mode: 0o700 }); fs.chmodSync(tmp, 0o700); } catch {}
  env.ANTHROPIC_API_KEY = key;
  const ws = load().settings.anthropicWorkspaceId;
  if (ws) {
    // Keys de organización sin workspace: el CLI del SDK solo aplica encabezados propios junto a una URL base explícita.
    env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    env.ANTHROPIC_CUSTOM_HEADERS = `anthropic-workspace-id: ${ws}`;
    env.ANTHROPIC_WORKSPACE_ID = ws;
  }
  env.CLAUDE_CONFIG_DIR = AGENT_HOME;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "creator-studio/0.3";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS = "1"; // un fallo de arranque (p. ej. sin sandbox) llega como resultado con su motivo
  env.TMPDIR = tmp; // temporales solo en la carpeta propia del agente (el sandbox no deja escribir en /tmp general)
  // temporal por usuario de Claude Code (el sandbox lo deja escribir): propio del agente, no el compartido /tmp/claude-<uid>
  // de las demás sesiones de Claude Code del equipo
  env.CLAUDE_CODE_TMPDIR = tmp;
  env.PYTHONUNBUFFERED = "1";
  env.NUMBA_CACHE_DIR = path.join(tmp, "numba"); // librosa/numba: el kit es de solo lectura dentro del sandbox
  env.MPLCONFIGDIR = path.join(tmp, "matplotlib");
  // Bash no tiene red: faster-whisper usa los modelos ya descargados en ~/.cache/huggingface
  env.HF_HUB_OFFLINE = "1";
  env.TRANSFORMERS_OFFLINE = "1";
  env.HF_HUB_DISABLE_TELEMETRY = "1";
  return env;
}

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean).map((x) => path.resolve(x)))];
const realOr = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
/** la ruta y su forma real (p. ej. /tmp → /private/tmp), para listas del sandbox */
const both = (p: string): string[] => [p, realOr(p)];

/** Instalación de un ejecutable (carpeta sobre bin/) si vive dentro de la carpeta personal (nvm, pyenv, asdf…). */
function installUnderHome(bin: string): string | null {
  const home = os.homedir();
  const real = realOr(bin);
  const prefix = path.dirname(path.dirname(real));
  return inside(real, home) && prefix !== home && !inside(home, prefix) ? prefix : null;
}

/** Rutas extra que Bash puede leer dentro de zonas bloqueadas (todas de solo lectura). */
function readReopen(dir: string, scope: GuardScope): string[] {
  const home = os.homedir();
  const out: string[] = [dir, scope.projectRoot, MOTION_DIR, NODE_MODULES, AGENT_TMP, path.join(home, ".cache", "huggingface")];
  // .venv del kit y el Python sobre el que se creó (pyvenv.cfg: home = …/bin)
  const venv = path.join(MOTION_DIR, ".venv");
  out.push(venv);
  try {
    const cfg = fs.readFileSync(path.join(realOr(venv), "pyvenv.cfg"), "utf8");
    const m = /^home\s*=\s*(.+)$/m.exec(cfg);
    if (m) { const pre = installUnderHome(path.join(m[1].trim(), "python3")); if (pre) out.push(pre); }
  } catch {}
  const venvPy = installUnderHome(path.join(venv, "bin", "python"));
  if (venvPy) out.push(venvPy);
  // Node que ejecuta la app (p. ej. ~/.nvm/versions/node/vX): lo usan los scripts del kit por Bash
  const nodePre = installUnderHome(process.execPath);
  if (nodePre) out.push(nodePre);
  // navegadores de Playwright (solo lectura; Chromium no corre en el sandbox, pero los scripts pueden consultar la ruta)
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(home, "Library", "Caches", "ms-playwright");
  if (fs.existsSync(pw)) out.push(pw);
  // archivos de solo lectura del proyecto (grabación, referencias, B-roll) y música de otros proyectos (compare_music.py)
  for (const x of scope.readExtra) {
    // nunca se reabre la carpeta personal entera, ni una carpeta que contenga los datos de la app o la propia app
    if (x === home || inside(home, x) || inside(DATA_DIR, x) || inside(APP_DIR, x)) continue;
    out.push(x);
  }
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const f = path.join(PROJECTS_DIR, d, "motion", "audio", "music.wav");
      if (inside(f, scope.projectRoot)) continue;
      try { if (fs.statSync(f).isFile()) out.push(f); } catch {}
    }
  } catch {}
  return uniq(out.flatMap(both));
}

/**
 * Carpeta temporal por usuario de Claude Code (/tmp/claude-<uid>): el CLI la impone como TMPDIR dentro del sandbox y
 * siempre la deja escribir, pero ahí también están los temporales de las demás sesiones de Claude Code del equipo.
 * Se reabre para el CLI y se bloquean (lectura y escritura) las entradas que ya existen, salvo las de este proyecto.
 */
function claudeUidTmp(dir: string): { root: string[]; foreign: string[] } {
  const uid = process.getuid?.();
  if (uid === undefined) return { root: [], foreign: [] };
  const root = path.join("/tmp", `claude-${uid}`);
  const own = new Set([dir, realOr(dir)].map((p) => p.replace(/[^A-Za-z0-9]/g, "-")));
  const foreign: string[] = [];
  try {
    for (const name of fs.readdirSync(realOr(root))) {
      if (/^cwd-/.test(name) || [...own].some((o) => name.startsWith(o))) continue;
      foreign.push(path.join(root, name));
    }
  } catch {}
  return { root: both(root), foreign: uniq(foreign.flatMap((f) => [f, path.join(realOr(root), path.basename(f))])) };
}

/**
 * Sandbox del sistema operativo para las órdenes de Bash del agente (si no se puede activar, la sesión no arranca).
 * Es el límite de LECTURA: se bloquea la carpeta personal, los datos de la app y la app entera, y solo se reabre lo
 * necesario (proyecto, kit, node_modules, .venv, temporal propio, modelos de voz, intérpretes). Sin red.
 */
export function sandboxFor(dir: string, scope?: GuardScope): NonNullable<Options["sandbox"]> {
  const home = os.homedir();
  const db = path.join(DATA_DIR, "studio.db");
  const sc: GuardScope = scope || { dir: path.resolve(dir), projectRoot: path.dirname(path.resolve(dir)), readExtra: [] };
  const cct = claudeUidTmp(dir);
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: {
      allowWrite: uniq([...both(dir), ...both(AGENT_TMP)]),
      denyWrite: uniq([path.join(dir, "node_modules"), path.join(dir, ".venv"), NODE_MODULES, MOTION_DIR, ...cct.foreign]),
      denyRead: uniq([
        ...both(home), ...both(DATA_DIR), ...both(APP_DIR),
        // temporales compartidos (otras apps, otras sesiones de Claude Code): solo se reabre AGENT_TMP
        // (solo la forma real: bloquear el enlace /tmp → /private/tmp impediría atravesarlo hacia /tmp/claude-<uid>)
        realOr("/tmp"), realOr(os.tmpdir()), ...(path.basename(os.tmpdir()) === "T" ? [realOr(path.dirname(os.tmpdir()))] : []),
        db, `${db}-wal`, `${db}-shm`, AGENT_HOME,
        path.join(home, ".ssh"), path.join(home, ".aws"), path.join(home, ".config"), path.join(home, ".netrc"),
        path.join(home, "Library", "Keychains"), path.join(home, ".claude"), path.join(home, ".gnupg"),
        ...cct.foreign,
      ]),
      allowRead: uniq([...readReopen(dir, sc), ...cct.root]),
    },
    network: {
      // Bash sin red: ningún dominio permitido (los modelos de voz ya están descargados; los sitios van por capture_site)
      allowedDomains: [],
      deniedDomains: ["localhost", "127.0.0.1", "::1", "0.0.0.0", "*.localhost"],
      strictAllowlist: true,
      allowLocalBinding: false,
    },
    credentials: { envVars: [{ name: "ANTHROPIC_API_KEY", mode: "deny" }] },
  };
}

function launch(p: Project, prompt: string, resume?: string | null): void {
  const key = anthropicKey();
  const pid = p.id;
  const prod = p.production as ProdX;
  const dir = prod.dir;
  const mode = prod.mode || modeOf(p);
  const settings = load().settings;

  const prev = live.get(pid);
  if (prev && !prev.stopped) throw new Error("El productor está terminando la sesión anterior. Reintenta en unos segundos.");
  try { ensureLinks(dir); } catch {}

  const lv: Live = {
    abort: new AbortController(), q: null, input: new InputQueue(), resolvers: new Map(), idle: null, stderr: "", stopped: false, turnError: false,
    msgCost: new Map(), toolNames: new Map(), toolBatch: new Map(), errStreak: new Map(), errBatch: new Map(), turnErrors: 0, budgetHit: false, retryHit: false, inTurn: true, prepPending: false,
    fresh: true,
  };
  live.set(pid, lv);
  prod.status = "running";
  touch(pid);
  persist(true);

  const ctx: StudioContext = {
    pid,
    dir,
    // una herramienta que termina después de detener la sesión (p. ej. un render largo) ya no publica nada
    emit: (ev) => { if (!lv.stopped) event(pid, ev, ev.type === "media"); },
    waitForUser: (action: PendingAction) => new Promise<unknown>((resolve, reject) => {
      const cur = prodOf(pid);
      // nunca se pisa un aviso de tope (la herramienta pudo arrancar mientras se interrumpía el turno) ni una
      // pregunta/aprobación que una herramienta viva sigue esperando; una pendiente vieja sin herramienta sí se reemplaza
      const pend = cur?.pending;
      const why = !cur || lv.stopped ? "La producción se detuvo."
        // budgetHit solo cuenta si el tope sigue alcanzado (tras subirlo, la marca vieja espera al próximo resultado)
        : pend?.type === "budget" || (lv.budgetHit && capOf(cur) > 0 && spentOf(cur) >= capOf(cur)) ? "El productor está en pausa por el tope de costo de este video: no preguntes ni pidas aprobación ahora; espera a que el usuario suba el tope."
        : pend && lv.resolvers.has(pend.data.id) ? "Ya hay otra pregunta o aprobación esperando al usuario: espera su respuesta antes de hacer otra."
        : "";
      if (why || !cur) {
        // la ronda de esta pregunta no se usó (useQuestionRound ya la había contado)
        if (cur && action.type === "question" && (cur.questionRounds || 0) > 0) { cur.questionRounds = (cur.questionRounds || 0) - 1; persist(true); }
        return reject(new Error(why || "La producción se detuvo."));
      }
      if (pend) refundQuestion(cur); // la pendiente vieja se descarta sin respuesta
      lv.resolvers.set(action.data.id, { resolve, reject });
      cur.pending = action;
      cur.status = "waiting";
      if (action.type === "question") event(pid, { type: "question", text: action.data.questions.map((q) => q.question).join(" · "), data: action.data }, true);
      else if (action.type === "approval") event(pid, { type: "approval", text: `${action.data.title}`, media: action.data.media, data: action.data }, true);
      else event(pid, { type: "status", text: budgetText(action.data.capUsd, action.data.spentUsd), data: action.data }, true);
    }),
    addRenders: (outs) => {
      const cur = prodOf(pid);
      // un render que termina después de detener o reiniciar la producción (p. ej. por una grabación nueva) no cuenta:
      // es de una sesión que ya no existe y su «at» fresco lo haría pasar por resultado actual
      if (!cur || lv.stopped) return;
      cur.renders = [...(cur.renders || []), ...outs];
      touch(pid);
      persist(true);
    },
    setStage: (key, note) => {
      if (!advanceStage(pid, key) || !note) return;
      event(pid, { type: "status", text: `${stageLabel(mode, key)}: ${note}` });
    },
    onlyFinalApproval: () => {
      const cur = getProject(pid);
      return Boolean(cur && onlyFinalApproval(cur, mode));
    },
    questionBudget: () => {
      const cur = prodOf(pid);
      return { used: cur?.questionRounds || 0, max: cur?.maxQuestionRounds ?? MAX_QUESTION_ROUNDS[mode] };
    },
    useQuestionRound: () => {
      const cur = prodOf(pid);
      if (!cur) return false;
      const used = cur.questionRounds || 0;
      const max = cur.maxQuestionRounds ?? MAX_QUESTION_ROUNDS[mode];
      if (used >= max) return false;
      cur.questionRounds = used + 1;
      persist(true);
      return true;
    },
  };

  const scope = scopeFor(p, dir);
  const canUseTool: CanUseTool = async (toolName, input) => {
    const g = guardToolUse(toolName, input, scope);
    return g.ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: g.reason };
  };
  const preToolUse: HookCallback = async (inp) => {
    if (inp.hook_event_name !== "PreToolUse") return {};
    const g = guardToolUse(inp.tool_name, (inp.tool_input || {}) as Record<string, unknown>, scope);
    return g.ok ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: g.reason } };
  };

  const options: Options = {
    abortController: lv.abort,
    cwd: dir,
    model: settings.producerModel || "claude-opus-5-5",
    env: agentEnv(key),
    settingSources: [],
    additionalDirectories: [MOTION_DIR, projectDir(pid)],
    mcpServers: { studio: createStudioServer(ctx) },
    tools: { type: "preset", preset: "claude_code" },
    disallowedTools: DISALLOWED,
    systemPrompt: { type: "preset", preset: "claude_code", append: buildSystemPrompt(p, mode, dir) },
    agents: {
      critico: {
        description: "Crítico de motion design independiente: revisa hojas de contacto, tiras y métricas de una ronda y puntúa los 8 criterios de reference/CRITIQUE.md. Úsalo en cada ronda de crítica.",
        prompt: `Eres el crítico de motion design descrito en ${path.join(MOTION_DIR, "skill", "reference", "CRITIQUE.md")}. Léelo y síguelo al pie de la letra. No escribiste la película ni la defiendes: juzgas solo lo que se ve y se oye, con evidencia. Mira cada imagen con Read. No edites film/ ni timeline.json: solo agrega tu ronda a docs/review_log.md. Responde en español.`,
        tools: ["Read", "Glob", "Grep", "Bash", "Edit", "Write", "mcp__studio__sheet", "mcp__studio__render_check", "mcp__studio__lint"],
      },
    },
    permissionMode: "default",
    sandbox: sandboxFor(dir, scope),
    canUseTool,
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    stderr: (d: string) => { lv.stderr = (lv.stderr + d).slice(-4000); },
    effort: settings.effort,
    title: p.title,
    ...(resume ? { resume } : {}),
  };

  lv.input.push(prompt);
  const q = query({ prompt: lv.input, options });
  lv.q = q;

  void (async () => {
    try {
      for await (const m of q) {
        if (lv.stopped) break; // detenida: lo que llegue después ya no se contabiliza (stopProduction lo cerró)
        handleMessage(pid, lv, m, dir);
        if (lv.stopped) break;
      }
    } catch (e) {
      if (!lv.stopped && !lv.abort.signal.aborted) {
        const tail = lv.stderr.trim().split(/\r?\n/).slice(-3).join(" · ").slice(-400);
        const msg = (e as Error)?.message || String(e);
        event(pid, { type: "error", text: /sandbox/i.test(msg + tail) ? sandboxError(`${msg} ${tail}`) : `El productor se detuvo por un error: ${msg}${tail ? ` (${tail})` : ""}. Escribe un mensaje para reanudar.` }, true);
        setStatus(pid, "error");
      }
    } finally {
      if (lv.idle) clearTimeout(lv.idle);
      for (const r of lv.resolvers.values()) r.reject(new Error("La sesión del productor terminó."));
      lv.resolvers.clear();
      lv.input.close();
      if (live.get(pid) === lv) live.delete(pid);
      const cur = prodOf(pid);
      // sin el resultado del turno el costo en vivo no se concilia: pasa a provisional (nunca queda liveUsd colgado)
      if (cur && !lv.stopped) settleLiveCost(pid, cur);
      if (cur && !lv.stopped && cur.status === "running") {
        // terminó sin resultado (proceso cerrado): se puede reanudar con un mensaje
        event(pid, { type: "status", text: "La sesión del productor se cerró. Escribe un mensaje para reanudarla." });
        cur.status = "error";
      }
      touch(pid);
      persist(true);
    }
  })();
}

/**
 * Preparación de la carpeta del motor cada vez que el agente va a leer algo nuevo (inicio, reanudación, mensaje, respuesta,
 * aprobación, tope): enlaces del motor, copia del kit en film/lib (repairEngineLibs) y apoyos aprobados (syncApoyos →
 * docs/apoyos.json y assets/apoyos/). El usuario puede aprobar, regenerar o quitar apoyos entre turnos. Devuelve la nota
 * para el agente ("" si nada cambió).
 */
function prepareDir(p: Project, dir: string): string {
  try { ensureLinks(dir); } catch {}
  const libs = libsNote(repairEngineLibs(dir));
  return [syncApoyos(p, dir), libs].filter(Boolean).join("\n\n");
}

/** Muestra en el chat la primera línea de una nota de la app para el agente. */
function noteEvent(pid: string, note: string): void {
  if (note) event(pid, { type: "status", text: note.split("\n")[0].replace(/: relee.*$/, ".") });
}

/** Texto para la sesión viva con la nota de preparación delante (prepareDir); la nota también se avisa en el chat. */
function withPrep(p: Project, text: string): string {
  const prep = prepareDir(p, (p.production as ProdX).dir);
  noteEvent(p.id, prep);
  return prep ? `${prep}\n\n${text}` : text;
}

/**
 * Mensaje nuevo para la sesión viva. Durante un turno (el agente puede estar renderizando o corriendo lint) NO se toca la
 * carpeta del motor: el mensaje entra ya (el CLI lo intercala entre rondas de herramientas) y la preparación (prepareDir:
 * borrar o copiar apoyos, reponer el kit) queda pendiente para cuando termine el turno. Fuera de un turno se prepara la
 * carpeta y la nota va delante del mensaje.
 */
function pushTurn(p: Project, lv: Live, text: string): void {
  if (lv.inTurn) { lv.prepPending = true; lv.input.push(text); return; }
  lv.inTurn = true;
  lv.prepPending = false;
  lv.input.push(withPrep(p, text));
}

/** Respuesta entregada a una herramienta que esperaba (pregunta/aprobación): si los apoyos o el kit cambiaron mientras
 *  tanto, la nota entra como mensaje aparte en la cola de la sesión viva. */
function pushPrep(p: Project, lv: Live): void {
  // el agente está detenido en esa herramienta (no renderiza): se prepara antes de que le llegue la respuesta
  lv.prepPending = false;
  const prep = prepareDir(p, (p.production as ProdX).dir);
  if (!prep) return;
  noteEvent(p.id, prep);
  lv.input.push(prep);
}

function resumeWith(p: Project, text: string): void {
  const prod = p.production as ProdX;
  text = withPrep(p, text);
  // reanudar con un mensaje, una respuesta o al subir el tope: la barra existe y coincide con el modo
  // (producciones guardadas antes de la barra de progreso, o tras un cambio de modo)
  prepareProgress(prod, prod.mode || modeOf(p), false, false);
  if (prod.sessionId) launch(p, `${resumeNote()}\n\n${text}`, prod.sessionId);
  else launch(p, `${buildKickoff(p, prod.mode || modeOf(p))}\n\n${text}`);
}

// ---------------------------------------------------------------- API del módulo (contrato)
/** Si la sesión viva está cerrando su entrada (inactividad), no se puede encolar ni lanzar otra: error claro. */
function assertNotClosing(lv: Live | undefined): void {
  if (lv && (lv.stopped || lv.input.closed)) throw new Error("El productor está terminando la sesión anterior. Reintenta en unos segundos.");
}

/** Vuelve a copiar docs/style/ si el estilo del proyecto cambió desde que se preparó la carpeta. Devuelve la nota para el agente. */
function syncStyle(p: Project, prod: ProdX, dir: string, restyle: boolean): string {
  const cur = p.styleId || null;
  const prevKnown = prod.styleId !== undefined;
  const changed = (prevKnown && (prod.styleId || null) !== cur) || restyle;
  prod.styleId = cur;
  if (!changed) return "";
  const style = findStyle(cur);
  copyStyle(style, dir);
  return style
    ? `El usuario cambió el estilo a "${style.name}": relee docs/style/ y rehaz el diseño.`
    : "El usuario quitó el estilo del proyecto: ignora la guía anterior de docs/style/ y define el estilo con él.";
}

/** Una entrada de docs/apoyos.json (lo que lee el productor). Tiempos en segundos. */
export interface ApoyoDoc {
  id: string;
  tipo: Apoyo["tipo"];
  modo: Apoyo["modo"];
  posicion: Apoyo["posicion"];
  contenido: string;
  animacion: Apoyo["animacion"];
  datos: string[];
  frase: string;
  /** tramo en la grabación original */
  original: { s: number; e: number };
  /** tramo en el corte (edit/cut.mp4); null si no hay tramos del corte o si el corte lo quitó entero */
  corte: { s: number; e: number } | null;
  /** archivo dentro de la carpeta del motor (desde film/index.html: "../" + archivo); null si no tiene */
  archivo: string | null;
  /** false: aprobado pero no se puede insertar (sin archivo o sin datos para su animación): el productor lo salta */
  usable: boolean;
  /** por qué no es usable (solo cuando usable es false) */
  motivo?: string;
}

const APOYO_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".m4v"]);
const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Copia los archivos de los apoyos APROBADOS a <motion>/assets/apoyos/<id>.<ext> y escribe docs/apoyos.json con sus
 * tiempos en la grabación original y en el corte (mapToCut con p.edit.ranges). Quita de assets/apoyos los archivos de
 * apoyos que ya no están. Devuelve una nota para el agente si la lista cambió desde la última vez ("" si no). Nunca lanza.
 */
export function syncApoyos(p: Project, dir: string): string {
  try {
    const pdir = path.resolve(projectDir(p.id));
    const docFile = path.join(dir, "docs", "apoyos.json");
    const approved = (p.apoyos || []).filter((a) => a && a.aprobado).sort((a, b) => a.inicio_s - b.inicio_s);
    const had = fs.existsSync(docFile);
    if (!approved.length && !had) return "";
    const outDir = path.join(dir, "assets", "apoyos");
    fs.mkdirSync(outDir, { recursive: true });
    const ranges = p.edit?.ranges?.length ? p.edit.ranges : null;
    const realP = (() => { try { return fs.realpathSync(pdir); } catch { return pdir; } })();
    const keep = new Set<string>();
    const docs: ApoyoDoc[] = approved.map((a) => {
      const safeId = String(a.id).replace(/[^\w-]/g, "_") || "apoyo";
      let archivo: string | null = null;
      if (a.archivo) {
        try {
          const src = path.resolve(pdir, a.archivo);
          const real = fs.realpathSync(src);
          const ext = path.extname(real).toLowerCase();
          // solo archivos regulares de la carpeta del proyecto y de tipos conocidos
          if (real.startsWith(realP + path.sep) && fs.statSync(real).isFile() && APOYO_EXT.has(ext)) {
            const name = `${safeId}${ext === ".jpeg" ? ".jpg" : ext}`;
            const dst = path.join(outDir, name);
            const ss = fs.statSync(real);
            let same = false;
            try { const ds = fs.lstatSync(dst); same = ds.isFile() && ds.size === ss.size && ds.mtimeMs >= ss.mtimeMs; } catch {}
            if (!same) {
              fs.rmSync(dst, { force: true });
              fs.copyFileSync(real, dst);
            }
            keep.add(name);
            archivo = `assets/apoyos/${name}`;
          }
        } catch {}
      }
      const s = r2(a.inicio_s), e = r2(a.fin_s);
      const m = ranges ? mapToCut(a.inicio_s, a.fin_s, ranges) : null;
      const datos = Array.isArray(a.datos) ? a.datos.map(String) : [];
      const motivo = apoyoSkip({ tipo: a.tipo, animacion: a.animacion, datos }, Boolean(archivo));
      return {
        id: a.id, tipo: a.tipo, modo: a.modo, posicion: a.posicion, contenido: a.contenido || "", animacion: a.animacion,
        datos, frase: a.frase || "",
        original: { s, e }, corte: m ? { s: r2(m.s), e: r2(m.e) } : null, archivo,
        usable: !motivo, ...(motivo ? { motivo } : {}),
      };
    });
    const before = had ? fs.readFileSync(docFile, "utf8") : null;
    // solo se borra lo que la app escribió y ya no corresponde: los archivos que el docs/apoyos.json anterior listaba y el
    // nombre de app (<id>.<ext>) de los apoyos del proyecto que ya no están aprobados. Un archivo que el productor guardó
    // ahí (un recorte, <id>_card.png) no se toca: el film puede estar usándolo
    const appNames = new Set<string>();
    try {
      const prev = before ? JSON.parse(before) : [];
      if (Array.isArray(prev)) for (const d of prev) {
        const m = typeof d?.archivo === "string" ? /^assets\/apoyos\/([^/\\]+)$/.exec(d.archivo) : null;
        if (m) appNames.add(m[1]);
      }
    } catch {}
    const ownIds = new Set((p.apoyos || []).map((a) => String(a?.id ?? "").replace(/[^\w-]/g, "_")));
    const appFile = (f: string): boolean => {
      if (appNames.has(f)) return true;
      const ext = path.extname(f).toLowerCase();
      return APOYO_EXT.has(ext) && ownIds.has(f.slice(0, -ext.length));
    };
    for (const f of fs.readdirSync(outDir)) if (!keep.has(f) && appFile(f)) fs.rmSync(path.join(outDir, f), { recursive: true, force: true });
    const text = JSON.stringify(docs, null, 2) + "\n";
    if (before === text) return "";
    fs.mkdirSync(path.dirname(docFile), { recursive: true });
    fs.writeFileSync(docFile, text);
    if (!docs.length) return "El usuario quitó los apoyos visuales aprobados: docs/apoyos.json quedó vacío. Saca del film los insertos que venían de esos apoyos.";
    const unusable = docs.filter((d) => !d.usable).length;
    return `Los apoyos visuales aprobados cambiaron (${docs.length}): relee docs/apoyos.json y ajusta los insertos (son obligatorios en sus tiempos de corte; archivos en assets/apoyos/).${unusable ? ` ${unusable} no se pueden usar (usable: false, sin archivo o sin datos): sáltalos; no los inventes, generes ni rellenes.` : ""}`;
  } catch (e) {
    console.warn(`[productor ${p.id}] no se pudieron sincronizar los apoyos: ${(e as Error)?.message || e}`);
    return "";
  }
}

/** Aviso para el agente cuando repairEngineLibs repuso una copia de film/lib/inserts.js o captions.js que había cambiado ("" si no). */
function libsNote(done: string[]): string {
  const files = done.filter((d) => d.includes("repuesta")).map((d) => d.replace(/ \(repuesta\)$/, ""))
    .filter((f) => f === "film/lib/inserts.js" || f === "film/lib/captions.js");
  return files.length
    ? `La app repuso ${files.join(" y ")} con la versión del kit (es de solo lectura y se repone en cada inicio). Si la habías editado, esos cambios ya no están: pon tus ajustes en film.js (o en timeline.json → captions) y vuelve a correr lint.mjs antes de renderizar.`
    : "";
}

/** Etapas, reloj y rondas de preguntas al iniciar o reanudar: se reinician en una sesión nueva, al cambiar de modo o de estilo. */
function prepareProgress(prod: ProdX, mode: ProductionMode, fresh: boolean, reset: boolean): void {
  if (fresh) prod.questionRounds = 0;
  else if (prod.questionRounds === undefined) prod.questionRounds = 0;
  if (fresh || prod.maxQuestionRounds === undefined || reset) prod.maxQuestionRounds = MAX_QUESTION_ROUNDS[mode];
  if (!prod.progress || !sameStages(prod.progress, mode) || reset) {
    const now = Date.now();
    prod.progress = initProgress(mode);
    prod.finalSampled = false;
    // una sesión nueva arranca por la primera etapa; una que se reanuda (con sessionId) puede ir mucho más adelante:
    // queda en -1 hasta que el agente (progress) o la inferencia por herramientas marquen la etapa real
    if (!prod.sessionId) startStage(prod.progress, prod.progress.stages[0].key, now);
    refreshEta(prod.progress, mode, now);
  }
}

/** Valida el tope que llega del cliente (US$ >= 0; 0 = el de Ajustes). */
function parseCap(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 10_000) throw new Error("El tope de costo debe ser un número en US$ mayor o igual a 0 (0 = el de Ajustes).");
  return Math.round(v * 100) / 100;
}

/**
 * Chequeo barato de lo que startProduction necesita (API key de Anthropic y entorno de Python del motor), sin arrancar
 * nada. Lanza los mismos errores en español que startProduction.
 */
export function productionPreflight(): void {
  anthropicKey();
  const env = motionEnv();
  if (!env.python) throw new Error(env.issues.find((i) => /pyenv\.sh/.test(i)) || 'Falta el entorno de Python del motor: ejecuta "sh motion/scripts/pyenv.sh" (necesita Python 3.12).');
}

/**
 * Scaffold nuevo de la carpeta del motor. En modo talking con marca activa aplica el preset de marca (colores, acento de
 * subtítulos y logo); si el preset falla, se registra y se sigue sin él (nunca bloquea la producción).
 */
function scaffoldFresh(p: Project, mode: ProductionMode, flags: StartFlags | undefined): string {
  const style = findStyle(p.styleId);
  let preset: BrandPreset | null = null;
  if (mode === "talking") {
    try { preset = brandPresetFor(p, flags, style); }
    catch (e) { console.warn(`[productor ${p.id}] no se pudo preparar el preset de marca: ${(e as Error)?.message || e}`); }
  }
  if (!preset) return scaffoldMotion(p, { style });
  try {
    return scaffoldMotion(p, { style, presetDir: preset.presetDir, timelinePatch: preset.timelinePatch, extraFiles: preset.extraFiles });
  } catch (e) {
    console.warn(`[productor ${p.id}] falló el scaffold con el preset de marca; se sigue sin él: ${(e as Error)?.message || e}`);
    // lo que el intento con preset alcanzó a dejar (preset.json, logo) no debe hacer creer que la marca quedó aplicada
    const mdir = path.join(projectDir(p.id), "motion");
    try { fs.rmSync(path.join(mdir, "preset.json"), { force: true }); fs.rmSync(path.join(mdir, "assets", "brand"), { recursive: true, force: true }); } catch {}
    return scaffoldMotion(p, { style });
  } finally {
    preset.cleanup();
  }
}

export function startProduction(p: Project, opts: { mode?: "reel" | "clase" | "talking"; brief?: string; changeMode?: boolean; restyle?: boolean; flags?: unknown; capUsd?: number; /** aviso de la app para el agente (no es un mensaje del usuario), p. ej. «hay un corte nuevo» */ notice?: string }): void {
  anthropicKey(); // error claro en español antes de tocar nada
  const capUsd = parseCap(opts.capUsd);
  productionPreflight();
  const existing = p.production as ProdX | null | undefined;
  const brief = opts.brief?.trim();
  const notice = opts.notice?.trim() || "";
  const flags = parseStartFlags(opts.flags);
  const now = new Date().toISOString();

  const lv = live.get(p.id);
  // tope de costo: no se lanza ni se reanuda pasado el tope (salvo que este inicio traiga uno mayor). Se revisa recién
  // después de confirmar que este inicio procede, para que un pedido repetido no deje un aviso con un tope sin guardar
  if (lv) {
    assertNotClosing(lv);
    // un aviso de tope pendiente no bloquea: este inicio puede traer un tope mayor (guardCap lo descarta o lo mantiene)
    const budgetOnly = existing?.pending?.type === "budget";
    if (!existing || existing.status === "running" || (!budgetOnly && (existing.status === "waiting" || existing.pending))) throw new Error("La producción de este proyecto ya está en marcha.");
    guardCap(p, capUsd);
    // sesión viva e inactiva (turno terminado): el pedido entra por la cola de mensajes, sin lanzar otro proceso
    const prep = prepareDir(p, existing.dir);
    const note = [syncStyle(p, existing, existing.dir, Boolean(opts.restyle)), prep].filter(Boolean).join("\n\n");
    if (flags) existing.flags = flags;
    if (capUsd !== undefined) existing.capUsd = capUsd;
    prepareProgress(existing, existing.mode || modeOf(p), false, Boolean(opts.restyle));
    resetRetries(lv);
    const text = [note, notice, flagsText(p, flags), brief].filter(Boolean).join("\n\n") || "Continúa la producción desde donde quedaste.";
    p.updatedAt = now;
    if (brief) event(p.id, { type: "user", text: brief });
    if (note) event(p.id, { type: "status", text: note.split("\n")[0].replace(/: relee.*$/, ".") });
    if (notice) event(p.id, { type: "status", text: notice.split("\n")[0] });
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    lv.inTurn = true; // sesión inactiva (sin turno): la carpeta ya se preparó arriba
    lv.prepPending = false;
    lv.input.push(text);
    setStatus(p.id, "running");
    return;
  }

  if (existing) guardCap(p, capUsd);
  const reuse = Boolean(existing?.dir && isScaffolded(existing.dir));
  // al reanudar se conserva el modo de la producción salvo que el cliente pida cambiarlo explícitamente (changeMode)
  const mode: ProductionMode = existing?.mode && existing.sessionId && !opts.changeMode ? existing.mode : opts.mode || existing?.mode || modeOf(p);
  const dir = reuse ? existing!.dir : scaffoldFresh(p, mode, flags ?? existing?.flags);
  const prep = prepareDir(p, dir);
  let prod: ProdX;
  let note = "";
  const fresh = !existing;
  if (existing) {
    prod = existing;
    prod.dir = dir;
    refundQuestion(prod); // si quedaba una pregunta de una sesión anterior, el agente la volverá a hacer (sin gastar otra ronda)
    prod.pending = null;
    note = reuse ? syncStyle(p, prod, dir, Boolean(opts.restyle)) : ((prod.styleId = p.styleId || null), "");
    if (prod.sessionId) note = [note, prep].filter(Boolean).join("\n\n");
  } else {
    prod = { dir, status: "running", sessionId: null, pending: null, events: [], renders: [], costUsd: 0, startedAt: now, styleId: p.styleId || null };
    p.production = prod;
  }
  const modeChanged = Boolean(existing?.mode && existing.mode !== mode);
  prod.mode = mode;
  if (flags) prod.flags = flags;
  if (capUsd !== undefined) prod.capUsd = capUsd;
  prepareProgress(prod, mode, fresh, !prod.sessionId || modeChanged || Boolean(opts.changeMode) || Boolean(opts.restyle));
  p.updatedAt = now;
  if (brief) event(p.id, { type: "user", text: brief });
  if (note) event(p.id, { type: "status", text: note.split("\n")[0].replace(/: relee.*$/, ".") });
  if (notice && prod.sessionId) event(p.id, { type: "status", text: notice.split("\n")[0] });
  event(p.id, { type: "status", text: prod.sessionId ? "Reanudando la producción…" : "Iniciando la producción…" }, true);
  const extra = [note, notice, flagsText(p, flags), brief].filter(Boolean).join("\n\n");
  if (prod.sessionId) launch(p, `${resumeNote()}\n\n${extra || "Continúa la producción desde donde quedaste."}`, prod.sessionId);
  else launch(p, buildKickoff(p, mode, brief, flags));
}

export function sendMessage(p: Project, text: string, /** aviso de la app para el agente (no se muestra como mensaje del usuario) */ notice?: string): void {
  const t = String(text || "").trim();
  if (!t) throw new Error("Escribe un mensaje.");
  if (!p.production) return startProduction(p, { mode: modeOf(p), brief: t, notice });
  const n = notice?.trim() || "";
  const forAgent = n ? `${n}\n\n${t}` : t;
  const lv = live.get(p.id);
  assertNotClosing(lv);
  if (!lv) anthropicKey();
  const prod = p.production as ProdX;
  const pend = prod.pending;
  const toolWaiting = Boolean(lv && pend && lv.resolvers.has(pend.data.id));
  if (!toolWaiting) {
    guardCap(p);
    // una pregunta/aprobación que ninguna herramienta viva espera (reinicio, turno interrumpido): el mensaje del
    // usuario la reemplaza; si el agente la necesita, la vuelve a hacer sin gastar otra ronda
    if (prod.pending && prod.pending.type !== "budget") { refundQuestion(prod); prod.pending = null; }
  }
  event(p.id, { type: "user", text: t }, true);
  if (lv) {
    resetRetries(lv); // el usuario escribió: los reintentos vuelven a empezar
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    pushTurn(p, lv, forAgent);
    if (!toolWaiting) setStatus(p.id, "running");
  } else resumeWith(p, forAgent);
}

export function answerQuestion(p: Project, questionId: string, answers: Record<string, string>): void {
  const prod = p.production;
  const pend = prod?.pending;
  if (!prod || !pend || pend.type !== "question" || pend.data.id !== questionId) throw new Error("Esa pregunta ya no está pendiente.");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Respuestas inválidas.");
  const clean: QuestionAnswers = {};
  for (const [k, v] of Object.entries(answers)) clean[String(k)] = Array.isArray(v) ? v.map(String).join(", ") : String(v ?? "");
  const lines = pend.data.questions.map((q, i) => `${q.question} → ${clean[q.question] ?? clean[String(i)] ?? "(sin respuesta)"}`);
  const lv = live.get(p.id);
  const r = lv?.resolvers.get(questionId);
  if (!r) assertNotClosing(lv);
  if (!r && !lv) anthropicKey();
  if (!r) guardCap(p); // sin herramienta esperando se reanuda la sesión: no pasado el tope
  prod.pending = null;
  prod.status = "running";
  event(p.id, { type: "answer", text: lines.join("\n"), data: clean }, true);
  if (lv?.idle) { clearTimeout(lv.idle); lv.idle = null; }
  if (r && lv) { lv.resolvers.delete(questionId); r.resolve(clean); pushPrep(p, lv); return; }
  const text = `Respuestas a tus preguntas:\n${lines.map((l) => `- ${l}`).join("\n")}`;
  if (lv) { resetRetries(lv); pushTurn(p, lv, text); } // entra como turno nuevo: los reintentos vuelven a empezar
  else resumeWith(p, text);
}

export function decideApproval(p: Project, approvalId: string, approved: boolean, feedback?: string): void {
  const prod = p.production;
  const pend = prod?.pending;
  if (!prod || !pend || pend.type !== "approval" || pend.data.id !== approvalId) throw new Error("Esa aprobación ya no está pendiente.");
  const fb = String(feedback || "").trim();
  if (!approved && !fb) throw new Error("Cuéntale al productor qué cambiar.");
  const lv = live.get(p.id);
  const r = lv?.resolvers.get(approvalId);
  if (!r) assertNotClosing(lv);
  if (!r && !lv) anthropicKey();
  if (!r) guardCap(p);
  prod.pending = null;
  prod.status = "running";
  const decision: ApprovalDecision = { approved: Boolean(approved), ...(fb ? { feedback: fb } : {}) };
  event(p.id, { type: "decision", text: `${approved ? "Aprobado" : "Cambios pedidos"}: ${pend.data.title}${fb ? ` — ${fb}` : ""}`, data: { approvalId, kind: pend.data.kind, ...decision } }, true);
  if (lv?.idle) { clearTimeout(lv.idle); lv.idle = null; }
  if (r && lv) { lv.resolvers.delete(approvalId); r.resolve(decision); pushPrep(p, lv); return; }
  const text = approved
    ? `El usuario APROBÓ "${pend.data.title}" (${pend.data.kind}).${fb ? ` Comentario: ${fb}` : ""} Continúa.`
    : `El usuario NO aprobó "${pend.data.title}" (${pend.data.kind}). Cambios pedidos: ${fb}. Aplícalos y vuelve a pedir aprobación.`;
  if (lv) { resetRetries(lv); pushTurn(p, lv, text); } // entra como turno nuevo: los reintentos vuelven a empezar
  else resumeWith(p, text);
}

/**
 * Respuesta al aviso de tope: `raiseTo` (mayor a lo gastado) sube el tope de este video y reanuda al productor;
 * `stop` detiene la producción. Error si ese aviso ya no está pendiente.
 */
export function resolveBudget(p: Project, budgetId: string, opts: { raiseTo?: number; stop?: boolean }): void {
  const prod = p.production as ProdX | null | undefined;
  const pend = prod?.pending;
  if (!prod || !pend || pend.type !== "budget" || pend.data.id !== budgetId) throw new Error("Ese aviso de tope ya no está pendiente.");
  if (opts.stop) { stopProduction(p); return; }
  const spent = spentOf(prod);
  const raise = Number(opts.raiseTo);
  if (!Number.isFinite(raise) || raise > 10_000) throw new Error("Indica el nuevo tope en US$.");
  if (raise <= spent) throw new Error(`El nuevo tope debe ser mayor a lo que llevas (US$${spent.toFixed(2)}).`);
  const lv = live.get(p.id);
  if (lv) assertNotClosing(lv);
  else anthropicKey();
  const cap = Math.round(raise * 100) / 100;
  prod.capUsd = cap;
  prod.capWarned = undefined;
  prod.pending = null;
  prod.status = "running";
  event(p.id, { type: "status", text: `Tope subido a US$${usd(cap)} para este video. El productor continúa.` }, true);
  const text = `Continúa donde quedaste; el usuario subió el tope a US$${usd(cap)}.`;
  if (lv) {
    resetRetries(lv);
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    pushTurn(p, lv, text);
  } else resumeWith(p, text);
}

/**
 * Grabación nueva: la producción anterior quedó hecha sobre otro video. Se detiene si estaba trabajando (no sigue
 * gastando) y se olvida su sesión y sus renders, para que la próxima plantilla arranque con un kickoff nuevo sobre la
 * grabación nueva (la carpeta del motor se reutiliza). No hace nada si no hay producción.
 */
export function resetProductionForNewRecording(p: Project): void {
  const prod = p.production as ProdX | null | undefined;
  if (!prod) return;
  if (live.has(p.id) || prod.status === "running" || prod.status === "waiting") stopProduction(p);
  settleLiveCost(p.id, prod);
  prod.pending = null;
  prod.sessionId = null;
  prod.renders = [];
  prod.finalSampled = false;
  prod.status = "idle";
  // empieza de cero de verdad: rondas de preguntas, avance y gasto contra el tope cuentan por grabación. costUsd sigue
  // siendo el total gastado en el proyecto (no se pierde); el tope cuenta desde aquí (capBaseUsd). capUsd se conserva.
  prod.questionRounds = 0;
  prod.maxQuestionRounds = undefined;
  prod.progress = undefined;
  prod.capBaseUsd = prod.costUsd || 0;
  prod.capWarned = undefined;
  event(p.id, { type: "status", text: "Grabación nueva: la próxima producción empieza de cero sobre ella." }, true);
}

/**
 * «Aprobar video» en Edición mientras el productor espera la aprobación del video final: cuenta como esa aprobación.
 * Con la herramienta viva esperando, se le responde (el agente cierra su turno); sin ella (p. ej. tras un reinicio) no
 * se reanuda la sesión (no gasta): la producción queda "done". Devuelve true si había esa aprobación pendiente.
 */
export function approveFinalFromEdit(p: Project): boolean {
  const prod = p.production as ProdX | null | undefined;
  const pend = prod?.pending;
  if (!prod || !pend || pend.type !== "approval" || pend.data.kind !== "final") return false;
  const lv = live.get(p.id);
  if (lv?.resolvers.has(pend.data.id)) { decideApproval(p, pend.data.id, true, "Aprobado desde Edición."); return true; }
  prod.pending = null;
  setStatus(p.id, "done");
  event(p.id, { type: "decision", text: `Aprobado: ${pend.data.title} (desde Edición)`, data: { approvalId: pend.data.id, kind: pend.data.kind, approved: true } }, true);
  return true;
}

/**
 * Detiene la sesión viva (si hay) y deja la producción en "idle". Llamarla también antes de borrar un proyecto
 * (DELETE /api/projects/:id en index.ts), para que el proceso del agente no siga escribiendo en una carpeta borrada.
 */
export function stopProduction(p: Project): void {
  const lv = live.get(p.id);
  if (lv) {
    lv.stopped = true;
    if (lv.idle) clearTimeout(lv.idle);
    for (const r of lv.resolvers.values()) r.reject(new Error("La producción se detuvo."));
    lv.resolvers.clear();
    lv.input.close();
    lv.abort.abort();
    try { lv.q?.close(); } catch {}
    live.delete(p.id);
  }
  const prod = p.production as ProdX | null | undefined;
  if (!prod) return;
  settleLiveCost(p.id, prod); // el turno cortado no trae resultado: su costo en vivo pasa a provisional
  refundQuestion(prod); // una pregunta sin responder no gasta su ronda
  prod.pending = null;
  prod.status = "idle";
  event(p.id, { type: "status", text: "Producción detenida. Escribe un mensaje para reanudarla." }, true);
}

/**
 * Recuperación al arrancar el servidor (llamar una vez tras load()): las sesiones que figuraban "running" ya no existen
 * → pasan a "error" con nota de reanudación; las que esperaban al usuario conservan la pregunta (al responder se reanuda con resume).
 */
export function recoverProductions(): void {
  let changed = false;
  for (const p of load().projects) {
    const prod = p.production;
    if (!prod || live.has(p.id)) continue;
    // el turno que corría al apagarse no trajo resultado: su costo en vivo pasa a provisional
    if (settleLiveCost(p.id, prod as ProdX)) changed = true;
    // el reloj no corre mientras la app estuvo apagada: se pausa en el último cambio guardado
    if (prod.progress?.runningSince) {
      const at = Date.parse(prod.updatedAt || "") || Date.now();
      pauseClock(prod.progress, Math.max(at, Date.parse(prod.progress.runningSince) || 0));
      changed = true;
    }
    if (prod.status === "running") {
      prod.status = "error";
      prod.events = prod.events || [];
      prod.events.push({ id: id(), at: new Date().toISOString(), type: "error", text: "La app se reinició mientras el productor trabajaba. Escribe un mensaje para reanudar la sesión donde quedó." });
      if (prod.events.length > MAX_EVENTS) prod.events.splice(0, prod.events.length - MAX_EVENTS);
      changed = true;
    }
  }
  if (changed) save();
}
