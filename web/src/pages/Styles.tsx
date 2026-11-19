// Estilos: biblioteca de estilos del motor de video.
// #/estilos → cabecera, buscador y filtros (tipo y origen), galería de tarjetas y, debajo, «Crear un estilo»
// (importar de mis proyectos, aprender de un video, crear con IA) plegable.
// #/estilos/<id> → detalle: vista previa grande, paleta, tipografías y la guía en pestañas
// (Resumen, Guía completa, Archivos, Mejorar con IA), con edición de la guía, duplicar y eliminar.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { ArrowLeft, ChevronDown, Clapperboard, Copy, FolderInput, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Video, X } from "lucide-react";
import type { Job, ProjectKind, Style, StyleKind, StyleOrigin } from "../../../shared/types.ts";
import { api, upload } from "../api.ts";
import { useApp, usePoll } from "../store.tsx";
import { JobBanner } from "../ui.tsx";
import { StyleThumb, styleFileUrl } from "../components/StylePreview.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils";

interface StylesResponse { styles: Style[]; job: Job | null }

export const STYLE_KIND_LABEL: Record<StyleKind, string> = { reel: "Reel", clase: "Clase", talking: "A cámara", any: "Cualquiera" };
export const STYLE_ORIGIN_LABEL: Record<StyleOrigin, string> = { base: "base", importado: "importado", referencia: "referencia", ia: "ia" };
/** Cómo nació un estilo del usuario (texto del chip de origen en el detalle). */
const ORIGIN_DETAIL: Record<StyleOrigin, string> = { base: "Incluido", importado: "Importado", referencia: "Aprendido de un video", ia: "Creado con IA" };
const KINDS: StyleKind[] = ["reel", "clase", "talking", "any"];

type KindFilter = StyleKind | "todos";
type OriginFilter = "todos" | "base" | "tuyos";

const FIELD = "w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-blue focus-visible:ring-[3px] focus-visible:ring-blue/40";
const LABEL = "mb-1.5 mt-3 block text-[13px] font-medium text-foreground";

/** Chip pequeño (tipo, «Tuyo»…). */
function Chip({ children, tone }: { children: ReactNode; tone?: "own" }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium leading-none",
      tone === "own" ? "bg-blue/15 text-foreground" : "bg-surface-2 text-muted-foreground")}>
      {children}
    </span>
  );
}

/** Control segmentado (grupo de botones con aria-pressed). */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-surface-1 p-[3px] [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue",
            value === o.value ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const jobKey = (j: Job): string => `${j.stage}|${j.startedAt || ""}|${j.endedAt || ""}|${j.step}`;

export function Styles({ sid }: { sid?: string }) {
  const { state, refresh, navigate, toast, act } = useApp();
  const [data, setData] = useState<StylesResponse | null>(null);
  // Clave del último banner de error cerrado (el servidor conserva styleJob.job hasta el próximo trabajo).
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);
  // Ids existentes al lanzar un trabajo de creación: al terminar se abre el estilo nuevo.
  const beforeIds = useRef<Set<string> | null>(null);

  const reload = useCallback(async (): Promise<StylesResponse | null> => {
    try {
      const d = await api<StylesResponse>("/api/styles");
      setData(d);
      return d;
    } catch (e) { toast((e as Error).message, true); return null; }
  }, [toast]);
  useEffect(() => { void reload(); }, [reload]);

  const styles = data?.styles || [];
  const sel: Style | null = sid ? styles.find((s) => s.id === sid) || null : null;
  const job: Job | null | undefined = data ? (data.job?.status === "running" ? data.job : sel?.job?.status === "running" ? sel.job : data.job) : null;
  const running = job?.status === "running";

  // Sondeo cada 2 s mientras el trabajo corre; al terminar refresca y abre el estilo nuevo.
  usePoll(async () => {
    const d = await api<StylesResponse>("/api/styles");
    setData(d);
    const still = d.job?.status === "running" || (sid ? d.styles.find((s) => s.id === sid)?.job?.status === "running" : false);
    if (still) return;
    void refresh();
    const prev = beforeIds.current;
    beforeIds.current = null;
    if (d.job?.status === "error") return;
    if (prev) {
      const fresh = d.styles.filter((s) => !prev.has(s.id));
      if (fresh.length) {
        const newest = fresh.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
        toast(fresh.length > 1 ? `${fresh.length} estilos nuevos ✓` : "Estilo listo ✓");
        navigate(`#/estilos/${newest.id}`);
      } else toast("Trabajo terminado");
    }
  }, 2000, running, ["styles", "step:styles", "jobs"]);

  /** Lanza un trabajo (import/learn/create/iterate/preview) y empieza a sondear. */
  const startJob = async (fn: () => Promise<unknown>): Promise<boolean> => {
    beforeIds.current = new Set(styles.map((s) => s.id));
    try { await act(fn); } catch { beforeIds.current = null; return false; }
    await reload();
    return true;
  };

  if (!data) return null;

  const banner = (
    <JobBanner
      job={job && job.status !== "running" && jobKey(job) === dismissedJob ? null : job}
      label="Estilos"
      onClose={() => { if (job) setDismissedJob(jobKey(job)); void reload(); }}
    />
  );

  if (sid) {
    return (
      <div className="mx-auto grid w-full min-w-0 max-w-[1200px] gap-6">
        {banner}
        {sel
          ? <StyleDetail key={sel.id} sel={sel} running={running} reload={reload} startJob={startJob} />
          : (
            <div className="grid justify-items-start gap-3 rounded-xl bg-surface-1 p-6">
              <p className="text-muted-foreground">Este estilo no existe o fue eliminado.</p>
              <Button variant="translucent" asChild><a href="#/estilos"><ArrowLeft aria-hidden /> Volver a Estilos</a></Button>
            </div>
          )}
      </div>
    );
  }

  return (
    <Library
      styles={styles}
      banner={banner}
      running={running}
      startJob={startJob}
      brands={state?.brands || []}
      defaultBrandId={state?.defaultBrandId ?? null}
    />
  );
}

/* ---------------------------------- Biblioteca ---------------------------------- */

function Library({ styles, banner, running, startJob, brands, defaultBrandId }: {
  styles: Style[];
  banner: ReactNode;
  running: boolean;
  startJob: (fn: () => Promise<unknown>) => Promise<boolean>;
  brands: { id: string; name: string }[];
  defaultBrandId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("todos");
  const [origin, setOrigin] = useState<OriginFilter>("todos");
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    return styles.filter((s) =>
      (kind === "todos" || s.kind === kind)
      && (origin === "todos" || (origin === "base" ? s.origin === "base" : s.origin !== "base"))
      && (!q || `${s.name} ${s.description || ""}`.toLocaleLowerCase("es").includes(q)));
  }, [styles, query, kind, origin]);
  const filtered = Boolean(query.trim()) || kind !== "todos" || origin !== "todos";

  const openCreate = () => {
    setCreateOpen(true);
    requestAnimationFrame(() => {
      const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      createRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      createTriggerRef.current?.focus({ preventScroll: true });
    });
  };
  const clearFilters = () => { setQuery(""); setKind("todos"); setOrigin("todos"); };

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1400px] gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-[720px]">
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.04em]">Estilos</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">Un estilo le dice al motor de video cómo se mueve, se ve y suena tu video. Pasa el mouse para verlo en movimiento y elígelo al crear un video.</p>
        </div>
        <Button onClick={openCreate}><Plus aria-hidden /> Crear estilo</Button>
      </header>

      {banner}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-64 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar estilos"
            aria-label="Buscar estilos por nombre o descripción"
            className="h-9 rounded-full border-border bg-surface-1 pl-9"
          />
        </div>
        <Segmented<KindFilter>
          label="Filtrar por tipo"
          value={kind}
          onChange={setKind}
          options={[{ value: "todos", label: "Todos" }, ...KINDS.map((k) => ({ value: k as KindFilter, label: STYLE_KIND_LABEL[k] }))]}
        />
        <Segmented<OriginFilter>
          label="Filtrar por origen"
          value={origin}
          onChange={setOrigin}
          options={[{ value: "todos", label: "Todos" }, { value: "base", label: "Incluidos" }, { value: "tuyos", label: "Tuyos" }]}
        />
      </div>

      <p className="sr-only" aria-live="polite">{shown.length} {shown.length === 1 ? "estilo" : "estilos"}</p>

      {shown.length ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
          {shown.map((s) => (
            <li key={s.id} className="min-w-0">
              <a
                href={`#/estilos/${s.id}`}
                className="group block rounded-xl text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              >
                <div className="overflow-hidden rounded-[10px] transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
                  <StyleThumb sid={s.id} preview={s.preview} palette={s.tokens?.palette} version={s.updatedAt} label={`Vista previa de ${s.name}`} />
                </div>
                <div className="mt-2 min-w-0">
                  <b className="block truncate text-sm font-semibold tracking-[-0.01em]">{s.name}</b>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Chip>{STYLE_KIND_LABEL[s.kind] || s.kind}</Chip>
                    {s.origin !== "base" ? <Chip tone="own">Tuyo</Chip> : null}
                  </div>
                  {s.description ? <p className="mt-1.5 mb-0 line-clamp-2 text-xs leading-snug text-muted-foreground">{s.description}</p> : null}
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-start gap-3 rounded-xl bg-surface-1 p-6">
          <p className="m-0 text-sm text-muted-foreground">{filtered ? "Ningún estilo coincide con tu búsqueda." : "Todavía no hay estilos."}</p>
          {filtered
            ? <Button variant="translucent" size="sm" onClick={clearFilters}><X aria-hidden /> Quitar filtros</Button>
            : <Button variant="translucent" size="sm" onClick={openCreate}><Plus aria-hidden /> Crear un estilo</Button>}
        </div>
      )}

      <Collapsible.Root open={createOpen} onOpenChange={setCreateOpen} asChild>
        <section ref={createRef} aria-labelledby="sty-create-h" className="scroll-mt-6 rounded-xl border border-border bg-surface-1/40">
          <div className="p-4 sm:p-5">
            <h2 id="sty-create-h" className="m-0 text-lg font-semibold tracking-[-0.02em]">
              <Collapsible.Trigger ref={createTriggerRef} className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue">
                <span className="min-w-0 flex-1">Crear un estilo</span>
                <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-muted-foreground motion-safe:transition-transform", createOpen && "rotate-180")} />
              </Collapsible.Trigger>
            </h2>
            <p className="mt-0.5 mb-0 text-[13px] text-muted-foreground">Importa tus proyectos, aprende de un video o descríbelo. También puedes abrir uno de la galería y duplicarlo.</p>
          </div>
          <Collapsible.Content className="px-4 pb-4 sm:px-5 sm:pb-5">
            <CreateCards running={running} startJob={startJob} brands={brands} defaultBrandId={defaultBrandId} />
          </Collapsible.Content>
        </section>
      </Collapsible.Root>
    </div>
  );
}

function CreateCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg bg-surface-1 p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid size-7 place-items-center rounded-md bg-surface-2 text-muted-foreground [&_svg]:size-4">{icon}</span>
        <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function CreateCards({ running, startJob, brands, defaultBrandId }: {
  running: boolean;
  startJob: (fn: () => Promise<unknown>) => Promise<boolean>;
  brands: { id: string; name: string }[];
  defaultBrandId: string | null;
}) {
  const { toast } = useApp();
  const [path, setPath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StyleKind>("reel");
  const [desc, setDesc] = useState("");
  const [brandId, setBrandId] = useState<string>(defaultBrandId || "");
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async () => {
    const p = path.trim();
    if (!p) return toast("Escribe la ruta de la carpeta", true);
    if (await startJob(() => api("/api/styles/import", { body: { path: p } }))) setPath("");
  };
  const onLearn = async () => {
    if (!file) return toast("Elige un video", true);
    if (await startJob(() => upload("/api/styles/learn", file))) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const onCreate = async () => {
    if (!name.trim()) return toast("Ponle un nombre al estilo", true);
    if (!desc.trim()) return toast("Describe el estilo", true);
    const body = { name: name.trim(), kind, description: desc.trim(), brandId: brandId || null };
    if (await startJob(() => api("/api/styles/create", { body }))) { setName(""); setDesc(""); }
  };

  return (
    <div className="grid items-start gap-3 md:grid-cols-3">
      <CreateCard icon={<FolderInput />} title="Importar de mis proyectos">
        <p className="mt-2 mb-0 text-[13px] text-muted-foreground">Pega la ruta de una carpeta de tu Mac: un proyecto del motor de video o una carpeta con varios. Se crea un estilo por cada familia. Si tienes clave de IA, la usa para escribir la guía.</p>
        <label htmlFor="sty-path" className={LABEL}>Ruta de la carpeta</label>
        <input id="sty-path" className={FIELD} value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Videos/mis-proyectos" onKeyDown={(e) => { if (e.key === "Enter") void onImport(); }} />
        <Button variant="translucent" className="mt-3 self-start" disabled={running} onClick={() => void onImport()}>Importar carpeta</Button>
      </CreateCard>

      <CreateCard icon={<Video />} title="Aprender de un video">
        <p className="mt-2 mb-0 text-[13px] text-muted-foreground">Sube un video que te guste. Se analizan el ritmo, los cortes, el color y la tipografía, y la IA escribe la guía. Usa tu clave de IA.</p>
        <label htmlFor="sty-file" className={LABEL}>Video de referencia</label>
        <input id="sty-file" ref={fileRef} type="file" accept="video/*" className={cn(FIELD, "file:mr-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-3 file:py-1 file:text-[13px] file:text-foreground")}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] || null)} />
        {file ? <p className="mt-1.5 mb-0 truncate text-xs text-muted-foreground">{file.name} · {(file.size / 1e6).toFixed(1)} MB</p> : null}
        <Button variant="translucent" className="mt-3 self-start" disabled={running || !file} onClick={() => void onLearn()}>Analizar video</Button>
      </CreateCard>

      <CreateCard icon={<Sparkles />} title="Crear con IA">
        <p className="mt-2 mb-0 text-[13px] text-muted-foreground">Describe el estilo con tus palabras y la IA escribe la guía completa. Usa tu clave de IA.</p>
        <label htmlFor="sty-name" className={LABEL}>Nombre</label>
        <input id="sty-name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Minimal oscuro" />
        <label htmlFor="sty-kind" className={LABEL}>Tipo de video</label>
        <select id="sty-kind" className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as StyleKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{STYLE_KIND_LABEL[k]}</option>)}
        </select>
        <label htmlFor="sty-desc" className={LABEL}>Descripción</label>
        <textarea id="sty-desc" className={FIELD} rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Fondo negro, tipografía grande y cortes rápidos al ritmo de la música, acentos en un solo color…" />
        <label htmlFor="sty-brand" className={LABEL}>Marca (opcional)</label>
        <select id="sty-brand" className={FIELD} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">Sin marca</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <Button variant="translucent" className="mt-3 self-start" disabled={running} onClick={() => void onCreate()}><Sparkles aria-hidden /> Crear con IA</Button>
      </CreateCard>
    </div>
  );
}

/* ---------------------------------- Guía ---------------------------------- */

interface GuideSection { title: string; body: string }

/** Parte la guía en un preámbulo (sin el título «# …») y secciones por «## » (ignora los ## dentro de bloques ```). */
function splitGuide(text: string): { intro: string; sections: GuideSection[] } {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const intro: string[] = [];
  const sections: { title: string; body: string[] }[] = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence ? /^##\s+(.*)$/.exec(line) : null;
    if (h) { sections.push({ title: h[1].trim(), body: [] }); continue; }
    (sections.length ? sections[sections.length - 1].body : intro).push(line);
  }
  // el título principal ya se muestra en la cabecera
  const firstText = intro.findIndex((l) => l.trim());
  if (firstText >= 0 && /^#\s+/.test(intro[firstText])) intro.splice(firstText, 1);
  return { intro: intro.join("\n").trim(), sections: sections.map((s) => ({ title: s.title, body: s.body.join("\n").trim() })) };
}

function GuideSections({ sections }: { sections: GuideSection[] }) {
  return (
    <div className="grid gap-2">
      {sections.map((s, i) => (
        <Collapsible.Root key={`${i}-${s.title}`} defaultOpen={i === 0} className="group/sec rounded-lg bg-surface-1">
          <Collapsible.Trigger className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue">
            <span className="min-w-0 flex-1 text-[15px] font-semibold tracking-[-0.01em]">{s.title}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground motion-safe:transition-transform group-data-[state=open]/sec:rotate-180" />
          </Collapsible.Trigger>
          <Collapsible.Content className="px-4 pb-4">
            {s.body ? <Markdown text={s.body} className="text-sm" /> : <p className="m-0 text-sm text-muted-foreground">Sección vacía.</p>}
          </Collapsible.Content>
        </Collapsible.Root>
      ))}
    </div>
  );
}

/* ---------------------------------- Detalle ---------------------------------- */

function StyleDetail({ sel, running, reload, startJob }: {
  sel: Style;
  running: boolean;
  reload: () => Promise<StylesResponse | null>;
  startJob: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { refresh, navigate, toast, act, openNewProject } = useApp();
  const isBase = sel.origin === "base";
  const [editing, setEditing] = useState(false);
  const [guide, setGuide] = useState(sel.guide || "");
  const [desc, setDesc] = useState(sel.description || "");
  const [feedback, setFeedback] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteBtnRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState("resumen");
  const nameRef = useRef(sel.name);
  nameRef.current = sel.name;
  useEffect(() => { if (!editing) { setGuide(sel.guide || ""); setDesc(sel.description || ""); } }, [sel.guide, sel.description, editing]);

  const put = async (body: { name?: string; description?: string; guide?: string; kind?: StyleKind }, okMsg?: string) => {
    await act(() => api<Style>(`/api/styles/${sel.id}`, { method: "PUT", body }), okMsg);
    await reload();
    void refresh();
  };
  const commitName = (v: string) => {
    const n = v.trim();
    if (!n || n === nameRef.current) return;
    nameRef.current = n;
    put({ name: n }).catch(() => {});
  };
  const onKind = (k: StyleKind) => { put({ kind: k }, "Tipo actualizado").catch(() => {}); };
  const onSaveGuide = async () => {
    try { await put({ guide, description: desc }, "Guía guardada ✓"); setEditing(false); } catch { /* ya notificado */ }
  };
  const onCancelEdit = () => { setEditing(false); setGuide(sel.guide || ""); setDesc(sel.description || ""); };
  const onIterate = async () => {
    const fb = feedback.trim();
    if (!fb) return toast("Escribe qué quieres cambiar", true);
    if (await startJob(() => api(`/api/styles/${sel.id}/iterate`, { body: { feedback: fb } }))) setFeedback("");
  };
  const onDuplicate = async () => {
    try {
      const c = await act(() => api<Style>(`/api/styles/${sel.id}/duplicate`, { method: "POST", body: {} }), "Estilo duplicado ✓");
      await reload(); void refresh(); navigate(`#/estilos/${c.id}`);
    } catch { /* ya notificado */ }
  };
  const onPreview = async () => {
    await startJob(() => api(`/api/styles/${sel.id}/preview`, { body: {} }));
  };
  const onDelete = async () => {
    setDeleting(true);
    try { await act(() => api(`/api/styles/${sel.id}`, { method: "DELETE" }), "Estilo eliminado"); } catch { setDeleting(false); return; }
    setConfirmDelete(false);
    await reload(); void refresh(); navigate("#/estilos");
  };
  const onUse = () => {
    const k: ProjectKind = sel.kind === "clase" ? "clase" : sel.kind === "talking" ? "talking" : "reel";
    openNewProject({ kind: k, styleId: sel.id });
  };
  const copyHex = (hex: string) => {
    const h = hex.startsWith("#") ? hex : `#${hex}`;
    if (!navigator.clipboard) return toast("No se pudo copiar", true);
    navigator.clipboard.writeText(h).then(() => toast(`Copiado ${h}`), () => toast("No se pudo copiar", true));
  };

  const palette = sel.tokens?.palette || [];
  const fonts = sel.tokens?.fonts || [];
  const files = sel.files || [];
  const sources = sel.sources || [];
  const { intro, sections } = useMemo(() => splitGuide(sel.guide || ""), [sel.guide]);
  // Resumen: lo que hay antes del segundo «## » (preámbulo + primera sección); si no hay guía, la descripción
  const summary = sel.guide
    ? [intro, sections[0] ? `### ${sections[0].title}\n\n${sections[0].body}` : ""].filter(Boolean).join("\n\n")
    : "";

  return (
    <>
      <header className="grid gap-3">
        <a href="#/estilos" className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] text-muted-foreground no-underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue">
          <ArrowLeft aria-hidden className="size-4" /> Estilos
        </a>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-64">
            {isBase
              ? <h1 className="m-0 text-[28px] font-semibold tracking-[-0.04em] break-words">{sel.name}</h1>
              : (
                <input
                  key={sel.name}
                  defaultValue={sel.name}
                  aria-label="Nombre del estilo (edítalo y pulsa Enter)"
                  className="-ml-2 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-[28px] font-semibold tracking-[-0.04em] text-foreground outline-none hover:border-border focus-visible:border-blue focus-visible:ring-[3px] focus-visible:ring-blue/40"
                  onBlur={(e) => commitName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitName(e.currentTarget.value); e.currentTarget.blur(); } }}
                />
              )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {isBase
                ? <Chip>{STYLE_KIND_LABEL[sel.kind] || sel.kind}</Chip>
                : (
                  <select
                    value={sel.kind}
                    onChange={(e) => onKind(e.target.value as StyleKind)}
                    aria-label="Tipo de video"
                    className="h-6 w-auto max-w-full shrink-0 rounded-full border border-border bg-surface-2 py-0 pl-2.5 pr-1.5 text-[12px] leading-none text-foreground outline-none focus-visible:border-blue focus-visible:ring-2 focus-visible:ring-blue/40"
                  >
                    {KINDS.map((k) => <option key={k} value={k}>{STYLE_KIND_LABEL[k]}</option>)}
                  </select>
                )}
              {isBase ? <Chip>Incluido</Chip> : <><Chip tone="own">Tuyo</Chip><Chip>{ORIGIN_DETAIL[sel.origin] || sel.origin}</Chip></>}
              {isBase ? <span className="text-xs text-muted-foreground">Solo lectura. Duplícalo para modificarlo.</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onUse}><Clapperboard aria-hidden /> Usar en un video</Button>
            <Button variant="translucent" onClick={() => void onDuplicate()}><Copy aria-hidden /> Duplicar</Button>
            {!isBase ? (
              <button type="button" ref={deleteBtnRef} className={buttonVariants({ variant: "ghost", className: "text-danger hover:text-danger" })} onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden /> Eliminar</button>
            ) : null}
          </div>
        </div>
      </header>

      <section aria-label="Vista previa y datos del estilo" className="grid gap-6 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[300px] md:mx-0">
          <StyleThumb sid={sel.id} preview={sel.preview} palette={palette} version={sel.updatedAt} autoPlay controls label={`Vista previa de ${sel.name}`} />
          {!isBase && sel.canPreview ? (
            <Button variant="translucent" size="sm" className="mt-2 w-full" disabled={running} onClick={() => void onPreview()}>
              <RefreshCw aria-hidden /> {sel.preview?.video ? "Regenerar vista previa" : "Generar vista previa"}
            </Button>
          ) : null}
          {!sel.preview?.video && !sel.canPreview && !isBase ? (
            <p className="mt-2 mb-0 text-xs text-muted-foreground">Este estilo aún no tiene vista previa: no trae demo ni renders en sus proyectos de origen.</p>
          ) : null}
          {sel.preview?.video ? <p className="mt-2 mb-0 text-xs text-muted-foreground">Demo con textos de ejemplo: cámbialos por los tuyos.</p> : null}
        </div>

        <div className="grid min-w-0 content-start gap-5">
          {sel.description ? <p className="m-0 max-w-[720px] text-[15px] leading-relaxed text-muted-foreground">{sel.description}</p> : null}

          <div>
            <h2 className="m-0 mb-2 text-sm font-semibold tracking-[-0.01em]">Paleta</h2>
            {palette.length ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {palette.map((h, i) => (
                  <li key={`${h}-${i}`}>
                    <button
                      type="button"
                      onClick={() => copyHex(h)}
                      aria-label={`Copiar color ${h}`}
                      title={`Copiar ${h}`}
                      className="group grid w-16 gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <span className="block h-10 w-full rounded-md border border-border motion-safe:transition-transform motion-safe:group-hover:scale-[1.04]" style={{ background: h }} />
                      <span className="truncate font-mono text-[11px] text-muted-foreground group-hover:text-foreground">{h}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-sm text-muted-foreground">Sin paleta definida.</p>}
          </div>

          <div>
            <h2 className="m-0 mb-2 text-sm font-semibold tracking-[-0.01em]">Tipografías</h2>
            {fonts.length ? (
              <ul className="m-0 grid list-none gap-1 p-0">
                {fonts.map((f, i) => <li key={i} className="truncate text-lg font-bold" style={{ fontFamily: `'${f}', var(--display)` }}>{f}</li>)}
              </ul>
            ) : <p className="m-0 text-sm text-muted-foreground">Sin tipografías definidas.</p>}
          </div>

          {sel.captionPreset ? (
            <div>
              <h2 className="m-0 mb-1 text-sm font-semibold tracking-[-0.01em]">Subtítulos</h2>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">{sel.captionPreset}</code>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="sty-guide-h" className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="sty-guide-h" className="m-0 flex-1 text-lg font-semibold tracking-[-0.02em]">Guía del estilo</h2>
          {!isBase ? (editing
            ? <>
                <Button variant="ghost" size="sm" onClick={onCancelEdit}>Cancelar</Button>
                <Button variant="translucent" size="sm" onClick={() => void onSaveGuide()}>Guardar</Button>
              </>
            : <Button variant="translucent" size="sm" onClick={() => setEditing(true)}><Pencil aria-hidden /> Editar guía</Button>) : null}
        </div>

        {editing ? (
          <div className="rounded-xl bg-surface-1 p-4">
            <label htmlFor="sty-edit-desc" className={cn(LABEL, "mt-0")}>Descripción corta</label>
            <input id="sty-edit-desc" className={FIELD} value={desc} onChange={(e) => setDesc(e.target.value)} />
            <label htmlFor="sty-edit-guide" className={LABEL}>Guía (markdown)</label>
            <textarea id="sty-edit-guide" rows={24} value={guide} onChange={(e) => setGuide(e.target.value)} className={cn(FIELD, "font-mono text-[13px] leading-relaxed")} />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Secciones de la guía">
              <TabsTrigger value="resumen">Resumen</TabsTrigger>
              <TabsTrigger value="guia">Guía completa</TabsTrigger>
              <TabsTrigger value="archivos">Archivos</TabsTrigger>
              <TabsTrigger value="mejorar"><Sparkles aria-hidden /> Mejorar con IA</TabsTrigger>
            </TabsList>

            <TabsContent value="resumen" className="rounded-xl bg-surface-1 p-4 sm:p-5">
              {summary
                ? <Markdown text={summary} className="max-w-[760px] text-sm" />
                : sel.description
                  ? <p className="m-0 text-sm text-muted-foreground">{sel.description}</p>
                  : <p className="m-0 text-sm text-muted-foreground">Este estilo aún no tiene guía.</p>}
              {sections.length > 1 ? (
                <Button variant="translucent" size="sm" className="mt-4" onClick={() => setTab("guia")}>Ver la guía completa</Button>
              ) : null}
            </TabsContent>

            <TabsContent value="guia" className="grid gap-3">
              {!sel.guide ? <p className="m-0 rounded-xl bg-surface-1 p-4 text-sm text-muted-foreground">Este estilo aún no tiene guía.</p> : null}
              {intro ? <div className="rounded-lg bg-surface-1 p-4"><Markdown text={intro} className="text-sm" /></div> : null}
              {sections.length ? <GuideSections sections={sections} /> : null}
            </TabsContent>

            <TabsContent value="archivos" className="grid gap-4 rounded-xl bg-surface-1 p-4 sm:p-5">
              <div>
                <h3 className="m-0 mb-2 text-sm font-semibold">Archivos ({files.length})</h3>
                {files.length ? (
                  <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
                    {files.map((f) => (
                      <li key={f} className="min-w-0">
                        <a href={styleFileUrl(sel.id, f)} target="_blank" rel="noreferrer" className="break-all font-mono text-blue underline-offset-2 hover:underline">{f}</a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="m-0 text-sm text-muted-foreground">Sin archivos adicionales.</p>}
              </div>
              <div>
                <h3 className="m-0 mb-2 text-sm font-semibold">De dónde se aprendió</h3>
                {sources.length
                  ? <ul className="m-0 grid list-none gap-1 p-0 text-[13px] text-muted-foreground">{sources.map((s, i) => <li key={i} className="break-all">{s}</li>)}</ul>
                  : <p className="m-0 text-sm text-muted-foreground">Sin fuentes registradas.</p>}
              </div>
              <div>
                <h3 className="m-0 mb-1 text-sm font-semibold">Uso</h3>
                <p className="m-0 text-sm text-muted-foreground">
                  {sel.usedBy?.length ? `Usado en ${sel.usedBy.length} proyecto${sel.usedBy.length === 1 ? "" : "s"}.` : "Todavía no se usa en ningún proyecto."}
                </p>
              </div>
            </TabsContent>

            <TabsContent value="mejorar" className="rounded-xl bg-surface-1 p-4 sm:p-5">
              {isBase ? (
                <div className="grid justify-items-start gap-3">
                  <p className="m-0 max-w-[600px] text-sm text-muted-foreground">Los estilos incluidos no se modifican. Duplícalo y mejora tu copia con IA.</p>
                  <Button variant="translucent" size="sm" onClick={() => void onDuplicate()}><Copy aria-hidden /> Duplicar</Button>
                </div>
              ) : (
                <div className="grid max-w-[720px] gap-2">
                  <label htmlFor="sty-feedback" className="text-sm font-medium">Qué cambiarías del estilo</label>
                  <p className="m-0 text-[13px] text-muted-foreground">La IA reescribe la guía con tus cambios. Usa tu clave de IA.</p>
                  <textarea id="sty-feedback" rows={4} className={FIELD} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Más pausas entre bloques, subtítulos más pequeños, transiciones menos agresivas…" />
                  <Button variant="translucent" className="justify-self-start" disabled={running} onClick={() => void onIterate()}><Sparkles aria-hidden /> Aplicar con IA</Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </section>

      <Dialog open={confirmDelete} onOpenChange={(o) => { if (!deleting) setConfirmDelete(o); }}>
        <DialogContent
          className="border-border bg-surface-1"
          onCloseAutoFocus={(e) => { e.preventDefault(); deleteBtnRef.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>¿Eliminar «{sel.name}»?</DialogTitle>
            <DialogDescription>Se borran el estilo, su guía y sus archivos. No se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void onDelete()}><Trash2 aria-hidden /> {deleting ? "Eliminando…" : "Eliminar estilo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
