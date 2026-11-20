// Helpers del estilo "Talking marca" (window.MARCA). Funciones puras de t: construir DOM en build(), llamar en run().
// Uso: copia este archivo a film/marca.js y cárgalo en film/index.html ANTES de film.js:
//   <script src="marca.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE); lib/media.js (C.drawSeq) para dibujar el clip de la persona.
// Todo lo que lleva el color de la marca lee var(--accent) de :root; el texto que va SOBRE el acento lee
// var(--on-accent), que MARCA.ink() calcula una vez (#111 o #fff, el que más contraste dé, igual que boxText "auto").
(() => {
  const C = window.C;

  /** Tinta legible sobre un color #rgb / #rrggbb (contraste WCAG); cualquier otra cosa → #111. */
  function inkOn(col) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col || '').trim());
    if (!m) return '#111';
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    const dark = ((0x11 / 255 + 0.055) / 1.055) ** 2.4;
    return (L + 0.05) / (dark + 0.05) >= 1.05 / (L + 0.05) ? '#111' : '#fff';
  }

  /** Lee --accent de :root y deja --on-accent (#111 o #fff). Llamar una vez al cargar film.js. Devuelve el acento. */
  function ink() {
    const root = document.documentElement;
    const acc = getComputedStyle(root).getPropertyValue('--accent').trim();
    root.style.setProperty('--on-accent', inkOn(acc));
    return acc;
  }

  /**
   * Zoom de cámara sobre la persona: keys [[beat, escala], …] con 'heavy'. 1.00 plano base, 1.10–1.18 en los énfasis.
   * drift: micro deriva sembrada para que ningún hold quede quieto. Devuelve la escala para C.drawSeq({ z }).
   */
  function punch(t, keys, { drift = 0.006, seed = 3 } = {}) {
    const z = C.trk(t, keys, 'heavy');
    return z * (1 + drift * noiseOf(seed)(t * 0.35));
  }
  const NOISES = {};
  function noiseOf(seed) { return NOISES[seed] || (NOISES[seed] = C.noise1(seed)); }

  /** Corte seco de punch (sin resorte): escala `amt` exacta en [b0, b1). Combínalo con punch(): z = punch(…) * hardPunch(…). */
  function hardPunch(t, b0, b1, amt = 1.12) {
    const b = C.beatAt(t);
    return b >= C.beatOf(b0) && b < C.beatOf(b1) ? amt : 1;
  }

  /**
   * Título de gancho de marca (frame 0). rows: [{ text, size, box }] — la fila con box: true va sobre una caja del
   * acento que se barre de izquierda a derecha y sus palabras (en --on-accent) suben por su máscara.
   * Devuelve { rows: [{ L, box }] } para hook().
   */
  function buildHook(parent, rows, { x = 80, y = 360, gap = 18 } = {}) {
    let top = y;
    const out = [];
    for (const r of rows) {
      const size = r.size || 110;
      let box = null;
      if (r.box) {
        // la caja toma su ancho de una copia invisible del texto: se mide sola cuando carga la fuente (build() corre antes)
        box = C.el('div', { class: 'hookbox', style: `left:${x - size * 0.16}px;top:${top - size * 0.1}px;height:${size * 1.2}px;font-size:${size}px` }, parent);
        C.el('span', { class: 'display', style: `display:block;visibility:hidden;line-height:1.2;padding:0 0.16em` }, box, r.text);
        C.reg(box, { o: 0 });
      }
      const L = window.TYPE.line(parent, r.text, { x, y: top, size, cls: r.box ? 'display on-box' : 'display' });
      out.push({ L, box });
      top += size * 1.2 + gap;
    }
    return { rows: out };
  }

  /**
   * Anima el gancho: inAt = beat (o lista de beats) de cada fila; la caja se barre ('heavy') un pelo antes que sus
   * palabras; todo sale por arriba en outAt (palabras) y la caja se recoge hacia la izquierda.
   */
  function hook(t, Hk, inAt, outAt) {
    Hk.rows.forEach((r, i) => {
      const bin = Array.isArray(inAt) ? inAt[i] : C.beatOf(inAt) + i * 0.5;
      if (r.box) {
        const p = C.spHit(t, C.beatOf(bin) - 0.25, 'heavy'), q = C.sp(t, C.beatOf(outAt) + 0.1, 'snappy');
        const w = C.clamp(p) * (1 - C.clamp(q));
        C.put(r.box, { o: w > 0.002 ? 1 : 0, clip: C.inset(0, 100 * (1 - w), 0, 0, 0) });
      }
      window.TYPE.rise(t, r.L, bin, outAt, { preset: 'heavy' });
    });
  }

  /** Etiqueta en el acento (paso, tema): pop en inAt, se va deslizando a la izquierda en outAt. */
  function tag(t, e, inAt, outAt) {
    const p = C.spHit(t, inAt, 'snappy'), q = outAt == null ? 0 : C.sp(t, outAt, 'snappy');
    C.put(e, { o: p > 0.001 && q < 0.98 ? 1 : 0, s: (0.7 + 0.3 * p) * (1 - 0.15 * q), x: -60 * q, r: -3 * (1 - p) });
    return p - q;
  }

  /**
   * Tarjeta de b-roll con marco de marca: crece desde 0.88 en inAt, micro push mientras está, sale empujada hacia abajo
   * en outAt (nunca fade). full = true → cubre todo el cuadro subiendo desde abajo.
   */
  function broll(t, e, inAt, outAt, { full = false } = {}) {
    const p = C.spHit(t, inAt, full ? 'default' : 'snappy');
    const q = C.sp(t, outAt, 'default');
    const k = C.seg(t, inAt, outAt);
    if (full) {
      const cover = C.clamp(p * 1.02), leave = C.clamp(q * 1.02);
      C.put(e, { o: p > 0.001 && leave < 0.999 ? 1 : 0, y: C.H * (1 - cover) + C.H * leave, s: 1 + 0.04 * k });
    } else {
      C.put(e, { o: p > 0.001 && q < 0.999 ? 1 : 0, s: (0.88 + 0.12 * p) * (1 + 0.03 * k), y: C.H * 0.6 * q, r: -2 * (1 - p) });
    }
    return p - q;
  }

  /** Espacio del logo + @: entra con el gancho y se queda; en accentAt (el CTA) da un pulso de escala. */
  function logo(t, e, inAt, accentAt = null) {
    const p = C.spHit(t, inAt, 'snappy');
    const pulse = accentAt == null ? 0 : Math.sin(Math.PI * C.clamp((t - C.bt(accentAt)) / 0.35)) * 0.08;
    C.put(e, { o: p > 0.001 ? 1 : 0, x: -30 * (1 - p), s: 1 + pulse });
  }

  /** Píldora de CTA en el acento: salta en inAt y pulsa una vez en pulseAt. */
  function cta(t, e, inAt, pulseAt = null) {
    const p = C.spHit(t, inAt, 'snappy');
    const pulse = pulseAt == null ? 0 : Math.sin(Math.PI * C.clamp((t - C.bt(pulseAt)) / 0.3)) * 0.06;
    C.put(e, { o: p > 0.001 ? 1 : 0, y: 30 * (1 - p), s: (0.8 + 0.2 * p) * (1 + pulse) });
  }

  /** Barra de progreso fina en el acento, pegada al borde superior (6–8 px; no tapa nada legible). */
  function progress(t, bar, { color = 'var(--accent)' } = {}) {
    C.put(bar, { css: { width: (C.W * C.clamp(t / C.DUR)).toFixed(1) + 'px', background: color } });
  }

  window.MARCA = { inkOn, ink, punch, hardPunch, buildHook, hook, tag, broll, logo, cta, progress };
})();
