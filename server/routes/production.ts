// Rutas de la sesión de producción (agente productor): estimación, iniciar, mensajes, respuestas, aprobaciones, tope de
// costo y detener.
import express from "express";
import type { Request, Response } from "express";
import { getProject } from "../db.ts";
import { startProduction, sendMessage, answerQuestion, decideApproval, stopProduction, resolveBudget } from "../agent/runner.ts";
import { modeOf } from "../agent/prompt.ts";
import type { ProductionMode } from "../agent/prompt.ts";
import { estimateProduction } from "../agent/estimate.ts";
import { getStyle } from "../styles/store.ts";
import type { Project } from "../../shared/types.ts";

export const productionRouter = express.Router();

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response) =>
  Promise.resolve().then(() => fn(req, res)).catch((e: unknown) => res.status(400).json({ error: (e as Error)?.message || String(e) }));
const need = (req: Request): Project => {
  const p = getProject(req.params.id);
  if (!p) throw new Error("Proyecto no encontrado");
  return p;
};
const MODES = ["reel", "clase", "talking"] as const;

// Estimación antes de producir (costo, minutos, preguntas y tope por defecto): cálculo local, sin llamar a la IA.
productionRouter.get("/api/projects/:id/production/estimate", wrap((req, res) => {
  const p = need(req);
  const raw = req.query.mode;
  if (raw !== undefined && raw !== "" && !(MODES as readonly unknown[]).includes(raw)) throw new Error('Modo inválido: usa "reel", "clase" o "talking".');
  const mode = (raw || (p.production as { mode?: ProductionMode } | null | undefined)?.mode || modeOf(p)) as ProductionMode;
  res.json(estimateProduction(p, mode));
}));

productionRouter.post("/api/projects/:id/production/start", wrap((req, res) => {
  const p = need(req);
  const raw = req.body?.mode;
  if (raw !== undefined && raw !== null && raw !== "" && !(MODES as readonly unknown[]).includes(raw)) throw new Error('Modo inválido: usa "reel", "clase" o "talking".');
  // sin modo explícito: el de la producción existente (si se reanuda) o el del tipo de proyecto
  const mode = (raw || (p.production ? undefined : modeOf(p))) as (typeof MODES)[number] | undefined;
  const changeMode = req.body?.changeMode === true;
  const brief = typeof req.body?.brief === "string" ? req.body.brief : undefined;
  // "Producir de nuevo con este estilo": el cliente puede mandar el estilo nuevo junto con el inicio
  let restyle = false;
  const prevStyle = p.styleId ?? null;
  const sid = req.body?.styleId;
  if (sid !== undefined) {
    if (sid !== null && typeof sid !== "string") throw new Error("Estilo inválido.");
    const next = sid ? String(sid) : null;
    if (next && !getStyle(next)) throw new Error("Ese estilo ya no existe.");
    if ((p.styleId || null) !== next) { p.styleId = next; restyle = true; }
  }
  // tope de costo de este video (US$; 0 = el de Ajustes): lo valida el runner
  const capRaw = req.body?.capUsd;
  if (capRaw !== undefined && capRaw !== null && (typeof capRaw !== "number" || !Number.isFinite(capRaw) || capRaw < 0)) throw new Error("El tope de costo debe ser un número en US$ mayor o igual a 0.");
  const capUsd = typeof capRaw === "number" ? capRaw : undefined;
  try { startProduction(p, { mode, brief, changeMode, restyle, flags: req.body?.flags, capUsd }); } // flags: opciones de inicio (las valida el runner)
  catch (e) { if (restyle) p.styleId = prevStyle; throw e; } // si no arrancó, el cambio de estilo no queda a medias
  res.json(p);
}));

productionRouter.post("/api/projects/:id/production/message", wrap((req, res) => {
  const p = need(req);
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) throw new Error("Escribe un mensaje.");
  sendMessage(p, text);
  res.json(p);
}));

productionRouter.post("/api/projects/:id/production/answer", wrap((req, res) => {
  const p = need(req);
  const questionId = String(req.body?.questionId || "");
  const answers = req.body?.answers;
  if (!questionId) throw new Error("Falta questionId.");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Faltan las respuestas.");
  answerQuestion(p, questionId, answers as Record<string, string>);
  res.json(p);
}));

productionRouter.post("/api/projects/:id/production/approve", wrap((req, res) => {
  const p = need(req);
  const approvalId = String(req.body?.approvalId || "");
  if (!approvalId) throw new Error("Falta approvalId.");
  if (typeof req.body?.approved !== "boolean") throw new Error("Indica si apruebas (approved: true o false).");
  const feedback = typeof req.body?.feedback === "string" ? req.body.feedback : undefined;
  decideApproval(p, approvalId, req.body.approved, feedback);
  res.json(p);
}));

// Aviso de tope de costo: { budgetId, raiseTo } sube el tope y reanuda; { budgetId, stop: true } detiene.
productionRouter.post("/api/projects/:id/production/budget", wrap((req, res) => {
  const p = need(req);
  const budgetId = String(req.body?.budgetId || "");
  if (!budgetId) throw new Error("Falta budgetId.");
  const stop = req.body?.stop === true;
  const raiseTo = req.body?.raiseTo;
  if (!stop && (typeof raiseTo !== "number" || !Number.isFinite(raiseTo))) throw new Error("Indica el nuevo tope (raiseTo) o detén la producción (stop: true).");
  resolveBudget(p, budgetId, stop ? { stop: true } : { raiseTo: raiseTo as number });
  res.json(p);
}));

productionRouter.post("/api/projects/:id/production/stop", wrap((req, res) => {
  const p = need(req);
  stopProduction(p);
  res.json(p);
}));
