// Importa estilos desde proyectos motion-reel existentes: UNA carpeta de proyecto o una carpeta con VARIOS.
// Varios proyectos se agrupan en familias por prefijo del slug; de cada familia se extrae (sin IA) el material
// que define el estilo, se copia a data/styles/<id>/ y luego la IA escribe nombre, tipo, descripción y guía.
import fs from "node:fs";
import path from "node:path";
import { ask, hasKey } from "../ai.ts";
import type { ContentBlock } from "../ai.ts";
import { newUserStyle, saveUserStyle, userStyleDir, cleanPalette, uniq } from "./store.ts";
import { StyleDraft, styleSystem, applyDraft, validPreset } from "./create.ts";
import { sourceRender, renderStylePreview, refreshFiles } from "./preview.ts";
import type { Step } from "./create.ts";
import type { Style, StyleKind } from "../../shared/types.ts";

// ---------- detección de proyectos ----------
const ENGINE_FILES = new Set(["core.js", "type.js", "data.js", "words.js", "film.js"]);
const SKIP_DIRS = new Set(["node_modules", ".venv", "renders", "review", "audio", "assets", "film", "scripts", "docs", "refs"]);

export function isMotionProject(dir: string): boolean {
  return fs.existsSync(path.join(dir, "film", "film.js")) && (fs.existsSync(path.join(dir, "brief.md")) || fs.existsSync(path.join(dir, "timeline.json")));
}

function subdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".") && !e.name.startsWith("_") && !SKIP_DIRS.has(e.name))
      .map((e) => path.join(dir, e.name))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  } catch { return []; }
}

/** Proyectos dentro de la carpeta: ella misma, sus hijas o (si no hay) sus nietas. */
export function findProjects(root: string): string[] {
  if (isMotionProject(root)) return [root];
  let found = subdirs(root).filter(isMotionProject);
  if (!found.length) found = subdirs(root).flatMap(subdirs).filter(isMotionProject);
  return found.sort();
}

// ---------- familias por prefijo de slug ----------
const tokensOf = (slug: string): string[] => slug.toLowerCase().split(/[-_\s.]+/).filter(Boolean);

/** Tokens hasta el primero que lleva dígitos ("curso-clase-1-1-x" → ["curso","clase"]). */
function baseTokens(slug: string): string[] {
  const t = tokensOf(slug);
  const i = t.findIndex((x) => /\d/.test(x));
  const b = i < 0 ? t : t.slice(0, i);
  return b.length ? b : t.slice(0, 1);
}

function commonPrefix(lists: string[][]): string[] {
  if (!lists.length) return [];
  const out: string[] = [];
  for (let i = 0; i < lists[0].length; i++) {
    const v = lists[0][i];
    if (lists.every((l) => l[i] === v)) out.push(v);
    else break;
  }
  return out;
}

export interface Family { slug: string; projects: string[] }

/**
 * Agrupa por primer token del slug y nombra la familia con el prefijo común (antes del primer número).
 * "curso-clase-1-1-x" + "curso-clase-2-3-y" → "curso-clase"; "brandx-a-reel" + "brandx-b-reel" → "brandx".
 */
export function groupFamilies(projects: string[]): Family[] {
  const byFirst = new Map<string, string[]>();
  for (const p of projects) {
    const first = tokensOf(path.basename(p))[0] || path.basename(p);
    byFirst.set(first, [...(byFirst.get(first) || []), p]);
  }
  const fams: Family[] = [];
  const push = (first: string, list: string[]) => {
    const pref = list.length === 1 ? baseTokens(path.basename(list[0])) : commonPrefix(list.map((p) => baseTokens(path.basename(p))));
    fams.push({ slug: (pref.length ? pref : [first]).join("-"), projects: list.sort() });
  };
  for (const [first, list] of byFirst) {
    // Un prefijo de dos partes con 3+ proyectos es una serie propia ("curso-clase-*" aparte de "curso-*-reel")
    const bySecond = new Map<string, string[]>();
    for (const p of list) {
      const t = tokensOf(path.basename(p));
      const key = t.length > 1 && !/\d/.test(t[1]) ? `${t[0]}-${t[1]}` : t[0];
      bySecond.set(key, [...(bySecond.get(key) || []), p]);
    }
    const series = [...bySecond.entries()].filter(([k, l]) => k.includes("-") && l.length >= 3);
    if (list.length >= 4 && series.length && series.reduce((n, [, l]) => n + l.length, 0) < list.length) {
      const inSeries = new Set(series.flatMap(([, l]) => l));
      for (const [, l] of series) push(first, l);
      push(first, list.filter((p) => !inSeries.has(p)));
    } else push(first, list);
  }
  return fams.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ---------- extracción determinista ----------
const read = (f: string): string => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const readJson = (f: string): Record<string, unknown> | null => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

/** Sección "## Rules" (o "## Reglas") de brief.md: sus viñetas. */
export function briefRules(md: string): string[] {
  const m = md.match(/^##\s*(rules|reglas)\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!m) return [];
  return m[2].split("\n").map((l) => l.trim()).filter((l) => /^[-*]\s*\S/.test(l)).map((l) => l.replace(/^[-*]\s*/, "").trim()).filter((l) => l.length > 1);
}

export interface FontFace { family: string; src: string; weight?: string }
export interface HtmlTokens { vars: Record<string, string>; fonts: FontFace[] }

/** Variables CSS de :root y @font-face de film/index.html. */
export function htmlTokens(html: string): HtmlTokens {
  const vars: Record<string, string> = {};
  for (const block of html.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of block[1].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) vars[d[1]] = d[2].trim();
  }
  const fonts: FontFace[] = [];
  for (const ff of html.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = ff[1];
    const family = body.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i)?.[1]?.trim() || "";
    const src = body.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1]?.trim() || "";
    const weight = body.match(/font-weight\s*:\s*([^;]+)/i)?.[1]?.trim();
    if (family || src) fonts.push({ family, src, weight });
  }
  return { vars, fonts };
}

export interface TimelineInfo { slug: string; title?: string; bpm?: number; duration?: number; fps?: number; formats?: string[]; captions?: { preset?: string; formats?: string[]; [k: string]: unknown } | null; mix?: unknown; music?: string; voiceover: boolean; marks?: number; sfx?: number }

export function timelineInfo(slug: string, tl: Record<string, unknown> | null): TimelineInfo {
  if (!tl) return { slug, voiceover: false };
  const music = tl.music as { source?: string } | undefined;
  const cap = tl.captions as TimelineInfo["captions"];
  return {
    slug,
    title: typeof tl.title === "string" ? tl.title : undefined,
    bpm: typeof tl.bpm === "number" ? tl.bpm : undefined,
    duration: typeof tl.duration === "number" ? tl.duration : undefined,
    fps: typeof tl.fps === "number" ? tl.fps : undefined,
    formats: Array.isArray(tl.formats) ? (tl.formats as string[]) : undefined,
    captions: cap && typeof cap === "object" ? cap : null,
    mix: tl.mix,
    music: music?.source,
    voiceover: Boolean(tl.voiceover),
    marks: tl.marks && typeof tl.marks === "object" ? Object.keys(tl.marks).length : undefined,
    sfx: Array.isArray(tl.sfx) ? tl.sfx.length : undefined,
  };
}

/** film/*.js propios del proyecto (no del motor). */
function helperFiles(project: string): string[] {
  const dir = path.join(project, "film");
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js") && !ENGINE_FILES.has(f)).map((f) => path.join(dir, f));
  } catch { return []; }
}

function fileSize(f: string): number { try { return fs.statSync(f).size; } catch { return 0; } }

export interface FamilyMaterial {
  slug: string;
  projects: string[];
  examples: string[];
  rules: string[];
  styleGuide: { slug: string; text: string } | null;
  timelines: TimelineInfo[];
  tokens: HtmlTokens;
  palette: string[];
  fonts: string[];
  captionPreset?: string;
  helpers: string[];
  files: string[];
  /** Ruta del proyecto → slug único dentro de la familia (carpetas de examples/ y sufijos de helpers). */
  slugs: Record<string, string>;
}

const copy = (from: string, to: string): boolean => {
  try { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); return true; } catch { return false; }
};
const safeName = (s: string): string => s.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "x";

function commonDir(paths: string[]): string {
  if (!paths.length) return "";
  const parts = paths.map((p) => path.resolve(p).split(path.sep));
  const out: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    if (parts.every((x) => x[i] === parts[0][i])) out.push(parts[0][i]);
    else break;
  }
  return out.join(path.sep) || path.sep;
}

/**
 * Un slug único por proyecto: el nombre de su carpeta; si otro proyecto de la familia ya lo usa (mismo nombre
 * bajo padres distintos), su ruta relativa al ancestro común ("clienteA-promo-reel"); y si aún choca, -2, -3…
 */
export function uniqueSlugs(projects: string[]): Record<string, string> {
  const base = (p: string): string => safeName(path.basename(p));
  const count = new Map<string, number>();
  for (const p of projects) count.set(base(p), (count.get(base(p)) || 0) + 1);
  const root = commonDir(projects.map((p) => path.dirname(p)));
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const p of [...projects].sort()) {
    let slug = base(p);
    if ((count.get(slug) || 0) > 1) slug = safeName(path.relative(root, p).split(path.sep).join("-")) || slug;
    let cand = slug;
    for (let k = 2; used.has(cand.toLowerCase()); k++) cand = `${slug}-${k}`;
    used.add(cand.toLowerCase());
    out[p] = cand;
  }
  return out;
}

/** Extrae y copia el material de una familia a outDir (rutas relativas en files). Sin IA. */
export function extractFamily(fam: Family, outDir: string, step: Step = () => {}): FamilyMaterial {
  // representativos: los 3 film.js más completos
  const examples = [...fam.projects].sort((a, b) => fileSize(path.join(b, "film", "film.js")) - fileSize(path.join(a, "film", "film.js"))).slice(0, 3);
  const files: string[] = [];
  const add = (rel: string): void => { if (!files.includes(rel)) files.push(rel); };
  const slugs = uniqueSlugs(fam.projects);
  const slugOf = (p: string): string => slugs[p] || safeName(path.basename(p));

  // reglas del brief (todas las del grupo, sin repetir)
  const rules = uniq(fam.projects.flatMap((p) => briefRules(read(path.join(p, "brief.md")))));

  // guía de estilo: la primera que exista, priorizando los representativos
  let styleGuide: FamilyMaterial["styleGuide"] = null;
  for (const p of [...examples, ...fam.projects]) {
    const t = read(path.join(p, "docs", "style_guide.md"));
    if (t.trim()) { styleGuide = { slug: slugOf(p), text: t }; break; }
  }
  if (styleGuide) { fs.writeFileSync(path.join(outDir, "style_guide.md"), styleGuide.text); add("style_guide.md"); }

  // timelines
  const timelines = fam.projects.map((p) => timelineInfo(slugOf(p), readJson(path.join(p, "timeline.json"))));
  // nombre canónico antes de contar (karaoke-amarillo y karaoke son el mismo look); los desconocidos quedan tal cual
  const presets = timelines.map((t) => t.captions?.preset).filter((x): x is string => Boolean(x)).map((x) => validPreset(x) ?? x);
  const captionPreset = presets.sort((a, b) => presets.filter((x) => x === b).length - presets.filter((x) => x === a).length)[0];

  // tokens y fuentes (del primer representativo con index.html)
  let tokens: HtmlTokens = { vars: {}, fonts: [] };
  const fontNames: string[] = [];
  for (const p of examples) {
    const htmlFile = path.join(p, "film", "index.html");
    const html = read(htmlFile);
    if (!html) continue;
    tokens = htmlTokens(html);
    if (copy(htmlFile, path.join(outDir, "film", "index.html"))) add("film/index.html");
    for (const f of tokens.fonts) {
      if (!f.src || /^(https?:|data:)/.test(f.src)) { if (f.family) fontNames.push(f.family); continue; }
      const abs = path.resolve(path.dirname(htmlFile), f.src);
      if (!/\.(woff2?|ttf|otf)$/i.test(abs) || !fs.existsSync(abs)) continue;
      // misma estructura que el proyecto: film/index.html → ../assets/fonts/x
      const rel = path.relative(path.join(p, "film"), abs).split(path.sep).join("/");
      const dest = /^\.\.\/assets\/[^.]/.test(rel) && !rel.slice(3).includes("../") ? rel.slice(3) : `assets/fonts/${path.basename(abs)}`;
      if (copy(abs, path.join(outDir, dest))) add(dest);
      fontNames.push(`${f.family || "?"} = ${path.basename(abs).replace(/\.(woff2?|ttf|otf)$/i, "")}`);
    }
    break;
  }
  const palette = cleanPalette(Object.values(tokens.vars).flatMap((v) => v.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []));
  const fonts = uniq(fontNames.map((f) => f.includes(" = ") ? f.split(" = ")[1] : f));

  // film.js de ejemplo + shotlist de uno
  for (const p of examples) {
    const slug = slugOf(p);
    if (copy(path.join(p, "film", "film.js"), path.join(outDir, "examples", slug, "film.js"))) add(`examples/${slug}/film.js`);
  }
  for (const p of examples) {
    const f = path.join(p, "docs", "shotlist.md");
    if (read(f).trim()) {
      const slug = slugOf(p);
      if (copy(f, path.join(outDir, "examples", slug, "shotlist.md"))) add(`examples/${slug}/shotlist.md`);
      break;
    }
  }

  // helpers propios (film/*.js fuera del motor), sin repetir contenido; si dos proyectos tienen el mismo nombre
  // con distinto contenido, se sufija con el slug único del proyecto (y -2, -3… si aún choca). Nunca se pisa un archivo ya copiado.
  const helpers: string[] = [];
  const bodies = new Map<string, Set<string>>(); // nombre → contenidos ya copiados
  const taken = new Set<string>();
  for (const p of [...examples, ...fam.projects.filter((x) => !examples.includes(x))]) {
    for (const h of helperFiles(p)) {
      const name = path.basename(h);
      const body = read(h);
      const known = bodies.get(name) || new Set<string>();
      if (known.has(body)) continue;
      let destName = known.size ? name.replace(/\.js$/, `.${slugOf(p)}.js`) : name;
      for (let k = 2; taken.has(destName) || fs.existsSync(path.join(outDir, "helpers", destName)); k++) {
        destName = name.replace(/\.js$/, `.${slugOf(p)}-${k}.js`);
      }
      known.add(body);
      bodies.set(name, known);
      taken.add(destName);
      const rel = `helpers/${destName}`;
      if (copy(h, path.join(outDir, "helpers", destName)) && !helpers.includes(rel)) { add(rel); helpers.push(rel); }
    }
  }
  step(`Familia "${fam.slug}": ${fam.projects.length} proyecto(s), ${helpers.length} helper(s), ${files.length} archivo(s) copiados`);

  const material: FamilyMaterial = { slug: fam.slug, projects: fam.projects, examples, rules, styleGuide, timelines, tokens, palette, fonts, captionPreset, helpers, files, slugs };
  // registro de lo extraído (útil para el agente y para depurar)
  fs.writeFileSync(path.join(outDir, "extract.json"), JSON.stringify({ ...material, styleGuide: material.styleGuide ? { slug: material.styleGuide.slug } : null, projects: material.projects.map(slugOf), examples: material.examples.map(slugOf), slugs: undefined }, null, 2));
  add("extract.json");
  return material;
}

// ---------- IA: nombre, tipo, descripción y guía ----------
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + `\n/* … recortado (${s.length - n} caracteres más) */` : s);

export function materialToContent(m: FamilyMaterial, outDir: string): ContentBlock[] {
  const tl = m.timelines.map((t) => `- ${t.slug}: ${t.duration ?? "?"} s · ${t.bpm ?? "?"} BPM · ${t.fps ?? "?"} fps · formatos ${(t.formats || []).join("/") || "?"} · subtítulos ${t.captions ? JSON.stringify(t.captions) : "no"} · música ${t.music || "?"} · VO ${t.voiceover ? "sí" : "no"} · mezcla ${t.mix ? JSON.stringify(t.mix) : "-"} · ${t.marks ?? "?"} marcas · ${t.sfx ?? "?"} SFX`).join("\n");
  const vars = Object.entries(m.tokens.vars).map(([k, v]) => `${k}: ${v}`).join("; ");
  const ff = m.tokens.fonts.map((f) => `${f.family} → ${path.basename(f.src)}${f.weight ? ` (${f.weight})` : ""}`).join("; ");
  const blocks: ContentBlock[] = [{ type: "text", text: `MATERIAL EXTRAÍDO DE UNA FAMILIA DE ${m.projects.length} PROYECTO(S) DEL MOTOR (slug base "${m.slug}")

REGLAS DE LOS BRIEFS (verbatim, sin repetir):
${m.rules.map((r) => "- " + r).join("\n") || "(ninguna)"}

TIMELINES:
${tl}

TOKENS DE film/index.html (:root): ${vars || "(ninguno)"}
@font-face: ${ff || "(ninguna)"}
Paleta detectada: ${m.palette.join(", ") || "-"}
Preset de subtítulos más usado: ${m.captionPreset || "ninguno"}

ARCHIVOS COPIADOS A LA CARPETA DEL ESTILO (el agente los encontrará en docs/style/ del proyecto nuevo; cítalos en la guía):
${m.files.map((f) => "- " + f).join("\n")}` }];
  if (m.styleGuide) blocks.push({ type: "text", text: `docs/style_guide.md (de ${m.styleGuide.slug}):\n${clip(m.styleGuide.text, 16000)}` });
  for (const h of m.helpers.slice(0, 6)) blocks.push({ type: "text", text: `HELPER ${h} (reutilizable: nombra sus funciones en la guía):\n${clip(read(path.join(outDir, h)), 14000)}` });
  m.examples.forEach((p, i) => {
    const slug = m.slugs[p] || safeName(path.basename(p));
    blocks.push({ type: "text", text: `EJEMPLO ${i + 1}: examples/${slug}/film.js\n${clip(read(path.join(outDir, "examples", slug, "film.js")), i === 0 ? 45000 : 25000)}` });
  });
  const shot = m.files.find((f) => f.endsWith("shotlist.md"));
  if (shot) blocks.push({ type: "text", text: `SHOTLIST DE EJEMPLO (${shot}):\n${clip(read(path.join(outDir, shot)), 10000)}` });
  blocks.push({ type: "text", text: `Con este material escribe el estilo: nombre corto en español (sin nombres de clientes ni marcas: describe el estilo, no al cliente), tipo (reel | clase | talking), descripción de 2 oraciones y una guía exhaustiva para hacer videos NUEVOS en este estilo con otro contenido. En el vocabulario de movimiento nombra las funciones concretas de los helpers y de los film.js de ejemplo que conviene reutilizar (archivo y función), con su timing en beats. Incluye ritmo/pacing medido (BPM, duración, eventos por beat), roles de tipografía y color, subtítulos, transiciones, dirección de sonido y música, VO, reglas recurrentes (las del brief que sean de estilo, no de contenido) y qué debe revisar el crítico.` });
  return blocks;
}

const humanize = (slug: string): string => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function guessKind(m: FamilyMaterial): StyleKind {
  const s = m.slug.toLowerCase();
  if (/clase|curso|leccion|lección|academ|tutorial|explica/.test(s)) return "clase";
  if (/talking|podcast|entrevista/.test(s) || validPreset(m.captionPreset) === "karaoke") return "talking";
  return "reel";
}

/** Guía armada sin IA (cuando no hay API key): todo el material ordenado para que el agente lo lea. */
export function fallbackGuide(m: FamilyMaterial, name: string): string {
  const bpms = m.timelines.map((t) => t.bpm).filter((x): x is number => typeof x === "number");
  const durs = m.timelines.map((t) => t.duration).filter((x): x is number => typeof x === "number");
  const fmts = uniq(m.timelines.flatMap((t) => t.formats || []));
  const range = (a: number[]): string => (a.length ? (Math.min(...a) === Math.max(...a) ? `${a[0]}` : `${Math.min(...a)}–${Math.max(...a)}`) : "?");
  return `# ${name}

> Guía armada automáticamente sin IA (no había API key al importar). Usa "Iterar" para que la IA la complete.

## Esencia
Estilo importado de ${m.projects.length} proyecto(s) del motor. Lee los ejemplos de \`examples/*/film.js\` y \`style_guide.md\` antes de construir.

## Estructura y ritmo
- BPM: ${range(bpms)} · duración: ${range(durs)} s · formatos: ${fmts.join(", ") || "?"}

## Vocabulario de movimiento
${m.helpers.length ? m.helpers.map((h) => `- \`${h}\`: helper propio del estilo; cópialo a film/ y cárgalo en index.html antes de film.js.`).join("\n") : "- (sin helpers propios: el vocabulario está en los film.js de ejemplo)"}
${m.examples.map((p) => `- \`examples/${m.slugs[p] || safeName(path.basename(p))}/film.js\``).join("\n")}

## Tipografía y color
- Tokens: ${Object.entries(m.tokens.vars).map(([k, v]) => `\`${k}: ${v}\``).join(", ") || "-"}
- Fuentes: ${m.fonts.join(", ") || "-"} (copiadas en \`assets/fonts/\`, ver \`film/index.html\`)

## Subtítulos
- ${m.captionPreset ? `Preset \`${m.captionPreset}\`` : "Sin subtítulos quemados"}

## Reglas recurrentes y prohibiciones
${m.rules.map((r) => "- " + r).join("\n") || "- (sin reglas en los briefs)"}

## Qué revisa el crítico
- Que el ritmo, la tipografía y las transiciones coincidan con los ejemplos.
- Las reglas de la casa (RULES.md) y las de esta guía.
${m.styleGuide ? `\n---\n\n## Guía de estilo original (${m.styleGuide.slug})\n\n${m.styleGuide.text}` : ""}`;
}

// ---------- API ----------
export async function importStylesFromPath(input: string, step: Step): Promise<Style[]> {
  const root = path.resolve(String(input || "").trim().replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  if (!input || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("La carpeta no existe o no es una carpeta.");
  step("Buscando proyectos del motor…");
  const projects = findProjects(root);
  if (!projects.length) throw new Error("No encontré proyectos del motor en esa carpeta (cada proyecto debe tener film/film.js y brief.md o timeline.json).");
  const families = groupFamilies(projects);
  step(`Encontré ${projects.length} proyecto(s) en ${families.length} familia(s): ${families.map((f) => f.slug).join(", ")}`);
  const useAi = hasKey();
  if (!useAi) step("Sin API key: se extrae el material y se arma una guía básica (luego puedes iterarla con IA).");
  const out: Style[] = [];
  for (const [i, fam] of families.entries()) {
    const tag = families.length > 1 ? ` (${i + 1}/${families.length})` : "";
    const style = newUserStyle({ name: humanize(fam.slug), kind: "reel", origin: "importado", description: "", guide: "", sources: fam.projects });
    const dir = userStyleDir(style.id);
    try {
      step(`Extrayendo material de "${fam.slug}"${tag}…`);
      const m = extractFamily(fam, dir, step);
      style.tokens = { palette: m.palette, fonts: m.fonts };
      style.captionPreset = validPreset(m.captionPreset);
      style.kind = guessKind(m);
      if (useAi) {
        step(`La IA está escribiendo la guía de "${fam.slug}"${tag}…`);
        const d = await ask({ stage: "estilos", system: styleSystem(), content: materialToContent(m, dir), schema: StyleDraft, maxTokens: 32000 });
        applyDraft(style, d);
        // la paleta y las fuentes medidas mandan; la IA solo completa si no se detectó nada
        if (m.palette.length) style.tokens.palette = m.palette;
        if (m.fonts.length) style.tokens.fonts = m.fonts;
        if (m.captionPreset && validPreset(m.captionPreset)) style.captionPreset = validPreset(m.captionPreset);
      } else {
        style.description = `Estilo importado de ${fam.projects.length} proyecto(s) del motor. Guía básica sin IA: complétala con "Iterar".`;
        style.guide = fallbackGuide(m, style.name);
      }
      // vista previa: un recorte de un render ya hecho en los proyectos de la familia (no bloquea si falla)
      if (sourceRender(style)) {
        try { await renderStylePreview(style, step); refreshFiles(style); }
        catch (e) { step(`Sin vista previa para "${fam.slug}": ${(e as Error).message}`); }
      }
      saveUserStyle(style);
      out.push(style);
      step(`Estilo "${style.name}" listo${tag}`);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }
  return out;
}
