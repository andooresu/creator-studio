// Helpers del estilo "Paneles con UI" (window.PAN). Funciones puras de t: construye el DOM en build(), anima en run().
// Uso: copia este archivo a film/paneles.js y cárgalo en film/index.html ANTES de film.js:
//   <script src="paneles.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Lee los colores de los tokens de :root en film/index.html:
//   --bg --ink --ink-2 --accent --title --tint --tint-2 --card --shadow-rgb ("r,g,b" de la tinta de títulos)
// Nada de timers, Math.random ni estado entre frames: todo lo que se mueve se calcula desde t en cada frame.
(() => {
  const C = window.C, TYPE = window.TYPE;
  const { W, H, FMT, pick, put, reg, el, canvas, sp, spHit, trk, seg, clamp, lerp, ease, bt, beatOf, mulberry32 } = C;

  // ---------------------------------------------------------------- tokens y layout
  const cs = getComputedStyle(document.documentElement);
  const tok = (name, def) => (cs.getPropertyValue(name).trim() || def);
  const COL = {
    bg: tok('--bg', '#fdfcff'), ink: tok('--ink', '#16131f'), ink2: tok('--ink-2', '#625a72'), accent: tok('--accent', '#7048e8'),
    title: tok('--title', '#2a1863'), tint: tok('--tint', '#f3efff'), tint2: tok('--tint-2', '#e4dbff'), card: tok('--card', '#fefdff'),
    shadow: tok('--shadow-rgb', '42,24,99'),
  };
  const sh = (a) => `rgba(${COL.shadow},${a})`;

  /** Clave de formato: 'w' 16:9, 't' 9:16, 's' cuadrado y 4:5. L({w, s, t}) devuelve el objeto de layout del formato. */
  const FK = FMT === '16x9' ? 'w' : FMT === '9x16' ? 't' : 's';
  const L = (o) => o[FK] ?? o.s;
  const X0 = L({ w: 120, s: 80, t: 72 });      // borde izquierdo de todo el texto
  const TOP = L({ w: 150, s: 80, t: 290 });    // primera línea de título (en 9:16 libra el 14 % superior)
  const show = (p) => (p > 0.02 ? 1 : 0);      // la opacidad hace snap: nunca un fundido

  // ---------------------------------------------------------------- títulos
  /** Título apilado: filas de palabras en máscara. o = { x, y, size, lh=1.17, color, accent: {fila: [índices]} } */
  function title(parent, rows, o = {}) {
    const size = o.size || 120, lh = o.lh || 1.17;
    return rows.map((r, i) => TYPE.line(parent, r, { x: o.x ?? X0, y: (o.y ?? TOP) + i * size * lh, size, color: o.color || COL.title, accent: (o.accent || {})[i] }));
  }
  /** Sube un bloque de líneas: la línea i entra en beat + i*step. o se pasa a TYPE.rise (stagger, preset, exit). */
  const rises = (t, Ls, beat, step = 0.45, out = null, o = {}) => Ls.forEach((l, i) => TYPE.rise(t, l, beatOf(beat) + i * step, out, { stagger: 0.08, ...o }));

  // ---------------------------------------------------------------- fondo: halo + retícula viva
  /** Fondo claro con halo de un tinte en (cx, cy) (fracciones del cuadro) y una retícula de puntos sembrada. */
  function bg(root, cx = 0.86, cy = 0.08) {
    root.style.background = `radial-gradient(ellipse ${W * 0.9}px ${H * 0.7}px at ${cx * 100}% ${cy * 100}%, ${COL.tint2} 0%, ${COL.tint} 38%, ${COL.bg} 72%)`;
    const g = canvas(root), r = mulberry32(7), step = pick(56, 54, 54), pts = [];
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) pts.push({ x, y, k: r() });
    return { g, pts };
  }
  /** Dibuja la retícula: puntos de 3 px en el acento que se inflan como una onda diagonal en cada beat de `beats`. */
  function dots(D, t, beats) {
    const g = D.g; g.clearRect(0, 0, W, H); g.fillStyle = COL.accent;
    for (const d of D.pts) {
      let s = 3;
      for (const b of beats) { const w = bt(b) + d.x / 3600 + d.y / 7200; if (t > w) s += 6 * Math.exp(-(t - w) * 7); }
      g.globalAlpha = Math.min(0.32, 0.05 + 0.05 * d.k + (s - 3) * 0.035); g.fillRect(d.x - s / 2, d.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- transición: panel que cubre
  const PRE = 0.75;   // la escena se registra con { pre: PAN.PRE, cut: false }
  /** Prepara la raíz de la escena como panel: filo de acento de 14 px en el borde de ataque + sombra tintada. dir 'up' | 'left'. */
  function panel(root, S, cx, cy, dir = 'up') {
    S.dir = dir;
    S.edge = el('div', { class: 'abs', style: dir === 'left' ? `left:-14px;top:0;width:14px;height:${H}px;background:${COL.accent}` : `left:0;top:-14px;width:${W}px;height:14px;background:${COL.accent}` }, root);
    reg(S.edge, { o: 0 });
    root.style.boxShadow = dir === 'left' ? `-30px 0 80px -20px ${sh(0.3)}` : `0 -30px 80px -20px ${sh(0.3)}`;
    root.style.overflow = 'visible';
    return bg(root, cx, cy);
  }
  /** Llamar primero en run(): desliza el panel (ease.inOut) y termina exacto en S.from; el filo se apaga al completar. */
  function cover(t, S) {
    const e = ease.inOut(seg(t, beatOf(S.from) - PRE, S.from));
    put(S.root, S.dir === 'left' ? { x: Math.round(W * (1 - e)) } : { y: Math.round(H * (1 - e)) });
    put(S.edge, { o: e < 0.999 ? 1 : 0 });
    return e;
  }
  /** Caja de cámara para el micro empuje de la escena (origen por defecto al centro). */
  const pushBox = (root, ox = W / 2, oy = H / 2) => reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:${ox}px ${oy}px` }, root));
  /** Micro empuje 1 → 1 + amt a lo largo de [from, to]. */
  const hold = (t, box, from, to, amt = 0.04) => put(box, { s: 1 + amt * seg(t, from, to) });

  // ---------------------------------------------------------------- piezas
  /** Captura real de UI dentro de una tarjeta que recorta. size = [ancho, alto] en px css de la captura; k = escala a px del film.
   *  o = { r: radio, h: alto visible (css, recorta abajo), w: ancho visible (css), flat: sin sombra ni fondo } */
  function shot(parent, src, size, k, o = {}) {
    const [w, h] = size, vh = (o.h || h) * k, vw = (o.w || w) * k;
    const wrap = el('div', { class: 'ui', style: `width:${vw}px;height:${vh}px;border-radius:${o.r ?? 14 * k}px;${o.flat ? 'box-shadow:none;background:transparent;' : ''}` }, parent);
    el('img', { src, style: `width:${w * k}px;height:${h * k}px` }, wrap);
    wrap._w = vw; wrap._h = vh;
    return reg(wrap, { o: 0 });
  }
  /** Tarjeta de reemplazo para metraje que aún no existe: trama de tinte, botón de play y etiqueta. Cámbiala por tu clip. */
  function placeholder(parent, w, h, o = {}) {
    const r = o.r ?? Math.round(Math.min(w, h) * 0.05);
    const wrap = el('div', { class: 'ui', style: `width:${w}px;height:${h}px;border-radius:${r}px;background:${COL.tint}` }, parent);
    const cv = el('canvas', { width: Math.round(w), height: Math.round(h), style: `width:${w}px;height:${h}px` }, wrap);
    const g = cv.getContext('2d');
    g.strokeStyle = COL.tint2; g.lineWidth = Math.max(6, w / 90);
    for (let x = -h; x < w + h; x += w / 14) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); }
    const d = Math.min(w, h) * (o.play ?? 0.24), cx = w / 2, cy = h * 0.44;
    g.fillStyle = COL.accent; g.beginPath(); g.arc(cx, cy, d / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = COL.card; g.beginPath(); g.moveTo(cx - d * 0.13, cy - d * 0.2); g.lineTo(cx + d * 0.22, cy); g.lineTo(cx - d * 0.13, cy + d * 0.2); g.closePath(); g.fill();
    if (o.label !== false) {
      const fs = o.labelSize || Math.max(30, Math.round(w / 22));
      el('div', { class: 'abs', style: `left:0;top:${cy + d / 2 + fs * 0.8}px;width:${w}px;text-align:center;font:800 ${fs}px UI;letter-spacing:.08em;color:${COL.title}` }, wrap, o.label || 'TU CLIP AQUÍ');
    }
    if (o.bar) el('div', { class: 'abs', style: `left:0;top:${h - 8}px;width:${w * o.bar}px;height:8px;background:${COL.accent}` }, wrap);
    wrap._w = w; wrap._h = h;
    return reg(wrap, { o: 0 });
  }
  /** Interfaz genérica dibujada (ventana con barra, filas y botón opcional) para maquetas y demos.
   *  o = { w, head: 'Título', rows: ['texto', …], rowH, button: 'Texto', size } → wrap con _rows / _btn (rects locales) */
  function uiCard(parent, o = {}) {
    const w = o.w || 900, fs = o.size || 42, rowH = o.rowH || fs * 2.9, barH = fs * 1.6, headH = o.head ? fs * 2.4 : 0, gap = fs * 0.4, pad = fs * 0.8;
    const btnH = o.button ? fs * 2.6 : 0;
    const h = barH + headH + (o.rows || []).length * (rowH + gap) + (o.button ? btnH + pad : 0) + pad;
    const wrap = el('div', { class: 'ui', style: `width:${w}px;height:${h}px;border-radius:${fs * 0.6}px;background:${COL.card}` }, parent);
    const bar = el('div', { class: 'abs', style: `width:${w}px;height:${barH}px;background:${COL.tint};border-bottom:2px solid ${COL.tint2}` }, wrap);
    [0, 1, 2].forEach((i) => el('div', { class: 'abs', style: `left:${pad + i * fs * 0.75}px;top:${barH / 2 - fs * 0.2}px;width:${fs * 0.4}px;height:${fs * 0.4}px;border-radius:50%;background:${i === 0 ? COL.accent : COL.tint2}` }, bar));
    let y = barH;
    if (o.head) { el('div', { class: 'abs', style: `left:${pad}px;top:${y + fs * 0.6}px;font:800 ${fs * 1.05}px UI;color:${COL.title};white-space:nowrap` }, wrap, o.head); y += headH; }
    wrap._rows = (o.rows || []).map((txt) => {
      const r = { x: pad, y: y + gap / 2, w: w - pad * 2, h: rowH };
      const row = el('div', { class: 'abs', style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:${fs * 0.4}px;background:${COL.bg};border:2px solid ${COL.tint2};box-sizing:border-box` }, wrap);
      el('div', { class: 'abs', style: `left:${fs * 0.6}px;top:${rowH / 2 - fs * 0.5}px;width:${fs}px;height:${fs}px;border-radius:${fs * 0.25}px;background:${COL.tint2}` }, row);
      el('div', { class: 'abs', style: `left:${fs * 2.1}px;top:${rowH / 2 - fs * 0.62}px;font:700 ${fs}px UI;color:${COL.ink};white-space:nowrap` }, row, txt);
      y += rowH + gap;
      return r;
    });
    if (o.button) {
      const bw = Math.min(w - pad * 2, fs * 9);
      wrap._btn = { x: w - pad - bw, y: y + pad / 2, w: bw, h: btnH };
      el('div', { class: 'abs', style: `left:${wrap._btn.x}px;top:${wrap._btn.y}px;width:${bw}px;height:${btnH}px;display:flex;align-items:center;justify-content:center;border-radius:${btnH / 2}px;background:${COL.accent};color:${COL.card};font:800 ${fs}px/1 UI` }, wrap, o.button);
    }
    wrap._w = w; wrap._h = h;
    return reg(wrap, { o: 0 });
  }
  /** Tarjeta que sube: entra desde abajo dy px, de 0.9 → 1, y asienta en el beat (spHit). o = { dy=140, preset='default', r: giro inicial } */
  function cardIn(t, elm, x, y, beat, o = {}) {
    const p = spHit(t, beat, o.preset || 'default'), dy = o.dy ?? 140, s = 0.9 + 0.1 * p;
    put(elm, { x: x + elm._w * (1 - s) / 2, y: y + dy * (1 - p), s, o: show(p), r: (o.r || 0) * (1 - p) });
    return p;
  }

  // ---------------------------------------------------------------- resaltes y remates
  /** Anillo de resalte (contorno de 5 px en el acento). */
  const ringEl = (parent, r = 12) => reg(el('div', { class: 'abs', style: `border:5px solid ${COL.accent};border-radius:${r}px;box-sizing:border-box` }, parent), { o: 0 });
  /** Cierra el anillo (1.06 → 1, snappy) sobre la caja x, y, w, h en el beat. Lleva SFX pop o click. */
  function ringOn(t, R, beat, x, y, w, h, pad = 10) {
    const p = spHit(t, beat, 'snappy');
    put(R, { x: x - pad, y: y - pad, o: show(p), s: 1 + 0.06 * (1 - p), css: { width: w + pad * 2 + 'px', height: h + pad * 2 + 'px' } });
    return p;
  }
  /** Detalle que crece del original: elm (con _w/_h) sale del rect `from` y aterriza en `to` {x, y} a escala 1. preset default. */
  function growFrom(t, elm, from, to, beat, o = {}) {
    const p = spHit(t, beat, o.preset || 'default', o.lead), s = lerp(o.s0 ?? Math.min(0.5, (from.w / elm._w) * 1.2), 1, p);
    put(elm, { x: lerp(from.x + from.w / 2, to.x + elm._w / 2, p) - elm._w * s / 2, y: lerp(from.y + from.h / 2, to.y + elm._h / 2, p) - elm._h * s / 2, s, o: show(p) });
    return p;
  }
  /** Check en círculo de acento (diámetro d), centrado en su punto. */
  function badge(parent, d) {
    const c = el('div', { class: 'abs', style: `width:${d}px;height:${d}px;margin:${-d / 2}px 0 0 ${-d / 2}px;border-radius:50%;background:${COL.accent};transform-origin:50% 50%;box-shadow:0 14px 30px -8px ${sh(0.55)}` }, parent,
      `<svg width="${d}" height="${d}" viewBox="0 0 30 30"><path d="M8.5 15.5 L13 20 L21.5 10.5" fill="none" stroke="${COL.card}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    return reg(c, { o: 0 });
  }
  /** Pop del check: escala 0.3 → 1 (snappy) en el beat. SFX pop o shutter. */
  function badgeOn(t, B, x, y, beat) {
    const p = spHit(t, beat, 'snappy', 0.04);
    put(B, { x, y, s: 0.3 + 0.7 * p, o: show(p) });
    return p;
  }
  /** Chip: píldora clara con texto UI (≥ 40 px). o = { bg, color } */
  function chip(parent, text, size, o = {}) {
    const c = el('div', { class: 'abs', style: `padding:${size * 0.32}px ${size * 0.6}px;border-radius:${size}px;background:${o.bg || COL.card};color:${o.color || COL.title};font:700 ${size}px UI;white-space:nowrap;box-shadow:0 12px 30px -12px ${sh(0.35)};transform-origin:0 50%` }, parent, text);
    return reg(c, { o: 0 });
  }
  /** Pop de chip: 0.85 → 1 y +30 px, snappy, en el beat. */
  const pop = (t, elm, x, y, beat) => { const p = spHit(t, beat, 'snappy'); put(elm, { x, y: y + 30 * (1 - p), s: 0.85 + 0.15 * p, o: show(p) }); return p; };
  /** Barra de tachado (0.12 × size de alto) para cruzar una palabra de un título. */
  const strikeEl = (parent, size) => reg(el('div', { class: 'abs', style: `height:${size * 0.12}px;width:0;background:${COL.accent};border-radius:${size * 0.06}px` }, parent), { o: 0 });
  /** Cruza la palabra wi de la línea Lobj (de TYPE.line) entre beat−0.3 y beat+0.4. lx, ly = posición de la línea. */
  function strikeOn(t, bar, Lobj, wi, lx, ly, beat) {
    const p = ease.inOut(seg(t, beatOf(beat) - 0.3, beatOf(beat) + 0.4)), wd = Lobj.words[wi], w = wd.offsetWidth + 20;
    put(bar, { x: lx + wd.offsetLeft - 10, y: ly + Lobj.size * 0.5, css: { width: w * p + 'px' }, o: p > 0.01 ? 1 : 0 });
    return p;
  }
  /** Pulso circular (pin, punto de interés). */
  const pulseEl = (parent, d) => reg(el('div', { class: 'abs', style: `width:${d}px;height:${d}px;margin:${-d / 2}px 0 0 ${-d / 2}px;border-radius:50%;border:6px solid ${COL.accent};transform-origin:50% 50%` }, parent), { o: 0 });
  /** Late una vez por cada beat de `beats` (0.9 s de expansión, sin sonido salvo que lo declares). */
  function pulseOn(t, P, x, y, beats) {
    let u = -1;
    for (const b of beats) { const v = (t - bt(b)) / 0.9; if (v > 0 && v < 1) u = v; }
    put(P, { x, y, o: u > 0 ? 1 - u : 0, s: 0.3 + 0.9 * ease.out(Math.max(0, u)) });
  }

  // ---------------------------------------------------------------- cursor
  const CUR_SVG = (ink, edge) => `<svg width="46" height="64" viewBox="0 0 23 32"><path d="M1.2 1.2 L1.2 24.2 L7.2 18.7 L11.6 29.2 L15.6 27.4 L11.2 17.2 L19.2 17.2 Z" fill="${ink}" stroke="${edge}" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
  /** Cursor oscuro con borde claro + anillo de clic. Créalo en la raíz de la escena (encima del empuje). */
  function cursor(root) {
    const ring = el('div', { class: 'abs', style: `width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;border:5px solid ${COL.accent}` }, root);
    const c = el('div', { class: 'abs', style: 'margin:-3px 0 0 -3px;transform-origin:3px 3px;z-index:20' }, root, CUR_SVG(COL.ink, COL.card));
    c._sz = pick(1.1, 1.2, 1.4);
    reg(ring, { o: 0 }); reg(c, { o: 0 });
    return { c, ring };
  }
  /** keys = [[beat, x, y], …, [clickBeat, x, y]]. Desliza con 'default', presiona −14 % en clickBeat y expande el anillo. SFX click. */
  function runCursor(t, Cu, keys, clickBeat) {
    const x = trk(t, keys.map((k) => [k[0], k[1]]), 'default');
    const y = trk(t, keys.map((k) => [beatOf(k[0]) + 0.14, k[2]]), 'default');
    const press = spHit(t, clickBeat, 'snappy', 0.03) - sp(t, beatOf(clickBeat) + 0.35, 'snappy');
    put(Cu.c, { x, y, o: t >= bt(keys[0][0]) - 0.05 ? 1 : 0, s: Cu.c._sz * (1 - 0.14 * press) });
    const u = clamp((t - (bt(clickBeat) - C.leadFor('snappy'))) / 0.45);
    put(Cu.ring, { x, y, o: u > 0 && u < 1 ? 1 - u : 0, s: 0.25 + 1.4 * ease.out(u) });
  }

  // ---------------------------------------------------------------- cierre
  /** Píldora sólida en la tinta de títulos con texto display (tipo «HOY»). */
  function pill(parent, text, size) {
    const p = el('div', { class: 'abs display', style: `padding:${size * 0.2}px ${size * 0.45}px ${size * 0.24}px;border-radius:${size * 0.32}px;background:${COL.title};color:${COL.card};font-size:${size}px;line-height:1;box-shadow:0 30px 60px -20px ${sh(0.6)};transform-origin:0 50%` }, parent, text);
    return reg(p, { o: 0 });
  }
  /** La píldora crece 0.8 → 1 en el beat y late +7 % en cada beat de `pulses`. */
  function pillOn(t, P, x, y, beat, pulses = []) {
    const g = spHit(t, beat, 'snappy', 0.04), pulse = (k) => sp(t, k, 'snappy') - sp(t, k + 0.3, 'default');
    put(P, { x, y, s: (0.8 + 0.2 * g) * (1 + 0.07 * pulses.reduce((a, k) => a + pulse(k), 0)), o: show(g) });
    return g;
  }
  /** Abanico: las piezas suben una cada `step` beats desde `beat`, con giro (i − centro) × 3° y un flote suave.
   *  F = { x, y, dx, rise=260 } */
  function fan(t, cards, F, beat, step = 0.25) {
    const mid = (cards.length - 1) / 2;
    cards.forEach((c, i) => {
      const q = spHit(t, beatOf(beat) + i * step, 'default');
      const float = -24 * sp(t, beatOf(beat) + 2 + i * 0.5, 'default') * (i === Math.round(mid) ? 1 : 0.5);
      put(c, { x: F.x + i * F.dx, y: F.y + (F.rise ?? 260) * (1 - q) + float, o: show(q), r: (i - mid) * 3 * (1 - 0.6 * q) });
    });
  }
  /** Morph de caja a caja (miniatura → fila, pieza → otra) en 1 beat con 'default'. a/b = { x, y, w, h, r (radio), rot } */
  function morph(t, elm, a, b, beat) {
    const m = spHit(t, beat, 'default');
    put(elm, { x: lerp(a.x, b.x, m), y: lerp(a.y, b.y, m), r: lerp(a.rot || 0, b.rot || 0, m), o: 1,
      css: { width: lerp(a.w, b.w, m) + 'px', height: lerp(a.h, b.h, m) + 'px', borderRadius: lerp(a.r || 16, b.r || 12, clamp(m)) + 'px' } });
    return m;
  }

  // ---------------------------------------------------------------- firma del estilo: prueba visual
  /** Comparador antes/después: dos capas del mismo tamaño en una tarjeta y una cortina vertical con tirador.
   *  a, b = elementos (captura, clip o placeholder) de w × h; la capa b («después») se recorta a la derecha de la cortina.
   *  o = { labels: ['Antes', 'Después'], size: tamaño de las etiquetas (≥ 40) } → wrap con _a, _b, _bar, _tags */
  function compare(parent, w, h, a, b, o = {}) {
    const r = Math.round(Math.min(w, h) * 0.05), fs = o.size || 42;
    const wrap = el('div', { class: 'ui', style: `width:${w}px;height:${h}px;border-radius:${r}px;isolation:isolate` }, parent);
    [a, b].forEach((x) => { wrap.appendChild(x); x.style.left = '0px'; x.style.top = '0px'; x.style.boxShadow = 'none'; x.style.borderRadius = r + 'px'; if (x._base) x._base.o = 1; });
    const bar = el('div', { class: 'abs', style: `width:8px;height:${h}px;margin-left:-4px;background:${COL.card};box-shadow:0 0 0 2px ${COL.accent}` }, wrap);
    const knob = fs * 1.9;
    el('div', { class: 'abs', style: `left:${4 - knob / 2}px;top:${h / 2 - knob / 2}px;width:${knob}px;height:${knob}px;border-radius:50%;background:${COL.accent};box-shadow:0 12px 30px -8px ${sh(0.6)}` }, bar,
      `<svg width="${knob}" height="${knob}" viewBox="0 0 40 40"><path d="M16 13 L9 20 L16 27 M24 13 L31 20 L24 27" fill="none" stroke="${COL.card}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    const [la, lb] = o.labels || ['Antes', 'Después'];
    const tag = (txt, dark) => reg(el('div', { class: 'abs', style: `padding:${fs * 0.26}px ${fs * 0.55}px;border-radius:${fs}px;font:800 ${fs}px UI;white-space:nowrap;background:${dark ? COL.title : COL.card};color:${dark ? COL.card : COL.title};box-shadow:0 10px 24px -10px ${sh(0.4)};transform-origin:0 50%` }, wrap, txt), { o: 0 });
    wrap._a = a; wrap._b = b; wrap._bar = reg(bar); wrap._tags = [tag(la, false), tag(lb, true)];
    wrap._w = w; wrap._h = h; wrap._fs = fs;
    return reg(wrap, { o: 0 });
  }
  /** Mueve la cortina: keys = [[beat, fracción 0–1], …] (0 = todo «después», 1 = todo «antes»). Etiquetas con pop en tagBeats. */
  function compareOn(t, Cmp, keys, tagBeats = []) {
    const f = clamp(trk(t, keys, 'default')), x = Cmp._w * f, fs = Cmp._fs;
    put(Cmp._b, { clip: `inset(0 0 0 ${x.toFixed(1)}px)` });
    put(Cmp._bar, { x });
    const [ta, tb] = Cmp._tags, pad = fs * 0.6;
    if (tagBeats[0] != null) pop(t, ta, pad, pad, tagBeats[0]);
    if (tagBeats[1] != null) { const p = spHit(t, tagBeats[1], 'snappy'); put(tb, { x: Cmp._w - pad - tb.offsetWidth, y: pad + 30 * (1 - p), s: 0.85 + 0.15 * p, o: show(p) }); }
    return f;
  }
  /** «Dato clave»: la cámara (una caja .abs de W × H, sin origen propio) se acerca a box hasta escala k y lleva su centro a
   *  (tx, ty). Entra en `beat` con 'default' y, si hay outBeat, vuelve a 1. Devuelve { s, x, y } para mapear puntos. */
  function zoomTo(t, cam, box, beat, k = 1.35, o = {}) {
    let p = spHit(t, beat, 'default');
    if (o.outBeat != null) p -= spHit(t, o.outBeat, 'default');
    const s = lerp(1, k, p) * (1 + (o.hold || 0)), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const tx = lerp(cx, o.tx ?? W / 2, p), ty = lerp(cy, o.ty ?? cy, p);
    const v = { s, x: tx - cx * s, y: ty - cy * s };
    put(cam, v);
    v.map = (px, py) => ({ x: v.x + px * v.s, y: v.y + py * v.s });
    return v;
  }
  /** Conteo de una cifra entre a y b (ease.out) de beat a beat + dur; fmt da el texto. Lleva SFX tick. */
  function count(t, elm, a, b, beat, dur = 1, fmt = (n) => String(Math.round(n))) {
    const u = ease.out(seg(t, beat, beatOf(beat) + dur));
    put(elm, { text: fmt(lerp(a, b, u)) });
    return u;
  }
  /** Barras de comparación en una tarjeta: rows = [{ label, value (0–1), text, accent }]. → wrap con _bars */
  function bars(parent, o = {}) {
    const w = o.w || 900, fs = o.size || 46, pad = fs * 0.9, rowH = fs * 3.3, barH = fs * 1.1;
    const h = pad * 2 + o.rows.length * rowH;
    const wrap = el('div', { class: 'ui', style: `width:${w}px;height:${h}px;border-radius:${fs * 0.6}px` }, parent);
    wrap._bars = o.rows.map((r, i) => {
      const y = pad + i * rowH, full = w - pad * 2;
      el('div', { class: 'abs', style: `left:${pad}px;top:${y}px;font:700 ${fs}px UI;color:${COL.ink2};white-space:nowrap` }, wrap, r.label);
      el('div', { class: 'abs', style: `left:${pad}px;top:${y + fs * 1.6}px;width:${full}px;height:${barH}px;border-radius:${barH / 2}px;background:${COL.tint}` }, wrap);
      const b = reg(el('div', { class: 'abs', style: `left:${pad}px;top:${y + fs * 1.6}px;width:${full}px;height:${barH}px;border-radius:${barH / 2}px;background:${r.accent ? COL.accent : COL.tint2};transform-origin:0 50%` }, wrap));
      const v = reg(el('div', { class: 'abs display num', style: `top:${y - fs * 0.1}px;font-size:${fs * 1.1}px;color:${r.accent ? COL.accent : COL.title};text-align:right;width:${full}px;left:${pad}px` }, wrap, r.text), { o: 0 });
      return { b, v, value: r.value };
    });
    wrap._w = w; wrap._h = h;
    return reg(wrap, { o: 0 });
  }
  /** Llena la barra i en su beat (0 → value, 'default') y hace pop de su cifra. */
  function barOn(t, B, i, beat) {
    const r = B._bars[i], p = spHit(t, beat, 'default');
    put(r.b, { sx: Math.max(0.001, r.value * p) });
    put(r.v, { o: show(p), y: 20 * (1 - p) });
    return p;
  }

  window.PAN = {
    COL, FK, L, X0, TOP, PRE, show,
    title, rises, bg, dots, panel, cover, pushBox, hold,
    shot, placeholder, uiCard, cardIn,
    ringEl, ringOn, growFrom, badge, badgeOn, chip, pop, strikeEl, strikeOn, pulseEl, pulseOn,
    cursor, runCursor, pill, pillOn, fan, morph,
    compare, compareOn, zoomTo, count, bars, barOn,
  };
})();
