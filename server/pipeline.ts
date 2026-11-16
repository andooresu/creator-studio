// Etapas del flujo de producción y lo que la IA devuelve en cada una.
import fs from "node:fs";
import { emitChange } from "./events.ts";
import path from "node:path";
import { ask, hasKey } from "./ai.ts";
import type { ContentBlock } from "./ai.ts";
import { load, save, projectDir, log, getBrand, INSPO_DIR, id } from "./db.ts";
import { brandToPrompt } from "./brand.ts";
import { downloadVideo } from "./inspo.ts";
import { downloadReference, extractFrames, transcribe, tools } from "./media.ts";
import { autoEdit, segmentWords } from "./editor.ts";
import { Analysis, Script, Concept, Publish, TakePlan } from "../shared/schemas.ts";
import { STAGES } from "../shared/types.ts";
import type { Jobbable, Project, Reference, InspoVideo, Word } from "../shared/types.ts";

export { STAGES };

/** Callback de progreso que reciben las etapas (actualiza job.step y el log). */
export type Step = (msg: string) => void;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function systemPrompt(project: Project | null): string {
  return `Eres el director creativo y estratega de contenido viral de este creador. Trabajas en español latino.
Tu trabajo: descomponer contenido viral de referencia, entender por qué funciona y adaptarlo a la marca SIN copiar literalmente (inspiración y estructura, nunca plagio de frases ni identidad ajena).
Sé concreto, accionable y breve en cada campo. Nada de relleno.

GUÍA DE MARCA (úsala en todo: voz, pilares, visual, hooks):
${brandToPrompt(getBrand(project?.brandId))}`;
}

function imgBlock(file: string): ContentBlock {
  return { type: "image", data: fs.readFileSync(file).toString("base64") };
}

// ---------- Ejecutor de trabajos en segundo plano ----------
export function startJob(target: Jobbable, stage: string, fn: (step: Step) => Promise<unknown>): void {
  if (target.job?.status === "running") throw new Error("Ya hay un proceso corriendo en este proyecto.");
  if (["analisis", "guion", "concepto", "publicacion", "branding", "inspiracion", "tomas"].includes(stage) && !hasKey()) throw new Error("Falta la API key del proveedor de IA elegido. Agrégala en Ajustes.");
  target.job = { stage, status: "running", step: "Iniciando…", startedAt: new Date().toISOString() };
  save(); emitChange(["jobs:status"]);
  const step: Step = (msg) => { target.job!.step = msg; log(target, msg); save(); emitChange(["jobs:step"]); };
  fn(step)
    .then(() => { target.job = { stage, status: "done", step: "Listo", endedAt: new Date().toISOString() }; save(); emitChange(["jobs:status"]); })
    .catch((e: unknown) => {
      // Solo los proyectos usan la etapa "analisis": si falla sin análisis previo, vuelve a referencias.
      if (stage === "analisis") { const p = target as Project; if (!p.analysis) p.stage = "referencias"; }
      const message = errMsg(e);
      target.job = { stage, status: "error", step: message, endedAt: new Date().toISOString() };
      log(target, "ERROR: " + message);
      save(); emitChange(["jobs:status"]);
    });
}

// ---------- 2. Análisis ----------
export async function analyze(project: Project, step: Step): Promise<void> {
  const t = tools();
  const content: ContentBlock[] = [];
  const cookies = load().settings.cookiesBrowser;
  for (const [i, ref] of project.references.entries()) {
    const dir = path.join(projectDir(project.id), "refs", ref.id);
    fs.mkdirSync(dir, { recursive: true });
    let video: string | null = ref.file || null;
    let info: NonNullable<Reference["info"]> = ref.info || {};
    let transcript = ref.transcript || "";
    if (ref.url && !video && /^https?:/.test(ref.url) && t.ytdlp) {
      step(`Descargando referencia ${i + 1}…`);
      try {
        const d = await downloadReference(ref.url, dir, cookies);
        video = d.video; info = d.info; transcript = d.subtitles;
        ref.file = video; ref.info = info;
      } catch (e) {
        step(`No pude descargar ${ref.url} (${errMsg(e).slice(0, 120)}). Analizo solo con el link y tus notas.`);
      }
    }
    let frames: { t: number; file: string }[] = [];
    if (video) {
      step(`Extrayendo fotogramas de la referencia ${i + 1}…`);
      const fr = await extractFrames(video, dir, 10);
      frames = fr.frames; info.duration = info.duration || fr.duration;
      ref.frames = frames.map((f) => path.relative(projectDir(project.id), f.file));
      ref.frameUrls = null;
      if (!transcript && (t.whisperCpp || t.whisperPy)) {
        step(`Transcribiendo audio de la referencia ${i + 1}…`);
        try { transcript = (await transcribe(video, dir))?.text || ""; } catch (e) { step("Transcripción falló: " + errMsg(e).slice(0, 100)); }
      }
    }
    ref.transcript = transcript;
    content.push({ type: "text", text: `REFERENCIA ${i + 1}\nURL: ${ref.url || "(archivo subido)"}\nNotas del creador: ${ref.note || "-"}\nMetadatos: ${JSON.stringify(info)}\nTranscripción: ${transcript || "(no disponible — infiere del video/notas)"}\nFotogramas (cada uno con su segundo):` });
    for (const f of frames) { content.push({ type: "text", text: `t=${f.t}s` }); content.push(imgBlock(f.file)); }
  }
  save();
  content.push({ type: "text", text: `Objetivo del proyecto: ${project.goal || "replicar/adaptar el formato a mi marca"}.\nDescompón la(s) referencia(s): hook, estructura por beats con tiempos, técnicas de retención, edición, por qué se viraliza y cómo adaptarlo a mi marca.` });
  step("La IA está analizando la referencia…");
  project.analysis = await ask({ stage: "analisis", projectId: project.id, system: systemPrompt(project), content, schema: Analysis });
  project.stage = "guion";
  log(project, "Análisis listo");
}

// ---------- 3. Guion + recomendaciones de grabación ----------
export async function writeScript(project: Project, step: Step, feedback = ""): Promise<void> {
  step(feedback ? "La IA está reescribiendo el guion con tu feedback…" : "La IA está escribiendo el guion…");
  const prev = project.script ? `\nGUION ANTERIOR:\n${JSON.stringify(project.script)}\nFEEDBACK DEL CREADOR (aplícalo al pie de la letra): ${feedback}` : "";
  const content: ContentBlock[] = [{ type: "text", text: `ANÁLISIS DE LA REFERENCIA:\n${JSON.stringify(project.analysis)}\nObjetivo: ${project.goal || "-"}${prev}\n\nEscribe el guion para mi reel, con mi voz (perfil de marca), palabra por palabra, listo para grabar, más recomendaciones concretas de grabación (plano, luz, audio, energía, tomas y B-roll). Hook en los primeros 2 segundos.` }];
  project.script = await ask({ stage: "guion", projectId: project.id, system: systemPrompt(project), content, schema: Script });
  project.scriptApproved = false;
  project.scriptHistory = [...(project.scriptHistory || []), { at: new Date().toISOString(), feedback }];
  project.stage = "guion";
}

// ---------- 5. Propuesta visual (sobre el material grabado) ----------
export async function proposeConcept(project: Project, step: Step, feedback = ""): Promise<void> {
  const dir = path.join(projectDir(project.id), "recording");
  const t = tools();
  if (!project.recording?.transcript && (t.whisperCpp || t.whisperPy)) {
    try { await recordingWords(project, step); } catch (e) { step("Transcripción falló: " + errMsg(e).slice(0, 100)); }
  }
  // Igual que el original: se asume que hay grabación (si no, falla y el job queda en error).
  if (!project.recording!.frames?.length) {
    step("Extrayendo fotogramas de tu grabación…");
    const fr = await extractFrames(project.recording!.file, dir, 8);
    project.recording!.duration = fr.duration;
    project.recording!.frames = fr.frames.map((f) => ({ t: f.t, rel: path.relative(projectDir(project.id), f.file) }));
  }
  save();
  const rec = project.recording!;
  const content: ContentBlock[] = [{ type: "text", text: `GUION APROBADO:\n${JSON.stringify(project.script)}\nANÁLISIS DE LA REFERENCIA (estilo de edición a emular):\n${JSON.stringify(project.analysis?.edicion || {})}\nGRABACIÓN: duración ${rec.duration?.toFixed?.(1)}s. Transcripción: ${rec.transcript || "(no disponible — usa el guion)"}\nFotogramas de mi grabación:` }];
  for (const f of rec.frames!) { content.push({ type: "text", text: `t=${f.t}s` }); content.push(imgBlock(path.join(projectDir(project.id), f.rel))); }
  if (project.concept && feedback) content.push({ type: "text", text: `PROPUESTA ANTERIOR:\n${JSON.stringify(project.concept)}\nFEEDBACK: ${feedback}` });
  content.push({ type: "text", text: "Propón el concepto visual de edición antes de editar: estilo, subtítulos, paleta, momentos exactos (zoom, B-roll, textos, SFX) con tiempos de mi grabación, música y portada." });
  step("La IA está diseñando la propuesta visual…");
  project.concept = await ask({ stage: "concepto", projectId: project.id, system: systemPrompt(project), content, schema: Concept });
  project.conceptApproved = false;
  project.stage = "concepto";
}

// ---------- Transcripción de la grabación con tiempos por palabra (se reutiliza) ----------
async function recordingWords(project: Project, step: Step): Promise<Word[]> {
  const dir = path.join(projectDir(project.id), "recording");
  const wf = path.join(dir, "words.json");
  if (fs.existsSync(wf)) return JSON.parse(fs.readFileSync(wf, "utf8")) as Word[];
  step("Transcribiendo tu grabación palabra por palabra… (≈ 1-2× la duración del video)");
  const tr = await transcribe(project.recording!.file, dir);
  if (!tr?.words?.length) throw new Error("No se obtuvo transcripción (¿whisper instalado?)");
  fs.writeFileSync(wf, JSON.stringify(tr.words));
  project.recording!.transcript = tr.text;
  save();
  return tr.words;
}

// ---------- 6a. Selección de tomas con IA ----------
export async function planTakes(project: Project, step: Step): Promise<void> {
  const words = await recordingWords(project, step);
  const segments = segmentWords(words);
  const list = segments.map((x) => `[${x.id}] ${x.s.toFixed(1)}-${x.e.toFixed(1)}s: ${x.text}`).join("\n");
  const guion = project.script ? project.script.guion.map((g) => g.texto).join(" ") : "(sin guion)";
  const content: ContentBlock[] = [{ type: "text", text: `Eres el editor del video. Esta es la transcripción de una grabación cruda, dividida en segmentos numerados con sus tiempos.
El creador repite frases cuando se equivoca (varias tomas), arranca en falso, dice muletillas o se sale del guion.

GUION APROBADO:
${guion}

SEGMENTOS:
${list}

Decide para CADA segmento si se mantiene. Reglas:
- Si una frase se dijo varias veces, mantén solo la mejor toma (normalmente la última completa y fluida) y descarta las demás.
- Descarta arranques en falso, frases cortadas, muletillas sueltas ("eh", "bueno", "ok va de nuevo") y comentarios fuera del guion.
- No descartes contenido único que aporte a la historia aunque no esté en el guion.
- El resultado debe leerse como un texto continuo, en orden, sin huecos de sentido.
Devuelve una decisión por cada id.` }];
  step("La IA está eligiendo la mejor toma de cada frase…");
  const plan = await ask({ stage: "edicion", projectId: project.id, system: systemPrompt(project), content, schema: TakePlan, maxTokens: 16000 });
  const byId = new Map(plan.decisiones.map((d) => [d.id, d]));
  project.editPlan = {
    resumen: plan.resumen,
    segments: segments.map((x) => ({ ...x, keep: byId.get(x.id)?.mantener ?? true, reason: byId.get(x.id)?.motivo || "sin decisión (se mantiene)" })),
    at: new Date().toISOString(),
  };
  project.stage = "edicion";
}

// ---------- 6b. Edición automática ----------
export async function runEdit(project: Project, step: Step): Promise<void> {
  let words: Word[] | null = null;
  const wf = path.join(projectDir(project.id), "recording", "words.json");
  if (fs.existsSync(wf)) words = JSON.parse(fs.readFileSync(wf, "utf8")) as Word[];
  const res = await autoEdit({ input: project.recording!.file, dir: projectDir(project.id), concept: project.concept, plan: project.editPlan, words, brollDir: load().settings.brollDir, onStep: step });
  const rel = (p: string | null | undefined): string | null => (p ? path.relative(projectDir(project.id), p) : null);
  project.edit = { ...res, final: rel(res.final), cut: rel(res.cut), srtPath: rel(res.srtPath), briefPath: res.briefPath, at: new Date().toISOString() };
  project.editApproved = false;
  project.stage = "edicion";
}

// ---------- 7. Paquete de publicación (Trial Reels) ----------
export async function publishPack(project: Project, step: Step): Promise<void> {
  step("La IA está preparando caption, hashtags y estrategia de Trial Reel…");
  const content: ContentBlock[] = [{ type: "text", text: `GUION FINAL:\n${JSON.stringify(project.script)}\nCONCEPTO:\n${JSON.stringify({ portada: project.concept?.portada, hook: project.concept?.hookVisual })}\nPrepara la publicación en Instagram como Trial Reel (se muestra primero a no seguidores): caption con gancho, hashtags (máx 5, relevantes), texto de portada, primer comentario, mejor momento para publicar y cómo leer resultados del trial para decidir si compartirlo con seguidores.` }];
  project.publish = await ask({ stage: "publicar", projectId: project.id, system: systemPrompt(project), content, schema: Publish, maxTokens: 8000 });
  project.stage = "publicacion";
}

// ---------- Inspiración: analizar un video sin crear proyecto ----------
export async function analyzeInspoVideo(video: InspoVideo, step: Step): Promise<void> {
  const t = tools();
  const dir = path.join(INSPO_DIR, `${video.platform}_${video.account}`, "an_" + video.id.replace(/[^\w-]/g, ""));
  step("Descargando el video…");
  const file = await downloadVideo(video, dir);
  if (!file) throw new Error("No pude descargar el video. Prueba con cookies del navegador o Apify en Ajustes.");
  video.file = file;
  step("Extrayendo fotogramas…");
  const fr = await extractFrames(file, dir, 10);
  video.frameUrls = fr.frames.map((f) => "/inspo/" + path.relative(INSPO_DIR, f.file));
  if (!video.transcript && (t.whisperCpp || t.whisperPy)) {
    step("Transcribiendo…");
    try { video.transcript = (await transcribe(file, dir))?.text || ""; } catch { /* se analiza sin transcripción */ }
  }
  save();
  const content: ContentBlock[] = [{ type: "text", text: `VIDEO DE @${video.account} (${video.platform})\nURL: ${video.url}\nMétricas: ${video.views} vistas, ${video.likes} likes, ${video.comments} comentarios, outlier ${video.outlier}x la mediana de la cuenta.\nCaption: ${video.caption}\nTranscripción: ${video.transcript || "(no disponible)"}\nFotogramas:` }];
  for (const f of fr.frames) { content.push({ type: "text", text: `t=${f.t}s` }); content.push(imgBlock(f.file)); }
  content.push({ type: "text", text: "Descompón este video: hook, estructura por beats, técnicas de retención, edición, por qué rinde por encima del promedio de la cuenta, y cómo adaptarlo a mi marca." });
  step("La IA está analizando el video…");
  video.analysis = await ask({ stage: "inspiracion", system: systemPrompt(null), content, schema: Analysis });
  video.analyzedAt = new Date().toISOString();
}

export function projectFromVideo(video: InspoVideo, { brandId, title }: { brandId?: string | null; title?: string } = {}): Project {
  const p: Project = {
    id: id(), title: title || (video.caption || "Idea de @" + video.account).replace(/\s+/g, " ").slice(0, 60),
    goal: "", brandId: brandId || load().settings.defaultBrandId, stage: video.analysis ? "guion" : "referencias",
    references: [{ id: id(), url: video.url, file: video.file || null, note: `Desde Inspiración · @${video.account} · ${video.outlier ?? "?"}x`, info: { uploader: video.account, views: video.views, likes: video.likes, comments: video.comments, platform: video.platform }, transcript: video.transcript || "", frameUrls: video.frameUrls || null, inspoId: video.id, addedAt: new Date().toISOString() }],
    analysis: video.analysis || null, createdAt: new Date().toISOString(), log: [],
  };
  log(p, `Proyecto creado desde Inspiración (@${video.account})`);
  return p;
}
