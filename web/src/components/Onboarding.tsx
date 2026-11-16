// Primeros pasos en Inicio: conecta tu IA, crea tu marca y haz tu primer video.
// Se muestra hasta completar los 3 pasos o hasta que la persona lo oculta (se recuerda en este navegador).
import { useState, type FormEvent, type ReactNode } from "react";
import { Check, ExternalLink, KeyRound, Lock } from "lucide-react";
import type { Provider } from "../../../shared/types.ts";
import { api } from "@/api.ts";
import { useApp } from "@/store.tsx";
import { PROV_LABEL } from "@/ui.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

const HIDE_KEY = "andoo.onboarding.hidden";
const readHidden = (): boolean => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };
const writeHidden = (): void => { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* sin almacenamiento: solo se oculta en esta sesión */ } };

const KEY_HELP: Record<Provider, { url: string; prefix: string; placeholder: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", prefix: "sk-ant-", placeholder: "sk-ant-api03-…" },
  openai: { url: "https://platform.openai.com/api-keys", prefix: "sk-", placeholder: "sk-proj-…" },
};

export function Onboarding() {
  const { state } = useApp();
  const [hidden, setHidden] = useState(readHidden);
  if (!state || hidden) return null;

  const done = [
    state.usage.keySet,
    !state.brandIsPlaceholder,
    state.projects.some((p) => p.hasVideo),
  ];
  const count = done.filter(Boolean).length;
  if (count === 3) return null;
  const current = done.findIndex((d) => !d);

  const hide = () => { writeHidden(); setHidden(true); };

  return (
    <section aria-labelledby="onb-title" className="rounded-xl bg-surface-1 p-5 shadow-lift">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id="onb-title" className="m-0! text-[17px]! font-semibold tracking-[-0.02em]!">Empieza en 3 pasos</h2>
          <p className="mx-0! mb-0! mt-0.5! text-[13px] text-muted-foreground" aria-live="polite">{count} de 3 listos</p>
        </div>
        <Button variant="ghost" size="sm" onClick={hide}>Ocultar</Button>
      </div>
      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
        <StepTile n={1} title="Conecta tu IA" done={done[0]} current={current === 0}
          desc={done[0] ? `Usando ${PROV_LABEL[state.usage.provider]}.` : "Claude u OpenAI. La IA escribe guiones y produce tus videos."} />
        <StepTile n={2} title="Crea tu marca" done={done[1]} current={current === 1}
          desc={done[1] ? "La IA ya escribe con tu voz." : "Crear desde tu web o tu Instagram · 2 min"}
          action={done[1] ? null : <Button asChild variant="translucent" size="sm"><a href="#/branding">Crear mi marca</a></Button>} />
        <FirstVideoTile done={done[2]} current={current === 2} />
      </ol>
      {!done[0] ? <KeyForm defaultProvider={state.usage.provider} /> : null}
    </section>
  );
}

function FirstVideoTile({ done, current }: { done: boolean; current: boolean }) {
  const { openNewProject } = useApp();
  return (
    <StepTile n={3} title="Tu primer video" done={done} current={current}
      desc={done ? "Ya tienes un video listo." : "El productor te entrevista y arma el video contigo."}
      action={done ? null : <Button variant="translucent" size="sm" onClick={() => openNewProject()}>Crear video</Button>} />
  );
}

function StepTile({ n, title, desc, done, current, action }: { n: number; title: string; desc: string; done: boolean; current: boolean; action?: ReactNode }) {
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={cn("flex flex-col gap-2 rounded-lg bg-surface-2 p-4", current && "ring-1 ring-inset ring-blue")}
    >
      <div className="flex items-center gap-2.5">
        {done ? (
          <span className="grid size-6 place-items-center rounded-full bg-success/15 text-success" aria-hidden><Check className="size-3.5" strokeWidth={3} /></span>
        ) : (
          <span className={cn("grid size-6 place-items-center rounded-full text-[12px] font-semibold tabular-nums", current ? "bg-blue text-white" : "bg-surface-3 text-muted-foreground")} aria-hidden>{n}</span>
        )}
        <span className={cn("text-[14px] font-medium", done && "text-muted-foreground")}>
          {title}<span className="sr-only">{done ? " (listo)" : current ? " (siguiente paso)" : ""}</span>
        </span>
      </div>
      <p className="m-0! text-[13px] leading-snug text-muted-foreground">{desc}</p>
      {action ? <div className="mt-auto pt-1">{action}</div> : null}
    </li>
  );
}

function KeyForm({ defaultProvider }: { defaultProvider: Provider }) {
  const { act, refresh } = useApp();
  const [prov, setProv] = useState<Provider>(defaultProvider);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const help = KEY_HELP[prov];

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = key.trim();
    if (!v) return setError("Pega tu clave para continuar.");
    if (!v.startsWith(help.prefix) || v.includes("…")) return setError(`Las claves de ${PROV_LABEL[prov]} empiezan con ${help.prefix}`);
    setError("");
    setBusy(true);
    try {
      const body = prov === "anthropic" ? { provider: prov, apiKey: v } : { provider: prov, openaiKey: v };
      await act(() => api("/api/settings", { method: "PUT", body }), `Listo: ${PROV_LABEL[prov]} quedó conectada.`);
      setKey("");
      await refresh();
    } catch { /* el error ya se mostró como notificación */ }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 rounded-lg bg-surface-2 p-4" aria-labelledby="onb-key-title">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden />
        <h3 id="onb-key-title" className="m-0! text-[14px]! font-medium! normal-case! tracking-[-0.01em]! text-foreground!">Conecta tu IA</h3>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div role="radiogroup" aria-label="Proveedor de IA" className="inline-flex shrink-0 self-start rounded-full bg-surface-3 p-1 md:self-auto">
          {(["anthropic", "openai"] as Provider[]).map((p) => (
            <button
              key={p} type="button" role="radio" aria-checked={prov === p} tabIndex={prov === p ? 0 : -1}
              onClick={() => { setProv(p); setError(""); }}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                e.preventDefault();
                const next: Provider = prov === "anthropic" ? "openai" : "anthropic";
                setProv(next); setError("");
                (e.currentTarget.parentElement?.querySelector(`[data-prov="${next}"]`) as HTMLElement | null)?.focus();
              }}
              data-prov={p}
              className={cn(
                "h-7 rounded-full px-3.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                prov === p ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >{PROV_LABEL[p]}</button>
          ))}
        </div>
        <div className="min-w-0 grow">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor="onb-key" className="m-0! text-[12px] font-normal! text-muted-foreground">Clave de API de {PROV_LABEL[prov]}</label>
            <a href={help.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-blue! hover:underline!">
              ¿Dónde la consigo?<ExternalLink className="size-3" aria-hidden /><span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </div>
          <input
            id="onb-key" type="password" autoComplete="off" spellCheck={false} placeholder={help.placeholder}
            value={key} onChange={(e) => { setKey(e.target.value); if (error) setError(""); }}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "onb-key-err onb-key-note" : "onb-key-note"}
          />
        </div>
        <Button type="submit" variant="translucent" disabled={busy} className="shrink-0 bg-surface-3 hover:bg-surface-3/70">{busy ? "Guardando…" : "Guardar clave"}</Button>
      </div>
      {error ? <p id="onb-key-err" role="alert" className="mx-0! mb-0! mt-2! text-[12px] text-danger">{error}</p> : null}
      <p id="onb-key-note" className="mx-0! mb-0! mt-2! flex items-center gap-1.5 text-[12px] text-ink-faint">
        <Lock className="size-3" aria-hidden />Se guarda solo en este equipo. Pagas a {PROV_LABEL[prov]} según lo que uses.
      </p>
    </form>
  );
}
