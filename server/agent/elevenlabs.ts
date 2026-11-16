// Cliente REST de ElevenLabs (música, voz, efectos y catálogo de voces) con la key de Ajustes.
// Endpoints verificados en la referencia oficial (elevenlabs.io/docs/api-reference, nov-2026):
//   POST /v1/music                     { prompt, music_length_ms (3000–600000), model_id, force_instrumental }
//   POST /v1/text-to-speech/{voice_id} { text, model_id, language_code?, voice_settings? }   ?output_format=
//   POST /v1/sound-generation          { text, duration_seconds (0.5–30), prompt_influence (0–1), loop, model_id }
//   GET  /v2/voices                    ?search&page_size(≤100)&category&language&gender&age&accent&next_page_token
// Autenticación: cabecera xi-api-key. Todas las respuestas de audio llegan como archivo binario.
import { load } from "../db.ts";

const BASE = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";

/** Modelos por defecto (configurables: Ajustes para TTS; variables de entorno para música y efectos). */
export const ELEVEN_DEFAULTS = {
  tts: "eleven_v4",
  music: "music_v2_5",
  sfx: "eleven_text_to_sound_v3",
} as const;

export function ttsModel(): string {
  return load().settings.elevenTtsModel || ELEVEN_DEFAULTS.tts;
}
export function musicModel(): string {
  return process.env.STUDIO_ELEVEN_MUSIC_MODEL || ELEVEN_DEFAULTS.music;
}
export function sfxModel(): string {
  return process.env.STUDIO_ELEVEN_SFX_MODEL || ELEVEN_DEFAULTS.sfx;
}

function apiKey(): string {
  const k = load().settings.elevenlabsKey;
  if (!k) throw new Error("Falta la API key de ElevenLabs. Agrégala en Ajustes para generar música, voz y efectos.");
  return k;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

async function call(pathAndQuery: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number }): Promise<Response> {
  const key = apiKey();
  let res: Response;
  try {
    res = await fetch(BASE + pathAndQuery, {
      method: init.method,
      headers: { "xi-api-key": key, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), Accept: "*/*" },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 5 * 60_000),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error("ElevenLabs tardó demasiado en responder. Intenta de nuevo.");
    throw new Error(`No se pudo conectar con ElevenLabs: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(await describeError(res));
  return res;
}

async function describeError(res: Response): Promise<string> {
  let detail = "";
  let status = ""; // detail.status de ElevenLabs: quota_exceeded, invalid_api_key, missing_permissions…
  try {
    const txt = await res.text();
    try {
      const j = JSON.parse(txt) as { detail?: unknown; message?: string; status?: string };
      const d = j.detail;
      if (typeof d === "string") detail = d;
      else if (Array.isArray(d)) detail = d.map((x: { loc?: unknown[]; msg?: string }) => `${(x.loc || []).join(".")}: ${x.msg}`).join("; ");
      else if (d && typeof d === "object") {
        const o = d as { message?: string; status?: string; code?: string };
        status = String(o.status || o.code || "");
        detail = o.message || o.status || JSON.stringify(d);
      } else detail = j.message || (/^\s*\{\s*\}\s*$/.test(txt) ? "" : txt);
      if (!status && typeof j.status === "string") status = j.status;
    } catch { detail = txt; }
  } catch {}
  detail = detail.slice(0, 400);
  const extra = detail ? ` ${detail}` : "";
  // La cuota agotada llega como 401 con status "quota_exceeded": se revisa antes que la API key.
  if (status === "quota_exceeded" || res.status === 402 || /quota|credits|insufficient/i.test(detail)) {
    return `ElevenLabs: sin créditos suficientes en tu cuenta (o tu plan no incluye esta función). Revisa tu saldo en ElevenLabs; la API key es válida.${extra}`;
  }
  if (status === "missing_permissions" || /missing.?permission/i.test(detail)) {
    return `ElevenLabs: la API key no tiene permiso para esta función (música, voz o efectos). Activa ese permiso en la key desde ElevenLabs o usa otra key en Ajustes.${extra}`;
  }
  if (status === "detected_unusual_activity") return `ElevenLabs bloqueó la solicitud por actividad inusual en la cuenta. Revisa tu cuenta de ElevenLabs.${extra}`;
  if (status === "invalid_api_key" || res.status === 401) return `ElevenLabs rechazó la API key (401). Revísala en Ajustes.${extra}`;
  if (res.status === 422) return `ElevenLabs: parámetros inválidos.${extra}`;
  if (res.status === 429) return `ElevenLabs: demasiadas solicitudes a la vez (429). Espera un momento.${extra}`;
  return `ElevenLabs respondió ${res.status}.${extra}`;
}

async function audio(res: Response): Promise<Buffer> {
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("ElevenLabs devolvió un audio vacío.");
  return buf;
}

// ---------- Música ----------
export interface MusicOptions {
  prompt: string;
  /** duración pedida en segundos (3–600). Sin valor: la decide el modelo. */
  lengthSeconds?: number;
  instrumental?: boolean;
  model?: string;
  outputFormat?: string;
}
export async function composeMusic(o: MusicOptions): Promise<Buffer> {
  if (!o.prompt?.trim()) throw new Error("Falta la descripción de la música.");
  const body: Record<string, unknown> = {
    prompt: o.prompt,
    model_id: o.model || musicModel(),
    force_instrumental: o.instrumental !== false,
  };
  if (o.lengthSeconds) body.music_length_ms = Math.round(clamp(o.lengthSeconds, 3, 600) * 1000);
  const q = new URLSearchParams({ output_format: o.outputFormat || "mp3_44100_192" });
  return audio(await call(`/v1/music?${q}`, { method: "POST", body, timeoutMs: 10 * 60_000 }));
}

// ---------- Voz (texto a voz) ----------
export interface VoiceSettings { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean; speed?: number }
export interface TtsOptions {
  voiceId: string;
  text: string;
  model?: string;
  languageCode?: string;
  voiceSettings?: VoiceSettings;
  outputFormat?: string;
}
export async function textToSpeech(o: TtsOptions): Promise<Buffer> {
  if (!o.voiceId) throw new Error("Falta el voice_id (usa elevenlabs_voices para elegir una voz).");
  if (!o.text?.trim()) throw new Error("Falta el texto a locutar.");
  const model = o.model || ttsModel();
  const body: Record<string, unknown> = { text: o.text, model_id: model };
  // language_code no es compatible con los modelos multilingual_v2
  if (o.languageCode && !/multilingual_v2/.test(model)) body.language_code = o.languageCode;
  if (o.voiceSettings && Object.keys(o.voiceSettings).length) body.voice_settings = o.voiceSettings;
  const q = new URLSearchParams({ output_format: o.outputFormat || "mp3_44100_128" });
  return audio(await call(`/v1/text-to-speech/${encodeURIComponent(o.voiceId)}?${q}`, { method: "POST", body }));
}

// ---------- Efectos de sonido ----------
export interface SfxOptions { text: string; durationSeconds?: number; promptInfluence?: number; loop?: boolean; model?: string; outputFormat?: string }
export async function soundEffect(o: SfxOptions): Promise<Buffer> {
  if (!o.text?.trim()) throw new Error("Falta la descripción del efecto.");
  const body: Record<string, unknown> = { text: o.text, model_id: o.model || sfxModel() };
  if (o.durationSeconds) body.duration_seconds = clamp(o.durationSeconds, 0.5, 30);
  if (o.promptInfluence !== undefined) body.prompt_influence = clamp(o.promptInfluence, 0, 1);
  if (o.loop) body.loop = true;
  const q = new URLSearchParams({ output_format: o.outputFormat || "mp3_44100_128" });
  return audio(await call(`/v1/sound-generation?${q}`, { method: "POST", body }));
}

// ---------- Catálogo de voces ----------
export interface VoiceInfo { voice_id: string; name: string; category?: string; description?: string | null; labels?: Record<string, string>; preview_url?: string | null }
export interface VoiceSearch {
  search?: string;
  category?: "premade" | "cloned" | "generated" | "professional";
  language?: string;
  gender?: string;
  age?: string;
  accent?: string;
  pageSize?: number;
  nextPageToken?: string;
}
export async function listVoices(o: VoiceSearch = {}): Promise<{ voices: VoiceInfo[]; hasMore: boolean; nextPageToken: string | null; total?: number }> {
  const q = new URLSearchParams();
  q.set("page_size", String(clamp(Math.round(o.pageSize || 30), 1, 100)));
  if (o.search) q.set("search", o.search);
  if (o.category) q.set("category", o.category);
  if (o.language) q.set("language", o.language);
  if (o.gender) q.set("gender", o.gender);
  if (o.age) q.set("age", o.age);
  if (o.accent) q.set("accent", o.accent);
  if (o.nextPageToken) q.set("next_page_token", o.nextPageToken);
  const res = await call(`/v2/voices?${q}`, { method: "GET", timeoutMs: 60_000 });
  const j = (await res.json()) as { voices?: VoiceInfo[]; has_more?: boolean; next_page_token?: string | null; total_count?: number };
  const voices = (j.voices || []).map((v) => ({
    voice_id: v.voice_id, name: v.name, category: v.category, description: v.description ?? null, labels: v.labels || {}, preview_url: v.preview_url ?? null,
  }));
  return { voices, hasMore: Boolean(j.has_more), nextPageToken: j.next_page_token ?? null, total: j.total_count };
}
