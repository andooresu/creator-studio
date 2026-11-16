// Guías de branding: generación con IA desde fuentes (web, PDF, Instagram, imágenes, texto),
// iteración con feedback, versiones y conversión a prompt para el resto del estudio.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BrandProposals } from "../shared/schemas.ts";
import type { BrandGuide } from "../shared/schemas.ts";
import type { Brand, BrandSource } from "../shared/types.ts";
import { ask } from "./ai.ts";
import type { ContentBlock } from "./ai.ts";
import { load, save, BRANDS_DIR } from "./db.ts";
import { run } from "./media.ts";
import { fetchProfile } from "./inspo.ts";

export { BrandGuide, BrandProposals } from "../shared/schemas.ts";

/** Callback de progreso: actualiza el paso visible del trabajo en curso. */
export type StepFn = (msg: string) => void;

const SYSTEM = `Eres un director de marca senior especializado en marcas personales y creadores de contenido en redes (Instagram, TikTok, YouTube). Escribes en español latino.
Construyes guías de branding accionables: cada campo debe poder usarse tal cual para escribir guiones, diseñar subtítulos y elegir formatos de video. Nada genérico: si la fuente da evidencia (textos, colores, fuentes, publicaciones), úsala y respétala; si falta, propón con criterio y coherencia.
Colores siempre en hex (#RRGGBB). Tipografías preferentemente de Google Fonts.`;

// ---------- Fuentes ----------
// Cualquier navegador Chromium instalado sirve para la captura del sitio (si no hay, se omite).
const CHROME: string = [process.env.CHROME_PATH, ...["/Applications", path.join(os.homedir(), "Applications")].flatMap((dir) => [
  `${dir}/Google Chrome.app/Contents/MacOS/Google Chrome`,
  `${dir}/Brave Browser.app/Contents/MacOS/Brave Browser`,
  `${dir}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
  `${dir}/Chromium.app/Contents/MacOS/Chromium`,
  `${dir}/Arc.app/Contents/MacOS/Arc`,
])].find((p): p is string => Boolean(p) && fs.existsSync(p as string)) || "";

async function screenshot(url: string, dir: string): Promise<string | null> {
  if (!CHROME) return null;
  const png = path.join(dir, "web.png");
  const jpg = path.join(dir, "web.jpg");
  try {
    await run(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1366,2200", "--virtual-time-budget=6000", `--screenshot=${png}`, url], { timeoutMs: 60000 });
    await run("ffmpeg", ["-y", "-i", png, "-vf", "scale=1000:-2", "-q:v", "4", jpg]);
    return jpg;
  } catch { return null; }
}

function topColors(css: string): string[] {
  const counts: Record<string, number> = {};
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    counts["#" + h] = (counts["#" + h] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([h, n]) => `${h} (${n})`);
}

export interface WebRead { title: string; desc: string; colors: string[]; fonts: string[]; text: string; shot: string | null }

export async function readWeb(url: string, dir: string): Promise<WebRead> {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Studio" }, redirect: "follow" });
  if (!r.ok) throw new Error(`La página respondió ${r.status}`);
  const html = await r.text();
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || "";
  // Nota: igual que el original, si no hay atributos style="" se concatena "undefined" (inofensivo).
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + html.match(/style="[^"]*"/gi)?.join("\n");
  const sheets = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)/gi)].map((m) => new URL(m[1], url).href).slice(0, 4);
  for (const s of sheets) { try { css += "\n" + (await (await fetch(s)).text()).slice(0, 300000); } catch {} }
  const fonts = [...new Set([...css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((m) => m[1].split(",")[0].replace(/["']/g, "").trim()))].filter((f) => f && !/inherit|var\(/.test(f)).slice(0, 8);
  const gfonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, " "));
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 14000);
  const shot = await screenshot(url, dir);
  return { title, desc, colors: topColors(css || ""), fonts: [...new Set([...gfonts, ...fonts])], text, shot };
}

const b64 = (f: string): string => fs.readFileSync(f).toString("base64");

/** Convierte las fuentes en bloques de contenido neutral para el modelo. */
async function sourcesToContent(sources: BrandSource[], dir: string, step: StepFn): Promise<ContentBlock[]> {
  const content: ContentBlock[] = [];
  for (const [i, s] of sources.entries()) {
    const n = i + 1;
    if (s.type === "url") {
      step(`Leyendo la web ${s.value}…`);
      const w = await readWeb(s.value, dir);
      content.push({ type: "text", text: `FUENTE ${n} — SITIO WEB ${s.value}\nTítulo: ${w.title}\nDescripción: ${w.desc}\nColores más usados en el CSS: ${w.colors.join(", ")}\nTipografías detectadas: ${w.fonts.join(", ")}\nTexto del sitio:\n${w.text}` });
      if (w.shot) { content.push({ type: "text", text: "Captura del sitio:" }); content.push({ type: "image", data: b64(w.shot) }); }
    } else if (s.type === "instagram") {
      step(`Cargando el perfil @${s.value}…`);
      const p = await fetchProfile(s.value, { limit: 12 });
      content.push({ type: "text", text: `FUENTE ${n} — INSTAGRAM @${p.username}\nNombre: ${p.fullName}\nBio: ${p.biography}\nSeguidores: ${p.followers}\nÚltimos captions:\n${p.videos.map((v) => `- (${v.views || "?"} vistas) ${String(v.caption || "").slice(0, 300)}`).join("\n")}\nMiniaturas recientes:` });
      for (const v of p.videos.slice(0, 8)) if (v.thumbFile && fs.existsSync(v.thumbFile)) content.push({ type: "image", data: b64(v.thumbFile) });
    } else if (s.type === "pdf") {
      content.push({ type: "text", text: `FUENTE ${n} — DOCUMENTO PDF ${s.name || ""}:` });
      content.push({ type: "pdf", data: b64(s.file), name: s.name });
    } else if (s.type === "image") {
      content.push({ type: "text", text: `FUENTE ${n} — IMAGEN ${s.name || ""} (logo, post, referencia visual):` });
      content.push({ type: "image", data: b64(s.file), mime: /\.png$/i.test(s.file) ? "image/png" : "image/jpeg" });
    } else if (s.type === "text") {
      content.push({ type: "text", text: `FUENTE ${n} — BRIEF DEL CREADOR:\n${s.value}` });
    }
  }
  return content;
}

export async function generateGuides({ sources, count = 1, instructions = "" }: { sources: BrandSource[]; count?: number; instructions?: string }, step: StepFn): Promise<BrandGuide[]> {
  const dir = path.join(BRANDS_DIR, "tmp-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const content = await sourcesToContent(sources, dir, step);
  content.push({ type: "text", text: `${instructions ? "INSTRUCCIONES: " + instructions + "\n" : ""}Crea ${count} propuesta(s) de guía de branding completa(s) para esta marca personal de creador de contenido.${count > 1 ? " Cada propuesta debe tomar una dirección claramente distinta (posicionamiento, voz y estética), todas fieles a la evidencia." : ""}` });
  step(count > 1 ? `La IA está creando ${count} propuestas de branding…` : "La IA está creando la guía de branding…");
  const r = await ask({ stage: "branding", system: SYSTEM, content, schema: BrandProposals, maxTokens: 32000, cacheTtl: "1h" }); // después suele venir una vuelta de feedback dentro de la hora
  return r.propuestas.slice(0, count);
}

export async function iterateGuide(brand: Pick<Brand, "guide" | "raw">, feedback: string, step: StepFn): Promise<BrandGuide> {
  step("La IA está ajustando la guía con tu feedback…");
  const base = brand.guide ? JSON.stringify(brand.guide) : brand.raw;
  const content: ContentBlock[] = [{ type: "text", text: `GUÍA ACTUAL:\n${base}\n\nFEEDBACK DEL CREADOR (aplícalo con precisión, conserva lo que no se menciona):\n${feedback}\n\nDevuelve 1 propuesta: la guía actualizada completa.` }];
  const r = await ask({ stage: "branding", system: SYSTEM, content, schema: BrandProposals, maxTokens: 32000, cacheTtl: "1h" });
  // Igual que el original: si el modelo devuelve 0 propuestas, esto es undefined.
  return r.propuestas[0];
}

/** Texto compacto de la guía para inyectar en guiones, análisis, etc. */
export function brandToPrompt(brand: Pick<Brand, "guide" | "raw"> | null | undefined): string {
  if (!brand) return "";
  if (!brand.guide) return brand.raw || "";
  const g = brand.guide;
  const L = (a: string[] | null | undefined): string => (a || []).join("; ");
  return `Marca: ${g.nombre}
${g.resumen}
Propósito: ${g.esencia.proposito} | Propuesta: ${g.esencia.propuesta} | Personalidad: ${L(g.esencia.personalidad)} | Arquetipo: ${g.esencia.arquetipo}
Audiencia: ${g.audiencia.perfil}. Dolores: ${L(g.audiencia.dolores)}. Deseos: ${L(g.audiencia.deseos)}
Voz: ${g.voz.tono}. Reglas: ${L(g.voz.reglas)}. Usar: ${L(g.voz.usar)}. Evitar: ${L(g.voz.evitar)}. Ejemplos: ${L(g.voz.ejemplos)}
Pilares: ${g.pilares.map((p) => `${p.nombre} (${p.descripcion})`).join("; ")}
Visual: paleta ${g.visual.paleta.map((c) => `${c.nombre} ${c.hex} [${c.uso}]`).join(", ")}; tipografías ${g.visual.tipografias.map((t) => `${t.nombre} (${t.uso})`).join(", ")}; foto: ${g.visual.fotografia}; video: ${g.visual.video}; subtítulos: ${g.visual.subtitulos}
Formatos: ${L(g.formatos)} | Hooks firma: ${L(g.hooksFirma)} | CTAs: ${L(g.ctas)}
Hacer: ${L(g.hacer)} | No hacer: ${L(g.noHacer)}${brand.raw && brand.guide ? "\nNotas extra: " + brand.raw : ""}`;
}

export function snapshot(brand: Brand, note: string): void {
  brand.versions = brand.versions || [];
  brand.versions.push({ at: new Date().toISOString(), note, guide: brand.guide, raw: brand.raw });
  if (brand.versions.length > 30) brand.versions.shift();
}

export function brandDir(bid: string): string {
  const d = path.join(BRANDS_DIR, bid);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export { load, save };
