// 3. Propuesta visual: vista previa, subtítulos con color de acento, paleta, momentos, música, portada y
// feedback / aprobación. Aprobar lanza la edición por defecto (tomas + corte + plantilla, o solo corte rápido).
import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useApp } from "../../store.tsx";
import { Tag } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";
import { EditRunOptions, editRunSummary, useEditRunOptions } from "./EditRunOptions.tsx";

const HEX = /^#[0-9a-f]{6}$/i;

/** Acento de una paleta de marca: el color más saturado que no sea casi blanco ni casi negro. */
function brandAccent(palette: string[]): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const h of palette) {
    if (!HEX.test(h)) continue;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l < 0.12 || l > 0.92) continue;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (sat > bestScore) { bestScore = sat; best = h; }
  }
  return best && bestScore >= 0.25 ? best : null;
}

export function ConceptStage({ p, running, run, goStage }: StageProps) {
  const { state, toast } = useApp();
  const [fb, setFb] = useState("");
  const c = p.concept;
  const opts = useEditRunOptions(p);
  // evita un segundo pedido (doble clic) mientras el primero no volvió. Va antes de cualquier return: los hooks se
  // llaman siempre en el mismo orden (la propuesta llega con el componente ya montado)
  const [approving, setApproving] = useState(false);

  if (!c) {
    if (running) return <div className="card" role="status" aria-live="polite"><p className="muted">La IA está diseñando la propuesta…</p></div>;
    return (
      <div className="card">
        <h3>Aún no hay propuesta visual</h3>
        {p.recording ? (
          <>
            <p className="muted">La IA revisa tu grabación y propone subtítulos, paleta, ritmo, música y portada antes de editar.</p>
            <Button className="mt-3" onClick={() => { run("concept").catch(() => {}); }}><Sparkles aria-hidden />Generar propuesta visual</Button>
          </>
        ) : (
          <>
            <p className="muted">La propuesta se hace sobre tu grabación. Primero cárgala en Grabación.</p>
            <Button className="mt-3" onClick={() => goStage("grabacion")}>Ir a Grabación<ArrowRight aria-hidden /></Button>
          </>
        )}
      </div>
    );
  }

  // Acento: el del concepto; si no es válido, el de la marca del proyecto; amarillo solo cuando no hay marca.
  const brand = state?.brandIsPlaceholder ? null : (state?.brands || []).find((b) => b.id === (p.brandId || state?.defaultBrandId)) || null;
  const acc = HEX.test(c.subtitulos.colorAcento) ? c.subtitulos.colorAcento : (brand && brandAccent(brand.palette)) || "#FFD400";

  const revise = async () => {
    const text = fb.trim();
    if (!text) return toast("Escribe qué cambiar", true);
    try {
      await run("concept", { feedback: text });
      setFb("");
    } catch { /* el error ya se mostró como notificación */ }
  };

  const approve = async () => {
    if (approving) return;
    if (opts.invalid) { toast("Corrige el tope para este video: escribe un número entre 0 y 10.000.", true); document.getElementById(`concept-${p.id}-cap`)?.focus(); return; }
    setApproving(true);
    try {
      const np = await run("approve/concept", { edit: opts.request() });
      // la aprobación vale aunque la edición no haya podido arrancar: el aviso dice cuál de las dos pasó
      if (np?.editRun?.state === "error") toast(`Propuesta aprobada, pero la edición no arrancó: ${np.editRun.error || "error desconocido"}`, true);
      else toast(opts.quick ? "Propuesta aprobada: cortando tu video ✓" : "Propuesta aprobada: editando tu video ✓");
      goStage("edicion");
    } catch { /* el error ya se mostró como notificación */ }
    finally { setApproving(false); }
  };

  return (
    <div className="grid2 min-[901px]:grid-cols-[340px_minmax(0,1fr)]!">
      <div className="stack">
        <video key={p.recording?.at} className="video-9x16" src={`/api/projects/${p.id}/recording/video`} controls preload="metadata" />
        <div className="card"><h3>Subtítulos</h3><div className="sub-preview"><b>ESTO NADIE <span style={{ color: acc }}>TE LO DICE</span></b></div>
          <p className="small" style={{ marginTop: 8 }}><b>{c.subtitulos.fuente}</b> · {c.subtitulos.estilo} · {c.subtitulos.posicion}</p><p className="small muted">{c.subtitulos.animacion}</p></div>
      </div>
      <div className="stack">
        <div className="card"><div className="row"><h2 className="grow">Propuesta visual</h2>{p.conceptApproved ? <Tag tone="g">Aprobada</Tag> : <Tag tone="y">Pendiente</Tag>}</div>
          <p>{c.resumen}</p><p className="muted">{c.estiloGeneral}</p>
          <p><b>Hook visual:</b> {c.hookVisual}</p><p><b>Ritmo:</b> <span className="muted">{c.ritmo}</span></p>
          <h3 style={{ marginTop: 12 }}>Paleta</h3>
          <div className="swatches" style={{ marginBottom: 22 }}>{c.paleta.map((h, i) => <div key={i} className="swatch" style={{ background: h }}><span>{h}</span></div>)}</div>
        </div>
        <div className="card"><h3>Momentos de edición</h3><div className="timeline">{c.momentos.map((m, i) => (
          <div className="beat" key={i}><div className="tm">{m.tiempo}</div><div><Tag tone="y">{m.tipo}</Tag> {m.descripcion}</div></div>
        ))}</div></div>
        <div className="grid2">
          <div className="card"><h3>Música</h3><p>{c.musica.estilo} · {c.musica.bpm} BPM</p><p className="small muted">{c.musica.notas}</p></div>
          <div className="card"><h3>Portada</h3><p className="hook-quote">{c.portada.texto}</p><p className="small muted">{c.portada.idea}</p></div>
        </div>
        <div className="card"><h3>Ajustar o aprobar</h3>
          <textarea aria-label="Cambios a la propuesta" value={fb} onChange={(e) => setFb(e.target.value)} placeholder="Subtítulos más pequeños, menos zooms, música más oscura…" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={running} onClick={() => void revise()}>Pedir cambios</Button>
            {p.conceptApproved ? <Button onClick={() => goStage("edicion")}>Ir a Edición<ArrowRight aria-hidden /></Button> : null}
          </div>
          {p.conceptApproved ? null : (
            <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4">
              <p className="m-0 text-[14px]">{editRunSummary(opts)}</p>
              <EditRunOptions o={opts} idPrefix={`concept-${p.id}`} disabled={running} />
              <div>
                <Button disabled={running || approving || opts.invalid} onClick={() => void approve()}><Check aria-hidden />Aprobar propuesta</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
