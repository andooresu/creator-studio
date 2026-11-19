// Vista previa de un estilo: póster fijo que reproduce el clip en bucle (sin audio) al pasar el mouse,
// o siempre si `autoPlay`. Sin vista previa muestra un mosaico con la paleta del estilo.
// También reproduce con el foco del teclado (si va dentro de un enlace o botón), con un toque en pantallas táctiles
// y, si el sistema pide reducir el movimiento, solo cuando la persona lo toca o hace clic.
// Rendimiento: el <video> solo se crea cuando de verdad va a reproducirse (antes se veía el póster), se pausa si sale
// de la pantalla o la pestaña se oculta, y como máximo MAX_PLAYING clips suenan a la vez (el más antiguo cede).
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from "react";

const MAX_PLAYING = 4;
/** Clips reproduciéndose ahora, del más antiguo al más nuevo: id → función para detenerlo. */
const nowPlaying = new Map<string, () => void>();
function claimPlayback(id: string, stop: () => void): () => void {
  nowPlaying.delete(id);
  nowPlaying.set(id, stop);
  while (nowPlaying.size > MAX_PLAYING) {
    const [oldest, stopOldest] = nowPlaying.entries().next().value as [string, () => void];
    nowPlaying.delete(oldest);
    stopOldest();
  }
  return () => { if (nowPlaying.get(id) === stop) nowPlaying.delete(id); };
}

/** true mientras el elemento esté cerca de la pantalla y la pestaña visible. */
function useOnScreen(el: Element | null): boolean {
  const [on, setOn] = useState(false);
  const [docVisible, setDocVisible] = useState(typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  useEffect(() => {
    const on = () => setDocVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return on && docVisible;
}
import type { StylePreview } from "../../../shared/types.ts";

export function styleFileUrl(sid: string, rel: string, v?: string): string {
  const u = `/styles-files/${encodeURIComponent(sid)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
  return v ? `${u}?v=${encodeURIComponent(v)}` : u;
}

/** true mientras la media query se cumpla (se actualiza si cambia). */
function useMedia(query: string): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

interface Props {
  sid: string;
  preview?: StylePreview;
  palette?: string[];
  /** para invalidar la caché del navegador cuando se regenera (p. ej. updatedAt del estilo) */
  version?: string;
  /** reproduce siempre (detalle del estilo); si no, solo al pasar el mouse o cuando `playing` */
  autoPlay?: boolean;
  playing?: boolean;
  controls?: boolean;
  /** relación de aspecto del recuadro (por defecto vertical 9/16) */
  aspect?: string;
  style?: CSSProperties;
  label?: string;
  /** muestra el ▶ sobre el póster (por defecto sí) */
  badge?: boolean;
  /** reproduce cuando el botón o enlace que la contiene recibe el foco del teclado (por defecto sí). En una lista de
   *  opciones dentro de un diálogo va en false: el <video> que se monta y desmonta con el foco rompía el orden del
   *  tabulador (el foco caía al body y el diálogo lo devolvía al inicio) */
  focusPlay?: boolean;
}

export function StyleThumb({ sid, preview, palette = [], version, autoPlay, playing, controls, aspect = "9 / 16", style, label, badge = true, focusPlay = true }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  const noHover = useMedia("(hover: none)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [failed, setFailed] = useState(false);
  const [bumped, setBumped] = useState(false); // otro clip tomó su lugar (límite de MAX_PLAYING)
  const uid = useId();
  // el elemento se observa por callback ref: así funciona aunque primero se pinte sin vista previa
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const setBox = (n: HTMLDivElement | null) => { boxRef.current = n; setBoxEl(n); };
  const onScreen = useOnScreen(boxEl);
  const ver = preview?.v || version;
  const videoUrl = preview?.video ? styleFileUrl(sid, preview.video, ver) : null;
  useEffect(() => { setFailed(false); }, [videoUrl]);
  const video = videoUrl && !failed ? videoUrl : null;
  const poster = preview?.poster ? styleFileUrl(sid, preview.poster, ver) : undefined;
  // las tiras de varios fotogramas (preview.jpg antiguas) son horizontales: se muestran completas, no recortadas
  const posterFit: CSSProperties["objectFit"] = preview?.poster?.endsWith("preview.jpg") && !video ? "contain" : "cover";
  // con movimiento reducido no hay reproducción automática: solo al tocar o hacer clic
  const wants = tapped || (!reduced && Boolean(autoPlay || playing || (hover && !noHover) || focused));
  const active = wants && onScreen && !bumped;
  useEffect(() => { if (!wants) setBumped(false); }, [wants]);
  // cupo de reproducción: al empezar reclama un lugar; si se excede el máximo, el clip más antiguo se detiene
  // la vista grande del detalle (autoPlay/controls) no compite por el cupo: nunca se detiene por otros clips
  useEffect(() => {
    if (!active || autoPlay || controls) return;
    return claimPlayback(uid, () => { setBumped(true); setTapped(false); });
  }, [active, uid, autoPlay, controls]);

  // foco del teclado: solo si la miniatura va dentro de un enlace o botón (que ya es enfocable)
  useEffect(() => {
    const host = boxRef.current?.closest("a, button");
    if (!host || !focusPlay) return;
    const on = () => setFocused(true);
    // el foco que pasa a algo dentro del mismo botón o enlace no cuenta como salir
    const off = (e: Event) => { const to = (e as FocusEvent).relatedTarget; if (!(to instanceof Node && host.contains(to))) setFocused(false); };
    host.addEventListener("focus", on);
    host.addEventListener("blur", off);
    return () => { host.removeEventListener("focus", on); host.removeEventListener("blur", off); };
  }, [video, poster, boxEl, focusPlay]);

  // toque en pantallas táctiles (o clic con movimiento reducido): alterna la reproducción
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!video || controls) return;
    const inLink = Boolean(e.currentTarget.closest("a"));
    // en táctil: el primer toque reproduce; el segundo (ya reproduciendo) abre el enlace, si lo hay
    if (noHover) { if (inLink && tapped) return; if (inLink) e.preventDefault(); setTapped((x) => !x); return; }
    if (reduced && !inLink) setTapped((x) => !x);
  };

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) { v.play().catch(() => {}); } else { v.pause(); try { v.currentTime = 0; } catch {} }
  }, [active, video]);

  const box: CSSProperties = {
    position: "relative", aspectRatio: aspect, width: "100%", overflow: "hidden", borderRadius: 10,
    background: "#0b0b0d", border: "1px solid var(--line)", ...style,
  };

  if (!video && !poster) {
    const cols = palette.length ? palette.slice(0, 5) : ["#2a2a30", "#3a3a42"];
    return (
      <div ref={setBox} style={box} role="img" aria-label={label || "Sin vista previa"}>
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: `repeat(${cols.length}, 1fr)` }}>
          {cols.map((c, i) => <div key={i} style={{ background: c }} />)}
        </div>
        <span className="small" style={{ display: badge ? undefined : "none", position: "absolute", left: 8, bottom: 8, right: 8, padding: "3px 8px", borderRadius: 999, background: "rgba(0,0,0,.55)", color: "#fff", textAlign: "center" }}>Sin vista previa</span>
      </div>
    );
  }

  return (
    <div ref={setBox} style={box} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onClick} role={label ? "group" : undefined} aria-label={label}>
      {poster ? <img src={poster} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: posterFit, display: "block" }} /> : null}
      {video && (active || controls || !poster) ? (
        <video
          ref={ref}
          src={video}
          poster={poster}
          muted
          loop
          playsInline
          preload={active || autoPlay ? "auto" : "none"}
          controls={controls}
          // sin controles es decorativo: nunca una parada del tabulador (si recibiera el foco y se desmontara al perder
          // el del botón, el foco caería al body y el diálogo lo devolvería al inicio: trampa de teclado)
          tabIndex={controls ? undefined : -1}
          aria-hidden={controls ? undefined : true}
          autoPlay={autoPlay && !reduced}
          onError={() => setFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : null}
      {video && badge && !active && !controls ? (
        <span aria-hidden style={{ position: "absolute", right: 6, bottom: 6, width: 24, height: 24, borderRadius: 999, background: "rgba(0,0,0,.55)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11 }}>▶</span>
      ) : null}
    </div>
  );
}
