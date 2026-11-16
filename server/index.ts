// Andoo CreatorStudio — servidor local. Abre http://localhost:4747
import express from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { load, save, id, getProject, projectDir, log, APP_DIR, PROJECTS_DIR, BRANDS_DIR, INSPO_DIR, DEFAULT_BRAND } from "./db.ts";
import { usageSummary, priceTable, MODELS, hasKey } from "./ai.ts";
import { tools } from "./media.ts";
import { STAGES, startJob, analyzeAndScript, writeScript, proposeConcept, runEdit, publishPack, analyzeInspoVideo, projectFromVideo, planTakes } from "./pipeline.ts";
import { generateGuides, iterateGuide, snapshot } from "./brand.ts";
import { fetchProfile, cleanHandle, detectPlatform, detectIgUser } from "./inspo.ts";
import { motionRouter } from "./routes/motion.ts";
import { productionRouter } from "./routes/production.ts";
import { stylesRouter } from "./routes/styles.ts";
import { audioRouter } from "./routes/audio.ts";
import { thumbsRouter, thumbUrl as projectThumbUrl } from "./routes/thumbs.ts";
import { audioEnv, sayVoices } from "./audio/env.ts";
import { motionEnv, killMotion } from "./motion/kit.ts";
import { recoverProductions, stopProduction } from "./agent/runner.ts";
import { sweepPreviewTmp } from "./styles/preview.ts";
import { eventsHandler } from "./events.ts";
import { styleSummaries, getStyle, markUsed } from "./styles/store.ts";
import type {
  AppState, Brand, BrandGen, BrandSource, BrandsResponse, Effort, InspoAccount, InspoCollection, InspoResponse, InspoVideo,
  AudioProvider, Jobbable, Platform, Project, ProjectKind, Provider, PublicSettings, RawFile, Settings, SettingsUpdate, AiStage, ModelPrice,
} from "../shared/types.ts";

const PORT = Number(process.env.PORT || 4747);
// Interfaz React compilada (npm run build → web/dist).
const WEB_DIST = path.join(APP_DIR, "web", "dist");
const WEB_INDEX = path.join(WEB_DIST, "index.html");

// Carpeta de videos crudos: la que cada usuario elija en Ajustes; por defecto ~/Movies/Crudos (se crea si falta).
const DEFAULT_RAW = path.join(os.homedir(), "Movies", "Crudos");
const rawDir = (): string => {
  const s = load().settings.rawDir;
  if (s && fs.existsSync(s)) return path.resolve(s);
  try { fs.mkdirSync(DEFAULT_RAW, { recursive: true }); } catch {}
  return DEFAULT_RAW;
};

/** Valida que v sea uno de los valores permitidos (igualdad estricta, como Array.includes). */
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

const app = express();
// Solo localhost: rechaza peticiones con otro Host (evita que una web externa use tu estudio y tus API keys).
app.use((req, res, next) => {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return res.status(403).send("Solo acceso local");
  next();
});
// Anti-CSRF para /api: las peticiones que cambian estado (POST/PUT/PATCH/DELETE) solo se aceptan desde la propia
// interfaz. Una página de film en Chromium (127.0.0.1:<otro puerto>) u otra web local manda un Origin distinto y se
// rechaza; si la petición trae cuerpo, además debe ser JSON o multipart (un formulario o fetch "simple" con text/plain
// no pasa). Las peticiones sin cuerpo (DELETE, algunos POST) deben traer un Origin permitido.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`,
  "http://localhost:5173", "http://127.0.0.1:5173", // Vite en desarrollo (npm run dev)
]);
const STATE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use("/api", (req, res, next) => {
  if (!STATE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(String(origin))) {
    return res.status(403).json({ error: "Petición rechazada: viene de otro origen (solo se acepta desde la interfaz del estudio)." });
  }
  const site = String(req.headers["sec-fetch-site"] || "");
  if (site === "cross-site" || site === "same-site") {
    return res.status(403).json({ error: "Petición rechazada: viene de otro sitio (solo se acepta desde la interfaz del estudio)." });
  }
  const hasBody = Number(req.headers["content-length"] || 0) > 0 || req.headers["transfer-encoding"] !== undefined;
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (hasBody || type) {
    if (type !== "application/json" && type !== "multipart/form-data") {
      return res.status(415).json({ error: "Tipo de contenido no permitido: usa application/json o multipart/form-data." });
    }
  } else if (origin === undefined) {
    return res.status(403).json({ error: "Petición rechazada: falta el encabezado Origin (solo se acepta desde la interfaz del estudio)." });
  }
  next();
});
app.use(express.json({ limit: "10mb" }));
// actualizaciones en vivo (solo claves de lo que cambió, nunca datos)
app.get("/api/events", eventsHandler);
// Motor de video, producción con agente y biblioteca de estilos
app.use(motionRouter);
app.use(productionRouter);
app.use(stylesRouter);
app.use(audioRouter);
app.use(thumbsRouter);
// La interfaz compilada: los archivos con hash (assets/) no cambian nunca → caché larga; index.html siempre se revalida,
// así una pestaña abierta después de «Actualizar» pide los archivos nuevos.
app.use(express.static(WEB_DIST, {
  setHeaders: (res, file) => {
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));
app.get("/", (_req, res) => {
  if (fs.existsSync(WEB_INDEX)) return res.setHeader("Cache-Control", "no-cache").sendFile(WEB_INDEX);
  res.status(503).type("text/plain; charset=utf-8").send('La interfaz aún no está compilada. Ejecuta "npm run build" en la carpeta del estudio y recarga esta página.');
});
app.use("/media", express.static(PROJECTS_DIR));
app.use("/inspo", express.static(INSPO_DIR));
app.use("/brands", express.static(BRANDS_DIR));

// Datos que los middlewares previos dejan en la petición para decidir dónde guarda multer.
type UploadReq = Request & { uploadDir?: () => string; uploadSub?: string };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const r = req as UploadReq;
      const d = r.uploadDir ? r.uploadDir() : path.join(projectDir(r.params.id), r.uploadSub || "uploads");
      fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename: (_r, f, cb) => cb(null, Date.now() + "-" + f.originalname.replace(/[^\w.\-]+/g, "_")),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});
const sub = (s: string) => (req: Request, _res: Response, next: NextFunction) => { (req as UploadReq).uploadSub = s; next(); };

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response) => Promise.resolve().then(() => fn(req, res)).catch((e: unknown) => res.status(400).json({ error: (e as Error).message }));
const need = (req: Request): Project => { const p = getProject(req.params.id); if (!p) throw new Error("Proyecto no encontrado"); return p; };
const mask = (k: string, pre: string): string => (k ? pre + "…" + k.slice(-4) : "");
const publicSettings = (): PublicSettings => {
  const s = load().settings;
  return {
    ...s,
    apiKey: mask(s.apiKey, "sk-ant"), anthropicAdminKey: mask(s.anthropicAdminKey, "sk-ant-admin"),
    openaiKey: mask(s.openaiKey, "sk"), openaiAdminKey: mask(s.openaiAdminKey, "sk-admin"), apifyToken: mask(s.apifyToken, "apify"), metaToken: mask(s.metaToken, "EAA"), elevenlabsKey: mask(s.elevenlabsKey, "el"), hfToken: mask(s.hfToken, "hf"),
    has: { anthropic: Boolean(s.apiKey || process.env.ANTHROPIC_API_KEY), openai: Boolean(s.openaiKey || process.env.OPENAI_API_KEY), anthropicAdmin: Boolean(s.anthropicAdminKey), openaiAdmin: Boolean(s.openaiAdminKey), apify: Boolean(s.apifyToken), meta: Boolean(s.metaToken), elevenlabs: Boolean(s.elevenlabsKey), hf: Boolean(s.hfToken) },
    catalog: MODELS,
  };
};

// ---------- Estado general ----------
/** Ya existe un video terminado (sin tocar disco): render final del motor, o edición final / publicación en talking. */
const projectHasVideo = (p: Project): boolean =>
  !!p.production?.renders?.some((r) => r.mode === "final") || !!p.edit?.final || p.stage === "publicacion" || p.stage === "publicado" || !!p.published;
// Revisar herramientas lanza procesos (which, ffmpeg -filters…) y bloquea el servidor: con actualizaciones en vivo
// /api/state se pide más seguido, así que el resultado se reutiliza unos segundos (o hasta que cambien los ajustes).
let envCache: { at: number; key: string; v: Pick<AppState, "tools" | "motion" | "audio"> } | null = null;
function envNow(): Pick<AppState, "tools" | "motion" | "audio"> {
  const key = JSON.stringify(load().settings);
  if (!envCache || envCache.key !== key || Date.now() - envCache.at > 5000) envCache = { at: Date.now(), key, v: { tools: tools(), motion: motionEnv(), audio: audioEnv() } };
  return envCache.v;
}
app.get("/api/state", wrap(async (_req, res) => {
  const db = load();
  const env = envNow();
  const out: AppState = {
    stages: STAGES,
    projects: db.projects.map((p) => { const { id, title, stage, createdAt, updatedAt, job, references, goal, brandId, kind, production } = p; return { id, title, kind: kind || "talking", productionStatus: production?.status, stage, createdAt, updatedAt, job, goal, brandId, refs: references.length, thumb: projectThumbUrl(p), hasVideo: projectHasVideo(p) }; }),
    brands: db.brandGuides.map(({ id, name, guide, createdAt }) => ({ id, name, createdAt, palette: guide?.visual?.paleta?.slice(0, 5).map((c) => c.hex) || [] })),
    defaultBrandId: db.settings.defaultBrandId,
    studioName: db.settings.studioName,
    rawDir: rawDir(),
    brandIsPlaceholder: db.brandGuides.length === 1 && !db.brandGuides[0].guide && db.brandGuides[0].raw === DEFAULT_BRAND,
    usage: await usageSummary(),
    tools: env.tools,
    pricing: priceTable(),
    styles: styleSummaries(),
    motion: env.motion,
    audio: env.audio,
  };
  res.json(out);
}));

app.get("/api/usage", wrap(async (req, res) => res.json(await usageSummary({ force: req.query.refresh === "1" }))));

app.get("/api/settings", wrap((_req, res) => res.json(publicSettings())));

type KeyField = "apiKey" | "anthropicAdminKey" | "openaiKey" | "openaiAdminKey" | "apifyToken" | "metaToken" | "elevenlabsKey" | "hfToken";
const KEY_FIELDS: KeyField[] = ["apiKey", "anthropicAdminKey", "openaiKey", "openaiAdminKey", "apifyToken", "metaToken", "elevenlabsKey", "hfToken"];
const AUDIO_PROVIDERS: AudioProvider[] = ["elevenlabs", "local", "sintetizado"];
const LOCAL_TTS: Settings["localTtsEngine"][] = ["kokoro", "chatterbox"];
const PROVIDERS: Provider[] = ["anthropic", "openai"];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

app.put("/api/settings", wrap((req, res) => {
  const s: Settings = load().settings;
  const b = req.body as SettingsUpdate;
  const setKey = (field: KeyField, v: unknown) => { if (typeof v === "string" && v.trim() && !v.includes("…")) s[field] = v.trim(); };
  setKey("apiKey", b.apiKey); setKey("anthropicAdminKey", b.anthropicAdminKey); setKey("openaiKey", b.openaiKey); setKey("openaiAdminKey", b.openaiAdminKey); setKey("apifyToken", b.apifyToken); setKey("metaToken", b.metaToken); setKey("elevenlabsKey", b.elevenlabsKey); setKey("hfToken", b.hfToken);
  for (const k of ["elevenVoiceId", "elevenTtsModel", "producerModel"] as const) { const v: unknown = b[k]; if (typeof v === "string") s[k] = v.trim(); }
  if (typeof b.anthropicWorkspaceId === "string") {
    const ws = b.anthropicWorkspaceId.trim();
    if (ws && !/^wrkspc_[A-Za-z0-9]+$/.test(ws)) throw new Error("El Workspace ID de Anthropic empieza con wrkspc_ (cópialo de console.anthropic.com → Settings → Workspaces).");
    s.anthropicWorkspaceId = ws;
  }
  if (typeof b.metaIgUserId === "string") { s.metaIgUserId = b.metaIgUserId; s.metaIgUsername = b.metaIgUsername || ""; }
  if (typeof b.graphVersion === "string" && /^v\d+\.\d+$/.test(b.graphVersion)) s.graphVersion = b.graphVersion;
  if (b.clear && oneOf(KEY_FIELDS, b.clear)) { s[b.clear] = ""; if (b.clear === "metaToken") { s.metaIgUserId = ""; s.metaIgUsername = ""; } }
  if (oneOf(PROVIDERS, b.provider)) s.provider = b.provider;
  // Audio del motor: proveedor, motor de voz local, voz local (id de Kokoro o ruta de una muestra para Chatterbox) y voz de say.
  if (b.audioProvider !== undefined) {
    if (!oneOf(AUDIO_PROVIDERS, b.audioProvider)) throw new Error("Proveedor de audio no válido: usa elevenlabs, local o sintetizado.");
    s.audioProvider = b.audioProvider;
  }
  if (b.localTtsEngine !== undefined) {
    if (!oneOf(LOCAL_TTS, b.localTtsEngine)) throw new Error("Motor de voz local no válido: usa kokoro o chatterbox.");
    s.localTtsEngine = b.localTtsEngine;
  }
  if (typeof b.localVoice === "string") {
    const v = b.localVoice.trim().replace(/^~(?=$|\/)/, os.homedir());
    if (v && (s.localTtsEngine === "chatterbox" ? !fs.existsSync(v) : !/^[a-z]{2}_[a-z]+$/.test(v))) {
      throw new Error(s.localTtsEngine === "chatterbox" ? `No encuentro la muestra de voz: ${v}` : `Voz de Kokoro no válida: ${v} (ej. em_alex, ef_dora, em_santa).`);
    }
    s.localVoice = v.slice(0, 500);
  }
  if (typeof b.sayVoice === "string" && b.sayVoice.trim()) {
    const v = b.sayVoice.trim();
    const voices = sayVoices();
    if (voices.length && !voices.includes(v)) throw new Error(`La voz "${v}" no está instalada en este Mac. Voces en español: ${voices.join(", ")}.`);
    s.sayVoice = v.slice(0, 80);
  }
  if (b.credits) for (const k of PROVIDERS) if (b.credits[k] !== undefined) s.credits[k] = Math.max(0, Number(b.credits[k]) || 0);
  if (b.hardStop !== undefined) s.hardStop = Boolean(b.hardStop);
  if (b.models) for (const prov of PROVIDERS) for (const [stage, m] of Object.entries(b.models[prov] || {})) if (typeof m === "string" && m.trim()) s.models[prov][stage as AiStage] = m.trim();
  if (b.customPrices && typeof b.customPrices === "object") s.customPrices = b.customPrices as Record<string, Partial<ModelPrice>>;
  if (oneOf(EFFORTS, b.effort)) s.effort = b.effort;
  if (b.styleIterateSections !== undefined) s.styleIterateSections = Boolean(b.styleIterateSections);
  // esfuerzo por sección: se reemplaza entero; vacío = usa el general
  if (b.efforts && typeof b.efforts === "object") {
    const stages = Object.keys(s.models.anthropic);
    s.efforts = Object.fromEntries(Object.entries(b.efforts).filter(([k, v]) => stages.includes(k) && oneOf(EFFORTS, v))) as Settings["efforts"];
  }
  if (typeof b.cookiesBrowser === "string") s.cookiesBrowser = b.cookiesBrowser;
  if (typeof b.studioName === "string" && b.studioName.trim()) s.studioName = b.studioName.trim().slice(0, 40);
  for (const k of ["rawDir", "brollDir"] as const) {
    const raw: unknown = b[k];
    if (typeof raw === "string") {
      const v = raw.trim().replace(/^~(?=$|\/)/, os.homedir());
      if (v && !fs.existsSync(v)) throw new Error(`La carpeta no existe: ${v}`);
      s[k] = v;
    }
  }
  save();
  res.json(publicSettings());
}));

// ---------- Proyectos ----------
app.post("/api/projects", wrap((req, res) => {
  const kind: ProjectKind = oneOf(["talking", "reel", "clase"] as ProjectKind[], req.body.kind) ? req.body.kind : "talking";
  const styleId: string | null = typeof req.body.styleId === "string" && req.body.styleId && getStyle(req.body.styleId) ? req.body.styleId : null;
  const p: Project = { id: id(), title: req.body.title || "Nuevo reel", goal: req.body.goal || "", brandId: req.body.brandId || load().settings.defaultBrandId, kind, styleId, stage: "referencias", references: [], createdAt: new Date().toISOString(), log: [] };
  if (styleId) markUsed(styleId, p.id);
  load().projects.unshift(p);
  log(p, "Proyecto creado");
  save();
  res.json(p);
}));

app.get("/api/projects/:id", wrap((req, res) => res.json(need(req))));

app.patch("/api/projects/:id", wrap((req, res) => {
  const p = need(req);
  for (const k of ["title", "goal", "brandId"] as const) { const v: unknown = req.body[k]; if (typeof v === "string") p[k] = v; }
  if (typeof req.body.styleId === "string") {
    if (req.body.styleId && !getStyle(req.body.styleId)) throw new Error("Estilo no encontrado");
    p.styleId = req.body.styleId || null;
    if (p.styleId) markUsed(p.styleId, p.id);
  }
  if (req.body.stage && oneOf(STAGES, req.body.stage)) { p.stage = req.body.stage; log(p, `Etapa cambiada a ${p.stage} manualmente`); }
  p.updatedAt = new Date().toISOString();
  save();
  res.json(p);
}));

app.delete("/api/projects/:id", wrap(async (req, res) => {
  const db = load();
  const p = db.projects.find((x) => x.id === req.params.id);
  const folder = path.join(PROJECTS_DIR, req.params.id);
  if (p) {
    // Primero se corta la sesión del productor (libera preguntas/aprobaciones pendientes y cierra el CLI del agente)…
    stopProduction(p);
    // …y si hay un trabajo en curso (p. ej. un render), se marca como cancelado.
    if (p.job?.status === "running") p.job = { stage: p.job.stage, status: "error", step: "Cancelado: el proyecto se eliminó.", endedAt: new Date().toISOString() };
  }
  // Corta los procesos del motor que sigan escribiendo en la carpeta (renders, scripts del agente) y espera a que cierren.
  await killMotion(folder);
  db.projects = db.projects.filter((x) => x.id !== req.params.id);
  save();
  fs.rmSync(folder, { recursive: true, force: true });
  res.json({ ok: true });
}));

// 1. Referencias
/** Normaliza un link de referencia: recorta espacios y acepta solo http/https (null si no es válido). */
function cleanRefUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch { return null; }
}

// Acepta { links: [{ url, note }] } (cada link con su nota) o la forma anterior { url | urls, note } (links separados
// por espacios o saltos de línea, todos con la misma nota). Los links repetidos (ya en el proyecto o en la misma
// petición) se ignoran.
app.post("/api/projects/:id/references", wrap((req, res) => {
  const p = need(req);
  const body = (req.body || {}) as { links?: unknown; url?: unknown; urls?: unknown; note?: unknown };
  const items: { url: string; note: string }[] = [];
  if (Array.isArray(body.links)) {
    for (const l of body.links as unknown[]) {
      const o = (l && typeof l === "object" ? l : { url: l }) as { url?: unknown; note?: unknown };
      items.push({ url: String(o.url ?? "").trim(), note: String(o.note ?? "").trim() });
    }
  } else {
    const raw = [body.url, ...(Array.isArray(body.urls) ? body.urls : [body.urls])].filter((x) => x != null).map(String).join(" ");
    const note = String(body.note ?? "").trim();
    for (const url of raw.split(/\s+/).filter(Boolean)) items.push({ url, note });
  }
  const withUrl = items.filter((x) => x.url);
  if (!withUrl.length) throw new Error("Pega al menos un link");
  const bad = withUrl.filter((x) => !cleanRefUrl(x.url));
  if (bad.length) throw new Error(`${bad.length === 1 ? "Este link no es válido" : "Estos links no son válidos"} (usa http o https): ${bad.map((x) => x.url).join(", ")}`);
  const seen = new Set(p.references.map((r) => cleanRefUrl(r.url)).filter((u): u is string => Boolean(u)));
  const added: string[] = [];
  for (const x of withUrl) {
    const url = cleanRefUrl(x.url)!;
    if (seen.has(url)) continue;
    seen.add(url);
    p.references.push({ id: id(), url, note: x.note, addedAt: new Date().toISOString() });
    added.push(url);
  }
  if (!added.length) throw new Error(withUrl.length === 1 ? "Ese link ya está en tus referencias" : "Esos links ya están en tus referencias");
  log(p, `Referencia agregada: ${added.join(", ")}`);
  save();
  res.json(p);
}));

app.post("/api/projects/:id/references/upload", sub("refs-upload"), upload.single("file"), wrap((req, res) => {
  const p = need(req);
  const f = req.file;
  if (!f) throw new Error("No llegó ningún archivo. Vuelve a elegirlo.");
  p.references.push({ id: id(), url: "", file: f.path, name: f.originalname, note: String(req.body?.note ?? "").trim(), addedAt: new Date().toISOString() });
  log(p, `Archivo de referencia subido: ${f.originalname}`);
  save();
  res.json(p);
}));

app.delete("/api/projects/:id/references/:rid", wrap((req, res) => {
  const p = need(req);
  p.references = p.references.filter((r) => r.id !== req.params.rid);
  save();
  res.json(p);
}));

/** Arranca un trabajo encadenado si se puede (hay API key y nada corriendo); si no, no hace nada y el flujo sigue como antes. */
function autoStart(p: Project, stage: string, fn: Parameters<typeof startJob>[2]): boolean {
  if (!hasKey() || p.job?.status === "running") return false;
  try { startJob(p, stage, fn); return true; } catch { return false; }
}

// 2. Análisis + guion (mismo trabajo). Sin referencias pero con objetivo, escribe el guion directo.
app.post("/api/projects/:id/analyze", wrap((req, res) => {
  const p = need(req);
  if (!p.references.length && !p.goal?.trim()) throw new Error("Agrega al menos una referencia o escribe el objetivo del video");
  startJob(p, "analisis", (step) => analyzeAndScript(p, step)); // si falla (ej. sin API key) la etapa no cambia
  p.stage = "analisis";
  res.json(p);
}));

// 3. Guion
app.post("/api/projects/:id/script", wrap((req, res) => {
  const p = need(req);
  if (!p.analysis && !p.goal?.trim()) throw new Error("Primero analiza una referencia o escribe el objetivo del video");
  startJob(p, "guion", (step) => writeScript(p, step, req.body.feedback || ""));
  res.json(p);
}));

app.put("/api/projects/:id/script", wrap((req, res) => {
  const p = need(req);
  // mientras la IA escribe el guion, una edición a mano se perdería al terminar: se rechaza
  if (p.job?.status === "running" && (p.job.stage === "guion" || p.job.stage === "analisis")) {
    return res.status(409).json({ error: "La IA está escribiendo el guion. Espera a que termine para editarlo." });
  }
  p.script = { ...p.script, ...req.body.script };
  p.scriptApproved = false;
  log(p, "Guion editado a mano");
  save();
  res.json(p);
}));

// Aprobaciones (puertas de control)
app.post("/api/projects/:id/approve/:gate", wrap((req, res) => {
  const p = need(req);
  const g = req.params.gate;
  if (g === "script") { if (!p.script) throw new Error("No hay guion"); p.scriptApproved = true; p.stage = "grabacion"; }
  else if (g === "concept") { if (!p.concept) throw new Error("No hay propuesta"); p.conceptApproved = true; p.stage = "edicion"; }
  else if (g === "edit") { if (!p.edit) throw new Error("No hay edición"); p.editApproved = true; p.stage = "publicacion"; }
  else throw new Error("Puerta desconocida");
  log(p, `Aprobado: ${g}`);
  save();
  // Al aprobar la edición se prepara solo el paquete de publicación (si aún no existe).
  if (g === "edit" && !p.publish) autoStart(p, "publicacion", (step) => publishPack(p, step));
  res.json(p);
}));

// 4. Grabación: subir archivo o elegir de la carpeta de crudos configurada
app.get("/api/raw-files", wrap((_req, res) => {
  const out: RawFile[] = [];
  const walk = (d: string, depth = 0): void => {
    if (depth > 2) return;
    let entries: string[] = [];
    try { entries = fs.readdirSync(d); } catch { return; } // carpetas protegidas por macOS (ej. ~/Movies/TV)
    for (const f of entries) {
      if (f.startsWith(".") || /\.(photoslibrary|fcpbundle|imovielibrary|cpproj|tvlibrary)$/i.test(f)) continue;
      const full = path.join(d, f);
      let st: fs.Stats;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (/\.(mov|mp4|m4v)$/i.test(f)) out.push({ path: full, name: path.relative(rawDir(), full), size: st.size, mtime: st.mtime.toISOString() });
    }
  };
  walk(rawDir());
  res.json(out.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime()));
}));

function setRecording(p: Project, file: string, name: string): void {
  p.recording = { file, name, at: new Date().toISOString() };
  p.concept = null; p.conceptApproved = false; p.edit = null; p.editPlan = null;
  try { fs.rmSync(path.join(projectDir(p.id), "recording", "words.json"), { force: true }); } catch {}
  p.stage = "concepto";
  log(p, `Grabación cargada: ${name}`);
  save();
}

app.post("/api/projects/:id/recording", sub("recording"), upload.single("file"), wrap((req, res) => {
  const p = need(req);
  if (req.file) setRecording(p, req.file.path, req.file.originalname);
  else if (req.body.path) {
    const full = path.resolve(req.body.path);
    if (!(full === rawDir() || full.startsWith(rawDir() + path.sep)) || !fs.existsSync(full)) throw new Error("Archivo no válido");
    setRecording(p, full, path.basename(full));
  } else throw new Error("Sube un archivo o elige uno de tu carpeta de crudos");
  // Con guion listo, la propuesta visual arranca sola (si no hay API key o hay otro proceso, se queda como antes).
  if (p.script) autoStart(p, "concepto", (step) => proposeConcept(p, step));
  res.json(p);
}));

// Servir la grabación original para previsualizar
app.get("/api/projects/:id/recording/video", (req, res) => {
  const p = getProject(req.params.id);
  if (!p?.recording?.file || !fs.existsSync(p.recording.file)) return res.status(404).end();
  res.sendFile(p.recording.file);
});
app.get("/api/projects/:id/references/:rid/video", (req, res) => {
  const r = getProject(req.params.id)?.references.find((x) => x.id === req.params.rid);
  if (!r?.file || !fs.existsSync(r.file)) return res.status(404).end();
  res.sendFile(path.resolve(r.file));
});

// 5. Propuesta visual
app.post("/api/projects/:id/concept", wrap((req, res) => {
  const p = need(req);
  if (!p.recording) throw new Error("Primero carga tu grabación");
  startJob(p, "concepto", (step) => proposeConcept(p, step, req.body.feedback || ""));
  res.json(p);
}));

// 6a. Selección de tomas (IA) y ajuste manual
app.post("/api/projects/:id/edit-plan", wrap((req, res) => {
  const p = need(req);
  if (!p.recording) throw new Error("Primero carga tu grabación");
  if (!tools().whisperCpp && !tools().whisperPy) throw new Error("Instala whisper para poder elegir tomas por transcripción");
  startJob(p, "tomas", (step) => planTakes(p, step));
  res.json(p);
}));
app.put("/api/projects/:id/edit-plan", wrap((req, res) => {
  const p = need(req);
  if (!p.editPlan) throw new Error("No hay selección de tomas");
  const keep = new Set<unknown>(req.body.keepIds || []);
  for (const sg of p.editPlan.segments) {
    const k = keep.has(sg.id);
    if (k !== sg.keep) { sg.keep = k; sg.reason = (k ? "mantenida" : "descartada") + " por ti"; }
  }
  save();
  res.json(p);
}));
app.delete("/api/projects/:id/edit-plan", wrap((req, res) => { const p = need(req); p.editPlan = null; save(); res.json(p); }));

// 6. Edición automática
app.post("/api/projects/:id/edit", wrap((req, res) => {
  const p = need(req);
  if (!p.conceptApproved) throw new Error("Aprueba primero la propuesta visual");
  startJob(p, "edicion", (step) => runEdit(p, step));
  res.json(p);
}));

// 7. Publicación
app.post("/api/projects/:id/publish-pack", wrap((req, res) => {
  const p = need(req);
  startJob(p, "publicacion", (step) => publishPack(p, step));
  res.json(p);
}));

app.post("/api/projects/:id/published", wrap((req, res) => {
  const p = need(req);
  p.published = { url: req.body.url || "", at: new Date().toISOString(), trial: true };
  p.stage = "publicado";
  log(p, "Marcado como publicado (Trial Reel)");
  save();
  res.json(p);
}));

// Abrir carpeta en Finder (solo local)
app.post("/api/projects/:id/reveal", wrap(async (req, res) => {
  const p = need(req);
  const { spawn } = await import("node:child_process");
  spawn("open", [path.join(projectDir(p.id), req.body.sub || "")]);
  res.json({ ok: true });
}));

// =================== BRANDING ===================
const brandGen: BrandGen = { job: null, proposals: [], sources: [] }; // generación en curso (aún sin guardar)
const needBrand = (req: Request): Brand => { const b = load().brandGuides.find((x) => x.id === req.params.bid); if (!b) throw new Error("Guía no encontrada"); return b; };

app.get("/api/brands", wrap((_req, res) => { const out: BrandsResponse = { brands: load().brandGuides, defaultBrandId: load().settings.defaultBrandId, gen: brandGen }; res.json(out); }));
app.get("/api/brands/:bid", wrap((req, res) => res.json(needBrand(req))));

// subir archivo fuente (PDF / imagen)
app.post("/api/brand-files", (req: Request, _res: Response, next: NextFunction) => { (req as UploadReq).uploadDir = () => path.join(BRANDS_DIR, "uploads"); next(); }, upload.single("file"), wrap((req, res) => {
  const f = req.file;
  if (!f) throw new Error("No llegó ningún archivo. Vuelve a elegirlo.");
  const isPdf = /\.pdf$/i.test(f.originalname);
  res.json({ type: isPdf ? "pdf" : "image", file: f.path, name: f.originalname });
}));

type RawSource = { type?: unknown; value?: unknown; file?: unknown } | null | undefined;

app.post("/api/brands/generate", wrap((req, res) => {
  const sources = ((req.body.sources || []) as RawSource[]).filter((x) => x && x.type && (x.value || x.file)) as BrandSource[];
  if (!sources.length) throw new Error("Agrega al menos una fuente (web, PDF, Instagram, imagen o texto)");
  const count = Math.min(3, Math.max(1, Number(req.body.count) || 1));
  brandGen.proposals = [];
  brandGen.sources = sources;
  startJob(brandGen, "branding", async (step) => { brandGen.proposals = await generateGuides({ sources, count, instructions: req.body.instructions || "" }, step); });
  res.json(brandGen);
}));

app.post("/api/brands", wrap((req, res) => {
  const db = load();
  const g = req.body.guide || null;
  const b: Brand = { id: id(), name: req.body.name || g?.nombre || "Nueva guía", guide: g, raw: req.body.raw || "", sources: req.body.sources || brandGen.sources || [], versions: [], createdAt: new Date().toISOString() };
  db.brandGuides.unshift(b);
  if (req.body.fromProposal !== undefined) brandGen.proposals.splice(req.body.fromProposal, 1);
  if (!db.settings.defaultBrandId) db.settings.defaultBrandId = b.id;
  save();
  res.json(b);
}));

app.put("/api/brands/:bid", wrap((req, res) => {
  const b = needBrand(req);
  snapshot(b, "Edición manual");
  if (typeof req.body.name === "string") b.name = req.body.name;
  if (req.body.guide) b.guide = req.body.guide;
  if (typeof req.body.raw === "string") b.raw = req.body.raw;
  b.updatedAt = new Date().toISOString();
  save();
  res.json(b);
}));

app.post("/api/brands/:bid/iterate", wrap((req, res) => {
  const b = needBrand(req);
  if (!req.body.feedback) throw new Error("Escribe qué quieres cambiar");
  const feedback: string = req.body.feedback;
  startJob(b, "branding", async (step) => { const g = await iterateGuide(b, feedback, step); snapshot(b, "Antes de: " + feedback.slice(0, 80)); b.guide = g; b.updatedAt = new Date().toISOString(); });
  res.json(b);
}));

app.post("/api/brands/:bid/restore/:i", wrap((req, res) => {
  const b = needBrand(req);
  const v = b.versions?.[Number(req.params.i)];
  if (!v) throw new Error("Versión no encontrada");
  snapshot(b, "Antes de restaurar");
  b.guide = v.guide; b.raw = v.raw;
  save();
  res.json(b);
}));

app.post("/api/brands/:bid/duplicate", wrap((req, res) => {
  const b = needBrand(req);
  const c: Brand = { ...structuredClone(b), id: id(), name: b.name + " (copia)", versions: [], job: null, createdAt: new Date().toISOString() };
  load().brandGuides.unshift(c);
  save();
  res.json(c);
}));

app.post("/api/brands/:bid/default", wrap((req, res) => { const b = needBrand(req); load().settings.defaultBrandId = b.id; save(); res.json({ ok: true }); }));

app.delete("/api/brands/:bid", wrap((req, res) => {
  const db = load();
  if (db.brandGuides.length <= 1) throw new Error("Debe quedar al menos una guía");
  db.brandGuides = db.brandGuides.filter((b) => b.id !== req.params.bid);
  if (db.settings.defaultBrandId === req.params.bid) db.settings.defaultBrandId = db.brandGuides[0].id;
  save();
  res.json({ ok: true });
}));

// =================== INSPIRACIÓN ===================
app.post("/api/meta/detect", wrap(async (_req, res) => {
  if (!load().settings.metaToken) throw new Error("Primero pega tu token de Meta y guarda");
  const found = await detectIgUser();
  const s = load().settings;
  if (found.length === 1) { s.metaIgUserId = found[0].id; s.metaIgUsername = found[0].username; save(); }
  res.json({ found, selected: s.metaIgUserId });
}));

const inspoJob: Jobbable = { job: null };
const thumbUrl = (f?: string | null): string | null => (f ? "/inspo/" + path.relative(INSPO_DIR, f) : null);
const needVideo = (req: Request): InspoVideo => { const v = load().videos.find((x) => x.id === req.params.vid); if (!v) throw new Error("Video no encontrado"); return v; };

/** Lo que devuelve fetchProfile (y usa upsertAccount). */
interface ProfileData {
  platform: Platform;
  username: string;
  fullName?: string;
  biography?: string;
  followers?: number;
  avatarFile?: string | null;
  medianViews?: number;
  metric?: "views" | "engagement";
  videos: InspoVideo[];
}

function upsertAccount(data: ProfileData): InspoAccount {
  const db = load();
  let a = db.accounts.find((x) => x.platform === data.platform && x.username === data.username);
  if (!a) { a = { id: id(), platform: data.platform, username: data.username, addedAt: new Date().toISOString() }; db.accounts.push(a); }
  Object.assign(a, { fullName: data.fullName, biography: data.biography, followers: data.followers, avatar: thumbUrl(data.avatarFile) || a.avatar, medianViews: data.medianViews, metric: data.metric, lastFetched: new Date().toISOString(), videoCount: data.videos.length });
  for (const v of data.videos) {
    const old = db.videos.find((x) => x.id === v.id);
    const fresh: InspoVideo = { ...v, accountId: a.id, thumb: thumbUrl(v.thumbFile), fetchedAt: new Date().toISOString() };
    if (old) Object.assign(old, { ...fresh, analysis: old.analysis, transcript: old.transcript, frameUrls: old.frameUrls, file: old.file });
    else db.videos.push(fresh);
  }
  return a;
}

app.get("/api/inspo", wrap((_req, res) => {
  const db = load();
  const out: InspoResponse = { accounts: db.accounts, videos: db.videos.map(({ analysis, transcript: _t, ...v }) => ({ ...v, analyzed: Boolean(analysis) })), collections: db.collections, job: inspoJob.job ?? null, hasApify: Boolean(db.settings.apifyToken), hasMeta: Boolean(db.settings.metaToken && db.settings.metaIgUserId) };
  res.json(out);
}));

app.get("/api/inspo/videos/:vid", wrap((req, res) => res.json(needVideo(req))));

app.post("/api/inspo/accounts", wrap((req, res) => {
  const handles = String(req.body.handles || "").split(/[\s,]+/).filter(Boolean);
  if (!handles.length) throw new Error("Escribe al menos una cuenta (@usuario o link)");
  const limit = Math.min(100, Math.max(5, Number(req.body.limit) || 30));
  const forced: Platform | undefined = req.body.platform || undefined;
  startJob(inspoJob, "inspiracion-cuentas", async (step) => {
    for (const [i, h] of handles.entries()) {
      const platform = forced || detectPlatform(h);
      step(`Cargando @${cleanHandle(h)} (${i + 1}/${handles.length})…`);
      upsertAccount(await fetchProfile(h, { platform, limit }));
      save();
    }
  });
  res.json({ job: inspoJob.job });
}));

app.post("/api/inspo/accounts/:aid/refresh", wrap((req, res) => {
  const a = load().accounts.find((x) => x.id === req.params.aid);
  if (!a) throw new Error("Cuenta no encontrada");
  const limit = Number(req.body.limit) || 30;
  startJob(inspoJob, "inspiracion-cuentas", async (step) => { step(`Actualizando @${a.username}…`); upsertAccount(await fetchProfile(a.username, { platform: a.platform, limit })); });
  res.json({ job: inspoJob.job });
}));

app.post("/api/inspo/refresh-all", wrap((_req, res) => {
  const accs = [...load().accounts];
  startJob(inspoJob, "inspiracion-cuentas", async (step) => {
    for (const [i, a] of accs.entries()) { step(`Actualizando @${a.username} (${i + 1}/${accs.length})…`); try { upsertAccount(await fetchProfile(a.username, { platform: a.platform, limit: 30 })); save(); } catch (e) { step(`@${a.username}: ${(e as Error).message.slice(0, 100)}`); } }
  });
  res.json({ job: inspoJob.job });
}));

app.delete("/api/inspo/accounts/:aid", wrap((req, res) => {
  const db = load();
  db.accounts = db.accounts.filter((a) => a.id !== req.params.aid);
  db.videos = db.videos.filter((v) => v.accountId !== req.params.aid || db.collections.some((c) => c.videoIds.includes(v.id)));
  save();
  res.json({ ok: true });
}));

app.post("/api/inspo/videos/:vid/analyze", wrap((req, res) => {
  const v = needVideo(req);
  startJob(v, "inspiracion", (step) => analyzeInspoVideo(v, step));
  res.json({ job: v.job });
}));

app.post("/api/inspo/videos/:vid/project", wrap((req, res) => {
  const v = needVideo(req);
  const p = projectFromVideo(v, { brandId: req.body.brandId });
  load().projects.unshift(p);
  save();
  res.json(p);
}));

app.post("/api/inspo/collections", wrap((req, res) => {
  const c: InspoCollection = { id: id(), name: req.body.name || "Nueva colección", videoIds: [], createdAt: new Date().toISOString() };
  load().collections.push(c);
  save();
  res.json(c);
}));
app.post("/api/inspo/collections/:cid/toggle", wrap((req, res) => {
  const c = load().collections.find((x) => x.id === req.params.cid);
  if (!c) throw new Error("Colección no encontrada");
  const i = c.videoIds.indexOf(req.body.videoId);
  if (i >= 0) c.videoIds.splice(i, 1); else c.videoIds.push(req.body.videoId);
  save();
  res.json(c);
}));
app.delete("/api/inspo/collections/:cid", wrap((req, res) => { const db = load(); db.collections = db.collections.filter((c) => c.id !== req.params.cid); save(); res.json({ ok: true }); }));

// Sesiones de producción que quedaron corriendo: se marcan reanudables
recoverProductions();
sweepPreviewTmp(); // restos de vistas previas interrumpidas
// Recuperar trabajos que quedaron "corriendo" si el servidor se reinició
for (const p of [...load().projects, ...load().brandGuides, ...load().videos] as Jobbable[]) if (p.job?.status === "running") p.job = { ...p.job, status: "error", step: "Interrumpido al reiniciar el servidor. Reintenta." };
save();

app.listen(PORT, "127.0.0.1", () => console.log(`\n  ${load().settings.studioName} → http://localhost:${PORT}\n`));
