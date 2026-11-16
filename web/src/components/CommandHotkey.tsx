// Atajo ⌘K / Ctrl K. El buscador en sí (cmdk) se descarga solo la primera vez que se abre.
import { Suspense, useEffect, useState } from "react";
import { useApp } from "@/store.tsx";
import { lazyOverlay, OverlayBoundary } from "./RouteBoundary.tsx";

const cmd = lazyOverlay(() => import("./CommandMenu.tsx"));
const nuevo = lazyOverlay(() => import("./NewProject.tsx").then((m) => ({ default: m.NewProjectDialog })));
/** Diálogo «Nuevo video» (se precarga junto con el buscador). */
export const NewProjectDialog = nuevo.Component;

export function CommandHotkey() {
  const { newProject, commandOpen, setCommandOpen, toast } = useApp();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (commandOpen) setLoaded(true); }, [commandOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // con otro diálogo abierto (Nuevo video, teleprompter…) no se apila el buscador encima
        if (!commandOpen && (newProject || document.querySelector('[aria-modal="true"], .prompter'))) return;
        setCommandOpen(!commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen, newProject]);
  // precarga en tiempo libre para que la primera apertura sea instantánea
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const pre = () => { cmd.preload(); nuevo.preload(); };
    const t = idle ? idle(pre) : window.setTimeout(pre, 3000);
    return () => { if (!idle) clearTimeout(t); };
  }, []);
  return loaded ? (
    <OverlayBoundary onError={() => { setCommandOpen(false); setLoaded(false); toast("No se pudo abrir el buscador. Si acabas de actualizar Andoo, recarga la página.", true); }}>
      <Suspense fallback={null}><cmd.Component /></Suspense>
    </OverlayBoundary>
  ) : null;
}
