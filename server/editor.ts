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

export interface AutoEditOptions {
  input: string;
  dir: string;
  concept?: Concept | null;
  plan?: Pick<EditPlan, "segments"> | null;
  words?: Word[] | null;
  brollDir?: string;
  onStep?: (msg: string) => void;
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
}

export async function autoEdit({ input, dir, concept, plan, words, brollDir = "", onStep = () => {} }: AutoEditOptions): Promise<AutoEditResult> {
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
  const enc = await videoEncoder();
  const common = [...filterComplexArgs(filter, filterFile), "-map", "[vout]", "-map", "[aout]", "-pix_fmt", "yuv420p",
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", cut];
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
    try { transcript = await transcribe(cut, out); } catch (e) { onStep("Transcripción falló: " + (e instanceof Error ? e.message : String(e))); }
  }
  let srtPath: string | null = null;
  if (transcript?.words?.length) {
    srtPath = path.join(out, "subtitulos.srt");
    fs.writeFileSync(srtPath, wordsToCaptionSrt(transcript.words));
    fs.writeFileSync(path.join(out, "transcript.json"), JSON.stringify(transcript, null, 2));
  }

  let final = cut;
  let burned = false;
  if (srtPath && t.subtitlesFilter) {
    onStep("Quemando subtítulos…");
    const color = (concept?.subtitulos?.colorAcento || "#FFD400").replace("#", "");
    const bgr = color.length === 6 ? color.slice(4, 6) + color.slice(2, 4) + color.slice(0, 2) : "00D4FF";
    const style = `FontName=Montserrat ExtraBold,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=90,SecondaryColour=&H00${bgr}`;
    final = path.join(out, "final.mp4");
    await run("ffmpeg", ["-y", "-i", cut, "-vf", `subtitles=${srtPath.replace(/:/g, "\\:")}:force_style='${style}'`, "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-c:a", "copy", "-movflags", "+faststart", final], { timeoutMs: 60 * 60 * 1000 });
    burned = true;
  }

  // Brief para el pulido avanzado con Claude Code (Remotion / HyperFrames)
  const brief = `# Brief de edición — pulido avanzado
Video base (ya cortado y en 9:16): ${final}
Subtítulos palabra a palabra: ${srtPath || "(sin transcripción — instala whisper)"}
Transcripción con tiempos: ${transcript ? path.join(out, "transcript.json") : "-"}

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
  fs.writeFileSync(path.join(out, "edit-brief.md"), brief);

  return {
    final, cut, srtPath, burned, mode, segments: segs.length, originalDuration: duration, finalDuration: kept2,
    briefPath: path.join(out, "edit-brief.md"), transcribed: Boolean(transcript),
  };
}
