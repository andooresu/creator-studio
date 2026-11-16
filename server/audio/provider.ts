// Voz, música y efectos del motor de video con el proveedor elegido en Ajustes (settings.audioProvider):
//   elevenlabs  → API REST de ElevenLabs (server/agent/elevenlabs.ts, mismo comportamiento)
//   local       → motores en ~/.cache/creator-studio: Kokoro / Chatterbox (voz), ACE-Step (música), Stable Audio (efectos);
//                 si el motor de música o efectos no está instalado o no es compatible, cae al modo sintetizado y lo dice en `note`
//   sintetizado → voz con `say` de macOS; música con scripts/music.py (guiada por timeline.json); efectos con scripts/sfx.mjs (cues)
// Todas las salidas quedan dentro de `dir` (validado con realpath) y los wav salen a 48 kHz.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { load, MOTION_DIR } from "../db.ts";
import { run, probeDuration } from "../media.ts";
import { runMotion } from "../motion/kit.ts";
import { composeMusic, textToSpeech, soundEffect, listVoices as elevenVoices } from "../agent/elevenlabs.ts";
import {
  enginePython, engineInstalled, unsupportedReason, sayVoices, canSay, KOKORO_MODELS, KOKORO_ES_VOICES, ACESTEP_REPO, HF_HOME,
} from "./env.ts";
import type { AudioProvider, LocalAudioEngine } from "../../shared/types.ts";

const SCRIPTS = path.join(MOTION_DIR, "audio-local");
const KIT_MUSIC = path.join(MOTION_DIR, "scripts", "music.py");

/** Resultado de una generación. Sin `path` = no se escribió archivo (p. ej. efectos sintetizados: ver `note`). */
export interface AudioResult {
  /** ruta relativa a `dir` (con "/") */
  path?: string;
  seconds?: number;
  /** aviso o guía para el agente/la interfaz (respaldo usado, qué hacer después) */
  note?: string;
  provider: AudioProvider;
  /** motor que produjo el audio: "elevenlabs", "kokoro", "chatterbox", "acestep", "stableaudio", "say", "music.py", "sfx.mjs" */
  engine: string;
}
export interface SpeechResult extends AudioResult { path: string; seconds: number }
export interface VoiceOption { id: string; name: string; provider: AudioProvider }

export interface SpeechInput { text: string; voice?: string; dir: string; outRel: string }
export interface MusicInput { prompt: string; seconds?: number; dir: string; outRel?: string; bpm?: number }
export interface SfxInput { prompt: string; seconds?: number; dir: string; outRel?: string }

const provider = (): AudioProvider => load().settings.audioProvider || "sintetizado";

// ---------------------------------------------------------------- rutas seguras
function realPrefix(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (let hops = 0; hops < 64; hops++) {
    try { const r = fs.realpathSync.native(cur); return rest.length ? path.join(r, ...[...rest].reverse()) : r; } catch {}
    try { const st = fs.lstatSync(cur); if (st.isSymbolicLink()) { cur = path.resolve(path.dirname(cur), fs.readlinkSync(cur)); continue; } } catch {}
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.push(path.basename(cur));
    cur = parent;
  }
  return path.resolve(p);
}
const inside = (p: string, root: string): boolean => p === root || p.startsWith(root + path.sep);

/** Resuelve `rel` dentro de `dir` (sin salir, tampoco por enlaces simbólicos), crea la carpeta y devuelve la ruta absoluta. */
function outPath(dir: string, rel: string, exts: string[]): { abs: string; rel: string } {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`La carpeta del proyecto no existe: ${dir}`);
  const clean = String(rel || "").replace(/\\/g, "/").trim();
  if (!clean) throw new Error("Falta la ruta de salida del audio.");
  if (path.isAbsolute(clean)) throw new Error(`Usa una ruta relativa a la carpeta del proyecto (no "${rel}").`);
  const root = path.resolve(dir);
  const realRoot = fs.realpathSync.native(root);
  const abs = path.resolve(root, clean);
  const ext = path.extname(abs).toLowerCase();
  if (!exts.includes(ext)) throw new Error(`La salida debe terminar en ${exts.join(" o ")} (recibí "${rel}").`);
  const outside = `La ruta "${rel}" está fuera de la carpeta del proyecto.`;
  if (!inside(abs, root) || abs === root) throw new Error(outside);
  if (!inside(realPrefix(abs), realRoot)) throw new Error(`${outside} (apunta afuera mediante un enlace simbólico)`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!inside(fs.realpathSync.native(path.dirname(abs)), realRoot)) throw new Error(outside);
  try { if (fs.lstatSync(abs).isSymbolicLink()) fs.rmSync(abs, { force: true }); } catch {}
  return { abs, rel: path.relative(root, abs).split(path.sep).join("/") };
}

function tmpFile(ext: string): string {
  const d = path.join(os.tmpdir(), "creator-studio-audio");
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
}
const rmQuiet = (f: string): void => { try { fs.rmSync(f, { force: true }); } catch {} };

/** Convierte cualquier audio a wav 48 kHz PCM 16 bits (mono para voz, estéreo para música/efectos). */
async function toWav48(src: string, dst: string, channels: 1 | 2): Promise<void> {
  await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-ar", "48000", "-ac", String(channels), "-c:a", "pcm_s16le", dst], { timeoutMs: 10 * 60_000 });
}

/** Escribe el audio final en `out`: .mp3 tal cual si la fuente ya es mp3, si no wav 48 kHz. */
async function place(src: string, srcIsMp3: boolean, out: { abs: string }, channels: 1 | 2): Promise<void> {
  if (path.extname(out.abs).toLowerCase() === ".mp3") {
    if (srcIsMp3) fs.copyFileSync(src, out.abs);
    else await run("ffmpeg", ["-y", "-v", "error", "-i", src, "-ar", "48000", "-ac", String(channels), "-b:a", "192k", out.abs], { timeoutMs: 10 * 60_000 });
  } else await toWav48(src, out.abs, channels);
}

async function seconds(abs: string): Promise<number> {
  try { return Math.round((await probeDuration(abs)) * 1000) / 1000; } catch { return 0; }
}

// ---------------------------------------------------------------- motores locales (un modelo a la vez)
let localTail: Promise<void> = Promise.resolve();
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const prev = localTail;
  let release!: () => void;
  localTail = new Promise<void>((r) => (release = r));
  await prev;
  try { return await fn(); } finally { release(); }
}

const SCRIPT_OF: Record<LocalAudioEngine, string> = {
  kokoro: "tts_kokoro.py", chatterbox: "tts_chatterbox.py", acestep: "music_acestep.py", stableaudio: "sfx_stableaudio.py",
};

/** Ejecuta el script del motor con el Python de su entorno; los argumentos van como JSON por stdin. */
function runLocal(engine: LocalAudioEngine, payload: Record<string, unknown>, timeoutMs: number): Promise<{ path: string; seconds: number; sr: number }> {
  return exclusive(() => new Promise((resolve, reject) => {
    const py = enginePython(engine);
    if (!fs.existsSync(py)) { reject(new Error(`El motor ${engine} no está instalado. Instálalo desde Ajustes → Audio.`)); return; }
    const env: NodeJS.ProcessEnv = { ...process.env, HF_HOME, PYTHONUNBUFFERED: "1", PYTORCH_ENABLE_MPS_FALLBACK: "1" };
    if (engine === "stableaudio" && load().settings.hfToken) env.HF_TOKEN = load().settings.hfToken;
    else delete env.HF_TOKEN;
    const child = spawn(py, ["-I", path.join(SCRIPTS, SCRIPT_OF[engine])], { cwd: os.tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out = (out + d.toString()).slice(-100_000); });
    child.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-20_000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`No se pudo ejecutar ${engine}: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.split("\n").reverse().find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) {
        try { resolve(JSON.parse(line.slice(7))); return; } catch {}
      }
      const msg = err.trim().split("\n").filter(Boolean).slice(-3).join(" · ").slice(-600) || out.trim().slice(-300);
      reject(new Error(`${engine} falló (código ${code}): ${msg}`));
    });
    child.stdin.end(JSON.stringify(payload));
  }));
}

/** true si el motor local se puede usar ahora mismo (compatible e instalado). */
const usable = (e: LocalAudioEngine): boolean => !unsupportedReason(e) && engineInstalled(e);

// ---------------------------------------------------------------- voz
export async function generateSpeech(o: SpeechInput): Promise<SpeechResult> {
  const text = String(o.text || "").trim();
  if (!text) throw new Error("Falta el texto a locutar.");
  const out = outPath(o.dir, o.outRel, [".wav", ".mp3"]);
  const s = load().settings;
  const prov = provider();

  if (prov === "elevenlabs") {
    const voiceId = o.voice || s.elevenVoiceId;
    if (!voiceId) throw new Error("No hay voz de ElevenLabs elegida: pasa voice (de la lista de voces) o define una voz por defecto en Ajustes.");
    const buf = await textToSpeech({ voiceId, text });
    const tmp = tmpFile(".mp3");
    try { fs.writeFileSync(tmp, buf); await place(tmp, true, out, 1); } finally { rmQuiet(tmp); }
    return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine: "elevenlabs" };
  }

  if (prov === "local") {
    const engine: LocalAudioEngine = s.localTtsEngine === "chatterbox" ? "chatterbox" : "kokoro";
    const why = unsupportedReason(engine);
    if (why) throw new Error(`${engine === "kokoro" ? "Kokoro" : "Chatterbox"}: ${why} Cambia el motor de voz en Ajustes → Audio.`);
    if (!engineInstalled(engine)) throw new Error(`El motor de voz ${engine === "kokoro" ? "Kokoro" : "Chatterbox"} no está instalado. Instálalo desde Ajustes → Audio.`);
    let voice = o.voice || s.localVoice || "";
    if (engine === "kokoro") {
      if (!voice || !/^[a-z]{2}_[a-z]+$/.test(voice)) voice = "em_alex";
    } else if (/^[a-z]{2}_[a-z]+$/.test(voice) && !fs.existsSync(path.resolve(o.dir, voice))) {
      voice = ""; // id de Kokoro que quedó de antes: Chatterbox usa su voz por defecto
    } else if (voice) {
      // Chatterbox clona una muestra: ruta absoluta o relativa a la carpeta del proyecto, debe existir.
      const ref = path.isAbsolute(voice) ? voice : path.resolve(o.dir, voice);
      if (!fs.existsSync(ref) || !fs.statSync(ref).isFile()) throw new Error(`No encuentro la muestra de voz para clonar: ${voice}`);
      voice = ref;
    }
    const raw = tmpFile(".wav");
    try {
      const payload: Record<string, unknown> = { text, voice, out: raw, lang: "es" };
      if (engine === "kokoro") Object.assign(payload, KOKORO_MODELS);
      await runLocal(engine, payload, 30 * 60_000);
      await place(raw, false, out, 1);
    } finally { rmQuiet(raw); }
    return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine };
  }

  // sintetizado: say de macOS
  if (!canSay()) throw new Error('El modo sintetizado necesita macOS (comando "say"). Usa el modo local con Kokoro o ElevenLabs.');
  const voices = sayVoices();
  const voice = o.voice || s.sayVoice || "Paulina";
  if (voices.length && !voices.includes(voice)) throw new Error(`La voz "${voice}" no está instalada en este Mac. Voces en español: ${voices.join(", ")}.`);
  const txt = tmpFile(".txt");
  const aiff = tmpFile(".aiff");
  try {
    fs.writeFileSync(txt, text); // por archivo: un texto que empiece con "-" no se confunde con una opción
    await run("say", ["-v", voice, "-o", aiff, "-f", txt], { timeoutMs: 10 * 60_000 });
    await place(aiff, false, out, 1);
  } finally { rmQuiet(txt); rmQuiet(aiff); }
  return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine: "say" };
}

// ---------------------------------------------------------------- música
const MUSIC_GUIDE = (prompt: string): string =>
  "Música sintetizada con scripts/music.py a partir de timeline.json: el prompt no se usa directamente. Antes de generar, fija en timeline.json " +
  "bpm, duration, marks y music.chords (un acorde por compás), music.sections (intro/full/dark/build/gap/drop/outro en beats o marcas), " +
  `music.accents y music.seed para que suene como: «${prompt.slice(0, 300)}». Si cambias esos campos, vuelve a generar.`;

async function synthMusic(o: MusicInput, prov: AudioProvider, prefix = ""): Promise<AudioResult> {
  const root = path.resolve(o.dir);
  if (!fs.existsSync(path.join(root, "timeline.json"))) throw new Error("No hay timeline.json en la carpeta del proyecto: prepara el motor del proyecto antes de generar música.");
  if (!fs.existsSync(KIT_MUSIC)) throw new Error("Falta motion/scripts/music.py en el kit del estudio.");
  outPath(root, "audio/music.wav", [".wav"]); // valida audio/ dentro del proyecto
  // Siempre el music.py del kit (ruta absoluta), nunca la copia editable del proyecto; preflight revisa enlaces y módulos.
  const r = await runMotion(root, "python", ["-I", KIT_MUSIC], { preflight: true, timeoutMs: 15 * 60_000 });
  if (r.code !== 0) throw new Error(`music.py falló (código ${r.code}): ${r.out.trim().split(/\r|\n/).slice(-5).join(" · ").slice(-600)}`);
  let rel = "audio/music.wav";
  const made = outPath(root, rel, [".wav"]);
  if (!fs.existsSync(made.abs)) throw new Error("music.py terminó pero no encontré audio/music.wav.");
  if (o.outRel && o.outRel.replace(/^\.\//, "") !== rel) {
    const dst = outPath(root, o.outRel, [".wav", ".mp3"]);
    await place(made.abs, false, dst, 2);
    rel = dst.rel;
  }
  const warn = /WARNING: (.+)/.exec(r.out)?.[1];
  const note = [prefix, MUSIC_GUIDE(o.prompt), warn ? `Aviso de music.py: ${warn}` : "", "También quedó audio/drums.wav (stem de batería para medir beats)."].filter(Boolean).join(" ");
  return { path: rel, seconds: await seconds(path.join(root, rel)), note, provider: prov, engine: "music.py" };
}

export async function generateMusic(o: MusicInput): Promise<AudioResult> {
  const prompt = String(o.prompt || "").trim();
  if (!prompt) throw new Error("Falta la descripción de la música.");
  const prov = provider();
  const secs = o.seconds && o.seconds > 0 ? o.seconds : undefined;

  if (prov === "elevenlabs") {
    const out = outPath(o.dir, o.outRel || "audio/music.wav", [".wav", ".mp3"]);
    const buf = await composeMusic({ prompt, lengthSeconds: secs });
    const tmp = tmpFile(".mp3");
    try { fs.writeFileSync(tmp, buf); await place(tmp, true, out, 2); } finally { rmQuiet(tmp); }
    return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine: "elevenlabs" };
  }

  if (prov === "local") {
    if (usable("acestep")) {
      const out = outPath(o.dir, o.outRel || "audio/music.wav", [".wav", ".mp3"]);
      const raw = tmpFile(".wav");
      try {
        await runLocal("acestep", { prompt, seconds: secs || 30, out: raw, repo: ACESTEP_REPO, ...(o.bpm ? { bpm: o.bpm } : {}) }, 60 * 60_000);
        await place(raw, false, out, 2);
      } finally { rmQuiet(raw); }
      return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine: "acestep" };
    }
    const why = unsupportedReason("acestep") || "ACE-Step no está instalado.";
    return synthMusic({ ...o, prompt }, prov, `Respaldo: música sintetizada en lugar de ACE-Step (${why})`);
  }

  return synthMusic({ ...o, prompt }, prov);
}

// ---------------------------------------------------------------- efectos
const SFX_GUIDE =
  "Los efectos se sintetizan con scripts/sfx.mjs a partir de las marcas: define los cues (click, tick, pop, thump, whoosh, riser, shutter) " +
  "en el timeline, ejecuta scripts/sync.mjs (genera cues.json) y luego scripts/sfx.mjs → audio/sfx.wav. No se generó ningún archivo ahora.";

const slug = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "efecto";

export async function generateSfx(o: SfxInput): Promise<AudioResult> {
  const prompt = String(o.prompt || "").trim();
  if (!prompt) throw new Error("Falta la descripción del efecto.");
  const prov = provider();
  const outRel = o.outRel || `audio/sfx_samples/${slug(prompt)}.wav`;

  if (prov === "elevenlabs") {
    const out = outPath(o.dir, outRel, [".wav", ".mp3"]);
    const buf = await soundEffect({ text: prompt, durationSeconds: o.seconds });
    const tmp = tmpFile(".mp3");
    try { fs.writeFileSync(tmp, buf); await place(tmp, true, out, 2); } finally { rmQuiet(tmp); }
    return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine: "elevenlabs" };
  }

  if (prov === "local") {
    if (usable("stableaudio")) {
      const out = outPath(o.dir, outRel, [".wav", ".mp3"]);
      const raw = tmpFile(".wav");
      try {
        await runLocal("stableaudio", { prompt, seconds: o.seconds || 3, out: raw }, 30 * 60_000);
        await place(raw, false, out, 2);
      } finally { rmQuiet(raw); }
      const note = o.seconds && o.seconds > 11 ? "Stable Audio Open Small genera como máximo 11 s: se recortó." : undefined;
      return { path: out.rel, seconds: await seconds(out.abs), provider: prov, engine: "stableaudio", ...(note ? { note } : {}) };
    }
    const why = unsupportedReason("stableaudio") || "Stable Audio no está instalado.";
    return { note: `Respaldo: efectos sintetizados en lugar de Stable Audio (${why}) ${SFX_GUIDE}`, provider: prov, engine: "sfx.mjs" };
  }

  return { note: SFX_GUIDE, provider: prov, engine: "sfx.mjs" };
}

// ---------------------------------------------------------------- voces
export async function listVoices(): Promise<VoiceOption[]> {
  const prov = provider();
  const s = load().settings;
  if (prov === "elevenlabs") {
    const r = await elevenVoices({ pageSize: 100 });
    return r.voices.map((v) => {
      const tags = [v.labels?.accent, v.labels?.gender, v.labels?.language].filter(Boolean).join(", ");
      return { id: v.voice_id, name: tags ? `${v.name} (${tags})` : v.name, provider: prov };
    });
  }
  if (prov === "local") {
    if (s.localTtsEngine === "chatterbox") {
      const out: VoiceOption[] = [{ id: "", name: "Voz por defecto de Chatterbox", provider: prov }];
      if (s.localVoice) out.push({ id: s.localVoice, name: `Clonada de ${path.basename(s.localVoice)}`, provider: prov });
      return out;
    }
    return KOKORO_ES_VOICES.map((v) => ({ id: v.id, name: v.name, provider: prov }));
  }
  return sayVoices().map((v) => ({ id: v, name: v, provider: prov }));
}
