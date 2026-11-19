import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css"; // incluye styles.css en la capa «legacy»
import { AppProvider, useApp } from "./store.tsx";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { CommandHotkey, NewProjectDialog } from "./components/CommandHotkey.tsx";
import { LeaveDialog } from "./components/LeaveDialog.tsx";
import { AndooWordmark } from "./components/brand/AndooMark.tsx";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./components/ui/sidebar.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { OverlayBoundary, RouteBoundary, lazyPage } from "./components/RouteBoundary.tsx";

// Cada pantalla se descarga cuando la abres (Inicio va en el paquete principal).
const ProjectView = lazyPage(() => import("./pages/ProjectView.tsx").then((m) => ({ default: m.ProjectView })));
const Branding = lazyPage(() => import("./pages/Branding.tsx").then((m) => ({ default: m.Branding })));
const Usage = lazyPage(() => import("./pages/Usage.tsx").then((m) => ({ default: m.Usage })));
const SettingsPage = lazyPage(() => import("./pages/Settings.tsx").then((m) => ({ default: m.SettingsPage })));
const Inspiration = lazyPage(() => import("./pages/Inspiration.tsx").then((m) => ({ default: m.Inspiration })));
const Styles = lazyPage(() => import("./pages/Styles.tsx").then((m) => ({ default: m.Styles })));

function PageSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-8 w-64 rounded-lg" />
      <Skeleton className="h-4 w-96 max-w-full rounded-md" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[9/16] rounded-xl" />)}
      </div>
    </div>
  );
}

function Router() {
  const { route } = useApp();
  switch (route.name) {
    case "project": return <ProjectView key={route.id} id={route.id!} sub={route.sub} />;
    case "branding": return <Branding key={route.id || "nueva"} bid={route.id} />;
    case "styles": return <Styles sid={route.id} />;
    case "usage": return <Usage />;
    case "settings": return <SettingsPage />;
    case "inspiration": return <Inspiration beta={route.sub === "beta"} />;
    default: return <Dashboard />;
  }
}

function App() {
  const { newProject, closeNewProject, toast } = useApp();
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          {/* en el teléfono la barra lateral se abre desde aquí */}
          <header className="no-print sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-sidebar-border bg-background/90 px-3 backdrop-blur md:hidden">
            <SidebarTrigger aria-label="Abrir menú" />
            <a href="#/" aria-label="Andoo, ir a Inicio"><AndooWordmark size={20} /></a>
          </header>
          <div className="view" id="contenido"><RouteBoundary resetKey={location.hash}><Suspense fallback={<PageSkeleton />}><Router /></Suspense></RouteBoundary></div>
        </SidebarInset>
      </SidebarProvider>
      <CommandHotkey />
      <LeaveDialog />
      {newProject ? <OverlayBoundary key={JSON.stringify(newProject)} onError={() => { closeNewProject(); toast("No se pudo abrir «Nuevo video». Si acabas de actualizar Andoo, recarga la página.", true); }}><Suspense fallback={null}><NewProjectDialog initialTitle={newProject.title} initialKind={newProject.kind} initialStyleId={newProject.styleId} onClose={closeNewProject} /></Suspense></OverlayBoundary> : null}
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider><App /></AppProvider>
  </StrictMode>,
);
