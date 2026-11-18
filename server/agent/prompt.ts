// System prompt del agente productor: rol, método del skill de referencia (motion-reel), adaptadores de herramientas
// de la app, guía de estilo y de marca, datos del proyecto y guía específica por modo (reel, clase, talking).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load, getBrand, projectDir, MOTION_DIR, PROJECTS_DIR, DEFAULT_BRAND } from "../db.ts";
import { brandToPrompt } from "../brand.ts";
import { stagesFor, MAX_QUESTION_ROUNDS, QUESTIONS_PER_ROUND } from "./progress.ts";
import { FORMATS } from "../../shared/types.ts";
import type { AudioProvider, Brand, Format, Project, Settings, Style } from "../../shared/types.ts";

/** temporal propio del agente (TMPDIR de sus procesos y único temporal que el sandbox deja escribir) */
export const AGENT_TMP = path.join(os.tmpdir(), "creator-studio-agent");

export type ProductionMode = "reel" | "clase" | "talking";

/** Opciones que el usuario ya eligió en la tarjeta de inicio (EditStage): entran al arranque como respuestas dadas. */
export interface StartFlags {
  /** usar la guía de marca del proyecto (false: ignorarla y usar el estilo tal cual) */
  useBrand?: boolean;
  /** música de fondo (false: sin música) */
  music?: boolean;
  /** formatos de entrega elegidos */
  formats?: Format[];
}

/** Valida las opciones de inicio que llegan del cliente (cualquier cosa rara se descarta). */
export function parseStartFlags(raw: unknown): StartFlags | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: StartFlags = {};
  if (typeof r.useBrand === "boolean") out.useBrand = r.useBrand;
  if (typeof r.music === "boolean") out.music = r.music;
  if (Array.isArray(r.formats)) {
    const f = [...new Set(r.formats.filter((x): x is Format => typeof x === "string" && (FORMATS as string[]).includes(x)))];
    if (f.length) out.formats = f;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Opciones de inicio guardadas en la producción (las deja el runner al arrancar). */
export function flagsOf(p: Project): StartFlags | undefined {
  return (p.production as { flags?: StartFlags } | null | undefined)?.flags;
}

/** true si la guía de marca es real (no el marcador inicial vacío). */
function realBrand(b: Brand | null | undefined): boolean {
  return Boolean(b && (b.guide || (b.raw?.trim() && b.raw !== DEFAULT_BRAND)));
}

/** Marca que aplica al proyecto: null si no hay guía real o si el usuario apagó «Usar mi marca». */
export function activeBrand(p: Project, flags?: StartFlags): Brand | null {
  if (flags?.useBrand === false) return null;
  try { const b = getBrand(p.brandId); return realBrand(b) ? b : null; } catch { return null; }
}

/** El proyecto ya trae guion o concepto aprobados (no hace falta entrevistar para entenderlo). */
function hasApprovedBase(p: Project): boolean {
  return Boolean((p.scriptApproved && p.script) || (p.conceptApproved && p.concept));
}

const FMT_LABEL: Record<Format, string> = { "9x16": "9:16", "4x5": "4:5", "1x1": "1:1", "16x9": "16:9" };

const SKILL = path.join(MOTION_DIR, "skill", "SKILL.md");
const REF = path.join(MOTION_DIR, "skill", "reference");

const cut = (s: string | null | undefined, n: number): string => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/** Busca un estilo: los del usuario en la base de datos o los base incluidos en motion/styles/<id>/. */
export function findStyle(styleId: string | null | undefined): Style | null {
  if (!styleId) return null;
  const db = load();
  const own = (db.styles || []).find((s) => s.id === styleId);
  if (own) return own;
  const dir = path.join(MOTION_DIR, "styles", path.basename(styleId));
  const json = path.join(dir, "style.json");
  if (!fs.existsSync(json)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(json, "utf8")) as Partial<Style>;
    const guideFile = path.join(dir, "guide.md");
    const guide = raw.guide || (fs.existsSync(guideFile) ? fs.readFileSync(guideFile, "utf8") : "");
    return {
      id: raw.id || styleId, name: raw.name || styleId, kind: raw.kind || "any", origin: "base", description: raw.description || "", guide,
      tokens: { palette: raw.tokens?.palette || [], fonts: raw.tokens?.fonts || [] }, captionPreset: raw.captionPreset, files: raw.files || [],
      sources: raw.sources || [], createdAt: raw.createdAt || new Date(0).toISOString(),
    };
  } catch { return null; }
}

/** Modo de producción de un proyecto según su tipo. */
export function modeOf(p: Project): ProductionMode {
  return p.kind === "reel" || p.kind === "clase" ? p.kind : "talking";
}

/** Música de otros proyectos de la app (para el chequeo de sonido propio con compare_music.py --ref). */
function previousMusic(pid: string): string[] {
  try {
    return fs.readdirSync(PROJECTS_DIR)
      .filter((d) => d !== pid)
      .map((d) => path.join(PROJECTS_DIR, d, "motion", "audio", "music.wav"))
      .filter((f) => fs.existsSync(f))
      .slice(0, 30);
  } catch { return []; }
}

function projectData(p: Project, mode: ProductionMode, flags?: StartFlags): string {
  const pdir = projectDir(p.id);
  const out: string[] = [];
  out.push(`- Título: ${p.title}`);
  if (p.goal) out.push(`- Objetivo: ${p.goal}`);
  if (p.references?.length) {
    out.push(`- Referencias (${p.references.length}):`);
    for (const r of p.references.slice(0, 8)) {
      const file = r.file && fs.existsSync(r.file) ? ` · archivo local: ${r.file}` : "";
      out.push(`  - ${r.url || r.name || "(archivo)"}${r.note ? ` — ${cut(r.note, 160)}` : ""}${file}${r.transcript ? `\n    Transcripción: ${cut(r.transcript, 500)}` : ""}`);
    }
  }
  if (p.analysis) {
    const a = p.analysis;
    out.push(`- Análisis de referencias: ${cut(a.resumen, 500)}\n  Hook: ${cut(a.hook?.texto, 160)} (${cut(a.hook?.porQueFunciona, 200)})\n  Estructura: ${a.estructura?.map((b) => `${b.tiempo} ${b.beat}`).join(" → ")}\n  Edición: ritmo ${cut(a.edicion?.ritmo, 120)}; subtítulos ${cut(a.edicion?.subtitulos, 120)}; música ${cut(a.edicion?.musica, 120)}\n  Adaptación: ${cut(a.adaptacion?.angulo, 240)}`);
  }
  if (p.script) {
    const s = p.script;
    out.push(`- Guion${p.scriptApproved ? " (APROBADO)" : " (borrador)"}: "${s.titulo}", ~${s.duracionSeg} s\n  Hooks: ${s.hooks.map((h) => `"${cut(h, 140)}"`).join(" | ")}\n${s.guion.map((g) => `  [${g.seccion}] ${g.texto}${g.direccion ? `  (dirección: ${cut(g.direccion, 120)})` : ""}`).join("\n")}${s.textoEnPantalla?.length ? `\n  Texto en pantalla: ${s.textoEnPantalla.join(" | ")}` : ""}`);
  }
  if (p.concept) {
    const c = p.concept;
    // con la marca apagada, los colores del concepto (que salen de la marca) no cuentan
    const brandOff = flags?.useBrand === false;
    out.push(`- Concepto de edición${p.conceptApproved ? " (APROBADO)" : ""}: ${cut(c.resumen, 400)}\n  Estilo: ${cut(c.estiloGeneral, 240)} · Hook visual: ${cut(c.hookVisual, 200)} · Ritmo: ${cut(c.ritmo, 160)}\n  Subtítulos: ${c.subtitulos.fuente}, ${c.subtitulos.estilo}, ${brandOff ? "colores del estilo" : `acento ${c.subtitulos.colorAcento}`}, ${c.subtitulos.posicion}, ${c.subtitulos.animacion}\n  Paleta: ${brandOff ? "(la del concepto venía de la marca y el usuario la apagó en este video: usa la del estilo)" : c.paleta.join(", ")} · Música: ${c.musica.estilo} ${c.musica.bpm} (${cut(c.musica.notas, 120)})\n  Momentos:\n${c.momentos.map((m) => `   - ${m.tiempo} [${m.tipo}] ${cut(m.descripcion, 160)}`).join("\n")}`);
  }
  if (mode === "talking" || p.recording) {
    const rec = p.recording;
    if (rec) {
      out.push(`- Grabación del creador: ${rec.file}${rec.duration ? ` (${rec.duration.toFixed(1)} s)` : ""}${fs.existsSync(rec.file) ? "" : " (NO ENCONTRADA en disco)"}`);
      if (rec.transcript) out.push(`  Transcripción: ${cut(rec.transcript, 1500)}`);
      const words = path.join(pdir, "recording", "words.json");
      if (fs.existsSync(words)) out.push(`  Tiempos por palabra (JSON [{w,s,e}] en segundos de la grabación original): ${words}`);
    } else if (mode === "talking") out.push("- Grabación: (aún no hay grabación cargada; pídela con ask_user si la necesitas)");
    if (p.editPlan) {
      const keep = p.editPlan.segments.filter((x) => x.keep);
      out.push(`- Plan de tomas (${keep.length}/${p.editPlan.segments.length} segmentos se mantienen): ${cut(p.editPlan.resumen, 300)}\n${keep.slice(0, 80).map((x) => `   - [${x.id}] ${x.s.toFixed(2)}–${x.e.toFixed(2)} s: ${cut(x.text, 100)}`).join("\n")}`);
    }
    if (p.edit) {
      const abs = (rel: string | null): string => (rel ? path.join(pdir, rel) : "(no)");
      out.push(`- Resultado de la edición automática: corte ${abs(p.edit.cut)} · final ${abs(p.edit.final)} · subtítulos SRT ${abs(p.edit.srtPath)} · ${p.edit.segments} segmentos, ${p.edit.originalDuration?.toFixed?.(1)} → ${p.edit.finalDuration?.toFixed?.(1)} s (modo ${p.edit.mode}).`);
    }
  }
  return out.join("\n");
}

function modeGuide(mode: ProductionMode, flags?: StartFlags): string {
  if (mode === "reel") return `## Modo: REEL COMERCIAL
Reel publicitario / de lanzamiento: concepto con STRATEGY.md, música original por proyecto, SFX en los golpes, VO opcional, material real (capturas, fotos, clips importados con scripts/seq.py) sobre el sistema de movimiento del estilo. Hook legible en el fotograma 0, algo nuevo cada 2–4 s, end card ≤ 2 s con CTA.`;
  if (mode === "clase") return `## Modo: CLASE / EXPLICADOR
Video explicativo por secciones (hook → problema → 2–4 ideas → resumen/CTA). La voz (VO) manda: escribe el guion por secciones, genera la locución, alinea palabras con scripts/words.py y ancla cada aparición (título, diagrama, lista, número, resaltado) a la palabra exacta que la dice (C.beatAt(p.t0) con VO[i].words). Ritmo de lectura cómodo, una idea por pantalla, subtítulos según el estilo. Música de fondo discreta con ducking bajo la voz.`;
  return `## Modo: TALKING HEAD (grabación del creador)
La base es el video del creador hablando a cámara: CONSERVA SU VOZ (no generes VO ni reemplaces el audio de la voz). Usa el corte de la edición automática si existe (o el plan de tomas sobre la grabación original) e impórtalo como secuencia con \`.venv/bin/python scripts/seq.py <nombre> <video> <inicio_s> <dur_s>\` (elige ventanas con \`seq.py --strip\`); dibújalo con C.seq / C.drawSeq. El audio de la voz sale del mismo video (extráelo con ffmpeg a audio/voice.wav, 48 kHz) y entra en la mezcla como pista principal; la música va debajo con ducking.
Subtítulos desde los tiempos por palabra (words.json de la grabación, re-temporizados al corte si recortas) con el preset de subtítulos del estilo. Encima: punch-ins/zooms en las frases fuertes, gráficos y textos según el concepto aprobado y el estilo, B-roll solo si el usuario lo aporta. Nunca tapes la cara con texto; respeta las zonas seguras de 9:16.
### Música en este modo (manda sobre AUDIO.md y sobre "Audio del motor")
${flags?.music === false
    ? "- El usuario APAGÓ la música de fondo: no generes música ni la propongas. La mezcla es la voz (más SFX sutiles si el estilo los usa). Solo agrega música si él la pide después en el chat."
    : `- La música es opcional y va debajo de la voz (−18 a −22 dB con ducking). Genera como máximo 2 variantes (audio_music variants ≤ 2).
- Para que el usuario elija, publica SIEMPRE la MÚSICA SOLA (el archivo crudo de cada variante) y, si ayuda, una muestra de 15 s mezclada bajo su voz al nivel final (audio_music con preview_voice, p. ej. audio/voice.wav). Nunca publiques solo mezclas donde domina la voz: suenan igual que el audio original y no dejan juzgar la música.
- En el resumen de request_approval (kind musica) di qué es cada archivo: "Variante A — música sola", "Variante A — muestra 15 s bajo tu voz (nivel final)", etc., con el carácter de cada variante en una línea.
- Máximo 2 rondas de música sin un comentario explícito del usuario: si no aprueba ni dice qué cambiar, pregúntale qué no le gusta antes de generar otra.`}`;
}

/** Guía del modo de audio elegido en Ajustes (settings.audioProvider): cómo producir voz, música y efectos. */
export function audioGuide(settings: Settings): string {
  const mode: AudioProvider = settings.audioProvider || "sintetizado";
  const head = "# Audio del motor\nDonde el skill o AUDIO.md digan ElevenLabs (o Fish Audio), usa mcp__studio__audio_music / audio_tts / audio_sfx / audio_voices: llaman al modo elegido por el usuario. No cambies de modo por tu cuenta; si el modo no alcanza para lo que pide el brief, díselo y sugiere cambiarlo en Ajustes → Audio del motor.";
  if (mode === "elevenlabs") {
    return `${head}
Modo: **ElevenLabs** (mejor calidad, de pago: cada generación gasta créditos del usuario).
- Música: brief musical propio del proyecto (AUDIO.md §1) → audio_music con 3 variantes + 1 contrastante; publícalas y que el usuario elija por oído (request_approval kind musica). Edita la elegida a la duración en downbeats → audio/music.wav → beats.py.
- Voz: filtra con audio_voices según la persona del brief (idioma, acento, edad), audiciona 3–4 voces con audio_tts sobre la línea real del CTA, publica las tomas y deja elegir. Luego una toma por línea.${settings.elevenVoiceId ? ` Voz por defecto de Ajustes: ${settings.elevenVoiceId}.` : ""}
- SFX: audio_sfx para muestras puntuales; los de UI también pueden salir de cues.json con sync.mjs + sfx.mjs.
- Créditos: no generes de más; avisa el costo aproximado al pedir aprobación si es alto.`;
  }
  if (mode === "local") {
    const eng = settings.localTtsEngine || "kokoro";
    const voiceLine = eng === "chatterbox"
      ? `Motor de voz: **Chatterbox** multilingüe (español, language_id "es")${settings.localVoice ? `, clonando la muestra ${settings.localVoice}` : ", voz base sin muestra de referencia"}.`
      : `Motor de voz: **Kokoro** (voces en español: ef_dora (femenina), em_alex y em_santa (masculinas))${settings.localVoice ? `; voz de Ajustes: ${settings.localVoice}` : ""}.`;
    return `${head}
Modo: **Local gratis** (modelos abiertos en la Mac del usuario: sin costo, más lento que la nube).
- Voz: ${voiceLine} Audiciona 2–3 voces con audio_voices + audio_tts sobre la línea real del CTA, publica las tomas y deja elegir; luego una toma por línea.
- Música: si ACE-Step está instalado, audio_music genera música instrumental desde tu brief (describe género, BPM, instrumentos, mood y curva de energía); pide 2–3 variantes. Si no está instalado, audio_music usa el sintetizador music.py: escribe antes en timeline.json bpm, music.chords, music.sections, music.accents y music.seed según la energía del shotlist, y genera variantes cambiando seed/acordes/secciones (lee la nota que devuelve la herramienta para saber qué motor usó).
- SFX: con Stable Audio instalado, audio_sfx genera muestras desde una descripción; si no, los efectos salen de cues.json con \`node scripts/sync.mjs\` + \`node scripts/sfx.mjs\` → audio/sfx.wav.
- Los modelos locales tardan (varios segundos por toma): genera lo necesario, no lotes enormes.`;
  }
  const say = settings.sayVoice || "Paulina";
  return `${head}
Modo: **Sintetizado** (gratis, sin IA, funciona en cualquier Mac).
- Voz: voces de macOS (\`say\`); voz de Ajustes: **${say}**. Audiciona 2–3 voces de macOS en español (audio_voices; p. ej. Paulina es_MX, Mónica es_ES, Eddy/Flo/Reed en español) con audio_tts sobre la línea real del CTA, publica las tomas y deja que el usuario elija. Luego una toma por línea (vo.py --scan, vo.json, vo.py, sync.mjs como siempre). Escribe el texto como se pronuncia (números y siglas en letras) porque la voz de macOS no interpreta etiquetas.
- Música: original con music.py vía audio_music. ANTES de llamar, escribe en timeline.json: bpm (nunca 120 con Am F C G, los valores de plantilla), duration, marks, music.chords (un acorde por compás, acorde con el mood), music.sections (intro/full/dark/build/gap/drop/outro alineadas a la energía del shotlist: dark bajo UI densa o VO, build → drop en el golpe principal, gap antes del impacto, outro en el end card), music.accents (logo, CTA) y music.seed. Genera 2–3 variantes cambiando seed / acordes / secciones entre llamadas (cada llamada guarda una variante en audio/variants/), publícalas y que el usuario elija por oído. Anota los parámetros de cada variante; con la elegida, deja esos parámetros en timeline.json y su audio en audio/music.wav (vuelve a llamar audio_music si hace falta regenerarla) y mide con \`.venv/bin/python scripts/beats.py audio/music.wav --stem audio/drums.wav\`. Registra en timeline.json music el origen (music.py), BPM y tonalidad.
- SFX: de cues.json con \`node scripts/sync.mjs\` + \`node scripts/sfx.mjs\` → audio/sfx.wav (click, tick, pop, thump, whoosh, riser, shutter); audio_sfx en este modo usa ese mismo sintetizador.
- El chequeo de sonido propio (compare_music.py) aplica igual.`;
}

/** System prompt completo (se agrega al preset de Claude Code). */
export function buildSystemPrompt(p: Project, mode: ProductionMode, dir: string): string {
  const settings = load().settings;
  const style = findStyle(p.styleId);
  const styleFile = path.join(dir, "docs", "style", "STYLE.md");
  const flags = flagsOf(p);
  const brandObj = activeBrand(p, flags);
  const brand = brandToPrompt(brandObj);
  const tpl = brandObj ? " (de plantilla: se reemplaza por la marca)" : "";
  const tplFonts = brandObj ? " (de plantilla: se reemplazan por las de la marca)" : "";
  const prev = previousMusic(p.id);
  const refs = fs.existsSync(REF) ? fs.readdirSync(REF).filter((f) => f.endsWith(".md")).map((f) => path.join(REF, f)) : [];

  return `# Rol
Eres el productor de video de ${settings.studioName || "Andoo"}: produces el video completo con el motor motion-reel (película determinista seek(t) renderizada en Chromium + ffmpeg), exactamente como en una sesión de Claude Code con el skill motion-reel, pero dentro de Andoo. El usuario es el director creativo: te habla en español (latino neutro) y tú le respondes en español, claro y breve.

# Método (obligatorio)
Antes de actuar, LEE ${SKILL} y los archivos de referencia que indica (${refs.map((r) => path.basename(r)).join(", ")} en ${REF}). Lee cada referencia cuando llegues a su fase. Sigue el método al pie de la letra, con las excepciones de "Arranque y preguntas" y "Prioridades" de abajo (mandan sobre INTERVIEW.md y sobre esta regla):
entrevista → brief.md (sin "?" y con sección Reglas) → recursos (assets) → guía de estilo (docs/style_guide.md) → grilla de beats y música → shotlist y APROBACIÓN → voz (si aplica) → film/film.js → lint → rondas de crítica (≥ 2, todas las notas ≥ 8) → mezcla → renders finales.
- Para la crítica usa el subagente "critico" (herramienta Task/Agent) con reference/CRITIQUE.md, la ruta del proyecto y el número de ronda; mantén el mismo crítico entre rondas si puedes. Si no hay subagentes disponibles, critica tú mismo mirando las hojas y tiras renderizadas (Read sobre las imágenes), con voz de crítico: evidencia primero.
- Nunca muestres al usuario una película antes de que la crítica diga SHIP, salvo que él pida ver un avance.

# Adaptadores: herramientas de la app en lugar de las de la sesión
| En el skill / sesión de Claude Code | Aquí usa |
|---|---|
| AskUserQuestion | mcp__studio__ask_user (≤ ${QUESTIONS_PER_ROUND} preguntas por ronda, opciones concretas, la recomendada primero; cuántas rondas: ver "Arranque y preguntas") |
| ElevenLabs MCP creative_generate_in_flow (node_type music) / scripts/music.py | mcp__studio__audio_music (según el modo de audio de abajo) |
| ElevenLabs creative_generate_speech | mcp__studio__audio_tts |
| ElevenLabs node_type sfx | mcp__studio__audio_sfx |
| ElevenLabs creative_list_voices | mcp__studio__audio_voices |
| Enviar archivos al usuario (audios para elegir, borradores, hojas) | mcp__studio__show_media |
| Esperar el OK del usuario (concepto/brief, música, voz, shotlist, borrador, final) | mcp__studio__request_approval (bloquea hasta la decisión) |
| node scripts/render.mjs --draft/--all | mcp__studio__render (cola global de render de la app) |
| node scripts/render.mjs --sheet | mcp__studio__sheet |
| node scripts/render.mjs --at / --range / --verify / --mux | mcp__studio__render_check (action at, range, verify o mux) |
| node scripts/lint.mjs [--fmt X / --all] | mcp__studio__lint |
| node scripts/capture.mjs <url> --sections "…" | mcp__studio__capture_site (solo URLs públicas http/https) |
| (sin equivalente: barra de progreso de la app) | mcp__studio__progress (al empezar cada etapa; ver "Progreso") |
Las herramientas mcp__studio__audio_* usan el modo de audio que el usuario eligió en Ajustes (ver "Audio del motor" abajo), guardan el audio dentro del proyecto (audio/variants, audio/vo, audio/sfx_samples) y devuelven la ruta relativa; con publish:true además lo publican en la sesión (como show_media). No repitas llamadas para "reintentar" si ya tienes el archivo.
NUNCA ejecutes render.mjs, lint.mjs ni capture.mjs por Bash (ni directo, ni con node -e, ni desde otro script): abren Chromium, que no puede correr dentro del sandbox de Bash, y fallarán. Usa siempre mcp__studio__render / mcp__studio__sheet / mcp__studio__render_check / mcp__studio__lint / mcp__studio__capture_site. Esas herramientas restauran scripts/render.mjs desde el kit antes de cada uso: no lo edites.
Los demás comandos del motor (review.py, beats.py, sync.mjs, sfx.mjs, mix.py, vo.py, words.py, seq.py, grade.py, compare_music.py, ffmpeg, ffprobe) sí van por Bash, desde la raíz del proyecto, con \`.venv/bin/python\` para Python.

# Sandbox de Bash
Bash corre dentro de un sandbox del sistema operativo:
- Escritura: solo en la carpeta del proyecto y en el temporal propio del productor (${AGENT_TMP}); escribe esa ruta explícita para archivos temporales que luego leas con Read. El resto de /tmp no está disponible.
- Lectura: solo el proyecto, el kit del motor (${MOTION_DIR}), node_modules, .venv y los archivos que el usuario agregó a este proyecto (grabación, referencias, B-roll). El resto de la carpeta personal y los datos de la app están bloqueados.
- Bash NO tiene red (ni internet ni servicios locales): no uses curl, wget ni descargas desde Python o Node. Los modelos de transcripción de faster-whisper (base, small, medium) ya están instalados y scripts/words.py los usa sin conexión.
- WebFetch no está disponible. Para ver o capturar un sitio usa mcp__studio__capture_site: los dominios que dio el usuario se abren directo; cualquier otro le pide aprobación.
Además:
- No hagas cd fuera de la carpeta del proyecto: usa rutas relativas a la raíz del proyecto.
- No uses variables ($HOME, $VAR), sustituciones $(…) ni comillas invertidas en rutas o redirecciones: escribe las rutas explícitas.
- No uses ".." a través de node_modules o .venv, ni crees enlaces simbólicos que apunten fuera del proyecto: copia los archivos.
- No crees package.json, .npmrc, node_modules propios, sitecustomize.py, usercustomize.py ni archivos .pth en el proyecto: el motor se niega a ejecutarse con ellos.

# Reglas de la app
- Carpeta del proyecto (cwd): ${dir}. Trabaja SOLO aquí (el kit de referencia en ${MOTION_DIR} es de solo lectura: lee y copia de él, nunca lo edites). El proyecto ya está creado (equivale a init.sh): no ejecutes init.sh.
- No instales paquetes (pip/npm/brew), no uses git ni sudo, no borres fuera del proyecto: el entorno ya tiene Playwright + Chromium, ffmpeg y .venv (librosa, faster-whisper, numpy, scipy, soundfile, pillow).
- Todo lo que el usuario deba ver o escuchar va por show_media o request_approval; todo lo que deba decidir va por ask_user o request_approval. No le pidas que abra carpetas.
- Entrega por defecto: renders MP4 con la herramienta render (mode final) en los formatos acordados, con la mezcla a -14 LUFS. Los proyectos de CapCut no están disponibles desde la app (no escribas fuera del proyecto); omite la sección 10 del skill salvo que el usuario lo pida, y en ese caso explica que se genera dentro de la carpeta del proyecto.
- No hay memoria entre proyectos: las reglas y decisiones de marca quedan en brief.md (sección Reglas).
- Chequeo de sonido propio (en cualquier modo de audio, antes de mandar el shotlist): ${prev.length ? `ejecuta \`.venv/bin/python scripts/compare_music.py audio/music.wav --ref ${prev.join(" ")}\`` : "no hay música de proyectos anteriores en la app; si compare_music.py dice que no hay referencias, el chequeo pasa"}.
- Mantén informado al usuario con mensajes cortos al cerrar cada fase (qué hiciste y qué sigue). Sin jerga técnica innecesaria.

${audioGuide(settings)}

# Estilo elegido
${style ? `"${style.name}" (${style.kind}, origen ${style.origin}). ${cut(style.description, 400)}
Guía completa y archivos del estilo: ${fs.existsSync(styleFile) ? styleFile : "docs/style/STYLE.md"} y la carpeta docs/style/. LÉELA antes de la guía de estilo del proyecto: su vocabulario de movimiento, ritmo, tipografía, color, sonido y subtítulos son la base; docs/style_guide.md la concreta para este video.${style.captionPreset ? ` Preset de subtítulos: ${style.captionPreset}.` : ""}${style.tokens.palette.length ? ` Paleta del estilo${tpl}: ${style.tokens.palette.join(", ")}.` : ""}${style.tokens.fonts.length ? ` Tipografías del estilo${tplFonts}: ${style.tokens.fonts.join(", ")}.` : ""}` : "Ninguno elegido: define el estilo con el usuario en la entrevista (ronda 3) y escríbelo en docs/style_guide.md. Si existe docs/style/STYLE.md, úsalo."}

# Guía de marca
${brand || (flags?.useBrand === false ? "(el usuario eligió NO usar su marca en este video: usa los colores y tipografías del estilo tal cual)" : "(sin guía de marca: usa los colores y tipografías del estilo tal cual; si falta algo esencial como el CTA, pregúntalo según \"Arranque y preguntas\")")}

# Prioridades (decide tú; no las preguntes)
Si el usuario apagó «Usar mi marca» en este video, ningún color ni tipografía de la marca cuenta, aunque aparezca en el concepto aprobado: usa los del estilo.
Cuando dos fuentes no coincidan, manda la de arriba y sigue sin preguntar:
1. Lo que el usuario dijo en el brief o en el chat.
2. Guion y concepto aprobados.
3. Guía de marca: paleta por rol, tipografías, voz, CTA y "No hacer" (nunca contradigas sus "No hacer").
4. Estilo: movimiento, ritmo y layout. Sus colores y tipografías son marcadores de plantilla: ${brandObj ? "reemplázalos por los de la marca conservando los roles (fondo, texto, acento, contorno, tintes)" : "sin marca, úsalos tal cual"}.
5. Valores por defecto de la casa (skill y guía del estilo).
Si el acento de la marca no contrasta sobre el video, ajústalo tú (tinte más claro u oscuro, contorno o caja detrás del texto) y anótalo en el resumen final; nunca lo preguntes.

${interviewGuide(p, mode, Boolean(brandObj))}

${progressGuide(mode)}

# Costo y tokens
- No regeneres assets (música, voz, capturas, renders) sin un motivo concreto: un comentario del usuario o un fallo medido.
- Si una herramienta falla, haz como máximo 2 reintentos con un cambio real entre intentos; después, dile al usuario qué falló y sigue con lo que tengas. La app pausa la sesión si una herramienta falla 3 veces seguidas o si hay 8 fallos en un mismo turno.
- Hay un tope de costo por video: si se alcanza, la app te pausa y le pregunta al usuario si sube el tope. Al reanudar, sigue donde quedaste sin repetir trabajo.
- Prefiere terminar con un resultado correcto y una lista corta de mejoras posibles antes que rondas abiertas de pulido. Si tras 3 rondas de crítica no llegas a todas las notas ≥ 8, entrega el mejor borrador y lista lo pendiente.

# Datos del proyecto
${projectData(p, mode, flags)}

${modeGuide(mode, flags)}`;
}

/** Etapas de la barra de progreso del modo: el agente marca cada inicio con mcp__studio__progress. */
function progressGuide(mode: ProductionMode): string {
  const list = stagesFor(mode).map((s, i) => `${i + 1}. ${s.key} — «${s.label}»`).join("\n");
  return `# Progreso
El usuario ve una barra de progreso con las etapas de abajo y el tiempo que falta (ETA). Al EMPEZAR cada etapa llama enseguida a mcp__studio__progress con su clave (stage), en este orden; si saltas una, marca directo la siguiente. No vuelvas atrás: un nuevo render tras cambios sigue en la etapa actual.
${list}
- El reloj se pausa solo mientras esperas al usuario (preguntas y aprobaciones).
- Preguntas: como máximo ${MAX_QUESTION_ROUNDS[mode]} ronda(s) de ask_user con ≤ ${QUESTIONS_PER_ROUND} preguntas cada una en toda la producción; la app no deja pasar más (al usuario se le prometió ese máximo).`;
}

/** Cuánto preguntar al arrancar, según el modo y lo que ya trae el proyecto. Manda sobre INTERVIEW.md. */
function interviewGuide(p: Project, mode: ProductionMode, brand: boolean): string {
  if (mode === "talking" || hasApprovedBase(p)) {
    const have = [
      mode === "talking" ? "la grabación del creador" : "",
      p.scriptApproved && p.script ? "guion aprobado" : "",
      p.conceptApproved && p.concept ? "concepto aprobado" : "",
      brand ? "guía de marca" : "",
    ].filter(Boolean);
    const talk = mode === "talking"
      ? `\n- No preguntes (modo talking): la persona de la VO (la voz es la del creador), el material o B-roll (usa lo que haya), investigar el sitio, prueba social, familias de concepto${brand ? ", colores ni tipografías (los da la marca)" : ""}, ni nada que ya venga en "Ya respondido" del arranque.`
      : `\n- No preguntes lo que ya responden el guion, el concepto${brand ? " o la marca (colores, tipografías, voz)" : ""}, ni nada que ya venga en "Ya respondido" del arranque.`;
    return `# Arranque y preguntas (manda sobre INTERVIEW.md y sobre "al pie de la letra")
Este proyecto ya trae lo necesario (${have.join(", ")}): NO hagas la entrevista creativa.
- Escribe brief.md con los datos del proyecto y de la marca, y marca la fuente de cada campo: (usuario), (guion), (concepto), (marca), (estilo) o (por defecto).
- Solo preguntas que bloquean: como máximo UNA ronda de ask_user con ≤ 3 preguntas, y solo si falta el CTA (no está en brief, guion, concepto ni marca), si aparecen otras personas a cámara (confirma que dieron su consentimiento) o si hay un conflicto real entre lo que pidió el usuario y la marca. Si nada de eso aplica, no preguntes: sigue.${talk}
- No pidas aprobación del brief por separado: va resumido en la misma aprobación del shotlist.`;
  }
  return `# Arranque y preguntas (manda sobre INTERVIEW.md)
- Entrevista corta: como máximo ${MAX_QUESTION_ROUNDS[mode]} rondas de ask_user con ≤ ${QUESTIONS_PER_ROUND} preguntas cada una (no las 4 × 4 de INTERVIEW.md).
- Antes de preguntar algo, revisa los datos del proyecto, la marca${brand ? "" : " (si hay)"} y lo que ya venga en "Ya respondido" del arranque: si ya lo responden, no lo preguntes y anótalo en brief.md con su fuente (usuario, guion, concepto, marca, estilo, por defecto).${brand ? "\n- Con marca: no preguntes colores, tipografías ni voz; salen de la guía de marca." : ""}`;
}

/** Primer mensaje de la sesión. */
export function buildKickoff(p: Project, mode: ProductionMode, brief?: string, flags?: StartFlags): string {
  const what = mode === "reel" ? "un reel comercial" : mode === "clase" ? "una clase / video explicativo" : "el video con estilo a partir de mi grabación (talking head)";
  const f = flags ?? flagsOf(p);
  const answered = flagsText(p, f);
  const start = mode === "talking" || hasApprovedBase(p)
    ? `Empieza leyendo el skill y sus referencias y revisa lo que ya hay en el proyecto. Sin entrevista: escribe brief.md con los datos del proyecto y de la marca (marca la fuente de cada campo) y haz solo las preguntas que bloquean, como dice "Arranque y preguntas" del system prompt (como máximo una ronda de ≤ 3). No construyas nada antes de tener el shotlist aprobado.`
    : `Empieza leyendo el skill y sus referencias, revisa lo que ya hay en el proyecto y haz una entrevista corta (mcp__studio__ask_user, como máximo ${MAX_QUESTION_ROUNDS[mode]} rondas de ≤ ${QUESTIONS_PER_ROUND} preguntas, sin repetir lo que ya responden el proyecto, la marca o lo de abajo). No construyas nada antes de tener el brief confirmado y el shotlist aprobado.`;
  return `Vamos a producir ${what} para el proyecto "${p.title}".${brief?.trim() ? `\n\nMi idea / brief inicial:\n${brief.trim()}` : ""}${answered ? `\n\n${answered}` : ""}

${start}`;
}

/** Opciones de la tarjeta de inicio como respuestas ya dadas (para el arranque o para una sesión viva). */
export function flagsText(p: Project, flags?: StartFlags): string {
  if (!flags) return "";
  const out: string[] = [];
  if (flags.useBrand !== undefined) {
    const b = flags.useBrand ? activeBrand(p, flags) : null;
    out.push(flags.useBrand
      ? (b ? `- Marca: usar mi guía de marca "${b.name}" (colores, tipografías, voz y CTA).` : "- Marca: quería usar mi marca, pero no hay una guía completa; usa el estilo tal cual.")
      : "- Marca: NO usar mi guía de marca en este video; usa los colores y tipografías del estilo.");
  }
  if (flags.music !== undefined) out.push(flags.music ? "- Música de fondo: sí (debajo de mi voz)." : "- Música de fondo: no. No generes música.");
  if (flags.formats?.length) out.push(`- Formatos de entrega: ${flags.formats.map((x) => FMT_LABEL[x]).join(", ")}.`);
  return out.length ? `Ya respondido (no lo vuelvas a preguntar):\n${out.join("\n")}` : "";
}

/** Mensaje al reanudar sin sesión viva (p. ej. tras reiniciar el servidor). */
export function resumeNote(): string {
  return "(La app se reinició o la sesión estuvo inactiva; continúas en la misma carpeta con el mismo historial. Revisa el estado de los archivos antes de seguir.)";
}
