// Aprende un estilo desde un video de referencia: ref_analyze.py mide cortes, ritmo, energía y paleta y arma
// hojas de contacto; la IA mira las hojas + métricas y escribe el estilo (gramática, nunca el contenido).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ask, hasKey } from "../ai.ts";
import type { ContentBlock } from "../ai.ts";
import { MOTION_DIR } from "../db.ts";
import { run } from "../media.ts";
import { newUserStyle, saveUserStyle, userStyleDir, cleanPalette } from "./store.ts";
import { StyleDraft, styleSystem, applyDraft } from "./create.ts";
import type { Step } from "./create.ts";
import type { Style } from "../../shared/types.ts";

export function motionPython(): string {
  const venv = path.join(MOTION_DIR, ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python3";
}

interface RefSummary {
  source?: string; duration?: number; fps?: number; size?: [number, number]; shots?: number; cuts_per_sec?: number;
  shot_len?: { median: number; min: number; max: number }; tempo_bpm?: number | null; cuts_on_beat?: number | null;
  intervals_on_half_beat_grid?: number | null; motion_mean?: number; palette?: string[];
}
interface RefShot { i: number; start: number; end: number; dur: number; motion: number; brightness: number; colors: string[] }
export interface RefAnalysis { summary: RefSummary; cuts: number[]; shots: RefShot[]; beats: number[] }

/** Corre ref_analyze.py en una carpeta temporal y devuelve la carpeta de salida (refs/ref/) y sus métricas. */
export async function analyzeReference(file: string, work: string, step: Step): Promise<{ out: string; data: RefAnalysis }> {
  step("Midiendo el video: cortes, ritmo, energía y paleta…");
  const script = path.join(MOTION_DIR, "scripts", "ref_analyze.py");
  await run(motionPython(), [script, file, "--name", "ref"], { cwd: work, timeoutMs: 30 * 60 * 1000 });
  const out = path.join(work, "refs", "ref");
  const data = JSON.parse(fs.readFileSync(path.join(out, "shots.json"), "utf8")) as RefAnalysis;
  return { out, data };
}

async function imageSize(file: string): Promise<{ w: number; h: number }> {
  const { out } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]);
  const [w, h] = out.trim().split("x").map(Number);
  return { w: w || 0, h: h || 0 };
}

/** Parte una hoja alta en trozos legibles para visión (≤ 1568 px por lado, máx. `maxParts`). */
export async function visionParts(file: string, dir: string, maxParts = 5): Promise<string[]> {
  const { w, h } = await imageSize(file);
  if (!w || !h) return [];
  const MAX = 1568;
  let k = Math.min(1, MAX / w);
  if ((h * k) / MAX > maxParts) k = (maxParts * MAX) / h;
  const sw = Math.max(2, Math.floor((w * k) / 2) * 2);
  const sh = Math.round(h * k);
  const parts = Math.max(1, Math.ceil(sh / MAX));
  const ph = Math.ceil(sh / parts);
  const base = path.basename(file).replace(/\.\w+$/, "");
  const outs: string[] = [];
  for (let i = 0; i < parts; i++) {
    const o = path.join(dir, `${base}_${i + 1}.jpg`);
    const y = i * ph;
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `scale=${sw}:${sh},crop=${sw}:'min(${ph},ih-${y})':0:${y}`, "-q:v", "4", o]);
    outs.push(o);
  }
  return outs;
}

function metricsText(d: RefAnalysis): string {
  const s = d.summary;
  const shots = d.shots.slice(0, 80).map((x) => `| ${x.i} | ${x.start.toFixed(2)}–${x.end.toFixed(2)} | ${x.dur.toFixed(2)} | ${x.motion.toFixed(3)} | ${x.brightness.toFixed(2)} | ${x.colors.join(" ")} |`).join("\n");
  return `MÉTRICAS MEDIDAS (ref_analyze.py)
Duración ${s.duration} s · ${s.fps} fps · tamaño ${(s.size || []).join("x")} · ${s.shots} planos · ${s.cuts_per_sec} cortes/s
Duración de plano: mediana ${s.shot_len?.median} s (mín ${s.shot_len?.min}, máx ${s.shot_len?.max})
Música: ${s.tempo_bpm ?? "sin música detectada"} BPM · cortes sobre beat ${s.cuts_on_beat ?? "-"} · intervalos en grid de ½ beat ${s.intervals_on_half_beat_grid ?? "-"} (la fase del beat puede fallar)
Energía de movimiento media ${s.motion_mean} · paleta dominante ${(s.palette || []).join(" ")}

Tabla de planos (# | tiempo s | dur | movimiento | brillo | colores):
${shots}${d.shots.length > 80 ? `\n… y ${d.shots.length - 80} planos más` : ""}`;
}

function fallbackGuide(d: RefAnalysis, name: string): string {
  const s = d.summary;
  const beat = s.tempo_bpm ? 60 / s.tempo_bpm : null;
  return `# ${name}

> Guía armada automáticamente sin IA (no había API key). Mira las hojas en \`ref/\` y usa "Iterar" para completarla.

## Estructura y ritmo
- Duración de la referencia: ${s.duration} s · ${s.shots} planos · ${s.cuts_per_sec} cortes/s
- Plano típico: ${s.shot_len?.median} s${beat ? ` (≈ ${(Number(s.shot_len?.median || 0) / beat).toFixed(1)} beats a ${s.tempo_bpm} BPM)` : ""}; mín ${s.shot_len?.min} s, máx ${s.shot_len?.max} s
- Música: ${s.tempo_bpm ? `${s.tempo_bpm} BPM` : "sin música detectada"}
- ${Number(s.cuts_per_sec || 0) < 0.6 ? "Pocos cortes: la energía viene del motion design continuo (el cuadro se transforma sin cortar)." : "Edición rápida: la energía viene de los cortes sobre el beat."}

## Color
- Paleta dominante medida: ${(s.palette || []).join(", ")}

## Material
- \`ref/sheet_shots.jpg\` (primer y medio frame de cada plano), \`ref/sheet_time.jpg\` (un frame cada 0,5 s), \`ref/energy.png\`, \`ref/palette.png\`, \`ref/shots.json\`, \`ref/breakdown.md\`.

## Qué revisa el crítico
- Que el ritmo de cortes (cortes por compás, duración de plano) coincida con la referencia.
- Que se tome la gramática, nunca el contenido (ni textos, ni logos, ni música de la referencia).`;
}

const img = (f: string): ContentBlock => ({ type: "image", data: fs.readFileSync(f).toString("base64"), mime: f.endsWith(".png") ? "image/png" : "image/jpeg" });

export async function learnStyleFromVideo(file: string, step: Step): Promise<Style> {
  if (!file || !fs.existsSync(file)) throw new Error("No encontré el video de referencia.");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio-ref-"));
  try {
    const { out, data } = await analyzeReference(file, work, step);
    const label = path.basename(file).replace(/^\d{10,}-/, "");
    const style = newUserStyle({ name: "Estilo de referencia", kind: "reel", origin: "referencia", description: "", guide: "", sources: [label] });
    const dir = userStyleDir(style.id);
    try {
      // copia las salidas del análisis (hojas, curva de energía, paleta, métricas, plantilla de desglose)
      fs.mkdirSync(path.join(dir, "ref"), { recursive: true });
      for (const f of fs.readdirSync(out)) fs.copyFileSync(path.join(out, f), path.join(dir, "ref", f));
      style.tokens = { palette: cleanPalette(data.summary.palette || []), fonts: [] };
      const s = data.summary;
      const tall = (s.size?.[1] || 0) > (s.size?.[0] || 0);
      if (hasKey()) {
        step("Preparando las hojas de contacto para la IA…");
        const vis = path.join(work, "vision");
        fs.mkdirSync(vis, { recursive: true });
        const shotsParts = await visionParts(path.join(out, "sheet_shots.jpg"), vis, 4);
        const timeParts = await visionParts(path.join(out, "sheet_time.jpg"), vis, 5);
        const content: ContentBlock[] = [
          { type: "text", text: `Video de referencia (${tall ? "vertical" : "horizontal"}). Toma su GRAMÁTICA (ritmo, movimiento de tipografía, transiciones, roles de color, cámara, sincronía con el sonido), nunca su contenido (ni textos, ni logos, ni marcas, ni personas).\n\n${metricsText(data)}` },
          { type: "text", text: "HOJA DE PLANOS (primer frame y frame medio de cada plano, con tiempo y duración):" }, ...shotsParts.map(img),
          { type: "text", text: "HOJA DE TIEMPO (un frame cada 0,5 s; lee animación de texto, transiciones y movimientos de cámara):" }, ...timeParts.map(img),
          { type: "text", text: "CURVA DE ENERGÍA (amarillo = movimiento, rojo = cortes, azul = beats):" }, img(path.join(out, "energy.png")),
          { type: "text", text: "PALETA DOMINANTE:" }, img(path.join(out, "palette.png")),
          { type: "text", text: `Escribe el estilo para hacer videos NUEVOS con esta gramática en el motor. Adivina las familias tipográficas (clase, peso, caja; propone equivalentes libres de Google Fonts) y la paleta por roles. Mapea cada movimiento observado a cómo construirlo con el motor (C.spHit, TYPE.rise, C.trk, wipes con C.inset, push con C.put…) con timing en beats; usa los números medidos (cortes por compás, duración de plano, BPM). Si hay subtítulos visibles, elige el preset más cercano. Los archivos del análisis quedan en ref/ (sheet_shots.jpg, sheet_time.jpg, energy.png, palette.png, shots.json, breakdown.md): cítalos para el crítico.` },
        ];
        step("La IA está estudiando la referencia…");
        const d = await ask({ stage: "estilos", system: styleSystem(), content, schema: StyleDraft, maxTokens: 32000 });
        applyDraft(style, d);
        if (!style.tokens.palette.length) style.tokens.palette = cleanPalette(s.palette || []);
      } else {
        step("Sin API key: se guardan las métricas y una guía básica (luego puedes iterarla con IA).");
        style.name = `Referencia ${label.replace(/\.\w+$/, "").slice(0, 30)}`;
        style.kind = Number(s.cuts_per_sec || 0) < 0.6 ? "reel" : "talking";
        style.description = `Estilo medido de un video de referencia (${s.duration} s, ${s.cuts_per_sec} cortes/s${s.tempo_bpm ? `, ${s.tempo_bpm} BPM` : ""}). Guía básica sin IA: complétala con "Iterar".`;
        style.guide = fallbackGuide(data, style.name);
      }
      step("Guardando el estilo…");
      return saveUserStyle(style);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
