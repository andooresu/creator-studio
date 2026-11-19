// 1. Idea y guion: junta lo que antes eran Referencias, Análisis y Guion.
//  - Sin guion: links de referencia + objetivo y el botón que analiza y escribe el guion (o el aviso «Escribiendo…»).
//  - Con guion: el editor del guion como columna principal y, al lado (debajo en el teléfono), paneles plegables
//    «Referencias y objetivo» (para volver a analizar) y «Análisis».
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { Project } from "../../../../shared/types.ts";
import type { Script } from "../../../../shared/schemas.ts";
import type { StageProps } from "./contract.ts";
import { AnalysisView } from "./AnalysisView.tsx";
import { RefsEditor } from "./RefsEditor.tsx";
import { ScriptEditor } from "./ScriptEditor.tsx";

const framesOf = (p: Project): string[] => p.references.flatMap((r) => r.frameUrls || (r.frames || []).map((f) => `/media/${p.id}/${f}`));
const isDesktop = (): boolean => { try { return window.matchMedia("(min-width: 901px)").matches; } catch { return true; } };

/** Panel plegable (details/summary nativo, accesible con teclado). */
function Fold({ title, hint, open, onToggle, children }: { title: string; hint?: string; open: boolean; onToggle: (o: boolean) => void; children: ReactNode }) {
  return (
    <details className="card group" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{title}</span>
          {hint ? <span className="small muted block truncate">{hint}</span> : null}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {/* el contenido queda montado al plegar (no se pierden los links sin guardar); details lo oculta */}
      <div className="mt-3 min-w-0">{children}</div>
    </details>
  );
}

/** Análisis completo en una sola columna (cabe en el panel lateral). */
function AnalysisFold({ p, open, onToggle }: { p: Project; open: boolean; onToggle: (o: boolean) => void }) {
  if (!p.analysis) return null;
  return (
    <Fold title="Análisis" hint={`Hook: ${p.analysis.hook.tipo} · replicable ${p.analysis.replicabilidad}/10`} open={open} onToggle={onToggle}>
      <div className="min-w-0 [&_.card]:border-0 [&_.card]:bg-transparent [&_.card]:p-0 [&_.card]:pt-3 [&_.grid2]:grid-cols-[minmax(0,1fr)] [&_.row]:flex-wrap">
        <AnalysisView a={p.analysis} frames={framesOf(p)} />
      </div>
    </Fold>
  );
}

export function IdeaStage(props: StageProps) {
  const { p, running, run } = props;
  const s = p.script;
  // Clave del editor: cambia cuando el guion cambia en el servidor (reescritura de la IA), pero no con nuestro
  // propio autoguardado (si se reiniciara, perderías el foco y el cursor mientras escribes).
  const own = useRef<string | null>(null);
  const keyRef = useRef("");
  const json = s ? JSON.stringify(s) : "";
  if (json !== own.current) keyRef.current = json;
  const onSaved = useCallback((x: Script) => { own.current = JSON.stringify(x); }, []);

  // Paneles laterales: referencias abiertas en escritorio y plegadas en el teléfono; análisis siempre plegado.
  const [refsOpen, setRefsOpen] = useState(isDesktop);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  useEffect(() => { setAnalysisOpen(false); }, [p.id]);

  const writing = running && (p.job?.stage === "guion" || p.job?.stage === "analisis");

  if (!s) {
    if (writing) {
      return (
        <div className="card mx-auto w-full max-w-3xl" role="status" aria-live="polite">
          <div className="flex items-center gap-3">
            <div className="spinner" />
            <h3 className="m-0">Escribiendo tu guion…</h3>
          </div>
          <p className="muted mt-2">
            {p.job?.stage === "analisis" ? "Primero la IA analiza tus referencias y luego escribe el guion." : "La IA está escribiendo tu guion."} Tarda ~1–2 min; puedes seguir usando la app.
          </p>
          {p.job?.step ? <p className="small muted m-0">{p.job.step}</p> : null}
        </div>
      );
    }
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-3.5">
        {p.analysis ? (
          // ya hay análisis (p. ej. el guion falló o el proyecto vino de Inspiración): basta con escribir el guion
          <div className="card">
            <h3>Tus referencias ya están analizadas</h3>
            <p className="muted">Escribe el guion a partir del análisis. Tarda alrededor de un minuto.</p>
            <Button className="mt-3" disabled={running} onClick={() => { run("script").catch(() => {}); }}><Sparkles aria-hidden />Escribir guion</Button>
          </div>
        ) : null}
        <RefsEditor {...props} />
        <AnalysisFold p={p} open={analysisOpen} onToggle={setAnalysisOpen} />
      </div>
    );
  }

  const nRefs = p.references.length;
  const refsHint = [nRefs ? `${nRefs} referencia${nRefs === 1 ? "" : "s"}` : "Sin referencias", p.goal?.trim() ? "con objetivo" : "sin objetivo"].join(" · ");
  const side = (
    <div className="min-w-0">
      <Fold title="Referencias y objetivo" hint={refsHint} open={refsOpen} onToggle={setRefsOpen}>
        <RefsEditor {...props} embedded />
      </Fold>
      {p.analysis ? <div className="mt-3.5"><AnalysisFold p={p} open={analysisOpen} onToggle={setAnalysisOpen} /></div> : null}
    </div>
  );
  return <ScriptEditor key={keyRef.current} {...props} s={s} onSaved={onSaved} side={side} />;
}
