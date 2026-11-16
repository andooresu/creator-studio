// Miniaturas de proyecto para Inicio. server/index.ts monta: app.use(thumbsRouter)
// GET /api/projects/:id/thumb → JPEG cacheado en data/projects/<id>/thumb.jpg (~360 px de ancho), sacado con ffmpeg
// del mejor video disponible: el render más reciente del motor (final antes que borrador, 9x16 antes que otros formatos),
// si no el video editado/cortado, si no la grabación. Solo usa renders terminados (nombres conocidos y sin escribirse
// en los últimos segundos). La caché se identifica por la fuente (thumb.json = {file, mtimeMs}): si cambia el archivo
// o su fecha (aunque sea a una más vieja), se regenera. Si ffmpeg falla y ya hay una miniatura, se sigue sirviendo.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getProject, PROJECTS_DIR } from "../db.ts";
import { run, probeDuration } from "../media.ts";
import type { Project } from "../../shared/types.ts";

export const thumbsRouter = express.Router();

const THUMB_W = 360;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Solo renders terminados de renderMotion/render.mjs (excluye clip_*, *.mp4.tmp.mp4 del muxeo, etc.). */
const RENDER_RE = /^(draft_)?(9x16|1x1|4x5|16x9)\.mp4$/;
/** Un video tocado hace menos de esto puede estar escribiéndose todavía (render.mjs escribe directo al nombre final). */
const SETTLE_MS = 10_000;

export interface ThumbSource { file: string; mtimeMs: number }

const statFile = (f: string): fs.Stats | null => {
  try { const s = fs.statSync(f); return s.isFile() && s.size > 0 ? s : null; } catch { return null; }
};
/** Como statFile, pero descarta videos modificados hace muy poco (posible escritura en curso). */
const statSettled = (f: string): fs.Stats | null => {
  const s = statFile(f);
  return s && Date.now() - s.mtimeMs >= SETTLE_MS ? s : null;
};

/** Ruta dentro de la carpeta del proyecto (rechaza rutas que escapen de ella). */
const inside = (dir: string, rel: string): string | null => {
  const abs = path.resolve(dir, rel);
  return abs === dir || abs.startsWith(dir + path.sep) ? abs : null;
};

/** Elige la mejor fuente para la miniatura. Solo hace comprobaciones baratas de disco (sin ffmpeg). */
export function thumbSource(p: Project): ThumbSource | null {
  if (!ID_RE.test(p.id)) return null;
  const dir = path.join(PROJECTS_DIR, p.id);
  // 1) Renders del motor de video
  const rdir = path.join(dir, "motion", "renders");
  let best: { file: string; mtimeMs: number; rank: number } | null = null;
  let names: string[] = [];
  try { names = fs.readdirSync(rdir); } catch { /* sin renders */ }
  for (const n of names) {
    if (!RENDER_RE.test(n)) continue;
    const file = path.join(rdir, n);
    const s = statSettled(file);
    if (!s) continue;
    const rank = (n.startsWith("draft_") ? 0 : 2) + (n.includes("9x16") ? 1 : 0);
    if (!best || rank > best.rank || (rank === best.rank && s.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: s.mtimeMs, rank };
  }
  if (best) return { file: best.file, mtimeMs: best.mtimeMs };
  // 2) Video editado (final, luego el corte sin subtítulos): rutas relativas a la carpeta del proyecto
  for (const rel of [p.edit?.final, p.edit?.cut]) {
    if (!rel) continue;
    const file = inside(dir, rel);
    const s = file ? statSettled(file) : null;
    if (file && s) return { file, mtimeMs: s.mtimeMs };
  }
  // 3) Grabación (ruta absoluta guardada en el proyecto)
  if (p.recording?.file) {
    const s = statFile(p.recording.file);
    if (s) return { file: p.recording.file, mtimeMs: s.mtimeMs };
  }
  return null;
}

/** Identidad corta de la fuente (archivo + fecha): cambia si cambia cualquiera de los dos. */
export const sourceKey = (src: ThumbSource): string =>
  crypto.createHash("sha1").update(`${src.file}\0${Math.round(src.mtimeMs)}`).digest("hex").slice(0, 10);

/** URL para el resumen de /api/state (solo si hay fuente). La versión cambia cuando cambia la fuente. */
export function thumbUrl(p: Project): string | undefined {
  const src = thumbSource(p);
  return src ? `/api/projects/${p.id}/thumb?v=${sourceKey(src)}` : undefined;
}

interface ThumbMeta { file: string; mtimeMs: number }
const readMeta = (f: string): ThumbMeta | null => {
  try { const m = JSON.parse(fs.readFileSync(f, "utf8")); return m && typeof m.file === "string" && typeof m.mtimeMs === "number" ? m : null; } catch { return null; }
};

const inflight = new Map<string, Promise<string | null>>();

/** Devuelve la ruta del JPEG (generándolo si falta o está viejo), o null si el proyecto no tiene video. */
export function ensureThumb(p: Project): Promise<string | null> {
  const pending = inflight.get(p.id);
  if (pending) return pending;
  const job = (async () => {
    const src = thumbSource(p);
    if (!src) return null;
    const out = path.join(PROJECTS_DIR, p.id, "thumb.jpg");
    const metaFile = path.join(PROJECTS_DIR, p.id, "thumb.json");
    const cached = statFile(out);
    const meta = cached ? readMeta(metaFile) : null;
    if (cached && meta && meta.file === src.file && Math.round(meta.mtimeMs) === Math.round(src.mtimeMs)) return out;
    let dur = 0;
    try { dur = await probeDuration(src.file); } catch { /* sin duración: primer fotograma */ }
    const t = dur > 0 ? Math.max(0, dur * 0.4) : 0;
    const tmp = path.join(PROJECTS_DIR, p.id, `thumb.${process.pid}.${Date.now()}.tmp.jpg`);
    try {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", src.file, "-frames:v", "1", "-vf", `scale=${THUMB_W}:-2`, "-q:v", "4", tmp], { timeoutMs: 60_000 });
      if (!statFile(tmp)) throw new Error("ffmpeg no escribió la miniatura");
      fs.renameSync(tmp, out);
      try {
        const metaTmp = `${metaFile}.${process.pid}.tmp`;
        fs.writeFileSync(metaTmp, JSON.stringify({ file: src.file, mtimeMs: Math.round(src.mtimeMs) } satisfies ThumbMeta));
        fs.renameSync(metaTmp, metaFile);
      } catch { /* sin sidecar: se regenerará la próxima vez */ }
      return out;
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nada */ }
      // Mejor una miniatura algo vieja que ninguna: se conserva y se sirve la caché existente.
      if (statFile(out)) return out;
      throw e;
    }
  })().finally(() => inflight.delete(p.id));
  inflight.set(p.id, job);
  return job;
}

thumbsRouter.get("/api/projects/:id/thumb", async (req, res) => {
  const pid = String(req.params.id || "");
  if (!ID_RE.test(pid)) return res.status(404).end();
  const p = getProject(pid);
  if (!p) return res.status(404).end();
  try {
    const file = await ensureThumb(p);
    if (!file) return res.status(404).end();
    res.setHeader("Cache-Control", req.query.v ? "private, max-age=604800" : "no-cache");
    res.type("image/jpeg").sendFile(file);
  } catch {
    res.status(500).end();
  }
});
