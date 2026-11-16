// 2. Análisis: descomposición de la referencia hecha por la IA y paso a guion (acción principal arriba).
// AnalysisView también se reutiliza en Inspiración.
import { useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import type { Analysis } from "../../../../shared/schemas.ts";
import { Button } from "@/components/ui/button.tsx";
import { List } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";

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

export function AnalysisStage({ p, running, run, goStage }: StageProps) {
  const [asking, setAsking] = useState(false);
  const a = p.analysis;
  if (!a) {
    if (running) return <div className="card" role="status" aria-live="polite"><p className="muted">La IA está analizando tus referencias…</p></div>;
    const n = p.references.length;
    return (
      <div className="card">
        <h3>Aún no hay análisis</h3>
        <p className="muted">El análisis descompone tus referencias: el hook, la estructura y por qué funcionan. Con eso la IA escribe tu guion.</p>
        <p className="small muted">
          {n
            ? `Tienes ${n} referencia${n === 1 ? "" : "s"}. En Referencias, pulsa «Analizar y escribir guion».`
            : "Primero agrega al menos un link o video de referencia."}
        </p>
        <Button className="mt-3" onClick={() => goStage("referencias")}>Ir a Referencias<ArrowRight aria-hidden /></Button>
      </div>
    );
  }
  const frames = p.references.flatMap((r) => r.frameUrls || (r.frames || []).map((f) => `/media/${p.id}/${f}`));
  const writeScript = () => { setAsking(false); run("script").catch(() => {}); };
  return (
    <>
      {/* Acción principal arriba: no hace falta recorrer todo el análisis para pasar al guion. */}
      <div className="card">
        {asking ? (
          <ConfirmInline question="¿Reemplazar el guion actual por uno nuevo?" yes="Sí, reemplazar" onYes={writeScript} onNo={() => setAsking(false)} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {p.script ? (
              <>
                <Button onClick={() => goStage("guion")}><FileText aria-hidden />Ver guion<ArrowRight aria-hidden /></Button>
                <Button variant="secondary" disabled={running} onClick={() => setAsking(true)}>Regenerar guion</Button>
              </>
            ) : (
              <Button disabled={running} onClick={writeScript}>Escribir guion<ArrowRight aria-hidden /></Button>
            )}
            {running ? <span className="small muted" role="status" aria-live="polite">La IA está trabajando…</span> : null}
          </div>
        )}
      </div>
      <AnalysisView a={a} frames={frames} />
    </>
  );
}
