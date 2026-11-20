// Helpers del estilo "Talking con datos" (window.DATOS). Funciones puras de t: construir DOM en build(), animar en run().
// Uso: copia este archivo a film/datos.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="datos.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Para dibujar tu clip dentro de la tarjeta: lib/media.js (C.drawSeq).
// Colores: se leen de los tokens de :root en index.html (--bg, --bg-2, --surface, --line, --white, --muted, --accent,
// --ink). Cambia --accent y toda la plantilla (tarjeta, paneles, barras, pasos, CTA) toma el color de la marca; tok() calcula
// --on-accent (texto sobre el acento), --accent-text (el acento como texto sobre el panel, aclarado si no lee),
// --accent-fill (relleno de barra destacada y paso activo, aclarado si se pierde sobre --line), --bar-plain / --val-plain (barra normal y su cifra,
// atenuadas si resaltarían más que la destacada) y --on-white (texto de la píldora del CTA según --white).
// Reglas: nada de timers, Math.random, Date ni estado que cambie entre frames. Tiempos SIEMPRE en beats o marcas.
(() => {
  const C = window.C, TYPE = window.TYPE;
  const { W, H, pick, put, reg, el, sp, spHit, trk, seg, clamp, lerp, ease, beatOf, beatAt, noise1 } = C;
  const show = (p) => (p > 0.02 ? 1 : 0);      // la opacidad hace snap: nada entra con fade

  // ------------------------------------------------------------------ tokens
  let TOK = null;
  /** Tokens de color leídos una vez de :root (con valores de respaldo). */
  function tok() {
    if (TOK) return TOK;
    const cs = getComputedStyle(document.documentElement);
    const g = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    TOK = {
      bg: g('--bg', '#12161D'), bg2: g('--bg-2', '#1A202A'), surface: g('--surface', '#1E2530'), line: g('--line', '#2C3542'),
      white: g('--white', '#F4F6F8'), muted: g('--muted', '#9AA4B2'), accent: g('--accent', '#4CC9F0'), ink: g('--ink', '#111111'),
      panel: g('--panel', '#1B222C'),
    };
    // texto sobre el acento: #111 o #fff, el que más contraste (igual que boxText "auto" de los subtítulos box-marca)
    TOK.onAccent = inkOn(TOK.accent);
    document.documentElement.style.setProperty('--on-accent', TOK.onAccent);
    // acento como color de TEXTO sobre el panel/fondo (cifra, valor destacado, palabras de acento): un acento oscuro de
    // marca no lee sobre la pizarra, así que se aclara (u oscurece, si el fondo es claro) el mismo tono hasta 3:1
    TOK.accentText = readableOn(TOK.accent, [TOK.panel, TOK.bg]);
    document.documentElement.style.setProperty('--accent-text', TOK.accentText);
    // acento como RELLENO sobre el carril (barra destacada, número del paso activo): un acento oscuro se pierde sobre
    // --line, así que se aclara (u oscurece) hasta 4,5:1 contra el carril y el panel. Con él, el texto encima (--on-accent-fill).
    TOK.accentFill = readableOn(TOK.accent, [TOK.line, TOK.panel], 4.5);
    TOK.onAccentFill = inkOn(TOK.accentFill);
    document.documentElement.style.setProperty('--accent-fill', TOK.accentFill);
    document.documentElement.style.setProperty('--on-accent-fill', TOK.onAccentFill);
    // la barra normal (--muted) nunca debe resaltar más que la destacada: si contrasta con el carril más que el relleno
    // del acento, baja hacia el carril hasta quedar por debajo (la destacada sigue mandando)
    TOK.barPlain = dimBelow(TOK.muted, TOK.line, TOK.accentFill);
    document.documentElement.style.setProperty('--bar-plain', TOK.barPlain);
    // y su cifra: blanca, salvo que el acento se haya tenido que aclarar; entonces baja hasta quedar por debajo del
    // valor destacado (que va en --accent-fill), para que el énfasis no se invierta
    TOK.valPlain = TOK.accentFill === TOK.accent ? TOK.white : dimBelow(TOK.white, TOK.panel, TOK.accentFill);
    document.documentElement.style.setProperty('--val-plain', TOK.valPlain);
    // texto de la píldora del CTA (fondo --white): #111 o #fff por contraste, por si una marca clara pasa --white a tinta
    TOK.onWhite = inkOn(TOK.white);
    document.documentElement.style.setProperty('--on-white', TOK.onWhite);
    return TOK;
  }
  const rgbOf = (col) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col || '').trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const lumOf = (rgb) => {
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  };
  const ratio = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** El color tal cual si contrasta ≥ 3:1 con todos los fondos; si no, mezclado hacia blanco (fondo oscuro) o negro. */
  function readableOn(col, backs, min = 3) {
    const c = rgbOf(col), bs = backs.map(rgbOf).filter(Boolean);
    if (!c || !bs.length) return col;
    const to = lumOf(bs[0]) < 0.18 ? [255, 255, 255] : [0, 0, 0];
    for (let k = 0; k <= 20; k++) {
      const m = c.map((v, i) => Math.round(v + (to[i] - v) * k / 20));
      if (bs.every((b) => ratio(m, b) >= min)) return k ? '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('') : col;
    }
    return col;
  }
  /** col tal cual si contrasta con track menos que ref (×0,8); si no, mezclado hacia track hasta quedar por debajo,
   *  sin bajar de 1,6:1 (la barra normal sigue viéndose). Funciona igual con fondo oscuro o claro. */
  function dimBelow(col, track, ref) {
    const c = rgbOf(col), t = rgbOf(track), r = rgbOf(ref);
    if (!c || !t || !r) return col;
    const goal = Math.max(1.6, ratio(r, t) * 0.8);
    let last = c;
    for (let k = 0; k <= 20; k++) {
      const m = c.map((v, i) => Math.round(v + (t[i] - v) * k / 20));
      if (ratio(m, t) < 1.6) break;
      last = m;
      if (ratio(m, t) <= goal) break;
    }
    return last.every((v, i) => v === c[i]) ? col : '#' + last.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  /** #111 o #fff según el contraste WCAG con un color #rgb / #rrggbb (cualquier otro formato → #111). */
  function inkOn(col) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col || '').trim());
    if (!m) return '#111';
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    const dark = ((0x11 / 255 + 0.055) / 1.055) ** 2.4;
    return (L + 0.05) / (dark + 0.05) >= 1.05 / (L + 0.05) ? '#111' : '#fff';
  }
  tok();   // fija --on-accent antes del primer build()

  // ------------------------------------------------------------------ cámara sobre la persona
  const NOISES = {};
  const noiseOf = (seed) => NOISES[seed] || (NOISES[seed] = noise1(seed));
  /**
   * Zoom de cámara lento: keys [[beat, escala], …] con 'heavy' (1.00 base, 1.06–1.10 en los énfasis) + micro deriva
   * sembrada para que ningún hold quede quieto. Devuelve la escala para C.drawSeq({ z }) dentro de la tarjeta.
   */
  function punch(t, keys, { drift = 0.006, seed = 5 } = {}) {
    return trk(t, keys, 'heavy') * (1 + drift * noiseOf(seed)(t * 0.35));
  }

  // ------------------------------------------------------------------ tarjeta de la persona
  /**
   * Caja de la tarjeta en el instante t: va de `big` a `small` en `inAt` (resorte heavy) y vuelve a `big` en `outAt`.
   * big/small = { x, y, w, h, r }. Devuelve la caja interpolada + k (0 grande … 1 pequeña).
   */
  function cardBox(t, big, small, inAt, outAt = null) {
    const k = clamp(sp(t, inAt, 'heavy') - (outAt == null ? 0 : sp(t, outAt, 'heavy')), -0.05, 1.05);
    const m = (a, b) => lerp(a, b, k);
    return { x: m(big.x, small.x), y: m(big.y, small.y), w: m(big.w, small.w), h: m(big.h, small.h), r: m(big.r, small.r), k };
  }
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  /**
   * Dibuja la tarjeta redondeada en el canvas del escenario: sombra suave, contenido recortado (paint(g, box)) y un filo
   * fino. paint dibuja la persona (tu clip con C.drawSeq o el marcador) en coordenadas del escenario dentro de box.
   */
  function drawCard(g, B, paint, { ring = 0.10 } = {}) {
    const T = tok();
    g.save();
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 60; g.shadowOffsetY = 26;
    g.fillStyle = T.surface; rr(g, B.x, B.y, B.w, B.h, B.r); g.fill();
    g.restore();
    g.save(); rr(g, B.x, B.y, B.w, B.h, B.r); g.clip(); paint(g, B); g.restore();
    g.save(); g.strokeStyle = `rgba(255,255,255,${ring})`; g.lineWidth = 2; rr(g, B.x + 1, B.y + 1, B.w - 2, B.h - 2, B.r); g.stroke(); g.restore();
  }

  // ------------------------------------------------------------------ fondo sereno
  /** Fondo oscuro tranquilo: degradado, halo del acento que deriva despacio y retícula de puntos. Dibuja en canvas. */
  function drawBg(g, t, { glow = [0.82, 0.62] } = {}) {
    const T = tok();
    const bgr = g.createLinearGradient(0, 0, 0, H);
    bgr.addColorStop(0, T.bg2); bgr.addColorStop(1, T.bg);
    g.fillStyle = bgr; g.fillRect(0, 0, W, H);
    const b = beatAt(t), gx = W * glow[0] + Math.sin(b * 0.11) * 40, gy = H * glow[1] + Math.cos(b * 0.09) * 50, R = Math.max(W, H) * 0.55;
    const hal = g.createRadialGradient(gx, gy, 0, gx, gy, R);
    hal.addColorStop(0, hexA(T.accent, 0.16)); hal.addColorStop(1, hexA(T.accent, 0));
    g.fillStyle = hal; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.06)';
    const s = pick(60, 60, 60), off = (b * 2) % s;
    for (let y = -s + off; y < H + s; y += s) for (let x = s / 2; x < W; x += s) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
  }
  /** '#rrggbb' / '#rgb' + alfa → rgba(); otro formato se devuelve tal cual (sin alfa). */
  function hexA(col, a) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col).trim());
    if (!m) return col;
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }

  // ------------------------------------------------------------------ cabecera de sección
  /** Etiqueta en píldora de acento («DATO 1») + título de 1–2 líneas al lado de la tarjeta pequeña. o: { x, y, size, chip } */
  function head(root, chipText, lines, o = {}) {
    const size = o.size || pick(60, 60, 64), x = o.x, y = o.y;
    const chip = reg(el('div', { class: 'chip', style: `left:${x}px;top:${y}px;font-size:${o.chip || pick(36, 36, 38)}px` }, root, chipText), { o: 0 });
    const Ls = lines.map((s, i) => TYPE.line(root, s, { x, y: y + (o.gap || pick(90, 90, 96)) + i * size * 1.12, size, cls: 'head', accent: (o.accent || {})[i] }));
    // palabras de acento sobre el fondo: el tono legible del acento (--accent-text), no el acento crudo
    Ls.forEach((L, i) => ((o.accent || {})[i] || []).forEach((j) => { const w = L.el.querySelectorAll('.word')[j]; if (w) w.style.color = 'var(--accent-text)'; }));
    return { chip, Ls };
  }
  /** La píldora hace pop en inAt y las líneas suben por su máscara; todo sale hacia arriba en outAt. */
  function headRun(t, Hd, inAt, outAt = null) {
    const p = spHit(t, inAt, 'snappy'), q = outAt == null ? 0 : sp(t, outAt, 'snappy');
    put(Hd.chip, { o: p > 0.01 && q < 0.98 ? 1 : 0, s: 0.7 + 0.3 * p, y: -40 * q, r: -4 * (1 - p) });
    Hd.Ls.forEach((L, i) => TYPE.rise(t, L, beatOf(inAt) + 0.25 + i * 0.3, outAt, { stagger: 0.06, preset: 'heavy' }));
  }

  // ------------------------------------------------------------------ panel de datos (carrusel)
  /**
   * Panel redondeado sobre el fondo. o: { x, y, w, h }. Devuelve el div del panel; su contenido va en P.c (capa interna,
   * hijos en coordenadas del panel), que figure(), bars() y steps() usan solos.
   */
  function panel(root, o) {
    const p = el('div', { class: 'panel', style: `left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px` }, root);
    p._w = o.w; p._h = o.h;
    p.c = reg(el('div', { class: 'abs', style: `left:0;top:0;width:${o.w}px;height:${o.h}px` }, p), { o: 0 });
    p.c._w = o.w; p.c._h = o.h;
    return reg(p, { o: 0 });
  }
  /**
   * Entra empujando desde la derecha (resorte default) en inAt y sale empujada a la izquierda en outAt; sin fundidos.
   * El contenido aparece de golpe cuando el panel ya casi llegó (nunca hay texto cruzando el borde del cuadro).
   */
  function panelRun(t, P, inAt, outAt = null) {
    const p = spHit(t, inAt, 'default'), q = outAt == null ? 0 : sp(t, outAt, 'default');
    const x = W * 0.75 * (1 - p) - W * 1.0 * q;
    put(P, { o: p > 0.005 && q < 0.995 ? 1 : 0, x, r: 1.5 * (1 - p) - 1.5 * q, s: 0.96 + 0.04 * p });
    put(P.c, { o: p > 0.75 && q < 0.06 ? 1 : 0 });
    return p - q;
  }

  // ------------------------------------------------------------------ dato clave que cuenta
  /** Cifra grande en acento + etiqueta arriba + nota abajo. o: { label, note, size, suffix } → { num, value } */
  function figure(P, o = {}) {
    P = P.c || P;
    const fs = o.size || pick(170, 170, 180), pad = pick(56, 56, 60), top = pad + 80;   // la caja de la cifra libra la etiqueta
    el('div', { class: 'abs label', style: `left:${pad}px;top:${pad}px` }, P, o.label || 'TU DATO CLAVE');
    const row = el('div', { class: 'abs fig', style: `left:${pad - 6}px;top:${top}px;font-size:${fs}px` }, P);
    const num = reg(el('span', {}, row, '0'));
    if (o.suffix) el('span', { class: 'suf' }, row, o.suffix);
    if (o.note) el('div', { class: 'abs note', style: `left:${pad}px;top:${P._h - pad - 38}px` }, P, o.note);
    // subrayado de acento que crece bajo la cifra
    const u = reg(el('div', { class: 'abs', style: `left:${pad}px;top:${top + fs * 1.02}px;width:${P._w - pad * 2}px;height:10px;border-radius:5px;background:var(--accent-text);transform-origin:0 50%` }, P), { sx: 0.001 });
    return { num, u };
  }
  /** Cuenta de a → b entre beat y beat + dur (ease.out) y estira el subrayado. fmt da el texto. Lleva SFX tick. */
  function count(t, F, a, b, beat, dur = 2, fmt = (n) => String(Math.round(n))) {
    const u = ease.out(seg(t, beat, beatOf(beat) + dur));
    put(F.num, { text: fmt(lerp(a, b, u)) });
    put(F.u, { sx: Math.max(0.001, u) });
    return u;
  }

  // ------------------------------------------------------------------ barras de comparación
  /** rows = [{ label, value (0–1), text, accent }]. Etiqueta arriba, barra con su cifra que aparece al llenarse. */
  function bars(P, rows, o = {}) {
    P = P.c || P;
    const pad = pick(56, 56, 60), fs = o.size || pick(42, 42, 44), top = o.top ?? pad, rowH = o.rowH || pick(150, 150, 160), barH = fs * 1.15;
    const full = P._w - pad * 2;
    return rows.map((r, i) => {
      const y = top + i * rowH;
      el('div', { class: 'abs label', style: `left:${pad}px;top:${y}px;font-size:${fs}px;color:var(--white)` }, P, r.label);
      el('div', { class: 'abs', style: `left:${pad}px;top:${y + fs * 1.45}px;width:${full}px;height:${barH}px;border-radius:${barH / 2}px;background:var(--line)` }, P);
      const b = reg(el('div', { class: 'abs', style: `left:${pad}px;top:${y + fs * 1.45}px;width:${full}px;height:${barH}px;border-radius:${barH / 2}px;background:${r.accent ? 'var(--accent-fill)' : 'var(--bar-plain)'};transform-origin:0 50%` }, P), { sx: 0.001 });
      const v = reg(el('div', { class: 'abs val', style: `left:${pad}px;width:${full}px;top:${y - fs * 0.12}px;font-size:${fs * 1.2}px;color:${r.accent ? 'var(--accent-fill)' : 'var(--val-plain)'}` }, P, r.text), { o: 0 });
      return { b, v, value: r.value };
    });
  }
  /** Llena la barra i en beats[i] (resorte default) y hace pop de su cifra. */
  function barsRun(t, B, beats) {
    B.forEach((r, i) => {
      const p = spHit(t, beats[i], 'default');
      put(r.b, { sx: Math.max(0.001, r.value * p) });
      put(r.v, { o: show(p), y: 16 * (1 - p) });
    });
  }

  // ------------------------------------------------------------------ lista de pasos
  /** Filas numeradas («1 Tu primer paso» …). o: { size, rowH, top } → filas { r, n, txt } */
  function steps(P, labels, o = {}) {
    P = P.c || P;
    const pad = pick(56, 56, 60), fs = o.size || pick(46, 46, 50), rowH = o.rowH || pick(118, 118, 124), top = o.top ?? pad, d = fs * 1.6;
    return labels.map((s, i) => {
      const r = reg(el('div', { class: 'abs', style: `left:${pad}px;top:${top + i * rowH}px;width:${P._w - pad * 2}px;height:${d}px` }, P), { o: 0 });
      const n = el('div', { class: 'abs num', style: `left:0;top:0;width:${d}px;height:${d}px;font-size:${fs * 0.9}px` }, r, String(i + 1));
      const txt = el('div', { class: 'abs step', style: `left:${d + fs * 0.6}px;top:0;height:${d}px;font-size:${fs}px` }, r, s);
      return { r, n, txt };
    });
  }
  /** Cada fila entra desde la izquierda en su beat; la activa lleva el número en acento, las anteriores se atenúan. */
  function stepsRun(t, S, beats) {
    const b = beatAt(t);
    let k = -1; beats.forEach((m, i) => { if (b >= beatOf(m)) k = i; });
    S.forEach((R, i) => {
      const p = spHit(t, beats[i], 'snappy');
      put(R.r, { o: show(p), x: -40 * (1 - p) });
      put(R.n, { css: { background: i === k ? 'var(--accent-fill)' : 'var(--line)', color: i === k ? 'var(--on-accent-fill)' : 'var(--white)' }, s: i === k ? 1 + 0.12 * Math.sin(Math.PI * clamp((t - C.bt(beats[i])) / 0.35)) : 1 });
      put(R.txt, { css: { color: i === k ? 'var(--white)' : 'var(--muted)' } });
    });
    return k;
  }

  // ------------------------------------------------------------------ CTA
  /** Píldora del CTA que salta en su beat y pulsa una vez en pulseAt. */
  function ctaRun(t, P, inAt, pulseAt = null) {
    const pc = spHit(t, inAt, 'snappy'), pulse = pulseAt == null ? 0 : Math.sin(Math.PI * clamp((t - C.bt(pulseAt)) / 0.3)) * 0.06;
    put(P, { o: pc > 0.001 ? 1 : 0, y: 30 * (1 - pc), s: (0.8 + 0.2 * pc) * (1 + pulse) });
  }

  window.DATOS = { tok, inkOn, hexA, show, punch, cardBox, rr, drawCard, drawBg, head, headRun, panel, panelRun, figure, count, bars, barsRun, steps, stepsRun, ctaRun };
})();
