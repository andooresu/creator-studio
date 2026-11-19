// Opciones del camino de edición por defecto (Propuesta visual → Edición): plantilla, «Solo corte rápido»,
// estimación de costo y tope. Las usan ConceptStage (al aprobar) y EditStage («Editar video»).
// Produce el EditRunRequest que reciben approve/concept {edit} y edit/auto.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils.ts";
import type { EditRunRequest, Project, StyleSummary } from "../../../../shared/types.ts";
import { useApp } from "../../store.tsx";
import { CapField, EstimateLine, capInvalid, parseCap, useCapValue, useEstimate } from "./Estimate.tsx";

const CHECK = { width: 16, height: 16, padding: 0, margin: 0, accentColor: "var(--blue)", flex: "none" } as const;

export interface EditRunOpts {
  talkStyles: StyleSummary[];
  styleId: string;
  setStyleId: (v: string) => void;
  styleName: string;
  quick: boolean;
  setQuick: (v: boolean) => void;
  /** por qué no se puede producir con plantilla ahora (sin clave, motor incompleto, sin plantillas); "" si se puede */
  blocker: string;
  cap: string;
  setCap: (v: string) => void;
  est: ReturnType<typeof useEstimate>;
  hasBrand: boolean;
  /** true si el tope escrito no es válido (hay que corregirlo antes de seguir) */
  invalid: boolean;
  /** el cuerpo para approve/concept {edit} o edit/auto */
  request: () => EditRunRequest;
}

export function useEditRunOptions(p: Project): EditRunOpts {
  const { state } = useApp();
  const talkStyles = (state?.styles || []).filter((x) => x.kind === "talking" || x.kind === "any");
  const initial = (p.editRun?.styleId && talkStyles.some((x) => x.id === p.editRun?.styleId) ? p.editRun.styleId : null)
    || (p.styleId && talkStyles.some((x) => x.id === p.styleId) ? p.styleId : null)
    || talkStyles[0]?.id || "";
  const [picked, setStyleId] = useState("");
  // la lista de estilos llega con el estado global (puede cargar después de montar): se usa la elegida o la inicial
  const styleId = picked && talkStyles.some((x) => x.id === picked) ? picked : initial;
  const styleName = talkStyles.find((x) => x.id === styleId)?.name || "";

  // el productor de la plantilla usa la clave de Anthropic aunque el proveedor de IA elegido sea otro
  const keySet = !!(state?.usage?.anthropicKeySet ?? state?.usage?.keySet);
  const motionReady = state?.motion?.ready ?? false;
  const blocker = !talkStyles.length ? "No hay plantillas para videos a cámara (créalas en Estilos)."
    : !keySet ? "Falta la clave de Anthropic: la plantilla la produce un agente que usa tu clave de Claude. Agrégala en Ajustes."
    : !motionReady ? "El motor de video no está listo en este equipo (revisa Ajustes)."
    : "";
  // sin clave o sin motor, por defecto solo el corte rápido (se puede desmarcar: el servidor avisa si falta algo)
  const [quickPicked, setQuick] = useState<boolean | null>(null);
  // con algo que impide la plantilla, por defecto corte rápido aunque la corrida anterior (fallida) pidiera plantilla:
  // así «Reintentar» no repite el mismo error
  const quick = quickPicked ?? (blocker ? true : p.editRun ? p.editRun.quick : false);
  useEffect(() => { setQuick(null); setStyleId(""); }, [p.id]);

  const est = useEstimate(p.id, "talking");
  const [cap, setCap] = useCapValue(est, p.editRun?.capUsd ?? p.production?.capUsd);

  // misma resolución de marca que el servidor (getBrand): la del proyecto, si no la predeterminada, si no la primera
  const brands = state?.brands || [];
  const brand = brands.find((b) => b.id === p.brandId) || brands.find((b) => b.id === state?.defaultBrandId) || brands[0] || null;
  const hasBrand = !!brand && !state?.brandIsPlaceholder;

  const request = (): EditRunRequest => ({
    quick,
    styleId: styleId || null,
    flags: { ...(hasBrand ? { useBrand: true } : {}), music: true, formats: ["9x16"] },
    ...(quick ? {} : { capUsd: parseCap(cap) }),
  });
  return { talkStyles, styleId, setStyleId, styleName, quick, setQuick, blocker, cap, setCap, est, hasBrand, invalid: !quick && capInvalid(cap), request };
}

/** Texto «Al aprobar / Al editar: …» con lo que va a pasar. */
export function editRunSummary(o: EditRunOpts, lead = "Al aprobar"): string {
  if (o.quick || !o.styleName) return `${lead}: elegimos las mejores tomas y cortamos el video, con subtítulos. Corte rápido: gratis, sin plantilla.`;
  return `${lead}: elegimos las mejores tomas, cortamos y producimos el video con la plantilla «${o.styleName}».`;
}

/** Controles: plantilla, corte rápido, estimación y tope. */
export function EditRunOptions({ o, idPrefix, disabled, className }: { o: EditRunOpts; idPrefix: string; disabled?: boolean; className?: string }) {
  return (
    <fieldset className={cn("m-0 grid min-w-0 gap-3 border-0 p-0", className)} disabled={disabled}>
      <legend className="sr-only">Opciones de edición</legend>
      {o.talkStyles.length ? (
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${idPrefix}-style`} className="m-0! text-[13px]! font-medium! text-foreground!">Plantilla</label>
          <select id={`${idPrefix}-style`} className="max-w-full" value={o.styleId} disabled={disabled || o.quick} onChange={(e) => o.setStyleId(e.target.value)}>
            {o.talkStyles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kind === "any" ? " (cualquier tipo)" : ""}</option>)}
          </select>
        </div>
      ) : null}
      <label className="m-0! inline-flex! cursor-pointer items-start gap-2 text-[13px]! font-normal! text-foreground!">
        <input type="checkbox" checked={o.quick} onChange={(e) => o.setQuick(e.target.checked)} style={{ ...CHECK, marginTop: 2 }} />
        <span>Solo corte rápido (gratis, sin plantilla)</span>
      </label>
      {o.blocker ? <p className="small muted m-0">{o.blocker} {o.talkStyles.length ? <a href="#/ajustes">Ir a Ajustes</a> : <a href="#/estilos">Ir a Estilos</a>}</p> : null}
      {!o.quick ? (
        <div className="grid min-w-0 gap-2.5 rounded-md bg-surface-2 p-3">
          <EstimateLine est={o.est} />
          <CapField id={`${idPrefix}-cap`} value={o.cap} onChange={o.setCap} disabled={disabled} defaultCap={o.est?.capUsd} />
        </div>
      ) : null}
    </fieldset>
  );
}
