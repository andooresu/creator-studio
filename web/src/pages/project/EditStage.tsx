// 4. Edición: un solo camino por defecto. «Tu video» muestra el avance (tomas y corte → plantilla → listo),
// el mejor resultado (render final de la plantilla > borrador > corte rápido) con «Aprobar video» y «Ajustar».
// El productor (ProductionPanel) queda incrustado con sus tarjetas de pregunta, aprobación y presupuesto.
// «Avanzado» guarda los controles finos: tomas, volver a cortar, solo silencios, producir de nuevo, descargas.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, Circle, Clapperboard, Download, FolderOpen, MessageSquare, RotateCcw, Scissors, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { VideoPlayer } from "@/components/VideoPlayer.tsx";
import { cn } from "@/lib/utils.ts";
import { FORMATS } from "../../../../shared/types.ts";
import type { Format, Project, RenderOutput, Tools } from "../../../../shared/types.ts";
import { api } from "../../api.ts";
import { useApp } from "../../store.tsx";
import { copy, fmtT, Tag } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";
import { ConfirmInline } from "./ConfirmInline.tsx";
import { ProductionPanel } from "./Production.tsx";
import { CapField, EstimateLine, capInvalid, parseCap, useCapValue, useEstimate } from "./Estimate.tsx";
import { EditRunOptions, editRunSummary, useEditRunOptions } from "./EditRunOptions.tsx";

const FMT_LABEL: Record<Format, string> = { "9x16": "9:16", "4x5": "4:5", "1x1": "1:1", "16x9": "16:9" };
const FMT_ASPECT: Record<Format, string> = { "9x16": "9 / 16", "4x5": "4 / 5", "1x1": "1 / 1", "16x9": "16 / 9" };
const CHECK = { width: 16, height: 16, padding: 0, margin: 0, accentColor: "var(--blue)", flex: "none" } as const;
const CHECK_LABEL = "m-0! inline-flex! cursor-pointer items-center gap-2 text-[13px]! font-normal! text-foreground!";

/** Render del productor preferido para un modo: el 9:16 más reciente, si no el más reciente de cualquier formato
 *  (los renders se acumulan y cada exportación reescribe la misma ruta: el más nuevo es el que está en disco). */
function pickRender(renders: RenderOutput[], mode: RenderOutput["mode"]): RenderOutput | null {
  const xs = renders.filter((r) => r.mode === mode).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return xs.find((r) => r.fmt === "9x16") || xs[0] || null;
}
/** Renders que cuentan como resultado ahora (igual que el servidor, currentRenders en runner.ts): con una corrida de
 *  plantilla, solo los posteriores a su inicio; si no, solo los posteriores a la grabación actual. */
function currentRenders(p: Project): RenderOutput[] {
  const er = p.editRun;
  const cutoff = er && !er.quick ? er.startedAt : p.recording?.at || "";
  return (p.production?.renders || []).filter((r) => (r.at || "") >= cutoff);
}
const renderUrl = (pid: string, r: RenderOutput): string =>
  `/media/${pid}/motion/${r.path.replace(/^\.?\//, "")}${r.at ? "?v=" + encodeURIComponent(r.at) : ""}`;

type StepState = "done" | "active" | "paused" | "pending" | "error";
function StepRow({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center" aria-hidden>
        {state === "done" ? <Check className="size-4 text-success" />
          : state === "active" ? <span className="spinner" style={{ width: 16, height: 16 }} />
          : state === "paused" ? <CircleAlert className="size-4 text-warning" />
          : state === "error" ? <CircleAlert className="size-4 text-danger" />
          : <Circle className="size-3.5 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14px]", state === "pending" ? "text-muted-foreground" : "font-medium")}>
          {title}<span className="sr-only"> ({state === "done" ? "hecho" : state === "active" ? "en curso" : state === "paused" ? "en pausa" : state === "error" ? "falló" : "pendiente"})</span>
        </span>
        {children ? <span className="small muted block break-words">{children}</span> : null}
      </span>
    </li>
  );
}

export function EditStage({ p, running, run, setProject, goStage }: StageProps) {
  const { state, toast, act } = useApp();
  const e = p.edit;
  const t: Partial<Tools> = state?.tools ?? {};
  const plan = p.editPlan;
  const hasWhisper = !!(t.whisperCpp || t.whisperPy);
  const keptDur = plan ? plan.segments.filter((x) => x.keep).reduce((a, x) => a + (x.e - x.s), 0) : 0;
  const er = p.editRun || null;
  const prod = p.production || null;
  // un aviso de tope solo (nada corriendo) no cuenta como trabajando: igual que el servidor (producerWorking)
  const prodBusy = prod?.status === "running" || (prod?.status === "waiting" && prod.pending?.type !== "budget");
  const editJob = running && (p.job?.stage === "edicion" || p.job?.stage === "tomas");

  // ---------- camino por defecto ----------
  const opts = useEditRunOptions(p);
  const [showOpts, setShowOpts] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const advRef = useRef<HTMLDetailsElement>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjText, setAdjText] = useState("");
  const [askQuick, setAskQuick] = useState(false);

  const renders = currentRenders(p);
  const finalR = pickRender(renders, "final");
  const draftR = finalR ? null : pickRender(renders, "draft");
  const quickPath = e?.final || e?.cut || null;
  // Si elegiste solo el corte rápido, se muestra ese aunque quede un render de una producción anterior.
  // (también si lo aprobado es el corte rápido: lo que se ve es lo que va a Publicación)
  const preferQuick = (!!er?.quick || (!!p.editApproved && p.finalVideo?.source === "rapido")) && !!quickPath;
  const out = !preferQuick && finalR
    ? { src: renderUrl(p.id, finalR), aspect: FMT_ASPECT[finalR.fmt] || "9 / 16", kind: "plantilla" as const, key: finalR.path + finalR.at }
    : !preferQuick && draftR
      ? { src: renderUrl(p.id, draftR), aspect: FMT_ASPECT[draftR.fmt] || "9 / 16", kind: "borrador" as const, key: draftR.path + draftR.at }
      : quickPath && e
        ? { src: `/media/${p.id}/${quickPath}?v=${encodeURIComponent(e.at)}`, aspect: "9 / 16", kind: "rapido" as const, key: quickPath + e.at }
        : null;
  const approveSource: "plantilla" | "rapido" | null = out?.kind === "plantilla" ? "plantilla" : quickPath ? "rapido" : null;
  // «Aprobado» solo sobre el video que se aprobó (no sobre otro tipo ni sobre un render posterior a la aprobación)
  const fvAt = p.finalVideo?.at || "";
  const approvedShown = !!p.editApproved && !!p.finalVideo && out?.kind === p.finalVideo.source && (out.kind !== "plantilla" || !finalR || (finalR.at || "") <= fvAt);
  // el productor espera justo la aprobación del video final: «Aprobar video» cuenta como esa aprobación
  const finalWaiting = prod?.status === "waiting" && prod.pending?.type === "approval" && prod.pending.data.kind === "final";
  // mientras el productor trabaja, su render todavía puede cambiar (se reescribe en la misma ruta): no se aprueba aún
  const approveBlocked = approveSource === "plantilla" && prodBusy && !finalWaiting;
  // aprobar el corte rápido con la plantilla en curso la detiene (no sigue gastando)
  const stopsProducer = approveSource === "rapido" && prodBusy;
  const [busy, setBusy] = useState(false);

  // Estado del avance (el servidor lo guarda; si la producción ya terminó con un render final, cuenta como listo).
  let runState = er?.state ?? null;
  if (runState === "plantilla" && prod?.status === "done" && finalR) runState = "listo";
  const stalled = runState === "corte" && !editJob; // p. ej. el servidor se reinició a mitad del corte
  const active = (runState === "corte" && !stalled) || (runState === "plantilla" && (prodBusy || !prod));
  // solo un aviso de tope (nada corriendo): la plantilla está en pausa hasta que decidas, no falló
  const budgetWait = prod?.status === "waiting" && prod.pending?.type === "budget";
  // «Ajustar» sobre un video ya terminado o aprobado inicia una corrida nueva de la plantilla (igual que el servidor)
  const adjustStartsRun = !!er && (!!p.editApproved || !!er.quick || er.state === "listo");

  const startEdit = async () => {
    if (busy) return;
    if (opts.invalid) { toast("Corrige el tope para este video: escribe un número entre 0 y 10.000.", true); document.getElementById(`edit-${p.id}-cap`)?.focus(); return; }
    setBusy(true);
    try {
      await run("edit/auto", opts.request(), opts.quick ? "Cortando tu video ✓" : "Editando tu video ✓");
      setShowOpts(false);
    } catch { /* el error ya se mostró como notificación */ }
    finally { setBusy(false); }
  };
  const onApprove = async (source: "plantilla" | "rapido") => {
    if (busy) return;
    setBusy(true);
    try {
      await run("approve/edit", { source }, "Video aprobado ✓");
      goStage("publicacion");
    } catch { /* el error ya se mostró como notificación */ }
    finally { setBusy(false); }
  };
  const openAdvanced = () => {
    setAdvOpen(true);
    requestAnimationFrame(() => advRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // «Ajustar» habla con el productor solo si lo que ves es su video; sobre el corte rápido (gratis) abre Avanzado
  const onAdjustClick = () => { if (prod && out?.kind !== "rapido") setAdjusting(true); else openAdvanced(); };
  const waitingCard = prod?.status === "waiting" && !!prod.pending;
  const sendAdjust = async () => {
    const text = adjText.trim();
    if (!text) { toast("Escribe qué quieres ajustar", true); return; }
    try {
      // newRun: si el video ya estaba terminado o aprobado, el servidor inicia una corrida nueva de la plantilla
      const np = await act(() => api<Project>(`/api/projects/${p.id}/production/message`, { method: "POST", body: { text, newRun: true } }), adjustStartsRun ? "Corrida nueva de la plantilla iniciada ✓" : "Enviado al productor ✓");
      setProject(np);
      setAdjText("");
      setAdjusting(false);
    } catch { /* el error ya se mostró como notificación */ }
  };

  // ---------- avanzado: tomas ----------
  const initKeep = () => new Set((plan?.segments || []).filter((x) => x.keep).map((x) => x.id));
  const [keep, setKeep] = useState<Set<number>>(initKeep);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState<null | "replan" | "drop">(null);
  const origVid = useRef<HTMLVideoElement>(null);
  const planKey = plan ? plan.at : "";
  useEffect(() => { setKeep(initKeep()); setDirty(false); }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const collectKeep = (): number[] => (plan?.segments || []).filter((x) => keep.has(x.id)).map((x) => x.id);
  const savePlan = async (): Promise<void> => {
    const np = await act(() => api<Project>(`/api/projects/${p.id}/edit-plan`, { method: "PUT", body: { keepIds: collectKeep() } }));
    setProject(np);
    setDirty(false);
  };
  const onToggle = (id: number, checked: boolean) => {
    setKeep((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
    setDirty(true);
  };
  const onSeek = (ev: MouseEvent<HTMLButtonElement>, s: number) => {
    ev.preventDefault();
    const v = origVid.current;
    if (!v) return;
    v.currentTime = s;
    void v.play();
  };
  const doPlan = () => { setAsking(null); run("edit-plan").catch(() => {}); };
  const onPlan = () => { if (plan) setAsking("replan"); else doPlan(); };
  const onDropPlan = async () => {
    setAsking(null);
    try { setProject(await api<Project>(`/api/projects/${p.id}/edit-plan`, { method: "DELETE" })); } catch { /* como el original: sin notificación */ }
  };
  const onSavePlan = async () => {
    try { await savePlan(); toast("Selección guardada"); } catch { /* el error ya se mostró como notificación */ }
  };
  const onRecut = async () => {
    try {
      if (plan && dirty) await savePlan();
      await run("edit", undefined, "Cortando de nuevo ✓");
    } catch { /* el error ya se mostró como notificación */ }
  };
  const reveal = () => { api(`/api/projects/${p.id}/reveal`, { method: "POST", body: { sub: "edit" } }).catch(() => {}); };

  // ---------- avanzado: producir de nuevo con plantilla ----------
  const talkStyles = opts.talkStyles;
  const [styleId, setStyleId] = useState<string>(p.styleId || "");
  useEffect(() => { if (p.styleId) setStyleId(p.styleId); }, [p.styleId]);
  const chosenStyle = styleId || talkStyles[0]?.id || "";
  const hasBrand = opts.hasBrand;
  const brands = state?.brands || [];
  const brand = brands.find((b) => b.id === p.brandId) || brands.find((b) => b.id === state?.defaultBrandId) || brands[0] || null;
  // si ya hubo una producción, se parte de las opciones que el usuario eligió entonces
  const saved = (prod as { flags?: { useBrand?: boolean; music?: boolean; formats?: Format[] } } | null)?.flags;
  const [useBrand, setUseBrand] = useState(saved?.useBrand ?? hasBrand);
  useEffect(() => { setUseBrand(saved?.useBrand ?? hasBrand); }, [hasBrand, saved?.useBrand]);
  const [music, setMusic] = useState(saved?.music ?? true);
  const [formats, setFormats] = useState<Format[]>(saved?.formats?.length ? saved.formats : ["9x16"]);
  useEffect(() => {
    if (saved?.music !== undefined) setMusic(saved.music);
    if (saved?.formats?.length) setFormats(saved.formats);
  }, [saved?.music, saved?.formats?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFmt = (f: Format, on: boolean) => {
    setFormats((prev) => {
      const next = on ? [...prev, f] : prev.filter((x) => x !== f);
      return next.length ? FORMATS.filter((x) => next.includes(x)) : prev; // al menos un formato
    });
  };
  const est = useEstimate(p.id, "talking");
  const [cap, setCap] = useCapValue(est, prod?.capUsd);
  const onStyledRender = async () => {
    if (!chosenStyle) { toast("Elige una plantilla", true); return; }
    if (capInvalid(cap)) { toast("Corrige el tope para este video: escribe un número entre 0 y 10.000.", true); document.getElementById(`cap-edit-${p.id}`)?.focus(); return; }
    const styleName = talkStyles.find((x) => x.id === chosenStyle)?.name || "la plantilla elegida";
    const restyle = !!prod && p.styleId !== chosenStyle;
    try {
      if (p.styleId !== chosenStyle) {
        const np = await act(() => api<Project>(`/api/projects/${p.id}`, { method: "PATCH", body: { styleId: chosenStyle } }));
        setProject(np);
      }
      // El servidor detecta el cambio de plantilla al iniciar: copia la nueva guía y le pide al productor rehacer el diseño.
      const okMsg = restyle
        ? `Plantilla cambiada a «${styleName}»: el productor rehará el diseño con la nueva guía ✓`
        : prod ? "Producción reanudada ✓" : "Producción iniciada ✓";
      // newRun: es una corrida nueva de la plantilla (su render es el que se muestra y se aprueba)
      await run("production/start", { mode: "talking", styleId: chosenStyle, flags: { ...(hasBrand ? { useBrand } : {}), music, formats }, capUsd: parseCap(cap), newRun: true }, okMsg);
    } catch { /* el error ya se mostró como notificación */ }
  };

  const ccText = e ? `Lee ${e.briefPath} y produce la versión final del reel siguiendo el brief.` : "";
  const motionReady = state?.motion?.ready ?? false;

  // ---------- tarjeta «Tu video» ----------
  const prodLine = (): string => {
    if (!prod) return "Preparando la plantilla…";
    if (prod.status === "running") return "El productor está trabajando con la plantilla.";
    if (prod.status === "waiting") {
      const k = prod.pending?.type;
      return k === "question" ? "Te hizo una pregunta: respóndela abajo."
        : k === "approval" ? "Espera tu aprobación abajo."
        : k === "budget" ? "Llegó al tope de costo: decide abajo si sigue."
        : "Espera tu respuesta abajo.";
    }
    if (prod.status === "error") return "El productor se detuvo con un error. Revisa abajo.";
    if (prod.status === "done" && !finalR) return "El productor terminó sin video final: pídele que lo exporte abajo.";
    return "";
  };

  let card: ReactNode;
  if (!p.conceptApproved) {
    card = (
      <>
        <p className="muted m-0">Aprueba la propuesta visual y la edición empieza sola: elegimos las mejores tomas, cortamos y aplicamos la plantilla.</p>
        <Button className="mt-3" onClick={() => goStage("concepto")}>Ir a Propuesta visual<ArrowRight aria-hidden /></Button>
      </>
    );
  } else if (!er || showOpts) {
    card = (
      <div className="grid gap-3">
        <p className="m-0 text-[14px]">{editRunSummary(opts, "Al editar")}</p>
        <EditRunOptions o={opts} idPrefix={`edit-${p.id}`} disabled={running || prodBusy} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={running || busy || prodBusy || opts.invalid || !p.recording} onClick={() => void startEdit()}><Wand2 aria-hidden />{er || e ? "Editar de nuevo" : "Editar video"}</Button>
          {showOpts ? <Button variant="ghost" onClick={() => setShowOpts(false)}>Cancelar</Button> : null}
        </div>
        {!p.recording ? <p className="small muted m-0">Necesitas una grabación primero.</p> : null}
        {prodBusy ? <p className="small muted m-0">El productor está trabajando: espera a que termine o detenlo abajo.</p> : null}
      </div>
    );
  } else {
    const failed = runState === "error" || stalled;
    // el corte de esta corrida ya terminó si el resultado del corte es posterior al inicio
    const cutDone = !!e && (e.at || "") >= er.startedAt;
    const failedAt = failed ? (stalled || er.quick || !cutDone ? "corte" : "plantilla") : null;
    const s1: StepState = runState === "corte" && !stalled ? "active" : failedAt === "corte" ? "error" : "done";
    const s2: StepState = failedAt === "plantilla" ? "error"
      : runState === "plantilla" ? (active ? "active" : budgetWait ? "paused" : "error")
      : runState === "listo" ? "done" : "pending";
    const s3: StepState = runState === "listo" ? "done" : "pending";
    const styleName = opts.talkStyles.find((x) => x.id === er.styleId)?.name;
    card = (
      <div className="grid gap-3">
        <ol className="m-0 grid list-none gap-2.5 p-0" aria-label="Avance de la edición">
          <StepRow state={s1} title="Tomas y corte">
            {s1 === "active" ? (p.job?.step || "Eligiendo las mejores tomas y cortando…") : s1 === "error" ? (stalled ? "Se interrumpió (¿se reinició la app?)." : er.error) : null}
          </StepRow>
          {er.quick ? null : (
            <StepRow state={s2} title={styleName ? `Plantilla «${styleName}»` : "Plantilla"}>
              {s2 === "active" || s2 === "paused" ? prodLine() : s2 === "error" ? (er.error || prodLine()) : null}
            </StepRow>
          )}
          <StepRow state={s3} title="Listo">{s3 === "done" ? (er.quick ? "Corte rápido listo." : "Video con plantilla listo.") : null}</StepRow>
        </ol>
        {failed ? (
          <div role="alert" className="rounded-md bg-surface-2 p-3 text-[13px]">
            {failedAt === "plantilla" && quickPath ? "La plantilla falló, pero el corte rápido quedó listo: puedes aprobarlo o reintentar." : "No se pudo terminar la edición."}
          </div>
        ) : null}
        {!active ? (
          <div className="flex flex-wrap gap-2">
            {failed ? <Button disabled={running || busy || prodBusy || opts.invalid} onClick={() => void startEdit()}><RotateCcw aria-hidden />Reintentar</Button> : null}
            <Button variant={failed ? "ghost" : "secondary"} size={failed ? "default" : "sm"} disabled={running || prodBusy} onClick={() => setShowOpts(true)}>Cambiar opciones y editar de nuevo</Button>
            {prodBusy ? <p className="small muted m-0 basis-full">El productor está trabajando: espera a que termine o detenlo abajo.</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid2 min-[901px]:grid-cols-[340px_minmax(0,1fr)]!">
      <div className="stack min-w-0">
        {out ? (
          <div className="w-full max-w-[320px]">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="m-0">Tu video</h3>
              {out.kind === "plantilla" ? <Tag tone="g">Con plantilla</Tag> : out.kind === "borrador" ? <Tag tone="y">borrador</Tag> : <Tag>Corte rápido</Tag>}
              {approvedShown ? <Tag tone="g">Aprobado</Tag> : null}
            </div>
            <VideoPlayer key={out.key} src={out.src} aspect={out.aspect} label="Resultado de la edición" />
          </div>
        ) : (
          <div className="card"><p className="muted m-0">{editJob || active ? "Tu video aparecerá aquí en cuanto esté el corte." : "Aún no hay video editado. El resultado aparecerá aquí."}</p></div>
        )}
      </div>

      <div className="stack min-w-0">
        <section className="card" aria-labelledby={`tu-video-${p.id}`}>
          <div className="row"><h2 id={`tu-video-${p.id}`} className="grow">Tu video</h2>{er && runState === "listo" ? <Tag tone="g">Listo</Tag> : null}</div>
          {card}
        </section>

        {out && approveSource && p.conceptApproved ? (
          <section className="card" aria-label="Aprobar o ajustar">
            {out.kind === "borrador" ? <p className="small muted mt-0">El video con plantilla aún es un borrador. Puedes esperar el final o aprobar el corte rápido.</p> : null}
            {approveBlocked ? <p className="small muted mt-0">El productor sigue trabajando con la plantilla: podrás aprobar el video cuando termine.</p> : null}
            {stopsProducer ? <p className="small muted mt-0">Si apruebas el corte rápido, el productor de la plantilla se detiene (no sigue gastando).</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={running || busy || approveBlocked} onClick={() => void onApprove(approveSource)}>
                <Check aria-hidden />{out.kind === "borrador" || stopsProducer ? "Aprobar el corte rápido" : "Aprobar video"}
              </Button>
              <Button variant="secondary" onClick={onAdjustClick} aria-expanded={prod && out.kind !== "rapido" ? adjusting : undefined}><MessageSquare aria-hidden />Ajustar</Button>
            </div>
            {adjusting && prod && out.kind !== "rapido" ? (
              <div className="mt-3 grid gap-2">
                <label htmlFor={`adjust-${p.id}`} className="m-0!">¿Qué quieres cambiar?</label>
                <textarea id={`adjust-${p.id}`} autoFocus value={adjText} onChange={(ev) => setAdjText(ev.target.value)} placeholder="Subtítulos más grandes, quita la música al final, corta la pausa del segundo 12…" />
                {waitingCard ? <p className="small muted m-0">El productor espera que respondas su tarjeta abajo; responde ahí primero.</p> : null}
                {adjustStartsRun ? <p className="small muted m-0">Esto inicia una corrida nueva de la plantilla (tiene costo){p.editApproved ? " y quita la aprobación del video" : ""}.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!adjText.trim() || waitingCard} onClick={() => void sendAdjust()}>Enviar al productor</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdjusting(false)}>Cancelar</Button>
                  <Button size="sm" variant="link" className="px-0" onClick={openAdvanced}>Ajustes avanzados</Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {prod ? (
          <section aria-label="Productor de la plantilla" id={`prod-${p.id}`} className="min-w-0">
            <ProductionPanel p={p} setProject={setProject} />
          </section>
        ) : null}

        <details ref={advRef} className="card" open={advOpen} onToggle={(ev) => setAdvOpen((ev.currentTarget as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-[15px] font-semibold select-none">Avanzado</summary>
          <div className="mt-3 grid min-w-0 gap-5">
            {/* Tomas */}
            <div className="min-w-0">
              <h3>Tomas</h3>
              <p className="muted small">La IA lee la transcripción palabra por palabra y se queda con la mejor toma de cada frase. Marca o desmarca frases y vuelve a cortar.</p>
              {hasWhisper ? null : <p className="small"><Tag tone="r">Requiere whisper</Tag></p>}
              {asking === "replan" ? (
                <ConfirmInline question="¿Reemplazar tu selección actual por una nueva de la IA?" yes="Sí, reemplazar" onYes={doPlan} onNo={() => setAsking(null)} />
              ) : asking === "drop" ? (
                <ConfirmInline question="¿Descartar la selección y cortar solo por silencios?" yes="Sí, descartar" onYes={() => void onDropPlan()} onNo={() => setAsking(null)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled={running || !p.conceptApproved || !hasWhisper} onClick={onPlan}>
                    {plan ? <><RotateCcw aria-hidden />Volver a elegir con IA</> : <><Wand2 aria-hidden />Elegir tomas con IA</>}
                  </Button>
                  {plan ? <Button variant="ghost" size="sm" onClick={() => setAsking("drop")}>Usar solo corte de silencios</Button> : null}
                </div>
              )}
              {plan ? (
                <>
                  <p style={{ marginTop: 12 }}><b>{plan.segments.filter((x) => x.keep).length}</b> de {plan.segments.length} frases · <b>~{Math.round(keptDur)}s</b> de voz · <span className="muted">{plan.resumen}</span></p>
                  <video ref={origVid} key={p.recording?.at} className="video-9x16" style={{ maxWidth: 240 }} src={`/api/projects/${p.id}/recording/video`} controls preload="metadata" aria-label="Grabación original" />
                  <p className="small muted">Clic en el tiempo de una frase para escucharla en la grabación original.</p>
                  <div className="takes">{plan.segments.map((x) => {
                    const on = keep.has(x.id);
                    return (
                      <label key={x.id} className={`take${on ? "" : " off"}`}>
                        <input type="checkbox" aria-label={`Conservar frase en ${fmtT(x.s)}`} checked={on} onChange={(ev) => onToggle(x.id, ev.target.checked)} />
                        <button type="button" className="tm-btn" aria-label={`Escuchar desde ${fmtT(x.s)}`} onClick={(ev) => onSeek(ev, x.s)}>{fmtT(x.s)}</button>
                        <span className="grow"><span className="txt">{x.text}</span><span className="why">{x.reason}</span></span>
                      </label>
                    );
                  })}</div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm" onClick={() => void onSavePlan()}>Guardar selección</Button><span className="small muted" aria-live="polite">{dirty ? "Cambios sin guardar" : ""}</span></div>
                </>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" disabled={running || prodBusy || !p.conceptApproved || !p.recording} onClick={() => void onRecut()}><Scissors aria-hidden />Volver a cortar (rápido)</Button>
                <span className="small muted">{plan ? "Corta las frases marcadas" : "Sin selección: corta silencios y pausas"}; 9:16, audio a -14 LUFS y subtítulos. Gratis.</span>
                {prodBusy ? <span className="small muted basis-full">El productor está trabajando: espera a que termine o detenlo abajo.</span> : null}
              </div>
              <p className="small mt-2">{hasWhisper ? <Tag tone="g">Whisper listo</Tag> : <Tag tone="r">Sin whisper: no habrá subtítulos</Tag>} {t.subtitlesFilter ? <Tag tone="g">Subtítulos quemados</Tag> : <Tag tone="y">ffmpeg sin libass: subtítulos como .srt</Tag>}</p>
            </div>

            {/* Producir de nuevo con plantilla */}
            <div className="min-w-0 border-t border-[var(--line)] pt-4">
              <h3>Plantilla</h3>
              <p className="muted small">Un agente toma tu grabación ya cortada y la produce con la plantilla: subtítulos animados, títulos, gráficos, música y efectos. Tiene costo: usa tu clave de Anthropic (y ElevenLabs si genera música o voz).</p>
              {!motionReady ? <p className="small"><Tag tone="y">Entorno del motor incompleto</Tag> <a href="#/ajustes" className="small">Ver en Ajustes</a></p> : null}
              {talkStyles.length ? (
                <>
                  <label htmlFor={`edit-style-${p.id}`}>Plantilla</label>
                  <select id={`edit-style-${p.id}`} className="max-w-full" value={chosenStyle} disabled={prodBusy} onChange={(ev) => setStyleId(ev.target.value)}>
                    {talkStyles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kind === "any" ? " (cualquier tipo)" : ""}</option>)}
                  </select>
                  {(() => { const d = talkStyles.find((x) => x.id === chosenStyle)?.description; return d ? <p className="small muted" style={{ marginTop: 4 }}>{d}</p> : null; })()}
                </>
              ) : <p className="small muted">No hay plantillas para videos a cámara. <a href="#/estilos">Crea una en Estilos</a>.</p>}
              <fieldset className="mt-3 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={prodBusy}>
                <legend className="sr-only">Opciones de la producción</legend>
                <label className={cn(CHECK_LABEL, !hasBrand && "cursor-not-allowed text-muted-foreground!")}>
                  <input type="checkbox" checked={hasBrand && useBrand} disabled={!hasBrand} onChange={(ev) => setUseBrand(ev.target.checked)} style={CHECK} />
                  {hasBrand ? <>Usar mi marca <span className="muted">({brand?.name})</span></> : <>Usar mi marca <span className="muted">(aún no tienes una guía)</span></>}
                </label>
                <label className={CHECK_LABEL}>
                  <input type="checkbox" checked={music} onChange={(ev) => setMusic(ev.target.checked)} style={CHECK} />
                  Música de fondo
                </label>
                <div role="group" aria-label="Formatos" className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="small muted">Formatos:</span>
                  {FORMATS.map((f) => (
                    <label key={f} className={CHECK_LABEL}>
                      <input type="checkbox" checked={formats.includes(f)} onChange={(ev) => toggleFmt(f, ev.target.checked)} style={CHECK} />
                      {FMT_LABEL[f]}
                    </label>
                  ))}
                </div>
                <div className="mt-1 grid gap-2.5 rounded-md bg-surface-2 p-3">
                  <EstimateLine est={est} />
                  <CapField id={`cap-edit-${p.id}`} value={cap} onChange={setCap} disabled={prodBusy} defaultCap={est?.capUsd} />
                </div>
              </fieldset>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" className="max-w-full whitespace-normal" disabled={running || prodBusy || !chosenStyle || !p.recording || capInvalid(cap)} onClick={() => void onStyledRender()}>
                  {prod ? <><RotateCcw aria-hidden />Producir de nuevo con plantilla</> : <><Clapperboard aria-hidden />Producir con plantilla</>}
                </Button>
                <Button variant="ghost" size="sm" asChild><a href={chosenStyle ? `#/estilos/${chosenStyle}` : "#/estilos"}>Ver plantilla</a></Button>
              </div>
            </div>

            {/* Archivos */}
            {e ? (
              <div className="min-w-0 border-t border-[var(--line)] pt-4">
                <h3>Corte rápido</h3>
                <p className="small muted">{e.originalDuration.toFixed(0)}s → {e.finalDuration.toFixed(0)}s · {e.segments} tramos {e.mode === "tomas" ? "por tomas" : "por silencios"} · subtítulos {e.burned ? "quemados" : e.srtPath ? "en .srt" : "no"}</p>
                <div className="flex flex-wrap gap-2">
                  {e.final ? <Button variant="secondary" size="sm" asChild><a href={`/media/${p.id}/${e.final}`} download><Download aria-hidden />Descargar MP4</a></Button> : null}
                  {e.srtPath ? <Button variant="secondary" size="sm" asChild><a href={`/media/${p.id}/${e.srtPath}`} download><Download aria-hidden />Subtítulos .srt</a></Button> : null}
                  <Button variant="ghost" size="sm" onClick={reveal}><FolderOpen aria-hidden />Abrir carpeta</Button>
                </div>
                {finalR && quickPath ? (
                  <div className="mt-3">
                    {askQuick ? (
                      <ConfirmInline question={prodBusy ? "¿Aprobar el corte rápido y detener al productor de la plantilla?" : "¿Aprobar el corte rápido en lugar del video con plantilla?"} yes="Sí, aprobar corte rápido" onYes={() => { setAskQuick(false); void onApprove("rapido"); }} onNo={() => setAskQuick(false)} />
                    ) : <Button variant="ghost" size="sm" disabled={running || busy} onClick={() => setAskQuick(true)}>Aprobar el corte rápido en su lugar</Button>}
                  </div>
                ) : null}
                <h3 className="mt-4">Pulido pro con Claude Code (Remotion / HyperFrames)</h3>
                <p className="small muted">Para subtítulos animados, zooms, B-roll y música según la propuesta aprobada, pega esto en Claude Code:</p>
                <pre className="code copy break-all whitespace-pre-wrap" onClick={() => copy(ccText, toast)}>{ccText}</pre>
              </div>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}
