// Preset de marca para el scaffold del motor (solo carpeta nueva): colores de la guía de marca por rol → film/index.html
// (vía motion/scripts/preset.mjs), acento de subtítulos → timeline.json captions y logo → assets/brand/logo.<ext>.
// La marca no trae roles estructurados: se deducen de `uso`/`nombre` de cada color y, si falta alguno, por luminancia.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MOTION_DIR } from "../db.ts";
import { captionPresetNameSet, canonicalCaptionPreset } from "../styles/captionPresets.ts";
import { activeBrand } from "./prompt.ts";
import type { StartFlags } from "./prompt.ts";
import type { Brand, Project, Style } from "../../shared/types.ts";
import type { BrandGuide } from "../../shared/schemas.ts";

export type ColorRole = "bg" | "ink" | "ink2" | "accent" | "card";
export type BrandColors = Partial<Record<ColorRole, string>>;

export interface BrandPreset {
  /** carpeta temporal con preset.jsonc (se borra con cleanup) */
  presetDir: string;
  /** se mezcla en timeline.json después del preset y antes de sync.mjs */
  timelinePatch: Record<string, unknown>;
  /** archivos a copiar dentro de la carpeta del motor (rel: relativo a ella) */
  extraFiles: { from: string; rel: string }[];
  colors: BrandColors;
  /** acento de subtítulos aplicado (si hubo) */
  accent?: string;
  cleanup(): void;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Hex válido normalizado a #rrggbb en minúsculas, o null. */
export function validHex(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!HEX.test(s)) return null;
  const h = s.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
/** Luminancia relativa (WCAG). */
function luminance(hex: string): number {
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Saturación HSL. */
function saturation(hex: string): number {
  const [r, g, b] = rgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn);
}

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ROLE_WORDS: [ColorRole, RegExp][] = [
  ["bg", /\b(fondo|fondos|background|bg)\b/g],
  ["ink", /\b(texto|textos|titular|titulares|tinta|principal)\b/g],
  ["ink2", /\b(secundario|secundaria|cuerpo)\b/g],
  ["accent", /\b(acento|acentos|cta|boton|botones|destacado|destacados|destacar)\b/g],
  ["card", /\b(tarjeta|tarjetas|superficie|superficies|panel|paneles)\b/g],
];

/** Rol de un color por palabras clave en su uso/nombre: gana la palabra que aparece primero (secundario manda sobre texto). */
function roleOf(text: string): ColorRole | null {
  const t = norm(text);
  let best: { role: ColorRole; at: number } | null = null;
  for (const [role, re] of ROLE_WORDS) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { role, at: m.index };
  }
  if (best?.role === "ink" && /\b(secundario|secundaria|cuerpo)\b/.test(t)) return "ink2";
  return best?.role ?? null;
}

/** Contraste WCAG entre dos colores (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Mezcla lineal en sRGB: t = 0 → a, t = 1 → b. */
function mix(a: string, b: string, t: number): string {
  const [ra, rb] = [rgb(a), rgb(b)];
  return "#" + ra.map((c, i) => Math.round((c + (rb[i] - c) * t) * 255).toString(16).padStart(2, "0")).join("");
}
/** Fondo de la plantilla del motor (motion/engine/index.html) cuando la marca no define uno. */
const TEMPLATE_BG = "#f6f5f1";
const WHITE = "#ffffff", NEAR_BLACK = "#111111";

/**
 * Colores de la guía de marca por rol (solo hex válidos). Si la marca trae algún color, deja los cinco roles con texto
 * legible sobre el fondo: lo que el preset no reemplaza queda con el valor de la plantilla (tema claro), que sobre un
 * fondo oscuro de marca sería ilegible. El acento se elige antes que el texto para que el texto no se lleve el color
 * más saturado; si ningún color de la paleta da contraste suficiente, el texto es blanco o casi negro según el fondo.
 */
export function brandColors(guide: BrandGuide | null | undefined): BrandColors {
  const list = (guide?.visual?.paleta || [])
    .map((c) => ({ hex: validHex(c?.hex), text: `${c?.uso || ""} ${c?.nombre || ""}` }))
    .filter((c): c is { hex: string; text: string } => Boolean(c.hex));
  const out: BrandColors = {};
  const used = new Set<string>();
  // 1) por palabras clave: uso primero (más específico), luego nombre
  for (const c of list) {
    const role = roleOf(c.text);
    if (role && !out[role]) { out[role] = c.hex; used.add(c.hex); }
  }
  if (!list.length) return out;
  const byKeyword = new Set(Object.keys(out));
  // 2) por luminancia: oscuro o claro según el fondo/texto conocidos o, si no, la luminancia media de la paleta
  const dark = out.bg ? luminance(out.bg) < 0.4 : out.ink ? luminance(out.ink) > 0.4 : list.reduce((a, c) => a + luminance(c.hex), 0) / list.length < 0.4;
  const free = (): string[] => list.map((c) => c.hex).filter((h) => !used.has(h));
  const take = (role: ColorRole, pick: (hs: string[]) => string | undefined): void => {
    if (out[role]) return;
    const h = pick(free());
    if (h) { out[role] = h; used.add(h); }
  };
  const byLum = (hs: string[]): string[] => [...hs].sort((a, b) => luminance(a) - luminance(b));
  take("bg", (hs) => (dark ? byLum(hs)[0] : byLum(hs).at(-1)));
  if (!out.bg) out.bg = out.ink && luminance(out.ink) > 0.4 ? NEAR_BLACK : TEMPLATE_BG;
  const bg = out.bg;
  // 3) acento: el más saturado que se distinga del fondo (si ninguno, queda el de la plantilla)
  take("accent", (hs) => hs.filter((h) => contrast(h, bg) >= 3).sort((a, b) => saturation(b) - saturation(a))[0]);
  // 4) texto: el color libre con más contraste (≥ 4.5) o, si no hay, blanco / casi negro
  const inkMin = byKeyword.has("ink") ? 3 : 4.5;
  if (out.ink && contrast(out.ink, bg) < inkMin) { used.delete(out.ink); delete out.ink; }
  take("ink", (hs) => hs.filter((h) => contrast(h, bg) >= 4.5).sort((a, b) => contrast(b, bg) - contrast(a, bg))[0]);
  if (!out.ink) out.ink = contrast(WHITE, bg) >= contrast(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
  const ink = out.ink;
  // 5) texto secundario y tarjeta derivados (los de la plantilla son de tema claro)
  if (!out.ink2 || contrast(out.ink2, bg) < 3) out.ink2 = mix(ink, bg, 0.3);
  if (!out.card) out.card = luminance(bg) < 0.4 ? mix(bg, ink, 0.1) : WHITE;
  else if (contrast(out.card, ink) < 3 && !byKeyword.has("card")) out.card = luminance(bg) < 0.4 ? mix(bg, ink, 0.1) : WHITE;
  return out;
}

/** Nombres de los presets de subtítulos del kit (motion/captions/presets.json), incluidos los alias de nombres viejos. */
export function captionPresetNames(): Set<string> {
  return captionPresetNameSet();
}

/** Acento de subtítulos: concepto aprobado → acento de la marca → paleta[2] del estilo → ninguno (queda el del preset). */
export function captionAccent(p: Project, brand: Brand | null, style: Style | null | undefined): string | undefined {
  if (brand) {
    const c = p.conceptApproved ? validHex(p.concept?.subtitulos?.colorAcento) : null;
    if (c) return c;
    const a = brandColors(brand.guide).accent;
    if (a) return a;
  }
  return validHex(style?.tokens?.palette?.[2]) ?? undefined;
}

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"]);
/** Primer archivo de imagen de la marca cuyo nombre dice «logo» (existente en disco). */
export function brandLogo(brand: Brand): { file: string; ext: string } | null {
  for (const s of brand.sources || []) {
    if (s.type !== "image" || !/logo/i.test(s.name || "")) continue;
    if (!s.file || !fs.existsSync(s.file)) continue;
    const ext = [path.extname(s.name || ""), path.extname(s.file)].map((e) => e.toLowerCase()).find((e) => IMG_EXT.has(e));
    if (!ext) continue;
    return { file: s.file, ext };
  }
  return null;
}

const joinShort = (xs: (string | undefined | null)[], max = 6): string => xs.map((x) => String(x || "").trim()).filter(Boolean).slice(0, max).join("; ");

/**
 * Preset de marca para un scaffold nuevo. null si no aplica marca (sin guía real o useBrand false).
 * Escribe preset.jsonc en una carpeta temporal (os.tmpdir()/creator-studio-preset-<pid>-<rand>); llamar cleanup() al terminar.
 * Sin fuentes: la marca solo trae nombres (no archivos), así que las tipografías las resuelve el productor.
 */
export function brandPresetFor(p: Project, flags: StartFlags | undefined, style: Style | null | undefined): BrandPreset | null {
  if (flags?.useBrand === false) return null;
  const brand = activeBrand(p, flags);
  if (!brand) return null;
  const g = brand.guide;
  const colors = brandColors(g);
  const preset = {
    name: `Marca: ${brand.name || g?.nombre || "sin nombre"}`,
    brand: Object.fromEntries(Object.entries({
      product: g?.nombre || brand.name || "",
      promise: g?.esencia?.propuesta || "",
      audience: g?.audiencia?.perfil || "",
      cta: g?.ctas?.[0] || "",
      must_avoid: joinShort([...(g?.noHacer || []), ...(g?.voz?.evitar || [])], 10),
    }).filter(([, v]) => v)),
    colors,
  };
  const accent = captionAccent(p, brand, style);
  const known = captionPresetNames();
  const captions: Record<string, unknown> = {};
  // un estilo guardado con un nombre viejo (karaoke-amarillo) sigue valiendo: se escribe el nombre canónico (karaoke)
  if (style?.captionPreset && known.has(style.captionPreset)) captions.preset = canonicalCaptionPreset(style.captionPreset) || style.captionPreset;
  if (accent) captions.accent = accent;
  const logo = brandLogo(brand);

  const presetDir = fs.mkdtempSync(path.join(os.tmpdir(), `creator-studio-preset-${path.basename(p.id)}-`));
  try {
    fs.writeFileSync(path.join(presetDir, "preset.jsonc"), `// Preset generado por la app desde la guía de marca\n${JSON.stringify(preset, null, 2)}\n`);
  } catch (e) {
    fs.rmSync(presetDir, { recursive: true, force: true });
    throw e;
  }
  return {
    presetDir,
    timelinePatch: Object.keys(captions).length ? { captions } : {},
    extraFiles: logo ? [{ from: logo.file, rel: path.join("assets", "brand", `logo${logo.ext}`) }] : [],
    colors,
    ...(accent ? { accent } : {}),
    cleanup: () => { try { fs.rmSync(presetDir, { recursive: true, force: true }); } catch {} },
  };
}

/** true si la carpeta del motor se preparó con el preset de marca (preset.json lo deja preset.mjs). */
export function brandPresetApplied(dir: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "preset.json"), "utf8")) as { name?: string; colors?: Record<string, unknown> };
    // sin colores válidos el preset no tocó film/index.html: los colores siguen siendo los de la plantilla
    const hasColors = Object.values(raw.colors || {}).some((v) => validHex(v));
    return typeof raw.name === "string" && raw.name.startsWith("Marca:") && hasColors;
  } catch { return false; }
}

/** true si el scaffold dejó un logo de marca en assets/brand/. */
export function brandLogoInDir(dir: string): boolean {
  try { return fs.readdirSync(path.join(dir, "assets", "brand")).some((f) => /^logo\./i.test(f)); } catch { return false; }
}
