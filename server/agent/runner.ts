// Productor: una sesión del SDK de agentes de Claude por proyecto, que produce el video con el motor motion-reel
// como en las sesiones de Claude Code. Los mensajes del SDK se vuelcan a project.production.events; las preguntas
// y aprobaciones quedan en production.pending hasta que la interfaz responde (answerQuestion / decideApproval).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKMessage, SDKUserMessage, SDKResultMessage, CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { load, save, id, getProject, projectDir, APP_DIR, DATA_DIR, MOTION_DIR, PROJECTS_DIR } from "../db.ts";
import { scaffoldMotion, motionEnv, ensureLinks, copyStyle, isScaffolded } from "../motion/kit.ts";
import { createStudioServer, realPrefix } from "./tools.ts";
import type { StudioContext, QuestionAnswers, ApprovalDecision } from "./tools.ts";
import { buildSystemPrompt, buildKickoff, resumeNote, modeOf, AGENT_TMP, parseStartFlags, flagsText } from "./prompt.ts";
import { getStyle as findStyleById } from "../styles/store.ts";
const findStyle = (sid: string | null | undefined) => (sid ? findStyleById(sid) ?? null : null);
import type { ProductionMode, StartFlags } from "./prompt.ts";
import type { PendingAction, Production, ProductionEvent, ProductionStatus, Project, UsageRow } from "../../shared/types.ts";

// Campos internos extra que se guardan junto a Production (no forman parte del contrato de la interfaz).
type ProdX = Production & {
  mode?: ProductionMode;
  /** último total acumulado visto en los resultados del SDK, para registrar solo el incremento */
  costSeen?: { session: string; usd: number; tin: number; tout: number; tcr?: number; tcw?: number };
  /** estilo con el que se preparó docs/style/ (para detectar cambios de estilo al reanudar) */
  styleId?: string | null;
  /** opciones de la tarjeta de inicio (marca, música, formatos); las leen el system prompt y las herramientas */
  flags?: StartFlags;
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
}
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
  if (p) { p.updatedAt = now; if (p.production) p.production.updatedAt = now; }
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
  touch(pid);
  persist(true);
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

function account(pid: string, m: SDKResultMessage): void {
  const prod = prodOf(pid);
  const p = getProject(pid);
  if (!prod || !p) return;
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
  if (zeroed) return;
  if (seen && total + 1e-9 < seen.usd) return; // retroceso: resultado parcial o en cero de la misma sesión
  const cont = Boolean(seen);
  const dCost = Math.max(0, cont ? total - seen!.usd : total);
  const dIn = Math.max(0, cont && tin >= seen!.tin ? tin - seen!.tin : tin);
  const dOut = Math.max(0, cont && tout >= seen!.tout ? tout - seen!.tout : tout);
  // tramos de caché: solo si la línea base ya los tenía (una base antigua sin ellos daría un delta inflado)
  const cacheKnown = !cont || (seen!.tcr !== undefined && seen!.tcw !== undefined);
  const dCr = cacheKnown ? Math.max(0, cont && tcr >= seen!.tcr! ? tcr - seen!.tcr! : tcr) : undefined;
  const dCw = cacheKnown ? Math.max(0, cont && tcw >= seen!.tcw! ? tcw - seen!.tcw! : tcw) : undefined;
  prod.costSeen = { session: m.session_id, usd: total, tin: Math.max(tin, seen?.tin || 0), tout: Math.max(tout, seen?.tout || 0), tcr: Math.max(tcr, seen?.tcr || 0), tcw: Math.max(tcw, seen?.tcw || 0) };
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
        const d = describeTool(b.name, (b.input || {}) as Record<string, unknown>, dir);
        if (d) event(pid, { type: "tool", text: d, data: { tool: b.name } });
      }
    }
    return;
  }
  if (m.type === "user") {
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
    account(pid, m);
    const hadError = lv.turnError;
    lv.turnError = false;
    // queued_turn_count > 0: el usuario escribió durante el turno y viene otro turno (y otro resultado) enseguida
    const queued = Number(m.queued_turn_count) || 0;
    if (m.subtype === "success" && !m.is_error && !hadError) {
      const cur = prodOf(pid);
      if (cur && !cur.pending && queued === 0) setStatus(pid, "done");
    } else {
      const errs = "errors" in m && Array.isArray(m.errors) ? m.errors.join(" · ") : "";
      const sandboxFail = /sandbox/i.test(errs) || ("startup_failure_reason" in m && Boolean(m.startup_failure_reason) && /sandbox/i.test(lv.stderr));
      const why = sandboxFail ? sandboxError(errs || lv.stderr)
        : m.subtype === "error_max_turns" ? "Se alcanzó el máximo de turnos." : m.subtype === "error_max_budget_usd" ? "Se alcanzó el presupuesto máximo." : errs || ("result" in m ? String(m.result || "") : "") || "La sesión terminó con error.";
      if (!hadError) event(pid, { type: "error", text: sandboxFail ? why : `${why} Escribe un mensaje para continuar.` }, true);
      if (queued === 0 || sandboxFail) setStatus(pid, "error");
    }
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    const cur = prodOf(pid);
    if (!lv.input.closed && queued === 0 && !cur?.pending) lv.idle = setTimeout(() => lv.input.close(), IDLE_CLOSE_MS);
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

  const lv: Live = { abort: new AbortController(), q: null, input: new InputQueue(), resolvers: new Map(), idle: null, stderr: "", stopped: false, turnError: false };
  live.set(pid, lv);
  prod.status = "running";
  touch(pid);
  persist(true);

  const ctx: StudioContext = {
    pid,
    dir,
    emit: (ev) => event(pid, ev, ev.type === "media"),
    waitForUser: (action: PendingAction) => new Promise<unknown>((resolve, reject) => {
      const cur = prodOf(pid);
      if (!cur || lv.stopped) return reject(new Error("La producción se detuvo."));
      lv.resolvers.set(action.data.id, { resolve, reject });
      cur.pending = action;
      cur.status = "waiting";
      if (action.type === "question") event(pid, { type: "question", text: action.data.questions.map((q) => q.question).join(" · "), data: action.data }, true);
      else event(pid, { type: "approval", text: `${action.data.title}`, media: action.data.media, data: action.data }, true);
    }),
    addRenders: (outs) => {
      const cur = prodOf(pid);
      if (!cur) return;
      cur.renders = [...(cur.renders || []), ...outs];
      touch(pid);
      persist(true);
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

function resumeWith(p: Project, text: string): void {
  const prod = p.production as ProdX;
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

export function startProduction(p: Project, opts: { mode?: "reel" | "clase" | "talking"; brief?: string; changeMode?: boolean; restyle?: boolean; flags?: unknown }): void {
  anthropicKey(); // error claro en español antes de tocar nada
  const env = motionEnv();
  if (!env.python) throw new Error(env.issues.find((i) => /pyenv\.sh/.test(i)) || 'Falta el entorno de Python del motor: ejecuta "sh motion/scripts/pyenv.sh" (necesita Python 3.12).');
  const existing = p.production as ProdX | null | undefined;
  const brief = opts.brief?.trim();
  const flags = parseStartFlags(opts.flags);
  const now = new Date().toISOString();

  const lv = live.get(p.id);
  if (lv) {
    assertNotClosing(lv);
    if (!existing || existing.status === "running" || existing.status === "waiting" || existing.pending) throw new Error("La producción de este proyecto ya está en marcha.");
    // sesión viva e inactiva (turno terminado): el pedido entra por la cola de mensajes, sin lanzar otro proceso
    try { ensureLinks(existing.dir); } catch {}
    const note = syncStyle(p, existing, existing.dir, Boolean(opts.restyle));
    if (flags) existing.flags = flags;
    const text = [note, flagsText(p, flags), brief].filter(Boolean).join("\n\n") || "Continúa la producción desde donde quedaste.";
    p.updatedAt = now;
    if (brief) event(p.id, { type: "user", text: brief });
    if (note) event(p.id, { type: "status", text: note.replace(/: relee.*$/, ".") });
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    lv.input.push(text);
    setStatus(p.id, "running");
    return;
  }

  const reuse = Boolean(existing?.dir && isScaffolded(existing.dir));
  const dir = reuse ? existing!.dir : scaffoldMotion(p, { style: findStyle(p.styleId) });
  try { ensureLinks(dir); } catch {}
  // al reanudar se conserva el modo de la producción salvo que el cliente pida cambiarlo explícitamente (changeMode)
  const mode: ProductionMode = existing?.mode && existing.sessionId && !opts.changeMode ? existing.mode : opts.mode || existing?.mode || modeOf(p);
  let prod: ProdX;
  let note = "";
  if (existing) {
    prod = existing;
    prod.dir = dir;
    prod.pending = null; // si quedaba una pregunta de una sesión anterior, el agente la volverá a hacer
    note = reuse ? syncStyle(p, prod, dir, Boolean(opts.restyle)) : ((prod.styleId = p.styleId || null), "");
  } else {
    prod = { dir, status: "running", sessionId: null, pending: null, events: [], renders: [], costUsd: 0, startedAt: now, styleId: p.styleId || null };
    p.production = prod;
  }
  prod.mode = mode;
  if (flags) prod.flags = flags;
  p.updatedAt = now;
  if (brief) event(p.id, { type: "user", text: brief });
  if (note) event(p.id, { type: "status", text: note.replace(/: relee.*$/, ".") });
  event(p.id, { type: "status", text: prod.sessionId ? "Reanudando la producción…" : "Iniciando la producción…" }, true);
  const extra = [note, flagsText(p, flags), brief].filter(Boolean).join("\n\n");
  if (prod.sessionId) launch(p, `${resumeNote()}\n\n${extra || "Continúa la producción desde donde quedaste."}`, prod.sessionId);
  else launch(p, buildKickoff(p, mode, brief, flags));
}

export function sendMessage(p: Project, text: string): void {
  const t = String(text || "").trim();
  if (!t) throw new Error("Escribe un mensaje.");
  if (!p.production) return startProduction(p, { mode: modeOf(p), brief: t });
  const lv = live.get(p.id);
  assertNotClosing(lv);
  if (!lv) anthropicKey();
  event(p.id, { type: "user", text: t }, true);
  if (lv) {
    if (lv.idle) { clearTimeout(lv.idle); lv.idle = null; }
    lv.input.push(t);
    if (p.production.status !== "waiting") setStatus(p.id, "running");
  } else resumeWith(p, t);
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
  prod.pending = null;
  prod.status = "running";
  event(p.id, { type: "answer", text: lines.join("\n"), data: clean }, true);
  if (lv?.idle) { clearTimeout(lv.idle); lv.idle = null; }
  if (r && lv) { lv.resolvers.delete(questionId); r.resolve(clean); return; }
  const text = `Respuestas a tus preguntas:\n${lines.map((l) => `- ${l}`).join("\n")}`;
  if (lv) lv.input.push(text);
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
  prod.pending = null;
  prod.status = "running";
  const decision: ApprovalDecision = { approved: Boolean(approved), ...(fb ? { feedback: fb } : {}) };
  event(p.id, { type: "decision", text: `${approved ? "Aprobado" : "Cambios pedidos"}: ${pend.data.title}${fb ? ` — ${fb}` : ""}`, data: { approvalId, kind: pend.data.kind, ...decision } }, true);
  if (lv?.idle) { clearTimeout(lv.idle); lv.idle = null; }
  if (r && lv) { lv.resolvers.delete(approvalId); r.resolve(decision); return; }
  const text = approved
    ? `El usuario APROBÓ "${pend.data.title}" (${pend.data.kind}).${fb ? ` Comentario: ${fb}` : ""} Continúa.`
    : `El usuario NO aprobó "${pend.data.title}" (${pend.data.kind}). Cambios pedidos: ${fb}. Aplícalos y vuelve a pedir aprobación.`;
  if (lv) lv.input.push(text);
  else resumeWith(p, text);
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
  const prod = p.production;
  if (!prod) return;
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
