// Rutas de la biblioteca de estilos. server/index.ts monta: app.use(stylesRouter)
import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { STYLES_DIR, load } from "../db.ts";
import { hasKey } from "../ai.ts";
import { startJob } from "../pipeline.ts";
import { listStyles, getStyle, updateStyle, duplicateStyle, deleteStyle, styleFilePath, saveUserStyle, stylePreview, STYLE_KINDS } from "../styles/store.ts";
import { canPreview, renderStylePreview, refreshFiles } from "../styles/preview.ts";
import { importStylesFromPath } from "../styles/importer.ts";
import { learnStyleFromVideo } from "../styles/learn.ts";
import { createStyle, iterateStyle } from "../styles/create.ts";
import type { Jobbable, Style, StyleKind } from "../../shared/types.ts";

export const stylesRouter = express.Router();

/** Trabajo de estilos en curso (importar, aprender, crear, iterar): uno a la vez, como brandGen. */
export const styleJob: Jobbable = { job: null, log: [] };

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response) => Promise.resolve().then(() => fn(req, res)).catch((e: unknown) => res.status(400).json({ error: (e as Error).message }));

/** Copia del estilo con su vista previa y si se puede generar (campos calculados, no se guardan). */
const withPreview = (s: Style): Style => {
  const preview = stylePreview(s);
  return { ...s, ...(preview ? { preview } : {}), canPreview: s.origin !== "base" && canPreview(s) };
};

const needStyle = (req: Request): Style => {
  const s = getStyle(String(req.params.sid));
  if (!s) throw new Error("Estilo no encontrado");
  return s;
};
const needKey = (): void => { if (!hasKey()) throw new Error("Falta la API key del proveedor de IA elegido. Agrégala en Ajustes."); };
const begin = (fn: Parameters<typeof startJob>[2]): void => {
  if (styleJob.job?.status === "running") throw new Error("Ya hay un trabajo de estilos en curso. Espera a que termine.");
  styleJob.log = [];
  startJob(styleJob, "estilos", fn);
};

/** Estilos que un trabajo de "iterar" está reescribiendo: PUT y DELETE sobre ellos responden 409 hasta que termine. */
const iterating = new Set<string>();
const busy = (sid: string): boolean => styleJob.job?.status === "running" && iterating.has(sid);
const BUSY_MSG = "La IA está ajustando este estilo. Espera a que termine para editarlo o borrarlo.";

const UPLOADS = path.join(STYLES_DIR, "_uploads");
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => { fs.mkdirSync(UPLOADS, { recursive: true }); cb(null, UPLOADS); },
    filename: (_r, f, cb) => cb(null, Date.now() + "-" + f.originalname.replace(/[^\w.\-]+/g, "_")),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

stylesRouter.use("/api/styles", express.json({ limit: "10mb" }));

stylesRouter.get("/api/styles", wrap((_req, res) => {
  load();
  res.json({ styles: listStyles().map(withPreview), job: styleJob.job || null });
}));

stylesRouter.get("/api/styles/:sid", wrap((req, res) => res.json(withPreview(needStyle(req)))));

stylesRouter.post("/api/styles/import", wrap((req, res) => {
  const p = typeof req.body?.path === "string" ? req.body.path.trim() : "";
  if (!p) throw new Error("Escribe la ruta de la carpeta del proyecto (o de la carpeta con varios proyectos).");
  const abs = path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error("La carpeta no existe o no es una carpeta.");
  begin(async (step) => { await importStylesFromPath(abs, step); });
  res.json({ job: styleJob.job });
}));

stylesRouter.post("/api/styles/learn", upload.single("file"), wrap((req, res) => {
  const f = req.file;
  if (!f) throw new Error("No llegó ningún archivo. Vuelve a elegir el video.");
  if (!/^video\//.test(f.mimetype) && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.originalname)) {
    fs.rmSync(f.path, { force: true });
    throw new Error("El archivo debe ser un video (mp4, mov, webm…).");
  }
  // el video subido solo hace falta durante el análisis (las salidas quedan en ref/ del estilo): se borra al terminar, bien o mal
  try { begin(async (step) => { try { await learnStyleFromVideo(f.path, step); } finally { fs.rmSync(f.path, { force: true }); } }); }
  catch (e) { fs.rmSync(f.path, { force: true }); throw e; }
  res.json({ job: styleJob.job });
}));

stylesRouter.post("/api/styles/create", wrap((req, res) => {
  const b = req.body || {};
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (!description) throw new Error("Describe el estilo que quieres (ritmo, tipografía, colores, transiciones…).");
  const kind: StyleKind = STYLE_KINDS.includes(b.kind) ? b.kind : "reel";
  needKey();
  const input = { name: typeof b.name === "string" ? b.name.trim() : "", kind, description, brandId: typeof b.brandId === "string" && b.brandId ? b.brandId : null };
  begin(async (step) => { await createStyle(input, step); });
  res.json({ job: styleJob.job });
}));

stylesRouter.put("/api/styles/:sid", wrap((req, res) => {
  if (busy(String(req.params.sid))) return res.status(409).json({ error: BUSY_MSG });
  res.json(updateStyle(String(req.params.sid), req.body || {}));
}));

stylesRouter.post("/api/styles/:sid/iterate", wrap((req, res) => {
  const s = needStyle(req);
  const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim() : "";
  if (!feedback) throw new Error("Escribe qué quieres cambiar del estilo.");
  needKey();
  begin(async (step) => {
    iterating.add(s.id);
    let copyId: string | null = null;
    try {
      await iterateStyle(s, feedback, step, { onTarget: (id) => { copyId = id; iterating.add(id); } });
    } finally {
      iterating.delete(s.id);
      if (copyId) iterating.delete(copyId);
    }
  });
  res.json({ job: styleJob.job });
}));

// (re)genera la vista previa de un estilo del usuario: renderiza su demo o recorta un render de sus proyectos
stylesRouter.post("/api/styles/:sid/preview", wrap((req, res) => {
  const s = needStyle(req);
  if (s.origin === "base") throw new Error("Los estilos base ya traen su vista previa.");
  if (!canPreview(s)) throw new Error("Este estilo no tiene demo ni renders en sus proyectos de origen para generar una vista previa.");
  if (busy(s.id)) return res.status(409).json({ error: BUSY_MSG });
  begin(async (step) => {
    iterating.add(s.id);
    try {
      await renderStylePreview(s, step);
      const fresh = getStyle(s.id);
      if (fresh && fresh.origin !== "base") { refreshFiles(fresh); saveUserStyle(fresh); }
      step("Vista previa lista ✓");
    } finally { iterating.delete(s.id); }
  });
  res.json({ job: styleJob.job });
}));

stylesRouter.post("/api/styles/:sid/duplicate", wrap((req, res) => {
  const s = needStyle(req);
  if (busy(s.id)) return res.status(409).json({ error: BUSY_MSG });
  res.json(duplicateStyle(s.id, typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : undefined));
}));

stylesRouter.delete("/api/styles/:sid", wrap((req, res) => {
  if (busy(String(req.params.sid))) return res.status(409).json({ error: BUSY_MSG });
  deleteStyle(String(req.params.sid));
  res.json({ ok: true });
}));

// archivos del estilo (helpers, ejemplos, hojas de referencia, fuentes)
stylesRouter.get("/styles-files/:sid/*", (req: Request, res: Response) => {
  const s = getStyle(String(req.params.sid));
  const rel = String((req.params as Record<string, string>)[0] || "");
  const abs = s ? styleFilePath(s, rel) : null;
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).json({ error: "Archivo no encontrado" });
  res.sendFile(abs);
});
