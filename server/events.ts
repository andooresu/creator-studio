// Actualizaciones en vivo (Server-Sent Events): en lugar de que la interfaz pregunte cada pocos segundos,
// el servidor avisa qué cambió. Solo se envían claves ("projects:<id>", "styles:<id>", "kv:settings", "jobs"),
// nunca datos: la interfaz vuelve a pedir lo que le interesa por la API de siempre.
import type { Request, Response } from "express";

const clients = new Set<Response>();
let pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;
/** agrupa ráfagas (el render avisa su avance varias veces por segundo) */
const FLUSH_MS = 200;

function flush(): void {
  timer = null;
  if (!pending.size) return;
  const data = `event: change\ndata: ${JSON.stringify({ keys: [...pending] })}\n\n`;
  pending = new Set();
  for (const res of clients) res.write(data);
}

/** Anuncia que estas claves cambiaron. Barato: si no hay nadie conectado no hace nada. */
export function emitChange(keys: Iterable<string>): void {
  if (!clients.size) return;
  for (const k of keys) pending.add(k);
  if (!timer && pending.size) timer = setTimeout(flush, FLUSH_MS);
}

export function eventsHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // retry: si el servidor se reinicia, el navegador reintenta a los 2 s
  res.write("retry: 2000\nevent: hello\ndata: {}\n\n");
  clients.add(res);
  // latido: mantiene viva la conexión y detecta clientes que se fueron
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
}
