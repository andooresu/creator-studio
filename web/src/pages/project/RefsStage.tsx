// 1. Referencias: links o videos a emular, nota de qué tomar, objetivo del reel y botón de análisis.
import { useEffect, useRef, type ChangeEvent, type FormEvent } from "react";
import { ArrowRight, Link2, Paperclip, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { Project } from "../../../../shared/types.ts";
import { api } from "../../api.ts";
import { useApp } from "../../store.tsx";
import type { StageProps } from "./contract.ts";

export function RefsStage({ p, running, run, setProject }: StageProps) {
  const { refresh, toast, act } = useApp();
  const formRef = useRef<HTMLFormElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // El objetivo se guarda con el evento nativo "change" (al salir del campo), como en la versión original.
  const pid = p.id;
  const setRef = useRef(setProject);
  setRef.current = setProject;
  useEffect(() => {
    const el = goalRef.current;
    if (!el) return;
    const h = () => { void api<Project>(`/api/projects/${pid}`, { method: "PATCH", body: { goal: el.value } }).then((x) => setRef.current(x)); };
    el.addEventListener("change", h);
    return () => el.removeEventListener("change", h);
  }, [pid]);

  const delRef = async (rid: string) => {
    setProject(await api<Project>(`/api/projects/${p.id}/references/${rid}`, { method: "DELETE" }));
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/references`, { method: "POST", body: { url: f.get("url"), note: f.get("note") } }));
      form.reset();
      setProject(np);
      refresh().catch(() => {});
    } catch { /* ya notificado */ }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const note = formRef.current?.elements.namedItem("note");
    fd.append("note", note instanceof HTMLInputElement ? note.value : "");
    toast("Subiendo…");
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/references/upload`, { method: "POST", body: fd }), "Video subido");
      formRef.current?.reset();
      setProject(np);
    } catch { /* ya notificado */ } finally {
      input.value = "";
    }
  };

  const onAnalyze = async () => {
    await api(`/api/projects/${p.id}`, { method: "PATCH", body: { goal: goalRef.current?.value ?? "" } });
    run("analyze").catch(() => {});
  };

  return (
    <div className="grid2">
      <div className="card">
        <h2>Referencias</h2>
        <p className="muted small">Links de contenido a copiar, emular o inspirarte. También puedes subir el video si el link no descarga.</p>
        <div className="stack">
          {p.references.length ? p.references.map((r) => (
            <div key={r.id} className="card" style={{ padding: 12, background: "var(--panel-2)" }}>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 truncate">
                  {r.url
                    ? <a href={r.url} target="_blank" rel="noopener" className="text-blue hover:underline">{r.url}</a>
                    : <span className="inline-flex items-center gap-1.5"><Paperclip className="size-3.5 text-muted-foreground" aria-hidden />{r.name || "nota"}</span>}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Quitar referencia ${r.url || r.name || ""}`.trim()} onClick={() => { void delRef(r.id); }}><X aria-hidden /></Button>
              </div>
              {r.note ? <p className="small muted">{r.note}</p> : null}
              {r.info?.views ? (
                <p className="small">
                  <span className="tag">{(r.info.views / 1000).toFixed(0)}k vistas</span>{" "}
                  <span className="tag">{r.info.likes ? (r.info.likes / 1000).toFixed(1) + "k likes" : ""}</span>{" "}
                  <span className="tag">{r.info.uploader || ""}</span>
                </p>
              ) : null}
            </div>
          )) : <p className="muted">Sin referencias todavía.</p>}
        </div>
      </div>
      <div className="card">
        <h2>Agregar</h2>
        <form ref={formRef} onSubmit={(e) => { void onSubmit(e); }}>
          <label htmlFor="refs-url">Link(s) — uno por línea</label>
          <textarea id="refs-url" name="url" placeholder={"https://www.instagram.com/reel/…\nhttps://www.tiktok.com/@…"} />
          <label htmlFor="refs-note">¿Qué quieres tomar de esto?</label>
          <input id="refs-note" name="note" placeholder="El hook, el ritmo de cortes, el tema, los subtítulos…" />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button type="submit" variant="secondary"><Link2 aria-hidden />Agregar link</Button>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><Upload aria-hidden />Subir video</Button>
            <input ref={fileRef} type="file" accept="video/*" hidden aria-label="Video de referencia" onChange={(e) => { void onFile(e); }} />
          </div>
        </form>
        <label htmlFor="refs-goal">Objetivo de este reel</label>
        <textarea id="refs-goal" ref={goalRef} key={p.id} defaultValue={p.goal} placeholder="Ej: replicar la estructura pero contando mi historia de cuando casi quiebro." />
        <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button disabled={running || !p.references.length} onClick={() => { void onAnalyze(); }}>
            {p.analysis ? "Volver a analizar" : "Analizar con IA"}<ArrowRight aria-hidden />
          </Button>
          <span className="small muted">Descarga, extrae fotogramas y la IA lo descompone.</span>
        </div>
        {!p.references.length ? <p className="small muted mt-1.5">Agrega al menos una referencia para analizar.</p> : null}
      </div>
    </div>
  );
}
