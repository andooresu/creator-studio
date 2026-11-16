// Teleprompter a pantalla completa: el texto sube solo; velocidad −/+, pausa, espejo y cerrar (también con Esc).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FlipHorizontal2, Minus, Pause, Play, Plus, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button.tsx";

export function Prompter({ text, onClose }: { text: string; onClose: () => void }) {
  const txtRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const speed = useRef(1.2);
  const y = useRef(0);
  const playingRef = useRef(true);
  const flip = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [mirrored, setMirrored] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const txt = txtRef.current;
      if (txt) {
        if (playingRef.current) y.current += speed.current;
        txt.style.transform = `translateY(${-y.current}px) ${flip.current ? "scaleX(-1)" : ""}`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Foco al abrir, Esc para cerrar y sin scroll de la página de fondo.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  const toggle = () => { playingRef.current = !playingRef.current; setPlaying(playingRef.current); };
  const mirror = () => { flip.current = !flip.current; setMirrored(flip.current); };
  const btn = "bg-white/10 text-white hover:bg-white/20";

  return createPortal(
    <div className="prompter" role="dialog" aria-modal="true" aria-label="Teleprompter">
      <div className="ctl flex-wrap justify-end" role="toolbar" aria-label="Controles del teleprompter">
        <Button size="icon-sm" variant="ghost" className={btn} aria-label="Más lento" title="Más lento" onClick={() => { speed.current = Math.max(0.2, speed.current - 0.3); }}><Minus aria-hidden /></Button>
        <Button size="icon-sm" variant="ghost" className={btn} aria-label={playing ? "Pausar" : "Seguir"} title={playing ? "Pausar" : "Seguir"} onClick={toggle}>{playing ? <Pause aria-hidden /> : <Play aria-hidden />}</Button>
        <Button size="icon-sm" variant="ghost" className={btn} aria-label="Más rápido" title="Más rápido" onClick={() => { speed.current += 0.3; }}><Plus aria-hidden /></Button>
        <Button size="icon-sm" variant="ghost" className={btn} aria-label="Espejo" title="Espejo" aria-pressed={mirrored} onClick={mirror}><FlipHorizontal2 aria-hidden /></Button>
        <button ref={closeRef} type="button" className={buttonVariants({ size: "sm", variant: "ghost", className: btn })} onClick={onClose}><X aria-hidden />Cerrar</button>
      </div>
      <div className="txt max-[600px]:text-[34px]! max-[600px]:px-6!" ref={txtRef}>{text}</div>
    </div>,
    document.body,
  );
}
