// Contrato entre ProjectView (contenedor) y cada etapa del proyecto.
// ProjectView carga el proyecto, sondea mientras hay un trabajo corriendo y pasa estas props.
import type { Project, Stage } from "../../../../shared/types.ts";

export interface StageProps {
  /** Proyecto actual (siempre fresco: ProjectView lo reemplaza tras cada acción o sondeo). */
  p: Project;
  /** true mientras hay un trabajo en segundo plano corriendo en este proyecto. */
  running: boolean;
  /**
   * POST /api/projects/:id/<path> con body opcional; actualiza el proyecto con la respuesta,
   * refresca el estado global y muestra okMsg. Devuelve el proyecto de la respuesta. Lanza (y notifica) si falla.
   */
  run: (path: string, body?: unknown, okMsg?: string) => Promise<Project | undefined>;
  /** Reemplaza el proyecto local (p. ej. tras un PUT/PATCH/DELETE hecho por la etapa). */
  setProject: (p: Project) => void;
  /** Cambia la etapa que se está viendo (sin cambiar la etapa real del proyecto). */
  goStage: (s: Stage) => void;
}
