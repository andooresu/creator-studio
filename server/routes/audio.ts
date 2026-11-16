// Rutas del audio del motor (tres modos). server/index.ts monta: app.use(audioRouter)
import express from "express";
import type { Request, Response } from "express";
import { startJob } from "../pipeline.ts";
import { audioEnv } from "../audio/env.ts";
import { installEngine, isLocalEngine, checkInstallable } from "../audio/install.ts";
import { listVoices } from "../audio/provider.ts";
import type { AudioEnv, Job, Jobbable, LogEntry } from "../../shared/types.ts";

export const audioRouter = express.Router();

/** Instalación de motores en curso (una a la vez). El progreso se lee con GET /api/audio/env (campo job). */
export const audioJob: Jobbable = { job: null, log: [] };

export type AudioEnvResponse = AudioEnv & { job: Job | null; log: LogEntry[] };

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response) => Promise.resolve().then(() => fn(req, res)).catch((e: unknown) => res.status(400).json({ error: (e as Error).message }));

audioRouter.use("/api/audio", express.json({ limit: "1mb" }));

audioRouter.get("/api/audio/env", wrap((_req, res) => {
  const out: AudioEnvResponse = { ...audioEnv(), job: audioJob.job || null, log: (audioJob.log || []).slice(-30) };
  res.json(out);
}));

audioRouter.post("/api/audio/install", wrap((req, res) => {
  const engine: unknown = req.body?.engine;
  if (!isLocalEngine(engine)) throw new Error("Motor desconocido. Usa kokoro, chatterbox, acestep o stableaudio.");
  checkInstallable(engine);
  if (audioJob.job?.status === "running") throw new Error("Ya hay una instalación de audio en curso. Espera a que termine.");
  audioJob.log = [];
  startJob(audioJob, `audio-${engine}`, (step) => installEngine(engine, step));
  res.json({ job: audioJob.job });
}));

audioRouter.get("/api/audio/voices", wrap(async (_req, res) => {
  res.json({ voices: await listVoices() });
}));
