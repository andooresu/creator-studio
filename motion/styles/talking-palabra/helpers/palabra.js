// Helpers del estilo "Talking palabra" (window.PALA). Funciones puras de t: construir DOM en build(), llamar en run().
// Uso: copia este archivo a film/palabra.js y cárgalo en film/index.html ANTES de film.js:
//   <script src="palabra.js"></script>
// Requiere core.js (window.C) y lib/media.js (C.drawSeq) para dibujar el clip de la persona desde frames (seq.py).
// Regla del estilo: la cámara NUNCA usa resortes. Todo cambio de plano es un salto seco en un beat (snap);
// la energía la ponen los golpes de escala, los cortes con cambio de encuadre y los golpes de palabra a pantalla completa.
(() => {
  const C = window.C;

  /**
   * Valor escalonado por beats, SIN resorte: keys [[beat, valor], …] (beats o marcas). Devuelve el valor de la última
   * key cuyo beat ya pasó (la primera key es el valor inicial). El valor puede ser un número o un objeto { z, x, y }.
   * Para la cámara: z = PALA.snap(t, [[0, 1], ['w_mas', 1.22], ['corte', 1]]) → C.drawSeq(…, { z }).
   */
  function snap(t, keys) {
    const b = C.beatAt(t);
    let v = keys[0][1];
    for (const [k, val] of keys) if (b >= C.beatOf(k)) v = val;
    return v;
  }

  /**
   * Sacudida corta y sembrada tras un golpe (sin Math.random): { x, y, r } que decae en `dur` s desde cada beat de `hits`.
   * amp en px. Úsala con moderación: solo en los golpes de palabra y en el remate.
   */
  const NOISES = {};
  const noiseOf = (seed) => NOISES[seed] || (NOISES[seed] = C.noise1(seed));
  function shake(t, hits, { amp = 14, dur = 0.22, seed = 5 } = {}) {
    let k = 0;
    for (const h of hits) { const d = t - C.bt(h); if (d >= 0 && d < dur) k = Math.max(k, 1 - d / dur); }
    if (!k) return { x: 0, y: 0, r: 0 };
    const nx = noiseOf(seed), ny = noiseOf(seed + 17), q = t * 38;
    return { x: amp * k * nx(q), y: amp * k * ny(q), r: 0.6 * k * nx(q + 9) };
  }

  /**
   * Golpe de palabra a pantalla completa: la tarjeta (fondo de acento) entra con CORTE SECO en `inAt` y sale con
   * corte seco en `outAt`; la palabra baja de 1,12 a 1,00 en ~0,12 s (ease.out, sin rebote) y empuja un 4 % mientras está.
   * card = elemento a pantalla completa; word = elemento de la palabra (centrado con su propio transform-origin).
   */
  function slam(t, card, word, inAt, outAt, { from = 1.12, tilt = -2 } = {}) {
    const a = C.bt(inAt), z = C.bt(outAt);
    const on = t >= a - C.LEAD && t < z;
    C.put(card, { o: on ? 1 : 0 });
    if (!on) return 0;
    const k = C.ease.out(C.clamp((t - (a - C.LEAD)) / 0.12));
    const push = 1 + 0.04 * C.clamp((t - a) / Math.max(0.001, z - a));
    C.put(word, { s: (from + (1 - from) * k) * push, r: tilt * (1 - 0.6 * k) });
    return 1;
  }

  /**
   * Palabra estampada (gancho, etiquetas): aparece SECA en su beat bajando de 1,4 a 1,0 en ~0,1 s (sin resorte)
   * y desaparece seca en `outAt` (o se queda si outAt es null).
   */
  function stamp(t, e, at, outAt = null, { from = 1.4 } = {}) {
    const a = C.bt(at) - C.LEAD;
    const on = t >= a && (outAt == null || t < C.bt(outAt));
    if (!on) { C.put(e, { o: 0 }); return 0; }
    const k = C.ease.out(C.clamp((t - a) / 0.1));
    C.put(e, { o: 1, s: from + (1 - from) * k });
    return k;
  }

  /** Color del token CSS (p. ej. '--accent') ya resuelto desde :root, para pintar el canvas con la marca. */
  function token(name, fallback = '#ff5a1f') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /** Tinta legible sobre un color (#rgb / #rrggbb): '#111' o '#fff', la de mayor contraste WCAG. Otros formatos → '#111'. */
  function inkOn(col) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col || '').trim());
    if (!m) return '#111';
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    const dark = ((0x11 / 255 + 0.055) / 1.055) ** 2.4;
    return (L + 0.05) / (dark + 0.05) >= 1.05 / (L + 0.05) ? '#111' : '#fff';
  }

  /**
   * Tamaño de letra para que una palabra en mayúsculas quepa en `maxW` px (estimación por caracteres para Montserrat
   * ExtraBold, sin medir el layout en build()). Tope `max`.
   */
  function fitSize(word, maxW, max = 300, em = 0.7) {
    return Math.min(max, Math.floor(maxW / (Math.max(1, [...word].length) * em)));
  }

  window.PALA = { snap, shake, slam, stamp, token, inkOn, fitSize };
})();
