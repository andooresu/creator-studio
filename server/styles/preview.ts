// Vista previa de un estilo: un clip corto en bucle (demo/preview.mp4, sin audio) y su póster (demo/poster.jpg).
// Origen, en este orden:
//   1. La demo del estilo (demo/index.html + film.js + timeline.json): se renderiza con el motor en una carpeta temporal.
//   2. Un render ya hecho en los proyectos de los que se importó el estilo (renders/*.mp4): se recorta.
// Los estilos base traen su vista previa en el repo (se genera con scripts/style-previews.ts); los del usuario la
// generan desde la app y la guardan en data/styles/<id>/demo/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../db.ts";
import { run, probeDuration } from "../media.ts";
import { scaffoldDir, renderMotion, runMotion } from "../motion/kit.ts";
import { styleFolder, listFiles, PREVIEW_VIDEO, PREVIEW_POSTER } from "./store.ts";
export { stylePreview } from "./store.ts";
import type { Format, Style } from "../../shared/types.ts";

const DEMO_FILES = ["demo/index.html", "demo/film.js", "demo/timeline.json"];
/** Duración máxima del clip recortado de un render existente (s). */
const CLIP_MAX = 15;

export function hasDemo(style: Pick<Style, "files">): boolean {
  return DEMO_FILES.every((f) => (style.files || []).includes(f));
}

/** Render más reciente de los proyectos fuente (prefiere 9x16 y finales sobre borradores). */
export function sourceRender(style: Pick<Style, "sources">): string | null {
  const found: { file: string; score: number }[] = [];
  for (const src of style.sources || []) {
    if (!src || src.startsWith("base:")) continue;
    const dir = path.join(src, "renders");
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((n) => /\.mp4$/i.test(n)); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      let mtime = 0;
      try { const st = fs.statSync(file); if (!st.isFile() || st.size < 50_000) continue; mtime = st.mtimeMs; } catch { continue; }
      // 9x16 primero, luego finales antes que borradores, luego el más reciente
      const score = (/9x16/.test(n) ? 4e13 : 0) + (/^draft_/.test(n) ? 0 : 2e13) + mtime;
      found.push({ file, score });
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.file || null;
}

export function canPreview(style: Style): boolean {
  return hasDemo(style) || Boolean(sourceRender(style));
}

const TMP_ROOT = path.join(DATA_DIR, "tmp", "style-previews");
const tmpDir = (sid: string): string => path.join(TMP_ROOT, `${sid.replace(/[^\w-]/g, "_")}-${crypto.randomBytes(4).toString("hex")}`);

/** Borra carpetas temporales de vistas previas de ejecuciones anteriores (llamar al arrancar el servidor). */
export function sweepPreviewTmp(maxAgeMs = 0): void {
  let names: string[] = [];
  try { names = fs.readdirSync(TMP_ROOT); } catch { return; }
  for (const n of names) {
    const d = path.join(TMP_ROOT, n);
    try { if (Date.now() - fs.statSync(d).mtimeMs >= maxAgeMs) fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
}

// Siempre 540x960 (9:16): un origen horizontal o cuadrado se centra sobre una copia desenfocada de sí mismo,
// así la vista previa vertical muestra el cuadro completo en vez de recortarlo.
const FIT_9x16 = "[0:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=18:2[bg];" +
  "[0:v]scale=540:960:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1";

/** Codifica `src` como vista previa liviana (540x960, 30 fps, sin audio) + póster, y los deja en <outDir>/demo/. */
async function encodePreview(src: string, outDir: string, sid: string, opts: { maxSeconds?: number } = {}): Promise<void> {
  const dur = await probeDuration(src).catch(() => 0);
  const len = opts.maxSeconds && dur ? Math.min(dur, opts.maxSeconds) : dur;
  // todo se escribe fuera de la carpeta del estilo y solo se mueve al final: un fallo no deja archivos a medias en el estilo
  const work = tmpDir(sid);
  fs.mkdirSync(work, { recursive: true });
  try {
    await encodeInto(src, work, len);
    fs.mkdirSync(path.join(outDir, "demo"), { recursive: true });
    fs.copyFileSync(path.join(work, "preview.mp4"), path.join(outDir, PREVIEW_VIDEO));
    fs.copyFileSync(path.join(work, "poster.jpg"), path.join(outDir, PREVIEW_POSTER));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function encodeInto(src: string, work: string, len: number): Promise<void> {
  const video = path.join(work, "preview.mp4");
  const poster = path.join(work, "poster.jpg");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, ...(len ? ["-t", String(len)] : []),
    "-filter_complex", `${FIT_9x16},fps=30`, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", video]);
  // póster: de 5 fotogramas candidatos (25–75 %), el de más detalle (JPEG más pesado), para no quedar en una transición vacía
  const total = len || 2;
  let best: { file: string; size: number } | null = null;
  for (const [i, f] of [0.25, 0.38, 0.5, 0.62, 0.75].entries()) {
    const file = `${poster}.${i}.jpg`;
    try {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", (total * f).toFixed(2), "-i", src, "-frames:v", "1", "-filter_complex", FIT_9x16, "-q:v", "4", file]);
      const size = fs.statSync(file).size;
      if (!best || size > best.size) { if (best) fs.rmSync(best.file, { force: true }); best = { file, size }; }
      else fs.rmSync(file, { force: true });
    } catch { fs.rmSync(file, { force: true }); }
  }
  if (!best) throw new Error("No se pudo extraer el póster de la vista previa.");
  fs.renameSync(best.file, poster);
}

/** Copia los archivos de la demo del estilo a una carpeta del motor ya preparada (como dice "Cómo usar la demo"). */
function installDemo(style: Style, dir: string): void {
  const src = styleFolder(style);
  const cp = (rel: string, to: string): void => {
    const from = path.resolve(src, rel);
    if (!from.startsWith(path.resolve(src) + path.sep) || !fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  cp("demo/index.html", path.join(dir, "film", "index.html"));
  cp("demo/film.js", path.join(dir, "film", "film.js"));
  cp("demo/timeline.json", path.join(dir, "timeline.json"));
  for (const rel of style.files || []) {
    if (/^helpers\/[^/]+\.js$/.test(rel)) cp(rel, path.join(dir, "film", path.basename(rel)));
    else if (/^fonts\/[^/]+\.(woff2?|ttf|otf)$/i.test(rel)) cp(rel, path.join(dir, "assets", "fonts", path.basename(rel)));
    else if (/^demo\/assets\//.test(rel)) cp(rel, path.join(dir, "assets", rel.slice("demo/assets/".length)));
  }
}

/**
 * Genera la vista previa del estilo y la escribe en `outDir` (por defecto la carpeta del estilo).
 * Devuelve de dónde salió: "demo" o la ruta del render recortado.
 */
export async function renderStylePreview(style: Style, step: (msg: string) => void, opts: { outDir?: string } = {}): Promise<string> {
  const outDir = opts.outDir || styleFolder(style);
  if (hasDemo(style)) {
    const work = tmpDir(style.id);
    const dir = path.join(work, "motion");
    try {
      step("Preparando el motor para la demo del estilo…");
      scaffoldDir(dir, `vista previa del estilo ${style.id}`);
      installDemo(style, dir);
      const sync = await runMotion(dir, "node", ["scripts/sync.mjs"], { preflight: true });
      if (sync.code !== 0) throw new Error(`La demo del estilo no se pudo preparar: ${sync.out.trim().split(/\r|\n/).slice(-4).join(" · ").slice(-500)}`);
      let formats: string[] = [];
      try { formats = JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8")).formats || []; } catch {}
      const fmt = (formats.includes("9x16") ? "9x16" : formats[0] || "9x16") as Format;
      const [out] = await renderMotion(dir, { mode: "draft", formats: [fmt], onProgress: step });
      step("Comprimiendo la vista previa…");
      await encodePreview(path.join(dir, out.path), outDir, style.id);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    return "demo";
  }
  const src = sourceRender(style);
  if (!src) throw new Error("Este estilo no tiene demo ni renders en sus proyectos de origen. La vista previa se podrá generar cuando tenga una demo (duplica un estilo base) o un render.");
  step("Recortando un render de los proyectos del estilo…");
  await encodePreview(src, outDir, style.id, { maxSeconds: CLIP_MAX });
  return src;
}

/** Tras generar la vista previa de un estilo del usuario, refresca su lista de archivos. */
export function refreshFiles(style: Style): void {
  style.files = listFiles(styleFolder(style), (rel) => rel === "style.json" || rel.startsWith("versions/"));
}
