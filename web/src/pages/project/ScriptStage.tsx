// 3. Guion: elegir hook, editar secciones (con autoguardado), teleprompter, pedir cambios y aprobar.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, ScrollText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import type { Project } from "../../../../shared/types.ts";
import type { Script } from "../../../../shared/schemas.ts";
import { api } from "../../api.ts";
import { useApp, useLeaveGuard } from "../../store.tsx";
import { List } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";
import { Prompter } from "./Prompter.tsx";

function scriptText(s: Pick<Script, "guion">): string { return s.guion.map((g) => g.texto).join("\n\n"); }
/** Lo que se edita en esta etapa (y lo que manda el PUT): secciones y hooks. */
const pickEditable = (s: Script): Pick<Script, "guion" | "hooks"> => ({ guion: s.guion, hooks: s.hooks });

export function ScriptStage(props: StageProps) {
  const s = props.p.script;
  // Clave del editor: cambia cuando el guion cambia en el servidor (reescritura de la IA), pero no con nuestro
  // propio autoguardado (si se reiniciara, perderías el foco y el cursor mientras escribes).
  const own = useRef<string | null>(null);
  const keyRef = useRef("");
  const json = s ? JSON.stringify(s) : "";
  if (json !== own.current) keyRef.current = json;
  const onSaved = useCallback((x: Script) => { own.current = JSON.stringify(x); }, []);

  if (!s) {
    const writing = props.running && (props.p.job?.stage === "guion" || props.p.job?.stage === "analisis");
    if (writing) {
      return (
        <div className="card" role="status" aria-live="polite">
          <h3>Escribiendo tu guion…</h3>
          <p className="muted">{props.p.job?.stage === "analisis" ? "Primero la IA analiza tus referencias y luego escribe el guion." : "La IA está escribiendo tu guion."} {props.p.job?.step}</p>
        </div>
      );
    }
    const hasAnalysis = !!props.p.analysis;
    if (hasAnalysis) {
      return (
        <div className="card">
          <h3>Aún no hay guion</h3>
          <p className="muted">La IA lo escribe a partir del análisis de tus referencias. Tarda alrededor de un minuto.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={props.running} onClick={() => { props.run("script").catch(() => {}); }}><Sparkles aria-hidden />Escribir guion</Button>
            <Button variant="ghost" onClick={() => props.goStage("analisis")}>Ver análisis<ArrowRight aria-hidden /></Button>
          </div>
        </div>
      );
    }
    return (
      <div className="card">
        <h3>Aún no hay guion</h3>
        {props.p.goal?.trim() ? (
          <>
            <p className="muted">Puedes escribirlo ahora con tu objetivo y tu marca, o agregar referencias para que se base en ellas.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => { void props.run("script"); }}>Escribir guion<ArrowRight aria-hidden /></Button>
              <Button variant="ghost" onClick={() => props.goStage("referencias")}>Agregar referencias</Button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Agrega una referencia o escribe el objetivo del video en Referencias, y el guion se escribe solo.</p>
            <Button className="mt-3" onClick={() => props.goStage("referencias")}>Ir a Referencias<ArrowRight aria-hidden /></Button>
          </>
        )}
      </div>
    );
  }
  return <ScriptEditor key={keyRef.current} {...props} s={s} onSaved={onSaved} />;
}

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
const AUTOSAVE_MS = 800;

function ScriptEditor({ p, running, run, setProject, goStage, s, onSaved }: StageProps & { s: Script; onSaved: (x: Script) => void }) {
  const { toast, act } = useApp();
  // hook elegido por su texto (no por índice: al guardar, el elegido pasa a ser el primero)
  const [hook, setHook] = useState(s.hooks[0] ?? "");
  const [fb, setFb] = useState("");
  const [prompter, setPrompter] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const areas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hookRef = useRef(hook);
  hookRef.current = hook;
  const sRef = useRef(s);
  sRef.current = s;
  const live = useRef(true);
  // contenido que ya está en el servidor (para no guardar ni desaprobar el guion si nada cambió)
  const savedJson = useRef(JSON.stringify(pickEditable(s)));

  const collect = useCallback((): Pick<Script, "guion" | "hooks"> => {
    const cur = sRef.current;
    const guion = cur.guion.map((g, i) => ({ ...g, texto: areas.current[i]?.value ?? g.texto }));
    const h = hookRef.current;
    const hooks = cur.hooks.includes(h) ? [h, ...cur.hooks.filter((x) => x !== h)] : cur.hooks;
    return { guion, hooks };
  }, []);

  /** PUT del guion (el mismo cuerpo que «Guardar cambios»). force: guarda aunque no haya cambios. */
  const doSave = useCallback(async (force = false, okMsg?: string): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    const script = collect();
    const j = JSON.stringify(script);
    if (!force && j === savedJson.current) { if (live.current) setSave((x) => (x === "pending" ? "idle" : x)); return; }
    if (live.current) setSave("saving");
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/script`, { method: "PUT", body: { script } }), okMsg);
      savedJson.current = j;
      if (np.script) onSaved(np.script);
      setProject(np);
      if (live.current) setSave((x) => (x === "saving" ? "saved" : x));
    } catch (e) {
      if (live.current) setSave("error");
      throw e;
    }
  }, [act, collect, onSaved, p.id, setProject]);
  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  /** Programa el autoguardado (~800 ms después de la última tecla). */
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    setSave("pending");
    timer.current = setTimeout(() => { timer.current = undefined; saveRef.current().catch(() => {}); }, AUTOSAVE_MS);
  };
  const flush = () => { if (timer.current) saveRef.current().catch(() => {}); };

  // Al salir de la etapa (o desmontar) se guarda lo pendiente; al cerrar o recargar la pestaña se manda igual
  // (keepalive) para que la petición sobreviva a la descarga de la página.
  useEffect(() => {
    live.current = true;
    const onHide = () => {
      if (!timer.current) return;
      clearTimeout(timer.current); timer.current = undefined;
      const script = collect();
      if (JSON.stringify(script) === savedJson.current) return;
      try {
        void fetch(`/api/projects/${p.id}/script`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script }) });
      } catch { /* sin red: nada más que hacer */ }
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      live.current = false;
      if (timer.current) saveRef.current().catch(() => {});
    };
  }, [collect, p.id]);

  // Si el guardado falló, salir de la pantalla pide confirmación (los cambios aún no están en el servidor).
  useLeaveGuard(save === "error", "No se pudieron guardar tus cambios del guion. Si sales, se pierden.");

  // mientras la IA reescribe el guion no se edita (lo que escribieras se perdería al llegar el nuevo)
  // análisis y guion encadenados también reescriben el guion: el editor queda de solo lectura mientras tanto
  const rewriting = running && (p.job?.stage === "guion" || p.job?.stage === "analisis");

  const onSave = async () => {
    try { await doSave(true, "Guardado"); } catch { /* ya notificado */ }
  };
  const onCopy = () => { void navigator.clipboard.writeText(scriptText({ ...s, ...collect() })); toast("Guion copiado"); };
  const onRevise = async () => {
    const f = fb.trim();
    if (!f) return toast("Escribe qué cambiar", true);
    try { await doSave(); } catch { return; }
    try { await run("script", { feedback: f }); setFb(""); } catch { /* ya notificado */ }
  };
  const onApprove = async () => {
    try { await doSave(true); } catch { return; }
    try { await run("approve/script", undefined, "Guion aprobado ✓"); } catch { return; }
    goStage("grabacion");
  };

  const saveLabel = save === "pending" || save === "saving" ? "Guardando…" : save === "saved" ? "Guardado" : save === "error" ? "No se pudo guardar" : "";

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
          <label key={i} className={`hook-opt${h === hook ? " sel" : ""}`}>
            <input type="radio" name="hook" value={i} checked={h === hook} disabled={rewriting} onChange={() => { setHook(h); hookRef.current = h; schedule(); }} />
            <span>{h}</span>
          </label>
        ))}
        <h3 style={{ marginTop: 16 }}>Guion (editable)</h3>
        <div id="secs">
          {s.guion.map((g, i) => (
            <div key={i} className="script-sec">
              <div><b className="small">{g.seccion}</b><div className="small muted">{g.direccion}</div></div>
              <textarea aria-label={`Texto de la sección ${g.seccion}`} ref={(el) => { areas.current[i] = el; }} defaultValue={g.texto} readOnly={rewriting} onInput={schedule} onBlur={flush} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={rewriting || save === "saving"} onClick={() => { void onSave(); }}>Guardar cambios</Button>
          <Button variant="secondary" onClick={() => setPrompter(scriptText({ ...s, ...collect() }))}><ScrollText aria-hidden />Abrir teleprompter</Button>
          <Button variant="ghost" onClick={onCopy}><Copy aria-hidden />Copiar guion</Button>
          <span role="status" aria-live="polite" className={cn("ml-auto self-center text-[12px]", save === "error" ? "text-danger" : "text-muted-foreground")}>
            {save === "saved" ? <Check className="mr-1 inline size-3" aria-hidden /> : null}{saveLabel}
            {save === "error" ? <button type="button" className="ml-2 underline" onClick={() => { void onSave(); }}>Reintentar</button> : null}
          </span>
        </div>
        <p className="small muted mt-1.5">Tus cambios se guardan solos mientras escribes.</p>
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
