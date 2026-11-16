// Diálogo "Nuevo video" en 3 pasos: 1 Tipo · 2 Estilo · 3 Detalles (título, objetivo, guía de marca).
// Crea con POST /api/projects y abre el proyecto (#/p/<id>). Usa el Dialog de Radix (shadcn): atrapa el foco,
// lo devuelve al botón que lo abrió, deja inerte la página de fondo y cierra con Escape.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Check, Clapperboard, GraduationCap, Mic, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils";
import type { Project, ProjectKind, StyleSummary } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useApp } from "../store.tsx";
import { StyleThumb } from "./StylePreview.tsx";

const KINDS: { id: ProjectKind; label: string; desc: string; ideal: string; icon: LucideIcon }[] = [
  { id: "talking", label: "A cámara", desc: "Te grabas hablando. Referencias, guion, grabación, edición y publicación por etapas.", ideal: "Ideal para opiniones, consejos y marca personal.", icon: Mic },
  { id: "reel", label: "Reel animado", desc: "Video de producto o promo animado con música al ritmo, hecho por el productor.", ideal: "Ideal para lanzamientos, ofertas y anuncios.", icon: Clapperboard },
  { id: "clase", label: "Clase o explicador", desc: "Explica un tema con texto animado, voz en off y diagramas, paso a paso.", ideal: "Ideal para tutoriales y contenido educativo.", icon: GraduationCap },
];
const KIND_NAME: Record<ProjectKind, string> = { talking: "A cámara", reel: "Reel animado", clase: "Clase o explicador" };
const DEFAULT_TITLE: Record<ProjectKind, string> = { talking: "Nuevo reel", reel: "Nuevo reel comercial", clase: "Nueva clase" };
const TITLE_PLACEHOLDER: Record<ProjectKind, string> = {
  talking: "Ej.: 3 errores al empezar en redes",
  reel: "Ej.: Lanzamiento de la nueva app",
  clase: "Ej.: Cómo funciona el interés compuesto",
};
const STEP_NAMES = ["Tipo", "Estilo", "Detalles"] as const;
type Step = 1 | 2 | 3;
type Filter = "all" | "base" | "own";

const isOwn = (s: StyleSummary) => s.origin !== "base";

/** Flechas para moverse entre las opciones [role=radio] de un grupo (solo mueve el foco). */
function onRadioKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || !items.length) return;
  e.preventDefault();
  let n = i;
  if (e.key === "Home") n = 0;
  else if (e.key === "End") n = items.length - 1;
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % items.length;
  else n = (i - 1 + items.length) % items.length;
  items[n]?.focus();
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{children}</span>;
}

export function NewProjectDialog({ initialTitle, initialKind, onClose }: { initialTitle?: string; initialKind?: ProjectKind; onClose: () => void }) {
  const { state, refresh, navigate, toast, act } = useApp();
  const [step, setStep] = useState<Step>(initialKind ? 2 : 1);
  const [maxStep, setMaxStep] = useState<Step>(initialKind ? 2 : 1);
  const [kind, setKind] = useState<ProjectKind>(initialKind || "talking");
  const [title, setTitle] = useState(initialTitle || "");
  const [goal, setGoal] = useState("");
  const [brandId, setBrandId] = useState<string>(state?.defaultBrandId || state?.brands[0]?.id || "");
  const [styleId, setStyleId] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const stepRef = useRef<HTMLElement>(null);
  const mounted = useRef(false);

  // el diálogo se desmonta al cerrar, así que el foco se devuelve a mano al botón que lo abrió
  const opener = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  useEffect(() => () => {
    const el = opener.current as HTMLElement | null;
    setTimeout(() => {
      if (document.activeElement !== document.body) return;
      if (el && el.isConnected) { el.focus({ preventScroll: true }); return; }
      // Abierto desde la barra lateral en móvil: el botón desapareció con la hoja, así que el foco va al
      // botón "Abrir menú" si está visible o, si no, al contenido principal.
      const trigger = document.querySelector<HTMLElement>('button[aria-label="Abrir menú"]');
      if (trigger && trigger.getClientRects().length > 0) { trigger.focus({ preventScroll: true }); return; }
      const main = document.querySelector<HTMLElement>("main");
      if (main) {
        if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
        main.focus({ preventScroll: true });
      }
    }, 0);
  }, []);

  const styles = useMemo(() => (state?.styles || []).filter((s) => s.kind === kind || s.kind === "any"), [state?.styles, kind]);
  // Al cambiar de tipo: el talking head no necesita estilo; reel y clase arrancan con el primero compatible.
  useEffect(() => {
    setStyleId((cur) => (styles.some((s) => s.id === cur) ? cur : kind === "talking" ? "" : styles[0]?.id || ""));
  }, [kind, styles]);
  const hasBase = styles.some((s) => !isOwn(s));
  const hasOwn = styles.some(isOwn);
  const showFilter = hasBase && hasOwn;
  const shown = useMemo(
    () => (!showFilter || filter === "all" ? styles : styles.filter((s) => (filter === "own" ? isOwn(s) : !isOwn(s)))),
    [styles, filter, showFilter],
  );
  const selectedStyle = styles.find((s) => s.id === styleId) || null;
  const brands = state?.brands || [];
  const brand = brands.find((b) => b.id === brandId) || null;

  /** Primer control del paso visible: la opción marcada si la hay; si no, el primer elemento enfocable. */
  const focusFirst = () => {
    const root = stepRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      || root.querySelector<HTMLElement>('button:not([disabled]), input, textarea, select, [tabindex="0"]');
    el?.focus({ preventScroll: true });
  };
  // al cambiar de paso, el foco va al primer control del paso nuevo (al abrir lo hace onOpenAutoFocus)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    focusFirst();
  }, [step]);

  const goTo = (s: Step) => {
    setStep(s);
    setMaxStep((m) => (s > m ? s : m));
  };
  const pickKind = (k: ProjectKind) => {
    if (k !== kind) setFilter("all");
    setKind(k);
    goTo(2);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step !== 3) { goTo((step + 1) as Step); return; }
    if (busy) return;
    const t = title.trim() || DEFAULT_TITLE[kind];
    setBusy(true);
    try {
      const p = await act(() => api<Project>("/api/projects", {
        method: "POST",
        body: { title: t, goal: goal.trim(), brandId: brandId || null, kind, styleId: styleId || null },
      }));
      await refresh().catch(() => {});
      onClose();
      navigate(`#/p/${p.id}`);
      toast("Proyecto creado");
    } catch { /* el error ya se mostró como notificación */ } finally { setBusy(false); }
  };

  const motionNotReady = kind !== "talking" && state?.motion && !state.motion.ready;
  const stepHeadingId = `np-step-${step}-h`;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-xl border-0 bg-surface-1 p-0 shadow-lift sm:max-w-[820px]"
        // el foco va al primer control del paso inicial (la opción marcada o la primera)
        onOpenAutoFocus={(e) => { e.preventDefault(); focusFirst(); }}
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Cabecera: título + progreso */}
          <div className="flex flex-col gap-2 border-b border-border px-5 pt-5 pb-4 pr-12">
            <DialogTitle className="m-0 text-[19px] font-semibold tracking-[-0.03em]">Nuevo video</DialogTitle>
            <DialogDescription className="sr-only">Tres pasos: elige el tipo de video, un estilo y los detalles.</DialogDescription>
            <nav aria-label="Pasos">
              <ol className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-[13px]">
                {STEP_NAMES.map((name, i) => {
                  const n = (i + 1) as Step;
                  const current = n === step;
                  const done = n < step || (n <= maxStep && n !== step);
                  const inner = (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-[18px] place-items-center rounded-full text-[11px] font-semibold",
                          current ? "bg-foreground text-background" : done ? "bg-surface-3 text-foreground" : "bg-surface-2 text-ink-faint",
                        )}
                      >
                        {done && !current ? <Check className="size-3" strokeWidth={3} /> : n}
                      </span>
                      <span>{name}</span>
                    </>
                  );
                  return (
                    <li key={name} className="flex items-center gap-1.5">
                      {i > 0 ? <span aria-hidden className="text-ink-faint">·</span> : null}
                      {done && !current ? (
                        <button
                          type="button"
                          onClick={() => goTo(n)}
                          aria-label={`Paso ${n}: ${name} (hecho). Volver a este paso`}
                          className="inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {inner}
                        </button>
                      ) : (
                        <span
                          aria-current={current ? "step" : undefined}
                          className={cn("inline-flex items-center gap-1.5 px-1 py-0.5", current ? "font-semibold text-foreground" : "text-ink-faint")}
                        >
                          {inner}
                          <span className="sr-only">{current ? " (paso actual)" : " (pendiente)"}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>

          {/* Cuerpo: el paso actual (con scroll propio) */}
          <section ref={stepRef} aria-labelledby={stepHeadingId} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {step === 1 ? (
              <>
                <h3 id={stepHeadingId} className="m-0 mb-3 text-[15px] font-semibold tracking-[-0.02em]">¿Qué tipo de video quieres hacer?</h3>
                <div role="radiogroup" aria-labelledby={stepHeadingId} onKeyDown={onRadioKeys} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {KINDS.map((k, i) => {
                    const sel = kind === k.id;
                    const Icon = k.icon;
                    const tabbable = sel || (!KINDS.some((x) => x.id === kind) && i === 0);
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        tabIndex={tabbable ? 0 : -1}
                        key={k.id}
                        onClick={() => pickKind(k.id)}
                        className={cn(
                          "flex flex-col items-start gap-2 rounded-lg bg-surface-2 p-4 text-left outline-none transition-colors hover:bg-surface-3 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          sel && "ring-2 ring-inset ring-blue",
                        )}
                      >
                        <span aria-hidden className="grid size-10 place-items-center rounded-md bg-surface-3 text-foreground">
                          <Icon className="size-5" />
                        </span>
                        <span className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">{k.label}</span>
                        <span className="text-[13px] leading-snug text-muted-foreground">{k.desc}</span>
                        <span className="mt-auto pt-1 text-[12px] text-ink-faint">{k.ideal}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <h3 id={stepHeadingId} className="m-0 mb-3 text-[15px] font-semibold tracking-[-0.02em]">
                  Elige un estilo{kind === "talking" ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
                </h3>
                <div className="flex flex-col gap-5 sm:flex-row">
                  {/* Vista previa grande del estilo elegido */}
                  <div className="flex shrink-0 gap-4 sm:w-[220px] sm:flex-col" aria-live="polite">
                    {selectedStyle ? (
                      <>
                        <div className="w-[120px] shrink-0 sm:w-[220px]">
                          <StyleThumb
                            key={selectedStyle.id}
                            sid={selectedStyle.id}
                            preview={selectedStyle.preview}
                            palette={selectedStyle.palette}
                            autoPlay
                            label={`Vista previa de ${selectedStyle.name}`}
                            style={{ borderRadius: 15 }}
                          />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-semibold tracking-[-0.02em]">{selectedStyle.name}</span>
                            <Chip>{isOwn(selectedStyle) ? "Tuyo" : "Incluido"}</Chip>
                          </div>
                          {selectedStyle.description ? <p className="m-0 text-[13px] leading-snug text-muted-foreground">{selectedStyle.description}</p> : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid aspect-[9/16] w-[120px] shrink-0 place-items-center rounded-lg border border-dashed border-border bg-surface-2 text-ink-faint sm:w-[220px]">
                          {kind === "talking" ? <Mic className="size-8" aria-hidden /> : <Clapperboard className="size-8" aria-hidden />}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[15px] font-semibold tracking-[-0.02em]">{kind === "talking" ? "Sin estilo" : "Sin estilo elegido"}</span>
                          <p className="m-0 text-[13px] leading-snug text-muted-foreground">
                            {kind === "talking"
                              ? "Solo el flujo por etapas; puedes elegir un estilo después en Edición."
                              : "El productor trabajará con tu guía de marca y te propondrá un estilo."}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Opciones */}
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {showFilter ? (
                      <div role="group" aria-label="Filtrar estilos" className="inline-flex self-start rounded-full bg-surface-2 p-0.5">
                        {([["all", "Todos"], ["base", "Incluidos"], ["own", "Tuyos"]] as const).map(([id, label]) => (
                          <button
                            type="button"
                            key={id}
                            aria-pressed={filter === id}
                            onClick={() => setFilter(id)}
                            className={cn(
                              "rounded-full px-3 py-1 text-[13px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                              filter === id ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {styles.length || kind === "talking" ? (
                      <div
                        role="radiogroup"
                        aria-label="Estilos"
                        onKeyDown={onRadioKeys}
                        className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(96px,1fr))]"
                      >
                        {kind === "talking" ? (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!styleId}
                            tabIndex={!styleId || !shown.some((x) => x.id === styleId) ? 0 : -1}
                            onClick={() => setStyleId("")}
                            className={cn(
                              "flex flex-col gap-1.5 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                              !styleId && "bg-surface-2 ring-2 ring-inset ring-blue",
                            )}
                          >
                            <span aria-hidden className="grid aspect-[9/16] w-full place-items-center rounded-[10px] border border-dashed border-border bg-surface-2 text-ink-faint">
                              <Mic className="size-5" />
                            </span>
                            <span className="truncate text-[12px] font-medium text-foreground">Sin estilo</span>
                          </button>
                        ) : null}
                        {shown.map((s, i) => {
                          const sel = styleId === s.id;
                          // si la opción marcada no está visible (filtro), la primera visible queda enfocable con Tab
                          const tabbable = sel || (i === 0 && kind !== "talking" && !shown.some((x) => x.id === styleId));
                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={sel}
                              tabIndex={tabbable ? 0 : -1}
                              key={s.id}
                              onClick={() => setStyleId(s.id)}
                              title={s.description || undefined}
                              className={cn(
                                "flex min-w-0 flex-col gap-1.5 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                sel && "bg-surface-2 ring-2 ring-inset ring-blue",
                              )}
                            >
                              <StyleThumb sid={s.id} preview={s.preview} palette={s.palette} badge={false} label={`Vista previa de ${s.name}`} />
                              <span className="truncate text-[12px] font-medium text-foreground">{s.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {!styles.length ? (
                      <p className="m-0 text-[13px] text-muted-foreground">
                        {kind === "talking"
                          ? "Aún no hay estilos para este tipo. Puedes seguir sin estilo."
                          : "Aún no hay estilos para este tipo. Puedes continuar: el productor usará tu guía de marca y te propondrá uno."}
                      </p>
                    ) : shown.length ? (
                      <p className="m-0 text-[12px] text-ink-faint">Pasa el mouse o toca un estilo para verlo en movimiento.</p>
                    ) : (
                      <p className="m-0 text-[13px] text-muted-foreground">No hay estilos en este filtro.</p>
                    )}
                  </div>
                </div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <h3 id={stepHeadingId} className="m-0 mb-3 text-[15px] font-semibold tracking-[-0.02em]">Detalles</h3>

                <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground">
                  <span className="text-foreground">{KIND_NAME[kind]}</span>
                  <button type="button" onClick={() => goTo(1)} className="rounded text-blue outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="Cambiar el tipo de video">Cambiar</button>
                  <span aria-hidden>·</span>
                  <span>{selectedStyle ? <>estilo <span className="text-foreground">{selectedStyle.name}</span></> : "sin estilo"}</span>
                  <button type="button" onClick={() => goTo(2)} className="rounded text-blue outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="Cambiar el estilo">Cambiar</button>
                  <span aria-hidden>·</span>
                  <span>{brand ? <>marca <span className="text-foreground">{brand.name}</span></> : "sin guía de marca"}</span>
                </p>

                <label htmlFor="np-title-input">Título</label>
                <input
                  id="np-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={TITLE_PLACEHOLDER[kind]}
                  aria-describedby="np-title-hint"
                  autoComplete="off"
                />
                <p id="np-title-hint" className="m-0 mt-1 text-[12px] text-ink-faint">Si lo dejas vacío, se llamará «{DEFAULT_TITLE[kind]}».</p>

                <label htmlFor="np-goal">Objetivo</label>
                <textarea id="np-goal" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="¿Qué debe lograr este video? (vender, explicar, captar seguidores…)" />

                <label htmlFor="np-brand">Guía de marca</label>
                <select id="np-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === state?.defaultBrandId ? " (predeterminada)" : ""}</option>)}
                  {!brands.length ? <option value="">Sin guía de marca</option> : null}
                </select>

                {motionNotReady ? (
                  <p className="m-0 mt-4 flex items-start gap-2 text-[13px] text-warning">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>El motor de video aún no está listo en este equipo. Puedes crear el proyecto y revisar los requisitos dentro.</span>
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          {/* Pie: Atrás · Cancelar · acción principal */}
          <div className="flex items-center gap-2 border-t border-border px-5 py-3">
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={() => goTo((step - 1) as Step)}>Atrás</Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
              {step < 3 ? (
                // key distinta: el botón "Siguiente" nunca se convierte en el de enviar durante el mismo clic
                <Button key="next" type="button" onClick={() => goTo((step + 1) as Step)}>Siguiente</Button>
              ) : (
                <Button key="create" type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? "Creando…" : "Crear video"}</Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
