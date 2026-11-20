// Límites de los datos de un B-roll animado (entrega 4). Una sola fuente para el servidor (PATCH, propuesta de la IA,
// docs/apoyos.json) y la web (editor y botón Aprobar). Están medidos para que INS (motion/engine/lib/inserts.js) siempre
// los pueda mostrar sin bajar del tamaño mínimo de lint (32 px; 36 en 9:16): en la tarjeta «encima» casi siempre, y si
// no cabe ahí, a pantalla completa.

/** Caracteres por texto o cifra, y elementos por apoyo (el máximo de cualquier animación). */
export const DATO_MAX = 60, DATOS_MAX = 5;
/** Ninguna palabra suelta más larga que esto (una URL larga no se puede partir en líneas). */
export const PALABRA_MAX = 24;
/** La cifra (datos[0] de «cifra») va en una sola línea grande. */
export const CIFRA_MAX = 18;
/** Elementos que muestra cada animación. */
export const DATOS_POR_ANIMACION: Record<string, number> = { palabras: 3, cifra: 2, pasos: 5, lista: 5, comparacion: 4 };

const clean = (d: unknown): string => String(d ?? "").replace(/\*/g, "").trim();

/**
 * Por qué estos datos NO sirven para la animación ("" si sirven). Misma regla que vacio() de inserts.js (INS.full se
 * niega a construir un panel vacío) más los límites de tamaño de arriba.
 */
export function datosProblem(animacion: string | null | undefined, datos: readonly unknown[] | null | undefined): string {
  if (!animacion || animacion === "ninguna" || !(animacion in DATOS_POR_ANIMACION)) return "no tiene animación elegida";
  const d = (datos || []).map(clean);
  const n = d.filter(Boolean).length;
  if (animacion === "comparacion" && !(d[0] && d[1])) return "la comparación necesita las dos ideas en los dos primeros textos";
  if (animacion === "cifra" && !d[0]) return "falta la cifra en el primer texto";
  if (!n) return "no tiene textos ni cifras para animar";
  const max = DATOS_POR_ANIMACION[animacion];
  if (d.length > max) return `esta animación muestra hasta ${max} textos (tiene ${d.length})`;
  const long = d.find((x) => x.length > DATO_MAX);
  if (long) return `«${long.slice(0, 30)}…» pasa de ${DATO_MAX} caracteres`;
  if (animacion === "cifra" && d[0].length > CIFRA_MAX) return `la cifra «${d[0].slice(0, 30)}» pasa de ${CIFRA_MAX} caracteres: deja solo el número y pasa el resto a la etiqueta`;
  const word = d.flatMap((x) => x.split(/\s+/)).find((w) => w.length > PALABRA_MAX);
  if (word) return `«${word.slice(0, 30)}${word.length > 30 ? "…" : ""}» es una palabra de más de ${PALABRA_MAX} caracteres y no cabe legible`;
  return "";
}
