// Estado global de la app: estado del servidor (/api/state), avisos (Sonner), navegación por hash,
// el diálogo «Nuevo video» y el buscador ⌘K (se abren desde cualquier pantalla).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast as sonner } from "sonner";
import type { AppState, ProjectKind, ProjectSummary } from "../../shared/types.ts";
import { api } from "./api.ts";

export interface Route { name: "dashboard" | "project" | "branding" | "usage" | "settings" | "inspiration" | "styles"; id?: string; sub?: string }

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "p": return { name: "project", id: parts[1], sub: parts[2] };
    case "branding": return { name: "branding", id: parts[1] };
    case "uso": return { name: "usage" };
    case "ajustes": return { name: "settings" };
    case "estilos": return { name: "styles", id: parts[1] };
    case "inspiracion": return { name: "inspiration", sub: parts[1] };
    default: return { name: "dashboard" };
  }
}

export interface NewProjectRequest { title?: string; kind?: ProjectKind; styleId?: string }

// ---------- Actualizaciones en vivo ----------
// Una sola conexión (Server-Sent Events) a /api/events. El servidor solo dice qué cambió ("projects:<id>",
// "styles", "jobs"…); cada pantalla vuelve a pedir lo suyo. Si la conexión se cae, se vuelve al sondeo de antes.
type LiveSub = (keys: string[]) => void;
const liveSubs = new Set<LiveSub>();
const liveStatusSubs = new Set<() => void>();
let liveConnected = false;
let liveSource: EventSource | null = null;
const setLive = (v: boolean) => { if (liveConnected !== v) { liveConnected = v; liveStatusSubs.forEach((f) => f()); } };
let liveRetry: ReturnType<typeof setTimeout> | undefined;
let liveBackoff = 2000;
let liveWanted = false;
function stopLive() {
  if (liveRetry) { clearTimeout(liveRetry); liveRetry = undefined; }
  liveSource?.close();
  liveSource = null;
  setLive(false);
}
function startLive() {
  liveWanted = true;
  // pestaña oculta: sin conexión abierta (el navegador solo permite ~6 por servidor entre todas las pestañas)
  if (liveSource || typeof EventSource === "undefined" || document.hidden) return;
  const es = new EventSource("/api/events");
  liveSource = es;
  es.addEventListener("hello", () => {
    setLive(true);
    liveBackoff = 2000;
    // al conectar o reconectar (carga, servidor reiniciado, pestaña que vuelve) pudo perderse algo: que todos recarguen
    liveSubs.forEach((f) => f(["*"]));
  });
  es.addEventListener("change", (e) => {
    let keys: string[] = [];
    try { keys = (JSON.parse((e as MessageEvent).data) as { keys: string[] }).keys || []; } catch { return; }
    liveSubs.forEach((f) => f(keys));
  });
  es.onerror = () => {
    setLive(false);
    // un error de red se reintenta solo; una respuesta HTTP de error (p. ej. el proxy de Vite con el servidor caído)
    // cierra la conexión para siempre: se vuelve a abrir con espera creciente
    if (es.readyState === EventSource.CLOSED && liveSource === es) {
      liveSource = null;
      if (!liveRetry) liveRetry = setTimeout(() => { liveRetry = undefined; startLive(); }, liveBackoff);
      liveBackoff = Math.min(liveBackoff * 2, 30000);
    }
  };
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLive();
    else if (liveWanted) startLive();
  });
}
/** ¿Alguna clave cambiada corresponde a estos temas? "projects" cubre "projects:<id>". */
export function liveMatch(keys: string[], topics: string[]): boolean {
  return keys.includes("*") || topics.some((t) => t === "*" || keys.some((k) => k === t || k.startsWith(t + ":")));
}
/** true mientras la conexión en vivo está abierta */
export function useLiveConnected(): boolean {
  return useSyncExternalStore((cb) => { liveStatusSubs.add(cb); return () => { liveStatusSubs.delete(cb); }; }, () => liveConnected, () => false);
}
/** Llama fn cuando cambie algo de `topics` (sin solaparse y como mucho una vez cada `gap` ms). */
export function useLive(topics: string[] | null, fn: () => void | Promise<void>, active = true, gap = 400) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = topics ? topics.join("|") : "";
  useEffect(() => {
    if (!active || !key) return;
    startLive();
    const tp = key.split("|");
    let alive = true, busy = false, again = false, last = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (!alive) return;
      if (busy) { again = true; return; }
      const wait = last + gap - Date.now();
      if (wait > 0) { if (!t) t = setTimeout(() => { t = undefined; void run(); }, wait); return; }
      busy = true; last = Date.now();
      try { await ref.current(); } catch { /* la pantalla muestra su propio error */ } finally {
        busy = false;
        if (again && alive) { again = false; void run(); }
      }
    };
    const sub: LiveSub = (keys) => { if (liveMatch(keys, tp)) void run(); };
    liveSubs.add(sub);
    return () => { alive = false; liveSubs.delete(sub); if (t) clearTimeout(t); };
  }, [key, active, gap]);
}

// ---------- Cambios sin guardar ----------
// Una pantalla con cambios sin guardar registra un guardia (useLeaveGuard). Cualquier navegación dentro de la app
// (enlaces, ⌘K, avisos, Atrás/Adelante del navegador) pasa por "hashchange": si hay guardia, se vuelve a la URL
// anterior y se pregunta antes de salir. Al cerrar o recargar la pestaña avisa el navegador (beforeunload).
type LeaveGuard = { id: number; message: string };
let guards: LeaveGuard[] = [];
let guardSeq = 0;
const guardListeners = new Set<() => void>();
const emitGuards = () => guardListeners.forEach((f) => f());
export function hasLeaveGuard(): boolean { return guards.length > 0; }

/** Mientras `dirty` sea true, salir de la pantalla pide confirmación. */
export function useLeaveGuard(dirty: boolean, message = "Tienes cambios sin guardar. Si sales, se pierden.") {
  useEffect(() => {
    if (!dirty) return;
    const g = { id: ++guardSeq, message };
    guards = [...guards, g];
    emitGuards();
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);
    return () => { guards = guards.filter((x) => x.id !== g.id); emitGuards(); window.removeEventListener("beforeunload", onUnload); };
  }, [dirty, message]);
}

interface Ctx {
  state: AppState | null;
  refresh: () => Promise<void>;
  route: Route;
  /** discard: los cambios sin guardar ya no importan (p. ej. se borró lo que se editaba): navega sin preguntar */
  navigate: (hash: string, opts?: { discard?: boolean }) => void;
  toast: (msg: string, err?: boolean) => void;
  /** Ejecuta una acción mostrando su error como notificación; devuelve el resultado o lanza. */
  act: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T>;
  /** Diálogo «Nuevo video» (uno para toda la app). */
  newProject: NewProjectRequest | null;
  openNewProject: (req?: NewProjectRequest) => void;
  closeNewProject: () => void;
  /** Navegación bloqueada por cambios sin guardar: destino pendiente y mensaje (lo muestra LeaveDialog). */
  pendingLeave: { target: string; message: string } | null;
  confirmLeave: () => void;
  cancelLeave: () => void;
  /** Buscador ⌘K. */
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp fuera de AppProvider");
  return c;
}

/** Nombre corto de la app (marca) y nombre completo (título de la ventana). */
export const APP_NAME = "Andoo";
export const APP_FULL_NAME = "Andoo CreatorStudio";

const isLive = (p: ProjectSummary): boolean => p.job?.status === "running" || p.productionStatus === "running";

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [newProject, setNewProject] = useState<NewProjectRequest | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ target: string; message: string } | null>(null);
  const currentHash = useRef(location.hash);
  const bypass = useRef(false);
  const prevProjects = useRef<Map<string, ProjectSummary> | null>(null);

  const navigate = useCallback((hash: string, opts?: { discard?: boolean }) => {
    if (opts?.discard && guards.length) {
      guards = []; emitGuards();
      // bypass solo si habrá hashchange que lo consuma (si no, quedaría activo para la próxima navegación)
      if (location.hash !== hash) bypass.current = true;
    }
    location.hash = hash;
  }, []);

  // aviso neutro por defecto ("Subiendo…", "Copiado"); los de acción terminada pasan por act(okMsg) → éxito
  const toast = useCallback((msg: string, err = false) => {
    if (err) sonner.error(msg); else sonner(msg);
  }, []);

  // Avisos de trabajos que terminan aunque estés en otra pantalla (proyecto que estaba trabajando y ya no).
  const notifyTransitions = useCallback((projects: ProjectSummary[]) => {
    const prev = prevProjects.current;
    prevProjects.current = new Map(projects.map((p) => [p.id, p]));
    if (!prev) return;
    const here = parseHash(location.hash);
    for (const p of projects) {
      const before = prev.get(p.id);
      if (!before || here.name === "project" && here.id === p.id) continue; // en su propia pantalla ya se ve
      const open = { label: "Ver", onClick: () => navigate(`#/p/${p.id}`) };
      if (before.productionStatus !== "waiting" && p.productionStatus === "waiting") {
        sonner.warning(`${p.title}: el productor necesita tu respuesta`, { action: open, duration: 10000 });
      } else if (isLive(before) && !isLive(p)) {
        const failed = p.job?.status === "error" || p.productionStatus === "error";
        if (failed) sonner.error(`${p.title}: algo falló`, { description: p.job?.step, action: open, duration: 10000 });
        else sonner.success(`${p.title}: listo`, { action: open, duration: 8000 });
      }
    }
  }, [navigate]);

  const refresh = useCallback(async () => {
    const s = await api<AppState>("/api/state");
    setState(s);
    notifyTransitions(s.projects);
    document.title = s.studioName && s.studioName !== APP_FULL_NAME ? `${APP_NAME} · ${s.studioName}` : APP_FULL_NAME;
  }, [notifyTransitions]);

  const act = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T> => {
    try {
      const r = await fn();
      if (okMsg) sonner.success(okMsg);
      return r;
    } catch (e) {
      toast((e as Error).message, true);
      throw e;
    }
  }, [toast]);

  const pendingRef = useRef(pendingLeave);
  pendingRef.current = pendingLeave;
  const confirmLeave = useCallback(() => {
    const p = pendingRef.current;
    setPendingLeave(null);
    if (!p) return;
    guards = []; emitGuards(); bypass.current = true;
    location.hash = p.target;
  }, []);
  const cancelLeave = useCallback(() => setPendingLeave(null), []);

  const openNewProject = useCallback((req: NewProjectRequest = {}) => { setCommandOpen(false); setNewProject(req); }, []);
  const closeNewProject = useCallback(() => setNewProject(null), []);

  useEffect(() => {
    const onHash = () => {
      // con cambios sin guardar: vuelve a la URL anterior (sin disparar otro hashchange) y pregunta
      if (!bypass.current && guards.length && location.hash !== currentHash.current) {
        const target = location.hash || "#/";
        history.replaceState(null, "", currentHash.current || "#/");
        setPendingLeave({ target, message: guards[guards.length - 1].message });
        return;
      }
      bypass.current = false;
      currentHash.current = location.hash;
      setRoute(parseHash(location.hash));
    };
    window.addEventListener("hashchange", onHash);
    refresh().catch(() => {});
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);
  // estado general: en vivo cuando cambia algo (no el avance paso a paso de un trabajo), como mucho cada 4 s;
  // un trabajo que empieza o termina sí avisa (jobs:status). Con conexión, además cada 30 s (herramientas recién
  // instaladas no generan aviso); sin conexión, cada 15 s.
  useLive(["projects", "brandGuides", "styles", "kv", "usage", "jobs:status"], refresh, true, 4000);
  const connected = useLiveConnected();
  usePoll(refresh, connected ? 30000 : 15000, true);

  const value = useMemo<Ctx>(() => ({
    state, refresh, route, navigate, toast, act, newProject, openNewProject, closeNewProject, commandOpen, setCommandOpen,
    pendingLeave, confirmLeave, cancelLeave,
  }), [state, refresh, route, navigate, toast, act, newProject, openNewProject, closeNewProject, commandOpen, pendingLeave, confirmLeave, cancelLeave]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Mientras `active`: con `topics`, se actualiza en vivo cuando cambian (y cada 30 s por si acaso);
 *  sin conexión en vivo (o sin `topics`), llama fn cada `ms` como antes. */
export function usePoll(fn: () => void | Promise<void>, ms: number, active: boolean, topics?: string[]) {
  const ref = useRef(fn);
  ref.current = fn;
  const connected = useLiveConnected();
  useLive(topics || null, fn, active, Math.min(400, ms));
  const every = topics && connected ? Math.max(ms, 30000) : ms;
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => { void ref.current(); }, every);
    return () => clearInterval(iv);
  }, [every, active]);
}
