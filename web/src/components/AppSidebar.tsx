// Barra lateral única de Andoo: marca, «Nuevo video», buscador ⌘K, navegación, proyectos recientes y,
// abajo, el uso de IA del mes y Ajustes. Se contrae a íconos (⌘B) y en el teléfono es un panel deslizable.
import { Film, Home, Palette, Plus, Search, Settings, Sparkles, BarChart3 } from "lucide-react";
import type { ProjectSummary } from "../../../shared/types.ts";
import { useApp } from "@/store.tsx";
import { money, PROV_LABEL, STAGE_LABEL, PROD_STATUS_LABEL } from "@/ui.tsx";
import { AndooWordmark, AndooMark } from "@/components/brand/AndooMark.tsx";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar.tsx";
import { cn } from "@/lib/utils.ts";

const NAV = [
  { href: "#/", match: "dashboard", label: "Inicio", icon: Home },
  { href: "#/estilos", match: "styles", label: "Estilos", icon: Sparkles },
  { href: "#/branding", match: "branding", label: "Marca", icon: Palette },
  { href: "#/uso", match: "usage", label: "Uso de IA", icon: BarChart3 },
] as const;

/** Estado de un proyecto en una palabra + color. */
export function projectStatus(p: ProjectSummary): { label: string; tone: "live" | "wait" | "ok" | "bad" | "idle" } {
  const motion = p.kind === "reel" || p.kind === "clase";
  if (p.job?.status === "error" || p.productionStatus === "error") return { label: "Algo falló", tone: "bad" };
  if (p.productionStatus === "waiting") return { label: "Te necesita", tone: "wait" };
  if (p.job?.status === "running" || p.productionStatus === "running") return { label: "Trabajando", tone: "live" };
  if (motion) return { label: PROD_STATUS_LABEL[p.productionStatus || "idle"], tone: p.productionStatus === "done" ? "ok" : "idle" };
  return { label: STAGE_LABEL[p.stage], tone: p.stage === "publicado" ? "ok" : "idle" };
}

const TONE_DOT: Record<ReturnType<typeof projectStatus>["tone"], string> = {
  live: "bg-blue animate-pulse", wait: "bg-warning", ok: "bg-success", bad: "bg-danger", idle: "bg-ink-faint",
};

function UsageMeter() {
  const { state } = useApp();
  const { state: sb } = useSidebar();
  const u = state?.usage;
  if (!u || sb === "collapsed") return null;
  const pct = u.credit ? Math.min(100, (u.spent / u.credit) * 100) : 0;
  const bar = pct > 90 ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-foreground";
  return (
    <a href="#/uso" className="block rounded-lg bg-surface-1 p-3 text-[12px] transition-colors hover:bg-surface-2" aria-label="Ver uso de IA">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">IA este mes · {PROV_LABEL[u.provider]}</span>
        <b className="tabular-nums">{money(u.spent)}</b>
      </div>
      {u.credit ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className={cn("h-full rounded-full", bar)} style={{ width: `${pct}%` }} /></div>
          <div className="mt-1.5 text-muted-foreground">Quedan {money(Math.max(0, u.remaining ?? 0))}{u.source === "proveedor" ? "" : " (estimado)"}</div>
        </>
      ) : null}
      {/* con Claude como proveedor, el gasto en imágenes va a la clave de OpenAI: se muestra aparte, no se suma */}
      {u.provider !== "openai" && (u.imagesSpent ?? 0) > 0 ? (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-muted-foreground">
          <span>Imágenes · OpenAI</span><span className="tabular-nums">{money(u.imagesSpent ?? 0)}</span>
        </div>
      ) : null}
    </a>
  );
}

export function AppSidebar() {
  const { state, route, openNewProject, setCommandOpen } = useApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const projects = state?.projects || [];
  const close = () => { if (isMobile) setOpenMobile(false); };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <Sidebar collapsible="icon">
      <nav aria-label="Menú principal" className="flex min-h-0 flex-1 flex-col">
      <SidebarHeader className="gap-3 pt-3">
        <a href="#/" onClick={close} className="flex h-8 items-center gap-2 px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0" aria-label="Andoo, ir a Inicio">
          <span className="group-data-[collapsible=icon]:hidden"><AndooWordmark size={22} /></span>
          <span className="hidden group-data-[collapsible=icon]:block"><AndooMark size={22} /></span>
        </a>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Nuevo video" onClick={() => { close(); openNewProject(); }}
              className="h-9 justify-center rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground active:scale-[0.97]">
              <Plus /><span>Nuevo video</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Buscar (⌘K)" onClick={() => { close(); setCommandOpen(true); }} className="text-muted-foreground">
              <Search /><span>Buscar</span>
              <kbd className="ml-auto rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => (
                <SidebarMenuItem key={n.href}>
                  <SidebarMenuButton asChild tooltip={n.label} isActive={route.name === n.match}>
                    <a href={n.href} onClick={close}><n.icon /><span>{n.label}</span></a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Proyectos</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0 overflow-y-auto">
            {projects.length ? (
              <SidebarMenu>
                {projects.map((p) => {
                  const st = projectStatus(p);
                  return (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton asChild isActive={route.name === "project" && route.id === p.id} className="h-auto py-1.5">
                        <a href={`#/p/${p.id}`} onClick={close} title={`${p.title} · ${st.label}`}>
                          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[st.tone])} aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{p.title}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{st.label}</span>
                          </span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : (
              <p className="px-2 text-[12px] text-muted-foreground">Aún no tienes proyectos. Empieza con «Nuevo video».</p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
        {/* con la barra contraída, los proyectos se abren desde ⌘K */}
        <SidebarGroup className="hidden group-data-[collapsible=icon]:block">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Proyectos (⌘K)" onClick={() => setCommandOpen(true)}><Film /><span>Proyectos</span></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 pb-3">
        <UsageMeter />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Ajustes" isActive={route.name === "settings"}>
              <a href="#/ajustes" onClick={close}><Settings /><span>Ajustes</span></a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </nav>
    </Sidebar>
  );
}
