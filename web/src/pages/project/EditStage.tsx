// 6. Edición: (1) elegir tomas con IA y ajustarlas  (2) renderizar  (3) resultado y aprobación.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Clapperboard, Download, FolderOpen, RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { VideoPlayer } from "@/components/VideoPlayer.tsx";
import { cn } from "@/lib/utils.ts";
import { FORMATS } from "../../../../shared/types.ts";
import type { Format, Project, Tools } from "../../../../shared/types.ts";
import { api } from "../../api.ts";
import { useApp } from "../../store.tsx";
import { copy, fmtT, Tag } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";
import { ProductionPanel } from "./Production.tsx";

const FMT_LABEL: Record<Format, string> = { "9x16": "9:16", "4x5": "4:5", "1x1": "1:1", "16x9": "16:9" };
const CHECK = { width: 16, height: 16, padding: 0, margin: 0, accentColor: "var(--blue)", flex: "none" } as const;
const CHECK_LABEL = "m-0! inline-flex! cursor-pointer items-center gap-2 text-[13px]! font-normal! text-foreground!";

export function EditStage({ p, running, run, setProject, goStage }: StageProps) {
  const { state, toast, act } = useApp();
  const e = p.edit;
  const t: Partial<Tools> = state?.tools ?? {};
  const plan = p.editPlan;
  const hasWhisper = !!(t.whisperCpp || t.whisperPy);
  const keptDur = plan ? plan.segments.filter((x) => x.keep).reduce((a, x) => a + (x.e - x.s), 0) : 0;

  // Selección local de tomas (se reinicia cuando llega un plan distinto).
  const initKeep = () => new Set((plan?.segments || []).filter((x) => x.keep).map((x) => x.id));
  const [keep, setKeep] = useState<Set<number>>(initKeep);
  const [dirty, setDirty] = useState(false);
  // Confirmaciones en línea (sin window.confirm): reemplazar la selección o descartarla.
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
  const onRender = async () => {
    try {
      if (plan && dirty) await savePlan();
      await run("edit");
    } catch { /* el error ya se mostró como notificación */ }
  };
  const onApprove = async () => {
    try {
      await run("approve/edit", undefined, "Edición aprobada ✓");
      goStage("publicacion");
    } catch { /* el error ya se mostró como notificación */ }
  };
  const reveal = () => { api(`/api/projects/${p.id}/reveal`, { method: "POST", body: { sub: "edit" } }).catch(() => {}); };

  // Render con estilo (motor de video): estilos aptos para talking head.
  const talkStyles = (state?.styles || []).filter((x) => x.kind === "talking" || x.kind === "any");
  const [styleId, setStyleId] = useState<string>(p.styleId || "");
  useEffect(() => { if (p.styleId) setStyleId(p.styleId); }, [p.styleId]);
  const chosenStyle = styleId || talkStyles[0]?.id || "";
  const prodBusy = p.production?.status === "running" || p.production?.status === "waiting";
  const motionReady = state?.motion?.ready ?? false;
  // Opciones de inicio: van al productor como respuestas ya dadas (no las vuelve a preguntar).
  // misma resolución que el servidor (getBrand): la del proyecto, si no la predeterminada, si no la primera
  const brands = state?.brands || [];
  const brand = brands.find((b) => b.id === p.brandId) || brands.find((b) => b.id === state?.defaultBrandId) || brands[0] || null;
  const hasBrand = !!brand && !state?.brandIsPlaceholder;
  // si ya hubo una producción, se parte de las opciones que el usuario eligió entonces
  const saved = (p.production as { flags?: { useBrand?: boolean; music?: boolean; formats?: Format[] } } | null | undefined)?.flags;
  const [useBrand, setUseBrand] = useState(saved?.useBrand ?? hasBrand);
  useEffect(() => { setUseBrand(saved?.useBrand ?? hasBrand); }, [hasBrand, saved?.useBrand]);
  const [music, setMusic] = useState(saved?.music ?? true);
  const [formats, setFormats] = useState<Format[]>(saved?.formats?.length ? saved.formats : ["9x16"]);
  useEffect(() => {
    if (saved?.music !== undefined) setMusic(saved.music);
    if (saved?.formats?.length) setFormats(saved.formats);
  }, [saved?.music, saved?.formats?.join(",")]);
  const toggleFmt = (f: Format, on: boolean) => {
    setFormats((prev) => {
      const next = on ? [...prev, f] : prev.filter((x) => x !== f);
      return next.length ? FORMATS.filter((x) => next.includes(x)) : prev; // al menos un formato
    });
  };
  const onStyledRender = async () => {
    if (!chosenStyle) { toast("Elige un estilo", true); return; }
    const styleName = talkStyles.find((x) => x.id === chosenStyle)?.name || "el estilo elegido";
    const restyle = !!p.production && p.styleId !== chosenStyle;
    try {
      if (p.styleId !== chosenStyle) {
        const np = await act(() => api<Project>(`/api/projects/${p.id}`, { method: "PATCH", body: { styleId: chosenStyle } }));
        setProject(np);
      }
      // El servidor detecta el cambio de estilo al iniciar: copia la nueva guía y le pide al productor rehacer el diseño.
      const okMsg = restyle
        ? `Estilo cambiado a «${styleName}»: el productor rehará el diseño con la nueva guía ✓`
        : p.production ? "Producción reanudada ✓" : "Producción iniciada ✓";
      await run("production/start", { mode: "talking", styleId: chosenStyle, flags: { ...(hasBrand ? { useBrand } : {}), music, formats } }, okMsg);
    } catch { /* el error ya se mostró como notificación */ }
  };

  const ccText = e ? `Lee ${e.briefPath} y produce la versión final del reel siguiendo el brief.` : "";

  return (
    <div className="grid2 min-[901px]:grid-cols-[340px_minmax(0,1fr)]!">
      <div className="stack">
        {e?.final ? <div className="w-full max-w-[320px]"><h3>Resultado</h3><VideoPlayer key={e.at} src={`/media/${p.id}/${e.final}?v=${encodeURIComponent(e.at)}`} aspect="9 / 16" label="Resultado de la edición" /></div> : null}
        {plan ? <div><h3>Grabación original</h3><video ref={origVid} key={p.recording?.at} className="video-9x16" src={`/api/projects/${p.id}/recording/video`} controls preload="metadata" /><p className="small muted">Clic en el tiempo de una frase para escucharla.</p></div> : null}
        {!e && !plan ? <div className="card"><p className="muted">Aún no hay edición. Elige las tomas con IA o renderiza directamente; el resultado aparecerá aquí.</p></div> : null}
      </div>
      <div className="stack">
        <div className="card"><h2>1 · Elegir tomas</h2>
          <p className="muted small">La IA lee la transcripción palabra por palabra, detecta frases repetidas, arranques en falso y muletillas, y se queda con la mejor toma de cada frase. Tú revisas y ajustas antes de cortar.</p>
          {hasWhisper ? null : <p className="small"><Tag tone="r">Requiere whisper</Tag></p>}
          {asking === "replan" ? (
            <ConfirmInline question="¿Reemplazar tu selección actual por una nueva de la IA?" yes="Sí, reemplazar" onYes={doPlan} onNo={() => setAsking(null)} />
          ) : asking === "drop" ? (
            <ConfirmInline question="¿Descartar la selección y cortar solo por silencios?" yes="Sí, descartar" onYes={() => void onDropPlan()} onNo={() => setAsking(null)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant={plan ? "secondary" : "default"} disabled={running || !p.conceptApproved || !hasWhisper} onClick={onPlan}>
                {plan ? <><RotateCcw aria-hidden />Volver a elegir con IA</> : <><Wand2 aria-hidden />Elegir tomas con IA</>}
              </Button>
              {plan ? <Button variant="ghost" onClick={() => setAsking("drop")}>Usar solo corte de silencios</Button> : null}
            </div>
          )}
          {!p.conceptApproved ? <p className="small muted" style={{ marginTop: 6 }}>Aprueba la propuesta visual primero.</p> : null}
          {plan ? (
            <>
              <p style={{ marginTop: 12 }}><b>{plan.segments.filter((x) => x.keep).length}</b> de {plan.segments.length} frases · <b>~{Math.round(keptDur)}s</b> de voz · <span className="muted">{plan.resumen}</span></p>
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
              <div className="mt-2.5 flex flex-wrap items-center gap-2"><Button variant="secondary" onClick={() => void onSavePlan()}>Guardar selección</Button><span className="small muted" aria-live="polite">{dirty ? "Cambios sin guardar" : ""}</span></div>
            </>
          ) : null}
        </div>
        <div className="card"><h2>2 · Renderizar</h2>
          <p className="muted small">{plan ? "Corta exactamente las frases marcadas" : "Sin selección de tomas: corta silencios y pausas"}, reencuadra a 9:16 1080×1920, normaliza el audio a -14 LUFS y genera subtítulos palabra a palabra{plan ? " (reutiliza la transcripción, sin volver a transcribir)" : ""}.</p>
          <p className="small">{hasWhisper ? <Tag tone="g">Whisper listo</Tag> : <Tag tone="r">Sin whisper: no habrá subtítulos</Tag>} {t.subtitlesFilter ? <Tag tone="g">Subtítulos quemados</Tag> : <Tag tone="y">ffmpeg sin libass: subtítulos como .srt</Tag>}</p>
          <Button variant={plan && !e ? "default" : "secondary"} disabled={running || !p.conceptApproved} onClick={() => void onRender()}>{e ? "Volver a renderizar" : "Renderizar"}</Button>
        </div>
        <div className="card"><h2>Render con estilo (motor de video)</h2>
          <p className="muted small">Un agente toma tu grabación ya cortada y la produce con un estilo de tu biblioteca: subtítulos animados, títulos, gráficos, música y efectos, siguiendo la guía del estilo. Te pedirá aprobación en cada paso importante y entrega el render en los formatos que elijas. Tiene costo: consume créditos de tu API de Anthropic (y de ElevenLabs si genera música o voz).</p>
          {!motionReady ? <p className="small"><Tag tone="y">Entorno del motor incompleto</Tag> <a href="#/ajustes" className="small">Ver en Ajustes</a></p> : null}
          {talkStyles.length ? (
            <>
              <label htmlFor="edit-style">Estilo</label>
              <select id="edit-style" value={chosenStyle} disabled={prodBusy} onChange={(ev) => setStyleId(ev.target.value)}>
                {talkStyles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kind === "any" ? " (cualquier tipo)" : ""}</option>)}
              </select>
              {(() => { const d = talkStyles.find((x) => x.id === chosenStyle)?.description; return d ? <p className="small muted" style={{ marginTop: 4 }}>{d}</p> : null; })()}
            </>
          ) : <p className="small muted">No hay estilos para videos a cámara. <a href="#/estilos">Crea uno en Estilos</a>.</p>}
          <fieldset className="mt-3 flex flex-col gap-2 border-0 p-0" disabled={prodBusy}>
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
          </fieldset>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="max-w-full whitespace-normal" disabled={running || prodBusy || !chosenStyle || !p.recording} onClick={() => void onStyledRender()}>
              {p.production ? <><RotateCcw aria-hidden />Producir de nuevo con este estilo</> : <><Clapperboard aria-hidden />Producir con estilo</>}
            </Button>
            <Button variant="ghost" size="sm" asChild><a href={chosenStyle ? `#/estilos/${chosenStyle}` : "#/estilos"}>Ver estilo</a></Button>
          </div>
          {!p.recording ? <p className="small muted" style={{ marginTop: 6 }}>Necesitas una grabación primero.</p> : null}
          {p.production ? <div style={{ marginTop: 14 }}><ProductionPanel p={p} setProject={setProject} /></div> : null}
        </div>
        {e ? (
          <>
            <div className="card"><h3>Resultado</h3>
              <div className="grid3">
                <div><div className="big-num">{e.originalDuration.toFixed(0)}s → {e.finalDuration.toFixed(0)}s</div><span className="small muted">duración</span></div>
                <div><div className="big-num">{e.segments}</div><span className="small muted">tramos · {e.mode === "tomas" ? "por tomas" : "por silencios"}</span></div>
                <div><div className="big-num">{e.burned ? "Sí" : e.srtPath ? ".srt" : "No"}</div><span className="small muted">subtítulos</span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {e.final ? <Button variant="secondary" asChild><a href={`/media/${p.id}/${e.final}`} download><Download aria-hidden />Descargar MP4</a></Button> : null}
                {e.srtPath ? <Button variant="secondary" asChild><a href={`/media/${p.id}/${e.srtPath}`} download><Download aria-hidden />Subtítulos .srt</a></Button> : null}
                <Button variant="ghost" onClick={reveal}><FolderOpen aria-hidden />Abrir carpeta</Button>
              </div>
            </div>
            <div className="card"><h3>Pulido pro con Claude Code (Remotion / HyperFrames)</h3>
              <p className="small muted">Para subtítulos animados, zooms, B-roll y música según la propuesta aprobada, pega esto en Claude Code:</p>
              <pre className="code copy" onClick={() => copy(ccText, toast)}>{ccText}</pre>
            </div>
            <div className="card"><h3>Aprobación</h3><Button disabled={running} onClick={() => void onApprove()}><Check aria-hidden />Aprobar edición</Button></div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Confirmación en línea: «¿Seguro? Sí / No» sin diálogos del navegador. */
function ConfirmInline({ question, yes, onYes, onNo }: { question: string; yes: string; onYes: () => void; onNo: () => void }) {
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px]">
      <span className="mr-1">{question}</span>
      <Button size="sm" variant="secondary" onClick={onYes}>{yes}</Button>
      <Button size="sm" variant="ghost" autoFocus onClick={onNo}>No</Button>
    </div>
  );
}
