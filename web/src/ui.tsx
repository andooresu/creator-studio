// Utilidades y componentes pequeños compartidos por todas las pantallas.
import type { ReactNode } from "react";
import { useElapsed, fmtElapsed } from "./hooks/use-elapsed.ts";
import type { Job, Provider, Stage, ProjectKind, ProductionStatus } from "../../shared/types.ts";

export const money = (n: number | null | undefined): string => "$" + (n || 0).toFixed((n || 0) < 1 ? 3 : 2);
export const fmtN = (n: number | null | undefined): string => {
  const v = n || 0;
  return v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "K" : String(v);
};
export const fmtT = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const STAGE_LABEL: Record<Stage | "tomas", string> = {
  tomas: "Selección de tomas", referencias: "Referencias", analisis: "Análisis", guion: "Guion", grabacion: "Grabación",
  concepto: "Propuesta visual", edicion: "Edición", publicacion: "Publicación", publicado: "Publicado",
};
/** Las 7 etapas que se muestran en el stepper del proyecto. */
export const STEPS: Stage[] = ["referencias", "analisis", "guion", "grabacion", "concepto", "edicion", "publicacion"];
export const STAGE_NAME_AI: Record<string, string> = {
  analisis: "Análisis", guion: "Guion", concepto: "Propuesta visual", publicar: "Publicación", branding: "Marca", inspiracion: "Inspiración", edicion: "Selección de tomas",
};
export const KIND_LABEL: Record<ProjectKind, string> = { talking: "A cámara", reel: "Reel", clase: "Clase" };
export const PROD_STATUS_LABEL: Record<ProductionStatus, string> = {
  idle: "Sin iniciar", running: "Trabajando", waiting: "Esperando tu respuesta", done: "Terminado", error: "Error",
};
export const PROV_LABEL: Record<Provider, string> = { anthropic: "Claude", openai: "OpenAI" };

export function Tag({ tone, children }: { tone?: "y" | "g" | "r"; children: ReactNode }) {
  return <span className={`tag${tone ? " " + tone : ""}`}>{children}</span>;
}

/** Banner de estado de un trabajo en segundo plano (oculto si terminó bien): paso actual y tiempo transcurrido. */
export function JobBanner({ job, label, onClose }: { job?: Job | null; label?: string; onClose?: () => void }) {
  const running = job?.status === "running";
  const elapsed = useElapsed(job?.startedAt, running);
  if (!job || job.status === "done") return null;
  return (
    <div className={`job${job.status === "error" ? " error" : ""}`} role={job.status === "error" ? "alert" : "status"} aria-live="polite">
      {running ? <div className="spinner" /> : "⚠️"}
      <div className="grow">{label ? <><b>{label}</b> · </> : null}{job.step}</div>
      {running && job.startedAt ? <span className="small muted" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsed)}</span> : null}
      {job.status === "error" && onClose ? <button className="btn sm" onClick={onClose}>Cerrar</button> : null}
    </div>
  );
}

export function List({ items }: { items?: string[] }) {
  return <ul className="clean">{(items || []).map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card"><p className="muted">{children}</p></div>;
}

export function copy(text: string, toast: (m: string) => void) {
  navigator.clipboard.writeText(text).then(() => toast("Copiado"));
}
