// Herramientas locales de medios: yt-dlp, ffmpeg, whisper.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Tools, Word, Reference } from "../shared/types.ts";

// Asegura que encontramos herramientas instaladas en ~/.local/bin (whisper-cli, yt-dlp) aunque se abra con doble clic.
const LOCAL_BIN = path.join(os.homedir(), ".local/bin");
if (!(process.env.PATH || "").split(":").includes(LOCAL_BIN)) process.env.PATH = `${LOCAL_BIN}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ""}`;

export interface RunOptions { cwd?: string; timeoutMs?: number }
export interface RunResult { out: string; err: string }

export function run(cmd: string, args: string[], { cwd, timeoutMs = 15 * 60 * 1000 }: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let out = "";
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d: Buffer) => (out += d));
    p.stderr.on("data", (d: Buffer) => (err += d));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} falló (${code}): ${err.slice(-600)}`));
    });
  });
}

function has(cmd: string): boolean {
  try { execFileSync("which", [cmd], { stdio: "pipe" }); return true; } catch { return false; }
}

const WHISPER_MODELS: string[] = [
  process.env.WHISPER_MODEL,
  path.join(os.homedir(), ".cache/whisper/ggml-small.bin"),
  path.join(os.homedir(), ".cache/whisper/ggml-base.bin"),
  "/usr/local/share/whisper-cpp/ggml-base.bin",
  "/opt/homebrew/share/whisper-cpp/ggml-base.bin",
  "/opt/homebrew/share/whisper-cpp/ggml-small.bin",
].filter((m): m is string => Boolean(m));

export function tools(): Tools {
  let subtitlesFilter = false;
  try {
    subtitlesFilter = / subtitles /.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"], { stdio: "pipe" }).toString());
  } catch {}
  const whisperModel = WHISPER_MODELS.find((m) => fs.existsSync(m)) || null;
  return {
    ffmpeg: has("ffmpeg"),
    ytdlp: has("yt-dlp"),
    whisperCpp: has("whisper-cli") && Boolean(whisperModel),
    whisperCppBinary: has("whisper-cli"),
    whisperModel,
    whisperPy: has("whisper"),
    subtitlesFilter,
  };
}

export async function probeDuration(file: string): Promise<number> {
  const { out } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(out) || 0;
}

export type ReferenceInfo = NonNullable<Reference["info"]>;
export interface DownloadedReference { video: string | null; info: ReferenceInfo; subtitles: string }

/** Campos de yt-dlp .info.json que usamos. */
interface YtdlpInfo {
  title?: string; description?: string; uploader?: string; channel?: string; duration?: number;
  view_count?: number; like_count?: number; comment_count?: number; upload_date?: string; extractor_key?: string;
}

/** Descarga un reel/tiktok/short con metadatos y subtítulos si existen. */
export async function downloadReference(url: string, dir: string, cookiesBrowser?: string | null): Promise<DownloadedReference> {
  const args = ["--no-playlist", "-f", "mp4/best[ext=mp4]/best", "-o", path.join(dir, "ref.%(ext)s"),
    "--write-info-json", "--write-subs", "--write-auto-subs", "--sub-langs", "es.*,en.*", "--convert-subs", "srt",
    "--max-filesize", "300M"];
  if (cookiesBrowser) args.push("--cookies-from-browser", cookiesBrowser);
  args.push(url);
  await run("yt-dlp", args, { timeoutMs: 5 * 60 * 1000 });
  const files = fs.readdirSync(dir);
  const video = files.find((f) => /^ref\.(mp4|mov|webm|mkv)$/.test(f));
  const infoFile = files.find((f) => f.endsWith(".info.json"));
  const subFile = files.find((f) => f.endsWith(".srt"));
  let info: ReferenceInfo = {};
  if (infoFile) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, infoFile), "utf8")) as YtdlpInfo;
    info = {
      title: j.title, description: j.description, uploader: j.uploader || j.channel, duration: j.duration,
      views: j.view_count, likes: j.like_count, comments: j.comment_count, uploadDate: j.upload_date, platform: j.extractor_key,
    };
  }
  const subtitles = subFile ? srtToText(fs.readFileSync(path.join(dir, subFile), "utf8")) : "";
  return { video: video ? path.join(dir, video) : null, info, subtitles };
}

export interface ExtractedFrame { t: number; file: string }
export interface ExtractedFrames { duration: number; frames: ExtractedFrame[] }

/** Extrae N fotogramas repartidos (JPEG, 512px de ancho) para que Claude "vea" el video. */
export async function extractFrames(file: string, dir: string, n = 10): Promise<ExtractedFrames> {
  const dur = await probeDuration(file);
  const framesDir = path.join(dir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  const out: ExtractedFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, (dur * (i + 0.5)) / n);
    const f = path.join(framesDir, `f${String(i).padStart(2, "0")}.jpg`);
    await run("ffmpeg", ["-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", f]);
    out.push({ t: +t.toFixed(1), file: f });
  }
  return { duration: dur, frames: out };
}

export interface Transcript { text: string; words: Word[] }

interface WhisperCppJson {
  transcription?: { tokens?: { text?: string; offsets: { from: number; to: number } }[] }[];
}
interface WhisperPyJson {
  text: string;
  segments: { words?: { word: string; start: number; end: number }[] }[];
}

/** Transcribe con whisper.cpp o whisper (Python). Devuelve {text, words:[{w,s,e}]} o null. */
export async function transcribe(file: string, dir: string): Promise<Transcript | null> {
  const t = tools();
  const wav = path.join(dir, "audio16k.wav");
  await run("ffmpeg", ["-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", wav]);
  if (t.whisperCpp && t.whisperModel) {
    const base = path.join(dir, "whisper");
    // JSON completo con tiempos por token: más precisos que partir por palabra (-ml 1), que desplaza hasta ~0.8 s.
    await run("whisper-cli", ["-m", t.whisperModel, "-f", wav, "-l", "es", "-t", "4", "-ojf", "-of", base, "-np"], { timeoutMs: 30 * 60 * 1000 });
    const j = JSON.parse(fs.readFileSync(base + ".json", "utf8")) as WhisperCppJson;
    const words: Word[] = [];
    for (const seg of j.transcription || []) {
      for (const tk of seg.tokens || []) {
        const txt = tk.text || "";
        if (!txt.trim() || /^\[_/.test(txt)) continue; // tokens especiales [_BEG_], [_TT_…]
        const s = tk.offsets.from / 1000, e = tk.offsets.to / 1000;
        const last = words[words.length - 1];
        // un token que no empieza con espacio continúa la palabra anterior (ej. "comet" + "í" + ",")
        // la puntuación suele "absorber" el silencio que sigue: se agrega el signo sin alargar la palabra
        if (last && !/^\s/.test(txt)) { last.w += txt; if (!/^[\p{P}]+$/u.test(txt)) last.e = e; }
        else words.push({ w: txt.trim(), s, e });
      }
    }
    const clean = words.filter((x) => x.w && !/^[\[(].*[\])]$/.test(x.w));
    return { text: clean.map((x) => x.w).join(" "), words: clean };
  }
  if (t.whisperPy) {
    await run("whisper", [wav, "--model", "small", "--language", "es", "--word_timestamps", "True", "--output_format", "json", "--output_dir", dir], { timeoutMs: 30 * 60 * 1000 });
    const j = JSON.parse(fs.readFileSync(path.join(dir, "audio16k.json"), "utf8")) as WhisperPyJson;
    const words: Word[] = j.segments.flatMap((s) => (s.words || []).map((w) => ({ w: w.word.trim(), s: w.start, e: w.end })));
    return { text: j.text.trim(), words };
  }
  return null;
}

function toSec(ts: string): number {
  const [h, m, rest] = ts.split(":");
  return +h * 3600 + +m * 60 + parseFloat(rest.replace(",", "."));
}

export interface SrtCue { s: number; e: number; text: string }

export function parseSrt(srt: string): SrtCue[] {
  return srt.split(/\r?\n\r?\n/).map((block): SrtCue | null => {
    const lines = block.trim().split(/\r?\n/);
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) return null;
    const [a, b] = tl.split("-->").map((x) => x.trim());
    return { s: toSec(a), e: toSec(b), text: lines.slice(lines.indexOf(tl) + 1).join(" ").trim() };
  }).filter((c): c is SrtCue => Boolean(c));
}

function srtToText(srt: string): string {
  const seen = new Set<string>();
  return parseSrt(srt).map((c) => c.text).filter((t) => (seen.has(t) ? false : seen.add(t))).join(" ");
}

export function fmtSrtTime(s: number): string {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** Agrupa palabras en bloques cortos estilo reel (máx 3 palabras / 1.2 s). */
export function wordsToCaptionSrt(words: Word[], maxWords = 3): string {
  const cues: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    const span = cur[cur.length - 1].e - cur[0].s;
    if (cur.length >= maxWords || span > 1.2 || /[.,!?¿¡]$/.test(w.w)) { cues.push(cur); cur = []; }
  }
  if (cur.length) cues.push(cur);
  return cues.map((c, i) => `${i + 1}\n${fmtSrtTime(c[0].s)} --> ${fmtSrtTime(Math.min(c[c.length - 1].e, c[c.length - 1].s + 0.9))}\n${c.map((x) => x.w).join(" ").toUpperCase()}\n`).join("\n");
}
