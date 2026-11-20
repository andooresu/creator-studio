// Andoo CreatorStudio — servidor local. Abre http://localhost:4747
import express from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { load, save, id, getProject, projectDir, log, APP_DIR, PROJECTS_DIR, BRANDS_DIR, INSPO_DIR, DEFAULT_BRAND } from "./db.ts";
import { usageSummary, priceTable, MODELS, hasKey, reserveOpenAICredit, imageUnitUsd } from "./ai.ts";
import { generateImage, composeImagePrompt, ImageGenError } from "./images.ts";
import { tools } from "./media.ts";
import { datosProblem } from "../shared/apoyoLimits.ts";
import { STAGES, startJob, analyzeAndScript, writeScript, proposeConcept, runEdit, publishPack, analyzeInspoVideo, projectFromVideo, planTakes, proposeApoyos, retime, readWords, DATO_MAX, DATOS_MAX } from "./pipeline.ts";
import { generateGuides, iterateGuide, snapshot } from "./brand.ts";
import { fetchProfile, cleanHandle, detectPlatform, detectIgUser } from "./inspo.ts";
import { motionRouter } from "./routes/motion.ts";
import { productionRouter } from "./routes/production.ts";
import { stylesRouter } from "./routes/styles.ts";
import { audioRouter } from "./routes/audio.ts";
import { thumbsRouter, thumbUrl as projectThumbUrl } from "./routes/thumbs.ts";
import { audioEnv, sayVoices } from "./audio/env.ts";
import { motionEnv, killMotion } from "./motion/kit.ts";
import { recoverProductions, stopProduction, startProduction, productionPreflight, currentRenders, resetProductionForNewRecording, approveFinalFromEdit, capReached } from "./agent/runner.ts";
import { parseStartFlags } from "./agent/prompt.ts";
import { sweepPreviewTmp } from "./styles/preview.ts";
import { eventsHandler } from "./events.ts";
import { styleSummaries, getStyle, markUsed, listStyles } from "./styles/store.ts";
import type {
  Apoyo, AppState, Brand, BrandGen, BrandSource, BrandsResponse, Effort, InspoAccount, InspoCollection, InspoResponse, InspoVideo,
  AudioProvider, Jobbable, Platform, Project, ProjectKind, Provider, PublicSettings, RawFile, Settings, SettingsUpdate, AiStage, ModelPrice,
  EditRun, EditRunRequest, FinalVideo, Reference, Style,
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

const uploadStorage = multer.diskStorage({
  destination: (req, _f, cb) => {
    const r = req as UploadReq;
    const d = r.uploadDir ? r.uploadDir() : path.join(projectDir(r.params.id), r.uploadSub || "uploads");
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (_r, f, cb) => cb(null, Date.now() + "-" + f.originalname.replace(/[^\w.\-]+/g, "_")),
});
const upload = multer({ storage: uploadStorage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
// archivos de apoyos visuales (imagen o clip): tope propio de 200 MB
const APOYO_MAX_MB = 200;
const apoyoUpload = multer({ storage: uploadStorage, limits: { fileSize: APOYO_MAX_MB * 1024 * 1024 } });
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
  !!p.finalVideo || !!p.production?.renders?.some((r) => r.mode === "final") || !!p.edit?.final || p.stage === "publicacion" || p.stage === "publicado" || !!p.published;
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
  if (db.projects.map(syncEditRun).some(Boolean)) save();
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
const IMAGE_PROVIDERS: Settings["imageProvider"][] = ["openai"];
const IMAGE_QUALITIES: Settings["imageQuality"][] = ["low", "medium", "high"];

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
  // imágenes de apoyo: proveedor (solo OpenAI por ahora), modelo y calidad
  if (b.imageProvider !== undefined) {
    if (!oneOf(IMAGE_PROVIDERS, b.imageProvider)) throw new Error("Proveedor de imágenes no válido: por ahora solo openai.");
    s.imageProvider = b.imageProvider;
  }
  if (b.imageModel !== undefined) {
    const m = typeof b.imageModel === "string" ? b.imageModel.trim() : "";
    if (!m || m.length > 80 || !/^[\w.\-]+$/.test(m)) throw new Error("Modelo de imagen no válido (ej. gpt-image-2).");
    s.imageModel = m;
  }
  if (b.imageQuality !== undefined) {
    if (!oneOf(IMAGE_QUALITIES, b.imageQuality)) throw new Error("Calidad de imagen no válida: usa low, medium o high.");
    s.imageQuality = b.imageQuality;
  }
  if (b.credits) for (const k of PROVIDERS) if (b.credits[k] !== undefined) s.credits[k] = Math.max(0, Number(b.credits[k]) || 0);
  if (b.hardStop !== undefined) s.hardStop = Boolean(b.hardStop);
  // tope de costo por video del productor (US$; 0 = sin tope)
  if (b.maxCostPerVideo !== undefined) {
    const v = Number(b.maxCostPerVideo);
    if (!Number.isFinite(v) || v < 0 || v > 1000) throw new Error("El tope de costo por video debe ser un número entre 0 y 1000 (0 = sin tope).");
    s.maxCostPerVideo = Math.round(v * 100) / 100;
  }
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
/** Primera plantilla para videos a cámara: la primera de tipo "talking", si no la primera "any" (null si no hay). */
function defaultTalkingStyleId(): string | null {
  const all = listStyles();
  return (all.find((s) => s.kind === "talking") || all.find((s) => s.kind === "any"))?.id ?? null;
}
/** Plantilla válida para un video a cámara (tipo talking o any). */
const isTalkingStyle = (s: Style | undefined): s is Style => !!s && (s.kind === "talking" || s.kind === "any");

// Crea el proyecto en una sola petición (diálogo de una pantalla y «Desde un link» de Inicio): con sus links de referencia
// (validados ANTES de crear nada: un link inválido no deja un proyecto huérfano) y, si se pide (autoScript) y hay clave de
// IA, arranca de una vez «Analizar y escribir guion». Sin clave se crea igual, sin trabajo (la interfaz ofrece el botón).
app.post("/api/projects", wrap((req, res) => {
  const body = (req.body || {}) as { kind?: unknown; styleId?: unknown; title?: unknown; goal?: unknown; brandId?: unknown; references?: unknown; autoScript?: unknown };
  const kind: ProjectKind = oneOf(["talking", "reel", "clase"] as ProjectKind[], body.kind) ? body.kind : "talking";
  let styleId: string | null = typeof body.styleId === "string" && body.styleId && getStyle(body.styleId) ? body.styleId : null;
  // «Sin plantilla» explícito del diálogo llega como "" y se respeta; ausente, null o desconocido → plantilla por defecto
  if (kind === "talking" && !styleId && body.styleId !== "") styleId = defaultTalkingStyleId();
  let references: Reference[] = [];
  if (body.references !== undefined && body.references !== null) {
    if (!Array.isArray(body.references)) throw new Error("Los links de referencia deben venir como una lista.");
    references = cleanRefLinks(linkItems(body.references), []).map((x) => ({ id: id(), url: x.url, note: x.note, addedAt: new Date().toISOString() }));
  }
  const goal = typeof body.goal === "string" ? body.goal : "";
  const p: Project = {
    id: id(), title: (typeof body.title === "string" && body.title.trim()) || "Nuevo reel", goal,
    brandId: (typeof body.brandId === "string" && body.brandId) || load().settings.defaultBrandId,
    kind, styleId, stage: "idea", references, createdAt: new Date().toISOString(), log: [],
  };
  if (styleId) markUsed(styleId, p.id);
  load().projects.unshift(p);
  log(p, "Proyecto creado");
  if (references.length) log(p, `Referencia agregada: ${references.map((r) => r.url).join(", ")}`);
  save();
  // mismo arranque que POST /analyze; sin clave de IA (o si algo impide arrancar) el proyecto queda creado sin trabajo
  if (body.autoScript === true && (references.length || goal.trim()) && hasKey()) {
    try { startJob(p, "analisis", (step) => analyzeAndScript(p, step)); }
    catch (e) { log(p, "No se pudo arrancar el guion: " + (e as Error).message); save(); }
  }
  res.json(p);
}));

app.get("/api/projects/:id", wrap((req, res) => { const p = need(req); if (syncEditRun(p)) save(); res.json(p); }));

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

/** Lista de links [{ url, note }] (o strings sueltos) a items recortados. */
function linkItems(list: unknown[]): { url: string; note: string }[] {
  return list.map((l) => {
    const o = (l && typeof l === "object" ? l : { url: l }) as { url?: unknown; note?: unknown };
    return { url: String(o.url ?? "").trim(), note: String(o.note ?? "").trim() };
  });
}

/** Valida y limpia links de referencia: solo http/https (lanza con la lista de los inválidos) y sin repetidos (ni entre sí
 *  ni con los que ya tiene el proyecto). Los items sin url se ignoran. Devuelve los nuevos, ya normalizados. */
function cleanRefLinks(items: { url: string; note: string }[], existing: Reference[]): { url: string; note: string }[] {
  const withUrl = items.filter((x) => x.url);
  const bad = withUrl.filter((x) => !cleanRefUrl(x.url));
  if (bad.length) throw new Error(`${bad.length === 1 ? "Este link no es válido" : "Estos links no son válidos"} (usa http o https): ${bad.map((x) => x.url).join(", ")}`);
  const seen = new Set(existing.map((r) => cleanRefUrl(r.url)).filter((u): u is string => Boolean(u)));
  const out: { url: string; note: string }[] = [];
  for (const x of withUrl) {
    const url = cleanRefUrl(x.url)!;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, note: x.note });
  }
  return out;
}

// Acepta { links: [{ url, note }] } (cada link con su nota) o la forma anterior { url | urls, note } (links separados
// por espacios o saltos de línea, todos con la misma nota). Los links repetidos (ya en el proyecto o en la misma
// petición) se ignoran.
app.post("/api/projects/:id/references", wrap((req, res) => {
  const p = need(req);
  const body = (req.body || {}) as { links?: unknown; url?: unknown; urls?: unknown; note?: unknown };
  const items: { url: string; note: string }[] = [];
  if (Array.isArray(body.links)) items.push(...linkItems(body.links as unknown[]));
  else {
    const raw = [body.url, ...(Array.isArray(body.urls) ? body.urls : [body.urls])].filter((x) => x != null).map(String).join(" ");
    const note = String(body.note ?? "").trim();
    for (const url of raw.split(/\s+/).filter(Boolean)) items.push({ url, note });
  }
  const withUrl = items.filter((x) => x.url);
  if (!withUrl.length) throw new Error("Pega al menos un link");
  const fresh = cleanRefLinks(withUrl, p.references);
  const added: string[] = [];
  for (const x of fresh) {
    p.references.push({ id: id(), url: x.url, note: x.note, addedAt: new Date().toISOString() });
    added.push(x.url);
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
  p.stage = "idea";
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

// ---------- Camino de edición por defecto (entrega 3): tomas → corte → plantilla ----------
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Valida el pedido de edición (plantilla, tope y opciones) y deja listo el EditRun; lanza en español si algo falta. */
function parseEditRun(p: Project, raw: unknown): { quick: boolean; styleId: string | null; flags: EditRun["flags"]; capUsd?: number } {
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as EditRunRequest & Record<string, unknown>;
  const quick = b.quick === true;
  let styleId: string | null;
  if (b.styleId === null || b.styleId === "") styleId = null;
  else if (b.styleId !== undefined) {
    if (typeof b.styleId !== "string" || !isTalkingStyle(getStyle(b.styleId))) throw new Error("Esa plantilla no existe o no es para videos a cámara.");
    styleId = b.styleId;
  } else styleId = p.styleId && isTalkingStyle(getStyle(p.styleId)) ? p.styleId : defaultTalkingStyleId();
  let capUsd: number | undefined;
  const capRaw: unknown = b.capUsd;
  if (capRaw !== undefined && capRaw !== null) {
    // mismo rango que el productor (runner parseCap): se rechaza aquí, antes de gastar en la selección de tomas
    if (typeof capRaw !== "number" || !Number.isFinite(capRaw) || capRaw < 0 || capRaw > 10_000) throw new Error("El tope de costo debe ser un número en US$ entre 0 y 10.000 (0 = el de Ajustes).");
    capUsd = Math.round(capRaw * 100) / 100;
  }
  const flags = parseStartFlags(b.flags);
  return { quick, styleId, flags, ...(capUsd !== undefined ? { capUsd } : {}) };
}

const hasWhisper = (): boolean => { const t = tools(); return Boolean(t.whisperCpp || t.whisperPy); };

/** Arranca el camino por defecto: un solo trabajo "edicion" (tomas con IA si se puede + corte con ffmpeg) y, al terminar
 *  bien y sin quick, el productor con la plantilla (fuera del trabajo, cuando ya quedó "done"). Lanza antes de tocar nada
 *  si falta algo (grabación, propuesta aprobada, plantilla, tope, clave o entorno del motor, otro proceso corriendo). */
function startEditRun(p: Project, raw: unknown): void {
  if (!p.recording) throw new Error("Primero carga tu grabación.");
  if (!p.conceptApproved) throw new Error("Aprueba la propuesta visual antes de editar.");
  const req = parseEditRun(p, raw);
  if (p.job?.status === "running") throw new Error("Ya hay un proceso corriendo en este proyecto.");
  if (!req.quick) {
    productionPreflight(); // clave de Anthropic y entorno de Python del motor: mismos errores que startProduction
    if (producerWorking(p)) throw new Error("La producción de este proyecto ya está en marcha.");
    // el tope se revisa antes de la selección de tomas (paga): si no, se gastaría en ella y el productor no arrancaría
    const capErr = capReached(p, req.capUsd);
    if (capErr) throw new Error(capErr);
  }
  const startedAt = new Date().toISOString();
  const run: EditRun = { quick: req.quick, styleId: req.styleId, ...(req.flags ? { flags: req.flags } : {}), ...(req.capUsd !== undefined ? { capUsd: req.capUsd } : {}), state: "corte", startedAt };
  const prevStyle = p.styleId ?? null;
  p.styleId = req.styleId;
  if (req.styleId) markUsed(req.styleId, p.id);
  p.finalVideo = null;
  p.editApproved = false;
  if (p.stage === "publicacion" || p.stage === "publicado") p.stage = "edicion"; // el video aprobado dejó de valer
  p.editRun = run;
  p.updatedAt = startedAt;
  const pid = p.id;
  try {
    startJob(p, "edicion", async (step) => {
      try {
        // sin clave de IA (o sin whisper) no se eligen tomas: solo corte de silencios (gratis)
        if (hasWhisper() && hasKey() && !p.editPlan) {
          try { await planTakes(p, step); }
          catch (e) { step(`No pude elegir las tomas (${errText(e).slice(0, 160)}). Sigo con el corte de silencios.`); }
        }
        await runEdit(p, step);
      } catch (e) {
        if (p.editRun?.startedAt === startedAt) { p.editRun.state = "error"; p.editRun.error = errText(e); }
        throw e;
      }
      // el productor arranca cuando el trabajo ya quedó "done" (startJob lo marca justo después de esta promesa)
      setImmediate(() => afterEditJob(pid, startedAt));
    });
  } catch (e) {
    // no arrancó: se deshace el pedido
    p.editRun = null;
    p.styleId = prevStyle;
    save();
    throw e;
  }
  log(p, run.quick ? "Edición: corte rápido" : `Edición con plantilla${run.styleId ? ` «${getStyle(run.styleId)?.name || run.styleId}»` : ""}`);
  save();
}

/** Continuación del trabajo de corte: quick → listo; si no, lanza el productor con la plantilla. */
function afterEditJob(pid: string, startedAt: string): void {
  const p = getProject(pid);
  const run = p?.editRun;
  if (!p || !run || run.startedAt !== startedAt || run.state !== "corte" || p.job?.status !== "done") return;
  if (run.quick) { run.state = "listo"; save(); return; }
  run.state = "plantilla";
  try {
    const restyle = Boolean(p.production) && ((p.production as { styleId?: string | null } | null | undefined)?.styleId ?? null) !== (run.styleId ?? null);
    // una sesión anterior ya conoce otro corte: se le avisa que hay uno nuevo y que el render final debe rehacerse
    const notice = p.production?.sessionId
      ? `Hay un corte nuevo de la edición automática (${p.edit?.cut || p.edit?.final || "edit/cut.mp4"}, ${p.edit?.at || startedAt}): vuelve a importar la secuencia sobre ese corte limpio, re-temporiza los subtítulos y entrega un render final nuevo. Nunca importes edit/final.mp4: ya trae subtítulos e imágenes de apoyo quemados. Los renders anteriores ya no sirven.`
      : undefined;
    startProduction(p, { mode: "talking", flags: run.flags, capUsd: run.capUsd, restyle, notice });
    log(p, "Edición: corte listo; el productor está aplicando la plantilla");
  } catch (e) {
    run.state = "error";
    run.error = errText(e);
    log(p, "ERROR al lanzar la plantilla (el corte rápido sigue disponible): " + run.error);
  }
  save();
}

/** Mientras el productor aplica la plantilla: cuando termina con un render final, el EditRun pasa a "listo".
 *  Devuelve true si cambió algo (quien llama guarda). Se revisa al leer el proyecto y con un temporizador. */
function syncEditRun(p: Project): boolean {
  const run = p.editRun;
  if (!run || run.state !== "plantilla") return false;
  const prod = p.production;
  // solo cuenta un render final de esta corrida (no uno de un corte o una grabación anteriores)
  if (prod?.status !== "done" || !currentRenders(p).some((r) => r.mode === "final")) return false;
  run.state = "listo";
  return true;
}
setInterval(() => { if (load().projects.map(syncEditRun).some(Boolean)) save(); }, 3000).unref();

/** Ruta (relativa a la carpeta del proyecto) del render final elegido para aprobar: 9x16 primero, si no el primero.
 *  Solo renders de la corrida actual (currentRenders): nunca uno de un corte o una grabación anteriores. */
function finalRenderVideo(p: Project): FinalVideo | null {
  const prod = p.production;
  if (!prod) return null;
  const dir = projectDir(p.id);
  const ok = (r: { path: string }): string | null => {
    const abs = path.resolve(prod.dir || path.join(dir, "motion"), r.path);
    const rel = path.relative(dir, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(abs)) return null;
    return rel.split(path.sep).join("/");
  };
  const finals = currentRenders(p).filter((r) => r.mode === "final");
  // el más reciente de cada formato
  const pick = [...finals].reverse().find((r) => r.fmt === "9x16" && ok(r)) || [...finals].reverse().find((r) => ok(r));
  return pick ? { path: ok(pick)!, source: "plantilla", fmt: pick.fmt, at: new Date().toISOString() } : null;
}

/** El productor trabaja o espera al usuario. Un aviso de tope solo (sin nada corriendo) no cuenta: nada va a cambiar. */
function producerWorking(p: Project): boolean {
  const prod = p.production;
  return prod?.status === "running" || (prod?.status === "waiting" && prod.pending?.type !== "budget");
}

/** Copia el render aprobado a una ruta fija (edit/aprobado-<fmt>-<fecha>.mp4): el productor reescribe sus renders en la
 *  misma ruta, y el video aprobado (Publicación, miniaturas) no debe cambiar sin una aprobación nueva. Borra la copia
 *  aprobada anterior. Si la copia falla, se usa el render tal cual. */
function freezeApproved(p: Project, fv: FinalVideo): FinalVideo {
  const dir = projectDir(p.id);
  try {
    const rel = `edit/aprobado-${fv.fmt}-${Date.now()}.mp4`;
    fs.mkdirSync(path.join(dir, "edit"), { recursive: true });
    fs.copyFileSync(path.join(dir, fv.path), path.join(dir, rel));
    for (const f of fs.readdirSync(path.join(dir, "edit"))) {
      if (/^aprobado-.+\.mp4$/.test(f) && `edit/${f}` !== rel) fs.rmSync(path.join(dir, "edit", f), { force: true });
    }
    return { ...fv, path: rel };
  } catch (e) {
    console.warn(`[proyecto ${p.id}] no se pudo copiar el video aprobado: ${errText(e)}`);
    return fv;
  }
}

/** El corte rápido (ffmpeg) para aprobar: edición final, si no el corte. */
function quickVideo(p: Project): FinalVideo | null {
  const rel = p.edit?.final || p.edit?.cut;
  if (!rel || !fs.existsSync(path.join(projectDir(p.id), rel))) return null;
  return { path: rel.split(path.sep).join("/"), source: "rapido", fmt: "9x16", at: new Date().toISOString() };
}

// Aprobaciones (puertas de control)
app.post("/api/projects/:id/approve/:gate", wrap((req, res) => {
  const p = need(req);
  const g = req.params.gate;
  const body = (req.body || {}) as { edit?: unknown; source?: unknown };
  const wasConceptApproved = Boolean(p.conceptApproved);
  if (g === "script") { if (!p.script) throw new Error("No hay guion"); p.scriptApproved = true; p.stage = "grabacion"; }
  else if (g === "concept") { if (!p.concept) throw new Error("No hay propuesta"); p.conceptApproved = true; p.stage = "edicion"; }
  else if (g === "edit") {
    if (body.source !== undefined && body.source !== "plantilla" && body.source !== "rapido") throw new Error('Fuente inválida: usa "plantilla" o "rapido".');
    if ((p.kind ?? "talking") === "talking" && !p.conceptApproved) throw new Error("Aprueba la propuesta visual antes de aprobar el video.");
    if (p.job?.status === "running" && (p.job.stage === "edicion" || p.job.stage === "tomas")) throw new Error("Espera a que termine el corte.");
    const prod = p.production;
    const prodBusy = producerWorking(p);
    const plantilla = finalRenderVideo(p);
    const source = body.source ?? (plantilla && !p.editRun?.quick ? "plantilla" : "rapido");
    let fv = source === "plantilla" ? plantilla : quickVideo(p);
    if (!fv) throw new Error("Todavía no hay un video para aprobar.");
    if (source === "plantilla" && prodBusy) {
      // si el productor espera justo la aprobación del video final, «Aprobar video» cuenta como esa aprobación; si sigue
      // trabajando, el archivo todavía puede cambiar (el render se reescribe en la misma ruta)
      if (!approveFinalFromEdit(p)) throw new Error("El productor sigue trabajando con la plantilla: espera a que termine (o detenlo) para aprobar ese video.");
    } else if (source === "rapido" && prodBusy) {
      // aprobar el corte rápido deja sin uso la plantilla en curso: se detiene para que no siga gastando
      stopProduction(p);
      log(p, "Productor detenido: aprobaste el corte rápido");
    } else if (prod?.pending?.type === "budget") {
      // solo quedaba un aviso de tope (nada corriendo): aprobar un video ya hecho no gasta; el aviso se cierra
      stopProduction(p);
    }
    // la corrida queda como corte rápido (es lo que se aprobó y lo que se muestra), aunque antes hubiera una plantilla
    if (source === "rapido" && p.editRun && !p.editRun.quick) p.editRun = { ...p.editRun, quick: true, state: "listo" };
    // el render aprobado se congela en una copia: un ajuste posterior del productor no lo reescribe
    if (fv.source === "plantilla") fv = freezeApproved(p, fv);
    p.finalVideo = fv;
    p.editApproved = true; p.stage = "publicacion";
  }
  else throw new Error("Puerta desconocida");
  log(p, `Aprobado: ${g}`);
  save();
  // Al aprobar la propuesta con un pedido de edición, arranca el camino por defecto. Si no puede (p. ej. hay otro
  // proceso corriendo o falta la clave), la aprobación vale igual y el error queda en editRun. Un pedido repetido
  // (doble clic, otra pestaña) con la propuesta ya aprobada y una edición en curso o hecha no arranca otra.
  const runActive = (): boolean => {
    const st = p.editRun?.state;
    const ps = p.production?.status;
    return p.job?.status === "running" || st === "corte" || (st === "plantilla" && (ps === "running" || ps === "waiting"));
  };
  const repeated = wasConceptApproved && Boolean(p.editRun) && p.editRun?.state !== "error";
  if (g === "concept" && body.edit !== undefined && body.edit !== null && !repeated) {
    try { startEditRun(p, body.edit); }
    catch (e) {
      if (runActive() && p.editRun && p.editRun.state !== "error") {
        // hay una edición en marcha: no se pisa (el pedido repetido solo se registra)
        log(p, "Pedido de edición ignorado: ya hay una en curso");
      } else {
        // se guarda lo que el usuario pidió (corte rápido o plantilla) para que «Reintentar» repita eso mismo
        let asked: { quick: boolean; styleId: string | null } | null = null;
        try { const r = parseEditRun(p, body.edit); asked = { quick: r.quick, styleId: r.styleId }; } catch {}
        const prev = p.editRun;
        p.editRun = { quick: asked?.quick ?? prev?.quick ?? false, styleId: asked?.styleId ?? prev?.styleId ?? p.styleId ?? null, state: "error", error: errText(e), startedAt: new Date().toISOString() };
        log(p, "No se pudo arrancar la edición: " + errText(e));
      }
      save();
    }
  }
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
  p.editRun = null; p.finalVideo = null; p.editApproved = false;
  // la producción anterior se hizo sobre otro video: se detiene (si trabajaba) y se olvidan su sesión y sus renders
  try { resetProductionForNewRecording(p); } catch (e) { console.warn(`[proyecto ${p.id}] no se pudo reiniciar la producción: ${errText(e)}`); }
  try { fs.rmSync(path.join(projectDir(p.id), "recording", "words.json"), { force: true }); } catch {}
  // los apoyos tenían tiempos de la grabación anterior: se descartan con sus archivos (apoyosCostUsd se conserva: ya se pagó)
  p.apoyos = [];
  try { fs.rmSync(path.join(projectDir(p.id), "apoyos"), { recursive: true, force: true }); } catch {}
  p.stage = "concepto";
  log(p, `Grabación cargada: ${name}`);
  save();
}

app.post("/api/projects/:id/recording", sub("recording"), upload.single("file"), wrap((req, res) => {
  const p = need(req);
  // un trabajo en curso (transcripción, tomas, corte, propuesta) escribiría resultados de la grabación anterior sobre la
  // nueva (words.json, editPlan, el corte): se cambia cuando termine
  if (p.job?.status === "running") {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    throw new Error("Espera a que termine el proceso en curso para cambiar la grabación.");
  }
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
  assertNoImagesGenerating(p);
  startJob(p, "concepto", (step) => proposeConcept(p, step, req.body.feedback || ""));
  res.json(p);
}));

// 5b. Apoyos visuales (entrega 4): se revisan en Propuesta visual; las imágenes se generan solo al tocar «Generar».
const APOYO_MODOS: Apoyo["modo"][] = ["encima", "pantalla_completa"];
const APOYO_POSICIONES: Apoyo["posicion"][] = ["arriba", "centro", "abajo"];
const APOYO_ANIMACIONES: Apoyo["animacion"][] = ["palabras", "cifra", "pasos", "comparacion", "lista", "ninguna"];
const APOYO_IMG = /\.(png|jpe?g|webp)$/i;
const APOYO_VID = /\.(mp4|mov|m4v)$/i;

const needApoyo = (p: Project, aid: string): Apoyo => {
  const a = (p.apoyos || []).find((x) => x.id === aid);
  if (!a) throw new Error("Apoyo no encontrado");
  return a;
};

/** Mientras la IA propone apoyos o rehace la propuesta, la lista que devuelve se fusiona con la de ese momento a partir
 *  de una copia anterior: una edición o un borrado hechos durante la llamada se perderían (o el apoyo quitado volvería).
 *  Por eso editar, aprobar, quitar, subir y generar esperan a que termine. */
function assertApoyosEditable(p: Project): void {
  if (p.job?.status === "running" && p.job.stage === "concepto") {
    throw new Error("La IA está trabajando en la propuesta y sus apoyos: espera a que termine para editar, aprobar, quitar, subir o generar.");
  }
}

/** Rehacer la propuesta o proponer apoyos reemplaza la lista con lo que devuelve la IA, que no sabe qué imagen se está
 *  generando: el apoyo podría desaparecer o cambiar de descripción y la imagen pagada quedaría sin apoyo (o atada a otro
 *  prompt). Se espera a que las imágenes en curso terminen. */
function assertNoImagesGenerating(p: Project): void {
  if ((p.apoyos || []).some((a) => a.estado === "generando")) {
    throw new Error("Hay imágenes generándose: espera a que terminen para pedir cambios o proponer apoyos.");
  }
}

/** Imagen generada (pagada) que es el archivo actual del apoyo: es la única que se conserva al quitarlo. Un archivo
 *  subido se borra aunque el apoyo haya tenido antes una imagen pagada (esa ya se reemplazó al subir). */
const keepsPaidFile = (a: Apoyo): boolean => a.fuente === "generar" && !!a.archivo;

/** Borra un archivo de apoyo solo si vive en <pid>/apoyos/ y ningún apoyo de la lista lo usa. */
function dropApoyoFile(p: Project, rel: string | null | undefined): void {
  if (!rel) return;
  const root = path.join(projectDir(p.id), "apoyos");
  const abs = path.resolve(projectDir(p.id), rel);
  if (!abs.startsWith(root + path.sep)) return;
  if ((p.apoyos || []).some((a) => a.archivo && path.resolve(projectDir(p.id), a.archivo) === abs)) return;
  try { fs.rmSync(abs, { force: true }); } catch {}
}

app.post("/api/projects/:id/apoyos/propose", wrap((req, res) => {
  const p = need(req);
  if (!p.recording) throw new Error("Primero carga tu grabación");
  if (!p.concept) throw new Error("Primero genera la propuesta visual");
  assertNoImagesGenerating(p);
  startJob(p, "concepto", (step) => proposeApoyos(p, step));
  res.json(p);
}));

app.patch("/api/projects/:id/apoyos/:aid", wrap((req, res) => {
  const p = need(req);
  const a = needApoyo(p, req.params.aid);
  assertApoyosEditable(p);
  const b = (req.body || {}) as Record<string, unknown>;
  const next: Apoyo = { ...a };
  if (b.aprobado !== undefined) {
    if (typeof b.aprobado !== "boolean") throw new Error("aprobado debe ser verdadero o falso.");
    next.aprobado = b.aprobado;
  }
  if (b.modo !== undefined) { if (!oneOf(APOYO_MODOS, b.modo)) throw new Error("Modo no válido: usa encima o pantalla_completa."); next.modo = b.modo; }
  if (b.posicion !== undefined) { if (!oneOf(APOYO_POSICIONES, b.posicion)) throw new Error("Posición no válida: usa arriba, centro o abajo."); next.posicion = b.posicion; }
  if (b.animacion !== undefined) { if (!oneOf(APOYO_ANIMACIONES, b.animacion)) throw new Error("Animación no válida."); next.animacion = b.animacion; }
  for (const k of ["contenido", "prompt"] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== "string") throw new Error(`${k} debe ser texto.`);
    next[k] = v.slice(0, k === "prompt" ? 4000 : 1000);
  }
  if (b.datos !== undefined) {
    if (!Array.isArray(b.datos) || b.datos.some((d) => typeof d !== "string")) throw new Error("datos debe ser una lista de textos.");
    const ds = (b.datos as string[]).map((d) => d.trim().replace(/\s+/g, " "));
    if (ds.length > DATOS_MAX) throw new Error(`Máximo ${DATOS_MAX} textos o cifras por apoyo (se leen en pocos segundos).`);
    const long = ds.find((d) => d.length > DATO_MAX);
    if (long) throw new Error(`«${long.slice(0, 40)}…» es muy largo: cada texto o cifra puede tener hasta ${DATO_MAX} caracteres.`);
    next.datos = ds;
  }
  // tamaño de los datos para su animación (lo que INS puede mostrar legible): solo errores de formato, no la falta de datos
  if (next.tipo === "broll_animado" && (b.datos !== undefined || b.animacion !== undefined) && next.animacion !== "ninguna") {
    const why = datosProblem(next.animacion, next.datos);
    if (why && (next.datos || []).some((d) => String(d).trim())) throw new Error(`No se puede guardar: ${why}.`);
  }
  for (const k of ["inicio_s", "fin_s"] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Los tiempos deben ser números en segundos.");
    next[k] = v;
  }
  if (b.inicio_s !== undefined || b.fin_s !== undefined) retime(next, p.recording?.duration, readWords(p));
  if (next.aprobado && !a.aprobado && next.tipo === "imagen" && !next.archivo) throw new Error("Genera o sube la imagen antes de aprobar este apoyo.");
  // un B-roll animado aprobado es un inserto obligatorio: tiene que poder construirse (animación elegida y datos que caben)
  if (next.aprobado && next.tipo === "broll_animado") {
    const why = datosProblem(next.animacion, next.datos);
    if (why) throw new Error(`Este B-roll animado no se puede aprobar: ${why}. Corrígelo en Editar.`);
  }
  Object.assign(a, next);
  p.apoyos!.sort((x, y) => x.inicio_s - y.inicio_s);
  p.updatedAt = new Date().toISOString();
  save();
  res.json(p);
}));

app.delete("/api/projects/:id/apoyos/:aid", wrap((req, res) => {
  const p = need(req);
  const a = needApoyo(p, req.params.aid);
  assertApoyosEditable(p);
  p.apoyos = (p.apoyos || []).filter((x) => x.id !== a.id);
  // una imagen pagada se conserva en la carpeta del proyecto (como al rehacer la propuesta): no hay que volver a pagarla
  if (!keepsPaidFile(a)) dropApoyoFile(p, a.archivo);
  log(p, `Apoyo quitado: ${a.contenido.slice(0, 60)}`);
  save();
  res.json(p);
}));

// subir imagen propia (o video, para tipo clip): se valida el apoyo antes de recibir el archivo
app.post("/api/projects/:id/apoyos/:aid/file",
  (req: Request, res: Response, next: NextFunction) => {
    try { const p = need(req); needApoyo(p, req.params.aid); assertApoyosEditable(p); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
    (req as UploadReq).uploadSub = "apoyos";
    apoyoUpload.single("file")(req, res, (err?: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      res.status(400).json({ error: code === "LIMIT_FILE_SIZE" ? `El archivo pasa de ${APOYO_MAX_MB} MB. Usa uno más liviano.` : (err as Error).message });
    });
  },
  wrap((req, res) => {
    const f = req.file;
    if (!f) throw new Error("No llegó ningún archivo. Vuelve a elegirlo.");
    const reject = (msg: string): never => { fs.rmSync(f.path, { force: true }); throw new Error(msg); };
    const p = getProject(req.params.id);
    const a = p?.apoyos?.find((x) => x.id === req.params.aid);
    if (!p || !a) return reject("El apoyo ya no existe.");
    const isImg = APOYO_IMG.test(f.originalname);
    const isVid = APOYO_VID.test(f.originalname);
    if (!isImg && !(isVid && a.tipo === "clip")) reject(a.tipo === "clip" ? "Formato no admitido: sube una imagen (png, jpg, webp) o un video (mp4, mov, m4v)." : "Formato no admitido: sube una imagen png, jpg o webp.");
    if (a.estado === "generando") reject("Se está generando una imagen para este apoyo: espera a que termine.");
    try { assertApoyosEditable(p); } catch (e) { reject((e as Error).message); }
    const prev = a.archivo;
    a.archivo = path.relative(projectDir(p.id), f.path).split(path.sep).join("/");
    a.fuente = "carpeta"; a.estado = "idle"; a.error = null; a.at = new Date().toISOString();
    dropApoyoFile(p, prev);
    log(p, `Archivo de apoyo subido: ${f.originalname}`);
    save();
    res.json(p);
  }));

// generar la ilustración con OpenAI (pago por clic). Responde de inmediato; la imagen se genera en segundo plano
// (no usa startJob: no bloquea la propuesta, el corte ni otros trabajos).
app.post("/api/projects/:id/apoyos/:aid/generate", wrap((req, res) => {
  const p = need(req);
  const a = needApoyo(p, req.params.aid);
  if (a.tipo !== "imagen") throw new Error("Solo los apoyos de tipo imagen se generan.");
  assertApoyosEditable(p);
  if (!hasKey("openai")) throw new Error("Falta la clave de OpenAI: agrégala en Ajustes → Imágenes de apoyo.");
  if (!a.prompt?.trim()) throw new Error("Escribe la descripción (prompt) de la imagen antes de generarla.");
  if (a.estado === "generando") throw new Error("Ya se está generando esta imagen.");
  const s = load().settings;
  const model = s.imageModel || "gpt-image-2";
  const quality = s.imageQuality || "medium";
  const prompt = composeImagePrompt(p, a);
  // freno + reserva: las imágenes en curso cuentan contra el crédito hasta que su fila de uso real existe
  const release = reserveOpenAICredit(imageUnitUsd(model, quality));
  a.estado = "generando"; a.error = null; a.gen = { model, quality };
  log(p, `Generando imagen de apoyo (${model}, ${quality})`);
  save();
  res.json(p);
  // nada que pase después de la llamada puede tumbar el servidor (una promesa rechazada sin catch lo cerraría)
  void generateApoyo(p.id, a.id, prompt, model, quality, p.recording?.at)
    .catch((e) => {
      console.warn("[apoyos] la generación falló después de la llamada:", errText(e));
      try {
        const x = getProject(p.id)?.apoyos?.find((y) => y.id === a.id);
        if (x && x.estado === "generando") { x.estado = "error"; x.error = "No se pudo guardar la imagen generada. Intenta de nuevo."; x.gen = null; save(); }
      } catch {}
    })
    .finally(release);
}));

/** Fila de uso de una imagen que OpenAI pudo haber cobrado sin que llegara (corte, reinicio, respuesta inválida):
 *  precio estimado, para que Uso y el freno de crédito no la pierdan. Suma también al gasto del proyecto y del apoyo. */
function chargeEstimatedImage(p: Project | undefined, a: Apoyo | undefined, pid: string, model: string, quality: Settings["imageQuality"]): void {
  const est = imageUnitUsd(model, quality);
  load().usage.push({ id: id(), at: new Date().toISOString(), provider: "openai", stage: "imagenes", projectId: pid, model, inputTokens: 0, outputTokens: 0, cost: est, ms: 0, estimated: true });
  if (p) p.apoyosCostUsd = Math.round(((p.apoyosCostUsd || 0) + est) * 1e6) / 1e6;
  if (a) a.costUsd = Math.round(((a.costUsd || 0) + est) * 1e6) / 1e6;
}

async function generateApoyo(pid: string, aid: string, prompt: string, model: string, quality: Settings["imageQuality"], recAt?: string): Promise<void> {
  const rel = `apoyos/${aid}-${Date.now()}.png`;
  const abs = path.join(PROJECTS_DIR, pid, rel);
  let r: Awaited<ReturnType<typeof generateImage>>;
  try {
    r = await generateImage({ prompt, model, quality, size: "1024x1536", outAbs: abs });
  } catch (e) {
    const p = getProject(pid);
    const a = p?.apoyos?.find((x) => x.id === aid);
    // la respuesta llegó (o pudo llegar) y OpenAI la cobró aunque la imagen no sirva: se registra el precio estimado
    const billed = e instanceof ImageGenError && e.billed;
    if (billed) chargeEstimatedImage(p, a, pid, model, quality);
    if (a) { a.estado = "error"; a.error = errText(e) + (billed ? " El costo estimado quedó registrado en Uso." : ""); a.gen = null; }
    save();
    return;
  }
  const db = load();
  db.usage.push({ id: id(), at: new Date().toISOString(), provider: "openai", stage: "imagenes", projectId: pid, model: r.model, inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0, cost: r.costUsd, ms: r.ms });
  const p = getProject(pid);
  if (!p) { fs.rmSync(abs, { force: true }); save(); return; }
  p.apoyosCostUsd = Math.round(((p.apoyosCostUsd || 0) + r.costUsd) * 1e6) / 1e6;
  const a = p.apoyos?.find((x) => x.id === aid);
  if (!a) {
    // el apoyo se quitó mientras se generaba: la imagen pagada se conserva en apoyos/, salvo que haya otra grabación
    if ((p.recording?.at ?? undefined) !== recAt) fs.rmSync(abs, { force: true });
    save();
    return;
  }
  const prev = a.archivo;
  a.archivo = rel; a.fuente = "generar"; a.estado = "idle"; a.error = null; a.gen = null;
  a.costUsd = Math.round(((a.costUsd || 0) + r.costUsd) * 1e6) / 1e6;
  a.at = new Date().toISOString();
  if (prev && prev !== rel) dropApoyoFile(p, prev);
  log(p, `Imagen de apoyo lista (US$${r.costUsd.toFixed(3)})`);
  save();
}

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
  const startedAt = new Date().toISOString();
  const wasPlantilla = Boolean(p.editRun && !p.editRun.quick);
  startJob(p, "edicion", async (step) => {
    try { await runEdit(p, step); }
    catch (e) {
      if (p.editRun?.startedAt === startedAt) { p.editRun.state = "error"; p.editRun.error = errText(e); }
      throw e;
    }
    if (p.editRun?.startedAt === startedAt) { p.editRun.state = "listo"; delete p.editRun.error; }
  });
  // el corte se rehace (y reescribe edit/final.mp4): el video aprobado deja de valer desde ya, no solo al terminar
  p.finalVideo = null; p.editApproved = false;
  if (p.stage === "publicacion" || p.stage === "publicado") p.stage = "edicion";
  // lo que se ve y se aprueba pasa a ser este corte: un render de plantilla hecho sobre el corte anterior no lo incluye
  // (para aplicarle la plantilla: «Producir de nuevo con plantilla»). Queda en "corte" hasta que el trabajo termine.
  if (p.editRun) { const { error: _e, ...rest } = p.editRun; p.editRun = { ...rest, quick: true, state: "corte", startedAt }; }
  // la plantilla en curso trabajaba sobre el corte que se está reescribiendo y ya no cuenta: se detiene para que no gaste
  if (wasPlantilla && producerWorking(p)) {
    stopProduction(p);
    log(p, "Productor detenido: volviste a cortar (rápido)");
  }
  save();
  res.json(p);
}));

// 6c. Camino por defecto: tomas + corte y, salvo quick, el productor con la plantilla
app.post("/api/projects/:id/edit/auto", wrap((req, res) => {
  const p = need(req);
  startEditRun(p, req.body);
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
// Imágenes de apoyo que se estaban generando: la llamada se perdió con el reinicio
// (OpenAI pudo terminarla y cobrarla: se registra el precio estimado para que Uso y el freno de crédito la cuenten)
for (const p of load().projects) for (const a of p.apoyos || []) if (a.estado === "generando") {
  // el modelo y la calidad que se pidieron (guardados al empezar); Ajustes solo para datos de antes de este campo
  const s = load().settings;
  chargeEstimatedImage(p, a, p.id, a.gen?.model || s.imageModel || "gpt-image-2", a.gen?.quality || s.imageQuality || "medium");
  a.gen = null;
  a.estado = "error"; a.error = "Se interrumpió al reiniciar la app. Si OpenAI alcanzó a cobrarla, el costo estimado quedó registrado en Uso.";
}
save();

app.listen(PORT, "127.0.0.1", () => console.log(`\n  ${load().settings.studioName} → http://localhost:${PORT}\n`));
