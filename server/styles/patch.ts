// Iterar una guía de estilo por secciones: la IA devuelve solo las secciones "## …" que cambian y aquí se
// mezclan con la guía actual. Ahorra tokens de salida (la parte más cara) frente a reescribir la guía entera.
import { z } from "zod";

export const StylePatch = z.object({
  description: z.string().describe("Nueva descripción (dos oraciones) solo si el feedback la cambia; cadena vacía = sin cambio"),
  palette: z.array(z.string()).describe("Paleta completa en hex #RRGGBB solo si cambia; lista vacía = sin cambio"),
  fonts: z.array(z.string()).describe("Tipografías completas solo si cambian; lista vacía = sin cambio"),
  captionPreset: z.string().describe("Preset de subtítulos solo si cambia; cadena vacía = sin cambio; \"ninguno\" = quitar los subtítulos"),
  sections: z.array(z.object({
    action: z.enum(["replace", "add", "remove"]).describe("replace = reescribe una sección existente; add = sección nueva; remove = elimina una sección existente"),
    heading: z.string().describe("Título de la sección SIN los '## ', copiado exacto de la guía actual para replace/remove"),
    body: z.string().describe("Contenido completo de la sección (sin la línea del título); vacío para remove"),
  })).describe("Solo las secciones que cambian. Las que no menciones quedan igual."),
});
export type StylePatch = z.infer<typeof StylePatch>;

interface Section { heading: string; lines: string[]; touched?: boolean }
interface Parsed { preamble: string[]; sections: Section[] }

/** Título comparable: sin tildes, numeración inicial ("3." / "3)"), paréntesis finales ni puntuación final. */
export const norm = (h: string): string => h
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/^#+\s*/, "")
  .replace(/^\s*\d+\s*[.)-]\s*/, "")
  .replace(/\s*\([^)]*\)\s*$/, "")
  .replace(/[\s:.\-–—]+$/, "")
  .trim().replace(/\s+/g, " ").toLowerCase();

/** Busca la sección del título: igual tras normalizar; si no, la única cuyo título contiene al otro (o viceversa). */
function findSection(sections: Section[], heading: string): number {
  const n = norm(heading);
  const exact = sections.findIndex((x) => norm(x.heading) === n);
  if (exact >= 0 || n.length < 4) return exact;
  const near = sections.map((x, i) => ({ i, h: norm(x.heading) })).filter(({ h }) => h.length >= 4 && (h.startsWith(n) || n.startsWith(h)));
  return near.length === 1 ? near[0].i : -1;
}

/** Cuerpo listo para insertar: sin la línea de título repetida al inicio y sin "## " sueltos (pasan a "### "),
 *  para que no aparezcan secciones de más en la próxima lectura. */
function cleanBody(body: string, heading: string): string[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && /^#{1,6}\s/.test(lines[0]) && norm(lines[0]) === norm(heading)) lines.shift();
  let fence = false;
  const out = lines.map((l) => {
    if (/^\s*```/.test(l)) fence = !fence;
    return !fence && /^##\s/.test(l) ? "#" + l : l;
  });
  while (out.length && !out[out.length - 1].trim()) out.pop();
  while (out.length && !out[0].trim()) out.shift();
  return out;
}

/** Divide la guía en preámbulo (título "# …" e intro) y secciones "## …" (ignora "## " dentro de bloques ```). */
export function parseGuide(guide: string): Parsed {
  const out: Parsed = { preamble: [], sections: [] };
  let fence = false;
  for (const line of guide.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (m && !line.startsWith("###")) out.sections.push({ heading: m[1], lines: [] });
    else if (out.sections.length) out.sections[out.sections.length - 1].lines.push(line);
    else out.preamble.push(line);
  }
  return out;
}

/** ¿La guía tiene estructura suficiente para iterar por secciones? */
export function canPatch(guide: string): boolean {
  return parseGuide(guide).sections.length >= 3;
}

export interface MergeResult { guide: string; changed: string[]; unmatched: string[] }

/** Aplica el parche: reemplaza/quita por título (sin distinguir mayúsculas) y agrega al final las nuevas.
 *  Un "replace" cuyo título no existe se agrega como sección nueva y se informa en `unmatched`. */
export function mergeGuide(guide: string, sections: StylePatch["sections"]): MergeResult {
  const g = parseGuide(guide);
  const changed: string[] = [];
  const unmatched: string[] = [];
  for (const s of sections) {
    const heading = s.heading.replace(/^#+\s*/, "").trim();
    if (!heading) continue;
    const i = findSection(g.sections, heading);
    const body = cleanBody(s.body, heading);
    const lines = body.length ? ["", ...body, ""] : [""];
    if (s.action === "remove") {
      if (i >= 0) { g.sections.splice(i, 1); changed.push(heading); }
      else unmatched.push(heading);
      continue;
    }
    if (i >= 0) { g.sections[i] = { heading: g.sections[i].heading, lines, touched: true }; changed.push(heading); continue; }
    if (s.action === "replace") unmatched.push(heading);
    g.sections.push({ heading, lines, touched: true });
    changed.push(heading);
  }
  // Las secciones sin cambios y el preámbulo se copian tal cual (línea por línea, incluidos bloques de código);
  // solo las nuevas o reescritas llevan el formato "título, línea en blanco, cuerpo, línea en blanco".
  const out: string[] = [...g.preamble];
  for (const x of g.sections) {
    if (x.touched && out.length && out[out.length - 1].trim()) out.push("");
    out.push(`## ${x.heading}`, ...x.lines);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { guide: out.join("\n") + "\n", changed, unmatched };
}
