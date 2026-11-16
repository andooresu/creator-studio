// Crear un estilo desde una descripción (+ guía de marca opcional) e iterarlo con feedback.
// También define el esquema de salida y el system prompt que comparten importer.ts y learn.ts.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ask } from "../ai.ts";
import type { ContentBlock } from "../ai.ts";
import { getBrand, load, MOTION_DIR } from "../db.ts";
import { StylePatch, canPatch, mergeGuide } from "./patch.ts";
import { brandToPrompt } from "../brand.ts";
import { newUserStyle, saveUserStyle, duplicateStyle, snapshotGuide, getStyle, cleanPalette, uniq, listStyles, isBase } from "./store.ts";
import type { Style, StyleKind } from "../../shared/types.ts";

export type Step = (msg: string) => void;

/** Lo que la IA devuelve al escribir o reescribir un estilo. */
export const StyleDraft = z.object({
  name: z.string().describe("Nombre corto del estilo en español (2 a 4 palabras), sin nombres de clientes ni marcas"),
  kind: z.enum(["reel", "clase", "talking"]).describe("reel = comercial/motion design; clase = explicador por secciones; talking = persona a cámara"),
  description: z.string().describe("Dos oraciones: qué es y cuándo usarlo"),
  guide: z.string().describe("Guía completa en markdown que seguirá el agente productor para hacer videos NUEVOS en este estilo"),
  palette: z.array(z.string()).describe("Colores en hex #RRGGBB: fondo, tinta, acento (uno solo salvo que el estilo pida más), superficies"),
  fonts: z.array(z.string()).describe("Tipografías (preferir Google Fonts u OFL): display y UI"),
  captionPreset: z.string().describe("Preset de subtítulos de captions/presets.json (p. ej. karaoke-amarillo, pill-sobrio) o cadena vacía si no lleva subtítulos quemados"),
});
export type StyleDraft = z.infer<typeof StyleDraft>;

/** Presets de subtítulos disponibles en el kit (nombre → para qué sirve). */
export function captionPresets(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(MOTION_DIR, "captions", "presets.json"), "utf8")) as Record<string, { _meta?: { useFor?: string } } | string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_") && typeof v === "object") out[k] = v?._meta?.useFor || "";
    return out;
  } catch { return {}; }
}

export function validPreset(p: string | undefined | null): string | undefined {
  if (!p) return undefined;
  return p in captionPresets() ? p : undefined;
}

const readRef = (name: string, max = 12000): string => {
  try { return fs.readFileSync(path.join(MOTION_DIR, "skill", "reference", name), "utf8").slice(0, max); } catch { return ""; }
};

/** Estructura obligatoria de la guía (la usan create, import y learn). */
export const GUIDE_OUTLINE = `La guía (campo "guide") es markdown en español latino neutro, concreta y accionable. El agente productor la sigue al pie de la letra para hacer videos NUEVOS en este estilo con el motor (film.js con C.* y TYPE.*, timeline.json en beats, scripts del kit). Secciones obligatorias, en este orden:
# <nombre del estilo>
## Esencia (3-5 líneas: qué se siente, para qué tipo de video, qué lo hace reconocible)
## Estructura y ritmo (actos o secciones con duraciones en beats; BPM típico; cortes por compás; cada cuánto aparece algo nuevo; holds máximos)
## Vocabulario de movimiento (tabla: movimiento | cómo se ve | cómo construirlo con el motor — nombra las funciones helper a reutilizar si existen, presets de resorte heavy/default/snappy, spHit en lo que suena)
## Tipografía (roles display/UI, peso, tamaño respecto al cuadro, alineación, regla del acento, mínimo legible)
## Color (rol de cada color: fondo, tinta, acento, campos; cómo cambian por escena)
## Subtítulos (preset y ajustes, o por qué no lleva)
## Transiciones (catálogo con timing en beats)
## Sonido y música (género, BPM, energía por tramo, SFX y en qué momentos, mezcla)
## Voz en off (si aplica: tono, ritmo, cómo se coloca por frases en beats)
## Formatos (cómo se re-bloquea 9:16 / 1:1 / 16:9; zonas seguras)
## Reglas recurrentes y prohibiciones (lista)
## Qué revisa el crítico (lista verificable, frame a frame)
Nunca incluyas nombres de clientes, marcas reales ni datos personales de nadie: describe la gramática, no el contenido.`;

export function styleSystem(): string {
  const presets = Object.entries(captionPresets()).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return `Eres director de motion design senior y escribes guías de estilo para un motor de video programático (películas deterministas en HTML: cada frame es función del tiempo, todo sincronizado al grid de beats medido). Escribes en español latino neutro.
Tu guía la ejecuta un agente productor que ya conoce el método (skill motion-reel: entrevista, música, shotlist, voz, película, crítica, render). Tu trabajo es capturar el ESTILO: gramática visual y sonora, ritmo, tipografía, color, transiciones, reglas. Sé específico con números (beats, px a 1080p, escalas, presets de resorte) y con los nombres de funciones del motor y helpers disponibles.

REGLAS DE LA CASA (resumen del kit; respétalas salvo que el material del estilo diga lo contrario de forma explícita):
${readRef("RULES.md", 9000)}

VOCABULARIO DE MOVIMIENTO DE LA CASA (referencia):
${readRef("MOTION_VOCAB.md", 6000)}

PRESETS DE SUBTÍTULOS DISPONIBLES:
${presets || "- pill-sobrio\n- karaoke-amarillo"}

${GUIDE_OUTLINE}`;
}

/** Una guía base del mismo tipo, como ejemplo de formato y profundidad. */
function exampleGuide(kind: StyleKind): string {
  const base = listStyles().filter(isBase);
  const s = base.find((x) => x.kind === kind) || base[0];
  return s ? `EJEMPLO DE GUÍA (estilo base "${s.name}", solo como referencia de formato y profundidad; no lo copies):\n${s.guide.slice(0, 9000)}` : "";
}

export function applyDraft(style: Style, d: StyleDraft, opts: { keepName?: boolean; keepKind?: boolean } = {}): void {
  if (!opts.keepName && d.name.trim()) style.name = d.name.trim();
  if (!opts.keepKind) style.kind = d.kind;
  style.description = d.description;
  style.guide = d.guide;
  const pal = cleanPalette(d.palette);
  if (pal.length) style.tokens = { ...style.tokens, palette: pal };
  const fonts = uniq(d.fonts);
  if (fonts.length) style.tokens = { ...style.tokens, fonts };
  const preset = validPreset(d.captionPreset);
  style.captionPreset = preset;
}

// ---------- crear desde descripción ----------
export async function createStyle(input: { name: string; kind: StyleKind; description: string; brandId?: string | null }, step: Step): Promise<Style> {
  const content: ContentBlock[] = [];
  let brandText = "";
  if (input.brandId) {
    const b = getBrand(input.brandId);
    if (b && b.id === input.brandId) brandText = brandToPrompt(b);
  }
  // la guía de ejemplo es igual para cada tipo de video: va en su propio bloque con punto de caché
  content.push({ type: "text", text: exampleGuide(input.kind === "any" ? "reel" : input.kind), cache: true });
  content.push({ type: "text", text: `PEDIDO DEL USUARIO
Nombre propuesto: ${input.name || "(elige tú uno corto)"}
Tipo de video: ${input.kind}
Descripción del estilo que quiere: ${input.description}
${brandText ? `\nGUÍA DE MARCA (úsala para paleta, tipografías, voz y prohibiciones; el estilo debe poder reutilizarse con esta marca):\n${brandText}\n` : ""}
Escribe el estilo completo. Si la descripción es vaga, toma decisiones con criterio y coherencia con las reglas de la casa, y explícalas en la guía.` });
  step("La IA está escribiendo la guía del estilo…");
  // después suele venir una vuelta de feedback dentro de la hora: caché de 1 hora
  const d = await ask({ stage: "estilos", system: styleSystem(), content, schema: StyleDraft, maxTokens: 32000, cacheTtl: "1h" });
  const style = newUserStyle({ name: input.name || d.name, kind: input.kind, origin: "ia", description: d.description, guide: d.guide, sources: input.brandId ? [`marca:${input.brandId}`] : [] });
  applyDraft(style, d, { keepName: Boolean(input.name), keepKind: input.kind !== "any" });
  step("Guardando el estilo…");
  return saveUserStyle(style);
}

// ---------- iterar con feedback ----------
/** Pide solo las secciones que cambian y las mezcla con la guía actual (Ajustes → IA → «Iterar estilos por secciones»). */
async function iterateBySections(target: Style, content: ContentBlock[]): Promise<StyleDraft> {
  const p = await ask({ stage: "estilos", system: styleSystem(), content, schema: StylePatch, maxTokens: 16000, cacheTtl: "1h" });
  const merged = mergeGuide(target.guide, p.sections);
  // Un reemplazo que no encontró su sección dejaría dos secciones del mismo tema: no se guarda nada.
  const lost = p.sections.filter((s) => s.action === "replace" && merged.unmatched.includes(s.heading.replace(/^#+\s*/, "").trim()));
  if (lost.length) throw new Error(`La IA cambió una sección que no existe en la guía («${lost[0].heading}»). No se guardó nada; reintenta o desactiva «Iterar estilos por secciones» en Ajustes.`);
  if (!merged.changed.length && !p.description.trim() && !p.palette.length && !p.fonts.length && !p.captionPreset.trim()) {
    throw new Error("La IA no propuso cambios para ese feedback. Prueba a ser más específico.");
  }
  const preset = p.captionPreset.trim();
  return {
    name: target.name,
    kind: target.kind === "any" ? "reel" : target.kind,
    description: p.description.trim() || target.description,
    guide: merged.guide,
    palette: p.palette.length ? p.palette : target.tokens.palette,
    fonts: p.fonts.length ? p.fonts : target.tokens.fonts,
    // solo un preset válido o "ninguno" cambia los subtítulos; cualquier otro texto se toma como "sin cambio"
    captionPreset: preset.toLowerCase() === "ninguno" ? "" : preset && validPreset(preset) ? preset : target.captionPreset || "",
  };
}

/** Reescribe la guía con el feedback. Si el estilo es base, primero lo duplica (los base son de solo lectura). */
export async function iterateStyle(style: Style, feedback: string, step: Step, opts: { onTarget?: (id: string) => void } = {}): Promise<Style> {
  let target = style;
  if (isBase(style)) {
    step("Los estilos base no se modifican: creando una copia para ajustarla…");
    target = duplicateStyle(style.id);
  }
  opts.onTarget?.(target.id);
  const helpers = target.files.filter((f) => /\.js$/.test(f));
  const sections = load().settings.styleIterateSections && canPatch(target.guide);
  const content: ContentBlock[] = [{ type: "text", text: `ESTILO ACTUAL
Nombre: ${target.name}
Tipo: ${target.kind}
Descripción: ${target.description}
Paleta: ${target.tokens.palette.join(", ") || "-"}
Tipografías: ${target.tokens.fonts.join(", ") || "-"}
Subtítulos: ${target.captionPreset || "ninguno"}
Archivos del estilo (helpers y ejemplos que la guía puede citar): ${helpers.join(", ") || "ninguno"}

GUÍA ACTUAL:
${target.guide}

FEEDBACK DEL USUARIO (aplícalo con precisión; conserva todo lo que no menciona):
${feedback}

${sections
    ? "Devuelve SOLO las secciones ## que cambian: en «heading» el título copiado exacto de la guía actual (sin los ##) y en «body» la sección completa sin repetir el título. No repitas las que quedan igual. Si una regla nueva no encaja en ninguna sección, agrégala a la que corresponda (replace), no crees secciones sueltas salvo que el feedback lo pida."
    : "Devuelve el estilo completo actualizado (la guía entera, no solo el cambio)."}` }];
  step("La IA está ajustando el estilo con tu feedback…");
  // entre vueltas de feedback el usuario suele tardar más de 5 min: caché de 1 hora para el prompt de la casa
  const d: StyleDraft = sections
    ? await iterateBySections(target, content)
    : await ask({ stage: "estilos", system: styleSystem(), content, schema: StyleDraft, maxTokens: 32000, cacheTtl: "1h" });
  // se relee después de la IA: si lo borraron mientras tanto, no se resucita
  const fresh = getStyle(target.id);
  if (!fresh) throw new Error("El estilo se borró mientras se iteraba. No se guardó ningún cambio.");
  snapshotGuide(fresh, `Antes de: ${feedback.slice(0, 120)}`);
  applyDraft(fresh, d, { keepName: true, keepKind: true });
  fresh.updatedAt = new Date().toISOString();
  step("Guardando la nueva versión…");
  return saveUserStyle(fresh);
}
