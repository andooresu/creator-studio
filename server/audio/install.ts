// Instalación de motores de audio locales: ejecuta motion/audio-local/install.sh <motor> (idempotente).
import path from "node:path";
import { spawn } from "node:child_process";
import { load, MOTION_DIR } from "../db.ts";
import { LOCAL_ENGINES, AUDIO_CACHE, HF_HOME, unsupportedReason, invalidateAudioEnv } from "./env.ts";
import type { LocalAudioEngine } from "../../shared/types.ts";

export const INSTALL_SCRIPT = path.join(MOTION_DIR, "audio-local", "install.sh");

const LABEL: Record<LocalAudioEngine, string> = { kokoro: "Kokoro", chatterbox: "Chatterbox", acestep: "ACE-Step 1.5", stableaudio: "Stable Audio Open Small" };

export function isLocalEngine(v: unknown): v is LocalAudioEngine {
  return (LOCAL_ENGINES as unknown[]).includes(v);
}

/** Lanza un Error en español si el motor no se puede instalar en esta máquina (o falta el token de Hugging Face). */
export function checkInstallable(engine: LocalAudioEngine): void {
  if (!isLocalEngine(engine)) throw new Error(`Motor desconocido: ${String(engine)}`);
  const why = unsupportedReason(engine);
  if (why) throw new Error(`${LABEL[engine]}: ${why}`);
  if (engine === "stableaudio" && !load().settings.hfToken) {
    throw new Error("Stable Audio Open necesita un token de Hugging Face: acepta la licencia en huggingface.co/stabilityai/stable-audio-open-small y pega tu token en Ajustes.");
  }
}

/**
 * Instala (o verifica) un motor local. `step` recibe el progreso en español.
 * Rechaza motores no compatibles con esta máquina y Stable Audio sin token de Hugging Face.
 */
export async function installEngine(engine: LocalAudioEngine, step: (msg: string) => void): Promise<void> {
  checkInstallable(engine);
  const hfToken = load().settings.hfToken;
  step(`Instalando ${LABEL[engine]}…`);
  const env: NodeJS.ProcessEnv = { ...process.env, CREATOR_STUDIO_CACHE: AUDIO_CACHE, HF_HOME };
  if (engine === "stableaudio") env.HF_TOKEN = hfToken; // por entorno, nunca en la línea de comandos
  else delete env.HF_TOKEN;

  await new Promise<void>((resolve, reject) => {
    const child = spawn("sh", [INSTALL_SCRIPT, engine], { env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    let last = "";
    const onData = (d: Buffer): void => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      for (const raw of s.split(/\r\n|\r|\n/)) {
        const l = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
        if (!l || l === last || /^[#=\-\s.%0-9]+$/.test(l)) continue; // barras de progreso de curl
        last = l;
        step(l.replace(/^ERROR:\s*/, "").slice(0, 300));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => child.kill("SIGKILL"), 2 * 3600_000);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`No se pudo ejecutar el instalador: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      invalidateAudioEnv(engine);
      if (code === 0) return resolve();
      const err = /ERROR: (.+)/.exec(tail)?.[1]?.trim();
      reject(new Error(err || `La instalación de ${LABEL[engine]} falló (código ${code}): ${tail.trim().split("\n").slice(-4).join(" · ").slice(-500)}`));
    });
  });
  step(`${LABEL[engine]} listo.`);
}
