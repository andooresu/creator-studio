// Entorno de audio del motor de video: hardware, motores locales instalados y voces de macOS.
// Los tres modos (settings.audioProvider): "elevenlabs" (API), "local" (Kokoro/Chatterbox + ACE-Step/Stable Audio)
// y "sintetizado" (voz con `say` de macOS + música y efectos sintetizados por los scripts del motor).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { load } from "../db.ts";
import "../media.ts"; // amplía PATH (ffmpeg, uv, whisper en ~/.local/bin, /opt/homebrew/bin…)
import type { AudioEnv, AudioEngineStatus, LocalAudioEngine } from "../../shared/types.ts";

export const LOCAL_ENGINES: LocalAudioEngine[] = ["kokoro", "chatterbox", "acestep", "stableaudio"];

/** Raíz de los motores locales (por máquina, fuera del repo). */
export const AUDIO_CACHE = process.env.CREATOR_STUDIO_CACHE ? path.resolve(process.env.CREATOR_STUDIO_CACHE) : path.join(os.homedir(), ".cache", "creator-studio");
export const ENVS_DIR = path.join(AUDIO_CACHE, "envs");
export const KOKORO_MODELS = { model: path.join(AUDIO_CACHE, "kokoro", "kokoro-v1.0.onnx"), voices: path.join(AUDIO_CACHE, "kokoro", "voices-v1.0.bin") };
export const ACESTEP_REPO = path.join(AUDIO_CACHE, "ace-step");
export const HF_HOME = path.join(AUDIO_CACHE, "hf");
const STABLEAUDIO_MARKER = path.join(HF_HOME, ".stableaudio-ok");

/** Python del entorno propio de un motor. */
export function enginePython(engine: LocalAudioEngine): string {
  return path.join(ENVS_DIR, engine, "bin", "python");
}

/** Voces de Kokoro en español (kokoro-onnx v1.0). */
export const KOKORO_ES_VOICES: { id: string; name: string }[] = [
  { id: "em_alex", name: "Alex (hombre)" },
  { id: "em_santa", name: "Santa (hombre)" },
  { id: "ef_dora", name: "Dora (mujer)" },
];

const MODULES: Record<LocalAudioEngine, string[]> = {
  kokoro: ["kokoro_onnx", "soundfile"],
  chatterbox: ["chatterbox", "soundfile"],
  acestep: ["acestep", "soundfile"],
  stableaudio: ["stable_audio_tools", "soundfile"],
};
const SIZE: Record<LocalAudioEngine, string> = {
  kokoro: "≈ 400 MB (modelo de 340 MB + onnxruntime, sin PyTorch)",
  chatterbox: "≈ 4 GB (PyTorch + modelo de voz)",
  acestep: "≈ 10 GB (PyTorch + modelos de ~5 GB)",
  stableaudio: "≈ 4 GB (PyTorch + modelo; requiere token de Hugging Face)",
};
const ROLE: Record<LocalAudioEngine, string> = {
  kokoro: "voz",
  chatterbox: "voz (clona una muestra)",
  acestep: "música",
  stableaudio: "efectos",
};

// ---------------------------------------------------------------- hardware
type Accel = AudioEnv["hardware"]["accel"];
let accelCache: Accel | null = null;
export function detectAccel(): Accel {
  if (accelCache) return accelCache;
  if (process.platform === "darwin" && process.arch === "arm64") accelCache = "apple-silicon";
  else {
    const r = spawnSync("nvidia-smi", ["-L"], { stdio: "pipe", timeout: 5000 });
    accelCache = r.status === 0 && /GPU/i.test(String(r.stdout)) ? "cuda" : "cpu";
  }
  return accelCache;
}

function osLabel(): string {
  if (process.platform === "darwin") {
    try { return `macOS ${execFileSync("sw_vers", ["-productVersion"], { stdio: "pipe" }).toString().trim()}`; } catch { return "macOS"; }
  }
  return `${os.type()} ${os.release()}`;
}

function hasCmd(cmd: string): boolean {
  try { execFileSync("which", [cmd], { stdio: "pipe" }); return true; } catch { return false; }
}

/** Por qué un motor no se puede usar en esta máquina (null = compatible). */
export function unsupportedReason(engine: LocalAudioEngine): string | null {
  if (engine === "kokoro") return null; // onnxruntime en CPU: funciona en cualquier Mac o PC
  const accel = detectAccel();
  if (accel !== "cpu") return null;
  if (process.platform === "darwin") {
    return "No compatible con este Mac Intel: PyTorch ya no publica versiones para macOS x86_64. Funciona en Mac con Apple Silicon (M1 o superior) o en equipos con GPU NVIDIA.";
  }
  return "Necesita una GPU (Apple Silicon o NVIDIA con CUDA); no se detectó ninguna en este equipo.";
}

// ---------------------------------------------------------------- instalados (con caché)
// Positivo: se guarda hasta invalidar (tras instalar). Negativo: se reintenta como mucho cada 30 s.
const installedCache = new Map<LocalAudioEngine, { ok: boolean; at: number }>();

function modulesImportable(engine: LocalAudioEngine): boolean {
  const py = enginePython(engine);
  if (!fs.existsSync(py)) return false;
  const code = "import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in sys.argv[1:]) else 1)";
  const r = spawnSync(py, ["-I", "-c", code, ...MODULES[engine]], { stdio: "pipe", timeout: 20_000 });
  return r.status === 0;
}

const fileOver = (f: string, minBytes: number): boolean => { try { return fs.statSync(f).size >= minBytes; } catch { return false; } };

export function engineInstalled(engine: LocalAudioEngine): boolean {
  const c = installedCache.get(engine);
  if (c && (c.ok || Date.now() - c.at < 30_000)) return c.ok;
  let ok = false;
  if (engine === "kokoro") ok = fileOver(KOKORO_MODELS.model, 100e6) && fileOver(KOKORO_MODELS.voices, 1e6) && modulesImportable(engine);
  else if (engine === "acestep") ok = fs.existsSync(path.join(ACESTEP_REPO, ".git")) && modulesImportable(engine);
  else if (engine === "stableaudio") ok = fs.existsSync(STABLEAUDIO_MARKER) && modulesImportable(engine);
  else ok = modulesImportable(engine);
  installedCache.set(engine, { ok, at: Date.now() });
  return ok;
}

/** Olvida lo que se sabe de los motores (llamar al terminar una instalación). */
export function invalidateAudioEnv(engine?: LocalAudioEngine): void {
  if (engine) installedCache.delete(engine);
  else installedCache.clear();
}

function engineStatus(engine: LocalAudioEngine): AudioEngineStatus {
  const why = unsupportedReason(engine);
  if (why) return { supported: false, installed: false, note: why, sizeHint: SIZE[engine] };
  const installed = engineInstalled(engine);
  let note: string | undefined;
  if (!installed) {
    if (engine === "stableaudio" && !load().settings.hfToken) note = `Para ${ROLE[engine]}. Antes de instalar: acepta la licencia de stabilityai/stable-audio-open-small en Hugging Face y pega tu token en Ajustes.`;
    else if (!hasCmd("uv")) note = "Falta uv (gestor de Python): instálalo con curl -LsSf https://astral.sh/uv/install.sh | sh";
    else note = `Para ${ROLE[engine]}. Sin instalar.`;
  } else if (engine === "chatterbox") note = "Instalado. La primera voz descarga el modelo (~2 GB).";
  else if (engine === "acestep") note = "Instalado. La primera canción descarga los modelos (~5 GB).";
  return { supported: true, installed, ...(note ? { note } : {}), sizeHint: SIZE[engine] };
}

// ---------------------------------------------------------------- voces de macOS
let sayCache: string[] | null = null;
/** Voces de `say -v ?` en español (es_ES, es_MX…): "Paulina", "Mónica", "Eddy (Spanish (Mexico))"… */
export function sayVoices(): string[] {
  if (sayCache) return sayCache;
  if (process.platform !== "darwin") return (sayCache = []);
  try {
    const out = execFileSync("say", ["-v", "?"], { stdio: "pipe", timeout: 10_000 }).toString();
    const names: string[] = [];
    for (const line of out.split("\n")) {
      // "Paulina             es_MX    # Hola, me llamo Paulina…"  /  "Eddy (Spanish (Mexico)) es_MX    # …"
      const m = /^(.+?)\s+(es_[A-Z]{2})\s+#/.exec(line);
      if (m && !names.includes(m[1].trim())) names.push(m[1].trim());
    }
    sayCache = names;
  } catch { sayCache = []; }
  return sayCache;
}

export function canSay(): boolean {
  return process.platform === "darwin" && hasCmd("say");
}

// ---------------------------------------------------------------- estado completo
export function audioEnv(): AudioEnv {
  const s = load().settings;
  const provider = s.audioProvider || "sintetizado";
  const engines = Object.fromEntries(LOCAL_ENGINES.map((e) => [e, engineStatus(e)])) as Record<LocalAudioEngine, AudioEngineStatus>;
  const voices = sayVoices();
  const issues: string[] = [];
  let ready = false;
  const ffmpeg = hasCmd("ffmpeg");

  if (provider === "elevenlabs") {
    ready = Boolean(s.elevenlabsKey);
    if (!ready) issues.push("Falta la API key de ElevenLabs: agrégala en Ajustes o cambia a modo local o sintetizado.");
  } else if (provider === "local") {
    const tts = s.localTtsEngine === "chatterbox" ? "chatterbox" : "kokoro";
    const st = engines[tts];
    ready = st.supported && st.installed;
    if (!st.supported) issues.push(`El motor de voz ${tts === "kokoro" ? "Kokoro" : "Chatterbox"} no funciona en esta máquina: ${st.note}`);
    else if (!st.installed) issues.push(`Instala el motor de voz ${tts === "kokoro" ? "Kokoro" : "Chatterbox"} (${st.sizeHint}) desde Ajustes → Audio.`);
    const why = (e: LocalAudioEngine): string => (engines[e].supported ? "no está instalado" : "no es compatible con esta máquina");
    if (!engines.acestep.installed) issues.push(`Aviso: ACE-Step ${why("acestep")}; la música se sintetiza con el motor (gratis, guiada por timeline.json).`);
    if (!engines.stableaudio.installed) issues.push(`Aviso: Stable Audio ${why("stableaudio")}; los efectos se sintetizan con el motor desde las marcas.`);
  } else {
    ready = canSay();
    if (!ready) issues.push('El modo sintetizado necesita macOS (comando "say"). Usa el modo local con Kokoro o ElevenLabs.');
    else if (s.sayVoice && voices.length && !voices.includes(s.sayVoice)) issues.push(`La voz "${s.sayVoice}" no está instalada en este Mac. Elige una de: ${voices.join(", ")}.`);
  }
  if (!ffmpeg) { ready = false; issues.push("Falta ffmpeg: instálalo (por ejemplo con Homebrew: brew install ffmpeg)."); }

  return {
    provider,
    hardware: { arch: process.arch, accel: detectAccel(), os: osLabel() },
    engines,
    sayVoices: voices,
    ready,
    issues,
  };
}
