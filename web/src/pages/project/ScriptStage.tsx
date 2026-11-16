// 3. Guion: elegir hook, editar secciones, teleprompter, pedir cambios y aprobar.
import { useRef, useState } from "react";
import { ArrowRight, Check, Copy, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { Project } from "../../../../shared/types.ts";
import type { Script } from "../../../../shared/schemas.ts";
import { api } from "../../api.ts";
import { useApp } from "../../store.tsx";
import { List } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";
import { Prompter } from "./Prompter.tsx";

function scriptText(s: Pick<Script, "guion">): string { return s.guion.map((g) => g.texto).join("\n\n"); }

export function ScriptStage(props: StageProps) {
  const s = props.p.script;
  if (!s) {
    if (props.running) return <div className="card" role="status" aria-live="polite"><p className="muted">La IA está escribiendo tu guion…</p></div>;
    const hasAnalysis = !!props.p.analysis;
    return (
      <div className="card">
        <h3>Aún no hay guion</h3>
        <p className="muted">
          {hasAnalysis
            ? "El guion sale del análisis de tus referencias. En Análisis, pulsa «Escribir guion»."
            : "Primero analiza tus referencias: el guion se escribe a partir de ese análisis."}
        </p>
        <Button className="mt-3" onClick={() => props.goStage(hasAnalysis ? "analisis" : "referencias")}>
          {hasAnalysis ? "Ir a Análisis" : "Ir a Referencias"}<ArrowRight aria-hidden />
        </Button>
      </div>
    );
  }
  // Al cambiar el guion en el servidor (guardar, reescribir) el editor se reinicia con el contenido nuevo.
  return <ScriptEditor key={JSON.stringify(s)} {...props} s={s} />;
}

function ScriptEditor({ p, running, run, setProject, goStage, s }: StageProps & { s: Script }) {
  const { toast, act } = useApp();
  const [hi, setHi] = useState(0);
  const [fb, setFb] = useState("");
  const [prompter, setPrompter] = useState<string | null>(null);
  const areas = useRef<(HTMLTextAreaElement | null)[]>([]);

  const collect = (): Pick<Script, "guion" | "hooks"> => {
    const guion = s.guion.map((g, i) => ({ ...g, texto: areas.current[i]?.value ?? g.texto }));
    const hooks = [s.hooks[hi], ...s.hooks.filter((_, i) => i !== hi)];
    return { guion, hooks };
  };

  const onSave = async () => {
    try {
      setProject(await act(() => api<Project>(`/api/projects/${p.id}/script`, { method: "PUT", body: { script: collect() } }), "Guardado"));
    } catch { /* ya notificado */ }
  };
  const onCopy = () => { void navigator.clipboard.writeText(scriptText({ ...s, ...collect() })); toast("Guion copiado"); };
  const onRevise = async () => {
    const f = fb.trim();
    if (!f) return toast("Escribe qué cambiar", true);
    try { await run("script", { feedback: f }); setFb(""); } catch { /* ya notificado */ }
  };
  const onApprove = async () => {
    await api(`/api/projects/${p.id}/script`, { method: "PUT", body: { script: collect() } });
    try { await run("approve/script", undefined, "Guion aprobado ✓"); } catch { return; }
    goStage("grabacion");
  };

  return (
    <div className="grid2 min-[901px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]!">
      <div className="card">
        <div className="row">
          <h2 className="grow">{s.titulo}</h2>
          {p.scriptApproved ? <span className="tag g">Aprobado</span> : <span className="tag y">Pendiente de aprobación</span>}
          <span className="tag">~{s.duracionSeg}s</span>
        </div>
        <h3 style={{ marginTop: 12 }}>Elige el hook</h3>
        {s.hooks.map((h, i) => (
          <label key={i} className={`hook-opt${i === hi ? " sel" : ""}`}>
            <input type="radio" name="hook" value={i} checked={i === hi} onChange={() => setHi(i)} />
            <span>{h}</span>
          </label>
        ))}
        <h3 style={{ marginTop: 16 }}>Guion (editable)</h3>
        <div id="secs">
          {s.guion.map((g, i) => (
            <div key={i} className="script-sec">
              <div><b className="small">{g.seccion}</b><div className="small muted">{g.direccion}</div></div>
              <textarea aria-label={`Texto de la sección ${g.seccion}`} ref={(el) => { areas.current[i] = el; }} defaultValue={g.texto} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { void onSave(); }}>Guardar cambios</Button>
          <Button variant="secondary" onClick={() => setPrompter(scriptText({ ...s, ...collect() }))}><ScrollText aria-hidden />Abrir teleprompter</Button>
          <Button variant="ghost" onClick={onCopy}><Copy aria-hidden />Copiar guion</Button>
        </div>
      </div>
      <div className="stack">
        <div className="card"><h3>Texto en pantalla</h3><List items={s.textoEnPantalla} /></div>
        <div className="card">
          <h3>Pedir cambios a la IA</h3>
          <textarea aria-label="Cambios para la IA" value={fb} onChange={(e) => setFb(e.target.value)} placeholder="Más agresivo el hook, cuenta la historia de mi primer negocio, quita la parte de…" />
          <button className="btn" style={{ marginTop: 8 }} disabled={running} onClick={() => { void onRevise(); }}>Reescribir con feedback</button>
          <p className="small muted" style={{ marginTop: 6 }}>{(p.scriptHistory || []).length} versión(es)</p>
        </div>
        <div className="card">
          <h3>Aprobación</h3>
          <p className="small muted">Al aprobar pasas a grabación con las recomendaciones de la IA.</p>
          <Button disabled={running} onClick={() => { void onApprove(); }}><Check aria-hidden />Aprobar guion</Button>
        </div>
      </div>
      {prompter !== null ? <Prompter text={prompter} onClose={() => setPrompter(null)} /> : null}
    </div>
  );
}
