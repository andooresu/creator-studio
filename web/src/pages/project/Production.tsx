// Sesión de producción del motor de video (proyectos "reel" y "clase"): un agente trabaja como en una
// sesión de Claude Code (entrevista, música, shotlist, voz, película, crítica, render) y aquí se ve en vivo:
// cabecera de estado, conversación (los pasos técnicos se agrupan en una fila), indicador de trabajo,
// acción pendiente (preguntas o aprobación), caja de mensajes y tarjeta de videos.
// Sondea el proyecto cada 2 s mientras el agente trabaja o espera.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Check, ChevronDown, CircleAlert, CircleHelp, CornerDownRight, FileText, Film, ShieldCheck, Square, TriangleAlert,
} from "lucide-react";
import type {
  AgentApproval, AgentQuestion, Format, Production, ProductionEvent, ProductionStatus, Project, StyleSummary,
} from "../../../../shared/types.ts";
import { api } from "../../api.ts";
import { useApp, usePoll } from "../../store.tsx";
import { money } from "../../ui.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Markdown } from "@/components/Markdown.tsx";
import { VideoPlayer } from "@/components/VideoPlayer.tsx";
import { ExportCard } from "@/components/ExportCard.tsx";
import { AndooMark } from "@/components/brand/AndooMark.tsx";
import { useElapsed, fmtElapsed } from "@/hooks/use-elapsed.ts";
import { cn } from "@/lib/utils.ts";

// ---------- Etiquetas compartidas (también las usan la barra lateral y el tablero) ----------
export { KIND_LABEL, PROD_STATUS_LABEL } from "../../ui.tsx";
import { KIND_LABEL, PROD_STATUS_LABEL } from "../../ui.tsx";
const STATUS_DOT: Record<ProductionStatus, string> = {
  idle: "bg-ink-faint", running: "bg-warning", waiting: "bg-warning", done: "bg-success", error: "bg-danger",
};
const FINAL_FORMATS: Format[] = ["9x16", "4x5", "16x9"];
const usd = (n: number | null | undefined): string => `US${money(n)}`;

// Clases compartidas
const CARD = "rounded-xl border border-border bg-surface-1 p-5";
const FIELD = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[14px] text-foreground placeholder:text-ink-faint outline-none transition-colors focus-visible:border-blue focus-visible:ring-[3px] focus-visible:ring-blue/30 disabled:opacity-60";
const H2 = "m-0 text-[20px] font-semibold tracking-[-0.03em]";

// ---------- Medios ----------
type MediaKind = "audio" | "video" | "image" | "other";
function mediaKind(src: string): MediaKind {
  const ext = (src.split("?")[0].split(".").pop() || "").toLowerCase();
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"].includes(ext)) return "image";
  return "other";
}
/** Las rutas de eventos ya son servibles; las de renders son relativas a la carpeta del motor. */
function motionUrl(pid: string, path: string): string {
  if (/^(\/|https?:)/.test(path)) return path;
  return `/media/${pid}/motion/${path.replace(/^\.?\//, "")}`;
}
const fileName = (src: string): string => decodeURIComponent(src.split("?")[0].split("/").pop() || src);
/** Relación de aspecto deducida del nombre del archivo (9:16 por defecto). */
function aspectOf(src: string): { aspect: string; width: string } {
  const n = fileName(src);
  if (/16x9/.test(n)) return { aspect: "16 / 9", width: "max-w-[520px]" };
  if (/4x5/.test(n)) return { aspect: "4 / 5", width: "max-w-[320px]" };
  if (/1x1/.test(n)) return { aspect: "1 / 1", width: "max-w-[320px]" };
  return { aspect: "9 / 16", width: "max-w-[260px]" };
}

function MediaItem({ src }: { src: string }) {
  const k = mediaKind(src);
  const name = fileName(src);
  if (k === "audio") return <audio controls preload="metadata" src={src} aria-label={`Audio: ${name}`} className="w-full max-w-[420px]" />;
  if (k === "video") {
    const { aspect, width } = aspectOf(src);
    return <div className={cn("w-full", width)}><VideoPlayer src={src} aspect={aspect} label={`Video: ${name}`} maxHeight="60vh" /></div>;
  }
  if (k === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/50">
        <img src={src} alt={name} loading="lazy" className="block max-h-[420px] max-w-full rounded-md border border-border" />
      </a>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] font-medium text-foreground hover:bg-surface-3">
      <FileText className="size-3.5" aria-hidden />{name}
    </a>
  );
}
function MediaList({ media }: { media?: string[] }) {
  if (!media || !media.length) return null;
  return <div className="mt-2 flex flex-wrap items-start gap-3">{media.map((m) => <MediaItem key={m} src={m} />)}</div>;
}

// ---------- Utilidades de la conversación ----------
const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
};
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const costData = (e: ProductionEvent): { cost: number | null; total: number | null } => {
  const d = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
  return { cost: num(d.cost), total: num(d.total) };
};
const isStep = (e: ProductionEvent) => e.type === "tool" || e.type === "status";

type Item = { kind: "event"; e: ProductionEvent } | { kind: "steps"; id: string; steps: ProductionEvent[] };
/** Agrupa los pasos (tool/status) consecutivos en una sola fila. */
function groupEvents(events: ProductionEvent[]): Item[] {
  const out: Item[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (isStep(e)) {
      if (last?.kind === "steps") last.steps.push(e);
      else out.push({ kind: "steps", id: e.id, steps: [e] });
    } else out.push({ kind: "event", e });
  }
  return out;
}

/** Desde cuándo trabaja el agente en este turno, el paso actual y cuántos pasos lleva. */
function currentTurn(events: ProductionEvent[], startedAt?: string) {
  let anchor = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    // Un turno empieza con un mensaje, una respuesta o una decisión, o al (re)arrancar la producción sin brief.
    if (t === "user" || t === "answer" || t === "decision") { anchor = i; break; }
    if (t === "status" && /^(Iniciando|Reanudando)/.test(events[i].text || "")) { anchor = i; break; }
  }
  const after = events.slice(anchor + 1);
  const tools = after.filter((e) => e.type === "tool");
  return {
    since: anchor >= 0 ? events[anchor].at : startedAt,
    step: tools.length ? tools[tools.length - 1].text : "Pensando…",
    count: tools.length,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- Filas de la conversación ----------
function AssistantMessage({ e }: { e: ProductionEvent }) {
  return (
    <div className="flex max-w-[88%] gap-2.5">
      <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-foreground" aria-hidden><AndooMark size={18} /></span>
      <div className="min-w-0">
        <div className="mb-1 text-[12px] text-muted-foreground">Productor · {timeOf(e.at)}</div>
        <div className="rounded-lg rounded-tl-sm bg-surface-2/60 px-4 py-3 text-[14px] leading-relaxed break-words">
          <Markdown text={e.text} />
          <MediaList media={e.media} />
        </div>
      </div>
    </div>
  );
}

function UserMessage({ e }: { e: ProductionEvent }) {
  return (
    <div className="ml-auto flex max-w-[82%] flex-col items-end">
      <div className="mb-1 text-[12px] text-muted-foreground">Tú · {timeOf(e.at)}</div>
      <div className="rounded-lg rounded-tr-sm bg-surface-2 px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap break-words">
        {e.text}
        <MediaList media={e.media} />
      </div>
    </div>
  );
}

function StepsRow({ steps }: { steps: ProductionEvent[] }) {
  const [open, setOpen] = useState(false);
  const last = steps[steps.length - 1];
  const media = steps.flatMap((s) => s.media || []);
  return (
    <div className="px-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/40"
      >
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
        <span className="shrink-0 font-medium">{steps.length} {steps.length === 1 ? "paso" : "pasos"}</span>
        <span className="min-w-0 truncate">· último: {last.text}</span>
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{timeOf(last.at)}</span>
      </button>
      {open ? (
        <ol className="m-0 mt-1 grid list-none gap-1 border-l border-border py-1 pl-4 font-mono text-[12px] text-muted-foreground">
          {steps.map((s) => (
            <li key={s.id} className="flex gap-3">
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{s.text}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(s.at)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <MediaList media={media} />
    </div>
  );
}

function CostRow({ e }: { e: ProductionEvent }) {
  const { cost, total } = costData(e);
  const text = cost !== null
    ? `Este paso costó ${usd(cost)}${total !== null ? ` · total ${usd(total)}` : ""}`
    : e.text;
  return <div className="px-1 text-[11px] text-muted-foreground tabular-nums">{text}</div>;
}

function ErrorRow({ e }: { e: ProductionEvent }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 whitespace-pre-wrap break-words">{e.text}<MediaList media={e.media} /></div>
    </div>
  );
}

function MediaRow({ e }: { e: ProductionEvent }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 px-4 py-3">
      {e.text ? <div className="flex items-start gap-2 text-[13px]"><Film className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="whitespace-pre-wrap">{e.text}</span></div> : null}
      <MediaList media={e.media} />
    </div>
  );
}

const NOTE_ICON = { question: CircleHelp, answer: CornerDownRight, approval: ShieldCheck, decision: Check } as const;
/** Pregunta, respuesta, aprobación o decisión: una línea discreta. */
function NoteRow({ e }: { e: ProductionEvent }) {
  const Icon = NOTE_ICON[e.type as keyof typeof NOTE_ICON] || CornerDownRight;
  return (
    <div className="px-1">
      <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
        <Icon className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{e.text}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(e.at)}</span>
      </div>
      <MediaList media={e.media} />
    </div>
  );
}

function EventRow({ e }: { e: ProductionEvent }) {
  switch (e.type) {
    case "user": return <UserMessage e={e} />;
    case "assistant": return <AssistantMessage e={e} />;
    case "media": return <MediaRow e={e} />;
    case "error": return <ErrorRow e={e} />;
    case "cost": return <CostRow e={e} />;
    default: return <NoteRow e={e} />;
  }
}

// ---------- Indicador de trabajo ----------
const SHIMMER_CSS = `
.prod-shimmer{color:var(--muted-foreground)}
@media (prefers-reduced-motion: no-preference){
  .prod-shimmer{background-image:linear-gradient(90deg,var(--muted-foreground) 0%,var(--muted-foreground) 35%,var(--foreground) 50%,var(--muted-foreground) 65%,var(--muted-foreground) 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:prod-shimmer 2.2s linear infinite}
}
@keyframes prod-shimmer{from{background-position:100% 0}to{background-position:0% 0}}
`;
function ThinkingRow({ events, startedAt }: { events: ProductionEvent[]; startedAt?: string }) {
  const turn = useMemo(() => currentTurn(events, startedAt), [events, startedAt]);
  const elapsed = useElapsed(turn.since, true);
  return (
    <div className="flex items-center gap-2.5 px-1 text-[13px]" role="status" aria-live="polite">
      <style>{SHIMMER_CSS}</style>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2" aria-hidden><AndooMark size={18} /></span>
      <span className="prod-shimmer min-w-0 truncate font-medium">{turn.step}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[12px] text-muted-foreground tabular-nums">
        <span aria-label={`Tiempo: ${fmtElapsed(elapsed)}`}>{fmtElapsed(elapsed)}</span>
        {turn.count ? <span>· paso {turn.count}</span> : null}
      </span>
    </div>
  );
}

// ---------- Conversación ----------
function Conversation({ events, running, startedAt, scrollerRef, onScroll }: {
  events: ProductionEvent[]; running: boolean; startedAt?: string;
  scrollerRef: RefObject<HTMLDivElement>; onScroll: (el: HTMLDivElement) => void;
}) {
  const items = useMemo(() => groupEvents(events), [events]);
  return (
    <section aria-label="Conversación con el productor" className="overflow-hidden rounded-xl border border-border bg-surface-1">
      <div
        ref={scrollerRef}
        onScroll={(e) => onScroll(e.currentTarget)}
        className="flex max-h-[58vh] flex-col gap-3.5 overflow-y-auto p-5"
      >
        {items.map((it) => it.kind === "steps" ? <StepsRow key={it.id} steps={it.steps} /> : <EventRow key={it.e.id} e={it.e} />)}
        {running ? <ThinkingRow events={events} startedAt={startedAt} /> : null}
      </div>
    </section>
  );
}

// ---------- Cabecera ----------
function StopButton({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking(true)} className="text-danger hover:text-danger">
        <Square className="size-3.5 fill-current" aria-hidden />Detener
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[13px]" role="group" aria-label="Confirmar detener">
      <span className="px-1 text-muted-foreground">¿Detener? Podrás retomarlo con un mensaje.</span>
      <Button variant="destructive" size="sm" disabled={busy} autoFocus onClick={() => { setAsking(false); onStop(); }}>Sí, detener</Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>No</Button>
    </span>
  );
}

function Header({ p, prod, status, style, busy, onStop }: {
  p: Project; prod: Production | null; status: ProductionStatus; style?: StyleSummary; busy: boolean; onStop: () => void;
}) {
  const live = status === "running" || status === "waiting";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface-1 px-4 py-3 text-[13px]">
      <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 font-medium" aria-live="polite">
        <span className={cn("size-2 rounded-full", STATUS_DOT[status], status === "running" && "motion-safe:animate-pulse")} aria-hidden />
        {PROD_STATUS_LABEL[status]}
      </span>
      <span className="text-muted-foreground">{KIND_LABEL[p.kind || "talking"]}</span>
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        Estilo <b className="font-medium text-foreground">{style?.name || "sin estilo"}</b>
        {style?.palette?.length ? (
          <span className="inline-flex gap-1" aria-hidden>
            {style.palette.slice(0, 6).map((c) => <span key={c} className="size-2.5 rounded-full ring-1 ring-white/10" style={{ background: c }} />)}
          </span>
        ) : null}
      </span>
      <span className="grow" />
      <span className="text-muted-foreground">Costo hasta ahora <b className="font-medium text-foreground tabular-nums">{money(prod?.costUsd)}</b></span>
      {live ? <StopButton busy={busy} onStop={onStop} /> : null}
    </div>
  );
}

function MotionWarning({ issues }: { issues: string[] }) {
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <b className="font-semibold">El motor de video no está listo.</b>
        {issues.length ? <ul className="m-0 mt-1 list-disc pl-4 text-muted-foreground">{issues.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      </div>
    </div>
  );
}

// ---------- Chips de sugerencia ----------
function Chips({ items, onPick, label }: { items: string[]; onPick: (t: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {items.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onPick(t)}
          className="h-7 rounded-full border border-border bg-surface-2 px-3 text-[12px] text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/40"
        >
          {t}
        </button>
      ))}
    </div>
  );
}
const insertText = (cur: string, t: string): string => (cur.trim() ? `${cur.replace(/\s+$/, "")} ${t}` : t);

// ---------- Acción pendiente: preguntas ----------
function QuestionCard({ q, onSubmit, busy }: { q: AgentQuestion; onSubmit: (answers: Record<string, string>) => Promise<void>; busy: boolean }) {
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  useEffect(() => { setSel({}); setOther({}); }, [q.id]);

  const toggle = (question: string, label: string, multi: boolean) => {
    setSel((prev) => {
      const cur = prev[question] || [];
      const next = multi ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : (cur[0] === label ? [] : [label]);
      return { ...prev, [question]: next };
    });
  };
  const answerOf = (question: string): string => {
    const parts = [...(sel[question] || [])];
    const o = (other[question] || "").trim();
    if (o) parts.push(o);
    return parts.join(", ");
  };
  const complete = q.questions.every((x) => answerOf(x.question));
  const submit = () => {
    const answers: Record<string, string> = {};
    for (const x of q.questions) answers[x.question] = answerOf(x.question);
    void onSubmit(answers);
  };

  return (
    <div className="grid gap-6">
      {q.questions.map((x, qi) => {
        const multi = !!x.multiSelect;
        const chosen = sel[x.question] || [];
        const otherId = `${q.id}-${qi}-other`;
        return (
          <fieldset key={qi} className="m-0 grid min-w-0 gap-2 border-0 p-0">
            <legend className="mb-0 grid gap-2 p-0">
              {x.header ? <span className="w-fit rounded-full bg-surface-3 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{x.header}</span> : null}
              <span className="block text-[15px] font-semibold tracking-[-0.01em]">{x.question}</span>
            </legend>
            <span className="text-[12px] text-muted-foreground">{multi ? "Puedes elegir varias." : "Elige una."}</span>
            <div className="grid gap-2">
              {x.options.map((o) => {
                const on = chosen.includes(o.label);
                return (
                  <label
                    key={o.label}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-[14px] transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-blue/40",
                      on ? "border-blue/60 bg-blue/10" : "border-border bg-surface-1 hover:bg-surface-3/40",
                    )}
                  >
                    <input
                      type={multi ? "checkbox" : "radio"}
                      name={`${q.id}-${qi}`}
                      checked={on}
                      onChange={() => toggle(x.question, o.label, multi)}
                      onClick={() => { if (!multi && on) toggle(x.question, o.label, multi); }}
                      className="mt-1 size-4 shrink-0 accent-[var(--blue)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{o.label}</span>
                      {o.description ? <span className="mt-0.5 block text-[13px] text-muted-foreground">{o.description}</span> : null}
                      {o.preview ? <pre className="mt-2 mb-0 max-h-[180px] overflow-auto rounded-md bg-background p-2.5 font-mono text-[12px] text-muted-foreground">{o.preview}</pre> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            <label htmlFor={otherId} className="sr-only">Otra respuesta: {x.question}</label>
            <input
              id={otherId}
              className={FIELD}
              placeholder="Otra respuesta (opcional)…"
              value={other[x.question] || ""}
              onChange={(e) => setOther((prev) => ({ ...prev, [x.question]: e.target.value }))}
            />
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!complete || busy} onClick={submit}>{busy ? "Enviando…" : "Responder"}</Button>
        {!complete ? <span className="text-[12px] text-muted-foreground">Responde todas las preguntas para continuar.</span> : null}
      </div>
    </div>
  );
}

// ---------- Acción pendiente: aprobación ----------
const APPROVAL_KIND: Record<AgentApproval["kind"], string> = {
  concepto: "Concepto", musica: "Música", voz: "Voz", shotlist: "Plan de tomas", borrador: "Borrador", final: "Final", otro: "Revisión",
};
function CostHint({ events, total }: { events: ProductionEvent[]; total?: number }) {
  const costs = events.filter((e) => e.type === "cost").map((e) => costData(e).cost).filter((c): c is number => c !== null);
  if (!costs.length) return null;
  return (
    <p className="m-0 text-[12px] text-muted-foreground tabular-nums">
      Cada paso ha costado ≈ {usd(median(costs))} en promedio (esta producción). Llevas {usd(total)}.
    </p>
  );
}
function ApprovalCard({ a, onDecide, busy, events, total }: {
  a: AgentApproval; onDecide: (approved: boolean, feedback?: string) => Promise<void>; busy: boolean; events: ProductionEvent[]; total?: number;
}) {
  const [changes, setChanges] = useState(false);
  const [fb, setFb] = useState("");
  useEffect(() => { setChanges(false); setFb(""); }, [a.id]);
  const fbId = `fb-${a.id}`;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <span className="w-fit rounded-full bg-surface-3 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{APPROVAL_KIND[a.kind] || "Revisión"}</span>
        <h3 className="m-0 text-[18px] font-semibold tracking-[-0.02em]">{a.title}</h3>
        {a.summary ? <div className="max-h-[300px] overflow-auto text-[14px] leading-relaxed"><Markdown text={a.summary} /></div> : null}
        <MediaList media={a.media} />
      </div>
      <CostHint events={events} total={total} />
      {changes ? (
        <div className="grid gap-2">
          <label htmlFor={fbId} className="text-[13px] font-medium">¿Qué quieres cambiar?</label>
          <textarea
            id={fbId}
            autoFocus
            rows={3}
            className={cn(FIELD, "resize-y")}
            placeholder="Sé específico: ritmo, texto, música, colores…"
            value={fb}
            onChange={(e) => setFb(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !fb.trim()} onClick={() => { void onDecide(false, fb.trim()); }}>{busy ? "Enviando…" : "Enviar cambios"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setChanges(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => { void onDecide(true); }}><Check aria-hidden />Aprobar y seguir</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setChanges(true)}>Pedir cambios</Button>
        </div>
      )}
    </div>
  );
}

function PendingCard({ children, question }: { children: ReactNode; question: boolean }) {
  return (
    <section
      aria-label={question ? "Pregunta del productor" : "Aprobación pendiente"}
      className="rounded-xl bg-surface-2 p-5 shadow-lift ring-1 ring-blue/45 ring-inset"
    >
      <h2 className="m-0 mb-4 text-[13px] font-medium text-blue">{question ? "El productor necesita tu respuesta" : "Revisa y aprueba"}</h2>
      {children}
    </section>
  );
}

// ---------- Inicio / retomar ----------
const BRIEF_CHIPS = ["Reel de 15 s para Instagram", "Tono cercano y directo", "Termina con «Escríbenos»"];
function StartCard({ p, resume, busy, onStart }: { p: Project; resume: boolean; busy: boolean; onStart: (brief: string) => Promise<boolean> }) {
  const [brief, setBrief] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const explain = p.kind === "clase"
    ? "Cuenta qué quieres explicar, a quién y en cuánto tiempo. El productor te hará preguntas, propondrá guion, voz, música y plan de tomas, y te pedirá aprobación en cada paso."
    : !p.kind || p.kind === "talking"
    ? "El productor toma tu grabación ya cortada y la produce con el estilo elegido: subtítulos animados, títulos, gráficos, música y efectos. Si quieres, indica el tono, qué resaltar o el llamado a la acción; te pedirá aprobación en cada paso."
    : "Cuenta qué producto o idea quieres mostrar, el tono y el llamado a la acción. El productor te hará preguntas, propondrá música y plan de tomas, y te pedirá aprobación en cada paso.";
  return (
    <section className={cn(CARD, "grid gap-4")}>
      <div className="grid gap-1.5">
        <h2 className={H2}>{resume ? "Retomar la producción" : "Empezar la producción"}</h2>
        <p className="m-0 max-w-[68ch] text-[14px] leading-relaxed text-muted-foreground">{explain}</p>
      </div>
      <div className="grid gap-2">
        <label htmlFor={`brief-${p.id}`} className="text-[13px] font-medium">Brief <span className="font-normal text-muted-foreground">(opcional)</span></label>
        <textarea
          id={`brief-${p.id}`}
          ref={ref}
          rows={4}
          className={cn(FIELD, "resize-y")}
          placeholder="Objetivo, público, mensaje clave, duración aproximada, links o referencias…"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <Chips label="Ideas para el brief" items={BRIEF_CHIPS} onPick={(t) => { setBrief((b) => insertText(b, t)); ref.current?.focus(); }} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => { void onStart(brief).then((ok) => { if (ok) setBrief(""); }); }}>{busy ? "Iniciando…" : "Empezar producción"}</Button>
        {p.goal ? <span className="text-[12px] text-muted-foreground">Objetivo del proyecto: {p.goal}</span> : null}
      </div>
    </section>
  );
}

// ---------- Caja de mensajes ----------
const DONE_CHIPS = ["Hazlo más corto", "Cambia la música", "Prueba otra tipografía", "Más contraste en los textos"];
function Composer({ status, waitingCard, busy, onSend }: {
  status: ProductionStatus; waitingCard: boolean; busy: boolean; onSend: (text: string) => Promise<boolean>;
}) {
  const [msg, setMsg] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const disabled = busy || waitingCard;
  // Crece con el texto hasta ~8 líneas.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [msg]);
  const send = async () => { const t = msg.trim(); if (t && !disabled && await onSend(t)) setMsg(""); };
  return (
    <section className={cn(CARD, "grid gap-3 p-4")}>
      <label htmlFor="prod-msg" className="sr-only">Mensaje para el productor</label>
      <div className="flex items-end gap-2">
        <textarea
          id="prod-msg"
          ref={ref}
          rows={1}
          className={cn(FIELD, "min-h-[44px] flex-1 resize-none leading-relaxed")}
          placeholder={waitingCard ? "Responde la tarjeta de arriba para continuar…" : status === "running" ? "Escribe un comentario (lo leerá en cuanto pueda)…" : "Escribe feedback o una instrucción para el productor…"}
          value={msg}
          disabled={disabled}
          aria-describedby="prod-msg-hint"
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        />
        <Button className="h-11 px-5" disabled={disabled || !msg.trim()} onClick={() => { void send(); }}>Enviar</Button>
      </div>
      {status === "done" && !waitingCard ? (
        <Chips label="Sugerencias de cambios" items={DONE_CHIPS} onPick={(t) => { setMsg((m) => insertText(m, t)); ref.current?.focus(); }} />
      ) : null}
      <p id="prod-msg-hint" className="m-0 text-[12px] text-muted-foreground">
        {waitingCard
          ? "Responde la tarjeta de arriba: el productor está esperando esa respuesta. Para pedir cambios usa «Pedir cambios»."
          : <><kbd className="rounded bg-surface-3 px-1 font-mono text-[11px]">⌘</kbd>/<kbd className="rounded bg-surface-3 px-1 font-mono text-[11px]">Ctrl</kbd> + <kbd className="rounded bg-surface-3 px-1 font-mono text-[11px]">Enter</kbd> para enviar.</>}
      </p>
    </section>
  );
}

// ---------- Videos ----------
function VideosCard({ p, prod, busy, rendering, onRender, onDismissError }: {
  p: Project; prod: Production | null; busy: boolean; rendering: boolean; onRender: () => Promise<void>; onDismissError: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className={cn(CARD, "grid gap-4")} aria-labelledby={`videos-${p.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`videos-${p.id}`} className={H2}>Videos</h2>
        {!confirming ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={rendering || !prod}
            title={prod ? undefined : "Empieza la producción primero"}
            onClick={() => setConfirming(true)}
          >
            Exportar final
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="grid gap-3 rounded-lg bg-surface-2 p-4" role="group" aria-label="Confirmar exportación final">
          <p className="m-0 text-[14px] leading-relaxed">Exporta en 9:16, 4:5 y 16:9 a calidad final. Tarda varios minutos; puedes seguir usando Andoo.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" autoFocus disabled={busy || rendering} onClick={() => { setConfirming(false); void onRender(); }}>Exportar</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {p.job?.status === "error" ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words"><span className="font-medium">Exportación</span> · {p.job.step || "falló"}</div>
          <Button size="sm" variant="ghost" className="-my-1 shrink-0" onClick={onDismissError}>Cerrar</Button>
        </div>
      ) : null}
      <ExportCard
        job={p.job}
        renders={prod?.renders || []}
        urlOf={(r) => motionUrl(p.id, r.path) + (r.at ? "?v=" + encodeURIComponent(r.at) : "")}
      />
      {!(prod?.renders || []).length && p.job?.status !== "running" ? (
        <p className="m-0 text-[12px] text-muted-foreground">El productor crea vistas previas durante la sesión; la exportación final sale en todos los formatos.</p>
      ) : null}
    </section>
  );
}

// ---------- Panel principal ----------
export function ProductionPanel({ p, setProject }: { p: Project; setProject: (p: Project) => void }) {
  const { state, act, refresh } = useApp();
  const prod = p.production || null;
  const status: ProductionStatus = prod?.status || "idle";
  const pending = prod?.pending || null;
  const events = prod?.events || [];
  const jobRunning = p.job?.status === "running";
  const style = (state?.styles || []).find((s) => s.id === p.styleId);

  const [busy, setBusy] = useState(false);

  // Proyecto siempre fresco para el sondeo.
  const pRef = useRef(p);
  pRef.current = p;
  usePoll(async () => {
    const np = await api<Project>(`/api/projects/${pRef.current.id}`).catch(() => null);
    if (!np) return;
    const before = pRef.current;
    if (JSON.stringify(np.production) !== JSON.stringify(before.production) || JSON.stringify(np.job) !== JSON.stringify(before.job)) {
      const finished = (before.production?.status === "running" || before.production?.status === "waiting") && np.production?.status !== before.production?.status;
      setProject(np);
      if (finished || (before.job?.status === "running" && np.job?.status !== "running")) refresh().catch(() => {});
    }
  }, 2000, status === "running" || status === "waiting" || jobRunning, [`projects:${p.id}`, `step:projects:${p.id}`]);

  // Desplazamiento automático al final cuando llegan eventos (solo si ya estabas abajo).
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, pending?.data.id]);

  const post = async (path: string, body: unknown, okMsg?: string): Promise<boolean> => {
    setBusy(true);
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/${path}`, { method: "POST", body }), okMsg);
      setProject(np);
      stick.current = true;
      refresh().catch(() => {});
      return true;
    } catch { return false; } finally { setBusy(false); }
  };

  // Sin "mode": el servidor usa modeOf(p) (o el modo ya guardado), así un talking head sigue siendo talking al retomar.
  const onStart = (brief: string) => post("production/start", { brief: brief.trim() || undefined }, prod ? "Producción reanudada" : "Producción iniciada");
  const onStop = () => { void post("production/stop", {}, "Producción detenida"); };
  const onSend = (text: string) => post("production/message", { text });
  const onAnswer = async (answers: Record<string, string>) => {
    if (pending?.type === "question") await post("production/answer", { questionId: pending.data.id, answers });
  };
  const onDecide = async (approved: boolean, feedback?: string) => {
    if (pending?.type === "approval") await post("production/approve", { approvalId: pending.data.id, approved, feedback }, approved ? "Aprobado" : "Cambios enviados");
  };
  const onRender = async () => { await post("motion/render", { mode: "final", formats: FINAL_FORMATS }, "Exportación final en cola"); };

  const showStart = !prod || status === "idle";
  const canMessage = !!prod && (status !== "idle" || !!prod.sessionId || events.length > 0);
  // Con una pregunta o aprobación pendiente el agente está bloqueado en esa tarjeta: el mensaje no le llegaría.
  const waitingCard = status === "waiting" && !!pending;
  const motion = state?.motion;

  return (
    <div className="mt-4 grid gap-4">
      <Header p={p} prod={prod} status={status} style={style} busy={busy} onStop={onStop} />

      {motion && !motion.ready ? <MotionWarning issues={motion.issues} /> : null}

      {showStart ? <StartCard p={p} resume={!!prod} busy={busy} onStart={onStart} /> : null}

      {events.length ? (
        <Conversation
          events={events}
          running={status === "running"}
          startedAt={prod?.startedAt}
          scrollerRef={scroller}
          onScroll={(el) => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        />
      ) : null}

      {pending ? (
        <PendingCard question={pending.type === "question"}>
          {pending.type === "question"
            ? <QuestionCard q={pending.data} onSubmit={onAnswer} busy={busy} />
            : <ApprovalCard a={pending.data} onDecide={onDecide} busy={busy} events={events} total={prod?.costUsd} />}
        </PendingCard>
      ) : null}

      {canMessage ? <Composer status={status} waitingCard={waitingCard} busy={busy} onSend={onSend} /> : null}

      <VideosCard p={p} prod={prod} busy={busy} rendering={busy || jobRunning} onRender={onRender} onDismissError={() => setProject({ ...p, job: null })} />
    </div>
  );
}
