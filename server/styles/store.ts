// Biblioteca de estilos del motor de video: estilos base (motion/styles/<id>/, solo lectura, vienen con la app)
// + estilos del usuario (db.styles, archivos en data/styles/<id>/). Aquí viven lectura, guardado, duplicado y borrado.
import fs from "node:fs";
import path from "node:path";
import { load, save, id, STYLES_DIR, MOTION_DIR } from "../db.ts";
import type { Style, StyleKind, StyleOrigin, StylePreview, StyleSummary } from "../../shared/types.ts";

/** Carpeta de los estilos base incluidos en el repo. */
export const BASE_STYLES_DIR = path.join(MOTION_DIR, "styles");
export const STYLE_KINDS: StyleKind[] = ["reel", "clase", "talking", "any"];

const now = (): string => new Date().toISOString();

/** Carpeta de un estilo: motion/styles/<id> si es base, si no data/styles/<id>. (Mismo criterio que styleDir() del kit.) */
export function styleFolder(style: Pick<Style, "id" | "origin">): string {
  return style.origin === "base" ? path.join(BASE_STYLES_DIR, style.id) : path.join(STYLES_DIR, style.id);
}

/** Carpeta de un estilo del usuario (la crea si falta). */
export function userStyleDir(sid: string): string {
  const d = path.join(STYLES_DIR, sid);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Lista recursiva de archivos de una carpeta, relativos a ella (sin ocultos ni style.json). */
export function listFiles(dir: string, skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, "");
  return out;
}

const isStyleFileList = (rel: string): boolean => rel === "style.json" || rel.startsWith("versions/");

// ---------- vista previa (clip en bucle + póster; ver styles/preview.ts) ----------
export const PREVIEW_VIDEO = "demo/preview.mp4";
export const PREVIEW_POSTER = "demo/poster.jpg";

/** Rutas (relativas a la carpeta del estilo) de la vista previa, si existen. */
export function stylePreview(style: Pick<Style, "id" | "origin" | "files">): StylePreview | undefined {
  const files = style.files || [];
  const video = files.includes(PREVIEW_VIDEO) ? PREVIEW_VIDEO : undefined;
  const poster = files.includes(PREVIEW_POSTER) ? PREVIEW_POSTER : files.includes("demo/preview.jpg") ? "demo/preview.jpg" : undefined;
  if (!video && !poster) return undefined;
  // versión = fecha del archivo: cambia al regenerar y obliga al navegador a pedir el clip nuevo
  let v = "";
  try { v = String(Math.round(fs.statSync(path.join(styleFolder(style), (video || poster)!)).mtimeMs)); } catch {}
  return { ...(video ? { video } : {}), ...(poster ? { poster } : {}), ...(v ? { v } : {}) };
}

// ---------- estilos base ----------
let baseCache: { key: string; styles: Style[] } | null = null;

function readBaseStyles(): Style[] {
  let ids: string[] = [];
  try { ids = fs.readdirSync(BASE_STYLES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort(); } catch { return []; }
  // invalida la caché si cambia cualquier style.json / guide.md
  const key = ids.map((sid) => {
    const d = path.join(BASE_STYLES_DIR, sid);
    const m = (f: string): number => { try { return fs.statSync(path.join(d, f)).mtimeMs; } catch { return 0; } };
    return `${sid}:${m("style.json")}:${m("guide.md")}:${m("demo")}:${m(PREVIEW_VIDEO)}:${m(PREVIEW_POSTER)}`;
  }).join("|");
  if (baseCache && baseCache.key === key) return baseCache.styles;
  const styles: Style[] = [];
  const order = new Map<string, number>(); // style.json "order" (menor primero; sin order: después de los ordenados, por id)
  for (const sid of ids) {
    const d = path.join(BASE_STYLES_DIR, sid);
    const f = path.join(d, "style.json");
    if (!fs.existsSync(f)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(f, "utf8")) as Partial<Style> & { order?: unknown };
      if (typeof raw.order === "number" && Number.isFinite(raw.order)) order.set(sid, raw.order);
      const guideFile = path.join(d, "guide.md");
      const guide = raw.guide || (fs.existsSync(guideFile) ? fs.readFileSync(guideFile, "utf8") : "");
      styles.push({
        id: sid,
        name: raw.name || sid,
        kind: raw.kind && STYLE_KINDS.includes(raw.kind) ? raw.kind : "any",
        origin: "base",
        description: raw.description || "",
        guide,
        tokens: { palette: raw.tokens?.palette || [], fonts: raw.tokens?.fonts || [] },
        captionPreset: raw.captionPreset || undefined,
        files: listFiles(d, isStyleFileList),
        sources: raw.sources || [],
        createdAt: raw.createdAt || "2026-11-01T00:00:00.000Z",
        updatedAt: raw.updatedAt,
      });
    } catch (e) {
      console.warn(`Estilo base ${sid} ilegible: ${(e as Error).message}`);
    }
  }
  // ids ya vienen por orden alfabético y sort es estable: los que no tienen order quedan detrás, por id
  styles.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || 0);
  baseCache = { key, styles };
  return styles;
}

// ---------- lectura ----------
/** Base (solo lectura) + estilos del usuario. Un estilo del usuario con el mismo id que uno base lo oculta. */
export function listStyles(): Style[] {
  const user = load().styles;
  const userIds = new Set(user.map((s) => s.id));
  return [...readBaseStyles().filter((s) => !userIds.has(s.id)), ...user];
}

export function getStyle(sid: string): Style | undefined {
  return load().styles.find((s) => s.id === sid) || readBaseStyles().find((s) => s.id === sid);
}

export function isBase(style: Style): boolean {
  return style.origin === "base";
}

export function summarize(s: Style): StyleSummary {
  const preview = stylePreview(s);
  return { id: s.id, name: s.name, kind: s.kind, origin: s.origin, description: s.description, palette: s.tokens?.palette || [], ...(preview ? { preview } : {}) };
}

/** Para GET /api/state → styles. */
export function styleSummaries(): StyleSummary[] {
  return listStyles().map(summarize);
}

// ---------- escritura (solo estilos del usuario) ----------
export interface NewStyleInput {
  id?: string;
  name: string;
  kind: StyleKind;
  origin: Exclude<StyleOrigin, "base">;
  description: string;
  guide: string;
  tokens?: { palette: string[]; fonts: string[] };
  captionPreset?: string;
  sources?: string[];
}

/** Crea el objeto Style de un estilo nuevo del usuario (sin guardarlo). Su carpeta queda creada. */
export function newUserStyle(input: NewStyleInput): Style {
  const sid = input.id || id();
  userStyleDir(sid);
  return {
    id: sid,
    name: input.name.trim() || "Estilo sin nombre",
    kind: STYLE_KINDS.includes(input.kind) ? input.kind : "any",
    origin: input.origin,
    description: input.description || "",
    guide: input.guide || "",
    tokens: { palette: cleanPalette(input.tokens?.palette || []), fonts: uniq(input.tokens?.fonts || []) },
    captionPreset: input.captionPreset || undefined,
    files: [],
    sources: input.sources || [],
    usedBy: [],
    createdAt: now(),
  };
}

/** Escribe guide.md y style.json en la carpeta del estilo y refresca su lista de archivos. */
export function writeStyleFiles(style: Style): void {
  if (isBase(style)) return;
  const d = userStyleDir(style.id);
  fs.writeFileSync(path.join(d, "guide.md"), style.guide || "");
  const { job: _job, log: _log, ...plain } = style;
  fs.writeFileSync(path.join(d, "style.json"), JSON.stringify({ ...plain, guide: "" }, null, 2));
  style.files = listFiles(d, isStyleFileList);
}

/** Guarda (inserta o reemplaza) un estilo del usuario en la base y en disco. */
export function saveUserStyle(style: Style): Style {
  if (isBase(style)) throw new Error("Los estilos base son de solo lectura. Duplícalo para editarlo.");
  const db = load();
  writeStyleFiles(style);
  const i = db.styles.findIndex((s) => s.id === style.id);
  if (i >= 0) db.styles[i] = style;
  else db.styles.unshift(style);
  save();
  return style;
}

/** Guarda la guía actual en versions/<fecha>.md antes de reescribirla (historial simple en disco). */
export function snapshotGuide(style: Style, note: string): void {
  if (isBase(style) || !style.guide) return;
  const d = path.join(userStyleDir(style.id), "versions");
  fs.mkdirSync(d, { recursive: true });
  const stamp = now().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(d, `${stamp}.md`), `<!-- ${note} -->\n${style.guide}`);
}

export interface StylePatch { name?: unknown; description?: unknown; guide?: unknown; kind?: unknown; captionPreset?: unknown; palette?: unknown; fonts?: unknown }

export function updateStyle(sid: string, patch: StylePatch): Style {
  const s = getStyle(sid);
  if (!s) throw new Error("Estilo no encontrado");
  if (isBase(s)) throw new Error("Los estilos base son de solo lectura. Duplícalo para editarlo.");
  if (typeof patch.guide === "string" && patch.guide !== s.guide) { snapshotGuide(s, "Edición manual"); s.guide = patch.guide; }
  if (typeof patch.name === "string" && patch.name.trim()) s.name = patch.name.trim();
  if (typeof patch.description === "string") s.description = patch.description;
  if (typeof patch.kind === "string") {
    if (!STYLE_KINDS.includes(patch.kind as StyleKind)) throw new Error("Tipo de estilo inválido (reel, clase, talking o any)");
    s.kind = patch.kind as StyleKind;
  }
  if (typeof patch.captionPreset === "string") s.captionPreset = patch.captionPreset || undefined;
  if (Array.isArray(patch.palette)) s.tokens = { ...s.tokens, palette: cleanPalette(patch.palette.map(String)) };
  if (Array.isArray(patch.fonts)) s.tokens = { ...s.tokens, fonts: uniq(patch.fonts.map(String)) };
  s.updatedAt = now();
  return saveUserStyle(s);
}

/** Copia un estilo (base o del usuario) como estilo nuevo del usuario, con todos sus archivos. */
export function duplicateStyle(sid: string, name?: string): Style {
  const src = getStyle(sid);
  if (!src) throw new Error("Estilo no encontrado");
  const copy = newUserStyle({
    name: name || `${src.name} (copia)`,
    kind: src.kind,
    origin: src.origin === "base" ? "importado" : src.origin,
    description: src.description,
    guide: src.guide,
    tokens: structuredClone(src.tokens),
    captionPreset: src.captionPreset,
    sources: src.origin === "base" ? [`base:${src.id}`, ...src.sources] : [...src.sources],
  });
  const from = styleFolder(src);
  const to = userStyleDir(copy.id);
  if (fs.existsSync(from)) {
    fs.cpSync(from, to, { recursive: true, filter: (p) => !path.basename(p).startsWith(".") && path.basename(p) !== "style.json" && path.basename(p) !== "versions" });
  }
  return saveUserStyle(copy);
}

export function deleteStyle(sid: string): void {
  const s = getStyle(sid);
  if (!s) throw new Error("Estilo no encontrado");
  if (isBase(s)) throw new Error("Los estilos base vienen con la app y no se pueden borrar.");
  const db = load();
  db.styles = db.styles.filter((x) => x.id !== sid);
  save();
  const d = path.join(STYLES_DIR, sid);
  // solo borra dentro de data/styles (nunca fuera)
  if (path.dirname(d) === STYLES_DIR && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

/** Marca que un proyecto usó este estilo (solo estilos del usuario; los base no guardan estado). */
export function markUsed(sid: string, projectId: string): void {
  const s = load().styles.find((x) => x.id === sid);
  if (!s) return;
  s.usedBy = uniq([...(s.usedBy || []), projectId]);
  save();
}

/** Ruta absoluta de un archivo del estilo, validando que no se salga de su carpeta. */
export function styleFilePath(style: Style, rel: string): string | null {
  const root = path.resolve(styleFolder(style));
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

// ---------- utilidades ----------
export function uniq(a: string[]): string[] {
  return [...new Set(a.map((x) => String(x).trim()).filter(Boolean))];
}

/** Normaliza colores a #rrggbb en minúsculas, sin repetir. */
export function cleanPalette(a: string[]): string[] {
  const out: string[] = [];
  for (const c of a) {
    const m = String(c).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) continue;
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    if (!out.includes("#" + h)) out.push("#" + h);
  }
  return out.slice(0, 12);
}
