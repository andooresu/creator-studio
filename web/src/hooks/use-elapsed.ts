import { useEffect, useState } from "react";

/** Segundos transcurridos desde `since` (ISO), actualizados cada segundo mientras `active`. */
export function useElapsed(since: string | null | undefined, active = true): number {
  const start = since ? new Date(since).getTime() : NaN;
  const calc = () => (isNaN(start) ? 0 : Math.max(0, Math.round((Date.now() - start) / 1000)));
  const [s, setS] = useState(calc);
  useEffect(() => {
    setS(calc());
    if (!active || isNaN(start)) return;
    const iv = setInterval(() => setS(calc()), 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, active]);
  return s;
}

/** 95 → «1:35»; 3725 → «1:02:05». */
export function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
