// Chips de links de referencia: detección de URLs en texto pegado, plataforma según el dominio
// y la ficha visual (pendiente o guardada) que usa la etapa de Referencias.
import type { ReactNode } from "react";
import { Camera, Clapperboard, Globe, Paperclip, Play, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils";

export interface Platform { label: string; Icon: LucideIcon }

// Dominio → plataforma (lucide ya no trae íconos de marca: usamos genéricos + el nombre)
const PLATFORMS: { test: RegExp; label: string; Icon: LucideIcon }[] = [
  { test: /(^|\.)instagram\.com$|(^|\.)instagr\.am$/, label: "Instagram", Icon: Camera },
  { test: /(^|\.)tiktok\.com$/, label: "TikTok", Icon: Clapperboard },
  { test: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, label: "YouTube", Icon: Play },
  { test: /(^|\.)facebook\.com$|(^|\.)fb\.watch$/, label: "Facebook", Icon: Play },
  { test: /(^|\.)x\.com$|(^|\.)twitter\.com$/, label: "X", Icon: Play },
  { test: /(^|\.)vimeo\.com$/, label: "Vimeo", Icon: Play },
  { test: /(^|\.)linkedin\.com$/, label: "LinkedIn", Icon: Play },
  { test: /(^|\.)threads\.(net|com)$/, label: "Threads", Icon: Camera },
];

export function platformOf(url: string): Platform {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* url rara */ }
  const hit = PLATFORMS.find((x) => x.test.test(host));
  return hit ? { label: hit.label, Icon: hit.Icon } : { label: host || "Link", Icon: Globe };
}

/** Normaliza un token a URL http(s) válida, o null. Acepta "instagram.com/reel/…" sin esquema. */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim().replace(/^[<("'[]+/, "").replace(/[>)"'\].,;!?]+$/, "");
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    // sin esquema: solo si parece un dominio (algo.tld/…)
    if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) return null;
    s = "https://" + s;
  }
  try {
    const u = new URL(s);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}

/** Separa el texto en URLs válidas y el resto (lo que no se pudo leer como link). */
export function extractUrls(text: string): { urls: string[]; rest: string[] } {
  const urls: string[] = [];
  const rest: string[] = [];
  for (const tok of text.split(/[\s,]+/)) {
    if (!tok) continue;
    const u = normalizeUrl(tok);
    if (u) { if (!urls.includes(u)) urls.push(u); } else rest.push(tok);
  }
  return { urls, rest };
}

/** Clave para detectar duplicados (sin esquema, www ni barra final). */
export const urlKey = (u: string): string => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");

interface ChipProps {
  /** URL del link; vacía para un video subido */
  url: string;
  /** nombre del archivo cuando no hay URL */
  name?: string;
  /** true = todavía no se guardó en el proyecto */
  pending?: boolean;
  onRemove: () => void;
  /** contenido extra debajo (nota editable, métricas…) */
  children?: ReactNode;
}

export function LinkChip({ url, name, pending, onRemove, children }: ChipProps) {
  const { label, Icon } = url ? platformOf(url) : { label: "Video subido", Icon: Paperclip };
  const shown = url ? url.replace(/^https?:\/\/(www\.)?/, "") : name || "video";
  return (
    <li className={cn("min-w-0 rounded-xl border bg-[var(--panel-2)] p-2.5", pending ? "border-dashed border-blue/50" : "border-[var(--line)]")}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-foreground" aria-hidden>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
            {label}
            {pending ? <span className="tag">Sin guardar</span> : null}
          </div>
          {url
            ? <a href={url} target="_blank" rel="noopener" className="block truncate text-xs text-muted-foreground hover:text-blue hover:underline">{shown}</a>
            : <span className="block truncate text-xs text-muted-foreground">{shown}</span>}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar ${label}: ${shown}`} onClick={onRemove}><X aria-hidden /></Button>
      </div>
      {children ? <div className="mt-2 pl-[42px] max-[400px]:pl-0">{children}</div> : null}
    </li>
  );
}
