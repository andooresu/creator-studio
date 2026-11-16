// Helpers del estilo "Producto por dentro" (window.PPD). Funciones puras de t: construir DOM en build(), animar en run().
// Uso: copia este archivo a film/producto.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="producto.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Sin timers, sin Math.random, sin estado entre frames.
// Los colores salen de los tokens de :root (--bg, --ink, --ink-2, --accent, --head, --tint, --tint-2): cambia la marca ahí.
(() => {
  const C = window.C;
  const { W, H, FMT, pick, put, reg, el, canvas, sp, spHit, trk, seg, clamp, lerp, ease, bt, beatOf, mulberry32 } = C;
  const { line, rise } = window.TYPE;

  // ------------------------------------------------------------------ formato y tokens
  /** Clave de formato: 'w' (16:9), 's' (1:1 y 4:5), 't' (9:16). L({w, s, t}) devuelve el valor del formato actual. */
  const FK = FMT === '16x9' ? 'w' : FMT === '9x16' ? 't' : 's';
  const L = (o) => o[FK];
  /** Borde izquierdo de toda la tipografía y primer renglón (9:16 despeja el 14 % superior). */
  const X0 = L({ w: 120, s: 80, t: 72 });
  const TOP = L({ w: 150, s: 80, t: 290 });
  /** Lee un token de color de :root (una vez, en build). */
  const tok = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  const show = (p) => (p > 0.02 ? 1 : 0);

  // ------------------------------------------------------------------ tipografía
  /** Titular apilado: renglones de palabras con máscara. accent = {fila: [índices de palabra]}. */
  function title(parent, rows, o = {}) {
    const size = o.size, lh = o.lh ?? 1.17;
    return rows.map((r, i) => {
      const ln = line(parent, r, { x: o.x ?? X0, y: (o.y ?? TOP) + i * size * lh, size, color: o.color || 'var(--head)', accent: (o.accent || {})[i] });
      if (o.weight) ln.el.style.fontWeight = o.weight;
      return ln;
    });
  }
  /** Un renglón cada `step` beats desde `beat` (por defecto 0,5: un renglón por medio beat). */
  const rises = (t, Ls, beat, step = 0.5, o = {}) => Ls.forEach((l, i) => rise(t, l, beatOf(beat) + i * step, null, { stagger: 0.07, ...o }));

  // ------------------------------------------------------------------ fondo: halo + rejilla de puntos que late
  /** Fondo claro con halo radial en (cx, cy) (fracciones del cuadro) y rejilla de puntos sembrada. Devuelve D para dots(). */
  function bg(root, cx = 0.86, cy = 0.1, seed = 7) {
    root.style.background = `radial-gradient(ellipse ${W * 0.9}px ${H * 0.7}px at ${cx * 100}% ${cy * 100}%, var(--tint-2) 0%, var(--tint) 38%, var(--bg) 72%)`;
    const g = canvas(root), r = mulberry32(seed), step = pick(56, 54, 54), pts = [];
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) pts.push({ x, y, k: r() });
    return { g, pts, color: tok('--accent', '#0e9f6e') };
  }
  /** Dibuja la rejilla: cada beat listado manda una onda diagonal que agranda los puntos (3 → 9 px). 3–5 beats por escena. */
  function dots(D, t, beats) {
    const g = D.g; g.clearRect(0, 0, W, H); g.fillStyle = D.color;
    for (const d of D.pts) {
      let s = 3;
      for (const b of beats) { const w = bt(b) + d.x / 3600 + d.y / 7200; if (t > w) s += 6 * Math.exp(-(t - w) * 7); }
      g.globalAlpha = Math.min(0.32, 0.05 + 0.05 * d.k + (s - 3) * 0.035);
      g.fillRect(d.x - s / 2, d.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ transición: panel claro que cubre
  /** Duración de la cobertura en beats. La escena usa { pre: PRE, cut: false }. */
  const PRE = 0.75;
  /** Convierte la raíz de la escena en un panel que entra 'up' (desde abajo) o 'left' (desde la derecha), con filo de acento de 14 px. */
  function panel(root, S, cx, cy, dir = 'up') {
    S.dir = dir;
    const edge = dir === 'left' ? `left:-14px;top:0;width:14px;height:${H}px` : `left:0;top:-14px;width:${W}px;height:14px`;
    S.edge = reg(el('div', { class: 'abs', style: `${edge};background:var(--accent)` }, root), { o: 0 });
    root.style.boxShadow = dir === 'left' ? '-30px 0 80px -20px var(--shadow)' : '0 -30px 80px -20px var(--shadow)';
    root.style.overflow = 'visible';
    return bg(root, cx, cy);
  }
  /** Llamar al principio de run(): mueve el panel con ease.inOut y lo completa exactamente en S.from. El filo solo se ve en movimiento. */
  function cover(t, S) {
    const e = ease.inOut(seg(t, beatOf(S.from) - PRE, S.from));
    put(S.root, S.dir === 'left' ? { x: Math.round(W * (1 - e)) } : { y: Math.round(H * (1 - e)) });
    put(S.edge, { o: e < 0.999 ? 1 : 0 });
    return e;
  }
  /** Caja de cámara a tamaño completo para el micro-empuje de cada escena: put(S.push, {s: 1 + 0.04 * seg(t, from, to)}). */
  const pushBox = (root) => reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:${W / 2}px ${H / 2}px` }, root));
  function push(t, S, amt = 0.04) { put(S.push, { s: 1 + amt * seg(t, S.from, S.to) }); }

  // ------------------------------------------------------------------ tarjetas de UI
  /**
   * Tarjeta de UI con recorte: envuelve una captura real (src) o queda vacía para dibujar dentro.
   *   w, h: tamaño visible en px del film. o.img = [ancho, alto] de la imagen si es más grande que la tarjeta.
   *   o.r radio, o.flat sin sombra.
   */
  function uiCard(parent, w, h, o = {}) {
    const wrap = el('div', { class: 'ui', 'data-lint': 'ui', style: `width:${w}px;height:${h}px;border-radius:${o.r ?? 18}px;${o.flat ? 'box-shadow:none;background:transparent;' : ''}${o.css || ''}` }, parent);
    if (o.src) el('img', { src: o.src, style: `width:${(o.img || [w, h])[0]}px;height:${(o.img || [w, h])[1]}px` }, wrap);
    wrap._w = w; wrap._h = h;
    return reg(wrap, { o: 0 });
  }
  /**
   * Marcador de posición para material que pondrá el usuario: trama diagonal, borde discontinuo de acento y rótulo.
   * Úsalo en plantillas y bocetos; en el video final se reemplaza por la captura o el clip real.
   */
  function placeholder(parent, w, h, label = 'TU CLIP AQUÍ', o = {}) {
    const size = o.size ?? Math.max(28, Math.round(Math.min(w, h) * 0.075));
    const card = uiCard(parent, w, h, { r: o.r ?? 18, flat: o.flat });
    el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:repeating-linear-gradient(135deg, var(--tint) 0 22px, var(--tint-2) 22px 44px)` }, card);
    el('div', { class: 'abs', style: `left:14px;top:14px;width:${w - 28}px;height:${h - 28}px;border:4px dashed var(--accent);border-radius:${Math.max(6, (o.r ?? 18) - 8)}px;box-sizing:border-box;opacity:.55` }, card);
    el('div', { class: 'abs', style: `width:${w}px;top:${h / 2 - size * 0.7}px;text-align:center;font:700 ${size}px/1.4 UI, sans-serif;letter-spacing:.12em;color:var(--head)` }, card, label);
    return card;
  }
  /** Card rise: sube desde dy px abajo, escala 0,9 → 1 y aparece de golpe en su beat. heavy = piezas grandes, default = tarjetas, snappy = cajas chicas. */
  function cardIn(t, elm, x, y, beat, o = {}) {
    const p = spHit(t, beat, o.preset || 'default'), dy = o.dy ?? 140, s = 0.9 + 0.1 * p;
    put(elm, { x: x + elm._w * (1 - s) / 2, y: y + dy * (1 - p), s, o: show(p), ...(o.extra || {}) });
    return p;
  }
  /**
   * Crecer de algo: interpola un elemento desde el rectángulo de origen (fila, pin, fragmento) hasta su destino.
   *   from = {x, y, w, h} en px del film; to = {x, y}; el tamaño final es elm._w × elm._h. Devuelve el progreso.
   *   o.hit = false usa sp (sin adelanto): para cuando el crecimiento arranca justo en un corte y debe partir del origen.
   */
  function growFrom(t, elm, from, to, beat, o = {}) {
    const p = o.hit === false ? sp(t, beat, o.preset || 'default') : spHit(t, beat, o.preset || 'default');
    const sx = lerp(from.w / elm._w, 1, p), sy = lerp(o.uniform ? from.w / elm._w : from.h / elm._h, 1, p);
    const cx = lerp(from.x + from.w / 2, to.x + elm._w / 2, p), cy = lerp(from.y + from.h / 2, to.y + elm._h / 2, p);
    put(elm, { x: cx - elm._w * sx / 2, y: cy - elm._h * sy / 2, sx, sy, o: show(p) });
    return p;
  }
  /** Anillo de selección (marco de 5 px de acento) sobre un rectángulo; escala 1,05 → 1 en snappy. */
  function ring(parent, r = 14) {
    return reg(el('div', { class: 'abs', style: `border:5px solid var(--accent);border-radius:${r}px;box-sizing:border-box` }, parent), { o: 0 });
  }
  function runRing(t, e, rect, beat, pad = 8) {
    const p = spHit(t, beat, 'snappy');
    put(e, { x: rect.x - pad, y: rect.y - pad, o: show(p), s: 1 + 0.05 * (1 - p), css: { width: rect.w + pad * 2 + 'px', height: rect.h + pad * 2 + 'px' } });
    return p;
  }

  // ------------------------------------------------------------------ cursor que actúa
  const CUR_SVG = '<svg width="46" height="64" viewBox="0 0 23 32"><path d="M1.2 1.2 L1.2 24.2 L7.2 18.7 L11.6 29.2 L15.6 27.4 L11.2 17.2 L19.2 17.2 Z" fill="var(--ink)" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  /** Cursor flecha + anillo de clic de 90 px. Su escala sube por formato para leerse en el teléfono. */
  function cursor(root) {
    const ringEl = el('div', { class: 'abs', style: 'width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;border:5px solid var(--accent)' }, root);
    const c = el('div', { class: 'abs', style: 'margin:-3px 0 0 -3px;transform-origin:3px 3px;z-index:20' }, root, CUR_SVG);
    c._sz = pick(1.1, 1.2, 1.4);
    reg(ringEl, { o: 0 }); reg(c, { o: 0 });
    return { c, ring: ringEl };
  }
  /**
   * keys: [[beat, x, y], …] (la primera es la entrada, normalmente desde abajo a la derecha, 1–1,2 beats antes del clic).
   * y se asienta 0,14 beat después que x, así el recorrido describe un arco. Se hunde 14 % al pulsar en clickBeat (SFX click).
   */
  function runCursor(t, Cu, keys, clickBeat) {
    const x = trk(t, keys.map((k) => [k[0], k[1]]), 'default');
    const y = trk(t, keys.map((k) => [beatOf(k[0]) + 0.14, k[2]]), 'default');
    const press = spHit(t, clickBeat, 'snappy', 0.03) - sp(t, beatOf(clickBeat) + 0.35, 'snappy');
    put(Cu.c, { x, y, o: t >= bt(keys[0][0]) - 0.05 ? 1 : 0, s: Cu.c._sz * (1 - 0.14 * press) });
    const u = clamp((t - (bt(clickBeat) - C.leadFor('snappy'))) / 0.45);
    put(Cu.ring, { x, y, o: u > 0 && u < 1 ? 1 - u : 0, s: 0.25 + 1.4 * ease.out(u) });
    return press;
  }

  // ------------------------------------------------------------------ listas, contadores, rejillas
  /**
   * Cascada de lista + scroll dentro de su ventana de recorte. rows = elementos con _h; cada fila cae (x +60, y +80 → 0)
   * una cada `every` beats desde b0; luego la lista sube `scroll` px con ease.inOut entre s0 y s1. Devuelve el scroll actual.
   */
  function cascade(t, list, rows, b0, { every = 0.25, gap = 12, x = 0, scroll = 0, s0 = null, s1 = null } = {}) {
    const sc = s0 == null ? 0 : scroll * ease.inOut(seg(t, s0, s1));
    put(list, { x, y: 12 - sc });
    let y = 0;
    rows.forEach((m, i) => {
      const p = sp(t, beatOf(b0) + i * every, 'default');
      put(m, { x: 60 * (1 - p), y: y + 80 * (1 - p), o: show(p) });
      y += m._h + gap;
    });
    return sc;
  }
  /** Ventana de recorte para una lista: nunca hace scroll por encima del titular. Devuelve { clip, list }. */
  function listWindow(parent, top, bottom) {
    const clip = el('div', { class: 'abs', style: `left:0;top:${top - 12}px;width:${W}px;height:${bottom - top + 12}px;overflow:hidden` }, parent);
    return { clip, list: reg(el('div', { class: 'abs' }, clip)) };
  }
  /** Contador de rodillo cuantizado: avanza un paso cada `step` beats de 0 a N entre b0 y b1 (pon un tick por paso y un thump en b1). */
  function counter(t, wordEl, N, b0, b1, { step = 0.25, fmt = (n) => String(n) } = {}) {
    const b = C.beatAt(t), a = beatOf(b0), z = beatOf(b1);
    const k = b < a ? 0 : clamp(Math.floor((b - a) / step + 1e-6) / ((z - a) / step));
    const n = Math.round(N * k);
    put(wordEl, { text: fmt(n) });
    return n;
  }
  /**
   * Tarjetas que caen en rejilla: una por beat (las impares +0,12), 240 px con rotación ±4° → 0, en snappy.
   * La elegida (sel) se levanta 24 px y escala 1,06 en liftAt y baja a medias en liftAt + 1,4.
   */
  function dropGrid(t, cards, beats, g, { sel = -1, liftAt = null } = {}) {
    const ch = g.h ?? g.w * 1.25;
    const lift = liftAt == null ? 0 : spHit(t, liftAt, 'snappy') - sp(t, beatOf(liftAt) + 1.4, 'default') * 0.6;
    cards.forEach((c, i) => {
      const col = i % g.cols, row = Math.floor(i / g.cols);
      const p = spHit(t, beatOf(beats[i]) + (i % 2 ? 0.12 : 0), 'snappy');
      const x = g.x0 + col * (g.w + g.gap), y = g.y + row * (ch + g.gap);
      const l = i === sel ? lift : 0, sc = 1 + 0.06 * l;
      put(c, { x: x - g.w * (sc - 1) / 2, y: y + 240 * (1 - p) - 24 * l - ch * (sc - 1) / 2, s: sc, o: show(p), r: (1 - p) * (i % 2 ? 4 : -4) });
    });
    const col = sel % g.cols, row = Math.floor(sel / g.cols);
    return { x: g.x0 + col * (g.w + g.gap), y: g.y + row * (ch + g.gap), w: g.w, h: ch };
  }
  /** Recorrido de resaltado: las celdas se encienden una tras otra cada `every` beats (+16 % y anillo de acento). */
  function highlightWalk(t, cells, b0, every = 0.75) {
    cells.forEach((c, i) => {
      const a = beatOf(b0) + i * every;
      const on = spHit(t, a, 'snappy') - sp(t, a + every, 'default');
      put(c, { s: 1 + 0.16 * on, css: { boxShadow: on > 0.05 ? `0 0 0 ${Math.round(5 * on)}px var(--accent)` : 'none' } });
    });
  }

  // ------------------------------------------------------------------ pin, píldoras, cierre
  /** Pin de acento con aro blanco y pulso que se expande. Devuelve { pin, pulse } para runPin. */
  function pin(parent, d = pick(46, 40, 50)) {
    const pulse = reg(el('div', { class: 'abs', style: `width:${d * 3}px;height:${d * 3}px;margin:${-d * 1.5}px 0 0 ${-d * 1.5}px;border-radius:50%;border:5px solid var(--accent);box-sizing:border-box;transform-origin:50% 50%` }, parent), { o: 0 });
    const p = reg(el('div', { class: 'abs', style: `width:${d}px;height:${d}px;margin:${-d / 2}px 0 0 ${-d / 2}px;border-radius:50%;background:var(--accent);border:${d * 0.18}px solid #fff;box-sizing:border-box;box-shadow:0 10px 24px -6px var(--shadow);transform-origin:50% 50%` }, parent), { o: 0 });
    return { pin: p, pulse };
  }
  /** El pin cae 160 px y escala 0,6 → 1 en `beat`; deja un anillo que se expande en 0,9 s. */
  function runPin(t, P, x, y, beat) {
    const p = spHit(t, beat, 'snappy');
    put(P.pin, { x, y: y - 160 * (1 - p), s: 0.6 + 0.4 * p, o: show(p) });
    const u = clamp((t - bt(beat)) / 0.9);
    put(P.pulse, { x, y, s: 0.3 + 0.9 * ease.out(u), o: u > 0 && u < 1 ? 1 - u : 0 });
    return p;
  }
  /** Píldora de etiqueta (UI 700): sube 30 px y escala 0,85 → 1 en snappy. */
  function tagIn(t, e, x, y, beat) {
    const p = spHit(t, beat, 'snappy');
    put(e, { x, y: y + 30 * (1 - p), s: 0.85 + 0.15 * p, o: show(p) });
    return p;
  }
  /** Respiración de la píldora CTA: +7 % en cada beat listado. */
  const pulseAt = (t, beats) => beats.reduce((a, k) => a + 0.07 * (spHit(t, k, 'snappy') - sp(t, beatOf(k) + 0.3, 'default')), 0);
  /** Píldora CTA: crece desde su borde izquierdo (0,8 → 1) y respira en `beats`. transform-origin del elemento: izquierda-centro. */
  function ctaPill(t, e, x, y, beat, beats = []) {
    const p = spHit(t, beat, 'snappy'), s = (0.8 + 0.2 * p) * (1 + pulseAt(t, beats));
    put(e, { x, y, s, o: show(p) });
    return p;
  }
  /** Golpe del lockup: baja 40 px y escala 1,25 → 1 en heavy. */
  function lockupHit(t, e, x, y, beat) {
    const p = spHit(t, beat, 'heavy');
    put(e, { x, y: y - 40 * (1 - p), s: 1.25 - 0.25 * p, o: show(p) });
    return p;
  }

  window.PPD = {
    FK, L, X0, TOP, tok, show, title, rises, bg, dots, PRE, panel, cover, pushBox, push,
    uiCard, placeholder, cardIn, growFrom, ring, runRing, cursor, runCursor,
    cascade, listWindow, counter, dropGrid, highlightWalk, pin, runPin, tagIn, pulseAt, ctaPill, lockupHit,
  };
})();
