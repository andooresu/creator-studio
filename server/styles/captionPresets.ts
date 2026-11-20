// Presets de subtítulos del kit (motion/captions/presets.json): looks con nombre y alias de nombres viejos.
// Un alias es una entrada { "alias": "<nombre>" } (p. ej. karaoke-amarillo → karaoke): sigue funcionando en estilos y
// timelines viejos, pero no se ofrece como un look aparte y al escribir algo nuevo se guarda el nombre canónico.
import fs from "node:fs";
import path from "node:path";
import { MOTION_DIR } from "../db.ts";

type Entry = { alias?: unknown; _meta?: { useFor?: string } } & Record<string, unknown>;

function readPresets(): Record<string, Entry> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(MOTION_DIR, "captions", "presets.json"), "utf8")) as Record<string, unknown>;
    const out: Record<string, Entry> = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_") && v && typeof v === "object" && !Array.isArray(v)) out[k] = v as Entry;
    return out;
  } catch { return {}; }
}

/** Looks reales (sin alias): nombre → para qué sirve. */
export function captionLooks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(readPresets())) if (typeof v.alias !== "string") out[k] = v._meta?.useFor || "";
  return out;
}

/** Nombre canónico de un preset (sigue alias, hasta 5 saltos; corta bucles). undefined si no existe. */
export function canonicalCaptionPreset(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const all = readPresets();
  let n = name;
  const seen = new Set<string>();
  for (let hop = 0; hop < 5; hop++) {
    if (seen.has(n)) return undefined;
    seen.add(n);
    const v = all[n];
    if (!v) return undefined;
    if (typeof v.alias !== "string") return n;
    n = v.alias;
  }
  return undefined;
}

/** Todos los nombres aceptados (looks + alias que resuelven a un look). */
export function captionPresetNameSet(): Set<string> {
  return new Set(Object.keys(readPresets()).filter((k) => canonicalCaptionPreset(k)));
}
