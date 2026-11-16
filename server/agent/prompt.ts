// System prompt del agente productor: rol, método del skill de referencia (motion-reel), adaptadores de herramientas
// de la app, guía de estilo y de marca, datos del proyecto y guía específica por modo (reel, clase, talking).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load, getBrand, projectDir, MOTION_DIR, PROJECTS_DIR } from "../db.ts";
import { brandToPrompt } from "../brand.ts";
import type { AudioProvider, Project, Settings, Style } from "../../shared/types.ts";

/** temporal propio del agente (TMPDIR de sus procesos y único temporal que el sandbox deja escribir) */
export const AGENT_TMP = path.join(os.tmpdir(), "creator-studio-agent");

export type ProductionMode = "reel" | "clase" | "talking";

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

function projectData(p: Project, mode: ProductionMode): string {
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
    out.push(`- Concepto de edición${p.conceptApproved ? " (APROBADO)" : ""}: ${cut(c.resumen, 400)}\n  Estilo: ${cut(c.estiloGeneral, 240)} · Hook visual: ${cut(c.hookVisual, 200)} · Ritmo: ${cut(c.ritmo, 160)}\n  Subtítulos: ${c.subtitulos.fuente}, ${c.subtitulos.estilo}, acento ${c.subtitulos.colorAcento}, ${c.subtitulos.posicion}, ${c.subtitulos.animacion}\n  Paleta: ${c.paleta.join(", ")} · Música: ${c.musica.estilo} ${c.musica.bpm} (${cut(c.musica.notas, 120)})\n  Momentos:\n${c.momentos.map((m) => `   - ${m.tiempo} [${m.tipo}] ${cut(m.descripcion, 160)}`).join("\n")}`);
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

function modeGuide(mode: ProductionMode): string {
  if (mode === "reel") return `## Modo: REEL COMERCIAL
Reel publicitario / de lanzamiento: concepto con STRATEGY.md, música original por proyecto, SFX en los golpes, VO opcional, material real (capturas, fotos, clips importados con scripts/seq.py) sobre el sistema de movimiento del estilo. Hook legible en el fotograma 0, algo nuevo cada 2–4 s, end card ≤ 2 s con CTA.`;
  if (mode === "clase") return `## Modo: CLASE / EXPLICADOR
Video explicativo por secciones (hook → problema → 2–4 ideas → resumen/CTA). La voz (VO) manda: escribe el guion por secciones, genera la locución, alinea palabras con scripts/words.py y ancla cada aparición (título, diagrama, lista, número, resaltado) a la palabra exacta que la dice (C.beatAt(p.t0) con VO[i].words). Ritmo de lectura cómodo, una idea por pantalla, subtítulos según el estilo. Música de fondo discreta con ducking bajo la voz.`;
  return `## Modo: TALKING HEAD (grabación del creador)
La base es el video del creador hablando a cámara: CONSERVA SU VOZ (no generes VO ni reemplaces el audio de la voz). Usa el corte de la edición automática si existe (o el plan de tomas sobre la grabación original) e impórtalo como secuencia con \`.venv/bin/python scripts/seq.py <nombre> <video> <inicio_s> <dur_s>\` (elige ventanas con \`seq.py --strip\`); dibújalo con C.seq / C.drawSeq. El audio de la voz sale del mismo video (extráelo con ffmpeg a audio/voice.wav, 48 kHz) y entra en la mezcla como pista principal; la música va debajo con ducking.
Subtítulos desde los tiempos por palabra (words.json de la grabación, re-temporizados al corte si recortas) con el preset de subtítulos del estilo. Encima: punch-ins/zooms en las frases fuertes, gráficos y textos según el concepto aprobado y el estilo, B-roll solo si el usuario lo aporta. Nunca tapes la cara con texto; respeta las zonas seguras de 9:16.`;
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
  const brand = brandToPrompt(getBrand(p.brandId));
  const prev = previousMusic(p.id);
  const refs = fs.existsSync(REF) ? fs.readdirSync(REF).filter((f) => f.endsWith(".md")).map((f) => path.join(REF, f)) : [];

  return `# Rol
Eres el productor de video de ${settings.studioName || "Andoo"}: produces el video completo con el motor motion-reel (película determinista seek(t) renderizada en Chromium + ffmpeg), exactamente como en una sesión de Claude Code con el skill motion-reel, pero dentro de Andoo. El usuario es el director creativo: te habla en español (latino neutro) y tú le respondes en español, claro y breve.

# Método (obligatorio)
Antes de actuar, LEE ${SKILL} y los archivos de referencia que indica (${refs.map((r) => path.basename(r)).join(", ")} en ${REF}). Lee cada referencia cuando llegues a su fase. Sigue el método al pie de la letra:
entrevista → brief.md (sin "?" y con sección Reglas) → recursos (assets) → guía de estilo (docs/style_guide.md) → grilla de beats y música → shotlist y APROBACIÓN → voz (si aplica) → film/film.js → lint → rondas de crítica (≥ 2, todas las notas ≥ 8) → mezcla → renders finales.
- Para la crítica usa el subagente "critico" (herramienta Task/Agent) con reference/CRITIQUE.md, la ruta del proyecto y el número de ronda; mantén el mismo crítico entre rondas si puedes. Si no hay subagentes disponibles, critica tú mismo mirando las hojas y tiras renderizadas (Read sobre las imágenes), con voz de crítico: evidencia primero.
- Nunca muestres al usuario una película antes de que la crítica diga SHIP, salvo que él pida ver un avance.

# Adaptadores: herramientas de la app en lugar de las de la sesión
| En el skill / sesión de Claude Code | Aquí usa |
|---|---|
| AskUserQuestion | mcp__studio__ask_user (mismas reglas: ≤ 4 preguntas por ronda, opciones concretas, la recomendada primero) |
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
Guía completa y archivos del estilo: ${fs.existsSync(styleFile) ? styleFile : "docs/style/STYLE.md"} y la carpeta docs/style/. LÉELA antes de la guía de estilo del proyecto: su vocabulario de movimiento, ritmo, tipografía, color, sonido y subtítulos son la base; docs/style_guide.md la concreta para este video.${style.captionPreset ? ` Preset de subtítulos: ${style.captionPreset}.` : ""}${style.tokens.palette.length ? ` Paleta del estilo: ${style.tokens.palette.join(", ")}.` : ""}${style.tokens.fonts.length ? ` Tipografías: ${style.tokens.fonts.join(", ")}.` : ""}` : "Ninguno elegido: define el estilo con el usuario en la entrevista (ronda 3) y escríbelo en docs/style_guide.md. Si existe docs/style/STYLE.md, úsalo."}

# Guía de marca
${brand || "(sin guía de marca: pregunta lo esencial en la entrevista)"}
La guía de marca manda en voz, colores y tipografías cuando el estilo no los fije; nunca contradigas sus "No hacer".

# Datos del proyecto
${projectData(p, mode)}

${modeGuide(mode)}`;
}

/** Primer mensaje de la sesión. */
export function buildKickoff(p: Project, mode: ProductionMode, brief?: string): string {
  const what = mode === "reel" ? "un reel comercial" : mode === "clase" ? "una clase / video explicativo" : "el video con estilo a partir de mi grabación (talking head)";
  return `Vamos a producir ${what} para el proyecto "${p.title}".${brief?.trim() ? `\n\nMi idea / brief inicial:\n${brief.trim()}` : ""}

Empieza leyendo el skill y sus referencias, revisa lo que ya hay en el proyecto y arranca con la entrevista creativa (usa mcp__studio__ask_user). No construyas nada antes de tener el brief confirmado y el shotlist aprobado.`;
}

/** Mensaje al reanudar sin sesión viva (p. ej. tras reiniciar el servidor). */
export function resumeNote(): string {
  return "(La app se reinició o la sesión estuvo inactiva; continúas en la misma carpeta con el mismo historial. Revisa el estado de los archivos antes de seguir.)";
}
