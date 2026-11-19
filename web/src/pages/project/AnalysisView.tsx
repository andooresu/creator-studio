// Análisis de una referencia hecho por la IA (hook, estructura, retención, edición, adaptación).
// Se usa en «Idea y guion» (panel Análisis) y en Inspiración.
import type { Analysis } from "../../../../shared/schemas.ts";
import { List } from "../../ui.tsx";

export function AnalysisView({ a, frames = [] }: { a: Analysis; frames?: string[] }) {
  return (
    <>
      {frames.length ? (
        <div className="card"><h3>Lo que vio la IA</h3><div className="frames">{frames.map((f, i) => <img key={i} src={f} alt="" loading="lazy" />)}</div></div>
      ) : null}
      <div className="grid2" style={{ marginTop: 14 }}>
        <div className="card"><h3>Hook · {a.hook.tipo}</h3><p className="hook-quote">“{a.hook.texto}”</p><p className="muted">{a.hook.porQueFunciona}</p></div>
        <div className="card">
          <div className="row">
            <div className="grow"><h3>Por qué se viraliza</h3><p>{a.porQueSeViraliza}</p></div>
            <div style={{ textAlign: "center" }}><div className="score">{a.replicabilidad}</div><span className="small muted">replicable /10</span></div>
          </div>
          <p className="small"><span className="tag y">{a.formato}</span> <span className="tag">{a.emocion}</span></p>
        </div>
      </div>
      <div className="card"><h3>Resumen</h3><p>{a.resumen}</p></div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Estructura</h3>
          <div className="timeline">
            {a.estructura.map((b, i) => (
              <div key={i} className="beat"><div className="tm">{b.tiempo}</div><div><b>{b.beat}</b><div className="small muted">{b.descripcion}</div></div></div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card"><h3>Técnicas de retención</h3><List items={a.tecnicasRetencion} /></div>
          <div className="card">
            <h3>Edición</h3>
            {Object.entries(a.edicion).map(([k, v]) => <p key={k}><b style={{ textTransform: "capitalize" }}>{k}:</b> <span className="muted">{v}</span></p>)}
            <p><b>CTA:</b> <span className="muted">{a.cta}</span></p>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Cómo adaptarlo a tu marca</h3><p>{a.adaptacion.angulo}</p>
        <div className="grid2">
          <div><b className="small">Ideas de hook</b><List items={a.adaptacion.ideasDeHook} /></div>
          <div><b className="small">Riesgos</b><List items={a.adaptacion.riesgos} /></div>
        </div>
      </div>
    </>
  );
}
