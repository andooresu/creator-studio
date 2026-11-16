// Rutas del motor de video: estado del entorno y render (borrador/final) de la carpeta motion del proyecto.
import express from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import { save, id, getProject } from "../db.ts";
import { startJob } from "../pipeline.ts";
import { motionEnv, renderMotion, mediaUrl, preflightUnsandboxed } from "../motion/kit.ts";
import { FORMATS } from "../../shared/types.ts";
import type { Format, Project } from "../../shared/types.ts";

export const motionRouter = express.Router();

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response) =>
  Promise.resolve().then(() => fn(req, res)).catch((e: unknown) => res.status(400).json({ error: (e as Error).message }));

motionRouter.get("/api/motion/env", wrap((_req, res) => res.json(motionEnv())));

motionRouter.post("/api/projects/:id/motion/render", wrap((req, res) => {
  const p: Project | undefined = getProject(req.params.id);
  if (!p) throw new Error("Proyecto no encontrado");
  const prod = p.production;
  if (!prod?.dir || !fs.existsSync(prod.dir)) throw new Error("Este proyecto aún no tiene carpeta del motor de video. Inicia la producción primero.");
  const mode = req.body?.mode === "final" ? "final" : req.body?.mode === "draft" || req.body?.mode === undefined ? "draft" : null;
  if (!mode) throw new Error('Modo inválido: usa "draft" o "final".');
  const raw: unknown[] = Array.isArray(req.body?.formats) ? req.body.formats : req.body?.formats ? [req.body.formats] : ["9x16"];
  const formats = [...new Set(raw)].filter((f): f is Format => (FORMATS as readonly unknown[]).includes(f));
  if (!formats.length || formats.length !== new Set(raw).size) throw new Error(`Formatos inválidos: usa ${FORMATS.join(", ")}.`);

  // Aviso inmediato si el proyecto no es seguro de ejecutar fuera del sandbox (renderMotion lo vuelve a comprobar
  // justo antes de lanzar el proceso, después de la cola).
  preflightUnsandboxed(prod.dir);

  startJob(p, "render", async (step) => {
    const outs = await renderMotion(prod.dir, { mode, formats, onProgress: step });
    const now = new Date().toISOString();
    prod.renders = [...(prod.renders || []), ...outs];
    prod.events = prod.events || [];
    prod.events.push({
      id: id(),
      at: now,
      type: "media",
      text: `${mode === "final" ? "Render final" : "Borrador"} listo: ${outs.map((o) => o.fmt).join(", ")}`,
      media: outs.map((o) => mediaUrl(p.id, o.path)),
      data: outs,
    });
    prod.updatedAt = now;
    p.updatedAt = now;
    save();
  });
  res.json(p);
}));
