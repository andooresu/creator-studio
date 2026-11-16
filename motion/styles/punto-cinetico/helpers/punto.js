// Helpers del estilo "Punto cinético" (window.PUNTO). Funciones puras de t: construye el DOM en build() y anima en run().
// Uso: copia este archivo a film/punto.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="punto.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Nada de timers, Math.random ni estado mutado entre frames.
// Clases CSS que espera (vienen en demo/index.html): .line .display .word .dot .shot .ui-pill .cursor .wm .wm-dot
(() => {
  const C = window.C;
  const { W, H, put, reg, el, sp, spHit, trk, seg, clamp, lerp, ease, beatOf, rectOf } = C;

  // ------------------------------------------------------------------ tipografía cinética
  // Las palabras enmascaradas salen ~2 frames antes que el adelanto de spHit, para estar ~90 % fuera de la máscara EN el beat.
  const EARLY = 0.13;
  /** TYPE.rise con adelanto EARLY. Los beats <= 0 (palabra visible en el frame 0) no se adelantan. */
  const rise = (t, L, inAt, outAt = null, o) =>
    TYPE.rise(t, L, Array.isArray(inAt) ? inAt.map((b) => (C.beatOf(b) <= 0 ? b : C.beatOf(b) - EARLY)) : C.beatOf(inAt) - EARLY, outAt, o);

  /**
   * Líneas enmascaradas de palabras. Un '.' final se convierte en su propio span.dot dentro de la palabra
   * (sube con ella y hace pop por su cuenta). Devuelve { words, dots, size, lines }.
   *   o: { x, y, size, lh=1.04, color, accent:[índices globales de palabra], accentColor, dotColor }
   */
  function words(parent, lines, o) {
    const size = o.size, lh = o.lh ?? 1.04, all = [], dots = [], lns = [];
    let gi = 0;
    lines.forEach((text, li) => {
      const ln = el('div', { class: 'line display', style: `left:${o.x}px;top:${o.y + li * size * lh}px;font-size:${size}px;color:${o.color || 'var(--ink)'}` }, parent);
      text.split(' ').forEach((w, wi, arr) => {
        const s = el('span', { class: 'word' }, ln);
        const hasDot = w.endsWith('.');
        s.textContent = hasDot ? w.slice(0, -1) : w;
        if (o.accent && o.accent.includes(gi)) s.style.color = o.accentColor || 'var(--accent)';
        if (hasDot) { const d = el('span', { class: 'dot' }, s, '.'); if (o.dotColor) d.style.color = o.dotColor; reg(d); dots.push(d); }
        if (wi < arr.length - 1) ln.appendChild(document.createTextNode(' '));
        all.push(reg(s, { y: 0 })); gi++;
      });
      lns.push(reg(ln));
    });
    return { words: all, dots, size, lines: lns };
  }

  // ------------------------------------------------------------------ pops
  /** 0 → overshoot del 32 % → 1. Solo para pops, el punto y píldoras. Nunca en tarjetas ni UI grande. */
  const popS = (p) => p * (1 + 0.32 * Math.sin(Math.PI * clamp(p)));
  // Un pop aparece de golpe al iniciar su resorte: su inicio ES el golpe. Se suelta medio frame antes del beat.
  const POP_LEAD = 0.008;
  const popHit = (t, beat) => spHit(t, beat, 'snappy', POP_LEAD);
  /** El punto final hace pop (lleva SFX pop en el mismo beat). */
  const dotPop = (t, d, beat) => { const p = spHit(t, beat, 'snappy', 0.035); put(d, { s: popS(p), o: p > 0.001 ? 1 : 0 }); return p; };
  /** Oculto hasta que arranca su resorte; luego visible de golpe (nunca fade-in). */
  const vis = (p) => (p > 0.002 ? 1 : 0);

  // ------------------------------------------------------------------ cámara
  /** Caja de cámara a cuadro completo. ox/oy = origen del zoom (por defecto 30 % del ancho, centro vertical). */
  const cam = (root, ox = W * 0.3, oy = H / 2) => reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:${ox}px ${oy}px` }, root));
  /** Micro push lineal en un hold: 1 → 1 + amt entre b0 y b1. extraScale multiplica (punch, push past camera). */
  const microPush = (t, c, b0, b1, amt = 0.04, extra = {}) => put(c, { s: (1 + amt * seg(t, b0, b1)) * (extra.mul ?? 1), ...extra.props });

  /**
   * Swap de afirmaciones por empuje: A sale hacia arriba mientras B empuja desde abajo; la primera palabra de B
   * llega con el empuje EN la línea de compás `bar`. El resorte arranca 0.38 beat antes.
   */
  function pushSwap(t, aBox, bBox, bar) {
    const push = sp(t, beatOf(bar) - 0.38, 'default');
    put(aBox, { y: -H * 1.05 * push, hide: push > 0.999 });
    put(bBox, { y: H * 1.05 * (1 - push), o: push > 0.001 ? 1 : 0 });
    return push;
  }

  /**
   * Push past camera: el último tramo de la escena se va hacia la cámara (zoom +220 %, blur hasta 18 px).
   * Devuelve el factor por el que hay que multiplicar la escala de cámara.
   */
  function pushPast(t, b0, b1, { zoom = 2.2, blur = 18 } = {}) {
    const out = ease.expoIn(seg(t, b0, b1));
    return { mul: 1 + zoom * out, filter: out > 0.01 ? `blur(${(out * blur).toFixed(2)}px)` : undefined, out };
  }

  // ------------------------------------------------------------------ iris del punto (firma del estilo)
  /** Círculo sólido para el iris. Crea uno por transición, en la raíz de la escena (no dentro de la cámara). */
  const irisEl = (root, color) => reg(el('div', { class: 'abs', style: `width:100px;height:100px;border-radius:50%;background:${color};z-index:40` }, root), { o: 0 });

  /**
   * Llamar en after() de la escena: el punto crece desde su glifo hasta cubrir el cuadro. Cobertura total EXACTA en b1
   * (la línea de compás). La escena siguiente entra con pre:0.22, cut:true, o empieza justo en b1.
   */
  function iris(t, irisE, dot, b0, b1) {
    const p = seg(t, b0, b1);
    if (p <= 0) { put(irisE, { o: 0 }); return 0; }
    const r = rectOf(dot);
    const d = r.h * 0.2, cx = r.cx, cy = r.y + r.h * 0.78;
    const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    const s = lerp(1, (2 * R) / d * 1.02, ease.expoIn(p) * 0.985 + 0.015 * p);
    put(irisE, { o: 1, x: cx - 50, y: cy - 50, s: s * d / 100, css: { transformOrigin: '50px 50px' } });
    put(dot, { o: 0 });
    return p;
  }

  // ------------------------------------------------------------------ marca de reemplazo (logotipo)
  /**
   * Logotipo de REEMPLAZO: texto en Inter 800 + punto propio (.wm-dot). Cámbialo por el SVG de tu marca
   * (mantén un elemento .wm-dot para el pop y el pulso). Devuelve la caja con _dot, _w, _h.
   *   o: { text='tu marca', size, color='var(--ink)', dotColor='var(--accent)' }
   */
  function logo(parent, o = {}) {
    const size = o.size || 160;
    const box = el('div', { class: 'abs wm display', style: `font-size:${size}px;line-height:1;color:${o.color || 'var(--ink)'};white-space:nowrap` }, parent);
    box.innerHTML = `${o.text || 'tu marca'}<span class="wm-dot" style="display:inline-block;color:${o.dotColor || 'var(--accent)'};transform-origin:50% 85%">.</span>`;
    box._dot = reg(box.querySelector('.wm-dot'));
    box._size = size;
    return reg(box);
  }

  /** Type-on letra a letra: `text` aparece entre b0 y b1 (una letra cada (b1-b0)/n beats). Lleva SFX tick por letra. */
  function typeOn(t, e, text, b0, b1) {
    const n = Math.floor(seg(t, b0, b1) * text.length + 1e-6);
    put(e, { text: text.slice(0, n) });
    return n;
  }

  /**
   * La hoja blanca cubre el campo desde abajo (resorte default). Devuelve el borde superior en px de escenario,
   * para partir el logotipo en dos versiones justo en ese borde (clip complementario).
   */
  function pageCover(t, page, beat) {
    const cover = sp(t, beat, 'default');
    const edge = H * (1 - cover);
    put(page, { clip: `inset(${(edge / H * 100).toFixed(3)}% 0 0 0)`, o: cover > 0.001 ? 1 : 0 });
    return edge;
  }

  // ------------------------------------------------------------------ piezas de UI de reemplazo
  /**
   * Tarjeta de REEMPLAZO "TU CLIP AQUÍ": rayas suaves + icono de play + etiqueta. Sustitúyela por un recorte real (img)
   * o por un clip dibujado con C.drawSeq. Devuelve la caja registrada oculta, con _w y _h.
   */
  function placeholder(parent, w, h, o = {}) {
    const label = o.label || 'TU CLIP AQUÍ';
    const box = el('div', { class: 'shot', style: `width:${w}px;height:${h}px;border-radius:${o.radius ?? 26}px;background:${o.bg || 'var(--bg-2)'}` }, parent);
    const fs = Math.max(28, Math.round(Math.min(w, h) * 0.075));
    box.innerHTML = `
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg, transparent 0 34px, rgba(0,0,0,.035) 34px 68px)"></div>
      <div style="position:absolute;left:50%;top:44%;width:${fs * 2.6}px;height:${fs * 2.6}px;margin:-${fs * 1.3}px 0 0 -${fs * 1.3}px;border-radius:50%;background:var(--accent)"></div>
      <div style="position:absolute;left:50%;top:44%;width:0;height:0;margin:-${fs * 0.55}px 0 0 -${fs * 0.3}px;border-left:${fs * 0.95}px solid #fff;border-top:${fs * 0.55}px solid transparent;border-bottom:${fs * 0.55}px solid transparent"></div>
      <div style="position:absolute;left:0;right:0;top:calc(44% + ${fs * 1.8}px);text-align:center;font-weight:700;font-size:${fs}px;letter-spacing:0.08em;color:var(--ink-2)">${label}</div>`;
    box._w = w; box._h = h;
    return reg(box, { o: 0 });
  }

  /** Píldora de UI (CTA, badge, chip). o: { size=40, bg='var(--accent)', color='#fff', border } → caja con _w/_h estimados. */
  function pillEl(parent, text, o = {}) {
    const size = o.size || 40;
    const e = el('div', { class: 'ui-pill', style: `font-size:${size}px;background:${o.bg || 'var(--accent)'};color:${o.color || '#fff'};${o.border ? `box-shadow:inset 0 0 0 ${Math.max(2, size * 0.06)}px ${o.border};` : ''}` }, parent, text);
    return reg(e, { o: 0 });
  }

  /** Barras grises de esqueleto (texto de relleno de una UI). rows: anchos en px. */
  function skeleton(parent, rows, { h = 22, gap = 18, color = 'rgba(0,0,0,.09)' } = {}) {
    const box = el('div', { class: 'abs', style: `width:${Math.max(...rows)}px;height:${rows.length * (h + gap)}px` }, parent);
    rows.forEach((w, i) => el('div', { class: 'abs', style: `top:${i * (h + gap)}px;width:${w}px;height:${h}px;border-radius:${h / 2}px;background:${color}` }, box));
    box._h = rows.length * (h + gap); box._w = Math.max(...rows);
    return reg(box, { o: 0 });
  }

  /**
   * Una pieza de UI entra en su beat. kind:
   *   'grow' → escala 0.7 → 1 con overshoot (popS), visible de golpe (badges, CTA, chips)
   *   'rise' → su contenido sube por la máscara de su propia caja (titulares de la UI, texto)
   *   'fade' → solo para la línea pequeña (nota al pie)
   * c._x/c._y = su posición; para 'rise' el contenido es el primer hijo (c._inner) o la caja entera.
   */
  function enter(t, c, beat, kind, origin = '0 50%') {
    const p = kind === 'rise' ? spHit(t, beat, 'heavy') : popHit(t, beat);
    if (kind === 'grow') put(c, { o: vis(p), x: c._x, y: c._y, s: 0.7 + 0.3 * popS(p), css: { transformOrigin: origin } });
    else if (kind === 'rise') {
      put(c, { o: vis(p), x: c._x, y: c._y, clip: 'inset(-10% -5% 0 -5%)' });
      if (c._inner) put(c._inner, { y: (c._h || 100) * 1.45 * (1 - p) });
    } else put(c, { o: clamp(p * 3), x: c._x, y: c._y + 14 * (1 - p) });
    return p;
  }

  /**
   * Tarjeta en perspectiva FALSA (solo 2D): sube `dy` px, rotada `rot`° con skewY(-skew°) y escala 0.9, y se asienta plana.
   * Nunca perspective / rotateX / translate3d. Devuelve p (0→1).
   */
  function tilt(t, e, x, y, beat, { dy = 440, rot = 5, skew = 5, preset = 'default', extra = '' } = {}) {
    const p = sp(t, beat, preset);
    put(e, { o: vis(p), css: { transform: `translate(${x}px, ${(y + dy * (1 - p)).toFixed(2)}px) rotate(${(rot * (1 - p)).toFixed(3)}deg) skewY(${(-skew * (1 - p)).toFixed(3)}deg) scale(${(0.9 + 0.1 * p).toFixed(4)})${extra}` } });
    return p;
  }

  // ------------------------------------------------------------------ cursor
  /** Flecha negra con borde blanco (se dibuja a 1.35x). Registrada oculta. */
  function cursorEl(parent) {
    const c = el('div', { class: 'cursor' }, parent, `<svg viewBox="0 0 44 56" width="44" height="56"><path d="M6 4 L6 44 L16 34 L23 50 L30 47 L23 31 L37 31 Z" fill="var(--ink)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`);
    return reg(c, { o: 0 });
  }
  /**
   * El cursor se desliza entre paradas [[beat, x, y], …] (resorte default) y se presiona en pressBeat (-14 %, snappy).
   * Visible desde inBeat. Devuelve `press` (0→1→0): úsalo para que la UI responda en el mismo frame (escala 0.95, brillo -6 %).
   */
  function cursor(t, c, keys, pressBeat, inBeat) {
    const x = trk(t, keys.map(([b, x]) => [b, x]), 'default'), y = trk(t, keys.map(([b, , y]) => [b, y]), 'default');
    const press = C.win(t, beatOf(pressBeat) - 0.02, beatOf(pressBeat) + 0.2, 'snappy', 'snappy');
    put(c, { x, y, s: 1.35 * (1 - 0.14 * press), o: C.beatAt(t) >= beatOf(inBeat) ? 1 : 0 });
    return press;
  }

  // ------------------------------------------------------------------ pila, contador, lista
  /**
   * Pila de notificaciones: cada tarjeta cae desde arriba en su beat (snappy) y empuja hacia abajo a las anteriores.
   *   cards: cajas con _w/_h; beats: llegada de cada una; x: columna; top: y de la tarjeta más nueva; gap: px entre tarjetas.
   */
  function stackDrop(t, cards, beats, { x, top, gap = 26 }) {
    const ps = beats.map((b) => popHit(t, b));
    cards.forEach((c, i) => {
      let push = 0;
      for (let j = i + 1; j < cards.length; j++) push += (cards[j]._h + gap) * ps[j];
      put(c, { o: vis(ps[i]), x: x + ((cards[cards.length - 1]._w || c._w) - c._w) / 2, y: lerp(-c._h - 80, top, ps[i]) + push, s: 0.94 + 0.06 * ps[i], css: { transformOrigin: '50% 0' } });
    });
  }

  /**
   * Contador tragamonedas de 2 dígitos (0–29) en columnas enmascaradas. build: counterEl(parent, {x, y, size, color}).
   * run: counter(t, ctr, N, b0, b1, landMark, from=0) → gira de `from` a N desacelerando y se detiene EXACTO en b1 con un bump
   *   del 7 %. Con from > N es una cuenta regresiva (p. ej. 29 → 10): las columnas giran hacia atrás.
   */
  function counterEl(parent, { x, y, size, color = '#fff' }) {
    const cols = [0, 1].map((i) => {
      const m = el('div', { class: 'abs display', style: `left:${x + i * size * 0.6}px;top:${y}px;width:${size * 0.62}px;height:${size}px;overflow:hidden;font-size:${size}px;color:${color};line-height:1` }, parent);
      const strip = el('div', { class: 'abs', style: 'left:0;top:0;width:100%' }, m);
      const digits = i === 0 ? ['', 1, 2] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
      digits.forEach((d, k) => el('div', { class: 'abs', style: `left:0;top:${k * size * 1.35}px;width:100%;text-align:center` }, strip, String(d)));
      reg(m); strip._mask = m; return reg(strip);
    });
    return { cols, size, x, y };
  }
  function counter(t, ctr, N, b0, b1, land = b1, from = 0) {
    const x = seg(t, b0, b1), v = from + (N - from) * (1 - Math.pow(1 - x, 1.3));
    const vv = Math.abs(N - v) < 0.08 ? N : v;                 // la última astilla salta: sin restos del dígito anterior
    const ones = vv % 10, tens = Math.floor(vv / 10) + Math.max(0, ones - 9);
    const hit = spHit(t, land, 'snappy');
    const bump = 1 + 0.07 * Math.sin(Math.PI * clamp(hit)) * (C.beatAt(t) < beatOf(land) + 1 ? 1 : 0);
    put(ctr.cols[0], { y: -tens * ctr.size * 1.35 }); put(ctr.cols[1], { y: -ones * ctr.size * 1.35 });
    for (const c of ctr.cols) put(c._mask, { s: bump, css: { transformOrigin: '50% 70%' } });
    return vv;
  }

  /**
   * Lista que prueba el número: el clip de la tarjeta baja un grupo cada `stepB` beats (snappy).
   * rows: bordes de fila en px dentro de la tarjeta [arriba, fin fila 1, fin fila 2, …]. Devuelve el clip a usar.
   */
  function listClip(t, h, rows, b0, stepB = 0.5, radius = 30) {
    let edge = rows[1];
    for (let k = 2; k < rows.length; k++) edge += (rows[k] - rows[k - 1]) * sp(t, beatOf(b0) + (k - 2) * stepB - 0.06, 'snappy');
    return `inset(0 0 ${Math.max(0, h - edge).toFixed(1)}px 0 round ${radius}px)`;
  }

  /** Pulso final del punto (+35 %) entre b0 y b0+0.35: el cierre nunca queda quieto. Combínalo con dotPop. */
  const pulse = (t, b0) => C.win(t, beatOf(b0), beatOf(b0) + 0.35, 'snappy', 'default');

  window.PUNTO = {
    EARLY, rise, words, popS, popHit, dotPop, vis, cam, microPush, pushSwap, pushPast, irisEl, iris,
    logo, typeOn, pageCover, placeholder, pillEl, skeleton, enter, tilt, cursorEl, cursor,
    stackDrop, counterEl, counter, listClip, pulse,
  };
})();
