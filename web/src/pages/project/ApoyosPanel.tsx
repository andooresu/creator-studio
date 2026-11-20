// Apoyos visuales de la propuesta (entrega 4): imágenes, B-roll animados, clips y zooms atados a lo que dice la voz.
// Por cada apoyo: generar o regenerar la ilustración (de pago, solo al tocar), subir un archivo propio, editar,
// quitar y aprobar. Mientras alguna imagen se genera, el panel vuelve a pedir el proyecto hasta que termina.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Pencil, RefreshCw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import type { Apoyo, ApoyoPatch, Project } from "../../../../shared/types.ts";
import { api, upload } from "../../api.ts";
import { useApp, usePoll } from "../../store.tsx";
import { fmtT, Tag } from "../../ui.tsx";
import { ConfirmInline } from "./ConfirmInline.tsx";
import { DATOS_POR_ANIMACION, datosProblem } from "../../../../shared/apoyoLimits.ts";

type Tipo = Apoyo["tipo"];
const TIPO_LABEL: Record<Tipo, string> = { imagen: "Imagen", broll_animado: "B-roll animado", clip: "Clip", zoom: "Zoom" };
const MODO_LABEL: Record<Apoyo["modo"], string> = { encima: "Encima del video", pantalla_completa: "Pantalla completa" };
const POS_LABEL: Record<Apoyo["posicion"], string> = { arriba: "Arriba", centro: "Centro", abajo: "Abajo" };
const ANIM_LABEL: Record<Apoyo["animacion"], string> = { palabras: "Palabras", cifra: "Cifra", pasos: "Pasos", comparacion: "Comparación", lista: "Lista", ninguna: "Ninguna" };
const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;
/** Qué lleva cada animación (mismos topes que el servidor y que INS). */
const DATOS_HINT: Partial<Record<Apoyo["animacion"], string>> = {
  palabras: `hasta ${DATOS_POR_ANIMACION.palabras}, cortos`,
  cifra: "primero la cifra (corta), luego su etiqueta",
  pasos: `hasta ${DATOS_POR_ANIMACION.pasos}, cortos`,
  lista: `hasta ${DATOS_POR_ANIMACION.lista}, cortos`,
  comparacion: "idea A, idea B y, si quieres, detalle A y detalle B; deja vacía la línea del detalle A si solo quieres el de B",
};
const IMG_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
const CLIP_ACCEPT = `${IMG_ACCEPT},video/mp4,video/quicktime,.mp4,.mov,.m4v`;

const usd = (n: number): string => `US$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;
const needsFile = (a: Apoyo): boolean => a.tipo === "imagen" || a.tipo === "clip";
/** Por qué no se puede aprobar ("" si se puede): imagen o clip sin archivo, o B-roll animado que INS no puede construir. */
const approveBlock = (a: Apoyo): string =>
  needsFile(a) && !a.archivo ? (a.tipo === "clip" ? "Sube el clip para poder aprobarlo." : "Genera o sube la imagen para poder aprobarla.")
    : a.tipo === "broll_animado" && datosProblem(a.animacion, a.datos) ? `No se puede aprobar: ${datosProblem(a.animacion, a.datos)}. Corrígelo en Editar.`
    : "";
/** Botón ocupado mientras dura un pedido: sigue enfocable (aria-disabled + clic ignorado) para que el foco no caiga a la
 *  página al deshabilitarlo; el `disabled` nativo queda solo para lo que no depende de un pedido en curso. */
const softCls = (off: boolean): string => (off ? "opacity-50 cursor-not-allowed" : "");
/** Firma de los apoyos para saber si el proyecto que llegó trae cambios en este panel. */
const sig = (p: Project): string => JSON.stringify([p.apoyos ?? [], p.apoyosCostUsd ?? 0]);

export function ApoyosPanel({ p, running, run, setProject }: {
  p: Project;
  running: boolean;
  run: (path: string, body?: unknown, okMsg?: string) => Promise<Project | undefined>;
  setProject: (p: Project) => void;
}) {
  const { state, act, toast } = useApp();
  const apoyos = [...(p.apoyos || [])].sort((a, b) => a.inicio_s - b.inicio_s);
  const approved = apoyos.filter((a) => a.aprobado).length;
  const spent = p.apoyosCostUsd || 0;
  const keySet = !!state?.usage?.openaiKeySet;
  const unit = state?.usage?.imageUnitUsd;
  const generating = apoyos.some((a) => a.estado === "generando");
  // mientras la IA propone apoyos o rehace la propuesta, la lista se va a reemplazar: no se edita (el servidor también lo frena)
  const locked = running && p.job?.stage === "concepto";
  const [proposing, setProposing] = useState(false);

  // Tras «Sí, quitar» el <li> (con el botón enfocado) desaparece: el foco pasa al apoyo siguiente, al anterior o al título.
  const headRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<{ removed: string; next: string } | null>(null);
  const onRemoved = (aid: string) => {
    const i = apoyos.findIndex((x) => x.id === aid);
    pendingFocus.current = { removed: aid, next: apoyos[i + 1]?.id ?? apoyos[i - 1]?.id ?? "" };
  };
  useEffect(() => {
    const pf = pendingFocus.current;
    if (!pf || (p.apoyos || []).some((x) => x.id === pf.removed)) return; // espera a que llegue el proyecto sin ese apoyo
    pendingFocus.current = null;
    const li = pf.next ? listRef.current?.querySelector<HTMLElement>(`li[data-apoyo-id="${CSS.escape(pf.next)}"]`) : null;
    const btn = li?.querySelector<HTMLElement>("button:not([disabled])");
    (btn || headRef.current)?.focus();
  });

  // Mientras alguna imagen se genera: se vuelve a pedir el proyecto (en vivo por SSE, o cada 2 s sin conexión)
  // y se avisa cuando cada una termina o falla.
  const pRef = useRef(p);
  pRef.current = p;
  const refresh = async () => {
    const cur = pRef.current;
    const np = await api<Project>(`/api/projects/${cur.id}`).catch(() => null);
    if (!np || np.id !== pRef.current.id || sig(np) === sig(pRef.current)) return;
    for (const a of cur.apoyos || []) {
      if (a.estado !== "generando") continue;
      const b = (np.apoyos || []).find((x) => x.id === a.id);
      if (b?.estado === "error") toast(`No se pudo generar la imagen: ${b.error || "error desconocido"}`, true);
      else if (b && b.estado !== "generando") toast("Imagen lista ✓");
    }
    setProject(np);
  };
  usePoll(refresh, 2000, generating, [`projects:${p.id}`]);
  // al volver a Propuesta (o al empezar una generación) se pide el proyecto de inmediato: el que trae la vista pudo quedar
  // viejo mientras el panel no estaba montado (la imagen pudo terminar) y el aviso en vivo o el intervalo pueden tardar
  useEffect(() => {
    if (generating) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, generating]);

  // proponer se frena mientras dura un pedido o se genera una imagen (la IA rehace la lista y la imagen quedaría sin apoyo)
  const proposeOff = running || proposing || generating;
  const propose = async () => {
    if (proposeOff) return;
    setProposing(true);
    try { await run("apoyos/propose"); } catch { /* el error ya se mostró como notificación */ }
    finally { setProposing(false); }
  };

  return (
    <section className="card" aria-labelledby={`apoyos-${p.id}-title`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <h3 id={`apoyos-${p.id}-title`} ref={headRef} tabIndex={-1} className="m-0 outline-none">Apoyos visuales</h3>
          <p className="small muted m-0 mt-1">
            {apoyos.length ? `${approved} de ${apoyos.length} aprobados` : "Sin apoyos todavía"}
            {spent > 0 ? ` · Gastado en imágenes: ${usd(spent)}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 min-[520px]:items-end">
          {/* ocupado sin disabled nativo: el foco se queda en el botón mientras dura el pedido (y si falla al instante) */}
          <Button size="sm" variant="secondary" disabled={!p.recording} aria-disabled={proposeOff || undefined} className={softCls(proposeOff)}
            aria-describedby={`apoyos-${p.id}-prophint`} onClick={() => { void propose(); }}>
            <Sparkles aria-hidden />{apoyos.length ? "Proponer más" : "Proponer apoyos"}
          </Button>
          <span id={`apoyos-${p.id}-prophint`} className="text-[12px] text-muted-foreground">
            {generating ? "Espera a que terminen las imágenes en curso." : "Usa tu clave de IA (una llamada de texto)."}
          </span>
        </div>
      </div>
      {locked ? (
        <p role="status" className="small mt-3 mb-0">La IA está trabajando en los apoyos: podrás editarlos, aprobarlos o quitarlos cuando termine.</p>
      ) : null}
      <p className="small muted mt-3 mb-0">
        Las imágenes se generan solo cuando tocas Generar y se cobran a tu clave de OpenAI. Estilo: ilustración o motion
        graphics; nunca resultados inventados, caras de personas reales ni capturas que parezcan reales.
      </p>
      {apoyos.length ? (
        <ul ref={listRef} className="m-0 mt-3 grid list-none gap-2.5 p-0">
          {apoyos.map((a) => (
            <ApoyoItem key={a.id} a={a} p={p} keySet={keySet} unit={unit} locked={locked} setProject={setProject} act={act} toast={toast} onRemoved={onRemoved} />
          ))}
        </ul>
      ) : (
        <p className="small muted mt-3 mb-0">
          {p.recording ? "Esta propuesta no tiene apoyos. Toca «Proponer apoyos» para que la IA sugiera imágenes y animaciones que ilustren lo que dices." : "Carga la grabación para proponer apoyos."}
        </p>
      )}
    </section>
  );
}

function ApoyoItem({ a, p, keySet, unit, locked, setProject, act, toast, onRemoved }: {
  a: Apoyo; p: Project; keySet: boolean; unit?: number; locked: boolean; setProject: (p: Project) => void; onRemoved: (aid: string) => void;
  act: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T>; toast: (msg: string, err?: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState<"" | "gen" | "up" | "del" | "ok" | "save">("");
  const fileRef = useRef<HTMLInputElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const genBtn = useRef<HTMLButtonElement>(null);
  const delBtn = useRef<HTMLButtonElement>(null);
  // devuelve el foco al botón que abrió el formulario o la confirmación al cerrarlos (no al montar)
  const prev = useRef({ editing, confirmDel });
  useEffect(() => {
    if (prev.current.editing && !editing) editBtn.current?.focus();
    if (prev.current.confirmDel && !confirmDel) delBtn.current?.focus();
    prev.current = { editing, confirmDel };
  }, [editing, confirmDel]);

  const base = `/api/projects/${p.id}/apoyos/${a.id}`;
  const gen = a.estado === "generando";
  const hasFile = !!a.archivo;
  const okBlock = approveBlock(a);
  const canApprove = !okBlock;
  const idp = `apoyo-${a.id}`;
  // ocupado: hay un pedido en curso, se genera la imagen o la IA está rehaciendo los apoyos
  const off = gen || !!busy || locked;

  const call = async (kind: typeof busy, fn: () => Promise<Project>, okMsg?: string, after?: () => void) => {
    if (busy || locked) return;
    setBusy(kind);
    try { setProject(await act(fn, okMsg)); after?.(); } catch { /* el error ya se mostró como notificación */ }
    finally { setBusy(""); }
  };
  // «Reintentar» vive en el aviso de error, que desaparece al empezar a generar: el foco pasa al botón Generar/Regenerar
  const generate = (fromRetry = false) => call("gen", () => api<Project>(`${base}/generate`, { method: "POST", body: {} }), undefined,
    fromRetry ? () => requestAnimationFrame(() => genBtn.current?.focus()) : undefined);
  const toggleApproved = () => call("ok", () => api<Project>(base, { method: "PATCH", body: { aprobado: !a.aprobado } satisfies ApoyoPatch }));
  const remove = () => call("del", async () => {
    const np = await api<Project>(base, { method: "DELETE" });
    onRemoved(a.id);
    return np;
  }, "Apoyo quitado");
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    toast("Subiendo…");
    await call("up", () => upload<Project>(`${base}/file`, f), "Archivo subido");
  };
  const save = async (patch: ApoyoPatch) => {
    if (busy) return;
    setBusy("save");
    try { setProject(await act(() => api<Project>(base, { method: "PATCH", body: patch }), "Apoyo guardado")); setEditing(false); }
    catch { /* el error ya se mostró como notificación */ }
    finally { setBusy(""); }
  };

  const genLabel = `${hasFile ? "Regenerar" : "Generar"}${typeof unit === "number" && unit > 0 ? ` · ≈ ${usd(unit)}` : ""}`;
  const when = `${fmtT(a.inicio_s)}–${fmtT(a.fin_s)}`;

  return (
    <li data-apoyo-id={a.id} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-[10px] bg-[var(--panel-2)] p-2.5 min-[520px]:grid-cols-[88px_minmax(0,1fr)]">
      <Thumb a={a} p={p} />
      <div className="grid min-w-0 content-start gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-[family-name:var(--display)] font-semibold text-[var(--cta)] tabular-nums" aria-label={`De ${fmtT(a.inicio_s)} a ${fmtT(a.fin_s)}`}>{when}</span>
          <Tag tone="y">{TIPO_LABEL[a.tipo] || a.tipo}</Tag>
          <span className="text-[12px] text-muted-foreground">{MODO_LABEL[a.modo] || a.modo}{a.modo === "encima" ? ` · ${POS_LABEL[a.posicion] || a.posicion}` : ""}</span>
          {a.aprobado ? <Tag tone="g">Aprobado</Tag> : null}
          {gen ? <Tag>Generando…</Tag> : null}
          {a.estado === "error" ? <Tag tone="r">Error</Tag> : null}
        </div>
        {a.frase ? <p className="m-0 text-[14px] break-words">«{a.frase}»</p> : null}
        {a.contenido ? <p className="small muted m-0 break-words">{a.contenido}</p> : null}
        {a.tipo === "broll_animado" && a.animacion !== "ninguna" ? (
          <p className="small m-0 break-words"><span className="muted">Animación:</span> {ANIM_LABEL[a.animacion] || a.animacion}{a.datos?.length ? ` · ${a.datos.join(" · ")}` : ""}</p>
        ) : null}
        {a.estado === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-danger/10 px-2.5 py-1.5 text-[13px]">
            <span className="min-w-0 grow break-words">{a.error || "No se pudo generar la imagen."}</span>
            {a.tipo === "imagen" ? (
              <Button size="xs" variant="secondary" disabled={!keySet} aria-disabled={off || undefined} className={softCls(off)}
                onClick={() => { if (!off) void generate(true); }}><RefreshCw aria-hidden />Reintentar</Button>
            ) : null}
          </div>
        ) : null}

        {editing ? (
          <EditForm a={a} idp={idp} saving={busy === "save"} onSave={(x) => { void save(x); }} onCancel={() => setEditing(false)} />
        ) : confirmDel ? (
          <ConfirmInline question={a.fuente === "generar" && a.archivo && a.costUsd ? "¿Quitar este apoyo? La imagen ya pagada se conserva en la carpeta del proyecto." : "¿Quitar este apoyo?"} yes="Sí, quitar"
            onYes={() => { setConfirmDel(false); void remove(); }} onNo={() => setConfirmDel(false)} />
        ) : (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {a.tipo === "imagen" ? (
              <button ref={genBtn} type="button" className={cn(buttonVariants({ variant: "translucent", size: "sm" }), softCls(off))}
                disabled={!keySet || !a.prompt.trim()} aria-disabled={off || undefined} onClick={() => { if (!off) void generate(); }}
                aria-describedby={!keySet || !a.prompt.trim() ? `${idp}-genhint` : undefined}>
                {gen || busy === "gen" ? <span className="spinner" aria-hidden /> : <Wand2 aria-hidden />}{gen ? "Generando…" : genLabel}
              </button>
            ) : null}
            {needsFile(a) ? (
              <>
                <Button size="sm" variant="translucent" aria-disabled={off || undefined} className={softCls(off)} onClick={() => { if (!off) fileRef.current?.click(); }}>
                  {busy === "up" ? <span className="spinner" aria-hidden /> : <Upload aria-hidden />}Subir
                </Button>
                <input ref={fileRef} type="file" hidden accept={a.tipo === "clip" ? CLIP_ACCEPT : IMG_ACCEPT}
                  aria-label={a.tipo === "clip" ? "Subir clip o imagen" : "Subir imagen"} onChange={(e) => { void onFile(e); }} />
              </>
            ) : null}
            <button ref={editBtn} type="button" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), softCls(off))} aria-disabled={off || undefined} onClick={() => { if (!off) setEditing(true); }}><Pencil aria-hidden />Editar</button>
            <button ref={delBtn} type="button" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-danger hover:text-danger", softCls(off))} aria-disabled={off || undefined} onClick={() => { if (!off) setConfirmDel(true); }}><Trash2 aria-hidden />Quitar</button>
            <Button size="sm" variant={a.aprobado ? "secondary" : "outline"} aria-pressed={!!a.aprobado} className={cn("ml-auto", softCls(off || (!canApprove && !a.aprobado)))}
              // sin disabled nativo: al desaprobar un B-roll que ya no se puede aprobar el foco se queda en el botón
              aria-disabled={off || (!canApprove && !a.aprobado) || undefined}
              onClick={() => { if (!off && (canApprove || a.aprobado)) void toggleApproved(); }}
              aria-describedby={!canApprove ? `${idp}-okhint` : undefined}>
              <Check aria-hidden />{a.aprobado ? "Aprobado" : "Aprobar"}
            </Button>
          </div>
        )}
        {!editing && !confirmDel && a.tipo === "imagen" && !keySet ? (
          <p id={`${idp}-genhint`} className="m-0 text-[12px] text-muted-foreground">Falta la clave de OpenAI: agrégala en <a href="#/ajustes">Ajustes → Imágenes de apoyo</a>.</p>
        ) : !editing && !confirmDel && a.tipo === "imagen" && !a.prompt.trim() ? (
          <p id={`${idp}-genhint`} className="m-0 text-[12px] text-muted-foreground">Escribe la descripción en Editar para poder generarla.</p>
        ) : null}
        {!editing && !confirmDel && !canApprove ? (
          <p id={`${idp}-okhint`} className="m-0 text-[12px] text-muted-foreground">{okBlock}</p>
        ) : null}
      </div>
    </li>
  );
}

/** Miniatura 9:16: la imagen o el clip, o un marcador que explica cómo se resuelve ese apoyo. */
function Thumb({ a, p }: { a: Apoyo; p: Project }) {
  const box = "relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-surface-2 text-center";
  if (a.archivo) {
    const src = `/media/${p.id}/${a.archivo.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(a.at || "")}`;
    return (
      <div className={box}>
        {VIDEO_EXT.test(a.archivo)
          ? <video src={src} className="size-full object-cover" muted playsInline controls preload="metadata" aria-label={`Clip: ${a.contenido || a.frase}`} />
          : <img src={src} alt={a.contenido || a.frase || "Imagen de apoyo"} className="size-full object-cover" loading="lazy" />}
        {a.estado === "generando" ? <div className="absolute inset-0 flex items-center justify-center bg-black/45"><span className="spinner" aria-hidden /></div> : null}
      </div>
    );
  }
  const text = a.estado === "generando" ? "Generando…"
    : a.tipo === "broll_animado" ? "Se anima con la plantilla"
    : a.tipo === "zoom" ? "Acercamiento en la edición"
    : a.tipo === "clip" ? "Sube tu clip"
    : "Sin imagen";
  return (
    <div className={cn(box, "flex-col gap-1.5 p-1.5")}>
      {a.estado === "generando" ? <span className="spinner" aria-hidden /> : null}
      <span className="text-[11px] leading-tight text-muted-foreground">{text}</span>
    </div>
  );
}

/** Edición en línea: descripción para generar, contenido, modo, posición, tiempos (y animación y datos del B-roll). */
function EditForm({ a, idp, saving, onSave, onCancel }: { a: Apoyo; idp: string; saving: boolean; onSave: (x: ApoyoPatch) => void; onCancel: () => void }) {
  const [prompt, setPrompt] = useState(a.prompt);
  const [contenido, setContenido] = useState(a.contenido);
  const [modo, setModo] = useState(a.modo);
  const [posicion, setPosicion] = useState(a.posicion);
  // se muestran redondeados a 0,01 s, pero solo se envían si el usuario los cambia: editar el texto no mueve los tiempos
  const ini0 = String(Math.round(a.inicio_s * 100) / 100), fin0 = String(Math.round(a.fin_s * 100) / 100);
  const [ini, setIni] = useState(ini0);
  const [fin, setFin] = useState(fin0);
  const [animacion, setAnimacion] = useState(a.animacion);
  const datos0 = (a.datos || []).join("\n");
  const [datos, setDatos] = useState(datos0);
  const [err, setErr] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const iniChanged = ini.trim() !== ini0, finChanged = fin.trim() !== fin0;
    // vacío (o texto que el navegador no acepta como número, que llega como "") no es 0: se pide el tiempo
    const num = (v: string): number => (v.trim() ? Number(v.replace(",", ".")) : NaN);
    const s = iniChanged ? num(ini) : a.inicio_s;
    const f = finChanged ? num(fin) : a.fin_s;
    if (!isFinite(s) || !isFinite(f) || s < 0) return setErr("Escribe los tiempos en segundos (por ejemplo 3.5).");
    if (f <= s) return setErr("El fin tiene que ser mayor que el inicio.");
    setErr("");
    const patch: ApoyoPatch = { contenido: contenido.trim(), modo, posicion };
    if (iniChanged) patch.inicio_s = s;
    if (finChanged) patch.fin_s = f;
    if (a.tipo === "imagen") patch.prompt = prompt.trim();
    // los datos solo se envían si cambiaron; en comparación la posición importa (idea A, idea B, detalle A, detalle B):
    // se conservan las líneas vacías de en medio y solo se quitan las del final
    if (a.tipo === "broll_animado" && (animacion !== a.animacion || datos !== datos0)) {
      patch.animacion = animacion;
      const lines = datos.split("\n").map((x) => x.trim());
      if (animacion === "comparacion") { while (lines.length && !lines[lines.length - 1]) lines.pop(); patch.datos = lines; }
      else patch.datos = lines.filter(Boolean);
    }
    onSave(patch);
  };
  const lbl = "m-0! mb-1! block text-[12px]!";

  return (
    <form onSubmit={submit} className="mt-1 grid min-w-0 gap-2.5 rounded-md border border-[var(--line)] p-2.5" aria-label="Editar apoyo">
      {a.tipo === "imagen" ? (
        <div className="min-w-0">
          <label htmlFor={`${idp}-prompt`} className={lbl}>Descripción para generar la ilustración</label>
          <textarea id={`${idp}-prompt`} value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus rows={3} />
        </div>
      ) : null}
      <div className="min-w-0">
        <label htmlFor={`${idp}-cont`} className={lbl}>Qué muestra</label>
        <textarea id={`${idp}-cont`} value={contenido} onChange={(e) => setContenido(e.target.value)} autoFocus={a.tipo !== "imagen"} rows={2} />
      </div>
      {a.tipo === "broll_animado" ? (
        <div className="grid min-w-0 gap-2.5 min-[520px]:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={`${idp}-anim`} className={lbl}>Animación</label>
            <select id={`${idp}-anim`} value={animacion} onChange={(e) => setAnimacion(e.target.value as Apoyo["animacion"])}>
              {/* un B-roll animado siempre lleva animación: «Ninguna» solo aparece si viene guardada (para elegir otra) */}
              {Object.entries(ANIM_LABEL).filter(([k]) => k !== "ninguna" || a.animacion === "ninguna")
                .map(([k, v]) => <option key={k} value={k} disabled={k === "ninguna"}>{k === "ninguna" ? "Elige una animación" : v}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor={`${idp}-datos`} className={lbl}>Textos o cifras (uno por línea, como los dices; {DATOS_HINT[animacion] || "hasta 5, cortos"})</label>
            <textarea id={`${idp}-datos`} value={datos} onChange={(e) => setDatos(e.target.value)} rows={2} />
          </div>
        </div>
      ) : null}
      <div className="grid min-w-0 grid-cols-2 gap-2.5 min-[520px]:grid-cols-4">
        <div className="min-w-0">
          <label htmlFor={`${idp}-modo`} className={lbl}>Modo</label>
          <select id={`${idp}-modo`} value={modo} onChange={(e) => setModo(e.target.value as Apoyo["modo"])}>
            <option value="encima">Encima</option>
            <option value="pantalla_completa">Pantalla completa</option>
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idp}-pos`} className={lbl}>Posición</label>
          <select id={`${idp}-pos`} value={posicion} onChange={(e) => setPosicion(e.target.value as Apoyo["posicion"])} disabled={modo === "pantalla_completa"}>
            {Object.entries(POS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idp}-ini`} className={lbl}>Inicio (s)</label>
          <input id={`${idp}-ini`} type="number" inputMode="decimal" min={0} step="any" value={ini} onChange={(e) => setIni(e.target.value)} aria-invalid={!!err || undefined} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idp}-fin`} className={lbl}>Fin (s)</label>
          <input id={`${idp}-fin`} type="number" inputMode="decimal" min={0} step="any" value={fin} onChange={(e) => setFin(e.target.value)} aria-invalid={!!err || undefined} />
        </div>
      </div>
      {err ? <p role="alert" className="m-0 text-[12px] text-danger">{err}</p> : null}
      <p className="m-0 text-[12px] text-muted-foreground">Los tiempos son de tu grabación original; al cortar se ajustan solos.</p>
      <div className="flex flex-wrap gap-2">
        {/* sin disabled nativo mientras guarda: el foco se queda en el botón (y vuelve a servir si el guardado falla) */}
        <Button type="submit" size="sm" aria-disabled={saving || undefined} className={softCls(saving)}>{saving ? "Guardando…" : "Guardar"}</Button>
        <Button type="button" size="sm" variant="ghost" aria-disabled={saving || undefined} className={softCls(saving)} onClick={() => { if (!saving) onCancel(); }}>Cancelar</Button>
      </div>
    </form>
  );
}
