// 5. Propuesta visual: vista previa, subtítulos con color de acento, paleta, momentos,
// música, portada y feedback / aprobación.
import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useApp } from "../../store.tsx";
import { Tag } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";

export function ConceptStage({ p, running, run, goStage }: StageProps) {
  const { toast } = useApp();
  const [fb, setFb] = useState("");
  const c = p.concept;

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

  const acc = /^#[0-9a-f]{6}$/i.test(c.subtitulos.colorAcento) ? c.subtitulos.colorAcento : "#FFD400";

  const revise = async () => {
    const text = fb.trim();
    if (!text) return toast("Escribe qué cambiar", true);
    try {
      await run("concept", { feedback: text });
      setFb("");
    } catch { /* el error ya se mostró como notificación */ }
  };

  const approve = async () => {
    try {
      await run("approve/concept", undefined, "Propuesta aprobada ✓");
      goStage("edicion");
    } catch { /* el error ya se mostró como notificación */ }
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
            <Button disabled={running} onClick={() => void approve()}><Check aria-hidden />Aprobar propuesta</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
