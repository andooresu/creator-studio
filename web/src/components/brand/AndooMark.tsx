// Símbolo de Andoo: las dos «o» del nombre como un objetivo de cámara (contorno) y la luz de grabación
// (círculo relleno con el degradado de marca). Ver docs/brand/README.md.
import { useId } from "react";
import { cn } from "@/lib/utils";

export function AndooMark({ size = 24, mono = false, className, title }: { size?: number; mono?: boolean; className?: string; title?: string }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {!mono ? (
        <defs>
          <linearGradient id={`andoo-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6a4cf5" /><stop offset=".55" stopColor="#d44df0" /><stop offset="1" stopColor="#ff7a3d" />
          </linearGradient>
        </defs>
      ) : null}
      <circle cx="24" cy="32" r="15" fill="none" stroke="currentColor" strokeWidth="6" />
      <circle cx="42" cy="32" r="15" fill={mono ? "currentColor" : `url(#andoo-${gid})`} />
    </svg>
  );
}

/** Símbolo + «andoo» (+ «CreatorStudio» opcional). */
export function AndooWordmark({ size = 22, full = false, className }: { size?: number; full?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <AndooMark size={size} />
      <span className="leading-none">
        <span className="block font-semibold tracking-[-0.05em]" style={{ fontSize: size * 0.82 }}>andoo</span>
        {full ? <span className="mt-0.5 block text-[11px] font-medium tracking-[-0.01em] text-muted-foreground">CreatorStudio</span> : null}
      </span>
    </span>
  );
}
