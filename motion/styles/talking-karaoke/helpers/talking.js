// Helpers del estilo "Talking karaoke" (window.TALK). Funciones puras de t: construir DOM en build(), llamar en run().
// Uso: copia este archivo a film/talking.js y cárgalo en film/index.html ANTES de film.js:
//   <script src="talking.js"></script>
// Requiere core.js (window.C) y lib/media.js (C.drawSeq) para dibujar el clip de la persona desde frames (seq.py).
(() => {
  const C = window.C;

  /**
   * Zoom de cámara sobre la persona: keys [[beat, escala], …] con 'heavy'. Usa 1.00 en plano base,
   * 1.12–1.20 en los énfasis (punch-in) y vuelve en la frase siguiente. Devuelve la escala para C.drawSeq({ z }).
   * drift: micro deriva sembrada para que ningún hold quede quieto.
   */
  function punch(t, keys, { drift = 0.006, seed = 3 } = {}) {
    const z = C.trk(t, keys, 'heavy');
    const n = noiseOf(seed);
    return z * (1 + drift * n(t * 0.35));
  }
  const NOISES = {};
  function noiseOf(seed) { return NOISES[seed] || (NOISES[seed] = C.noise1(seed)); }

  /**
   * Corte seco de punch (sin resorte): escala `amt` exacta en [b0, b1). Para golpes de comedia o remate.
   * Combínalo con punch(): z = punch(...) * hardPunch(...).
   */
  function hardPunch(t, b0, b1, amt = 1.15) {
    const b = C.beatAt(t);
    return b >= C.beatOf(b0) && b < C.beatOf(b1) ? amt : 1;
  }

  /**
   * Tarjeta de b-roll / imagen sobre la persona: crece desde 0.88 (opacidad entra en ≤ 4 frames) en `inAt`,
   * hace un micro push mientras está, y sale empujada hacia abajo fuera del cuadro en `outAt` (nunca fade).
   * full = true → ocupa todo el cuadro (corte a b-roll): sube desde abajo cubriendo a la persona y sale hacia abajo.
   */
  function broll(t, e, inAt, outAt, { full = false } = {}) {
    const p = C.spHit(t, inAt, full ? 'default' : 'snappy');
    const q = C.sp(t, outAt, 'default');
    const k = C.seg(t, inAt, outAt);
    if (full) {
      const cover = C.clamp(p * 1.02);
      const leave = C.clamp(q * 1.02);
      C.put(e, { o: p > 0.001 && leave < 0.999 ? 1 : 0, y: C.H * (1 - cover) + C.H * leave, s: 1 + 0.04 * k });
    } else {
      C.put(e, { o: p > 0.001 && q < 0.999 ? 1 : 0, s: (0.88 + 0.12 * p) * (1 + 0.03 * k), y: C.H * 0.6 * q, r: -2 * (1 - p) });
    }
    return p - q;
  }

  /** Barra de progreso fina pegada al borde superior (6–8 px de alto; no tapa nada legible). Ancho = avance del video. */
  function progress(t, bar, { color = 'var(--accent)' } = {}) {
    C.put(bar, { css: { width: (C.W * C.clamp(t / C.DUR)).toFixed(1) + 'px', background: color } });
  }

  /** Título de gancho (frame 0): palabras grandes que suben por su máscara mientras la persona arranca. */
  function hookTitle(t, L, beats, outAt) {
    window.TYPE.rise(t, L, beats, outAt, { preset: 'heavy' });
  }

  window.TALK = { punch, hardPunch, broll, progress, hookTitle };
})();
