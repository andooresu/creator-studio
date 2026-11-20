// Edición automática local con ffmpeg.
// Modo "tomas" (si hay plan): corta exactamente las frases que elegiste (mejor toma de cada una).
// Modo "silencios" (respaldo): corta pausas con umbral adaptativo.
// Luego: reencuadre 9:16 1080x1920, audio a -14 LUFS, subtítulos (.srt; se queman si ffmpeg tiene libass)
// y edit-brief.md para el pulido avanzado con Claude Code + Remotion/HyperFrames.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, probeDuration, transcribe, wordsToCaptionSrt, tools } from "./media.ts";
import type { Transcript } from "./media.ts";
import type { Word, TakeSegment, EditPlan } from "../shared/types.ts";
import type { Concept } from "../shared/schemas.ts";

/** Rango [inicio, fin] en segundos. */
/** Argumentos para pasar un filtro complejo a ffmpeg en cualquier versión. ffmpeg 8 eliminó -filter_complex_script;
 *  el filtro va en línea (execFile no pasa por una shell y macOS admite ~1 MB de argumentos). Solo si es enorme
 *  se lee del archivo: con «-/filter_complex» en ffmpeg 7.1+ o con la opción antigua en versiones anteriores. */
function filterComplexArgs(filter: string, file: string): string[] {
  if (filter.length < 200_000) return ["-filter_complex", filter];
  return ffmpegAtLeast(7, 1) ? ["-/filter_complex", file] : ["-filter_complex_script", file];
}

let ffmpegVer: [number, number] | null = null;
function ffmpegAtLeast(major: number, minor: number): boolean {
  if (!ffmpegVer) {
    try {
      const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(execFileSync("ffmpeg", ["-version"], { stdio: "pipe" }).toString());
      ffmpegVer = m ? [Number(m[1]), Number(m[2])] : [99, 0]; // compilación de desarrollo ("N-…"): la más nueva
    } catch { ffmpegVer = [0, 0]; }
  }
  return ffmpegVer[0] > major || (ffmpegVer[0] === major && ffmpegVer[1] >= minor);
}

export type Range = [number, number];
/** Envolvente de energía: un valor dB RMS cada `step` segundos. */
export interface Envelope { step: number; v: number[] }
/** Frase detectada por segmentWords (sin decisión de conservar todavía). */
export type WordSegment = Omit<TakeSegment, "keep" | "reason">;
/** Lo mínimo que necesitan los cortes por plan: tiempos y decisión. */
export type KeepSegment = Pick<TakeSegment, "s" | "e" | "keep">;

async function isHdr(file: string): Promise<boolean> {
  try {
    const { out } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "csv=p=0", file]);
    return /arib-std-b67|smpte2084/.test(out);
  } catch { return false; }
}

const filterCache: Record<string, boolean> = {};
function hasFilter(name: string): boolean {
  if (!(name in filterCache)) {
    try { filterCache[name] = new RegExp(` ${name} `).test(execFileSync("ffmpeg", ["-hide_banner", "-filters"], { stdio: "pipe" }).toString()); } catch { filterCache[name] = false; }
  }
  return filterCache[name];
}

interface Encoder { hw: boolean; pre: string[]; args: string[] }
let encCache: Encoder | null = null;
/** Elige codificador: VideoToolbox en macOS si existe (rápido), si no libx264 veryfast. */
async function videoEncoder(): Promise<Encoder> {
  if (encCache) return encCache;
  let hw = false;
  if (process.platform === "darwin") {
    try { hw = /h264_videotoolbox/.test(execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: "pipe" }).toString()); } catch {}
  }
  encCache = hw
    ? { hw: true, pre: ["-hwaccel", "videotoolbox"], args: ["-c:v", "h264_videotoolbox", "-b:v", "12M", "-maxrate", "16M", "-bufsize", "24M"] }
    : { hw: false, pre: [], args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19"] };
  return encCache;
}

// Umbral adaptativo: mide el nivel RMS por bloques y ubica el corte entre ruido de fondo y voz.
export async function adaptiveThreshold(file: string): Promise<number> {
  const { err } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", "aresample=16000,asetnsamples=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"]);
  const v = [...err.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -100 : parseFloat(m[1]))).sort((a, b) => a - b);
  if (v.length < 20) return -35;
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  const floor = q(0.1), speech = q(0.9);
  // 7 dB por debajo de la voz fuerte; nunca pegado al ruido de fondo.
  return Math.max(floor + 4, Math.min(-25, speech - 7));
}

/** Envolvente de energía (dB RMS cada 50 ms) para ubicar el punto más silencioso entre dos tomas. */
export async function energyEnvelope(file: string): Promise<Envelope> {
  const { err } = await run("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af", "aresample=16000,asetnsamples=800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"]);
  return { step: 0.05, v: [...err.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -100 : parseFloat(m[1]))) };
}

export function thresholdFromEnvelope(env: Envelope): number {
  const v = [...env.v].sort((a, b) => a - b);
  if (v.length < 20) return -35;
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  // En RMS la voz suave queda cerca del ruido: umbral al 35% entre ruido de fondo y voz fuerte.
  const floor = q(0.1), speech = q(0.9);
  return Math.max(floor + 3, Math.min(-30, floor + 0.35 * (speech - floor)));
}

export function silencesFromEnvelope(env: Envelope, thr: number, minDur = 0.25): Range[] {
  const out: Range[] = [];
  let start: number | null = null;
  env.v.forEach((x, i) => {
    const t = i * env.step;
    if (x < thr) { if (start === null) start = t; }
    else if (start !== null) { if (t - start >= minDur) out.push([start, t]); start = null; }
  });
  if (start !== null && env.v.length * env.step - start >= minDur) out.push([start, env.v.length * env.step]);
  return out;
}

export function quietestNear(env: Envelope | null, t: number, lo: number, hi: number, radius = 0.8): number {
  if (!env) return t;
  const a = Math.max(lo + 0.1, t - radius), b = Math.min(hi - 0.1, t + radius);
  let best = t, bestV = Infinity;
  for (let x = a; x <= b; x += env.step) {
    const v = env.v[Math.round(x / env.step)] ?? 0;
    // a igual energía, prefiere el punto más cercano al estimado
    const score = v + Math.abs(x - t) * 2;
    if (score < bestV) { bestV = score; best = x; }
  }
  return best;
}

export async function detectSilences(file: string, noiseDb: number | string = -35, minDur = 0.45): Promise<Range[]> {
  const { err } = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-"]);
  const sil: Range[] = [];
  let start: number | null = null;
  for (const line of err.split("\n")) {
    const a = line.match(/silence_start: ([\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) start = parseFloat(a[1]);
    if (b && start !== null) { sil.push([start, parseFloat(b[1])]); start = null; }
  }
  return sil;
}

export function keepFromSilences(silences: Range[], duration: number, pad = 0.12): Range[] {
  const keep: Range[] = [];
  let cursor = 0;
  for (const [s, e] of silences) {
    const segEnd = Math.min(duration, s + pad);
    if (segEnd - cursor > 0.25) keep.push([cursor, segEnd]);
    cursor = Math.max(cursor, e - pad);
  }
  if (duration - cursor > 0.25) keep.push([cursor, duration]);
  return keep;
}

/**
 * Agrupa palabras en frases: corta cuando hay una pausa larga o al final de una oración.
 * Así cada repetición de una frase (otra toma) queda como un segmento aparte.
 */
export function segmentWords(words: Word[], { gap = 0.45, maxDur = 7, longWord = 0.9 }: { gap?: number; maxDur?: number; longWord?: number } = {}): WordSegment[] {
  // whisper suele "estirar" la última palabra sobre el silencio que sigue: una palabra muy larga = pausa.
  const segs: WordSegment[] = [];
  let cur: (Word & { _i: number })[] = [];
  const flush = () => {
    if (!cur.length) return;
    const last = cur[cur.length - 1];
    segs.push({ id: segs.length, s: cur[0].s, e: Math.min(last.e, last.s + 0.7), text: cur.map((w) => w.w).join(" "), w0: cur[0]._i, w1: last._i });
    cur = [];
  };
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1];
    if (cur.length && (w.s - prev.e > gap || w.s - cur[0].s > maxDur)) flush();
    cur.push({ ...w, _i: i });
    // corta en comas/puntos (las tomas repetidas suelen ir separadas por coma) o tras una pausa absorbida
    if (/[,.;:!?…]$/.test(w.w) || w.e - w.s > longWord) flush();
  }
  flush();
  return segs;
}

/** Quita de los rangos los silencios internos largos (respetando un margen). */
export function subtractSilences(ranges: Range[], silences: Range[], { pad = 0.12, minLen = 0.2 }: { pad?: number; minLen?: number } = {}): Range[] {
  const out: Range[] = [];
  for (const [a, b] of ranges) {
    let cur = a;
    for (const [s, e] of silences) {
      if (e <= a || s >= b) continue;
      const cutA = Math.max(a, s + pad), cutB = Math.min(b, e - pad);
      if (cutB - cutA <= 0) continue;
      if (cutA - cur >= minLen) out.push([cur, cutA]);
      cur = Math.max(cur, cutB);
    }
    if (b - cur >= minLen) out.push([cur, b]);
  }
  return out;
}

/**
 * Corte por "tramos de voz": el audio se divide en islas de voz separadas por silencios reales,
 * cada isla se asigna a la(s) frase(s) que solapa y se conserva si su frase se conserva.
 * Así los cortes siempre caen en silencio aunque los tiempos de whisper se desvíen ~0.5 s.
 */
export function speechIslands(silences: Range[], duration: number, minLen = 0.08): Range[] {
  const isl: Range[] = [];
  let cur = 0;
  for (const [s, e] of silences) { if (s - cur >= minLen) isl.push([cur, s]); cur = Math.max(cur, e); }
  if (duration - cur >= minLen) isl.push([cur, duration]);
  return isl;
}

export interface IslandOptions { padIn?: number; padOut?: number; mergeGap?: number; env?: Envelope | null }

export function rangesFromIslands(segments: KeepSegment[], islands: Range[], duration: number, { padIn = 0.06, padOut = 0.12, mergeGap = 0.12, env = null }: IslandOptions = {}): Range[] {
  const sorted = [...segments].sort((a, b) => a.s - b.s);
  const pieces: Range[] = [];
  for (const [a, b] of islands) {
    const ov = sorted.filter((x) => x.e > a && x.s < b);
    if (!ov.length) {
      // sin frase solapada: se asigna a la más cercana si está a <0.6 s; si no, es ruido
      const near = sorted.reduce<{ x: KeepSegment; d: number } | null>((best, x) => { const d = Math.min(Math.abs(x.s - b), Math.abs(x.e - a)); return !best || d < best.d ? { x, d } : best; }, null);
      if (near && near.d < 0.6 && near.x.keep) pieces.push([a, b]);
      continue;
    }
    if (ov.every((x) => x.keep === ov[0].keep)) { if (ov[0].keep) pieces.push([a, b]); continue; }
    // isla mixta corta: decide la frase que más la ocupa (los tiempos de whisper se desvían, partirla deja restos)
    if (b - a < 2.0) {
      const ovl = (x: KeepSegment) => Math.min(b, x.e) - Math.max(a, x.s);
      const keepT = ov.filter((x) => x.keep).reduce((t, x) => t + ovl(x), 0);
      const dropT = ov.filter((x) => !x.keep).reduce((t, x) => t + ovl(x), 0);
      if (keepT > dropT) pieces.push([a, b]);
      continue;
    }
    // isla mixta larga: se parte en el límite entre frases con decisión distinta
    let start = a;
    for (let i = 0; i < ov.length; i++) {
      const next = ov[i + 1];
      const end = next ? Math.min(b, Math.max(start, ov[i].keep === next.keep ? (ov[i].e + next.s) / 2 : quietestNear(env, (ov[i].e + next.s) / 2, start, b))) : b;
      if (ov[i].keep && end - start > 0.05) pieces.push([start, end]);
      start = end;
    }
  }
  const merged: Range[] = [];
  for (const [a, b] of pieces.map(([a, b]): Range => [Math.max(0, a - padIn), Math.min(duration, b + padOut)])) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] <= mergeGap) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** Subtítulos: cada frase conservada se reparte linealmente sobre el tiempo de salida que ocupa su audio. */
export function wordsForCut(words: Word[], segments: TakeSegment[], ranges: Range[]): Word[] {
  const out: Word[] = [];
  const offsets: number[] = [];
  let acc = 0;
  for (const [a, b] of ranges) { offsets.push(acc); acc += b - a; }
  const toOut = (t: number): number | null => { for (const [i, [a, b]] of ranges.entries()) if (t >= a && t <= b) return offsets[i] + (t - a); return null; };
  for (const sg of segments.filter((x) => x.keep)) {
    const idx = ranges.map((r, i) => (r[1] > sg.s - 0.6 && r[0] < sg.e + 0.6 ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const oa = toOut(Math.max(ranges[idx[0]][0], Math.min(ranges[idx[0]][1], sg.s)));
    const ob = toOut(Math.min(ranges[idx[idx.length - 1]][1], Math.max(ranges[idx[idx.length - 1]][0], sg.e)));
    if (oa == null || ob == null || ob <= oa) continue;
    const ws = words.slice(sg.w0, sg.w1 + 1);
    const span = Math.max(0.01, ws[ws.length - 1].e - ws[0].s);
    const k = (ob - oa) / span;
    for (const w of ws) out.push({ w: w.w, s: +(oa + (w.s - ws[0].s) * k).toFixed(3), e: +(oa + (w.e - ws[0].s) * k).toFixed(3) });
  }
  return out.sort((x, y) => x.s - y.s);
}

/** Rangos a conservar a partir de los segmentos elegidos (con margen y fusionando huecos mínimos). */
export function rangesFromPlan(segments: KeepSegment[], duration: number, { padIn = 0.08, padOut = 0.15, mergeGap = 0.2 }: { padIn?: number; padOut?: number; mergeGap?: number } = {}): Range[] {
  const r = segments.filter((x) => x.keep).sort((a, b) => a.s - b.s).map((x): Range => [Math.max(0, x.s - padIn), Math.min(duration, x.e + padOut)]);
  const merged: Range[] = [];
  for (const [a, b] of r) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] <= mergeGap) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** Lleva los tiempos de palabra del video original a la línea de tiempo del corte. */
export function remapWords(words: Word[], ranges: Range[]): Word[] {
  const out: Word[] = [];
  let offset = 0;
  for (const [a, b] of ranges) {
    for (const w of words) if (w.s >= a - 0.02 && w.s < b) out.push({ w: w.w, s: +(w.s - a + offset).toFixed(3), e: +(Math.min(w.e, b) - a + offset).toFixed(3) });
    offset += b - a;
  }
  return out;
}

/**
 * Lleva un tramo [s, e] de la grabación original a la línea de tiempo del corte (concatenación de `ranges`).
 * Si parte del tramo se cortó, se recorta a lo que quedó (del primer al último pedazo conservado).
 * Devuelve null si el tramo se cortó por completo.
 */
export function mapToCut(s: number, e: number, ranges: [number, number][]): { s: number; e: number } | null {
  if (!(e > s) || !ranges?.length) return null;
  let acc = 0;
  let cs: number | null = null, ce: number | null = null;
  for (const [a, b] of ranges) {
    const lo = Math.max(s, a), hi = Math.min(e, b);
    if (hi > lo) {
      if (cs === null) cs = acc + (lo - a);
      ce = acc + (hi - a);
    }
    acc += b - a;
  }
  if (cs === null || ce === null || ce <= cs) return null;
  return { s: +cs.toFixed(3), e: +ce.toFixed(3) };
}

/** Apoyo visual (imagen) a dibujar en final.mp4. Tiempos en la grabación original. */
export interface AutoEditApoyo {
  abs: string;
  s: number;
  e: number;
  modo: "encima" | "pantalla_completa";
  posicion?: "arriba" | "centro" | "abajo" | string;
}

export interface AutoEditOptions {
  input: string;
  dir: string;
  concept?: Concept | null;
  plan?: Pick<EditPlan, "segments"> | null;
  words?: Word[] | null;
  brollDir?: string;
  /** imágenes aprobadas: se dibujan solo en final.mp4 (debajo de los subtítulos); cut.mp4 queda limpio */
  apoyos?: AutoEditApoyo[];
  onStep?: (msg: string) => void;
}

/** Overlay ya preparado: imagen reescalada al tamaño exacto (con margen para el Ken Burns) y tiempos del corte. */
interface PreparedOverlay {
  /** a/b en segundos = ka/30 y kb/30: cada pedazo empieza y termina en un fotograma entero del corte (30 fps) */
  png: string; a: number; b: number; ka: number; kb: number; x: number; y: number; w: number; h: number; sw: number; sh: number;
  /** apoyo al que pertenece (sentido del paneo) */
  idx: number;
  /** segundos de este apoyo ya mostrados en pedazos anteriores y total mostrado: el Ken Burns continúa al retomarse */
  off: number; tot: number;
  /** entrada/salida con alfa; no hay cuando otro pedazo empieza o termina justo ahí (corte directo, sin ver a la persona) */
  fin: boolean; fout: boolean;
  /** orden de dibujo (mayor = más arriba) */
  z: number;
}

const OUT_W = 1080, OUT_H = 1920;
/** margen extra del Ken Burns: la imagen se prepara 8% más grande que su caja y se desplaza lentamente dentro de ella */
const KB = 1.08;
/** entrada/salida rápida: 4 fotogramas a 30 fps */
const FADE = 4 / 30;
/** fotogramas por segundo del corte (cut.mp4 y final.mp4) */
const FPS = 30;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function imageSize(file: string): Promise<{ w: number; h: number } | null> {
  try {
    const { out } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file]);
    const m = /(\d+)x(\d+)/.exec(out);
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  } catch { return null; }
}

/** Duración mínima de un apoyo (o de cada pedazo de uno) en el corte. */
const MIN_OV = 0.6;

/**
 * Resuelve solapes entre apoyos ya válidos (tiempos del corte). Encima queda el que empezó después (el «interior»). Hay dos
 * capas: pantalla completa y tarjetas «encima» (full === false; sin el campo, todos son de la misma capa). Una tarjeta que
 * cae dentro de una pantalla completa se dibuja SOBRE ella sin interrumpirla (la imagen de fondo sigue corriendo); en los
 * demás casos (pantalla completa dentro de pantalla completa o de una tarjeta, tarjeta dentro de tarjeta) el de fuera se
 * interrumpe y se retoma al terminar el interior. Ningún apoyo se recorta por debajo de MIN_OV al empezar: si el siguiente
 * lo dejaría más corto, se retrasa el siguiente (y se descarta si ya no le alcanza).
 * Devuelve los pedazos visibles (sin solapes dentro de cada capa, ordenados por inicio) con el índice del apoyo al que
 * pertenecen y su orden de dibujo z (mayor = más arriba). Un pedazo de menos de MIN_OV solo se descarta si es la cola de su
 * apoyo; uno intermedio (el apoyo de fuera asoma un instante entre dos interiores) se cede al vecino pegado (el anterior
 * se alarga, o el siguiente empieza antes): así la pantalla no muestra a la persona un parpadeo en medio de un apoyo aprobado.
 */
export function resolveOverlaps(items: { a: number; b: number; full?: boolean }[]): { pieces: { idx: number; a: number; b: number; z: number }[]; dropped: number[] } {
  const EPS = 1e-6;
  // orden: inicio, y a igual inicio la pantalla completa antes que la tarjeta. Así una tarjeta que empieza junto con una
  // pantalla completa queda encima de ella sin retrasarla (la tarjeta «entra después»), sea cual sea el orden de la lista
  const ord = (x: { a: number; enc: boolean; idx: number }, y: { a: number; enc: boolean; idx: number }): number =>
    (Math.abs(x.a - y.a) < EPS ? 0 : x.a - y.a) || Number(x.enc) - Number(y.enc) || x.idx - y.idx;
  const it = items.map((x, idx) => ({ idx, a: x.a, b: x.b, enc: x.full === false })).sort(ord);
  const dropped: number[] = [];
  const live: typeof it = [];
  for (const n of it) {
    // el que ya estaba se ve al menos MIN_OV antes de que entre este (se repite por si el retraso cae dentro de otro).
    // n.a solo crece, a valores redondeados al milisegundo, y con tope de pasadas: siempre termina (sin depender de que
    // una suma con decimales dé exacta).
    for (let pass = 0; pass <= live.length; pass++) {
      let moved = false;
      for (const j of live) {
        if (n.enc && !j.enc) continue; // una tarjeta sobre una pantalla completa no la interrumpe
        if (j.a <= n.a + EPS && n.a < j.b - EPS && n.a - j.a < MIN_OV - EPS) {
          const na = Math.ceil((j.a + MIN_OV) * 1000 - EPS) / 1000;
          if (na > n.a) { n.a = na; moved = true; }
        }
      }
      if (!moved) break;
    }
    if (n.b - n.a < MIN_OV - EPS) { dropped.push(n.idx); continue; }
    live.push(n);
  }
  live.sort(ord);
  const zOf = new Map(live.map((x, k) => [x.idx, k]));
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-9;
  /** pedazos de una capa: «cands» compiten por estar arriba; solo se conservan los de la capa («own») */
  const layer = (cands: typeof live, own: (x: (typeof live)[number]) => boolean): { idx: number; a: number; b: number }[] => {
    const cuts = [...new Set(cands.flatMap((x) => [x.a, x.b]))].sort((x, y) => x - y);
    const pieces: { idx: number; a: number; b: number }[] = [];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k], t1 = cuts[k + 1];
      let top: (typeof live)[number] | null = null;
      // arriba: el que «entró después» según el mismo orden (a igual inicio, la tarjeta sobre la pantalla completa)
      for (const x of cands) if (x.a <= t0 && x.b >= t1 && (!top || zOf.get(x.idx)! > zOf.get(top.idx)!)) top = x;
      if (!top || !own(top)) continue; // tapado por la otra capa: no es un pedazo de esta (ni se alarga hacia ahí)
      const last = pieces[pieces.length - 1];
      if (last && last.idx === top.idx && near(last.b, t0)) last.b = t1;
      else pieces.push({ idx: top.idx, a: t0, b: t1 });
    }
    const shown: typeof pieces = [];
    for (let k = 0; k < pieces.length; k++) {
      const x = pieces[k];
      if (x.b - x.a >= MIN_OV - 1e-9) { shown.push(x); continue; }
      // intermedio: su apoyo vuelve más tarde, u otro pedazo de la capa empieza justo donde este termina (el apoyo de
      // fuera asoma entre dos interiores aunque no vuelva). Solo se descarta si nada lo sigue pegado: la persona se ve
      // igual al terminar, así que esa cola no deja un hueco dentro de una ventana aprobada
      const next = pieces[k + 1];
      const interior = pieces.slice(k + 1).some((y) => y.idx === x.idx) || (!!next && near(next.a, x.b));
      if (!interior) continue; // cola corta de su apoyo: no se dibuja
      const prev = shown[shown.length - 1];
      if (prev && near(prev.b, x.a)) prev.b = x.b;          // el anterior se sostiene hasta que entra el siguiente
      else if (next && near(next.a, x.b)) next.a = x.a;     // o el siguiente entra antes
      else shown.push(x);                                   // aislado: mejor el apoyo de fuera un instante que un hueco
    }
    // un alargue pudo dejar dos pedazos seguidos del mismo apoyo: se unen
    for (let k = shown.length - 1; k > 0; k--) if (shown[k].idx === shown[k - 1].idx && near(shown[k - 1].b, shown[k].a)) { shown[k - 1].b = shown[k].b; shown.splice(k, 1); }
    return shown;
  };
  // pantalla completa: solo compite con otras pantallas completas. Tarjetas: compiten con todo (una pantalla completa que
  // empieza después las tapa), pero solo se dibujan sus propios pedazos.
  const full = layer(live.filter((x) => !x.enc), (x) => !x.enc);
  const enc = live.some((x) => x.enc) ? layer(live, (x) => x.enc) : [];
  const shown = [...full, ...enc].sort((x, y) => x.a - y.a || zOf.get(x.idx)! - zOf.get(y.idx)!);
  for (const x of live) if (!shown.some((y) => y.idx === x.idx)) dropped.push(x.idx);
  return { pieces: shown.map((x) => ({ ...x, z: zOf.get(x.idx)! })), dropped };
}

/**
 * Prepara los apoyos para final.mp4, en este orden: (1) los mapea al corte y aparta los que se cortaron o duran menos de
 * 0,6 s; (2) normaliza cada imagen a PNG (ffmpeg aplica la rotación EXIF) y mide ESE PNG, así una foto vertical de
 * teléfono recibe una caja vertical, y la reescala una sola vez a su caja + margen Ken Burns en edit/overlays/; las que no
 * se pueden leer o preparar se apartan; (3) solo entre las que sobrevivieron resuelve solapes (resolveOverlaps).
 * Avisa por separado de cada motivo de descarte.
 */
async function prepareOverlays(apoyos: AutoEditApoyo[], ranges: Range[], cutDur: number, out: string, onStep: (m: string) => void): Promise<PreparedOverlay[]> {
  let cutOut = 0, short = 0;
  const valid: { ap: AutoEditApoyo; a: number; b: number }[] = [];
  for (const ap of apoyos) {
    const c = mapToCut(ap.s, ap.e, ranges);
    if (!c) { cutOut++; continue; }
    const a = Math.max(0, c.s), b = Math.min(cutDur, c.e);
    if (b - a < MIN_OV) { short++; continue; }
    valid.push({ ap, a, b });
  }
  if (cutOut) onStep(`${cutOut} apoyo(s) caen en partes que se cortaron del video y no se dibujan.`);
  if (short) onStep(`${short} apoyo(s) duran menos de 0,6 s tras el corte y no se dibujan.`);
  if (!valid.length) return [];
  const odir = path.join(out, "overlays");
  fs.rmSync(odir, { recursive: true, force: true });
  fs.mkdirSync(odir, { recursive: true });

  type Box = { png: string; x: number; y: number; w: number; h: number; sw: number; sh: number };
  const ready: { ap: AutoEditApoyo; a: number; b: number; box: Box }[] = [];
  for (const [i, v] of valid.entries()) {
    const norm = path.join(odir, `src${i}.png`);
    let size: { w: number; h: number } | null = null;
    try {
      await run("ffmpeg", ["-y", "-v", "error", "-i", v.ap.abs, "-frames:v", "1", "-vf", "format=rgba", norm]);
      size = await imageSize(norm);
    } catch { size = null; }
    if (!size || !size.w || !size.h) { onStep(`No se pudo leer la imagen de apoyo ${path.basename(v.ap.abs)}; se omite.`); continue; }
    // la caja depende solo del modo y del tamaño: se prepara ANTES de resolver solapes, así una imagen que falla aquí
    // no deja interrumpido (con la persona en medio) a un apoyo largo que la contenía
    let w: number, h: number, x: number, y: number;
    if (v.ap.modo === "pantalla_completa") { w = OUT_W; h = OUT_H; x = 0; y = 0; }
    else {
      // caja en la zona superior (y ≈ 160..1000) para no tapar la cara ni los subtítulos; "abajo" se trata como centro.
      // Horizontal o cuadrada: 960 de ancho y alto 540..840. Más alta que 960x840 (foto vertical de teléfono): 840 de
      // alto y el ancho que pida su proporción (mín. 480), así no se recorta la mitad de la foto (ni la cabeza)
      const tall = (960 * size.h) / size.w > 840;
      w = tall ? even(Math.max(480, Math.min(960, (840 * size.w) / size.h))) : 960;
      h = tall ? 840 : even(Math.min(840, Math.max(540, (960 * size.h) / size.w)));
      x = (OUT_W - w) / 2;
      y = v.ap.posicion === "arriba" ? 160 : 1000 - h;
    }
    const sw = even(w * KB), sh = even(h * KB);
    const png = path.join(odir, `ov${i}.png`);
    const fit = `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${sw}:${sh},format=rgba`;
    try {
      // pantalla completa tapa a la persona aunque la imagen tenga transparencia (logo, recorte): se aplana sobre negro.
      // Las tarjetas «encima» conservan su alfa
      await run("ffmpeg", ["-y", "-v", "error", "-i", norm, "-frames:v", "1",
        ...(v.ap.modo === "pantalla_completa"
          ? ["-filter_complex", `color=c=black:s=${sw}x${sh}[bg];[0:v]${fit}[im];[bg][im]overlay=format=auto:shortest=1,format=rgba`]
          : ["-vf", fit]),
        png]);
    } catch {
      onStep(`No se pudo preparar la imagen de apoyo ${path.basename(v.ap.abs)}; se omite.`);
      continue;
    }
    ready.push({ ...v, box: { png, x, y, w, h, sw, sh } });
  }
  if (!ready.length) { fs.rmSync(odir, { recursive: true, force: true }); return []; }

  const { pieces, dropped } = resolveOverlaps(ready.map((r) => ({ a: r.a, b: r.b, full: r.ap.modo === "pantalla_completa" })));
  if (dropped.length) onStep(`${dropped.length} apoyo(s) quedaron tapados por otro apoyo en el mismo momento y no se dibujan.`);

  const res: PreparedOverlay[] = [];
  // orden de dibujo: el que empezó después queda encima (una tarjeta sobre la pantalla completa que la contiene)
  // cada pedazo se ajusta a fotogramas enteros (30 fps): dos pedazos pegados comparten el mismo fotograma de relevo, y la
  // imagen cubre exactamente los fotogramas de su ventana (sin un fotograma de la persona entre dos apoyos)
  const drawn = pieces.map((pc) => ({ ...pc, ka: Math.round(pc.a * FPS), kb: Math.round(pc.b * FPS) })).filter((pc) => pc.kb > pc.ka);
  const tot = new Map<number, number>();
  for (const pc of drawn) tot.set(pc.idx, (tot.get(pc.idx) || 0) + (pc.kb - pc.ka) / FPS);
  const seen = new Map<number, number>();
  for (const pc of [...drawn].sort((x, y) => x.ka - y.ka)) {
    const o = ready[pc.idx].box;
    const off = seen.get(pc.idx) || 0;
    seen.set(pc.idx, off + (pc.kb - pc.ka) / FPS);
    res.push({ ...o, idx: pc.idx, ka: pc.ka, kb: pc.kb, a: pc.ka / FPS, b: pc.kb / FPS, off, tot: tot.get(pc.idx)!,
      // relevo pegado (otro pedazo termina donde este empieza, o empieza donde este termina): corte directo
      fin: !drawn.some((q) => q !== pc && q.kb === pc.ka), fout: !drawn.some((q) => q !== pc && q.ka === pc.kb),
      z: pc.z });
  }
  res.sort((x, y) => x.z - y.z || x.a - y.a);
  return res;
}

/**
 * Filtro de la pasada 2: base [0:v] → overlays (Ken Burns por recorte variable sobre la imagen ya escalada, entrada y salida
 * de 4 fotogramas con alfa) → subtítulos al final para que queden encima. Las imágenes son las entradas 1..N.
 */
function finalFilter(ovs: PreparedOverlay[], subs: string | null): string {
  const parts: string[] = [];
  let base = "0:v";
  ovs.forEach((o, i) => {
    const d = o.b - o.a;
    const fade = Math.min(FADE, d / 4);
    // paneo lento y lineal por la diagonal de la imagen, continuo entre los pedazos de un mismo apoyo (t + lo ya mostrado,
    // sobre el total mostrado); el sentido depende del apoyo, así dos apoyos seguidos no se repiten
    const tot = Math.max(o.tot, d);
    const u = `(t+${o.off.toFixed(3)})/${tot.toFixed(3)}`;
    const p = o.idx % 2 === 0 ? `min(1,${u})` : `max(0,1-${u})`;
    const yp = o.idx % 4 < 2 ? p : `(1-${p})`;
    const fades = (o.fin ? `fade=t=in:st=0:d=${fade.toFixed(3)}:alpha=1,` : "") +
      (o.fout ? `fade=t=out:st=${(d - fade).toFixed(3)}:d=${fade.toFixed(3)}:alpha=1,` : "");
    parts.push(`[${i + 1}:v]format=rgba,crop=${o.w}:${o.h}:x='(iw-ow)*${p}':y='(ih-oh)*${yp}',` +
      // base de tiempo 1/30 y desplazamiento entero: el primer fotograma de la imagen cae justo en el fotograma ka del corte
      `${fades}settb=1/${FPS},setpts=PTS-STARTPTS+${o.ka}[ov${i}]`);
    const next = `b${i}`;
    // ventana con medio fotograma de margen: se dibuja en los fotogramas ka..kb-1 del corte, ni uno más ni uno menos
    parts.push(`[${base}][ov${i}]overlay=x=${o.x}:y=${o.y}:eof_action=pass:enable='between(t,${((o.ka - 0.5) / FPS).toFixed(4)},${((o.kb - 0.5) / FPS).toFixed(4)})'[${next}]`);
    base = next;
  });
  parts.push(subs ? `[${base}]${subs}[vout]` : `[${base}]null[vout]`);
  return parts.join(";");
}

/** Resultado con rutas absolutas (el pipeline las convierte a relativas). */
export interface AutoEditResult {
  final: string;
  cut: string;
  srtPath: string | null;
  burned: boolean;
  mode: "tomas" | "silencios";
  segments: number;
  originalDuration: number;
  finalDuration: number;
  briefPath: string;
  transcribed: boolean;
  /** tramos conservados de la grabación original (tras el ajuste a 30 fps); también en edit/ranges.json */
  ranges: [number, number][];
  /** imágenes de apoyo dibujadas en final.mp4 */
  overlays: number;
}

export async function autoEdit(opts: AutoEditOptions): Promise<AutoEditResult> {
  try {
    return await autoEditRun(opts);
  } catch (e) {
    // una corrida fallida no deja temporales de tamaño completo en edit/ (cut.tmp.mp4, final.tmp.mp4, *.tmp.json/srt)
    const out = path.join(opts.dir, "edit");
    try { for (const f of fs.readdirSync(out)) if (/\.tmp\.\w+$/.test(f)) fs.rmSync(path.join(out, f), { force: true }); } catch { /* sin carpeta */ }
    throw e;
  }
}

async function autoEditRun({ input, dir, concept, plan, words, brollDir = "", apoyos = [], onStep = () => {} }: AutoEditOptions): Promise<AutoEditResult> {
  const t = tools();
  const out = path.join(dir, "edit");
  fs.mkdirSync(out, { recursive: true });
  const duration = await probeDuration(input);

  let segs: Range[];
  const planSegs = plan?.segments;
  const mode: "tomas" | "silencios" = planSegs?.some((x) => x.keep) ? "tomas" : "silencios";
  if (mode === "tomas" && planSegs) {
    onStep(`Usando ${planSegs.filter((x) => x.keep).length} de ${planSegs.length} frases elegidas; quitando pausas internas…`);
    // Una sola pasada de audio: envolvente → umbral adaptativo → silencios → islas de voz.
    const env = await energyEnvelope(input);
    const islands = speechIslands(silencesFromEnvelope(env, thresholdFromEnvelope(env), 0.25), duration);
    segs = rangesFromIslands(planSegs, islands, duration, { env });
  } else {
    onStep("Midiendo niveles de audio…");
    const threshold = await adaptiveThreshold(input);
    onStep(`Detectando silencios y pausas (umbral ${threshold.toFixed(0)} dB)…`);
    segs = keepFromSilences(await detectSilences(input, threshold.toFixed(1)), duration);
  }
  if (!segs.length) segs = [[0, duration]];

  // Rangos alineados a fotogramas: así audio y video duran exactamente lo mismo (sin deriva de sincronía).
  // Todo se normaliza a 30 fps constantes ANTES de cortar: los clips de iPhone tienen fotogramas variables,
  // y renumerar con N/30 sobre un video variable desincronizaría audio y video.
  const fps = 30;
  segs = segs.map(([a, b]): Range => [Math.round(a * fps) / fps, Math.round(b * fps) / fps]).filter(([a, b]) => b - a >= 1 / fps);
  const kept2 = segs.reduce((s, [a, b]) => s + (b - a), 0);
  // tramos conservados: permiten mapear tiempos de la grabación original al corte (apoyos, productor)
  const ranges = segs.map(([a, b]): [number, number] => [+a.toFixed(6), +b.toFixed(6)]);
  // Todo lo nuevo (corte, tramos, subtítulos, final) se escribe a temporales y solo reemplaza lo anterior al final de una
  // corrida completa: si algo falla a mitad, edit/ queda como estaba y sigue de acuerdo con project.edit (tramos viejos
  // con el corte viejo, final.mp4 viejo).
  const tmp = (name: string): string => path.join(out, name.replace(/(\.\w+)$/, ".tmp$1"));
  const commits: [string, string][] = [];
  const stage = (name: string): string => { const f = tmp(name); fs.rmSync(f, { force: true }); commits.push([f, path.join(out, name)]); return f; };
  fs.writeFileSync(stage("ranges.json"), JSON.stringify(ranges));
  onStep(`Cortando ${segs.length} tramos (de ${duration.toFixed(1)}s a ${kept2.toFixed(1)}s) y reencuadrando a 9:16…`);
  // Un solo filtro select/aselect (una rama) en lugar de trim+concat por tramo: ~5× más rápido en 4K.
  const eps = 0.5 / fps;
  const expr = segs.map(([a, b]) => `gte(t,${(a - eps).toFixed(4)})*lt(t,${(b - eps).toFixed(4)})`).join("+");
  // HDR (HLG/Dolby Vision del iPhone) → SDR bt709 para que los colores no se vean lavados en Instagram.
  const hdr = await isHdr(input);
  let tone = "";
  if (hdr && hasFilter("zscale")) tone = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,";
  else if (hdr) onStep("Video HDR detectado: este ffmpeg no trae zscale, los colores pueden verse algo lavados (graba en SDR o instala ffmpeg de Homebrew).");
  const filter = `[0:v]fps=${fps},select='${expr}',setpts=N/${fps}/TB,${tone}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[vout];` +
    `[0:a]aselect='${expr}',asetpts=N/SR/TB,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  const filterFile = path.join(out, "filter.txt");
  fs.writeFileSync(filterFile, filter);
  const cut = path.join(out, "cut.mp4");
  const cutTmp = stage("cut.mp4");
  const enc = await videoEncoder();
  const common = [...filterComplexArgs(filter, filterFile), "-map", "[vout]", "-map", "[aout]", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", cutTmp];
  try {
    // En Mac: decodificación y codificación por hardware (VideoToolbox).
    await run("ffmpeg", ["-y", ...enc.pre, "-i", input, ...enc.args, ...common], { timeoutMs: 60 * 60 * 1000 });
  } catch (e) {
    if (!enc.hw) throw e;
    onStep("Hardware no disponible para este archivo; usando codificación por software…");
    await run("ffmpeg", ["-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", ...common], { timeoutMs: 60 * 60 * 1000 });
  }

  // Subtítulos: si ya tenemos palabras del original, solo se re-mapean (evita transcribir otra vez).
  let transcript: Transcript | null = null;
  if (words?.length && mode === "tomas" && planSegs && planSegs[0]?.w0 !== undefined) {
    const w = wordsForCut(words, planSegs, segs);
    transcript = { text: w.map((x) => x.w).join(" "), words: w };
  } else {
    onStep("Transcribiendo el corte para subtítulos…");
    try { transcript = await transcribe(cutTmp, out); } catch (e) { onStep("Transcripción falló: " + (e instanceof Error ? e.message : String(e))); }
  }
  let srtPath: string | null = null;
  if (transcript?.words?.length) {
    srtPath = path.join(out, "subtitulos.srt");
    fs.writeFileSync(stage("subtitulos.srt"), wordsToCaptionSrt(transcript.words));
    fs.writeFileSync(stage("transcript.json"), JSON.stringify(transcript, null, 2));
  }

  // Pasada 2 → final.mp4 (nunca sobre cut.mp4): imágenes de apoyo y, encima de ellas, los subtítulos.
  let final = cut;
  let burned = false;
  let subs: string | null = null;
  if (srtPath && t.subtitlesFilter) {
    const color = (concept?.subtitulos?.colorAcento || "#FFD400").replace("#", "");
    const bgr = color.length === 6 ? color.slice(4, 6) + color.slice(2, 4) + color.slice(0, 2) : "00D4FF";
    const style = `FontName=Montserrat ExtraBold,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=90,SecondaryColour=&H00${bgr}`;
    subs = `subtitles=${tmp("subtitulos.srt").replace(/:/g, "\\:")}:force_style='${style}'`;
  }
  // nada de una corrida anterior queda junto al corte nuevo: ni un final.mp4 viejo (con otras imágenes) ni restos de
  // edit/overlays/. final.mp4 se codifica a un temporal y solo reemplaza al anterior al terminar la corrida (si esta
  // corrida no produce final.mp4, el viejo se borra entonces).
  const finalPath = path.join(out, "final.mp4");
  const finalTmp = tmp("final.mp4");
  fs.rmSync(finalTmp, { force: true });
  fs.rmSync(path.join(out, "overlays"), { recursive: true, force: true });
  let ovs: PreparedOverlay[] = [];
  if (apoyos.length) {
    onStep(`Preparando ${apoyos.length} imagen(es) de apoyo…`);
    ovs = await prepareOverlays(apoyos, segs, kept2, out, onStep); // avisa ella misma de cada apoyo que no se dibuja
  }
  const encodeFinal = async (list: PreparedOverlay[], sub: string | null): Promise<void> => {
    const filter = finalFilter(list, sub);
    const ffile = path.join(out, "filter-final.txt");
    fs.writeFileSync(ffile, filter);
    // la pasada 2 lee el corte nuevo (todavía temporal)
    // kb-ka fotogramas (+ medio de margen): la imagen cubre todos los fotogramas que habilita su ventana
    const inputs = list.flatMap((o) => ["-loop", "1", "-framerate", String(fps), "-t", ((o.kb - o.ka) / fps + 0.5 / fps).toFixed(4), "-i", o.png]);
    await run("ffmpeg", ["-y", "-i", cutTmp, ...inputs, ...filterComplexArgs(filter, ffile), "-map", "[vout]", "-map", "0:a?",
      "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
      "-c:a", "copy", "-movflags", "+faststart", finalTmp], { timeoutMs: 60 * 60 * 1000 })
      .catch((e: unknown) => { fs.rmSync(finalTmp, { force: true }); throw e; });
  };
  if (ovs.length || subs) {
    const n = new Set(ovs.map((o) => o.png)).size;
    onStep(ovs.length && subs ? `Dibujando ${n} imagen(es) de apoyo y quemando subtítulos…` : ovs.length ? `Dibujando ${n} imagen(es) de apoyo…` : "Quemando subtítulos…");
    try {
      await encodeFinal(ovs, subs);
    } catch (e) {
      if (!ovs.length) throw e;
      // si las imágenes rompen la pasada, el video sale igual (solo con subtítulos, o el corte limpio)
      onStep("No se pudieron dibujar las imágenes de apoyo: " + (e instanceof Error ? e.message.slice(-300) : String(e)));
      ovs = [];
      if (subs) await encodeFinal([], subs);
    }
    if (ovs.length || subs) { final = finalPath; burned = Boolean(subs); }
  }

  // Brief para el pulido avanzado con Claude Code (Remotion / HyperFrames)
  const brief = `# Brief de edición — pulido avanzado
Video base (ya cortado y en 9:16, limpio: sin subtítulos ni imágenes): ${cut}
Vista rápida para publicar (NO la uses como base${final !== cut ? ": ya trae subtítulos y/o imágenes de apoyo quemados" : ""}): ${final}
Subtítulos palabra a palabra: ${srtPath || "(sin transcripción — instala whisper)"}
Transcripción con tiempos: ${transcript ? path.join(out, "transcript.json") : "-"}
Tramos conservados de la grabación original (para mapear tiempos al corte): ${path.join(out, "ranges.json")}
Imágenes de apoyo quemadas en la vista rápida (vuelve a ponerlas tú sobre el video base): ${new Set(ovs.map((o) => o.png)).size}

## Concepto visual aprobado
\`\`\`json
${JSON.stringify(concept || {}, null, 2)}
\`\`\`

## Tarea para Claude Code
Con el stack Remotion (o HyperFrames) crea la versión final:
- Subtítulos animados palabra a palabra según "subtitulos" del concepto.
- Zooms/punch-ins y B-roll en los momentos de "momentos" del concepto (B-roll en ${brollDir || "la carpeta de B-roll que indique el creador"} si aplica).
- Música/SFX según el concepto, ducking bajo la voz.
- Texto de portada/hook en los primeros 2 s.
- Exporta 1080x1920 30fps H.264 a: ${path.join(out, "final-pro.mp4")}
`;
  // la corrida terminó: lo nuevo reemplaza a lo anterior (renombrar dentro de la misma carpeta es inmediato)
  if (final === finalPath) commits.push([finalTmp, finalPath]); else fs.rmSync(finalPath, { force: true });
  for (const [from, to] of commits) if (fs.existsSync(from)) fs.renameSync(from, to);
  fs.writeFileSync(path.join(out, "edit-brief.md"), brief);

  return {
    final, cut, srtPath, burned, mode, segments: segs.length, originalDuration: duration, finalDuration: kept2,
    briefPath: path.join(out, "edit-brief.md"), transcribed: Boolean(transcript), ranges, overlays: new Set(ovs.map((o) => o.png)).size, // apoyos dibujados (uno retomado tras otro cuenta una vez)
  };
}
