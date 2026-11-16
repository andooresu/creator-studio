// Servidor MCP en proceso "studio": las herramientas con las que el agente productor habla con la app
// (preguntas, aprobaciones, publicar medios), genera audio con el modo elegido en Ajustes (ElevenLabs, local o
// sintetizado, vía server/audio/provider.ts) y renderiza con el kit del motor.
// En las sesiones de Claude Code esto lo hacían AskUserQuestion, el MCP de ElevenLabs y el envío de archivos.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import dns from "node:dns/promises";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { id, load, getProject, getBrand, APP_DIR, MOTION_DIR } from "../db.ts";
import { renderMotion, sheetMotion, mediaUrl, runMotion, ensureLinks } from "../motion/kit.ts";
import { generateSpeech, generateMusic, generateSfx, listVoices as listProviderVoices } from "../audio/provider.ts";
import { FORMATS } from "../../shared/types.ts";
import type { AgentApproval, AgentQuestion, AudioProvider, PendingAction, ProductionEvent, RenderOutput } from "../../shared/types.ts";

/** Lo que el runner le da al servidor de herramientas para hablar con el proyecto. */
export interface StudioContext {
  pid: string;
  /** carpeta del motor del proyecto (Production.dir) */
  dir: string;
  /** agrega un evento a la sesión (y guarda) */
  emit(ev: { type: ProductionEvent["type"]; text: string; media?: string[]; data?: unknown }): void;
  /** deja la acción pendiente en el proyecto (estado "waiting") y espera la respuesta del usuario */
  waitForUser(action: PendingAction): Promise<unknown>;
  /** registra renders terminados en Production.renders */
  addRenders(outs: RenderOutput[]): void;
}

export type QuestionAnswers = Record<string, string>;
export interface ApprovalDecision { approved: boolean; feedback?: string }

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Ejecuta el handler y convierte cualquier excepción en un resultado de error legible para el agente. */
function safe<A>(fn: (args: A) => Promise<ToolResult>): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try { return await fn(args); }
    catch (e) { return fail(`Error: ${(e as Error)?.message || String(e)}`); }
  };
}

/**
 * Ruta real de `p` siguiendo enlaces simbólicos: realpath del prefijo que existe + el resto sin resolver.
 * Sigue también enlaces rotos (su destino aún no existe), para que escribir "a través" de ellos no escape.
 */
export function realPrefix(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (let hops = 0; hops < 64; hops++) {
    try {
      const r = fs.realpathSync.native(cur);
      return rest.length ? path.join(r, ...[...rest].reverse()) : r;
    } catch {}
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) { cur = path.resolve(path.dirname(cur), fs.readlinkSync(cur)); continue; }
    } catch {}
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.push(path.basename(cur));
    cur = parent;
  }
  return path.resolve(p);
}

const insideDir = (p: string, root: string): boolean => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Resuelve una ruta relativa a la carpeta del motor sin permitir salir de ella (tampoco a través de enlaces simbólicos). */
export function safeRel(dir: string, rel: string): { abs: string; rel: string } {
  const clean = String(rel || "").replace(/\\/g, "/").trim();
  if (!clean) throw new Error("Ruta vacía.");
  const abs = path.resolve(dir, clean);
  const root = path.resolve(dir);
  const outside = `La ruta "${rel}" está fuera de la carpeta del proyecto. Usa rutas relativas a la carpeta del motor.`;
  if (!insideDir(abs, root)) throw new Error(outside);
  if (!insideDir(realPrefix(abs), realPrefix(root))) throw new Error(`${outside} (apunta afuera mediante un enlace simbólico)`);
  return { abs, rel: path.relative(root, abs).split(path.sep).join("/") };
}

// ---------------------------------------------------------------- URLs públicas (capture_site)
function privateV4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = o;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && o[2] === 0) || (a === 198 && (b === 18 || b === 19));
}
/** true si la IP es de loopback, red privada, enlace local, multicast o reservada. */
export function isPrivateIp(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, "").toLowerCase().split("%")[0];
  const v = net.isIP(h);
  if (v === 4) return privateV4(h);
  if (v !== 6) return true;
  if (h === "::" || h === "::1") return true;
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h) || /^::(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return privateV4(mapped[1]);
  const hexMapped = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16), lo = parseInt(hexMapped[2], 16);
    return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(h.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || first === 0;
}

/** Valida (sin DNS) que la URL sea http/https pública: nada de localhost, IPs privadas ni credenciales. Devuelve el motivo o null. */
export function publicUrlError(raw: string): string | null {
  let u: URL;
  try { u = new URL(String(raw || "").trim()); } catch { return "La URL no es válida."; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Solo se permiten URLs http:// o https://.";
  if (u.username || u.password) return "La URL no puede llevar usuario ni contraseña.";
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return "La URL no tiene dominio.";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa") || (!host.includes(".") && !net.isIP(host))) {
    return "No se permiten direcciones locales ni de la red interna: usa la URL pública del sitio.";
  }
  if (net.isIP(host) && isPrivateIp(host)) return "No se permiten direcciones locales ni de la red interna: usa la URL pública del sitio.";
  return null;
}

/** Como publicUrlError, pero además resuelve el dominio y rechaza si alguna IP es local o privada. */
export async function assertPublicUrl(raw: string): Promise<string> {
  const err = publicUrlError(raw);
  if (err) throw new Error(err);
  const u = new URL(String(raw).trim());
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!net.isIP(host)) {
    let addrs: { address: string }[] = [];
    try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error(`No se pudo resolver el dominio ${host}.`); }
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("Ese dominio apunta a una dirección local o de la red interna: no se permite.");
  }
  return u.toString();
}

// ---------------------------------------------------------------- scripts del motor que abren Chromium (fuera del sandbox)
const KIT_SCRIPTS = path.join(MOTION_DIR, "scripts");

/**
 * Antes de ejecutar render.mjs / lint.mjs / capture.mjs fuera del sandbox del agente: los enlaces node_modules y .venv
 * deben apuntar al kit, render.mjs se restaura desde el kit (el agente puede editar scripts/ del proyecto) y no puede
 * haber enlaces simbólicos que salgan de la carpeta (el servidor HTTP del render los seguiría).
 */
export function prepareUnsandboxedRun(dir: string): void {
  try { ensureLinks(dir); } catch {}
  const links: [string, string][] = [["node_modules", path.join(APP_DIR, "node_modules")], [".venv", path.join(MOTION_DIR, ".venv")]];
  for (const [name, target] of links) {
    if (!fs.existsSync(target)) continue;
    const link = path.join(dir, name);
    let okLink = false;
    try { okLink = fs.lstatSync(link).isSymbolicLink() && fs.realpathSync(link) === fs.realpathSync(target); } catch {}
    if (!okLink) throw new Error(`La carpeta ${name} del proyecto fue modificada y no apunta al kit del motor: no se puede ejecutar el motor así.`);
  }
  const root = realPrefix(dir);
  let seen = 0;
  // Recorrido completo y "a prueba de fallos": si el árbol es demasiado profundo o grande, no se ejecuta (antes se cortaba en silencio)
  const walk = (d: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) throw new Error(`El proyecto tiene carpetas anidadas a más de ${MAX_SCAN_DEPTH} niveles (${path.relative(dir, d)}): no se puede verificar. Aplánalas y reintenta.`);
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (e) { throw new Error(`No se pudo revisar la carpeta ${path.relative(dir, d) || "."} del proyecto (${(e as NodeJS.ErrnoException).code || "error"}): no se ejecuta el motor sin verificarla.`); }
    for (const e of entries) {
      if (++seen > MAX_SCAN_ENTRIES) throw new Error(`El proyecto tiene más de ${MAX_SCAN_ENTRIES} archivos: no se puede verificar antes de ejecutar el motor. Borra fotogramas o temporales que no uses y reintenta.`);
      const abs = path.join(d, e.name);
      const rel = path.relative(dir, abs);
      if (depth === 0 && (e.name === "node_modules" || e.name === ".venv")) continue; // enlaces del kit, verificados arriba
      // archivos que cambian cómo Node o Python cargan módulos (los scripts del motor corren sin sandbox)
      if (e.name === "node_modules") throw new Error(`El proyecto tiene una carpeta node_modules propia (${rel}): bórrala; solo se usa la del kit.`);
      if (UNSAFE_LOADER_FILE.test(e.name)) throw new Error(`El proyecto tiene ${rel}, que cambiaría cómo se cargan los módulos de Node o Python fuera del sandbox: bórralo y reintenta.`);
      if (e.isSymbolicLink()) {
        if (!insideDir(realPrefix(abs), root)) throw new Error(`El proyecto tiene un enlace simbólico que apunta fuera de su carpeta (${rel}). Bórralo y usa una copia del archivo.`);
      } else if (e.isDirectory()) walk(abs, depth + 1);
    }
  };
  walk(dir, 0);
  const rs = path.join(dir, "scripts", "render.mjs");
  fs.mkdirSync(path.dirname(rs), { recursive: true });
  try { fs.rmSync(rs, { force: true }); } catch {}
  fs.copyFileSync(path.join(KIT_SCRIPTS, "render.mjs"), rs);
}

const MAX_SCAN_DEPTH = 32;
const MAX_SCAN_ENTRIES = 150_000;
/** package.json/.npmrc/.pnp.* (Node) y sitecustomize/usercustomize/.pth/pyvenv.cfg (Python): secuestran la carga de módulos */
export const UNSAFE_LOADER_FILE = /^(package\.json|\.npmrc|\.yarnrc|\.yarnrc\.yml|\.pnp\..+|sitecustomize\.py|usercustomize\.py|.+\.pth|pyvenv\.cfg)$/i;

// ---------------------------------------------------------------- dominios que capture_site puede abrir sin preguntar
const hostOf = (u: string): string | null => {
  try { return new URL(u).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase().replace(/^www\./, ""); } catch { return null; }
};
/**
 * Dominios que el usuario dio para este proyecto: URLs del objetivo, de las referencias, de la guía de marca y de sus
 * propios mensajes al productor. Cualquier otro dominio necesita su aprobación (capture_site podría sacar datos en la URL).
 */
export function projectHosts(pid: string): Set<string> {
  const out = new Set<string>();
  const add = (text: unknown): void => {
    for (const m of String(text || "").matchAll(/\bhttps?:\/\/[^\s"'<>()\]\[`]+/gi)) { const h = hostOf(m[0]); if (h) out.add(h); }
    // dominios escritos sin esquema (ej. "midominio.com")
    for (const m of String(text || "").matchAll(/(?<![\w@.\/-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi)) { const h = hostOf(`https://${m[1]}`); if (h && !/\.(png|jpe?g|gif|svg|webp|mp4|mov|wav|mp3|json|md|txt|js|mjs|py|html|css|pdf)$/i.test(h)) out.add(h); }
  };
  const p = getProject(pid);
  if (!p) return out;
  add(p.goal);
  for (const r of p.references || []) { add(r.url); add(r.note); }
  try {
    const b = getBrand(p.brandId);
    for (const src of b.sources || []) if (src.type === "url" || src.type === "text") add(src.value);
    add(b.raw);
  } catch {}
  for (const ev of p.production?.events || []) if (ev.type === "user" || ev.type === "answer") add(ev.text);
  return out;
}
// coincidencia exacta (sin "www."): un subdominio de un hosting compartido (x.vercel.app, x.github.io) sería de otra persona
const hostAllowed = (host: string, allowed: Set<string>): boolean => allowed.has(host.replace(/^www\./, ""));

const tail = (out: string, n = 40): string => out.trim().split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n").slice(-6000);

export function slug(s: string, fallback = "audio"): string {
  const out = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return out || fallback;
}

/** Primer nombre libre: base.mp3, base_2.mp3, … */
function freeName(dirAbs: string, base: string, ext: string): string {
  fs.mkdirSync(dirAbs, { recursive: true });
  let name = `${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dirAbs, name)); i++) name = `${base}_${i}${ext}`;
  return name;
}

// ---------------------------------------------------------------- audio (tres modos: elevenlabs | local | sintetizado)
const PROVIDER_LABEL: Record<AudioProvider, string> = { elevenlabs: "ElevenLabs", local: "modelos locales", sintetizado: "sintetizado (sin IA)" };
const audioMode = (): AudioProvider => load().settings.audioProvider || "sintetizado";
/** ElevenLabs entrega MP3; los motores locales y el sintetizador, WAV. El proveedor puede cambiarla (devuelve la ruta real). */
const audioExt = (mode: AudioProvider): string => (mode === "elevenlabs" ? ".mp3" : ".wav");

/** Reserva un nombre libre dentro del proyecto (subdir/base.ext, base_2.ext…) y devuelve su ruta relativa. */
function outPath(ctx: StudioContext, subdir: string, base: string, ext: string): string {
  const { abs, rel } = safeRel(ctx.dir, subdir);
  return `${rel}/${freeName(abs, slug(base), ext)}`;
}

/** Ruta relativa del archivo que dejó el proveedor (la que devolvió o la pedida), solo si está dentro del proyecto y existe. */
export function producedPath(ctx: { dir: string }, returned: string | undefined, asked: string): string | null {
  let cand = returned || asked;
  if (path.isAbsolute(cand)) {
    const roots = [path.resolve(ctx.dir), realPrefix(ctx.dir)];
    const real = realPrefix(cand);
    const root = roots.find((r) => insideDir(path.resolve(cand), r)) || roots.find((r) => insideDir(real, r));
    if (!root) throw new Error(`El proveedor de audio escribió fuera del proyecto (${cand}).`);
    cand = path.relative(root, insideDir(path.resolve(cand), root) ? path.resolve(cand) : real) || ".";
  }
  const r = safeRel(ctx.dir, cand);
  try { return fs.statSync(r.abs).isFile() ? r.rel : null; } catch { return null; }
}

/** Duración de timeline.json del proyecto, si existe. */
function timelineSeconds(dir: string): number | null {
  try {
    const d = Number((JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8")) as { duration?: unknown }).duration);
    return Number.isFinite(d) && d >= 3 ? Math.min(600, d) : null;
  } catch { return null; }
}

/** true si todos los archivos tienen exactamente el mismo contenido. */
function identicalFiles(dir: string, rels: string[]): boolean {
  try {
    const bufs = rels.map((r) => fs.readFileSync(safeRel(dir, r).abs));
    return bufs.every((b) => b.equals(bufs[0]));
  } catch { return false; }
}

const fmtSchema = z.enum(FORMATS as unknown as [string, ...string[]]);

/** Definiciones de las herramientas (exportadas también para pruebas). */
export function studioTools(ctx: StudioContext) {
  const url = (rel: string): string => mediaUrl(ctx.pid, rel);
  /** dominios que el usuario aprobó en esta sesión para capture_site */
  const approvedHosts = new Set<string>();

  const askUser = tool(
    "ask_user",
    "Hace preguntas al usuario en la interfaz de la app (reemplaza a AskUserQuestion). Bloquea hasta que responda, puede tardar horas: no repitas la llamada. Hasta 4 preguntas por ronda, cada una con 2–6 opciones concretas; pon primero la recomendada y márcala con '(recomendada)'. El usuario siempre puede escribir otra respuesta libre. Devuelve las respuestas por pregunta.",
    {
      questions: z.array(z.object({
        question: z.string().describe("la pregunta completa, en español"),
        header: z.string().optional().describe("etiqueta corta (≤ 12 caracteres)"),
        multiSelect: z.boolean().optional().describe("true si puede elegir varias opciones"),
        options: z.array(z.object({
          label: z.string().describe("texto corto de la opción"),
          description: z.string().optional().describe("qué implica elegirla"),
          preview: z.string().optional().describe("vista previa opcional en markdown (concepto, layout, plan de música)"),
        })).min(2).max(6),
      })).min(1).max(4),
    },
    safe(async ({ questions }) => {
      const data: AgentQuestion = { id: id(), questions };
      const answers = (await ctx.waitForUser({ type: "question", data })) as QuestionAnswers;
      const lines = questions.map((q, i) => `- ${q.question}\n  → ${answers[q.question] ?? answers[String(i)] ?? "(sin respuesta)"}`);
      const extra = Object.entries(answers).filter(([k]) => !questions.some((q, i) => q.question === k || String(i) === k));
      for (const [k, v] of extra) lines.push(`- ${k}: ${v}`);
      return ok(`Respuestas del usuario:\n${lines.join("\n")}`);
    }),
  );

  const requestApproval = tool(
    "request_approval",
    "Puerta de aprobación en la interfaz: concepto/brief, música, voz, shotlist, borrador o final. Muestra título, resumen (markdown) y medios opcionales, y BLOQUEA hasta que el usuario apruebe o pida cambios. Si no aprueba, aplica su feedback y vuelve a pedir aprobación. No construyas nada que dependa de esa aprobación antes de recibirla.",
    {
      kind: z.enum(["concepto", "musica", "voz", "shotlist", "borrador", "final", "otro"]),
      title: z.string().describe("título corto"),
      summary: z.string().describe("resumen en markdown: lo que se aprueba, con tabla si aplica (shotlist), costo estimado si lo hay"),
      media: z.array(z.string()).optional().describe("rutas relativas a la carpeta del proyecto (audio, video o imágenes) para revisar"),
    },
    safe(async ({ kind, title, summary, media }) => {
      const urls: string[] = [];
      for (const m of media || []) {
        const r = safeRel(ctx.dir, m);
        if (!fs.existsSync(r.abs)) throw new Error(`No existe ${r.rel}.`);
        urls.push(url(r.rel));
      }
      const data: AgentApproval = { id: id(), kind, title, summary, ...(urls.length ? { media: urls } : {}) };
      const d = (await ctx.waitForUser({ type: "approval", data })) as ApprovalDecision;
      return ok(d.approved
        ? `APROBADO por el usuario.${d.feedback ? ` Comentario: ${d.feedback}` : ""}`
        : `NO aprobado. Cambios pedidos por el usuario: ${d.feedback || "(sin detalle: pregunta qué cambiar)"}\nAplica los cambios y vuelve a pedir aprobación.`);
    }),
  );

  const showMedia = tool(
    "show_media",
    "Publica archivos (audio, video o imágenes) en la sesión para que el usuario los vea o escuche (equivale a enviarle archivos). No bloquea. Rutas relativas a la carpeta del proyecto.",
    {
      paths: z.array(z.string()).min(1).max(12),
      caption: z.string().describe("texto breve que acompaña a los archivos"),
    },
    safe(async ({ paths, caption }) => {
      const rels: string[] = [];
      for (const p of paths) {
        const r = safeRel(ctx.dir, p);
        if (!fs.existsSync(r.abs) || !fs.statSync(r.abs).isFile()) throw new Error(`No existe el archivo ${r.rel}.`);
        rels.push(r.rel);
      }
      ctx.emit({ type: "media", text: caption, media: rels.map(url), data: { paths: rels } });
      return ok(`Publicado en la sesión: ${rels.join(", ")}`);
    }),
  );

  /** Publica en la sesión (como show_media) los audios recién generados, si el agente lo pidió. */
  const publishAudio = (rels: string[], caption: string): void => {
    if (rels.length) ctx.emit({ type: "media", text: caption, media: rels.map(url), data: { paths: rels } });
  };

  const audioMusic = tool(
    "audio_music",
    "Genera música original con el modo de audio elegido en Ajustes (ElevenLabs Music, ACE-Step local o el sintetizador music.py). Guarda cada variante en audio/variants/ y devuelve sus rutas. ElevenLabs/ACE-Step: describe solo el sonido (género, BPM, instrumentos, mood, producción, curva de energía contra el shotlist), instrumental. Sintetizado (y local sin ACE-Step): la música sale de timeline.json (bpm, duration, marks, music.chords/sections/accents/seed); escribe esos campos ANTES de llamar y, para otra variante, cámbialos (seed, acordes, secciones) y vuelve a llamar. Publica las variantes con publish:true, show_media o request_approval(kind musica) para elegir por oído.",
    {
      prompt: z.string().describe("brief musical de ESTE proyecto (en inglés suele funcionar mejor); en modo sintetizado, una descripción corta de la variante"),
      length_seconds: z.number().min(3).max(600).optional().describe("duración en segundos (por defecto la de timeline.json)"),
      variants: z.number().int().min(1).max(4).optional().describe("cuántas variantes con este prompt (por defecto 1; en modo sintetizado siempre 1)"),
      name: z.string().optional().describe("nombre base de los archivos, ej. 'directo-a'"),
      publish: z.boolean().optional().describe("publicar las variantes en la sesión para escucharlas (por defecto false)"),
    },
    safe(async ({ prompt, length_seconds, variants, name, publish }) => {
      const mode = audioMode();
      const seconds = length_seconds ?? timelineSeconds(ctx.dir) ?? 30;
      const n = mode === "sintetizado" ? 1 : variants || 1;
      const notes: string[] = [];
      if (mode === "sintetizado" && (variants || 1) > 1) notes.push("En modo sintetizado cada llamada da una sola variante: cambia music.seed / chords / sections en timeline.json y vuelve a llamar.");
      const one = async (): Promise<string> => {
        const outRel = outPath(ctx, "audio/variants", name || "musica", audioExt(mode));
        const r = await generateMusic({ prompt, seconds, dir: ctx.dir, outRel });
        if (r.note) notes.push(r.note);
        const got = producedPath(ctx, r.path, outRel);
        if (!got) throw new Error(r.note || "El proveedor no generó el archivo de música.");
        return `${got}${r.seconds ? ` (${r.seconds.toFixed(1)} s)` : ""}`;
      };
      // ElevenLabs en paralelo (API remota); los motores locales uno a la vez (CPU/GPU de la Mac)
      const settled: PromiseSettledResult<string>[] = [];
      if (mode === "elevenlabs") settled.push(...await Promise.allSettled(Array.from({ length: n }, one)));
      else for (let i = 0; i < n; i++) settled.push(...await Promise.allSettled([one()]));
      const out = settled.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled").map((r) => r.value);
      const errors = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error)?.message || String(r.reason));
      if (!out.length) throw new Error(errors[0] || "No se generó música.");
      const rels = out.map((x) => x.replace(/ \(.*\)$/, ""));
      if (rels.length > 1 && identicalFiles(ctx.dir, rels)) notes.push("Las variantes salieron idénticas (este motor es determinista con la misma entrada): cambia la entrada para obtener variantes distintas.");
      if (publish) publishAudio(rels, `Música (${PROVIDER_LABEL[mode]}): ${rels.length} variante${rels.length > 1 ? "s" : ""}`);
      return ok(`Música generada con ${PROVIDER_LABEL[mode]} (${out.length}/${n}):\n${out.map((p) => `- ${p}`).join("\n")}${errors.length ? `\nFallaron ${errors.length}: ${errors[0]}` : ""}${notes.length ? `\nNotas: ${[...new Set(notes)].join(" ")}` : ""}\nSiguiente: analiza (beats.py), luego publica para elegir por oído.`);
    }),
  );

  const audioTts = tool(
    "audio_tts",
    "Genera voz con el modo de audio elegido en Ajustes (ElevenLabs, Kokoro/Chatterbox locales o la voz de macOS `say`). Guarda en audio/vo/ (o en 'out_dir') y devuelve la ruta. Para audicionar: la misma línea real del guion (el CTA) con 2–4 voces distintas de audio_voices (una llamada por voz). Una toma por línea para la locución final.",
    {
      text: z.string().describe("texto exacto a locutar"),
      voice: z.string().optional().describe("id de voz de audio_voices (ElevenLabs voice_id, voz de Kokoro como em_alex, voz de macOS como Paulina); sin valor usa la de Ajustes"),
      name: z.string().optional().describe("nombre base del archivo, ej. 'l1' o 'cta-voz-a'"),
      out_dir: z.string().optional().describe("carpeta relativa de salida (por defecto audio/vo)"),
      publish: z.boolean().optional().describe("publicar la toma en la sesión para escucharla (por defecto false)"),
    },
    safe(async ({ text, voice, name, out_dir, publish }) => {
      const mode = audioMode();
      const outRel = outPath(ctx, out_dir || "audio/vo", name || text.slice(0, 24), audioExt(mode));
      const r = await generateSpeech({ text, ...(voice ? { voice } : {}), dir: ctx.dir, outRel });
      const got = producedPath(ctx, r.path, outRel);
      if (!got) throw new Error(r.note || "El proveedor no generó el archivo de voz.");
      if (publish) publishAudio([got], `Voz${voice ? ` (${voice})` : ""}: "${text.slice(0, 60)}"`);
      return ok(`Voz generada con ${PROVIDER_LABEL[mode]}: ${got}${r.seconds ? ` (${r.seconds.toFixed(1)} s)` : ""}${voice ? ` · voz ${voice}` : " · voz de Ajustes"} · ${text.length} caracteres.${r.note ? `\nNota: ${r.note}` : ""}`);
    }),
  );

  const audioSfx = tool(
    "audio_sfx",
    "Genera un efecto de sonido con el modo de audio elegido en Ajustes (ElevenLabs, Stable Audio local o el sintetizador). Guarda en audio/sfx_samples/ y devuelve la ruta; luego mide el onset y colócalo en las marcas. En modo sintetizado (y local sin Stable Audio) los efectos de UI (click, tick, pop, thump, whoosh, riser, shutter) salen de cues.json con sync.mjs + sfx.mjs → audio/sfx.wav: prefiere ese camino.",
    {
      prompt: z.string().describe("descripción del sonido, ej. 'soft UI tap with short chime'"),
      duration_seconds: z.number().min(0.5).max(30).optional().describe("duración (por defecto 2 s)"),
      name: z.string().optional().describe("nombre base del archivo, ej. 'tap'"),
      publish: z.boolean().optional().describe("publicar el efecto en la sesión (por defecto false)"),
    },
    safe(async ({ prompt, duration_seconds, name, publish }) => {
      const mode = audioMode();
      const outRel = outPath(ctx, "audio/sfx_samples", name || prompt.slice(0, 24), audioExt(mode));
      const r = await generateSfx({ prompt, seconds: duration_seconds ?? 2, dir: ctx.dir, outRel });
      const got = producedPath(ctx, r.path, outRel);
      if (!got) {
        if (r.note) return ok(`Sin archivo de efecto (${PROVIDER_LABEL[mode]}): ${r.note}`);
        throw new Error("El proveedor no generó el efecto.");
      }
      if (publish) publishAudio([got], `Efecto: ${prompt.slice(0, 60)}`);
      return ok(`Efecto generado con ${PROVIDER_LABEL[mode]}: ${got}${r.seconds ? ` (${r.seconds.toFixed(1)} s)` : ""}${r.note ? `\nNota: ${r.note}` : ""}`);
    }),
  );

  const audioVoices = tool(
    "audio_voices",
    "Lista las voces disponibles en el modo de audio elegido en Ajustes (ElevenLabs, Kokoro/Chatterbox o voces de macOS en español). Devuelve id y nombre; pasa el id a audio_tts. No elijas por el nombre: audiciona 2–4 voces con audio_tts sobre la línea real del guion.",
    {
      search: z.string().optional().describe("filtra por texto en el id o el nombre (ej. 'es', 'Paulina', 'male')"),
      limit: z.number().int().min(1).max(100).optional().describe("máximo de voces a devolver (por defecto 40)"),
    },
    safe(async ({ search, limit }) => {
      const mode = audioMode();
      const all = await listProviderVoices();
      const q = (search || "").trim().toLowerCase();
      const hits = q ? all.filter((v) => `${v.id} ${v.name}`.toLowerCase().includes(q)) : all;
      const def = mode === "elevenlabs" ? load().settings.elevenVoiceId : mode === "local" ? load().settings.localVoice : load().settings.sayVoice;
      if (!hits.length) return ok(all.length ? `No hay voces que coincidan con "${search}". Hay ${all.length} voces: prueba sin filtro.` : `No hay voces disponibles en el modo ${PROVIDER_LABEL[mode]}. Revisa Ajustes → Audio del motor.`);
      const shown = hits.slice(0, limit || 40);
      return ok(`Modo ${PROVIDER_LABEL[mode]} · ${hits.length} voces${hits.length > shown.length ? ` (se muestran ${shown.length})` : ""}${def ? ` · voz de Ajustes: ${def}` : ""}:\n${shown.map((v) => `- ${v.name} · id=${v.id}${v.provider !== mode ? ` · ${v.provider}` : ""}`).join("\n")}`);
    }),
  );

  const render = tool(
    "render",
    "Renderiza la película con scripts/render.mjs mediante la cola de render de la app (un render pesado a la vez). mode 'draft' para borradores de revisión, 'final' para entregar. Registra el resultado en la sesión y devuelve las rutas. Prefiere esta herramienta a ejecutar render.mjs --draft/--all a mano.",
    {
      mode: z.enum(["draft", "final"]),
      formats: z.array(fmtSchema).min(1).max(4).describe("formatos, ej. ['9x16']"),
      publish: z.boolean().optional().describe("publicar el video en la sesión (por defecto true en final, false en borradores)"),
    },
    safe(async ({ mode, formats, publish }) => {
      const fmts = formats as RenderOutput["fmt"][];
      prepareUnsandboxedRun(ctx.dir);
      const outs = await renderMotion(ctx.dir, { mode, formats: fmts });
      ctx.addRenders(outs);
      const show = publish ?? mode === "final";
      if (show) ctx.emit({ type: "media", text: `${mode === "final" ? "Render final" : "Borrador"} listo: ${outs.map((o) => o.fmt).join(", ")}`, media: outs.map((o) => url(o.path)), data: outs });
      return ok(`Render ${mode} listo:\n${outs.map((o) => `- ${o.path}${o.seconds ? ` (${o.seconds} s)` : ""}`).join("\n")}`);
    }),
  );

  const sheet = tool(
    "sheet",
    "Genera la hoja de contactos (un fotograma por beat, más la versión a tamaño teléfono) con render.mjs --sheet. Devuelve las rutas: LÉELAS con Read para mirar las imágenes antes de criticar.",
    {
      fmt: fmtSchema.describe("formato, ej. '9x16'"),
      publish: z.boolean().optional().describe("publicar la hoja en la sesión (por defecto false)"),
    },
    safe(async ({ fmt, publish }) => {
      prepareUnsandboxedRun(ctx.dir);
      const rels = await sheetMotion(ctx.dir, fmt as RenderOutput["fmt"]);
      if (publish) ctx.emit({ type: "media", text: `Hoja de contactos ${fmt}`, media: rels.map(url), data: { paths: rels } });
      return ok(`Hoja de contactos lista:\n${rels.map((r) => `- ${r}`).join("\n")}\nMíralas con Read.`);
    }),
  );

  const lint = tool(
    "lint",
    "Lint rápido del diseño con scripts/lint.mjs del kit (lee el DOM en vivo con Chromium, sin renderizar video): texto muy chico, zonas de la interfaz en 9:16, textos superpuestos o cortados. Úsalo en lugar de ejecutar lint.mjs por Bash (Chromium no corre en el sandbox de Bash). Devuelve el informe; también queda en review/lint_<fmt>.json.",
    {
      fmt: fmtSchema.optional().describe("un formato, ej. '9x16' (por defecto el primero de timeline.json)"),
      all: z.boolean().optional().describe("true para todos los formatos de timeline.json"),
      step: z.number().min(0.02).max(1).optional().describe("paso de muestreo en segundos (por defecto 0.1)"),
    },
    safe(async ({ fmt, all, step }) => {
      prepareUnsandboxedRun(ctx.dir);
      const args = [path.join(KIT_SCRIPTS, "lint.mjs"), ...(all ? ["--all"] : fmt ? ["--fmt", fmt] : []), ...(step ? ["--step", String(step)] : [])];
      const r = await runMotion(ctx.dir, "node", args, { timeoutMs: 15 * 60_000 });
      if (r.code !== 0 && r.code !== 1) throw new Error(`lint.mjs falló (código ${r.code}):\n${tail(r.out, 20)}`);
      return ok(`${r.code === 0 ? "Lint limpio." : "Lint con problemas (corrígelos o acéptalos de forma consciente):"}\n${tail(r.out)}`);
    }),
  );

  const captureSite = tool(
    "capture_site",
    "Captura los recursos reales de marca de un sitio web público (logos SVG, fuentes, colores, capturas de secciones) con scripts/capture.mjs del kit en Chromium. Úsalo en lugar de ejecutar capture.mjs por Bash (y en lugar de WebFetch, que no está disponible). Solo URLs http/https públicas (no localhost ni redes internas). Los dominios que dio el usuario (objetivo, referencias, guía de marca, sus mensajes) se abren directo; cualquier otro pide su aprobación en la interfaz. Los archivos quedan en assets/ del proyecto.",
    {
      url: z.string().describe("URL pública del producto, ej. https://ejemplo.com"),
      sections: z.array(z.string()).max(12).optional().describe("títulos de secciones a capturar, ej. ['Pricing', 'Get started']"),
    },
    safe(async ({ url: target, sections }) => {
      // el dominio se autoriza ANTES de resolverlo: la propia consulta DNS podría sacar datos en un subdominio
      const err = publicUrlError(target);
      if (err) throw new Error(err);
      const host = hostOf(String(target).trim()) || "";
      if (!hostAllowed(host, projectHosts(ctx.pid)) && !approvedHosts.has(host)) {
        const data: AgentApproval = {
          id: id(), kind: "otro", title: `¿Capturar ${host}?`,
          summary: `El productor quiere abrir **${String(target).trim()}** para capturar recursos de marca. Ese dominio no aparece en el objetivo, las referencias, la guía de marca ni en tus mensajes de este proyecto. Apruébalo solo si es un sitio tuyo o que quieras usar.`,
        };
        const d = (await ctx.waitForUser({ type: "approval", data })) as ApprovalDecision;
        if (!d?.approved) return fail(`El usuario no autorizó capturar ${host}.${d?.feedback ? ` Comentario: ${d.feedback}` : ""} Usa solo los sitios que dio el usuario.`);
        approvedHosts.add(host);
      }
      const clean = await assertPublicUrl(target);
      prepareUnsandboxedRun(ctx.dir);
      const secs = (sections || []).map((x) => x.replace(/,/g, " ").trim()).filter(Boolean);
      const args = [path.join(KIT_SCRIPTS, "capture.mjs"), clean, ...(secs.length ? ["--sections", secs.join(",")] : [])];
      const r = await runMotion(ctx.dir, "node", args, { timeoutMs: 10 * 60_000 });
      if (r.code !== 0) throw new Error(`capture.mjs falló (código ${r.code}):\n${tail(r.out, 20)}`);
      return ok(`Captura lista de ${clean}:\n${tail(r.out)}\nRevisa assets/ (y míralo con Read antes de usarlo).`);
    }),
  );

  const renderCheck = tool(
    "render_check",
    "Comprobaciones con scripts/render.mjs del kit (Chromium, fuera del sandbox de Bash): 'at' = fotogramas sueltos (review/stills/<fmt>/t<seg>.png), 'range' = clip corto para revisar movimiento (renders/clip_<fmt>_<a>-<b>.mp4), 'verify' = chequeo de determinismo, 'mux' = volver a unir audio/mix.wav a los renders existentes sin re-renderizar. Úsalo en lugar de ejecutar render.mjs por Bash.",
    {
      action: z.enum(["at", "range", "verify", "mux"]),
      fmt: fmtSchema.optional().describe("formato (por defecto el primero de timeline.json)"),
      all: z.boolean().optional().describe("verify/mux: todos los formatos"),
      times: z.array(z.number().min(0)).min(1).max(24).optional().describe("at: segundos, ej. [3.2, 3.25]"),
      from: z.number().min(0).optional().describe("range: segundo inicial"),
      to: z.number().min(0).optional().describe("range: segundo final"),
      blur: z.boolean().optional().describe("range: desenfoque de movimiento (por defecto false)"),
    },
    safe(async ({ action, fmt, all, times, from, to, blur }) => {
      const args = [path.join(KIT_SCRIPTS, "render.mjs")];
      if (action === "at") {
        if (!times?.length) throw new Error("Indica times (segundos).");
        args.push("--at", times.join(","));
      } else if (action === "range") {
        if (from === undefined || to === undefined || !(to > from)) throw new Error("Indica from y to (to mayor que from).");
        args.push("--range", `${from},${to}`, "--blur", blur ? "1" : "0");
      } else args.push(`--${action}`);
      if ((action === "verify" || action === "mux") && all) args.push("--all");
      else if (fmt) args.push("--fmt", fmt);
      prepareUnsandboxedRun(ctx.dir);
      const r = await runMotion(ctx.dir, "node", args, { heavy: action === "range" || action === "verify", timeoutMs: 60 * 60_000 });
      if (r.code !== 0) throw new Error(`render.mjs --${action} falló (código ${r.code}):\n${tail(r.out, 20)}`);
      return ok(`render.mjs --${action} listo:\n${tail(r.out)}`);
    }),
  );

  return [askUser, requestApproval, showMedia, audioMusic, audioTts, audioSfx, audioVoices, render, sheet, lint, captureSite, renderCheck];
}

export function createStudioServer(ctx: StudioContext): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "studio",
    version: "1.0.0",
    instructions: "Herramientas de Andoo. Toda pregunta al usuario va por ask_user, toda aprobación por request_approval y todo archivo que el usuario deba ver o escuchar por show_media. Todo lo que abre Chromium (render, sheet, lint, capture_site, render_check) va por estas herramientas, nunca por Bash. Las rutas son relativas a la carpeta del proyecto.",
    tools: studioTools(ctx),
    alwaysLoad: true,
  });
}

/** Nombres completos (como los ve el modelo) de las herramientas del servidor studio. */
export const STUDIO_TOOLS = ["ask_user", "request_approval", "show_media", "audio_music", "audio_tts", "audio_sfx", "audio_voices", "render", "sheet", "lint", "capture_site", "render_check"].map((t) => `mcp__studio__${t}`);
