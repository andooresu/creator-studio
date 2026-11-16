// Ajustes en pestañas: IA, Audio, Motor de video, Cuentas y fuentes, General.
// Todo vive en UN formulario no controlado (leído con FormData al guardar): las pestañas inactivas y los bloques
// "Avanzado" siguen en el DOM (ocultos) para que se envíen todos los campos. Los cambios se detectan comparando
// el FormData actual con el que había al cargar; la barra fija inferior aparece solo cuando hay cambios.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, AudioLines, Bot, Clapperboard, Eye, EyeOff, Link2, SlidersHorizontal } from "lucide-react";
import type { AiStage, AudioEnv, AudioProvider, Job, LocalAudioEngine, ModelPrice, Provider, PublicSettings, Settings, SettingsUpdate } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useApp, useLeaveGuard } from "../store.tsx";
import { PROV_LABEL } from "../ui.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils";

const STAGES_AI: [AiStage, string][] = [["analisis", "Análisis de referencias"], ["guion", "Guion"], ["concepto", "Propuesta visual"], ["edicion", "Selección de tomas"], ["publicar", "Paquete de publicación"], ["branding", "Marca"], ["inspiracion", "Análisis en Inspiración"], ["estilos", "Estilos"]];
const PROVIDERS: Provider[] = ["anthropic", "openai"];
const PROV_DESC: Record<Provider, string> = { anthropic: "Modelos Claude. Recomendado.", openai: "Modelos GPT." };
// Valores que se envían al servidor (sin cambiar) y su etiqueta visible.
const EFFORT_OPTS: [Settings["effort"], string][] = [["low", "Rápido"], ["medium", "Equilibrado"], ["high", "A fondo"], ["xhigh", "Máximo"]];

const AUDIO_MODES: { id: AudioProvider; label: string; desc: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs", desc: "Mejor calidad, de pago" },
  { id: "local", label: "Local gratis", desc: "Modelos abiertos en tu Mac" },
  { id: "sintetizado", label: "Sintetizado", desc: "Gratis, sin IA, funciona en cualquier Mac" },
];
const ENGINES: { id: LocalAudioEngine; label: string; role: string }[] = [
  { id: "kokoro", label: "Kokoro", role: "Voz (español: ef_dora, em_alex, em_santa)" },
  { id: "chatterbox", label: "Chatterbox", role: "Voz multilingüe con clonación desde una muestra" },
  { id: "acestep", label: "ACE-Step 1.5", role: "Música instrumental" },
  { id: "stableaudio", label: "Stable Audio Open", role: "Efectos de sonido (necesita token de Hugging Face)" },
];
const KOKORO_VOICES: [string, string][] = [["em_alex", "em_alex · masculina"], ["em_santa", "em_santa · masculina"], ["ef_dora", "ef_dora · femenina"]];
const ACCEL_LABEL: Record<AudioEnv["hardware"]["accel"], string> = { "apple-silicon": "Apple Silicon (GPU)", cuda: "NVIDIA CUDA", cpu: "Solo CPU" };
/** Lo que puede traer /api/audio/env o /api/audio/install además de AudioEnv: el trabajo de instalación en curso. */
type AudioEnvWithJobs = AudioEnv & { job?: Job | null; jobs?: Partial<Record<LocalAudioEngine, Job | null>> };
const POLL_MS = 2000;
const POLL_MAX_MS = 45 * 60_000;

type KeyName = NonNullable<SettingsUpdate["clear"]>;
interface IgFound { page: string; id: string; username: string }

const TABS = [
  { id: "ia", label: "IA", icon: Bot },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "video", label: "Motor de video", icon: Clapperboard },
  { id: "cuentas", label: "Cuentas y fuentes", icon: Link2 },
  { id: "general", label: "General", icon: SlidersHorizontal },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_KEY = "andoo.settings.tab";
const isTab = (v: unknown): v is TabId => TABS.some((t) => t.id === v);
function readTab(): TabId {
  try { const v = localStorage.getItem(TAB_KEY); return isTab(v) ? v : "ia"; } catch { return "ia"; }
}
function writeTab(v: TabId) {
  try { localStorage.setItem(TAB_KEY, v); } catch { /* sin almacenamiento: solo se pierde la pestaña recordada */ }
}

/** Serializa el formulario para comparar con lo cargado (los archivos no aplican aquí). */
function serializeForm(f: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(f).entries()).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
}

// ---------- Piezas de presentación ----------
const inputCls = "h-9 w-full min-w-0 rounded-md border border-border bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const labelCls = "mt-0 mb-1.5 block text-[13px] font-medium text-foreground";
const helpCls = "mt-1.5 text-[12px] leading-relaxed text-muted-foreground";

type Tone = "ok" | "warn" | "bad" | "neutral";
const TONE_CLS: Record<Tone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-danger/15 text-danger",
  neutral: "bg-surface-3 text-muted-foreground",
};
function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", TONE_CLS[tone], className)}>{children}</span>;
}

function Card({ title, desc, children, hidden, aside }: { title: string; desc?: ReactNode; children: ReactNode; hidden?: boolean; aside?: ReactNode }) {
  return (
    <section hidden={hidden} className="rounded-xl border border-border bg-surface-1 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
          {desc ? <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{desc}</p> : null}
        </div>
        {aside}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Bloque técnico plegable. Es un <details>: su contenido sigue en el formulario aunque esté cerrado. */
function Advanced({ children, label = "Avanzado" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group rounded-lg border border-border bg-background/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {label}
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-3 pt-3 pb-4">{children}</div>
    </details>
  );
}

function Help({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className={helpCls}>{children}</p>;
}

/** Campo de clave secreta: contraseña con mostrar/ocultar, chip "Guardada" y "Quitar" con confirmación en línea. */
function SecretField({ name, label, has, placeholder, help, onClear, dirty }: {
  name: KeyName; label: string; has: boolean; placeholder: string; help?: ReactNode; onClear: (n: KeyName) => Promise<void>; dirty: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const quitarRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // null = sin interacción todavía (no mover el foco al montar).
  const prevConfirming = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevConfirming.current === null) { prevConfirming.current = confirming; return; }
    if (prevConfirming.current === confirming) return;
    prevConfirming.current = confirming;
    if (confirming) cancelRef.current?.focus();
    else quitarRef.current?.focus();
  }, [confirming]);
  const id = "set-" + name;
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className={cn(labelCls, "mb-0")}>{label}</label>
        {has ? <Chip tone="ok">Guardada</Chip> : <Chip>Sin configurar</Chip>}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input id={id} name={name} type={shown ? "text" : "password"} placeholder={placeholder} autoComplete="off" spellCheck={false}
            aria-describedby={helpId} className={cn(inputCls, "pr-10 font-mono text-[13px]")} />
          <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? "Ocultar clave" : "Mostrar clave"} aria-pressed={shown}
            className="absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-surface-3 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
        {has && !confirming ? <button ref={quitarRef} type="button" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-danger hover:text-danger")} onClick={() => setConfirming(true)}>Quitar</button> : null}
      </div>
      {confirming ? (
        <div role="group" aria-label={`Confirmar quitar ${label}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-foreground">
          <span className="min-w-0 flex-1">¿Quitar esta clave del estudio?{dirty ? " Se descartarán tus cambios sin guardar." : ""}</span>
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => { setBusy(true); void onClear(name).finally(() => { setBusy(false); setConfirming(false); }); }}>Sí, quitar</Button>
          <button ref={cancelRef} type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
        </div>
      ) : null}
      {help ? <Help id={helpId!}>{help}</Help> : null}
    </div>
  );
}

/** Opción de un grupo de radios con aspecto de tarjeta (el radio real queda accesible con teclado). */
function RadioCard({ name, value, checked, onChange, title, desc }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; desc: string }) {
  return (
    <label className={cn(
      "m-0 flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 motion-reduce:transition-none",
      checked ? "border-ring bg-surface-2" : "border-border hover:bg-surface-2",
    )}>
      <input type="radio" className="sr-only" name={name} value={value} checked={checked} onChange={onChange} />
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-[12px] text-muted-foreground">{desc}</span>
    </label>
  );
}

function StatusRow({ label, children, note }: { label: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0 text-sm text-foreground">{label}{note ? <div className="text-[12px] text-muted-foreground">{note}</div> : null}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}

export function SettingsPage() {
  const { state, refresh, toast, act } = useApp();
  const [s, setS] = useState<PublicSettings | null>(null);
  const [ver, setVer] = useState(0);
  const [prov, setProv] = useState<Provider>("anthropic");
  const [found, setFound] = useState<IgFound[] | null>(null);
  const [aud, setAud] = useState<AudioProvider>("sintetizado");
  const [ttsEng, setTtsEng] = useState<Settings["localTtsEngine"]>("kokoro");
  const [audioEnv, setAudioEnv] = useState<AudioEnvWithJobs | null>(null);
  const [installing, setInstalling] = useState<Partial<Record<LocalAudioEngine, string>>>({});
  const polls = useRef<Partial<Record<LocalAudioEngine, number>>>({});
  const [tab, setTab] = useState<TabId>(readTab);
  const formRef = useRef<HTMLFormElement>(null);
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Equivale a volver a llamar renderSettings(): recarga ajustes y re-monta el formulario.
  const reload = useCallback(async () => {
    const x = await api<PublicSettings>("/api/settings");
    setS(x);
    setProv(x.provider);
    setAud(x.audioProvider || "sintetizado");
    setTtsEng(x.localTtsEngine === "chatterbox" ? "chatterbox" : "kokoro");
    setFound(null);
    baseline.current = null;
    setDirty(false);
    setVer((n) => n + 1);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (state?.audio) setAudioEnv(state.audio); }, [state?.audio]);
  // al salir de la página se detienen los sondeos de instalación
  useEffect(() => () => { for (const t of Object.values(polls.current)) if (t) window.clearTimeout(t); }, []);

  // ---------- Cambios sin guardar ----------
  const ready = Boolean(s && state);
  // Al (re)montar el formulario se guarda la foto de referencia.
  useEffect(() => {
    const f = formRef.current;
    if (!ready || !f) return;
    baseline.current = serializeForm(f);
    setDirty(false);
  }, [ver, ready]);
  const checkDirty = useCallback(() => {
    // tras el render, para que los campos controlados (proveedor, modo de audio, motor de voz) ya estén en el DOM
    window.setTimeout(() => {
      const f = formRef.current;
      if (!f || baseline.current === null) return;
      setDirty(serializeForm(f) !== baseline.current);
    }, 0);
  }, []);
  useEffect(() => { checkDirty(); }, [prov, aud, ttsEng, checkDirty]);

  // Guardia global: enlaces, ⌘K, avisos, Atrás/Adelante y cerrar la pestaña piden confirmación (LeaveDialog).
  useLeaveGuard(dirty, "Tienes cambios en Ajustes que se perderán si sales ahora.");

  const onTab = (v: string) => { if (isTab(v)) { setTab(v); writeTab(v); } };

  if (!s || !state) {
    return (
      <div aria-busy="true" aria-label="Cargando ajustes" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-full max-w-[520px] rounded-full" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  const t = state.tools;

  const modelInputs = (pv: Provider) => (
    <>
      <datalist id={`dl_${pv}`}>
        {Object.entries(s.catalog[pv]).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </datalist>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={labelCls}>Modelos por sección</legend>
        <p className={cn(helpCls, "mt-0 mb-3")}>Vacío = el modelo por defecto. Escribe o elige el id del modelo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {STAGES_AI.map(([k, label]) => (
            <div key={k} className="min-w-0">
              <label htmlFor={`set-m_${pv}_${k}`} className={cn(labelCls, "text-[12px] text-muted-foreground")}>{label}</label>
              <input id={`set-m_${pv}_${k}`} name={`m_${pv}_${k}`} list={`dl_${pv}`} defaultValue={s.models[pv][k] || ""} className={cn(inputCls, "font-mono text-[13px]")} />
            </div>
          ))}
        </div>
      </fieldset>
    </>
  );

  const onClear = async (name: KeyName) => {
    try {
      await act(() => api("/api/settings", { method: "PUT", body: { clear: name } satisfies SettingsUpdate }), "Clave quitada");
    } catch { return; }
    await refresh();
    await reload();
  };

  /** Lo que muestra un campo secreto vacío: la clave enmascarada que devuelve el servidor, o un ejemplo. */
  const ph = (name: KeyName, has: boolean, example: string) => (has ? String(s[name] ?? "") : example);

  const pricesTxt = Object.entries(state.pricing).filter(([k]) => s.catalog.openai[k] || s.customPrices[k]).map(([k, v]) => `${k} ${v.in} ${v.out}`).join("\n");

  // Tras detectar/elegir la cuenta solo se actualiza la info de Instagram (sin re-montar el formulario), para no
  // perder los cambios sin guardar de las demás pestañas.
  const refreshIg = async () => {
    const x = await api<PublicSettings>("/api/settings");
    setS((prev) => (prev ? { ...prev, metaIgUserId: x.metaIgUserId, metaIgUsername: x.metaIgUsername, has: x.has } : x));
    setFound(null);
  };

  const onDetect = async () => {
    const r = await act(() => api<{ found: IgFound[]; selected: string }>("/api/meta/detect", { method: "POST", body: {} }));
    if (r.found.length === 1) { toast(`Conectado como @${r.found[0].username}`); await refreshIg(); return; }
    setFound(r.found);
  };

  const onPick = async (x: IgFound) => {
    try {
      await act(() => api("/api/settings", { method: "PUT", body: { metaIgUserId: x.id, metaIgUsername: x.username } satisfies SettingsUpdate }), "Cuenta seleccionada");
    } catch { return; }
    await refreshIg();
  };

  // ---------- Audio del motor: instalar motores locales y vigilar el trabajo ----------
  const env: AudioEnvWithJobs | null = audioEnv ?? state.audio ?? null;
  const jobOf = (x: AudioEnvWithJobs | null, eng: LocalAudioEngine): Job | null => {
    if (!x) return null;
    if (x.jobs && eng in x.jobs) return x.jobs[eng] ?? null;
    return x.job && x.job.stage.toLowerCase().includes(eng) ? x.job : null;
  };
  const stopWatching = (eng: LocalAudioEngine) => {
    const t = polls.current[eng];
    if (t) window.clearTimeout(t);
    delete polls.current[eng];
    setInstalling((m) => { const n = { ...m }; delete n[eng]; return n; });
  };
  const onInstall = async (eng: LocalAudioEngine, label: string) => {
    if (installing[eng]) return;
    setInstalling((m) => ({ ...m, [eng]: "Iniciando instalación…" }));
    try {
      const r = await api<Partial<AudioEnvWithJobs>>("/api/audio/install", { method: "POST", body: { engine: eng } });
      if (r && r.engines) setAudioEnv(r as AudioEnvWithJobs);
    } catch (e) {
      stopWatching(eng);
      toast(`No se pudo instalar ${label}: ${(e as Error).message}`, true);
      return;
    }
    const started = Date.now();
    const tick = async () => {
      let x: AudioEnvWithJobs | null = null;
      try { x = await api<AudioEnvWithJobs>("/api/audio/env"); setAudioEnv(x); } catch { /* reintenta en el siguiente sondeo */ }
      const st = x?.engines?.[eng];
      const job = jobOf(x, eng);
      if (job?.status === "error") { stopWatching(eng); toast(`Falló la instalación de ${label}: ${job.step || "revisa el registro"}`, true); void refresh(); return; }
      if (st?.installed || job?.status === "done") { stopWatching(eng); toast(`${label} instalado`); void refresh(); return; }
      if (Date.now() - started > POLL_MAX_MS) { stopWatching(eng); toast(`La instalación de ${label} sigue sin terminar: vuelve a abrir Ajustes más tarde.`, true); return; }
      setInstalling((m) => (eng in m ? { ...m, [eng]: job?.step || "Instalando…" } : m));
      polls.current[eng] = window.setTimeout(() => { void tick(); }, POLL_MS);
    };
    polls.current[eng] = window.setTimeout(() => { void tick(); }, POLL_MS);
  };
  const hfHas = s.has.hf ?? Boolean(s.hfToken);
  const hfMasked = s.hfToken ? (s.hfToken.includes("…") ? s.hfToken : `hf_…${s.hfToken.slice(-4)}`) : "";
  const curLocalVoice = s.localVoice || "";
  const kokoroDefault = KOKORO_VOICES.some(([v]) => v === curLocalVoice) ? curLocalVoice : "em_alex";
  const chatterboxDefault = KOKORO_VOICES.some(([v]) => v === curLocalVoice) ? "" : curLocalVoice;
  const sayVoices = env?.sayVoices || [];
  const sayDefault = s.sayVoice || "Paulina";

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    const f = new FormData(e.currentTarget);
    const str = (k: string): string => {
      const v = f.get(k);
      return typeof v === "string" ? v : "";
    };
    const models: Record<Provider, Partial<Record<AiStage, string>>> = { anthropic: {}, openai: {} };
    for (const pv of PROVIDERS) for (const [k] of STAGES_AI) models[pv][k] = str(`m_${pv}_${k}`);
    const efforts: Settings["efforts"] = {};
    for (const [k] of STAGES_AI) { const v = str(`e_${k}`); if (v) efforts[k] = v as Settings["effort"]; }
    const customPrices: Record<string, Partial<ModelPrice>> = {};
    for (const line of str("prices").split("\n")) {
      const [m, i, o] = line.trim().split(/\s+/);
      if (m && !isNaN(+i) && !isNaN(+o)) customPrices[m] = { in: +i, out: +o, cacheRead: +i / 10 };
    }
    const body: SettingsUpdate = {
      metaToken: str("metaToken"), graphVersion: str("graphVersion") || undefined,
      studioName: str("studioName"), rawDir: str("rawDir"), brollDir: str("brollDir"),
      provider: str("provider") as Provider, apiKey: str("apiKey"), anthropicWorkspaceId: str("anthropicWorkspaceId"), anthropicAdminKey: str("anthropicAdminKey"), openaiKey: str("openaiKey"), openaiAdminKey: str("openaiAdminKey"), apifyToken: str("apifyToken"),
      elevenlabsKey: str("elevenlabsKey"), elevenVoiceId: str("elevenVoiceId").trim(), elevenTtsModel: str("elevenTtsModel").trim() || "eleven_multilingual_v2", producerModel: str("producerModel").trim() || "claude-opus-5-5",
      audioProvider: aud, localTtsEngine: ttsEng, localVoice: str("localVoice").trim(), sayVoice: str("sayVoice").trim() || sayDefault, hfToken: str("hfToken"),
      credits: { anthropic: str("credit_anthropic"), openai: str("credit_openai") }, hardStop: str("hardStop") === "1", effort: str("effort") as Settings["effort"], cookiesBrowser: str("cookiesBrowser"), models, customPrices, efforts, styleIterateSections: str("styleIterateSections") === "1",
    };
    setSaving(true);
    try {
      await act(() => api("/api/settings", { method: "PUT", body }), "Ajustes guardados");
    } catch { setSaving(false); return; /* el error ya se mostró como notificación */ }
    setDirty(false);
    try { await refresh(); await reload(); } finally { setSaving(false); }
  };

  const onDiscard = () => { void reload(); };

  const motionChecks = ([["playwright", "Playwright"], ["chromium", "Chromium"], ["python", "Python"], ["ffmpeg", "ffmpeg"], ["elevenlabs", "ElevenLabs"]] as const).filter(([k]) => k !== "elevenlabs" || aud === "elevenlabs");
  const ok = <Chip tone="ok">OK</Chip>;
  const missing = <Chip tone="bad">Falta</Chip>;

  return (
    <div className="mx-auto w-full max-w-[880px]">
      <header className="mb-6">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.04em] text-foreground">Ajustes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conecta tu IA, elige el audio y vincula tus cuentas. Nada cambia hasta que guardes.</p>
      </header>

      <form ref={formRef} key={ver} onSubmit={(e) => { void onSubmit(e); }} onInput={checkDirty} onChange={checkDirty}>
        <Tabs value={tab} onValueChange={onTab} className="gap-6">
          <TabsList aria-label="Secciones de ajustes">
            {TABS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id}><Icon aria-hidden="true" />{label}</TabsTrigger>
            ))}
          </TabsList>

          {/* forceMount: las pestañas inactivas siguen en el formulario (ocultas) para que se envíen todos los campos. */}
          {/* ---------------- IA ---------------- */}
          <TabsContent value="ia" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            <Card title="Proveedor de IA" desc="Todo el estudio (análisis, guiones, marca…) usa este proveedor. Puedes cambiarlo cuando quieras.">
              <div role="radiogroup" aria-label="Proveedor de IA" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PROVIDERS.map((p) => (
                  <RadioCard key={p} name="provider" value={p} checked={prov === p} onChange={() => setProv(p)} title={PROV_LABEL[p]} desc={PROV_DESC[p]} />
                ))}
              </div>
              <div>
                <label htmlFor="set-effort" className={labelCls}>Esfuerzo de razonamiento</label>
                <select id="set-effort" name="effort" defaultValue={s.effort} aria-describedby="set-effort-help" className={cn(inputCls, "py-0 sm:max-w-[260px]")}>
                  {EFFORT_OPTS.map(([e, l]) => <option key={e} value={e}>{l}</option>)}
                </select>
                <Help id="set-effort-help">Más esfuerzo da mejores respuestas, pero tarda más y cuesta más por llamada.</Help>
              </div>
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium">Esfuerzo por sección</summary>
                <p className={cn(helpCls, "mt-2 mb-3")}>Cambia el esfuerzo solo donde lo necesites; «General» usa el de arriba. «Rápido» suele bastar para tareas simples (publicación, análisis) y cuesta bastante menos; revisa los resultados antes de dejarlo.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {STAGES_AI.map(([k, label]) => (
                    <div key={k} className="min-w-0">
                      <label htmlFor={`set-e_${k}`} className={cn(labelCls, "text-[12px] text-muted-foreground")}>{label}</label>
                      <select id={`set-e_${k}`} name={`e_${k}`} defaultValue={s.efforts?.[k] || ""} className={cn(inputCls, "py-0")}>
                        <option value="">General</option>
                        {EFFORT_OPTS.map(([e, l]) => <option key={e} value={e}>{l}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-2">
                  <input type="checkbox" id="set-styleSections" name="styleIterateSections" value="1" defaultChecked={Boolean(s.styleIterateSections)} className="mt-1 size-4 accent-[var(--blue)]" aria-describedby="set-styleSections-help" />
                  <div>
                    <label htmlFor="set-styleSections" className="text-sm font-medium">Iterar estilos por secciones (beta)</label>
                    <Help id="set-styleSections-help">Al ajustar un estilo con feedback, la IA devuelve solo las secciones que cambian en vez de reescribir la guía entera: menos tokens de salida, que son los más caros. Compara el resultado antes de dejarlo activado.</Help>
                  </div>
                </div>
              </details>
            </Card>

            {/* Ambas tarjetas siguen dentro del formulario (ocultas con hidden) para que se envíen todos los campos. */}
            <Card title="Claude (Anthropic)" desc="Tus claves de Anthropic. La API key se usa para generar." hidden={prov !== "anthropic"}>
              <SecretField name="apiKey" label="API key" has={s.has.anthropic} placeholder={ph("apiKey", s.has.anthropic, "sk-ant-api03-…")} onClear={onClear} dirty={dirty}
                help="console.anthropic.com → API Keys." />
              <SecretField name="anthropicAdminKey" label="Admin key (gasto real)" has={s.has.anthropicAdmin} placeholder={ph("anthropicAdminKey", s.has.anthropicAdmin, "sk-ant-admin01-…")} onClear={onClear} dirty={dirty}
                help="Opcional. Solo lee los costos de tu organización. console.anthropic.com → Settings → Admin keys." />
              <Advanced>
                <div>
                  <label htmlFor="set-anthropicWorkspaceId" className={labelCls}>Workspace ID (solo si tu key es de organización)</label>
                  <input id="set-anthropicWorkspaceId" name="anthropicWorkspaceId" defaultValue={s.anthropicWorkspaceId || ""} placeholder="wrkspc_…" aria-describedby="set-anthropicWorkspaceId-help" className={cn(inputCls, "font-mono text-[13px]")} />
                  <Help id="set-anthropicWorkspaceId-help">Si Anthropic pide un workspace: console.anthropic.com → Settings → Workspaces → copia el ID (empieza con wrkspc_).</Help>
                </div>
                {modelInputs("anthropic")}
              </Advanced>
            </Card>
            <Card title="OpenAI" desc="Tus claves de OpenAI. La API key se usa para generar." hidden={prov !== "openai"}>
              <SecretField name="openaiKey" label="API key" has={s.has.openai} placeholder={ph("openaiKey", s.has.openai, "sk-proj-…")} onClear={onClear} dirty={dirty}
                help="platform.openai.com → API keys." />
              <SecretField name="openaiAdminKey" label="Admin key (gasto real)" has={s.has.openaiAdmin} placeholder={ph("openaiAdminKey", s.has.openaiAdmin, "sk-admin-…")} onClear={onClear} dirty={dirty}
                help="Opcional. platform.openai.com → Settings → Organization → Admin keys." />
              <Advanced>
                {modelInputs("openai")}
                <div>
                  <label htmlFor="set-prices" className={labelCls}>Precios para el estimado</label>
                  <textarea id="set-prices" name="prices" rows={4} defaultValue={pricesTxt} aria-describedby="set-prices-help"
                    className={cn(inputCls, "h-auto min-h-[96px] py-2 font-mono text-[12px]")} />
                  <Help id="set-prices-help">Una línea por modelo: modelo entrada salida (USD por millón de tokens). Verifica en openai.com/api/pricing. El gasto real viene de la Admin key; esto solo afecta el estimado por llamada.</Help>
                </div>
              </Advanced>
            </Card>

            <Card title="Límite de gasto" desc="Cuánto quieres gastar al mes con el proveedor elegido y qué pasa al llegar al límite.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div hidden={prov !== "anthropic"}>
                  <label htmlFor="set-credit_anthropic" className={labelCls}>Crédito mensual de Claude (USD)</label>
                  <input id="set-credit_anthropic" name="credit_anthropic" type="number" min="0" step="1" inputMode="numeric" defaultValue={s.credits.anthropic} className={inputCls} />
                </div>
                <div hidden={prov !== "openai"}>
                  <label htmlFor="set-credit_openai" className={labelCls}>Crédito mensual de OpenAI (USD)</label>
                  <input id="set-credit_openai" name="credit_openai" type="number" min="0" step="1" inputMode="numeric" defaultValue={s.credits.openai} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="set-hardStop" className={labelCls}>Al agotar el crédito</label>
                  <select id="set-hardStop" name="hardStop" defaultValue={s.hardStop ? "1" : "0"} className={cn(inputCls, "py-0")}>
                    <option value="1">Bloquear llamadas</option>
                    <option value="0">Solo avisar</option>
                  </select>
                </div>
              </div>
            </Card>

            <Card title="Productor (agente)" desc="El agente que dirige cada video. Siempre usa Claude con tu API key de Anthropic, aunque el proveedor general sea OpenAI."
              aside={s.has.anthropic ? <Chip tone="ok">Listo</Chip> : <Chip tone="bad">Falta la API key de Anthropic</Chip>}>
              <Advanced>
                <div>
                  <label htmlFor="set-producerModel" className={labelCls}>Modelo del productor</label>
                  <datalist id="dl_producer">
                    {Object.entries(s.catalog.anthropic).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </datalist>
                  <input id="set-producerModel" name="producerModel" list="dl_producer" defaultValue={s.producerModel || "claude-opus-5-5"} aria-describedby="set-producerModel-help" className={cn(inputCls, "font-mono text-[13px]")} />
                  <Help id="set-producerModel-help">Vacío = claude-opus-5-5.</Help>
                </div>
              </Advanced>
            </Card>
          </TabsContent>

          {/* ---------------- Audio ---------------- */}
          <TabsContent value="audio" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            <Card title="Modo de audio" desc="Cómo el productor genera la voz en off, la música y los efectos de sonido."
              aside={env ? (env.ready ? <Chip tone="ok">Listo</Chip> : <Chip tone="warn">Incompleto</Chip>) : null}>
              <div role="radiogroup" aria-label="Modo de audio" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {AUDIO_MODES.map((m) => (
                  <RadioCard key={m.id} name="audioProvider" value={m.id} checked={aud === m.id} onChange={() => setAud(m.id)} title={m.label} desc={m.desc} />
                ))}
              </div>
              <div aria-live="polite">
                {env ? (
                  <>
                    {env.provider !== aud ? <p className={cn(helpCls, "mt-0")}>Guarda los cambios para aplicar el modo elegido.</p> : null}
                    {env.issues?.length ? <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">{env.issues.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
                  </>
                ) : <p className={cn(helpCls, "mt-0")}>Sin información del audio.</p>}
              </div>
            </Card>

            {/* Los tres bloques siguen en el formulario (ocultos con hidden) para no borrar campos al guardar. */}
            <Card title="ElevenLabs" desc="Música, voz y efectos con ElevenLabs. Cada generación gasta créditos de tu cuenta." hidden={aud !== "elevenlabs"}>
              <SecretField name="elevenlabsKey" label="API key de ElevenLabs" has={s.has.elevenlabs} placeholder={ph("elevenlabsKey", s.has.elevenlabs, "sk_…")} onClear={onClear} dirty={dirty}
                help="elevenlabs.io → Developers → API Keys." />
              <div>
                <label htmlFor="set-elevenVoiceId" className={labelCls}>Voz por defecto (voice id)</label>
                <input id="set-elevenVoiceId" name="elevenVoiceId" defaultValue={s.elevenVoiceId || ""} placeholder="Ej. 21m00Tcm4TlvDq8ikWAM" autoComplete="off" aria-describedby="set-elevenVoiceId-help" className={cn(inputCls, "font-mono text-[13px]")} />
                <Help id="set-elevenVoiceId-help">Cópialo desde tu biblioteca de voces en elevenlabs.io.</Help>
              </div>
              <Advanced>
                <div>
                  <label htmlFor="set-elevenTtsModel" className={labelCls}>Modelo de voz (TTS)</label>
                  <input id="set-elevenTtsModel" name="elevenTtsModel" defaultValue={s.elevenTtsModel || "eleven_multilingual_v2"} placeholder="eleven_multilingual_v2" className={cn(inputCls, "font-mono text-[13px]")} />
                </div>
              </Advanced>
            </Card>

            <Card title="Audio local gratis" desc="Modelos abiertos que corren en tu Mac. Se instalan una vez; no tienen costo por uso." hidden={aud !== "local"}
              aside={env ? <Chip>{ACCEL_LABEL[env.hardware.accel] || env.hardware.accel} · {env.hardware.arch} · {env.hardware.os}</Chip> : null}>
              <div>
                <h3 id="set-engines-label" className="m-0 mb-1 text-[13px] font-medium text-foreground">Motores locales</h3>
                <ul aria-labelledby="set-engines-label" className="m-0 list-none p-0">
                  {ENGINES.map((e) => {
                    const st = env?.engines?.[e.id];
                    const busy = installing[e.id];
                    return (
                      <StatusRow key={e.id}
                        label={<><span className="font-medium">{e.label}</span> <span className="text-[12px] text-muted-foreground">· {e.role}</span></>}
                        note={<>
                          {st?.note ? <span className="block">{st.note}</span> : null}
                          <span aria-live="polite">{busy ? <span className="mt-1 flex flex-wrap items-center gap-2 text-foreground">{busy}
                            <Button type="button" size="xs" variant="ghost" onClick={() => stopWatching(e.id)}>Dejar de esperar</Button></span> : null}</span>
                        </>}>
                        {!st ? <Chip>Sin datos</Chip>
                          : st.installed ? <Chip tone="ok">Instalado</Chip>
                          : !st.supported ? <Chip tone="bad">No compatible</Chip>
                          : (
                            <Button type="button" size="sm" variant="translucent" disabled={Boolean(busy)} onClick={() => { void onInstall(e.id, e.label); }}>
                              {busy ? "Instalando…" : `Instalar${st.sizeHint ? ` (${st.sizeHint})` : ""}`}
                            </Button>
                          )}
                      </StatusRow>
                    );
                  })}
                </ul>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="set-localTtsEngine" className={labelCls}>Motor de voz</label>
                  <select id="set-localTtsEngine" name="localTtsEngine" value={ttsEng} onChange={(e) => setTtsEng(e.target.value === "chatterbox" ? "chatterbox" : "kokoro")} className={cn(inputCls, "py-0")}>
                    <option value="kokoro">Kokoro (rápido, funciona en CPU)</option>
                    <option value="chatterbox">Chatterbox (clona una voz; GPU)</option>
                  </select>
                </div>
                {ttsEng === "kokoro" ? (
                  <div>
                    <label htmlFor="set-localVoice" className={labelCls}>Voz de Kokoro</label>
                    <select key="kokoro" id="set-localVoice" name="localVoice" defaultValue={kokoroDefault} className={cn(inputCls, "py-0")}>
                      {KOKORO_VOICES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="set-localVoice" className={labelCls}>Muestra de voz para clonar (opcional)</label>
                    <input key="chatterbox" id="set-localVoice" name="localVoice" defaultValue={chatterboxDefault} placeholder="~/Voces/mi-voz.wav" autoComplete="off" aria-describedby="set-localVoice-help" className={inputCls} />
                    <Help id="set-localVoice-help">Ruta de un .wav en tu Mac. Vacío = voz base.</Help>
                  </div>
                )}
              </div>
              <Advanced>
                <SecretField name="hfToken" label="Token de Hugging Face (Stable Audio)" has={hfHas} placeholder={hfHas ? hfMasked || "Guardado" : "hf_…"} onClear={onClear} dirty={dirty}
                  help="Solo para Stable Audio Open: acepta su licencia en huggingface.co y crea un token de lectura (Settings → Access Tokens)." />
              </Advanced>
            </Card>

            <Card title="Sintetizado" desc="Voz con el comando say de macOS, música original con el sintetizador del motor y efectos sintetizados. Sin descargas ni costo." hidden={aud !== "sintetizado"}>
              <div>
                <label htmlFor="set-sayVoice" className={labelCls}>Voz de macOS</label>
                <select id="set-sayVoice" name="sayVoice" defaultValue={sayVoices.includes(sayDefault) || !sayVoices.length ? sayDefault : sayVoices[0]} className={cn(inputCls, "py-0 sm:max-w-[320px]")}>
                  {(sayVoices.includes(sayDefault) || !sayVoices.length ? [sayDefault, ...sayVoices.filter((v) => v !== sayDefault)] : sayVoices).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </Card>
          </TabsContent>

          {/* ---------------- Motor de video ---------------- */}
          <TabsContent value="video" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            <Card title="Estado del motor" desc="Lo que el motor necesita para hacer reels, clases y renders con estilo. La voz y la música se configuran en Audio."
              aside={state.motion ? (state.motion.ready ? <Chip tone="ok">Listo</Chip> : <Chip tone="warn">Incompleto</Chip>) : null}>
              {state.motion ? (
                <>
                  <ul className="m-0 list-none p-0" aria-label="Requisitos del motor">
                    {motionChecks.map(([k, label]) => (
                      <StatusRow key={k} label={label}>{state.motion[k] ? ok : missing}</StatusRow>
                    ))}
                  </ul>
                  {state.motion.issues?.length ? <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">{state.motion.issues.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
                </>
              ) : <p className={cn(helpCls, "mt-0")}>Sin información del entorno.</p>}
            </Card>
            <Card title="Herramientas locales" desc="Programas de tu Mac para descargar, transcribir y exportar.">
              <ul className="m-0 list-none p-0" aria-label="Herramientas locales">
                <StatusRow label="ffmpeg">{t.ffmpeg ? ok : missing}</StatusRow>
                <StatusRow label="yt-dlp">{t.ytdlp ? ok : missing}</StatusRow>
                <StatusRow label="Whisper (transcripción)">{t.whisperCpp ? <Chip tone="ok">whisper.cpp</Chip> : t.whisperPy ? <Chip tone="ok">whisper</Chip> : t.whisperCppBinary ? <Chip tone="warn">Falta modelo</Chip> : missing}</StatusRow>
                <StatusRow label="Subtítulos quemados (libass)">{t.subtitlesFilter ? ok : <Chip tone="warn">No, se exporta .srt</Chip>}</StatusRow>
              </ul>
              <p className={cn(helpCls, "mt-0")}>Si algo falta, vuelve a abrir <b className="font-medium text-foreground">Instalar.command</b>. Es seguro repetirlo.</p>
            </Card>
          </TabsContent>

          {/* ---------------- Cuentas y fuentes ---------------- */}
          <TabsContent value="cuentas" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            <Card title="Instagram oficial (gratis)"
              desc={<>API oficial de Meta (Business Discovery). Carga perfil, Reels, likes y comentarios de cuentas <b className="font-medium text-foreground">profesionales</b>. No da vistas de cuentas ajenas: el outlier se calcula con likes y comentarios.</>}
              aside={s.metaIgUserId ? <Chip tone="ok">Conectado como @{s.metaIgUsername || s.metaIgUserId}</Chip> : <Chip>Sin detectar</Chip>}>
              <SecretField name="metaToken" label="Token de acceso de Meta" has={s.has.meta} placeholder={ph("metaToken", s.has.meta, "EAAG…")} onClear={onClear} dirty={dirty}
                help="Cómo obtenerlo: abre la guía de abajo." />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="translucent" disabled={!s.has.meta} onClick={() => { void onDetect().catch(() => {}); }}>Detectar mi cuenta de Instagram</Button>
                {!s.has.meta ? <span className="text-[12px] text-muted-foreground">Guarda el token primero.</span> : null}
              </div>
              {found ? (
                <div role="group" aria-labelledby="set-ig-pick">
                  <p id="set-ig-pick" className={labelCls}>Elige tu cuenta</p>
                  <div className="flex flex-wrap gap-2">
                    {found.map((x) => (
                      <Button key={x.id} type="button" size="sm" variant="translucent" onClick={() => { void onPick(x); }}>@{x.username} · {x.page}</Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <Advanced label="Guía: conseguir el token (10 min, una vez)">
                <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed text-muted-foreground">
                  <li>Tu @ en Instagram debe ser cuenta <b className="font-medium text-foreground">profesional</b> (Configuración → Tipo de cuenta) y estar vinculada a una <b className="font-medium text-foreground">Página de Facebook</b>.</li>
                  <li>Entra a <b className="font-medium text-foreground">developers.facebook.com</b> → Mis apps → Crear app (tipo “Empresa”).</li>
                  <li>Abre <b className="font-medium text-foreground">Herramientas → Explorador de la API Graph</b>, elige tu app y pide los permisos: <code>instagram_basic</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>business_management</code>.</li>
                  <li>“Generar token de acceso”, acepta, copia el token y pégalo arriba. Guarda y pulsa “Detectar”.</li>
                  <li>Para que no caduque en 1 hora: en <b className="font-medium text-foreground">Herramientas → Depurador de tokens</b> pulsa “Ampliar token de acceso” (dura ~60 días) y pega ese.</li>
                </ol>
              </Advanced>
              <Advanced>
                <div>
                  <label htmlFor="set-graphVersion" className={labelCls}>Versión de la API Graph</label>
                  <input id="set-graphVersion" name="graphVersion" defaultValue={s.graphVersion || "v23.0"} className={cn(inputCls, "max-w-[140px] font-mono text-[13px]")} />
                </div>
              </Advanced>
            </Card>

            <Card title="Otras fuentes de perfiles" desc="YouTube Shorts funciona sin nada de esto.">
              <SecretField name="apifyToken" label="Token de Apify" has={s.has.apify} placeholder={ph("apifyToken", s.has.apify, "apify_api_…")} onClear={onClear} dirty={dirty}
                help={<>Opcional y de pago: trae <b className="font-medium text-foreground">vistas</b> reales de Instagram y TikTok de cualquier cuenta. Si conectas Instagram oficial, Instagram usa la oficial.</>} />
              <div>
                <label htmlFor="set-cookiesBrowser" className={labelCls}>Cookies del navegador</label>
                <select id="set-cookiesBrowser" name="cookiesBrowser" defaultValue={s.cookiesBrowser} aria-describedby="set-cookiesBrowser-help" className={cn(inputCls, "py-0 sm:max-w-[260px]")}>
                  {["", "chrome", "safari", "firefox", "brave", "edge"].map((b) => <option key={b} value={b}>{b || "No usar"}</option>)}
                </select>
                <Help id="set-cookiesBrowser-help">Respaldo con yt-dlp y para descargar videos.</Help>
              </div>
            </Card>
          </TabsContent>

          {/* ---------------- General ---------------- */}
          <TabsContent value="general" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
            <Card title="Tu estudio" desc="El nombre y las carpetas de tu Mac donde están tus videos.">
              <div>
                <label htmlFor="set-studioName" className={labelCls}>Nombre de tu estudio</label>
                <input id="set-studioName" name="studioName" defaultValue={s.studioName || ""} placeholder="Mi estudio" className={inputCls} />
              </div>
              <div>
                <label htmlFor="set-rawDir" className={labelCls}>Carpeta de videos crudos</label>
                <input id="set-rawDir" name="rawDir" defaultValue={s.rawDir || ""} placeholder={state.rawDir || "~/Movies"} aria-describedby="set-dirs-help" className={cn(inputCls, "font-mono text-[13px]")} />
              </div>
              <div>
                <label htmlFor="set-brollDir" className={labelCls}>Carpeta de B-roll (opcional)</label>
                <input id="set-brollDir" name="brollDir" defaultValue={s.brollDir || ""} placeholder="~/Movies/BROLL" aria-describedby="set-dirs-help" className={cn(inputCls, "font-mono text-[13px]")} />
                <Help id="set-dirs-help">Rutas de tu Mac, ej. <code>~/Movies/Crudos</code>. Vacío = usar la carpeta por defecto.</Help>
              </div>
            </Card>
            <Card title="Marca" desc="Las guías de marca viven en su propia sección.">
              <div>
                <a href="#/branding" className={buttonVariants({ variant: "translucent", size: "sm" })}>Ir a Marca <ArrowRight aria-hidden="true" /></a>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Barra fija de guardado: solo con cambios sin guardar. Va dentro del formulario para enviar con "Guardar cambios". */}
        <div aria-live="polite" className="sticky bottom-0 z-10 mt-6">
          {dirty ? (
            <div role="region" aria-label="Cambios sin guardar" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/95 px-4 py-3 shadow-lift backdrop-blur motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
              <p className="m-0 text-sm font-medium text-foreground">Tienes cambios sin guardar</p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" disabled={saving} onClick={onDiscard}>Descartar</Button>
                <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
              </div>
            </div>
          ) : null}
        </div>
      </form>

    </div>
  );
}
