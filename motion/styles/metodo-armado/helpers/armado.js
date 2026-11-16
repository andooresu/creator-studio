// Helpers del estilo "Método armado" (window.ARM). Funciones puras de t: construir DOM en build(), animar en run().
// Uso: copia este archivo a film/armado.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="armado.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Nada de timers, Math.random ni estado entre frames.
// Los colores salen de los tokens :root de film/index.html (--bg, --ink, --ink-2, --accent, --title, --tint, --tint-2,
// --shadow como "r,g,b"): cambia la paleta ahí y todo el estilo la sigue.
(() => {
  const { W, H, FMT, put, reg, el, canvas, sp, spHit, seg, clamp, lerp, ease, bt, beatOf, mulberry32 } = C;
  const { line, rise } = TYPE;

  // ---------------------------------------------------------------- formato y retícula
  const TALL = FMT === '9x16';
  const WIDE = FMT === '16x9';
  /** valor por formato: L({ s: cuadrado/4:5/16:9, t: 9:16 }) */
  const L = (o) => (TALL ? o.t : o.s);
  const X0 = WIDE ? 120 : L({ s: 80, t: 72 });            // margen izquierdo de todo el texto
  const CW = W - 2 * X0;                                   // ancho de contenido
  // 9:16: nada clave en el 14 % superior ni en el 20 % inferior (zonas de la plataforma)
  const SAFE = L({ s: { top: 70, bot: H - 90 }, t: { top: 290, bot: 1520 } });

  // ---------------------------------------------------------------- tokens de color (leídos una vez de :root)
  const css = getComputedStyle(document.documentElement);
  const tok = (name, fb) => (css.getPropertyValue(name) || '').trim() || fb;
  const COL = {
    bg: tok('--bg', '#fcfbf8'), ink: tok('--ink', '#1d1b19'), ink2: tok('--ink-2', '#6b655e'),
    accent: tok('--accent', '#ef6a3a'), title: tok('--title', '#5b1a33'),
    tint: tok('--tint', '#fdf0e8'), tint2: tok('--tint-2', '#fbdccb'), shadow: tok('--shadow', '91,26,51'),
  };
  const SH = (a) => `rgba(${COL.shadow},${a})`;           // sombra teñida del color de los títulos

  C.fonts = ['800 100px Display', '700 100px Display', '400 40px UI', '700 40px UI', '900 40px UI'];

  const show = (p) => (p > 0.02 ? 1 : 0);                  // compuerta de opacidad: nada visible fuera de su ventana

  // ---------------------------------------------------------------- fondo: blanco + halo + retícula de puntos que late
  /** Fondo claro con halo radial en (cx, cy) (0..1) y una retícula de puntos de acento. Devuelve D para dots(). */
  function bg(root, cx = 0.86, cy = 0.08) {
    root.style.background = `radial-gradient(ellipse ${W * 0.9}px ${H * 0.7}px at ${cx * 100}% ${cy * 100}%, ${COL.tint2} 0%, ${COL.tint} 38%, ${COL.bg} 72%)`;
    const g = canvas(root), r = mulberry32(7), step = 54, pts = [];
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) pts.push({ x, y, k: r() });
    return { g, pts };
  }
  /** Pinta la retícula en t. Cada beat de `beats` lanza una onda diagonal: los puntos crecen de 3 a 9 px y vuelven. */
  function dots(D, t, beats) {
    const g = D.g; g.clearRect(0, 0, W, H); g.fillStyle = COL.accent;
    for (const d of D.pts) {
      let s = 3;
      for (const b of beats) { const w = bt(b) + d.x / 3600 + d.y / 7200; if (t > w) s += 6 * Math.exp(-(t - w) * 7); }
      g.globalAlpha = Math.min(0.3, 0.05 + 0.05 * d.k + (s - 3) * 0.035); g.fillRect(d.x - s / 2, d.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- transición principal: panel claro que barre
  const PRE = 0.75;                                        // beats de barrido; la escena se declara con pre: ARM.PRE, cut: false
  /** Llamar al inicio de run(): el panel entra y termina EXACTO en S.from. */
  function cover(t, S) {
    const e = ease.inOut(seg(t, beatOf(S.from) - PRE, S.from));
    put(S.root, S.dir === 'left' ? { x: Math.round(W * (1 - e)) } : { y: Math.round(H * (1 - e)) });
    put(S.edge, { o: e < 0.999 ? 1 : 0 });
  }
  /** Prepara la escena como panel: canto de acento de 14 px + sombra teñida. dir 'left' (desde la derecha) o 'up' (desde abajo). */
  function panel(root, S, cx, cy, dir = 'left') {
    S.dir = dir;
    S.edge = el('div', { class: 'abs', style: dir === 'left'
      ? `left:-14px;top:0;width:14px;height:${H}px;background:${COL.accent}`
      : `left:0;top:-14px;width:${W}px;height:14px;background:${COL.accent}` }, root);
    reg(S.edge, { o: 0 });
    root.style.boxShadow = dir === 'left' ? `-30px 0 80px -20px ${SH(0.3)}` : `0 -30px 80px -20px ${SH(0.3)}`;
    root.style.overflow = 'visible';
    return bg(root, cx, cy);
  }
  /** Caja de cámara para el micro push: put(S.push, { s: 1 + 0.035 * seg(t, from, to) }). */
  const pushBox = (root, ox = W / 2, oy = H / 2) => reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:${ox}px ${oy}px` }, root));

  // ---------------------------------------------------------------- tipografía
  /** Título en pila: filas de palabras con máscara. o: { x, y, size, lh=1.14, accent: { fila: [índices] }, color } */
  function title(parent, rows, o) {
    const size = o.size, lh = o.lh || 1.14;
    const ls = rows.map((r, i) => line(parent, r, { x: o.x ?? X0, y: o.y + i * size * lh, size, color: o.color || COL.title, accent: (o.accent || {})[i] }));
    ls.bottom = o.y + rows.length * size * lh;
    return ls;
  }
  /** Sube las filas de un título: fila i en beat + i*step; sale (opcional) en `out`. Primera fila 'heavy' por defecto. */
  const rises = (t, Ls, beat, step = 0.45, out = null, o = {}) =>
    Ls.forEach((l, i) => rise(t, l, beatOf(beat) + i * step, out == null ? null : beatOf(out) + i * 0.05, { stagger: 0.07, ...o }));
  /** Párrafo corto (UI) que envuelve dentro de w. Solo para sublíneas. */
  function para(parent, html, o = {}) {
    const e = el('div', { class: 'abs', style: `left:${o.x ?? X0}px;top:${o.y}px;width:${o.w || CW}px;font:${o.weight || 700} ${o.size || 48}px/1.28 UI;color:${o.color || COL.ink2};${o.center ? 'text-align:center;' : ''}` }, parent, html);
    return reg(e, { o: 0 });
  }
  /** Único fundido permitido: sublíneas pequeñas que suben 40 px. */
  const fadeUp = (t, e, beat, out = null, dy = 40) => {
    const p = spHit(t, beat, 'snappy'); let o = show(p) * clamp(p * 1.4), y = dy * (1 - p);
    if (out != null) { const q = sp(t, out, 'snappy'); o *= 1 - clamp(q * 1.6); y -= 30 * q; }
    put(e, { o, y });
  };

  // ---------------------------------------------------------------- piezas
  /** Chip / píldora sólida con texto. o: { size, bg, fg, weight } (fondo por defecto: color de títulos). */
  function chip(parent, text, o = {}) {
    const s = o.size || 44;
    const e = el('div', { class: 'abs', style: `padding:${s * 0.32}px ${s * 0.62}px ${s * 0.34}px;border-radius:${s}px;background:${o.bg || COL.title};color:${o.fg || '#fff'};font:${o.weight || 900} ${s}px UI;white-space:nowrap;line-height:1;box-shadow:0 14px 30px -12px ${SH(0.5)};transform-origin:0 50%` }, parent, text);
    return reg(e, { o: 0 });
  }
  /** Tarjeta blanca con sombra teñida (contenedor para tu captura o tu clip). o: { w, h, r } */
  function card(parent, o = {}) {
    const w = o.w || 600, h = o.h || 400;
    const e = el('div', { class: 'abs', style: `width:${w}px;height:${h}px;border-radius:${o.r ?? 26}px;background:#fff;overflow:hidden;box-shadow:0 2px 6px ${SH(0.06)},0 30px 60px -20px ${SH(0.55)}` }, parent);
    e._w = w; e._h = h;
    return reg(e, { o: 0 });
  }
  /**
   * Marcador de clip: tarjeta con un dibujo neutro (fondo teñido, botón de play) y la etiqueta "TU CLIP AQUÍ".
   * Sustitúyelo por tu captura (img) o tu secuencia (C.drawSeq) con las mismas medidas.
   */
  function clipCard(parent, w, h, label = 'TU CLIP AQUÍ', o = {}) {
    const c = card(parent, { w, h, r: o.r });
    const hue = o.hue ?? 0;
    el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:radial-gradient(ellipse at ${30 + hue * 17 % 40}% ${35 + hue * 11 % 30}%, #fff 0%, ${COL.tint} 45%, ${COL.tint2} 100%)` }, c);
    const pb = Math.min(w, h) * 0.22;
    el('div', { class: 'abs', style: `left:${(w - pb) / 2}px;top:${(h - pb) / 2 - pb * 0.25}px;width:${pb}px;height:${pb}px;border-radius:50%;background:#fff;box-shadow:0 10px 26px -10px ${SH(0.45)}` }, c,
      `<svg width="${pb}" height="${pb}" viewBox="0 0 54 54"><path d="M22 17 L38 27 L22 37 Z" fill="${COL.accent}"/></svg>`);
    const fs = Math.max(28, Math.round(Math.min(w, h) * 0.075));
    // etiqueta de marcador = texto de UI (data-lint="ui"); se apaga sola si la tarjeta cruza el borde (data-edge-fade)
    el('div', { class: 'abs', 'data-lint': 'ui', 'data-edge-fade': '', style: `left:0;top:${(h + pb) / 2 + fs * 0.2}px;width:${w}px;text-align:center;font:900 ${fs}px UI;letter-spacing:.12em;color:${COL.title}` }, c, label);
    return c;
  }
  /**
   * Fila de lista dibujada (temario, pasos, módulos): número en círculo + texto + barra de progreso fina.
   * Para UI real, cambia el contenido por un recorte de tu captura con las mismas medidas.
   */
  function listRow(parent, n, text, w, h, o = {}) {
    const e = el('div', { class: 'abs', style: `width:${w}px;height:${h}px;border-radius:${h * 0.22}px;background:#fff;box-shadow:0 2px 4px ${SH(0.05)},0 14px 30px -16px ${SH(0.45)}` }, parent);
    const d = h * 0.56;
    el('div', { class: 'abs', style: `left:${h * 0.22}px;top:${(h - d) / 2}px;width:${d}px;height:${d}px;border-radius:50%;background:${o.done ? COL.accent : COL.tint};color:${o.done ? '#fff' : COL.title};font:900 ${d * 0.5}px/${d}px UI;text-align:center` }, e, String(n));
    el('div', { class: 'abs', style: `left:${h * 0.22 + d + h * 0.22}px;top:${h * 0.2}px;font:700 ${Math.max(28, h * 0.3)}px UI;color:${COL.ink};white-space:nowrap` }, e, text);
    el('div', { class: 'abs', style: `left:${h * 0.22 + d + h * 0.22}px;top:${h * 0.68}px;width:${w * 0.45}px;height:${Math.max(6, h * 0.08)}px;border-radius:9px;background:${COL.tint2}` }, e);
    e._w = w; e._h = h;
    return reg(e, { o: 0 });
  }

  /** Tarjeta que sube: desde dy px abajo a escala s0 y asienta en el beat (spHit). o: { dy, s0, preset, out, outDy, tilt } */
  function cardIn(t, elm, x, y, beat, o = {}) {
    const p = spHit(t, beat, o.preset || 'default'), dy = o.dy ?? 140, s0 = o.s0 ?? 0.9, s = s0 + (1 - s0) * p;
    let yy = y + dy * (1 - p), oo = show(p);
    if (o.out != null) { const q = sp(t, o.out, 'default'); yy += (o.outDy ?? H * 0.9) * q; if (q > 0.98) oo = 0; }
    put(elm, { x: x + (elm._w || 0) * (1 - s) / 2, y: yy, s, o: oo, r: (o.tilt || 0) * p });
    return p;
  }
  /** Carrusel horizontal: entra desde +0.9·W en `at`, sale hacia −1.05·W en `out`. */
  function slideItem(t, elm, x, y, at, out = null) {
    const p = spHit(t, at, 'default'), q = out == null ? 0 : sp(t, out, 'default');
    const xx = x + W * 0.9 * (1 - p) - W * 1.05 * q;
    put(elm, { x: Math.round(xx), y, o: show(p) * (q > 0.98 ? 0 : 1) });
    // textos marcados con data-edge-fade (etiquetas, chips) se apagan mientras la tarjeta cruza el borde del cuadro
    const w = elm._w || 0, over = Math.max(0, -xx, xx + w - W), f = Math.max(0, 1 - over / 24);
    elm.querySelectorAll('[data-edge-fade]').forEach((n) => { n.style.opacity = f; });
    return p;
  }

  /** Anillo de acento (5 px) que se posa sobre un elemento. Crear con ring(parent, w, h); animar con ringRun. */
  function ring(parent, w, h, r = 16) {
    const e = el('div', { class: 'abs', style: `border:5px solid ${COL.accent};border-radius:${r}px;box-sizing:border-box;width:${w + 16}px;height:${h + 16}px;box-shadow:0 0 0 8px ${COL.tint2};transform-origin:50% 50%` }, parent);
    return reg(e, { o: 0 });
  }
  /** keys: [[beat, x, y], …]: el anillo aparece con 'snappy' en la primera parada y viaja con 'default' (conserva velocidad). */
  function ringRun(t, e, keys, out = null) {
    const p = spHit(t, keys[0][0], 'snappy');
    const pos = C.trkObj(t, keys.map(([b, x, y]) => [b, { x, y }]), 'default');
    let o = show(p); if (out != null && C.beatAt(t) > beatOf(out)) o = 0;
    put(e, { x: pos.x - 8, y: pos.y - 8, s: 1 + 0.06 * (1 - p), o });
  }

  // ---------------------------------------------------------------- caos → orden
  /**
   * Fichas sueltas e inclinadas que flotan y, en `at`, se transforman en filas ordenadas.
   *   tiles: [{ el (contenedor con o:0), ph (capa caos), fin (capa orden) }]: créalos con chaosTile().
   *   pose i: generada con semilla (mulberry32) dentro de la caja `box` {x0,x1,y0,y1}.
   */
  function chaosTile(parent, i, tw, th, rowW, rowH, rowText) {
    const tile = el('div', { class: 'abs', style: `width:${tw}px;height:${th}px;border-radius:18px;overflow:hidden;background:#fff;transform-origin:50% 50%;box-shadow:0 2px 6px ${SH(0.06)},0 24px 50px -20px ${SH(0.5)}` }, parent);
    const ph = el('div', { class: 'abs', style: `width:${tw}px;height:${th}px` }, tile);
    el('div', { class: 'abs', style: `width:${tw}px;height:${th * 0.66}px;background:radial-gradient(ellipse at ${30 + (i * 23) % 50}% ${40 + (i * 17) % 30}%, #fff 0%, ${COL.tint} 55%, ${COL.tint2} 100%)` }, ph);
    el('div', { class: 'abs', style: `left:${tw * 0.07}px;top:${th * 0.74}px;width:${tw * 0.7}px;height:${th * 0.07}px;border-radius:6px;background:${COL.tint2}` }, ph);
    el('div', { class: 'abs', style: `left:${tw * 0.07}px;top:${th * 0.86}px;width:${tw * 0.42}px;height:${th * 0.06}px;border-radius:6px;background:${COL.tint}` }, ph);
    const fin = listRow(tile, i + 1, rowText, rowW, rowH, { done: false });
    fin.style.boxShadow = 'none';
    reg(ph);
    return { el: reg(tile, { o: 0 }), ph, fin, tw, th, rowW, rowH };
  }
  function chaosPoses(n, box, tw, th, seed = 11) {
    const r = mulberry32(seed), cols = n > 6 ? 3 : 2, rows = Math.ceil(n / cols);
    return Array.from({ length: n }, (_, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      return {
        x: lerp(box.x0, box.x1 - tw, (col + 0.4 * (row % 2)) / Math.max(1, cols - 0.6)) + (r() - 0.5) * 90,
        y: lerp(box.y0, box.y1 - th, row / Math.max(1, rows - 1)) + (r() - 0.5) * 70,
        r: (r() - 0.5) * 34, ph: r() * 6.28,
      };
    });
  }
  /**
   * Por frame: entra cada ficha (eIn[i]), flota mientras m≈0 y se convierte en fila en (rx, ry0 + i*(rowH+gap)).
   * at: beat donde aterriza el morph (pon ahí la palabra clave de la voz). Devuelve las posiciones actuales.
   */
  function chaosRun(t, tiles, poses, o) {
    return tiles.map((T, i) => {
      const P = poses[i];
      const ein = sp(t, beatOf(o.enter) + i * (o.enterStep ?? 0.2), 'default');
      const m = spHit(t, beatOf(o.at) - 0.45 + i * 0.045, 'default');
      const drift = 1 - clamp(m * 3);
      const cx = P.x + 16 * Math.sin(t * 0.9 + P.ph) * drift, cy = P.y + 260 * (1 - ein) + 12 * Math.cos(t * 0.7 + P.ph) * drift;
      const rx = o.rx, ry = o.ry0 + i * (T.rowH + o.gap);
      const w = lerp(T.tw, T.rowW, m), h = lerp(T.th, T.rowH, m);
      const x = lerp(cx, rx, m), y = lerp(cy, ry, m);
      put(T.el, { x, y, r: lerp(P.r + 3 * Math.sin(t * 0.6 + P.ph) * drift, 0, m), s: 0.86 + 0.14 * ein, o: show(ein),
        css: { width: w + 'px', height: h + 'px', borderRadius: lerp(18, T.rowH * 0.22, clamp(m)) + 'px' } });
      put(T.ph, { o: m < 0.5 ? 1 : 0 });          // relevo a mitad del morph: nunca queda una ficha vacía
      put(T.fin, { o: m >= 0.5 ? 1 : 0 });
      return { x, y, m };
    });
  }

  // ---------------------------------------------------------------- secuencia y progreso
  /** n cuadrados redondeados numerados (el último en acento). Animar con pillsRun. */
  function pills(parent, n, size, o = {}) {
    return Array.from({ length: n }, (_, i) => {
      const last = i === n - 1;
      const e = el('div', { class: 'abs', style: `width:${size}px;height:${size}px;border-radius:${size * 0.26}px;background:${last ? COL.accent : COL.title};color:#fff;font:900 ${size * 0.46}px/${size}px UI;text-align:center;box-shadow:0 14px 30px -12px ${SH(0.5)};transform-origin:50% 50%` }, parent, o.labels ? o.labels[i] : String(i + 1));
      return reg(e, { o: 0 });
    });
  }
  /** Suben 60 px con escala 0.6 → 1, una cada `step` beats. x0, y, gap en px. */
  function pillsRun(t, ps, x0, y, size, gap, b0, step = 0.22) {
    ps.forEach((e, i) => {
      const p = spHit(t, beatOf(b0) + i * step, 'snappy');
      put(e, { x: x0 + i * (size + gap), y: y + 60 * (1 - p), s: 0.6 + 0.4 * p, o: show(p) });
    });
  }
  /** Barra segmentada de progreso (n segmentos). Animar con progressRun. */
  function progress(parent, n, x, y, w, h = 8, gap = 10) {
    const sw = (w - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => {
      const track = el('div', { class: 'abs', style: `left:${x + i * (sw + gap)}px;top:${y}px;width:${sw}px;height:${h}px;border-radius:${h}px;background:${COL.tint2};overflow:hidden` }, parent);
      const fill = el('div', { class: 'abs', style: `width:${sw}px;height:${h}px;background:${COL.accent};transform-origin:0 50%` }, track);
      reg(track, { o: 0 });
      return { track, fill: reg(fill, { sx: 0 }) };
    });
  }
  /** Segmento i se llena con 'snappy' en ats[i]; la barra aparece en `enter`. */
  function progressRun(t, segs, enter, ats) {
    const on = show(spHit(t, enter, 'snappy'));
    segs.forEach((s, i) => { put(s.track, { o: on }); put(s.fill, { sx: clamp(spHit(t, ats[i], 'snappy')) }); });
  }

  /** Contador que corre de a → b entre b0 y b1 (ease.out) y aterriza exacto. Pon tick cada medio beat y thump en b1. */
  function counter(t, e, a, b, b0, b1, { prefix = '', suffix = '' } = {}) {
    const k = ease.out(seg(t, b0, b1));
    put(e, { text: prefix + (k >= 1 ? b : Math.floor(a + (b - a) * k)).toLocaleString('es-419') + suffix });
    return k;
  }

  /** Latido de la píldora final: +7 % en cada beat de `beats` (pon uno por compás). */
  const pulse = (t, beats, amp = 0.07) => 1 + amp * beats.reduce((s, k) => s + sp(t, k, 'snappy') - sp(t, beatOf(k) + 0.3, 'default'), 0);

  window.ARM = {
    TALL, WIDE, L, X0, CW, SAFE, COL, SH, PRE, show,
    bg, dots, cover, panel, pushBox,
    title, rises, para, fadeUp,
    chip, card, clipCard, listRow, cardIn, slideItem, ring, ringRun,
    chaosTile, chaosPoses, chaosRun,
    pills, pillsRun, progress, progressRun, counter, pulse,
  };
})();
