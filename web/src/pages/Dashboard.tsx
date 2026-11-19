// Inicio: saludo + «Nuevo video», primeros pasos (hasta completarlos), proyectos agrupados por lo que necesitan
// y un atajo secundario para crear un proyecto desde el link de un video que quieres emular.
import { useState, type FormEvent } from "react";
import { AlertTriangle, Clapperboard, GraduationCap, Link2, Plus, Sparkles, Video } from "lucide-react";
import type { Project, ProjectKind, ProjectSummary } from "../../../shared/types.ts";
import { api } from "@/api.ts";
import { useApp } from "@/store.tsx";
import { KIND_LABEL } from "@/ui.tsx";
import { projectStatus } from "@/components/AppSidebar.tsx";
import { extractUrls } from "@/components/LinkChips.tsx";
import { Onboarding } from "@/components/Onboarding.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

type Tone = ReturnType<typeof projectStatus>["tone"];
const TONE_DOT: Record<Tone, string> = {
  live: "bg-blue motion-safe:animate-pulse", wait: "bg-warning", ok: "bg-success", bad: "bg-danger", idle: "bg-ink-faint",
};
const KIND_ICON: Record<ProjectKind, typeof Video> = { talking: Video, reel: Clapperboard, clase: GraduationCap };
const KIND_BG: Record<ProjectKind, string> = {
  talking: "linear-gradient(160deg, color-mix(in srgb, var(--g-coral) 22%, var(--surface-2)) 0%, var(--surface-1) 75%)",
  reel: "linear-gradient(160deg, color-mix(in srgb, var(--g-violet) 34%, var(--surface-2)) 0%, var(--surface-1) 75%)",
  clase: "linear-gradient(160deg, color-mix(in srgb, var(--g-orange) 26%, var(--surface-2)) 0%, var(--surface-1) 75%)",
};
const DONE_LIMIT = 8;

/** «hace 2 h», «ayer», «hace 3 días»… */
export function timeAgo(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  if (d < 30) { const w = Math.floor(d / 7); return `hace ${w} ${w === 1 ? "semana" : "semanas"}`; }
  return new Date(t).toLocaleDateString("es", { day: "numeric", month: "short", year: d > 330 ? "numeric" : undefined });
}

const when = (p: ProjectSummary) => p.updatedAt || p.createdAt;
const byRecent = (a: ProjectSummary, b: ProjectSummary) => (when(b) || "").localeCompare(when(a) || "");

export function Dashboard() {
  const { state, openNewProject } = useApp();
  const [showAllDone, setShowAllDone] = useState(false);
  if (!state) return null;

  const name = state.studioName?.trim();
  const named = Boolean(name && name !== "Mi estudio");
  const noWhisper = !state.tools.whisperCpp && !state.tools.whisperPy;
  const projects = [...state.projects].sort(byRecent);
  const groups: { id: string; title: string; items: ProjectSummary[] }[] = [
    { id: "need", title: "Te necesitan", items: [] },
    { id: "doing", title: "En curso", items: [] },
    { id: "done", title: "Terminados", items: [] },
  ];
  for (const p of projects) {
    const tone = projectStatus(p).tone;
    groups[tone === "wait" || tone === "bad" ? 0 : tone === "ok" ? 2 : 1].items.push(p);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0! text-[28px]! font-semibold leading-tight tracking-[-0.04em]!">
            {named ? `Hola, ${name}` : "Hola, ¿qué grabamos hoy?"}
          </h1>
          {named ? <p className="mx-0! mb-0! mt-1! text-[15px] text-muted-foreground">¿Qué grabamos hoy?</p> : null}
        </div>
        <Button size="lg" onClick={() => openNewProject()}><Plus aria-hidden />Nuevo video</Button>
      </header>

      {noWhisper ? (
        <p className="mx-0! -mt-4! mb-0! flex items-center gap-2 text-[13px] text-muted-foreground">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          Falta whisper para subtitular: vuelve a abrir Instalar.command.
        </p>
      ) : null}

      {projects.length === 0 ? <Welcome /> : null}

      <Onboarding />

      <section aria-labelledby="proj-title" className="flex flex-col gap-6">
        <h2 id="proj-title" className="sr-only">Tus videos</h2>
        {projects.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6">
            <p className="m-0! text-[15px] font-medium">Aquí verás tus videos.</p>
            <p className="m-0! text-[13px] text-muted-foreground">Aún no tienes ninguno. Crea el primero: el productor te guía paso a paso.</p>
            <Button variant="translucent" onClick={() => openNewProject()}><Plus aria-hidden />Crear mi primer video</Button>
          </div>
        ) : groups.filter((g) => g.items.length).map((g) => {
          const limited = g.id === "done" && !showAllDone && g.items.length > DONE_LIMIT;
          const items = limited ? g.items.slice(0, DONE_LIMIT) : g.items;
          return (
            <div key={g.id} role="group" aria-labelledby={`grp-${g.id}`}>
              <div className="mb-3 flex items-baseline gap-2">
                <h3 id={`grp-${g.id}`} className="m-0! text-[15px]! font-semibold! normal-case! tracking-[-0.02em]! text-foreground!">{g.title}</h3>
                <span className="text-[13px] tabular-nums text-muted-foreground">{g.items.length}</span>
              </div>
              <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
                {items.map((p) => <li key={p.id}><ProjectCard p={p} /></li>)}
              </ul>
              {limited ? (
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowAllDone(true)}>Ver todos ({g.items.length})</Button>
              ) : null}
            </div>
          );
        })}
      </section>

      <QuickFromLink />
    </div>
  );
}

function Welcome() {
  return (
    <section aria-labelledby="welcome-title" className="relative overflow-hidden rounded-xl bg-gradient-brand p-6 text-white md:p-8">
      <Sparkles className="absolute right-6 top-6 size-6 opacity-70" aria-hidden />
      <h2 id="welcome-title" className="m-0! text-[26px]! font-semibold leading-tight tracking-[-0.04em]! md:text-[32px]!">Tu primer reel en 10 minutos</h2>
      <p className="mx-0! mb-0! mt-2! max-w-[52ch] text-[15px] text-white/85">Elige un estilo, cuéntale tu idea al productor y la IA arma el video contigo.</p>
      <Button asChild variant="secondary" className="mt-5"><a href="#/estilos">Elegir un estilo</a></Button>
    </section>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const st = projectStatus(p);
  // El fallo va ligado a la URL: si cambia la miniatura se vuelve a intentar.
  const [brokenSrc, setBrokenSrc] = useState<string>();
  const Icon = KIND_ICON[p.kind] || Video;
  const ago = timeAgo(when(p));
  return (
    <a
      href={`#/p/${p.id}`}
      className="group block rounded-lg text-foreground no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-surface-2 transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
        {p.thumb && brokenSrc !== p.thumb ? (
          <img src={p.thumb} alt="" loading="lazy" decoding="async" onError={() => setBrokenSrc(p.thumb)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col justify-between p-3" style={{ background: KIND_BG[p.kind] || KIND_BG.talking }}>
            <Icon className="size-4 text-white/60" aria-hidden />
            <span className="line-clamp-5 break-words text-[20px] font-semibold leading-[1.02] tracking-[-0.04em] text-white/90 sm:text-[22px]" aria-hidden>{p.title}</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/5 group-hover:ring-white/15" />
      </div>
      <div className="mt-2 min-w-0 px-0.5">
        <div className="truncate text-[14px] font-medium tracking-[-0.01em]">{p.title}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-foreground/90">
            <span className={cn("size-1.5 rounded-full", TONE_DOT[st.tone])} aria-hidden />{st.label}
          </span>
          <span className="truncate">{KIND_LABEL[p.kind]}{ago ? <> · <time dateTime={when(p)}>{ago}</time></> : null}</span>
        </div>
      </div>
    </a>
  );
}

function QuickFromLink() {
  const { state, refresh, navigate, toast, act } = useApp();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [analyzeChoice, setAnalyzeChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const keySet = state.usage.keySet;
  const analyze = keySet && (analyzeChoice ?? true);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!url.trim()) return toast("Pega al menos un link", true);
    const { urls, rest } = extractUrls(url);
    if (!urls.length) return toast("Eso no parece un link. Pega la dirección completa del video (https://…).", true);
    // lo que parece un link pero no se pudo leer (p. ej. «htps://…» o «ftp://…») no se descarta en silencio: se avisa
    // antes de crear (y de lanzar el análisis, que usa tu clave)
    const bad = rest.filter((t) => /[./]/.test(t));
    if (bad.length) return toast(`No pude leer ${bad.length === 1 ? "este link" : "estos links"}: ${bad.slice(0, 3).join(" ")}${bad.length > 3 ? "…" : ""}. Corrígelo o quítalo.`, true);
    setBusy(true);
    try {
      // una sola petición: el servidor valida los links antes de crear (sin proyectos huérfanos)
      const p = await act(() => api<Project>("/api/projects", {
        method: "POST",
        body: {
          title: note.trim().slice(0, 60) || "Idea desde link",
          references: urls.map((u) => ({ url: u, note: note.trim() })),
          autoScript: analyze,
        },
      }));
      await refresh();
      navigate(`#/p/${p.id}`);
    } catch { /* el error ya se mostró como notificación */ }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="ql-title" className="rounded-xl bg-surface-1 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Link2 className="size-4 text-muted-foreground" aria-hidden />
        <h2 id="ql-title" className="m-0! text-[15px]! font-semibold tracking-[-0.02em]!">¿Viste un video que quieres emular?</h2>
      </div>
      <p className="mx-0! mt-0! mb-4! text-[13px] text-muted-foreground">Pega el link (Reels, TikTok o Shorts). Se crea un proyecto con ese video como referencia.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="ql-url" className="mx-0! mt-0! mb-1! block text-[12px] font-normal! text-muted-foreground">Links del video</label>
          <textarea id="ql-url" name="url" rows={2} placeholder="https://www.instagram.com/reel/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ql-note" className="mx-0! mt-0! mb-1! block text-[12px] font-normal! text-muted-foreground">¿Qué te gusta de él? (opcional)</label>
          <input id="ql-note" name="note" placeholder="El hook, la edición, el tema…" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <label className={cn("m-0! inline-flex! cursor-pointer items-center gap-2 text-[13px]! font-normal! text-foreground!", !keySet && "cursor-not-allowed text-muted-foreground!")}>
              <input
                type="checkbox" checked={analyze} disabled={!keySet}
                onChange={(e) => setAnalyzeChoice(e.target.checked)}
                aria-describedby={!keySet ? "ql-nokey" : undefined}
                style={{ width: 16, height: 16, padding: 0, margin: 0, accentColor: "var(--blue)", flex: "none" }}
              />
              Analizarlo con IA ahora (usa tu clave de IA)
            </label>
            {!keySet ? <p id="ql-nokey" className="mx-0! mb-0! mt-1! text-[12px] text-ink-faint">Conecta tu IA para analizarlo. Puedes hacerlo después desde el proyecto.</p> : null}
          </div>
          <Button type="submit" variant="translucent" disabled={busy}>{busy ? "Creando…" : "Crear proyecto"}</Button>
        </div>
      </form>
    </section>
  );
}
