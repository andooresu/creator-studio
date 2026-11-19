// Contratos compartidos entre servidor e interfaz. Si cambias una forma aquí,
// el typecheck (npm run typecheck) señala todo lo que hay que ajustar en ambos lados.
import type { Analysis, Script, Concept, Publish, BrandGuide } from "./schemas.ts";

export type Provider = "anthropic" | "openai";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/**
 * Etapas del flujo a cámara (entrega 3: 5 pasos). "idea" junta lo que antes eran Referencias, Análisis y Guion.
 * "publicado" no es un paso del stepper: se ve en Publicación.
 */
export type Stage = "idea" | "grabacion" | "concepto" | "edicion" | "publicacion" | "publicado";
export const STAGES: Stage[] = ["idea", "grabacion", "concepto", "edicion", "publicacion", "publicado"];
/** Etapas guardadas por versiones anteriores; db.ts las migra a "idea" al cargar. */
export const LEGACY_IDEA_STAGES = ["referencias", "analisis", "guion"] as const;

/** Secciones que llaman a la IA (cada una con su modelo configurable). */
export type AiStage = "analisis" | "guion" | "concepto" | "edicion" | "publicar" | "branding" | "inspiracion" | "estilos";
export const AI_STAGES: AiStage[] = ["analisis", "guion", "concepto", "edicion", "publicar", "branding", "inspiracion", "estilos"];

/** Trabajo en segundo plano adjunto a un proyecto, guía, video o generador. */
export interface Job {
  stage: string;
  status: "running" | "done" | "error";
  step: string;
  startedAt?: string;
  endedAt?: string;
}
export interface LogEntry { at: string; msg: string }
export interface Jobbable { job?: Job | null; log?: LogEntry[] }

// ---------- Ajustes ----------
export interface ModelPrice { in: number; out: number; cacheRead: number; label: string }
export interface Settings {
  provider: Provider;
  apiKey: string;
  anthropicAdminKey: string;
  openaiKey: string;
  openaiAdminKey: string;
  apifyToken: string;
  metaToken: string;
  metaIgUserId: string;
  metaIgUsername: string;
  graphVersion: string;
  credits: Record<Provider, number>;
  hardStop: boolean;
  models: Record<Provider, Record<AiStage, string>>;
  customPrices: Record<string, Partial<ModelPrice>>;
  effort: Effort;
  /** esfuerzo propio por sección; la que no aparece usa `effort` */
  efforts: Partial<Record<AiStage, Effort>>;
  /** iterar estilos devolviendo solo las secciones que cambian (beta) */
  styleIterateSections: boolean;
  cookiesBrowser: string;
  defaultBrandId: string | null;
  studioName: string;
  rawDir: string;
  brollDir: string;
  /** ElevenLabs (música, voz y efectos del motor de video). */
  elevenlabsKey: string;
  elevenVoiceId: string;
  elevenTtsModel: string;
  /** Modelo de Claude para el constructor de videos (agente). */
  producerModel: string;
  /** Keys de organización (sk-ant-usr…/sin workspace) exigen el ID del workspace en cada llamada (wrkspc_…). */
  anthropicWorkspaceId: string;
  /** Proveedor de música, voz y efectos del motor de video. */
  audioProvider: AudioProvider;
  /** Modo local: motor de voz y voz elegida (Kokoro: em_alex, ef_dora…; Chatterbox: ruta de una muestra para clonar o vacío). */
  localTtsEngine: "kokoro" | "chatterbox";
  localVoice: string;
  /** Modo sintetizado: voz de macOS (`say`), p. ej. "Paulina". */
  sayVoice: string;
  /** Token de Hugging Face (solo para Stable Audio Open, que exige aceptar su licencia). */
  hfToken: string;
  /** Tope de costo por video del productor, en US$ (0 = sin tope). */
  maxCostPerVideo: number;
}
/** Lo que el navegador recibe: las claves llegan enmascaradas, nunca completas. */
export interface PublicSettings extends Settings {
  has: { anthropic: boolean; openai: boolean; anthropicAdmin: boolean; openaiAdmin: boolean; apify: boolean; meta: boolean; elevenlabs: boolean; hf: boolean };
  catalog: Record<Provider, Record<string, ModelPrice>>;
}
export type SettingsUpdate = Partial<Omit<Settings, "credits" | "models">> & {
  credits?: Partial<Record<Provider, number | string>>;
  models?: Partial<Record<Provider, Partial<Record<AiStage, string>>>>;
  clear?: "apiKey" | "anthropicAdminKey" | "openaiKey" | "openaiAdminKey" | "apifyToken" | "metaToken" | "elevenlabsKey" | "hfToken";
};

// ---------- Proyecto ----------
export interface Reference {
  id: string;
  url: string;
  note: string;
  file?: string | null;
  name?: string;
  info?: { title?: string; description?: string; uploader?: string; duration?: number; views?: number; likes?: number; comments?: number; uploadDate?: string; platform?: string };
  transcript?: string;
  /** rutas relativas a la carpeta del proyecto (servidas en /media/<id>/…) */
  frames?: string[];
  /** URLs absolutas (p. ej. /inspo/…) cuando la referencia viene de Inspiración */
  frameUrls?: string[] | null;
  inspoId?: string;
  addedAt: string;
}
export interface Recording {
  file: string;
  name: string;
  at: string;
  transcript?: string;
  duration?: number;
  frames?: { t: number; rel: string }[];
}
export interface Word { w: string; s: number; e: number }
export interface TakeSegment { id: number; s: number; e: number; text: string; w0: number; w1: number; keep: boolean; reason: string }
export interface EditPlan { resumen: string; segments: TakeSegment[]; at: string }
export interface EditResult {
  final: string | null;
  cut: string | null;
  srtPath: string | null;
  briefPath: string;
  burned: boolean;
  mode: "tomas" | "silencios";
  segments: number;
  originalDuration: number;
  finalDuration: number;
  transcribed: boolean;
  at: string;
}
/** Pedido del camino de edición por defecto. quick=true: solo corte rápido (ffmpeg, sin plantilla ni costo del productor). */
export interface EditRunRequest {
  quick?: boolean;
  /** plantilla (estilo kind talking/any); por defecto p.styleId o la primera plantilla a cámara */
  styleId?: string | null;
  flags?: { useBrand?: boolean; music?: boolean; formats?: Format[] };
  /** tope de costo del productor para este video (como en production/start) */
  capUsd?: number;
}
export interface EditRun {
  quick: boolean;
  styleId: string | null;
  flags?: EditRunRequest["flags"];
  capUsd?: number;
  /** "corte": corre el trabajo de tomas + corte; "plantilla": el productor está trabajando; "listo": hay resultado; "error" */
  state: "corte" | "plantilla" | "listo" | "error";
  error?: string;
  startedAt: string;
}
export interface FinalVideo {
  /** ruta relativa a la carpeta del proyecto (se sirve en /media/<pid>/<path>) */
  path: string;
  source: "plantilla" | "rapido";
  fmt?: Format;
  at: string;
}
/** Tipo de video: talking head grabado (flujo por etapas), reel comercial o clase/explicador (motor de video). */
export type ProjectKind = "talking" | "reel" | "clase";

// ---------- Audio del motor: tres modos ----------
export type AudioProvider = "elevenlabs" | "local" | "sintetizado";
export type LocalAudioEngine = "kokoro" | "chatterbox" | "acestep" | "stableaudio";
export interface AudioEngineStatus {
  /** se puede usar en esta máquina (hardware compatible) */
  supported: boolean;
  installed: boolean;
  /** por qué no está soportado o qué falta, en español */
  note?: string;
  /** tamaño aproximado de la descarga, para mostrar antes de instalar */
  sizeHint?: string;
}
export interface AudioEnv {
  provider: AudioProvider;
  hardware: { arch: string; accel: "apple-silicon" | "cuda" | "cpu"; os: string };
  engines: Record<LocalAudioEngine, AudioEngineStatus>;
  /** voces de macOS en español disponibles para el modo sintetizado */
  sayVoices: string[];
  /** listo para producir con el proveedor elegido (voz y música resueltas) */
  ready: boolean;
  issues: string[];
}

export interface Project extends Jobbable {
  id: string;
  /** ausente en proyectos antiguos = "talking" */
  kind?: ProjectKind;
  /** estilo del motor de video elegido para este proyecto */
  styleId?: string | null;
  production?: Production | null;
  title: string;
  goal: string;
  brandId: string | null;
  stage: Stage;
  references: Reference[];
  analysis?: Analysis | null;
  script?: Script | null;
  scriptApproved?: boolean;
  scriptHistory?: { at: string; feedback: string }[];
  recording?: Recording | null;
  concept?: Concept | null;
  conceptApproved?: boolean;
  editPlan?: EditPlan | null;
  edit?: EditResult | null;
  editApproved?: boolean;
  /** camino de edición por defecto (entrega 3): tomas → corte → plantilla, lanzado al aprobar la propuesta o con «Editar video» */
  editRun?: EditRun | null;
  /** video aprobado en Edición: lo que usa Publicación (ruta relativa a la carpeta del proyecto) */
  finalVideo?: FinalVideo | null;
  publish?: Publish | null;
  published?: { url: string; at: string; trial: boolean } | null;
  createdAt: string;
  updatedAt?: string;
}
export interface ProjectSummary { id: string; title: string; kind: ProjectKind; productionStatus?: ProductionStatus; stage: Stage; createdAt: string; updatedAt?: string; job?: Job | null; goal: string; brandId: string | null; refs: number; /** URL de la miniatura (solo si el proyecto tiene video) */ thumb?: string; /** hay un video terminado (render final o edición final) */ hasVideo?: boolean }

// ---------- Branding ----------
export type BrandSource =
  | { type: "url"; value: string }
  | { type: "instagram"; value: string }
  | { type: "text"; value: string }
  | { type: "pdf"; file: string; name: string }
  | { type: "image"; file: string; name: string };
export interface BrandVersion { at: string; note: string; guide: BrandGuide | null; raw: string }
export interface Brand extends Jobbable {
  id: string;
  name: string;
  guide: BrandGuide | null;
  raw: string;
  sources: BrandSource[];
  versions: BrandVersion[];
  createdAt: string;
  updatedAt?: string;
}
export interface BrandGen extends Jobbable { proposals: BrandGuide[]; sources: BrandSource[] }
export interface BrandSummary { id: string; name: string; createdAt: string; palette: string[] }

// ---------- Inspiración ----------
export type Platform = "instagram" | "tiktok" | "youtube";
export interface InspoVideo extends Jobbable {
  id: string;
  platform: Platform;
  account: string;
  accountId?: string;
  url: string;
  caption: string;
  thumbUrl?: string;
  thumbFile?: string | null;
  thumb?: string | null;
  videoUrl?: string;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  postedAt: string | null;
  metric?: "views" | "engagement";
  outlier: number | null;
  file?: string | null;
  transcript?: string;
  frameUrls?: string[] | null;
  analysis?: Analysis | null;
  analyzedAt?: string;
  fetchedAt?: string;
}
export interface InspoAccount {
  id: string;
  platform: Platform;
  username: string;
  fullName?: string;
  biography?: string;
  followers?: number;
  avatar?: string | null;
  medianViews?: number;
  metric?: "views" | "engagement";
  lastFetched?: string;
  videoCount?: number;
  addedAt: string;
}
export interface InspoCollection { id: string; name: string; videoIds: string[]; createdAt: string }

// ---------- Uso de IA ----------
export interface UsageRow {
  id: string;
  at: string;
  provider: Provider;
  stage: AiStage | string;
  projectId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  ms: number;
  /** parte de inputTokens leída de la caché (cuesta una fracción) */
  cacheRead?: number;
  /** parte de inputTokens escrita en la caché (cuesta un poco más que la entrada normal) */
  cacheWrite?: number;
}
export interface ProviderSpend {
  provider: Provider;
  available: boolean;
  reason?: string;
  spent?: number;
  refreshedAt?: string | null;
  note?: string;
  fetchedAt?: string;
}
export interface UsageSummary {
  provider: Provider;
  month: string;
  source: "proveedor" | "estudio";
  providerInfo: ProviderSpend;
  spent: number;
  studioSpent: number;
  credit: number;
  remaining: number | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** tokens de entrada leídos de la caché este mes (solo llamadas que lo registran) */
  tokensCacheRead: number;
  /** % de la entrada servida desde la caché (null si aún no hay datos) */
  cacheHitRate: number | null;
  byStage: Record<string, number>;
  byModel: Record<string, number>;
  recent: UsageRow[];
  keySet: boolean;
  /** hay clave de Anthropic (la necesita el productor de la plantilla, aunque el proveedor elegido sea otro) */
  anthropicKeySet?: boolean;
}

// ---------- Herramientas locales ----------
export interface Tools {
  ffmpeg: boolean;
  ytdlp: boolean;
  whisperCpp: boolean;
  whisperCppBinary: boolean;
  whisperModel: string | null;
  whisperPy: boolean;
  subtitlesFilter: boolean;
}

// ---------- Respuestas de la API ----------
export interface AppState {
  stages: Stage[];
  projects: ProjectSummary[];
  brands: BrandSummary[];
  defaultBrandId: string | null;
  studioName: string;
  rawDir: string;
  brandIsPlaceholder: boolean;
  usage: UsageSummary;
  tools: Tools;
  pricing: Record<string, ModelPrice>;
  styles: StyleSummary[];
  motion: MotionEnv;
  audio: AudioEnv;
}
/** Estado del entorno del motor de video. */
export interface MotionEnv { ready: boolean; playwright: boolean; chromium: boolean; python: boolean; ffmpeg: boolean; elevenlabs: boolean; issues: string[] }
export interface RawFile { path: string; name: string; size: number; mtime: string }
export interface BrandsResponse { brands: Brand[]; defaultBrandId: string | null; gen: BrandGen }
export interface InspoResponse {
  accounts: InspoAccount[];
  videos: (Omit<InspoVideo, "analysis" | "transcript"> & { analyzed: boolean })[];
  collections: InspoCollection[];
  job: Job | null;
  hasApify: boolean;
  hasMeta: boolean;
}

// ---------- Motor de video (motion) y sesión de producción ----------
export type Format = "9x16" | "4x5" | "1x1" | "16x9";
export const FORMATS: Format[] = ["9x16", "4x5", "1x1", "16x9"];

export interface RenderOutput { fmt: Format; mode: "draft" | "final"; path: string; at: string; seconds?: number }

export type ProductionStatus = "idle" | "running" | "waiting" | "done" | "error";

/** Pregunta del agente al usuario (equivale a AskUserQuestion de las sesiones). */
export interface AgentQuestion {
  id: string;
  /** ronda de preguntas (1…) y máximo de rondas de esta producción, para mostrar «Ronda 1 de 1» */
  round?: number;
  maxRounds?: number;
  questions: { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string; preview?: string }[] }[];
}
/** Puerta de aprobación (shotlist, música, borrador, final). */
export interface AgentApproval { id: string; kind: "concepto" | "musica" | "voz" | "shotlist" | "borrador" | "final" | "otro"; title: string; summary: string; media?: string[] }
/** El productor llegó al tope de costo del video y espera que el usuario lo suba o detenga. */
export interface ProductionBudget { id: string; capUsd: number; spentUsd: number; suggestedUsd: number }
export type PendingAction = { type: "question"; data: AgentQuestion } | { type: "approval"; data: AgentApproval } | { type: "budget"; data: ProductionBudget };

// ---------- Progreso del productor (barra de etapas con ETA) ----------
export type ProgressStageKey = "preparacion" | "brief" | "estilo" | "propuesta" | "audio" | "construccion" | "revision" | "render";
export interface ProgressStage {
  key: ProgressStageKey;
  label: string;
  startedAt?: string;
  endedAt?: string;
  /** ms que contaron (sin el tiempo esperando al usuario) */
  activeMs?: number;
}
export interface ProductionProgress {
  /** etapas del modo, en orden */
  stages: ProgressStage[];
  /** índice de la etapa actual (-1 antes de empezar la primera) */
  current: number;
  /** desde cuándo cuenta el reloj de la etapa actual (null mientras está en pausa esperando al usuario) */
  runningSince?: string | null;
  /** ms ya contados en la etapa actual antes de runningSince */
  currentActiveMs?: number;
  /** ms activos que faltan (resto de la etapa actual + etapas futuras), recalculado en cada cambio. Con el reloj
   *  corriendo vale para el instante runningSince: lo que falta ahora es etaMs − (ahora − runningSince). */
  etaMs?: number | null;
  /** ms activos típicos por etapa (para que la interfaz descuente localmente entre actualizaciones) */
  typicalMs?: Partial<Record<ProgressStageKey, number>>;
}
/** Estimación antes de producir (sin llamar a la IA). */
export interface ProductionEstimate {
  lowUsd: number;
  highUsd: number;
  typicalUsd: number;
  minutes: number;
  basis: "historial" | "referencia";
  samples: number;
  maxQuestionRounds: number;
  maxQuestions: number;
  /** tope por defecto (Ajustes); 0 = sin tope */
  capUsd: number;
}

export interface ProductionEvent {
  id: string;
  at: string;
  type: "user" | "assistant" | "tool" | "question" | "answer" | "approval" | "decision" | "media" | "status" | "cost" | "error";
  text: string;
  /** rutas servibles (/media/<id>/motion/...) para audio/video/imagen */
  media?: string[];
  data?: unknown;
}

export interface Production {
  /** carpeta del proyecto del motor (absoluta) */
  dir: string;
  status: ProductionStatus;
  /** id de sesión del SDK de agentes para continuar la conversación */
  sessionId?: string | null;
  pending?: PendingAction | null;
  events: ProductionEvent[];
  renders: RenderOutput[];
  costUsd: number;
  startedAt: string;
  updatedAt?: string;
  /** barra de etapas con ETA */
  progress?: ProductionProgress | null;
  /** costo provisional del turno en curso (uso de los mensajes); vuelve a 0 cuando se contabiliza el resultado del turno */
  liveUsd?: number;
  /** tope de este video en US$; 0 o sin definir = el de Ajustes (maxCostPerVideo) */
  capUsd?: number;
  /** costUsd ya gastado al cargar la grabación actual: el tope cuenta solo lo gastado desde entonces (costUsd sigue siendo el total) */
  capBaseUsd?: number;
  /** rondas de preguntas ya hechas y máximo de rondas de esta producción */
  questionRounds?: number;
  maxQuestionRounds?: number;
}

// ---------- Estilos (biblioteca que aprende) ----------
export type StyleKind = "reel" | "clase" | "talking" | "any";
export type StyleOrigin = "base" | "importado" | "referencia" | "ia";
export interface Style extends Jobbable {
  id: string;
  name: string;
  kind: StyleKind;
  origin: StyleOrigin;
  description: string;
  /** guía completa en markdown: vocabulario de movimiento, ritmo, reglas, tipografía, color, sonido, subtítulos */
  guide: string;
  tokens: { palette: string[]; fonts: string[] };
  captionPreset?: string;
  /** archivos del estilo, relativos a su carpeta (data/styles/<id>/ o motion/styles/<id>/ en los base): helpers, ejemplos de film.js, index.html con tokens, fuentes */
  files: string[];
  /** proyectos o videos de los que se aprendió */
  sources: string[];
  /** videos producidos con este estilo (proyectos de la app) */
  usedBy?: string[];
  createdAt: string;
  updatedAt?: string;
  /** vista previa (rutas relativas a la carpeta del estilo; se sirven en /styles-files/<id>/<ruta>). Calculada al leer. */
  preview?: StylePreview;
  /** true si se puede (re)generar la vista previa: tiene demo o renders en sus proyectos de origen. Calculado al leer. */
  canPreview?: boolean;
}
/** Clip corto en bucle sin audio (demo/preview.mp4) y su póster (demo/poster.jpg o demo/preview.jpg). */
export interface StylePreview { video?: string; poster?: string; /** versión (fecha del archivo) para invalidar la caché del navegador */ v?: string }
export interface StyleSummary { id: string; name: string; kind: StyleKind; origin: StyleOrigin; description: string; palette: string[]; preview?: StylePreview }

// ---------- Base de datos completa (en memoria; persistida en SQLite) ----------
export interface DB {
  settings: Settings;
  styles: Style[];
  projects: Project[];
  usage: UsageRow[];
  brandGuides: Brand[];
  accounts: InspoAccount[];
  videos: InspoVideo[];
  collections: InspoCollection[];
}
