// Buscador ⌘K (Ctrl K en Windows/Linux): acciones, pantallas, proyectos y estilos sin navegar.
import { BarChart3, Film, Home, Palette, Plus, Settings, Sparkles, Clapperboard, GraduationCap, Mic } from "lucide-react";
import { useApp } from "@/store.tsx";
import { projectStatus } from "@/components/AppSidebar.tsx";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command.tsx";

// Se descarga la primera vez que abres el buscador (el atajo vive en CommandHotkey, en el paquete principal).
export default function CommandMenu() {
  const { state, navigate, openNewProject, commandOpen, setCommandOpen } = useApp();

  const go = (hash: string) => { setCommandOpen(false); navigate(hash); };

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Buscar en Andoo" description="Busca proyectos, estilos, pantallas y acciones">
      <CommandInput aria-label="Buscar en Andoo" placeholder="Busca un proyecto, un estilo o una acción…" />
      <CommandList aria-label="Resultados">
        <CommandEmpty>No encontré nada con ese nombre.</CommandEmpty>
        <CommandGroup heading="Crear">
          <CommandItem value="nuevo video reel comercial" onSelect={() => openNewProject({ kind: "reel" })}><Clapperboard />Nuevo reel animado</CommandItem>
          <CommandItem value="nuevo video a camara talking head" onSelect={() => openNewProject({ kind: "talking" })}><Mic />Nuevo video a cámara</CommandItem>
          <CommandItem value="nueva clase explicador" onSelect={() => openNewProject({ kind: "clase" })}><GraduationCap />Nueva clase o explicador</CommandItem>
          <CommandItem value="nuevo estilo crear estilo" onSelect={() => go("#/estilos")}><Plus />Crear un estilo</CommandItem>
          <CommandItem value="nueva marca guia de marca branding" onSelect={() => go("#/branding")}><Palette />Crear una guía de marca</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Ir a">
          <CommandItem value="inicio tablero" onSelect={() => go("#/")}><Home />Inicio</CommandItem>
          <CommandItem value="estilos galeria" onSelect={() => go("#/estilos")}><Sparkles />Estilos</CommandItem>
          <CommandItem value="marca branding" onSelect={() => go("#/branding")}><Palette />Marca</CommandItem>
          <CommandItem value="uso de ia costos gasto" onSelect={() => go("#/uso")}><BarChart3 />Uso de IA</CommandItem>
          <CommandItem value="ajustes configuracion api key clave" onSelect={() => go("#/ajustes")}><Settings />Ajustes<CommandShortcut>claves, audio, motor</CommandShortcut></CommandItem>
        </CommandGroup>
        {state?.projects.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Proyectos">
              {state.projects.map((p) => (
                <CommandItem key={p.id} value={`proyecto ${p.title} ${p.id}`} onSelect={() => go(`#/p/${p.id}`)}>
                  <Film />
                  <span className="truncate">{p.title}</span>
                  <CommandShortcut>{projectStatus(p).label}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        {state?.styles.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Estilos">
              {state.styles.map((s) => (
                <CommandItem key={s.id} value={`estilo ${s.name} ${s.id}`} onSelect={() => go(`#/estilos/${s.id}`)}>
                  <Sparkles />
                  <span className="truncate">{s.name}</span>
                  <CommandShortcut>{s.origin === "base" ? "incluido" : "tuyo"}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
