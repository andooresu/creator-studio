// Red de seguridad de las pantallas que se cargan por partes (lazy): si una parte no se puede descargar
// (p. ej. después de «Actualizar», cuando la pestaña abierta pide archivos de la versión anterior), recarga
// la página una vez; si vuelve a fallar, muestra un aviso con un botón para recargar en vez de dejar la app en blanco.
import { Component, lazy, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";

const RELOAD_KEY = "andoo:chunk-reload";

function isChunkError(e: unknown): boolean {
  const m = String((e as Error)?.message || e);
  return /dynamically imported module|Failed to fetch|Importing a module script failed|error loading dynamically|ChunkLoadError/i.test(m);
}

/** lazy() que recarga la página una sola vez si falla la descarga de la parte. */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await load();
      try { sessionStorage.removeItem(RELOAD_KEY); } catch {}
      return m;
    } catch (e) {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem(RELOAD_KEY) === "1"; } catch {}
      if (isChunkError(e) && !reloaded) {
        try { sessionStorage.setItem(RELOAD_KEY, "1"); } catch {}
        location.reload();
        return await new Promise<{ default: T }>(() => {}); // la página se está recargando
      }
      throw e;
    }
  });
}

/** lazy() para diálogos: nunca recarga sola (podría interrumpir cambios sin guardar); si falla, lanza el error
 *  para que OverlayBoundary cierre el diálogo y avise. */
export function lazyOverlay<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let cached: Promise<{ default: T }> | null = null;
  const get = () => (cached ||= load().catch((e) => { cached = null; throw e; }));
  return { Component: lazy(get), preload: () => { void get().catch(() => {}); } };
}

/** Para diálogos que se cargan por partes (⌘K, Nuevo video): si fallan, se cierran sin tumbar la app. */
export class OverlayBoundary extends Component<{ children: ReactNode; onError?: (e: unknown) => void }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(e: unknown) { this.props.onError?.(e); }
  render() { return this.state.error ? null : this.props.children; }
}

export class RouteBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkError(this.state.error);
    return (
      <div role="alert" className="mx-auto mt-16 grid max-w-md gap-3 rounded-xl bg-surface-1 p-6 text-center">
        <h2 className="m-0 text-[19px] font-semibold tracking-[-0.03em]">{chunk ? "Hay una versión nueva de Andoo" : "Esta pantalla no se pudo abrir"}</h2>
        <p className="m-0 text-sm text-muted-foreground">{chunk ? "Recarga para usar la versión actualizada. Tus proyectos no se pierden." : String((this.state.error as Error)?.message || this.state.error)}</p>
        <div><Button onClick={() => location.reload()}>Recargar</Button></div>
      </div>
    );
  }
}
