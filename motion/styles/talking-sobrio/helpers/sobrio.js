// Helpers del estilo "Talking sobrio" (window.SOB). Construir el DOM en build(), animar en run(): funciones puras de t,
// sin timers, sin Math.random, sin Date. Uso: copia este archivo a film/sobrio.js y cárgalo en film/index.html ANTES de film.js:
//   <script src="sobrio.js"></script>
// Requiere core.js (window.C). Para dibujar el clip real de la persona: lib/media.js (C.drawSeq) con la `z` de SOB.punch.
(() => {
  const C = window.C;

  // Resorte largo y sin rebote para la cámara y los rótulos: la plantilla nunca "salta".
  const SLOW = { response: 1.1, damping: 1.0 };
  const CALM = { response: 0.7, damping: 1.0 };

  /**
   * Punch-in lento sobre la persona: keys [[beat, escala], …] con resorte largo (SLOW). Usa 1.00 en el plano base y
   * 1.06–1.08 en los énfasis; vuelve a 1.00 en la frase siguiente. Devuelve la escala para C.drawSeq({ z }).
   * drift: micro deriva sembrada (más suave que en Talking karaoke) para que ningún hold quede congelado.
   */
  function punch(t, keys, { drift = 0.004, seed = 5, preset = SLOW } = {}) {
    const z = C.trk(t, keys, preset);
    return z * (1 + drift * noiseOf(seed)(t * 0.25));
  }
  const NOISES = {};
  function noiseOf(seed) { return NOISES[seed] || (NOISES[seed] = C.noise1(seed)); }

  /**
   * Corte de toma tranquilo: escala fija por tramo (shots = [[marca, escala], …], p. ej. 1.00 ↔ 1.04). El cambio es seco
   * (es un corte), pero pequeño: suficiente para que el salto de toma no se note, nunca un golpe.
   */
  function shot(t, shots) {
    const b = C.beatAt(t);
    let s = 1;
    for (const [m, v] of shots) if (b >= C.beatOf(m)) s = v;
    return s;
  }

  /**
   * Rótulo (lower third) de nombre + especialidad. o = { x, y, name, role, size (px del nombre), w (ancho mínimo) }.
   * Estructura: barra de acento fina a la izquierda + tarjeta clara con dos líneas, cada una en su máscara.
   * Devuelve { root, bar, card, name, role } para SOB.lowerThird().
   */
  function buildLowerThird(parent, o = {}) {
    const fs = o.size || 56, rs = Math.round(fs * 0.68), pad = Math.round(fs * 0.5);
    const root = C.el('div', { class: 'abs sob-lt', style: `left:${o.x || 0}px;top:${o.y || 0}px` }, parent);
    const bar = C.el('div', { class: 'abs sob-lt-bar', style: `left:0;top:0;width:${Math.round(fs * 0.14)}px;height:100%;transform-origin:50% 100%` }, root);
    const card = C.el('div', { class: 'sob-lt-card', style: `margin-left:${Math.round(fs * 0.14)}px;padding:${pad}px ${Math.round(pad * 1.5)}px ${Math.round(pad * 1.3)}px;${o.w ? `min-width:${o.w}px;` : ''}` }, root);
    const m1 = C.el('div', { class: 'sob-mask' }, card);
    const name = C.el('div', { class: 'sob-lt-name', style: `font-size:${fs}px` }, m1, o.name || 'Tu nombre');
    const m2 = C.el('div', { class: 'sob-mask', style: `margin-top:${Math.round(fs * 0.12)}px` }, card);
    const role = C.el('div', { class: 'sob-lt-role', style: `font-size:${rs}px` }, m2, o.role || 'Tu especialidad');
    C.reg(root, { o: 0 }); C.reg(bar); C.reg(card); C.reg(name); C.reg(role);
    return { root, bar, card, name, role, fs };
  }

  /**
   * Anima el rótulo: la barra de acento crece, la tarjeta se descubre de izquierda a derecha (máscara) y el nombre y la
   * especialidad suben por sus máscaras; al salir, la tarjeta se recoge hacia la barra y la barra baja. Nunca fade.
   */
  function lowerThird(t, L, inAt, outAt) {
    const b0 = C.beatOf(inAt);
    const pb = C.sp(t, b0, CALM);                         // barra
    const pc = C.sp(t, b0 + 0.25, SLOW);                  // tarjeta (máscara)
    const pn = C.sp(t, b0 + 0.5, CALM), pr = C.sp(t, b0 + 0.75, CALM);
    const q = outAt == null ? 0 : C.sp(t, outAt, CALM);   // salida de la tarjeta
    const qb = outAt == null ? 0 : C.sp(t, C.beatOf(outAt) + 0.6, CALM);
    const reveal = C.clamp(pc - q);
    C.put(L.root, { o: pb > 0.002 && qb < 0.998 ? 1 : 0 });
    C.put(L.bar, { sy: C.clamp(pb - qb) });
    C.put(L.card, { clip: `inset(-2px ${(100 * (1 - reveal)).toFixed(2)}% -40px -2px)`, hide: reveal < 0.003 });
    C.put(L.name, { y: L.fs * 1.3 * (1 - pn), hide: reveal < 0.08 });
    C.put(L.role, { y: L.fs * 1.1 * (1 - pr), hide: reveal < 0.08 });
    return reveal;
  }

  /**
   * Etiqueta discreta (p. ej. «Pregunta 1»): entra deslizándose por una máscara desde la izquierda y sale igual.
   * e = elemento .sob-chip registrado (o: 0). Devuelve la visibilidad 0..1.
   */
  function chip(t, e, inAt, outAt) {
    const p = C.sp(t, inAt, CALM), q = outAt == null ? 0 : C.sp(t, outAt, CALM);
    const v = C.clamp(p - q);
    C.put(e, { o: v > 0.003 ? 1 : 0, clip: `inset(-4px ${(100 * (1 - v)).toFixed(2)}% -30px -4px)`, x: -24 * (1 - p) });
    return v;
  }

  /**
   * Tarjeta de b-roll / imagen aprobada que se descubre de abajo arriba (máscara) con un leve asiento de escala 1.03 → 1,
   * hace un empuje lento mientras está y se recoge hacia arriba al salir. Nunca fade, nunca giro.
   */
  function card(t, e, inAt, outAt) {
    const p = C.sp(t, inAt, SLOW), q = outAt == null ? 0 : C.sp(t, outAt, CALM), k = C.seg(t, inAt, outAt == null ? C.beatAt(C.DUR) : outAt);
    const v = C.clamp(p - q);
    C.put(e, { o: v > 0.003 ? 1 : 0, clip: `inset(${(100 * q).toFixed(2)}% 0 ${(100 * (1 - p)).toFixed(2)}% 0 round 24px)`, s: (1.03 - 0.03 * p) * (1 + 0.02 * k) });
    return v;
  }

  /** Título de entrada sobrio: palabras que suben por su máscara con resorte largo (sin golpe) y salen hacia arriba. */
  function title(t, L, beats, outAt) {
    window.TYPE.rise(t, L, beats, outAt, { preset: CALM, exit: 0.4 });
  }

  window.SOB = { SLOW, CALM, punch, shot, buildLowerThird, lowerThird, chip, card, title };
})();
