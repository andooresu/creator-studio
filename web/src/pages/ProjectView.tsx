// Vista de proyecto: cabecera (título editable, tipo, fecha, guía de marca y menú «Más»), un stepper para todo
// proyecto, banner del trabajo en segundo plano y la etapa que se está viendo (vive en la URL: #/p/<id>/<etapa>).
// Sondea el proyecto cada 2 s. Al lanzar un trabajo la vista va a la etapa que muestra su progreso; al terminar,
// solo se mueve si sigues en esa etapa (si no, aviso con «Ver»).
// Los proyectos del motor de video ("reel" y "clase") muestran un stepper de solo lectura y la sesión de producción.
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { DropdownMenu } from "radix-ui";
import { toast as sonner } from "sonner";
import { FolderOpen, MoreHorizontal, Trash2 } from "lucide-react";
import type { Project, ProjectKind, Stage } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useApp, usePoll } from "../store.tsx";
import { JobBanner, KIND_LABEL, STAGE_LABEL, STEPS, jobLabel } from "../ui.tsx";
import { Stepper, type StepItem } from "@/components/Stepper.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import type { StageProps } from "./project/contract.ts";
import { IdeaStage } from "./project/IdeaStage.tsx";
import { RecordingStage } from "./project/RecordingStage.tsx";
import { ConceptStage } from "./project/ConceptStage.tsx";
import { EditStage } from "./project/EditStage.tsx";
import { PublishStage } from "./project/PublishStage.tsx";
import { ProductionPanel } from "./project/Production.tsx";

const STAGE_VIEWS: Partial<Record<string, ComponentType<StageProps>>> = {
  idea: IdeaStage, grabacion: RecordingStage, concepto: ConceptStage, edicion: EditStage, publicacion: PublishStage,
};
/** Enlaces viejos (#/p/<id>/referencias|analisis|guion) siguen funcionando: se ven en «Idea y guion». */
const VIEW_ALIAS: Record<string, string> = { referencias: "idea", analisis: "idea", guion: "idea" };

/** Proyectos del motor de video: sesión de producción con stepper de solo lectura. */
const isMotion = (p: Project): boolean => p.kind === "reel" || p.kind === "clase";

const TALK_STEPS: StepItem[] = STEPS.map((s) => ({ id: s, label: STAGE_LABEL[s] }));
const MOTION_STEPS: StepItem[] = ["Brief", "Preguntas", "Plan", "Animación", "Vista previa", "Exportar"].map((label, i) => ({ id: `m${i}`, label }));

/**
 * Paso del motor de video deducido de la sesión de producción (heurística simple, de solo lectura):
 *  0 Brief       → aún no hay producción, o existe pero sin eventos.
 *  1 Preguntas   → hay eventos pero ninguna puerta de aprobación todavía.
 *  2 Plan        → hubo (o está pendiente) una aprobación de concepto / shotlist / música / voz, o cualquier decisión.
 *  3 Animación   → el productor escribe o edita film.js, o corre el lint del diseño.
 *  4 Vista previa→ hay un render borrador o una aprobación de tipo «borrador».
 *  5 Exportar    → hay un render final o una aprobación de tipo «final».
 *  6 (todo hecho)→ la producción terminó ("done") con renders finales.
 * Se toma el paso más avanzado que cumpla su condición.
 */
function motionStep(p: Project): number {
  const prod = p.production;
  if (!prod) return 0;
  const events = prod.events || [];
  const renders = prod.renders || [];
  const pending = prod.pending?.type === "approval" ? prod.pending.data.kind : null;
  const kindOf = (d: unknown): string | null => {
    const k = (d as { kind?: unknown } | null | undefined)?.kind;
    return typeof k === "string" ? k : null;
  };
  const gateKinds = new Set<string>();
  if (pending) gateKinds.add(pending);
  let anyDecision = false;
  for (const e of events) {
    if (e.type === "approval" || e.type === "decision") {
      const k = kindOf(e.data);
      if (k) gateKinds.add(k);
      if (e.type === "decision") anyDecision = true;
    }
  }
  const hasFinal = renders.some((r) => r.mode === "final");
  if (prod.status === "done" && hasFinal) return 6;
  if (hasFinal || gateKinds.has("final")) return 5;
  if (renders.some((r) => r.mode === "draft") || gateKinds.has("borrador")) return 4;
  if (events.some((e) => e.type === "tool" && /film\.js|lint/i.test(e.text))) return 3;
  if (anyDecision || ["concepto", "shotlist", "musica", "voz"].some((k) => gateKinds.has(k))) return 2;
  return events.length ? 1 : 0;
}

function stepIndex(s: string): number { const i = STEPS.indexOf(s as Stage); return i === -1 ? STEPS.length : i; }
/** Etapa a mostrar por defecto: la real del proyecto ("publicado" se ve en Publicación; una desconocida, en Idea). */
const defaultView = (s: Stage): string => (s === "publicado" ? "publicacion" : STAGE_VIEWS[s] ? s : "idea");
/** Etapa que muestra el progreso de un trabajo según su tipo (análisis y guion en Idea; tomas, corte y render en Edición). */
function jobView(jobStage: string): string {
  if (jobStage === "analisis" || jobStage === "guion") return "idea";
  if (jobStage === "tomas" || jobStage === "edicion" || jobStage === "render") return "edicion";
  if (jobStage === "publicar" || jobStage === "publicacion") return "publicacion";
  if (jobStage === "concepto") return "concepto";
  return "";
}
/** Lo que el sondeo compara para volver a pintar: el trabajo, el avance de la edición, el video final y el productor. */
const pollKey = (x: Project): string => JSON.stringify([x.job ?? null, x.editRun ?? null, x.finalVideo ?? null, x.production?.status ?? null, x.production?.renders?.length ?? 0, x.stage]);

/** Llama fn con el valor cuando el control dispara el evento nativo "change" (al confirmar, no en cada tecla). */
function useNativeChange<T extends HTMLInputElement | HTMLTextAreaElement>(fn: (value: string) => void) {
  const ref = useRef<T>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => fnRef.current(el.value);
    el.addEventListener("change", h);
    return () => el.removeEventListener("change", h);
  }, []);
  return ref;
}

function ProjectHeader({ p, setProject }: { p: Project; setProject: (p: Project) => void }) {
  const { state, refresh, act } = useApp();
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useNativeChange<HTMLInputElement>((title) => {
    act(() => api<Project>(`/api/projects/${p.id}`, { method: "PATCH", body: { title } })).then((x) => { setProject(x); return refresh(); }).catch(() => {});
  });
  const brands = state?.brands || [];
  const kind: ProjectKind = p.kind || "talking";
  const created = p.createdAt ? new Date(p.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "";
  const onDelete = async () => {
    setDeleting(true);
    try {
      await act(() => api(`/api/projects/${p.id}`, { method: "DELETE" }));
      setConfirmDel(false);
      await refresh();
      location.hash = "#/";
    } catch { /* el error ya se mostró como notificación */ } finally {
      setDeleting(false);
    }
  };
  const reveal = () => { void api(`/api/projects/${p.id}/reveal`, { method: "POST", body: {} }).catch(() => {}); };
  const itemCls = "flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-[13px] outline-none select-none data-[highlighted]:bg-surface-3";

  return (
    <header className="mb-5 min-w-0">
      <h1 className="sr-only">{p.title}</h1>
      <div className="flex min-w-0 items-start gap-2">
        <input
          ref={titleRef}
          aria-label="Título del proyecto"
          defaultValue={p.title}
          className="-ml-2 min-w-0 flex-1 rounded-md! border! border-transparent! bg-transparent! px-2! py-1! text-[28px]! leading-tight font-semibold tracking-[-0.04em] text-foreground transition-colors hover:border-border! hover:bg-surface-1! focus:border-blue! focus:bg-surface-1! max-[480px]:text-[22px]!"
        />
        <DropdownMenu.Root>
          {/* Trigger nativo (no <Button>): en React 18 Button no reenvía la ref que Radix necesita para anclar el menú. */}
          <DropdownMenu.Trigger ref={moreRef} aria-label="Más acciones" className={buttonVariants({ variant: "ghost", size: "icon", className: "mt-1" })}>
            <MoreHorizontal aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-[190px] rounded-lg border border-border bg-surface-2 p-1 text-foreground shadow-lift">
              <DropdownMenu.Item className={itemCls} onSelect={reveal}><FolderOpen className="size-4 text-muted-foreground" aria-hidden />Abrir carpeta</DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item className={itemCls + " text-danger"} onSelect={() => setConfirmDel(true)}><Trash2 className="size-4" aria-hidden />Eliminar proyecto</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground">
        <span>{KIND_LABEL[kind]}</span>
        {created ? <><span aria-hidden>·</span><span>Creado el {created}</span></> : null}
        {brands.length ? (
          <>
            <span aria-hidden>·</span>
            <label htmlFor="project-brand" className="sr-only">Guía de marca de este proyecto</label>
            <select
              id="project-brand"
              title="Guía de marca de este proyecto"
              className="h-7 w-auto! max-w-[220px] rounded-full! border! border-border! bg-surface-1! px-2.5! py-0! text-[13px]! text-foreground hover:bg-surface-2!"
              value={p.brandId || state?.defaultBrandId || ""}
              onChange={(e) => {
                act(() => api<Project>(`/api/projects/${p.id}`, { method: "PATCH", body: { brandId: e.target.value } }), "Guía de marca asignada")
                  .then(setProject).catch(() => {});
              }}
            >
              {brands.map((b) => <option key={b.id} value={b.id}>Marca: {b.name}</option>)}
            </select>
          </>
        ) : null}
      </div>
      <Dialog open={confirmDel} onOpenChange={(o) => { if (!deleting) setConfirmDel(o); }}>
        <DialogContent
          className="border-border bg-surface-1"
          // El menú ya se cerró al abrir el diálogo: sin esto el foco caería en <body> al cancelar.
          onCloseAutoFocus={(e) => { e.preventDefault(); moreRef.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>¿Eliminar «{p.title}»?</DialogTitle>
            <DialogDescription>Se borran los archivos generados; tus crudos originales no se tocan. No se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDel(false)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { void onDelete(); }} disabled={deleting}><Trash2 aria-hidden />{deleting ? "Eliminando…" : "Eliminar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

export function ProjectView({ id, sub }: { id: string; sub?: string }) {
  const { refresh, toast, act, navigate } = useApp();
  const [p, setP] = useState<Project | null>(null);
  // Copia siempre fresca del proyecto (el sondeo la actualiza aunque no haya que volver a pintar).
  const pRef = useRef<Project | null>(null);
  // Etapa en la que se lanzó el trabajo en curso (la que muestra su progreso). Al terminar, solo se mueve la vista
  // si sigues ahí; si te fuiste a otra etapa, sale un aviso con «Ver».
  const originRef = useRef<{ startedAt?: string; view: string; stage?: string } | null>(null);

  // Último estado con el que el sondeo de esta vista detectó transiciones (trabajo terminado, «listo»). Lo mueven solo
  // el sondeo, la carga y las acciones de esta vista: no el panel del productor embebido, que tiene su propio sondeo y,
  // si su pedido llega primero, haría que estas transiciones no se vieran nunca.
  const seenRef = useRef<Project | null>(null);

  const setProject = useCallback((x: Project) => { pRef.current = x; seenRef.current = x; setP(x); }, []);

  // La etapa que se ve vive en la URL (#/p/<id>/<etapa>): Atrás/Adelante y recargar la respetan.
  // Sin etapa en la URL se ve la etapa real del proyecto.
  const subView = sub ? VIEW_ALIAS[sub] ?? sub : undefined;
  const viewing = p ? (subView && STAGE_VIEWS[subView] ? subView : defaultView(p.stage)) : "";
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;
  const subRef = useRef(sub);
  subRef.current = sub;

  /** Cambia la etapa que se ve navegando el hash (pasa por el guardia de cambios sin guardar). */
  const goView = useCallback((s: string) => {
    if (s === viewingRef.current && subRef.current) return;
    navigate(`#/p/${id}/${s}`);
  }, [id, navigate]);

  // Carga al entrar al proyecto (cambiar de etapa no vuelve a cargar: solo cambia la URL).
  useEffect(() => {
    let alive = true;
    api<Project>(`/api/projects/${id}`).catch(() => null).then((x) => {
      if (!alive) return;
      if (!x) { location.hash = "#/"; return; }
      setProject(x);
    });
    return () => { alive = false; };
  }, [id, setProject]);

  /** Si la respuesta de una acción trae un trabajo recién lanzado, lleva la vista a la etapa que muestra su progreso. */
  const followJobStart = useCallback((prev: Project | null, np: Project) => {
    const j = np.job;
    if (j?.status !== "running") return;
    if (prev?.job?.status === "running" && prev.job.startedAt === j.startedAt) return;
    const view = jobView(j.stage);
    originRef.current = { startedAt: j.startedAt, view: view || viewingRef.current, stage: np.stage };
    if (view) goView(view);
  }, [goView]);

  usePoll(async () => {
    if (!pRef.current) return;
    const prev = pRef.current;
    const np = await api<Project>(`/api/projects/${prev.id}`).catch(() => null);
    if (!np || !pRef.current) return;
    const seen = seenRef.current || pRef.current;
    const wasRunning = seen.job?.status === "running";
    const prevJob = seen.job;
    const jobChanged = JSON.stringify(np.job) !== JSON.stringify(seen.job);
    const changed = jobChanged || pollKey(np) !== pollKey(seen) || pollKey(np) !== pollKey(pRef.current);
    const wasReady = seen.editRun?.state === "listo";
    pRef.current = np;
    seenRef.current = np;
    if (changed && !jobChanged && !wasReady && np.editRun?.state === "listo") {
      if (viewingRef.current !== "edicion") sonner.success("Tu video está listo", { action: { label: "Ver", onClick: () => navigate(`#/p/${np.id}/edicion`) }, duration: 8000 });
      else toast("Tu video está listo ✓");
    }
    if (changed) {
      if (wasRunning && np.job?.status === "done") {
        const origin = originRef.current;
        originRef.current = null;
        const cur = viewingRef.current;
        const startedView = origin?.view ?? (jobView(prevJob?.stage || "") || cur);
        const dest = defaultView(np.stage);
        // el trabajo de corte terminó pero la plantilla recién empieza: todavía no está listo
        const er = np.editRun;
        const doneMsg = prevJob?.stage === "edicion" && er && !er.quick && er.state !== "listo" && er.state !== "error" ? "Corte listo: aplicando la plantilla…" : "Listo ✓";
        // solo se sigue a la etapa real si el trabajo la movió (p. ej. en un proyecto aprobado, elegir tomas o exportar
        // desde Edición no cambia la etapa «publicacion»: te quedas en Edición)
        const stageMoved = (origin?.stage ?? seen.stage) !== np.stage;
        if (cur === dest) toast(doneMsg);
        else if (cur === startedView && !stageMoved) toast(doneMsg);
        else if (cur === startedView) { navigate(`#/p/${np.id}/${dest}`); toast(doneMsg); }
        else {
          // te quedas donde estás (fija la etapa en la URL para que la vista no siga a la etapa real)
          if (!subRef.current) navigate(`#/p/${np.id}/${cur}`);
          const what = STAGE_LABEL[dest as Stage] || dest;
          sonner.success(`Listo: ${what}`, { action: { label: "Ver", onClick: () => navigate(`#/p/${np.id}/${dest}`) }, duration: 8000 });
        }
        refresh().catch(() => {});
      }
      if (wasRunning && np.job?.status === "error") { originRef.current = null; refresh().catch(() => {}); }
      setP(np);
    }
  }, 2000, p !== null && !isMotion(p), id ? [`projects:${id}`, `step:projects:${id}`] : undefined);

  const run = useCallback(async (path: string, body?: unknown, okMsg?: string): Promise<Project | undefined> => {
    const cur = pRef.current;
    if (!cur) return undefined;
    const np = await act(() => api<Project>(`/api/projects/${cur.id}/${path}`, { method: "POST", body: body || {} }), okMsg);
    setProject(np);
    followJobStart(cur, np);
    refresh().catch(() => {});
    return np;
  }, [act, refresh, setProject, followJobStart]);

  // Las etapas que reemplazan el proyecto (p. ej. al subir la grabación) también siguen al trabajo que el servidor lance.
  const setProjectFromStage = useCallback((x: Project) => {
    const prev = pRef.current;
    pRef.current = x; // seenRef no: las transiciones las sigue detectando el sondeo de esta vista
    setP(x);
    followJobStart(prev, x);
  }, [followJobStart]);

  const goStage = useCallback((s: Stage) => goView(defaultView(s)), [goView]);

  if (!p) return null;
  if (isMotion(p)) {
    return (
      <>
        <ProjectHeader key={p.id + "\u0000" + p.title} p={p} setProject={setProject} />
        <Stepper steps={MOTION_STEPS} current={motionStep(p)} label="Progreso de la producción" />
        <ProductionPanel p={p} setProject={setProject} />
      </>
    );
  }
  const cur = stepIndex(p.stage);
  // Hecho = etapa anterior a la real («Idea y guion» también cuando el guion ya está aprobado).
  const isDone = (s: StepItem, i: number): boolean => i < cur || (s.id === "idea" && !!p.scriptApproved);
  const job = p.job;
  const running = job?.status === "running";
  const View = STAGE_VIEWS[viewing] || IdeaStage;

  return (
    <>
      <ProjectHeader key={p.id + "\u0000" + p.title} p={p} setProject={setProject} />
      <Stepper steps={TALK_STEPS} current={cur} viewing={viewing} onSelect={goView} isDone={isDone} />
      <JobBanner job={job} label={job ? jobLabel(job.stage) : undefined} onClose={() => setProject({ ...p, job: null })} />
      <div id="stage">
        <View p={p} running={running} run={run} setProject={setProjectFromStage} goStage={goStage} />
      </div>
    </>
  );
}
