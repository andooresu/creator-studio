// Reproductor de revisión: <video> nativo con controles propios del tema.
// Atajos (con el reproductor enfocado): Espacio/K reproducir · J/L −5/+5 s · ←/→ −1/+1 s · , . un cuadro atrás/adelante
// (pausa) · M silencio · F pantalla completa · P imagen en imagen. Código de tiempo mm:ss:cc (cuadros) según `fps`.
// Rendimiento: precarga solo metadatos y actualiza el tiempo con requestAnimationFrame mientras reproduce (≈10 veces/s).
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Maximize, Minimize, Pause, PictureInPicture2, Play, Volume2, VolumeX, StepBack, StepForward } from "lucide-react";
import { cn } from "@/lib/utils.ts";

const SPEEDS = [0.5, 1, 1.5, 2];

export function timecode(t: number, fps: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function VideoPlayer({ src, poster, aspect = "9 / 16", fps = 30, label = "Reproductor de video", autoPlay = false, loop = false, className, style, maxHeight = "70vh" }: {
  src: string;
  poster?: string;
  /** relación de aspecto del cuadro, p. ej. "9 / 16", "16 / 9" */
  aspect?: string;
  fps?: number;
  label?: string;
  autoPlay?: boolean;
  loop?: boolean;
  className?: string;
  style?: CSSProperties;
  maxHeight?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const raf = useRef(0);
  const lastPaint = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const rangeId = useId();
  // sin póster, "#t=0.05" hace que el navegador muestre el primer cuadro en vez de negro
  const videoSrc = poster || src.includes("#") ? src : `${src}#t=0.05`;
  const pipOk = typeof document !== "undefined" && "pictureInPictureEnabled" in document && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;

  // tiempo: con rAF mientras reproduce, limitado a ~10 repintados por segundo
  const tick = useCallback(() => {
    const v = vid.current;
    if (!v) return;
    const now = performance.now();
    if (now - lastPaint.current > 95) { lastPaint.current = now; setT(v.currentTime); }
    raf.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { setT(0); setDur(0); setError(null); setPlaying(false); }, [src]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggle = () => { const v = vid.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const seek = (to: number) => { const v = vid.current; if (!v) return; v.currentTime = Math.max(0, Math.min(dur || v.duration || 0, to)); setT(v.currentTime); };
  const step = (frames: number) => { const v = vid.current; if (!v) return; v.pause(); seek(v.currentTime + frames / fps); };
  const toggleMute = () => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.current?.requestFullscreen?.().catch(() => {}); };
  const togglePip = () => {
    const v = vid.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!v) return;
    if ((document as Document & { pictureInPictureElement?: Element }).pictureInPictureElement) void (document as Document & { exitPictureInPicture: () => Promise<void> }).exitPictureInPicture();
    else void v.requestPictureInPicture?.().catch(() => {});
  };
  const setSpeed = (r: number) => { const v = vid.current; if (v) v.playbackRate = r; setRate(r); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // no secuestrar atajos del navegador/sistema (Cmd+L, Cmd+F, Cmd+P, Ctrl+K…)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).tagName === "SELECT") return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      " ": toggle, k: toggle, j: () => seek(t - 5), l: () => seek(t + 5), arrowleft: () => seek(t - 1), arrowright: () => seek(t + 1),
      ",": () => step(-1), ".": () => step(1), m: toggleMute, f: toggleFull, p: () => { if (pipOk) togglePip(); }, home: () => seek(0), end: () => seek(dur),
    };
    const fn = map[k];
    if (!fn || (k === " " && (e.target as HTMLElement).tagName === "BUTTON")) return;
    if (k === "arrowleft" || k === "arrowright") { if ((e.target as HTMLElement).tagName === "INPUT") return; }
    e.preventDefault();
    fn();
  };

  const pct = dur ? (t / dur) * 100 : 0;
  const bpct = dur ? (buffered / dur) * 100 : 0;

  return (
    <div
      ref={wrap}
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKey}
      className={cn("group/player relative overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring", full && "grid place-items-center rounded-none", className)}
      style={{ aspectRatio: full ? undefined : aspect, maxHeight: full ? undefined : maxHeight, maxWidth: "100%", ...style }}
    >
      <video
        ref={vid}
        src={videoSrc}
        poster={poster}
        preload="metadata"
        playsInline
        autoPlay={autoPlay}
        loop={loop}
        onClick={toggle}
        onPlay={() => { setPlaying(true); cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick); }}
        onPause={() => { setPlaying(false); cancelAnimationFrame(raf.current); if (vid.current) setT(vid.current.currentTime); }}
        onEnded={() => { setPlaying(false); cancelAnimationFrame(raf.current); }}
        onSeeked={() => { if (vid.current) setT(vid.current.currentTime); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
        onProgress={(e) => { const b = e.currentTarget.buffered; if (b.length) setBuffered(b.end(b.length - 1)); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={() => setError("No se pudo cargar el video.")}
        className="absolute inset-0 size-full object-contain"
      />
      {error ? <div role="alert" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">{error}</div> : null}
      {!playing && !error ? (
        <button type="button" onClick={toggle} aria-label="Reproducir" className="absolute inset-0 m-auto grid size-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-transform hover:scale-105">
          <Play className="ml-0.5 size-6" fill="currentColor" />
        </button>
      ) : null}
      {waiting && playing ? <div aria-hidden className="absolute inset-0 m-auto size-8 animate-spin rounded-full border-2 border-white/25 border-t-white" /> : null}

      {/* @container: los controles se adaptan al ancho del reproductor (la barra ocupa todo el ancho; su caja de
          contenido es el ancho del reproductor − 24 px de relleno, así que @[316px] ≈ reproductor de 340 px y @[276px] ≈ 300 px) */}
      <div className={cn(
        "@container absolute inset-x-0 bottom-0 grid grid-cols-[minmax(0,1fr)] gap-1.5 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pt-8 pb-2.5 text-white transition-opacity",
        playing ? "opacity-0 group-hover/player:opacity-100 group-focus-within/player:opacity-100" : "opacity-100",
      )}>
        <div className="relative h-4 min-w-0 rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-black">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
            <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bpct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${pct}%` }} />
          </div>
          <label htmlFor={rangeId} className="sr-only">Posición</label>
          <input
            id={rangeId}
            type="range"
            min={0}
            max={dur || 0}
            step={1 / fps}
            value={Math.min(t, dur || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-valuetext={`${timecode(t, fps)} de ${timecode(dur, fps)}`}
            className="absolute inset-0 m-0 h-4 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 opacity-0 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-px [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-px [&::-webkit-slider-thumb]:appearance-none"
          />
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <CtlButton label={playing ? "Pausar (K)" : "Reproducir (K)"} onClick={toggle}>{playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4" fill="currentColor" />}</CtlButton>
          <CtlButton label="Cuadro anterior (,)" onClick={() => step(-1)} className="hidden @[316px]:grid"><StepBack className="size-4" /></CtlButton>
          <CtlButton label="Cuadro siguiente (.)" onClick={() => step(1)} className="hidden @[316px]:grid"><StepForward className="size-4" /></CtlButton>
          <span className="ml-1 font-mono text-[11.5px] whitespace-nowrap tabular-nums text-white/90" aria-live="off">{timecode(t, fps)}<span className="hidden text-white/50 @[276px]:inline"> / {timecode(dur, fps)}</span></span>
          <span className="grow" />
          <label className="sr-only" htmlFor={`${rangeId}-rate`}>Velocidad</label>
          <select
            id={`${rangeId}-rate`}
            value={rate}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="hidden h-7 w-auto cursor-pointer rounded-full @[316px]:block border-0 bg-white/10 px-2 py-0 text-[11.5px] text-white focus:shadow-none"
          >
            {SPEEDS.map((r) => <option key={r} value={r} className="bg-neutral-900">{r}×</option>)}
          </select>
          <CtlButton label={muted ? "Activar sonido (M)" : "Silenciar (M)"} onClick={toggleMute}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</CtlButton>
          {pipOk ? <CtlButton label="Imagen en imagen (P)" onClick={togglePip} className="hidden @[316px]:grid"><PictureInPicture2 className="size-4" /></CtlButton> : null}
          <CtlButton label={full ? "Salir de pantalla completa (F)" : "Pantalla completa (F)"} onClick={toggleFull}>{full ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</CtlButton>
        </div>
      </div>
    </div>
  );
}

function CtlButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cn("grid size-8 shrink-0 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white", className)}>
      {children}
    </button>
  );
}
