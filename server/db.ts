// Almacenamiento local en SQLite (node:sqlite, integrado en Node 24: sin dependencias nativas).
// El resto del código trabaja sobre un objeto en memoria (load()) y llama save() tras mutarlo;
// save() escribe en una transacción solo las filas que cambiaron. Todo vive en studio/data/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { emitChange } from "./events.ts";
import { STAGES, LEGACY_IDEA_STAGES } from "../shared/types.ts";
import type { DB, Settings, Brand, Project, Jobbable, AiStage, Stage } from "../shared/types.ts";

// Rutas relativas a la app (no al directorio desde donde se lance). STUDIO_DATA_DIR permite aislar pruebas.
export const APP_DIR = path.resolve(import.meta.dirname, "..");
export const DATA_DIR = process.env.STUDIO_DATA_DIR ? path.resolve(process.env.STUDIO_DATA_DIR) : path.join(APP_DIR, "data");
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const BRANDS_DIR = path.join(DATA_DIR, "brands");
export const INSPO_DIR = path.join(DATA_DIR, "inspo");
export const STYLES_DIR = path.join(DATA_DIR, "styles");
/** Kit del motor de video incluido en la app (motor, scripts, skill de referencia, estilos base). */
export const MOTION_DIR = path.join(APP_DIR, "motion");
const SQLITE_FILE = path.join(DATA_DIR, "studio.db");
const LEGACY_JSON = path.join(DATA_DIR, "db.json");

for (const d of [PROJECTS_DIR, BRANDS_DIR, INSPO_DIR, STYLES_DIR]) fs.mkdirSync(d, { recursive: true });
// La app es "type": "module", pero los scripts del motor dentro de cada proyecto son CommonJS (.js con require).
// Un package.json neutro en la carpeta de datos hace que Node los trate como CommonJS.
const DATA_PKG = path.join(DATA_DIR, "package.json");
if (!fs.existsSync(DATA_PKG)) fs.writeFileSync(DATA_PKG, JSON.stringify({ private: true, type: "commonjs" }, null, 2) + "\n");

export const DEFAULT_BRAND = `Marca: (tu nombre o @usuario)
Nicho: (de qué hablas y para quién)
Ángulo: (qué te hace diferente; qué opinas que otros no dicen)
Tono: (cómo hablas: directo, cercano, técnico, humor…)
Formato principal: (ej. talking head vertical 9:16, 30-60 s, hook en los primeros 2 s, subtítulos grandes)
Ejemplos de títulos o frases tuyas: (3-5 ejemplos reales)
Objetivo: (crecer audiencia, vender, posicionarte como referente…)
Consejo: en Branding puedes generar una guía completa con IA desde tu web, tu Instagram o un PDF.`;

const STAGE_MODELS = (m: [string, string]): Record<AiStage, string> => ({ analisis: m[0], guion: m[0], concepto: m[0], edicion: m[0], publicar: m[1], branding: m[0], inspiracion: m[1], estilos: m[0] });

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  apiKey: "",
  anthropicAdminKey: "",
  openaiKey: "",
  openaiAdminKey: "",
  apifyToken: "",
  metaToken: "",
  metaIgUserId: "",
  metaIgUsername: "",
  graphVersion: "v23.0",
  credits: { anthropic: 0, openai: 0 }, // cada quien define su crédito mensual en Ajustes
  hardStop: true,
  models: {
    anthropic: STAGE_MODELS(["claude-opus-5-5", "claude-sonnet-5-5"]),
    openai: STAGE_MODELS(["gpt-5", "gpt-5-mini"]),
  },
  customPrices: {},
  effort: "medium",
  efforts: {},
  styleIterateSections: false,
  cookiesBrowser: "",
  defaultBrandId: null,
  studioName: "Mi estudio",
  rawDir: "",
  brollDir: "",
  elevenlabsKey: "",
  elevenVoiceId: "",
  elevenTtsModel: "eleven_multilingual_v2",
  producerModel: "claude-opus-5-5",
  anthropicWorkspaceId: "",
  audioProvider: "sintetizado", // gratis y funciona en cualquier Mac; se cambia en Ajustes
  localTtsEngine: "kokoro",
  localVoice: "em_alex",
  sayVoice: "Paulina",
  hfToken: "",
  maxCostPerVideo: 15, // US$ por video del productor; 0 = sin tope
};

export const id = (): string => crypto.randomBytes(5).toString("hex");

// Forma "cruda" de versiones anteriores (v0.1 tenía models plano, monthlyBudget y brand en texto).
type RawSettings = Partial<Settings> & { models?: Record<string, unknown>; monthlyBudget?: number; brand?: string };
type RawDB = Partial<Omit<DB, "settings">> & { settings?: RawSettings };

/** Normaliza datos de cualquier versión anterior al formato actual. */
export function migrate(raw: RawDB): DB {
  const rs: RawSettings = raw.settings || {};
  const s: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...(rs as Partial<Settings>) };
  const rawModels = rs.models as Record<string, unknown> | undefined;
  if (rawModels && !("anthropic" in rawModels)) {
    s.models = structuredClone(DEFAULT_SETTINGS.models);
    s.models.anthropic = { ...s.models.anthropic, ...(rawModels as Partial<Record<AiStage, string>>) };
  }
  s.models = {
    anthropic: { ...DEFAULT_SETTINGS.models.anthropic, ...(s.models?.anthropic || {}) },
    openai: { ...DEFAULT_SETTINGS.models.openai, ...(s.models?.openai || {}) },
  };
  if (rs.monthlyBudget !== undefined && !rs.credits) s.credits = { anthropic: rs.monthlyBudget, openai: 0 };
  s.credits = { ...DEFAULT_SETTINGS.credits, ...s.credits };
  const db: DB = {
    settings: s,
    styles: raw.styles || [],
    projects: raw.projects || [],
    usage: (raw.usage || []).map((u) => ({
      ...u,
      id: u.id ?? id(),
      at: u.at ?? new Date(0).toISOString(),
      provider: u.provider ?? "anthropic",
      stage: u.stage ?? "",
      model: u.model ?? "",
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      cost: u.cost ?? 0,
      ms: u.ms ?? 0,
    })),
    brandGuides: raw.brandGuides || [],
    accounts: raw.accounts || [],
    videos: raw.videos || [],
    collections: raw.collections || [],
  };
  // El perfil de marca de texto (v0.1) pasa a ser la primera guía de branding
  if (!db.brandGuides.length) {
    const g: Brand = { id: id(), name: rs.brand ? "Perfil inicial" : "Mi marca (completa esta guía)", raw: rs.brand || DEFAULT_BRAND, guide: null, sources: [], versions: [], createdAt: new Date().toISOString() };
    db.brandGuides.push(g);
    s.defaultBrandId = g.id;
  }
  delete (s as RawSettings).brand;
  delete (s as RawSettings).monthlyBudget;
  for (const p of db.projects) p.stage = migrateStage(p.stage);
  return db;
}

/** Entrega 3: Referencias, Análisis y Guion se unieron en «Idea y guion» ("idea"). Cualquier etapa desconocida también
 *  vuelve a "idea". Idempotente (una etapa válida queda igual). */
export function migrateStage(raw: unknown): Stage {
  if ((LEGACY_IDEA_STAGES as readonly unknown[]).includes(raw)) return "idea";
  return (STAGES as unknown[]).includes(raw) ? (raw as Stage) : "idea";
}

// ---------- SQLite ----------
const DOC_COLLECTIONS = ["projects", "brandGuides", "accounts", "videos", "collections", "styles"] as const;
type DocCollection = (typeof DOC_COLLECTIONS)[number];

let sql: DatabaseSync | null = null;
let cache: DB | null = null;
// Último JSON escrito por fila, para escribir solo lo que cambió.
const written = new Map<string, string>();
const writtenUsage = new Set<string>();

function open(): DatabaseSync {
  if (sql) return sql;
  sql = new DatabaseSync(SQLITE_FILE, { timeout: 5000 });
  sql.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL, id TEXT NOT NULL, pos INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE TABLE IF NOT EXISTS usage (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, provider TEXT, stage TEXT, projectId TEXT, model TEXT,
      inputTokens INTEGER, outputTokens INTEGER, cost REAL, ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS usage_at ON usage(at);
  `);
  // columnas añadidas después: tokens leídos/escritos en la caché
  const cols = new Set((sql.prepare("PRAGMA table_info(usage)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("cacheRead")) sql.exec("ALTER TABLE usage ADD COLUMN cacheRead INTEGER");
  if (!cols.has("cacheWrite")) sql.exec("ALTER TABLE usage ADD COLUMN cacheWrite INTEGER");
  return sql;
}

function readAll(): RawDB | null {
  const db = open();
  const settingsRow = db.prepare("SELECT value FROM kv WHERE key = 'settings'").get() as { value: string } | undefined;
  if (!settingsRow) return null; // base vacía
  const out: RawDB = { settings: JSON.parse(settingsRow.value) };
  for (const c of DOC_COLLECTIONS) {
    const rows = db.prepare("SELECT id, pos, data FROM docs WHERE collection = ? ORDER BY pos").all(c) as { id: string; pos: number; data: string }[];
    (out as Record<string, unknown>)[c] = rows.map((r, i) => {
      written.set(`${c}:${r.id}`, r.data);
      written.set(`${c}:${r.id}#pos`, String(i));
      return JSON.parse(r.data);
    });
  }
  const usage = (db.prepare("SELECT * FROM usage ORDER BY at").all() as unknown as DB["usage"]).map((u) => {
    // filas anteriores a la columna: sin dato de caché (null → ausente)
    if (u.cacheRead == null) delete u.cacheRead;
    if (u.cacheWrite == null) delete u.cacheWrite;
    return u;
  });
  for (const u of usage) writtenUsage.add(u.id);
  out.usage = usage;
  written.set("kv:settings", settingsRow.value);
  return out;
}

function setAside(file: string, why: unknown): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const f of [file, file + "-wal", file + "-shm"]) if (fs.existsSync(f)) fs.renameSync(f, `${f}.corrupto-${stamp}`);
  console.error(`\n  ⚠️  ${path.basename(file)} estaba dañado (${(why as Error)?.message || why}).\n  Se apartó como ${path.basename(file)}.corrupto-${stamp} y se empieza con datos nuevos.\n`);
}

export function load(): DB {
  if (cache) return cache;
  let raw: RawDB | null;
  try { raw = readAll(); }
  catch (e) {
    sql?.close(); sql = null; written.clear(); writtenUsage.clear();
    setAside(SQLITE_FILE, e);
    raw = readAll();
  }
  let importedLegacy = false;
  if (!raw && fs.existsSync(LEGACY_JSON)) {
    // Primera ejecución tras actualizar: importa el antiguo data/db.json
    try {
      raw = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8")) as RawDB;
      importedLegacy = true;
    } catch (e) {
      setAside(LEGACY_JSON, e);
    }
  }
  cache = migrate(raw || {});
  save();
  if (importedLegacy) fs.renameSync(LEGACY_JSON, LEGACY_JSON + ".importado-a-sqlite");
  return cache;
}

/** El documento sin el paso actual del trabajo ni su registro (para saber si solo cambió el avance). */
function liteJson(json: string): string {
  try {
    const d = JSON.parse(json) as { job?: { step?: string } | null; log?: unknown };
    return JSON.stringify({ ...d, log: undefined, job: d.job ? { ...d.job, step: undefined } : d.job });
  } catch { return json; }
}

/** Persiste en una transacción solo las filas nuevas o modificadas (y borra las eliminadas). */
export function save(): void {
  if (!cache) return;
  const db = open();
  const upsertKv = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const upsertDoc = db.prepare("INSERT INTO docs (collection, id, pos, data) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET pos = excluded.pos, data = excluded.data");
  const delDoc = db.prepare("DELETE FROM docs WHERE collection = ? AND id = ?");
  const insUsage = db.prepare("INSERT OR IGNORE INTO usage (id, at, provider, stage, projectId, model, inputTokens, outputTokens, cost, ms, cacheRead, cacheWrite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  // Los cambios se preparan aparte y solo se registran como escritos si la transacción confirma.
  const pendingSet = new Map<string, string>();
  const pendingDel: string[] = [];
  const pendingUsage: string[] = [];
  const posOnly = new Set<string>();
  const stepOnly = new Set<string>();
  db.exec("BEGIN IMMEDIATE");
  try {
    const sJson = JSON.stringify(cache.settings);
    if (written.get("kv:settings") !== sJson) { upsertKv.run("settings", sJson); pendingSet.set("kv:settings", sJson); }
    for (const c of DOC_COLLECTIONS) {
      const list = cache[c as DocCollection] as { id: string }[];
      const present = new Set<string>();
      list.forEach((doc, pos) => {
        const key = `${c}:${doc.id}`;
        present.add(key);
        const json = JSON.stringify(doc);
        if (written.get(key) !== json || written.get(`${key}#pos`) !== String(pos)) {
          const prev = written.get(key);
          if (prev === json) posOnly.add(key);
          else if (prev && liteJson(prev) === liteJson(json)) stepOnly.add(key);
          upsertDoc.run(c, doc.id, pos, json);
          pendingSet.set(key, json);
          pendingSet.set(`${key}#pos`, String(pos));
        }
      });
      for (const key of written.keys()) {
        if (key.startsWith(`${c}:`) && !key.includes("#") && !present.has(key)) {
          delDoc.run(c, key.slice(c.length + 1));
          pendingDel.push(key);
        }
      }
    }
    for (const u of cache.usage) {
      if (writtenUsage.has(u.id)) continue;
      insUsage.run(u.id, u.at, u.provider, String(u.stage ?? ""), u.projectId ?? null, u.model ?? "", u.inputTokens ?? 0, u.outputTokens ?? 0, u.cost ?? 0, u.ms ?? 0, u.cacheRead ?? null, u.cacheWrite ?? null);
      pendingUsage.push(u.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  for (const [k, v] of pendingSet) written.set(k, v);
  for (const k of pendingDel) { written.delete(k); written.delete(`${k}#pos`); }
  for (const idu of pendingUsage) writtenUsage.add(idu);
  // avisa en vivo qué documentos cambiaron (sin el sufijo #pos)
  const changed = new Set<string>();
  // si solo cambió la posición (otro documento se agregó o se movió) se anuncia la colección, no cada documento
  // si solo avanzó el paso de un trabajo, "step:<clave>": lo escucha la pantalla de ese documento, no el estado general
  for (const k of pendingSet.keys()) if (!k.endsWith("#pos")) changed.add(posOnly.has(k) ? k.split(":")[0] : stepOnly.has(k) ? `step:${k}` : k);
  for (const k of pendingDel) changed.add(k);
  if (pendingUsage.length) changed.add("usage");
  emitChange(changed);
}

// ---------- Valores sueltos en la tabla kv (fuera de los ajustes) ----------
// Para datos internos que no viajan al navegador ni a load() (p. ej. "progressStats", el historial de tiempos por etapa
// del productor). Se escriben directo en su fila (una sentencia, sin la transacción de save()) y quedan en memoria.
const kvCache = new Map<string, unknown>();
const KV_RESERVED = new Set(["settings"]);

/** Lee un valor JSON de la tabla kv (undefined si no existe o está dañado). */
export function kvGet<T>(key: string): T | undefined {
  if (kvCache.has(key)) return kvCache.get(key) as T | undefined;
  let v: unknown;
  try {
    const row = open().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    v = row ? JSON.parse(row.value) : undefined;
  } catch { v = undefined; }
  kvCache.set(key, v);
  return v as T | undefined;
}

/** Guarda un valor JSON en la tabla kv ("settings" está reservado: va por save()). */
export function kvSet(key: string, value: unknown): void {
  if (KV_RESERVED.has(key)) throw new Error(`La clave kv "${key}" está reservada.`);
  open().prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  kvCache.set(key, structuredClone(value));
}

export function projectDir(pid: string): string {
  const d = path.join(PROJECTS_DIR, pid);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function getProject(pid: string): Project | undefined {
  return load().projects.find((p) => p.id === pid);
}

export function getBrand(bid?: string | null): Brand {
  const db = load();
  return db.brandGuides.find((b) => b.id === bid) || db.brandGuides.find((b) => b.id === db.settings.defaultBrandId) || db.brandGuides[0];
}

export function log(target: Jobbable, msg: string): void {
  target.log = target.log || [];
  target.log.push({ at: new Date().toISOString(), msg });
  if (target.log.length > 200) target.log.shift();
}
