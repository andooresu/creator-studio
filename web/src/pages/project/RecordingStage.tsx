// 4. Grabación: recomendaciones, checklist (guardado por proyecto en localStorage),
// teleprompter y carga de la grabación (subida o desde la carpeta de crudos).
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowRight, ScrollText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { Project, RawFile } from "../../../../shared/types.ts";
import type { Script } from "../../../../shared/schemas.ts";
import { api, upload } from "../../api.ts";
import { useApp } from "../../store.tsx";
import { Tag } from "../../ui.tsx";
import { Prompter } from "./Prompter.tsx";
import type { StageProps } from "./contract.ts";

/** Texto para el teleprompter: el "texto" de cada sección separado por una línea en blanco. */
const scriptText = (s: Script): string => s.guion.map((g) => g.texto).join("\n\n");

type Checks = Record<string, boolean>;

function loadChecks(key: string): Checks {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    return v && typeof v === "object" ? (v as Checks) : {};
  } catch {
    return {};
  }
}

export function RecordingStage({ p, running, run, setProject, goStage }: StageProps) {
  const { state, toast, act } = useApp();
  const key = "chk-" + p.id;
  const [checks, setChecks] = useState<Checks>(() => loadChecks(key));
  const [prompter, setPrompter] = useState(false);
  const [raws, setRaws] = useState<RawFile[] | null>(null);
  const [rawSel, setRawSel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setChecks(loadChecks(key)); }, [key]);

  useEffect(() => {
    let alive = true;
    api<RawFile[]>("/api/raw-files").catch((): RawFile[] => []).then((list) => {
      if (!alive) return;
      setRaws(list);
      setRawSel(list[0]?.path ?? "");
    });
    return () => { alive = false; };
  }, [p.id]);

  const g = p.script?.grabacion;
  if (!g || !p.script) {
    return (
      <div className="card">
        <h3>Aún no hay plan de grabación</h3>
        <p className="muted">Cuando apruebes el guion, aquí verás cómo grabar, el checklist y el teleprompter.</p>
        <Button className="mt-3" onClick={() => goStage("guion")}>Ir a Guion<ArrowRight aria-hidden /></Button>
      </div>
    );
  }
  const script = p.script;

  const toggle = (i: number, checked: boolean) => {
    const next = { ...checks, [String(i)]: checked };
    setChecks(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sin almacenamiento: solo en memoria */ }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    toast("Subiendo grabación… (puede tardar con archivos grandes)");
    try {
      const np = await act(() => upload<Project>(`/api/projects/${p.id}/recording`, file), "Grabación cargada ✓");
      setProject(np);
    } catch { /* el error ya se mostró como notificación */ }
    input.value = "";
  };

  const pickRaw = async () => {
    const path = rawSel;
    if (!path) return;
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/recording`, { method: "POST", body: { path } }), "Grabación vinculada ✓");
      setProject(np);
    } catch { /* el error ya se mostró como notificación */ }
  };

  const rows: [string, string][] = [["Plano", g.plano], ["Luz", g.luz], ["Audio", g.audio], ["Energía", g.energia], ["Locación", g.locacion], ["Vestuario", g.vestuario]];

  return (
    <>
      <div className="grid2">
        <div className="stack">
          <div className="card"><h2>Recomendaciones de grabación</h2>
            {rows.map(([k, v]) => <p key={k}><b>{k}:</b> <span className="muted">{v}</span></p>)}
          </div>
          <div className="card"><h3>Tomas</h3><ul className="clean">{g.tomas.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <h3 style={{ marginTop: 12 }}>B-roll a capturar</h3><ul className="clean">{g.broll.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div className="card"><h3>Checklist antes de grabar</h3>
            {g.checklist.map((x, i) => (
              <label className="check" key={i}>
                <input type="checkbox" checked={!!checks[String(i)]} onChange={(e) => toggle(i, e.target.checked)} />{x}
              </label>
            ))}
            <Button variant="secondary" className="mt-2.5" onClick={() => setPrompter(true)}><ScrollText aria-hidden />Abrir teleprompter</Button></div>
        </div>
        <div className="stack">
          <div className="card"><h2>Cargar grabación</h2>
            {p.recording
              ? <><p><Tag tone="g">Cargado</Tag> {p.recording.name}</p><video key={p.recording.at} className="video-9x16" src={`/api/projects/${p.id}/recording/video`} controls preload="metadata" /></>
              : <p className="muted">Sube el video grabado o elígelo de tu carpeta de crudos (Ajustes).</p>}
            <div className="mt-2.5">
              <Button variant={p.recording ? "secondary" : "default"} onClick={() => fileRef.current?.click()}><Upload aria-hidden />{p.recording ? "Reemplazar video" : "Subir video"}</Button>
              <input ref={fileRef} type="file" accept="video/*" hidden aria-label="Archivo de la grabación" onChange={(e) => { void onFile(e); }} />
            </div>
            <label htmlFor="rec-raw">O elegir de tu carpeta de crudos <span className="small muted">({state?.rawDir || ""} · cámbiala en Ajustes)</span></label>
            <select id="rec-raw" value={rawSel} onChange={(e) => setRawSel(e.target.value)}>
              {raws === null
                ? <option value="">Cargando…</option>
                : raws.length
                  ? raws.map((r) => <option key={r.path} value={r.path}>{r.name} · {(r.size / 1e6).toFixed(0)} MB</option>)
                  : <option value="">(no hay videos en esa carpeta)</option>}
            </select>
            <Button variant="secondary" className="mt-2" disabled={!rawSel} onClick={() => void pickRaw()}>Usar este archivo</Button>
          </div>
          {p.recording ? (
            <div className="card"><h3>Siguiente</h3><p className="small muted">La IA revisa tu grabación y propone el concepto visual antes de editar.</p>
              <Button disabled={running} onClick={() => { run("concept").catch(() => {}); }}>Generar propuesta visual<ArrowRight aria-hidden /></Button></div>
          ) : null}
        </div>
      </div>
      {prompter ? <Prompter text={scriptText(script)} onClose={() => setPrompter(false)} /> : null}
    </>
  );
}
