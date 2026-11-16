// Kit del motor de video: entorno, carpeta por proyecto (como motion/scripts/init.sh), ejecución de scripts
// del motor con una cola global para trabajos pesados, render, contact sheets y URLs servibles.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { load, APP_DIR, MOTION_DIR, STYLES_DIR, projectDir } from "../db.ts";
import { styleFolder } from "../styles/store.ts";
import { probeDuration } from "../media.ts"; // importarlo también amplía PATH (ffmpeg en /opt/homebrew/bin, etc.)
import type { Project, Style, Format, RenderOutput, MotionEnv } from "../../shared/types.ts";

const NODE_MODULES = path.join(APP_DIR, "node_modules");
const KIT_SCRIPTS = path.join(MOTION_DIR, "scripts");
const KIT_RENDER = path.join(KIT_SCRIPTS, "render.mjs");
const VENV = path.join(MOTION_DIR, ".venv");
const VENV_PY = path.join(VENV, "bin", "python");
const PY_MODULES = ["librosa", "numpy", "scipy", "soundfile", "PIL", "faster_whisper"];

const ENGINE_FILES = ["index.html", "core.js", "type.js", "film.js"];
const ENGINE_LIB_FILES = ["motion.js", "motion.test.js", "media.js", "captions.js"];
const SCRIPT_FILES = [
  "render.mjs", "sync.mjs", "sfx.mjs", "capture.mjs", "beats.py", "music.py", "vo.py", "words.py", "mix.py", "review.py",
  "preset.mjs", "compare_music.py", "lint.mjs", "seq.py", "grade.py", "ref_analyze.py",
];
const SUBDIRS = ["film/lib", "scripts", "docs", "audio/vo", "assets/fonts/captions", "assets/brand", "assets/cap", "renders", "review"];

// ---------------------------------------------------------------- entorno
function hasCmd(cmd: string): boolean {
  try { execFileSync("which", [cmd], { stdio: "pipe" }); return true; } catch { return false; }
}

// El chequeo de Python es lo más lento (arranca el intérprete): se guarda el resultado positivo
// y el negativo se reintenta como mucho cada 30 s.
let pyCache: { ok: boolean; at: number } | null = null;
function pythonReady(): boolean {
  if (pyCache && (pyCache.ok || Date.now() - pyCache.at < 30_000)) return pyCache.ok;
  let ok = false;
  if (fs.existsSync(VENV_PY)) {
    const code = `import importlib.util,sys; m=[n for n in ${JSON.stringify(PY_MODULES)} if importlib.util.find_spec(n) is None]; print(",".join(m)); sys.exit(1 if m else 0)`;
    const r = spawnSync(VENV_PY, ["-c", code], { stdio: "pipe", timeout: 15_000 });
    ok = r.status === 0;
  }
  pyCache = { ok, at: Date.now() };
  return ok;
}

export function motionEnv(): MotionEnv {
  const issues: string[] = [];
  const req = createRequire(path.join(APP_DIR, "package.json"));
  let playwright = false;
  let chromium = false;
  try {
    req.resolve("playwright");
    playwright = true;
    const pw = req("playwright") as { chromium: { executablePath(): string } };
    const exe = pw.chromium.executablePath();
    chromium = Boolean(exe) && fs.existsSync(exe);
  } catch {}
  if (!playwright) issues.push('Falta Playwright: ejecuta "npm install" en la carpeta del estudio.');
  else if (!chromium) issues.push('Falta el navegador Chromium de Playwright: ejecuta "npx playwright install chromium" en la carpeta del estudio.');

  const python = pythonReady();
  if (!python) {
    issues.push(fs.existsSync(VENV_PY)
      ? `Al entorno de Python del motor le faltan módulos (${PY_MODULES.join(", ")}): ejecuta "sh motion/scripts/pyenv.sh".`
      : 'Falta el entorno de Python del motor: ejecuta "sh motion/scripts/pyenv.sh" (necesita Python 3.12).');
  }
  const ffmpeg = hasCmd("ffmpeg") && hasCmd("ffprobe");
  if (!ffmpeg) issues.push("Falta ffmpeg: instálalo (por ejemplo con Homebrew: brew install ffmpeg).");
  const settings = load().settings;
  const elevenlabs = Boolean(settings.elevenlabsKey);
  // Solo es un problema si el audio se genera con ElevenLabs; los modos local y sintetizado no la necesitan.
  if (!elevenlabs && settings.audioProvider === "elevenlabs") issues.push("Sin API key de ElevenLabs: agrégala en Ajustes para generar música, voz y efectos (o cambia el audio a modo local o sintetizado).");
  return { ready: playwright && chromium && python && ffmpeg, playwright, chromium, python, ffmpeg, elevenlabs, issues };
}

// ---------------------------------------------------------------- estilos
export function styleDir(style: Style): string {
  return styleFolder(style); // misma regla que la biblioteca de estilos
}

function styleMarkdown(style: Style): string {
  const lines = [
    `# Estilo: ${style.name}`,
    "",
    `- Tipo: ${style.kind}`,
    `- Origen: ${style.origin}`,
    style.tokens.palette.length ? `- Paleta: ${style.tokens.palette.join(", ")}` : "",
    style.tokens.fonts.length ? `- Tipografías: ${style.tokens.fonts.join(", ")}` : "",
    style.captionPreset ? `- Preset de subtítulos: ${style.captionPreset}` : "",
    style.files.length ? `- Archivos del estilo (en esta carpeta): ${style.files.join(", ")}` : "",
    "",
    style.description ? `${style.description}\n` : "",
    "## Guía",
    "",
    style.guide || "(sin guía escrita)",
    "",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

/**
 * (Re)copia los archivos del estilo a <dir>/docs/style/ y reescribe docs/style/STYLE.md.
 * Vacía antes docs/style/ para que no queden archivos de un estilo anterior. style=null → solo deja un STYLE.md "sin estilo".
 */
export function copyStyle(style: Style | null, dir: string): void {
  const out = path.join(dir, "docs", "style");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  if (!style) {
    fs.writeFileSync(path.join(out, "STYLE.md"), "# Sin estilo\n\nEste proyecto no tiene un estilo asignado: sigue la marca y el brief.\n");
    return;
  }
  const src = styleDir(style);
  for (const rel of style.files || []) {
    const from = path.resolve(src, rel);
    const to = path.resolve(out, rel);
    if (!from.startsWith(src + path.sep) || !to.startsWith(out + path.sep)) continue; // sin salir de las carpetas
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  fs.writeFileSync(path.join(out, "STYLE.md"), styleMarkdown(style));
}

// ---------------------------------------------------------------- carpeta del motor por proyecto
function symlink(target: string, link: string): void {
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() && fs.readlinkSync(link) === target) return;
    fs.rmSync(link, { recursive: true, force: true });
  } catch {}
  fs.symlinkSync(target, link);
}

// Marcador de scaffold completo: se escribe solo cuando el último paso (scripts/sync.mjs) termina bien.
const SCAFFOLD_MARKER = ".scaffolded";
// Se escribe al empezar un scaffold y se borra al terminar bien: si existe, la carpeta quedó a medias.
const SCAFFOLD_PENDING = ".scaffolding";

/**
 * true si la carpeta del motor terminó de prepararse (existe .scaffolded).
 * Carpetas creadas antes de existir el marcador (sin .scaffolding de un intento a medias): si tienen timeline.json,
 * .owner y film/data.js (salida de sync.mjs), se consideran completas y se les escribe el marcador.
 */
export function isScaffolded(dir: string): boolean {
  const marker = path.join(dir, SCAFFOLD_MARKER);
  if (fs.existsSync(marker)) return true;
  if (fs.existsSync(path.join(dir, SCAFFOLD_PENDING))) return false;
  const isFile = (rel: string): boolean => { try { return fs.statSync(path.join(dir, rel)).isFile(); } catch { return false; } };
  if (isFile("timeline.json") && isFile(".owner") && isFile(path.join("film", "data.js"))) {
    try { fs.writeFileSync(marker, `legacy ${new Date().toISOString()}\n`); } catch {}
    return true;
  }
  return false;
}

/** (Re)crea los symlinks node_modules → <APP>/node_modules y .venv → <APP>/motion/.venv si los destinos existen. */
export function ensureLinks(dir: string): void {
  if (!fs.existsSync(dir)) return;
  if (fs.existsSync(NODE_MODULES)) symlink(NODE_MODULES, path.join(dir, "node_modules"));
  if (fs.existsSync(VENV)) symlink(VENV, path.join(dir, ".venv"));
}

/**
 * Crea data/projects/<pid>/motion como motion/scripts/init.sh. Si ya está completa (marcador .scaffolded), solo repara
 * los symlinks y la devuelve. Si quedó a medias (falló un paso), vuelve a hacer el scaffold completo.
 */
export function scaffoldMotion(p: Project, opts: { style?: Style | null; presetDir?: string } = {}): string {
  return scaffoldDir(path.join(projectDir(p.id), "motion"), `proyecto ${p.id}`, opts);
}

/** Igual que scaffoldMotion pero en cualquier carpeta (p. ej. la carpeta temporal de la vista previa de un estilo). */
export function scaffoldDir(dir: string, owner: string, opts: { style?: Style | null; presetDir?: string } = {}): string {
  if (isScaffolded(dir)) { ensureLinks(dir); return dir; }
  fs.rmSync(path.join(dir, SCAFFOLD_MARKER), { force: true });

  for (const d of SUBDIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, SCAFFOLD_PENDING), `${new Date().toISOString()}\n`);
  const cp = (from: string, to: string): void => fs.copyFileSync(from, to);
  for (const f of ENGINE_FILES) cp(path.join(MOTION_DIR, "engine", f), path.join(dir, "film", f));
  for (const f of ENGINE_LIB_FILES) cp(path.join(MOTION_DIR, "engine", "lib", f), path.join(dir, "film", "lib", f));
  for (const f of SCRIPT_FILES) cp(path.join(MOTION_DIR, "scripts", f), path.join(dir, "scripts", f));
  cp(path.join(MOTION_DIR, "captions", "presets.json"), path.join(dir, "film", "lib", "caption_presets.json"));
  const fontsDir = path.join(MOTION_DIR, "captions", "fonts");
  for (const f of fs.readdirSync(fontsDir)) cp(path.join(fontsDir, f), path.join(dir, "assets", "fonts", "captions", f));
  for (const f of ["brief.md", "timeline.json"]) cp(path.join(MOTION_DIR, "templates", f), path.join(dir, f));
  const docs = path.join(MOTION_DIR, "templates", "docs");
  for (const f of fs.readdirSync(docs).filter((n) => n.endsWith(".md"))) cp(path.join(docs, f), path.join(dir, "docs", f));
  fs.writeFileSync(path.join(dir, ".owner"), `created ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} by Andoo (${owner})\n`);

  if (opts.style) copyStyle(opts.style, dir);
  ensureLinks(dir);

  const node = (args: string[]): void => {
    const r = spawnSync(process.execPath, args, { cwd: dir, stdio: "pipe", timeout: 120_000 });
    if (r.status !== 0) throw new Error(`Falló "node ${args.join(" ")}" al preparar el motor: ${String(r.stderr || r.stdout).slice(-600)}`);
  };
  if (opts.presetDir) node([path.join(dir, "scripts", "preset.mjs"), path.resolve(opts.presetDir), dir]);
  node(["film/lib/motion.test.js"]);
  node(["scripts/sync.mjs"]);
  fs.writeFileSync(path.join(dir, SCAFFOLD_MARKER), `ok ${new Date().toISOString()}\n`);
  fs.rmSync(path.join(dir, SCAFFOLD_PENDING), { force: true });
  return dir;
}

// ---------------------------------------------------------------- chequeo previo a ejecutar fuera del sandbox
// Archivos que cambian cómo node o python resuelven módulos: con ellos un proyecto podría hacer que un script del kit
// cargue código propio (por ejemplo package.json {"name":"playwright"} gana a node_modules por auto-referencia).
const FORBIDDEN_NAMES = new Set(["package.json", ".npmrc", ".yarnrc", ".yarnrc.yml", "sitecustomize.py", "usercustomize.py", "pyvenv.cfg"]);
const forbiddenName = (n: string): boolean => FORBIDDEN_NAMES.has(n) || /^\.pnp\./.test(n) || /\.pth$/i.test(n);
const realOr = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const PREFLIGHT_MAX_ENTRIES = 200_000;
const PREFLIGHT_MAX_DEPTH = 64;

/**
 * Llamar justo antes de ejecutar scripts del motor FUERA del sandbox del agente (render, hoja de contactos, lint, captura).
 * Lanza un Error (en español) si el proyecto no es seguro de ejecutar; si todo está bien, restaura scripts/render.mjs
 * desde el kit. Comprueba:
 *  - node_modules y .venv son enlaces simbólicos que apuntan al kit (APP_DIR/node_modules y motion/.venv);
 *  - en todo el árbol (sin límite de profundidad que deje pasar cosas: si se supera el presupuesto, falla cerrado) no hay
 *    package.json, .npmrc, .yarnrc*, .pnp.*, sitecustomize.py/usercustomize.py, *.pth ni node_modules anidados;
 *  - ningún enlace simbólico apunta fuera de la carpeta del proyecto.
 */
export function preflightUnsandboxed(dir: string): void {
  if (!fs.existsSync(dir)) throw new Error(`La carpeta del motor ya no existe: ${dir}`);
  try { ensureLinks(dir); } catch {}
  for (const [name, target] of [["node_modules", NODE_MODULES], [".venv", VENV]] as const) {
    if (!fs.existsSync(target)) continue;
    const link = path.join(dir, name);
    let ok = false;
    try { ok = fs.lstatSync(link).isSymbolicLink() && fs.realpathSync(link) === fs.realpathSync(target); } catch {}
    if (!ok) throw new Error(`La carpeta ${name} del proyecto fue modificada y no apunta al kit del motor: no se puede ejecutar el motor así.`);
  }
  // package.json / .npmrc junto a la carpeta del motor (un nivel arriba) también afectarían la resolución.
  for (const n of ["package.json", ".npmrc"]) {
    if (fs.existsSync(path.join(path.dirname(dir), n))) throw new Error(`Hay un ${n} junto a la carpeta del motor (${path.join(path.dirname(dir), n)}): bórralo; no se puede ejecutar el motor así.`);
  }
  const root = realOr(dir);
  const insideRoot = (p: string): boolean => p === root || p.startsWith(root + path.sep);
  let seen = 0;
  const walk = (d: string, depth: number): void => {
    if (depth > PREFLIGHT_MAX_DEPTH) throw new Error(`El proyecto tiene carpetas anidadas a más de ${PREFLIGHT_MAX_DEPTH} niveles (${path.relative(dir, d)}): simplifícalas; no se puede ejecutar el motor así.`);
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { throw new Error(`No se pudo revisar ${path.relative(dir, d) || "."} antes de ejecutar el motor: ${(e as Error).message}`); }
    for (const e of entries) {
      if (++seen > PREFLIGHT_MAX_ENTRIES) throw new Error(`El proyecto tiene más de ${PREFLIGHT_MAX_ENTRIES} archivos: bórrale los que sobren; no se puede ejecutar el motor así.`);
      const abs = path.join(d, e.name);
      const rel = path.relative(dir, abs);
      if (depth === 0 && (e.name === "node_modules" || e.name === ".venv")) continue; // ya verificados arriba
      if (e.name === "node_modules") throw new Error(`El proyecto tiene una carpeta node_modules propia (${rel}): bórrala; el motor solo usa la del kit.`);
      if (forbiddenName(e.name)) throw new Error(`El proyecto tiene ${rel}, que cambia cómo se cargan los módulos del motor: bórralo; no se puede ejecutar el motor así.`);
      if (e.isSymbolicLink()) {
        let to: string;
        try { to = fs.realpathSync(abs); } catch { try { to = path.resolve(path.dirname(abs), fs.readlinkSync(abs)); } catch { to = abs; } } // roto: su destino textual
        if (!insideRoot(to)) throw new Error(`El proyecto tiene un enlace simbólico que apunta fuera de su carpeta (${rel}). Bórralo y usa una copia del archivo.`);
      } else if (e.isDirectory()) walk(abs, depth + 1);
    }
  };
  walk(dir, 0);
  // render.mjs del proyecto siempre igual al del kit (el agente puede haberlo editado dentro de su sandbox).
  const scripts = path.join(dir, "scripts");
  try { if (fs.lstatSync(scripts).isSymbolicLink()) fs.rmSync(scripts, { force: true }); } catch {}
  fs.mkdirSync(scripts, { recursive: true });
  const rs = path.join(scripts, "render.mjs");
  fs.rmSync(rs, { recursive: true, force: true });
  fs.copyFileSync(KIT_RENDER, rs);
}

// ---------------------------------------------------------------- ejecución con cola global para trabajos pesados
let heavyTail: Promise<void> = Promise.resolve();
let heavyActive = 0;
// Procesos vivos lanzados por runMotion, por carpeta (para poder cortarlos al borrar un proyecto).
const children = new Map<ChildProcess, string>();
// Carpetas cortadas con killMotion (proyectos borrados): runMotion ya no arranca procesos dentro de ellas.
const blocked = new Set<string>();
const inside = (d: string, root: string): boolean => { const r = path.resolve(d); return r === root || r.startsWith(root + path.sep); };

/**
 * Para borrar un proyecto: bloquea nuevos procesos de runMotion dentro de `dir` (los que estén en cola fallan sin
 * arrancar), mata (SIGKILL) los que ya corren ahí y espera a que cierren (máx. timeoutMs). Devuelve cuántos mató.
 */
export async function killMotion(dir: string, timeoutMs = 5000): Promise<number> {
  const root = path.resolve(dir);
  blocked.add(root);
  const mine = [...children].filter(([, d]) => inside(d, root)).map(([c]) => c);
  await Promise.all(mine.map((c) => new Promise<void>((resolve) => {
    if (c.exitCode !== null || c.signalCode !== null) return resolve();
    const t = setTimeout(resolve, timeoutMs);
    c.once("close", () => { clearTimeout(t); resolve(); });
    try { c.kill("SIGKILL"); } catch { clearTimeout(t); resolve(); }
  })));
  return mine.length;
}

/** Ejecuta node o el python del motor dentro de `dir`. heavy=true → cola FIFO global, un solo trabajo pesado a la vez. */
export async function runMotion(
  dir: string,
  cmd: "node" | "python",
  args: string[],
  opts: { onLine?: (l: string) => void; heavy?: boolean; timeoutMs?: number; preflight?: boolean } = {},
): Promise<{ code: number; out: string }> {
  const exec = (): Promise<{ code: number; out: string }> => new Promise((resolve, reject) => {
    const localPy = path.join(dir, ".venv", "bin", "python");
    const bin = cmd === "node" ? process.execPath : fs.existsSync(localPy) ? localPy : fs.existsSync(VENV_PY) ? VENV_PY : "python3";
    if ([...blocked].some((b) => inside(dir, b))) { resolve({ code: 130, out: "Cancelado: el proyecto se eliminó." }); return; }
    if (!fs.existsSync(dir)) { resolve({ code: 127, out: `La carpeta del motor ya no existe: ${dir}` }); return; }
    // Justo antes de lanzar (después de la espera en la cola): el proyecto pudo cambiar mientras esperaba.
    if (opts.preflight) { try { preflightUnsandboxed(dir); } catch (e) { reject(e); return; } }
    // STUDIO_KIT_NODE_PATH: los scripts del kit cargan playwright desde aquí, nunca desde la carpeta del proyecto.
    const env = { ...process.env, PYTHONUNBUFFERED: "1", STUDIO_KIT_NODE_PATH: NODE_MODULES };
    const child = spawn(bin, args, { cwd: dir, env });
    children.set(child, dir);
    let out = "";
    const MAX = 200_000;
    const pending: Record<"o" | "e", string> = { o: "", e: "" };
    const feed = (k: "o" | "e", d: Buffer): void => {
      const s = d.toString();
      out += s;
      if (out.length > MAX) out = out.slice(-MAX);
      const parts = (pending[k] + s).split(/\r\n|\r|\n/);
      pending[k] = parts.pop() ?? "";
      for (const l of parts) if (l.trim()) opts.onLine?.(l);
    };
    child.stdout.on("data", (d: Buffer) => feed("o", d));
    child.stderr.on("data", (d: Buffer) => feed("e", d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? (opts.heavy ? 3 * 3600_000 : 30 * 60_000));
    const finish = (code: number, extra = ""): void => {
      clearTimeout(timer);
      children.delete(child);
      for (const k of ["o", "e"] as const) if (pending[k].trim()) opts.onLine?.(pending[k]);
      resolve({ code, out: out + extra });
    };
    child.on("error", (e) => finish(127, `\n${e.message}`));
    child.on("close", (code, signal) => finish(code ?? (signal ? 137 : 1)));
  });
  if (!opts.heavy) return exec();

  const prev = heavyTail;
  let release!: () => void;
  heavyTail = new Promise<void>((r) => (release = r));
  if (heavyActive > 0) opts.onLine?.("En cola: esperando a que termine otro render…");
  heavyActive++;
  await prev;
  try { return await exec(); }
  finally { heavyActive--; release(); }
}

// ---------------------------------------------------------------- render, contact sheet, URLs
function readTimelineFormats(dir: string): string[] {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8")).formats as string[]) || []; } catch { return []; }
}

/** Renderiza con scripts/render.mjs. Devuelve rutas relativas a `dir` (renders/draft_9x16.mp4 o renders/9x16.mp4). */
export async function renderMotion(dir: string, opts: { mode: "draft" | "final"; formats: Format[]; onProgress?: (msg: string) => void }): Promise<RenderOutput[]> {
  const formats = [...new Set(opts.formats)];
  if (!formats.length) throw new Error("Elige al menos un formato.");
  if (!fs.existsSync(KIT_RENDER)) throw new Error("Falta motion/scripts/render.mjs en el kit del estudio.");
  const draft = opts.mode === "draft";
  const say = opts.onProgress || (() => {});
  const label = draft ? "Borrador" : "Render final";
  const outRel = (fmt: Format): string => `renders/${draft ? "draft_" : ""}${fmt}.mp4`;

  let lastMsg = "";
  const onLine = (l: string): void => {
    const t = l.trim();
    let msg = "";
    // "<fmt> frame i/N" (render.mjs reenvía estas líneas también en --all, con o sin prefijo "[fmt] ")
    const m = /^(?:\[\d+x\d+\] )?(\d+x\d+) frame (\d+)\/(\d+)/.exec(t);
    const w = /^(?:\[(\d+x\d+)\] )?wrote (renders\/\S+\.mp4)/.exec(t);
    if (m) msg = `Render ${m[1]}: ${Math.round((Number(m[2]) / Math.max(1, Number(m[3]))) * 100)}%`;
    else if (w) msg = `Render ${w[1] || path.basename(w[2], ".mp4").replace(/^draft_/, "")}: listo`;
    else if (t.startsWith("En cola")) msg = t;
    if (msg && msg !== lastMsg) { lastMsg = msg; say(msg); }
  };

  // Varios formatos: una sola llamada con --all/--jobs si coinciden con timeline.formats; si no, una por formato.
  const tlFormats = readTimelineFormats(dir);
  const sameSet = formats.length > 1 && tlFormats.length === formats.length && formats.every((f) => tlFormats.includes(f));
  // Siempre el render.mjs del kit (ruta absoluta), nunca la copia editable del proyecto.
  const base = [KIT_RENDER, ...(draft ? ["--draft"] : [])];
  const calls: string[][] = sameSet
    ? [[...base, "--all", "--jobs", String(Math.max(1, Math.min(formats.length, 4, Math.floor(os.cpus().length / 2))))]]
    : formats.map((f) => [...base, "--fmt", f]);

  say(`${label}: ${formats.join(", ")}…`);
  const started = Date.now();
  for (const args of calls) {
    const r = await runMotion(dir, "node", args, { heavy: true, onLine, preflight: true });
    if (r.code !== 0) throw new Error(`El render falló (código ${r.code}): ${r.out.trim().split(/\r|\n/).slice(-8).join(" · ").slice(-700)}`);
  }

  const at = new Date().toISOString();
  const outs: RenderOutput[] = [];
  for (const fmt of formats) {
    const rel = outRel(fmt);
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs) || fs.statSync(abs).mtimeMs < started - 2000) throw new Error(`El render terminó pero no encontré ${rel}.`);
    let seconds: number | undefined;
    try { seconds = Math.round((await probeDuration(abs)) * 100) / 100 || undefined; } catch {}
    outs.push({ fmt, mode: opts.mode, path: rel, at, ...(seconds ? { seconds } : {}) });
  }
  say(`${label} listo: ${outs.map((o) => o.path).join(", ")}`);
  return outs;
}

/** Contact sheet (un fotograma por beat) → rutas relativas a `dir` (review/sheets/sheet_<fmt>.jpg y _phone.jpg). */
export async function sheetMotion(dir: string, fmt: Format): Promise<string[]> {
  const r = await runMotion(dir, "node", [KIT_RENDER, "--sheet", "--fmt", fmt], { heavy: true, preflight: true });
  if (r.code !== 0) throw new Error(`No se pudo generar la hoja de contactos (código ${r.code}): ${r.out.trim().split(/\r|\n/).slice(-6).join(" · ").slice(-600)}`);
  const rels = [`review/sheets/sheet_${fmt}.jpg`, `review/sheets/sheet_${fmt}_phone.jpg`].filter((rel) => fs.existsSync(path.join(dir, rel)));
  if (!rels.length) throw new Error("La hoja de contactos no se generó.");
  return rels;
}

/** URL servible de un archivo de la carpeta del motor: "/media/<pid>/motion/<rel>". */
export function mediaUrl(pid: string, relInMotion: string): string {
  const rel = relInMotion.replace(/\\/g, "/").replace(/^\.?\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `/media/${encodeURIComponent(pid)}/motion/${rel}`;
}
