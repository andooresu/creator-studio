// Helpers del estilo "Tarjeta escenario" (window.TARJ). Funciones puras de t: construir DOM en build(), animar en run().
// Uso: copia este archivo a film/tarjeta.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="tarjeta.js"></script>
// Requiere core.js (window.C), type.js (window.TYPE) y lib/motion.js (window.Motion).
// Colores: se leen de los tokens :root de index.html (--bg, --surface, --line, --rail, --ink, --ink-2, --muted,
// --accent [acento de texto sobre fondo claro], --accent-fill [relleno y acento sobre oscuro], --night [campo del cierre]).
// Reglas: nada de timers, Math.random, Date ni estado que cambie entre frames. Tiempos SIEMPRE en beats o marcas.
(() => {
  const C = window.C;
  const { pick, put, reg, el, sp, spHit, seg, clamp, lerp, ease, bt, beatOf, beatAt } = C;
  const TALL = C.FMT === '9x16', WIDE = C.FMT === '16x9';
  const NOTEXT = !!(C.TL.render_flags && C.TL.render_flags.notext);
  let GID = 0;   // solo se usa en build() (ids de grupo para el lint), nunca en run()

  // ------------------------------------------------------------------ tokens
  let TOK = null;
  /** Tokens de color leídos una vez de :root (con valores de respaldo). */
  function tok() {
    if (TOK) return TOK;
    const cs = getComputedStyle(document.documentElement);
    const g = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    TOK = {
      bg: g('--bg', '#F3F4F0'), surface: g('--surface', '#E6EAE3'), line: g('--line', '#D3D9D0'), rail: g('--rail', '#CBD2C8'),
      ink: g('--ink', '#15201B'), ink2: g('--ink-2', '#4F5B55'), muted: g('--muted', '#6D7871'),
      accent: g('--accent', '#2B6B59'), fill: g('--accent-fill', '#3E8E78'), night: g('--night', '#15201B'),
      // grises del diagrama: trazo suave, trazo medio, trazo fuerte
      d1: g('--diagram-1', '#C9D0C6'), d2: g('--diagram-2', '#8E9A92'), d3: g('--diagram-3', '#6F7C74'),
    };
    return TOK;
  }

  // ------------------------------------------------------------------ rejilla
  // C.pick(16:9, 1:1 y 4:5, 9:16)
  const M = pick(120, 72, 80);                 // margen izquierdo del texto
  const HS = pick(92, 80, 100);                // titular de 2 líneas
  const H3 = pick(80, 70, 90);                 // titular de 3 líneas
  const BIG = pick(130, 120, 128);             // afirmación de ruptura
  const EYE = pick(34, 33, 38);                // eyebrow
  const LH = 1.13;
  const RAD = pick(36, 36, 40);

  /**
   * Plantilla estándar: tarjeta arriba, eyebrow + titular debajo (9:16, 4:5, 1:1). En 16:9 la tarjeta va a la derecha
   * y el bloque de texto a la izquierda. cardH = alto de la tarjeta en 9:16; o.h45 = alto en 4:5/1:1.
   * Devuelve { CARD:{x,y,w,h}, EYE, HEAD, DOTS } (EYE/HEAD = y del eyebrow y del titular; DOTS = y de los puntos).
   */
  function lay(cardH = 900, o = {}) {
    if (WIDE) {
      const CARD = { x: Math.round(C.W * 0.5), y: 110, w: Math.round(C.W * 0.46), h: C.H - 220 };
      return { CARD, EYE: 330, HEAD: 390, DOTS: CARD.y + CARD.h + 26 };
    }
    if (!TALL) {
      const h = o.h45 ?? (C.H > 1200 ? 800 : 600);
      const CARD = { x: 60, y: 60, w: C.W - 120, h };
      return { CARD, EYE: 60 + h + 52, HEAD: 60 + h + 52 + 64, DOTS: 60 + h + 22 };
    }
    const CARD = { x: 64, y: 170, w: 952, h: cardH };
    return { CARD, EYE: 170 + cardH + 56, HEAD: 170 + cardH + 56 + 70, DOTS: 170 + cardH + 26 };
  }
  /** Ruptura de plantilla: tipo grande arriba, tarjeta abajo. En 16:9 se queda como lay(). */
  function brk(o = {}) {
    if (WIDE) return lay();
    if (!TALL) {
      const y = o.y45 ?? 400, CARD = { x: 60, y, w: C.W - 120, h: C.H - y - 60 };
      return { CARD, EYE: 50, HEAD: 110, DOTS: CARD.y + CARD.h + 18 };
    }
    const y = o.y ?? 720, CARD = { x: 64, y, w: 952, h: o.h ?? 790 };
    return { CARD, EYE: 280, HEAD: 340, DOTS: CARD.y + CARD.h + 26 };
  }

  // ------------------------------------------------------------------ voz → beats
  /** Beats de cada palabra de la frase `id` del VO colocado; si no hay VO, devuelve `fallback` (array de beats). */
  function wb(id, fallback = []) {
    const P = (window.VO || []).find((p) => p.id === id);
    if (!P || !P.words || !P.words.length) return fallback.slice();
    return P.words.map((w) => beatAt(w.t0));
  }
  /** Beat de salida de un titular: termina de salir 0.26 b antes de la primera palabra del siguiente. */
  const OUT = (nextBeats) => (Array.isArray(nextBeats) ? nextBeats[0] : beatOf(nextBeats)) - 0.26;

  // ------------------------------------------------------------------ texto
  /**
   * Titular multilínea alineado a la izquierda. lines: ['Línea 1', 'Línea 2']; o: { x, y, size, lh, color, accent: [[línea, palabra]] }
   * Devuelve un array de líneas de TYPE.line (cada una con .el, .words, .size).
   */
  function head(root, lines, o = {}) {
    const size = o.size || HS, x = o.x ?? M, y = o.y, g = ++GID;
    return lines.map((s, li) => {
      const Ln = TYPE.line(root, s, { x, y: Math.round(y + li * size * (o.lh || LH)), size, color: o.color,
        accent: (o.accent || []).filter((a) => a[0] === li).map((a) => a[1]) });
      Ln.el.dataset.cc = 'display'; Ln.el.dataset.g = g;
      if (o.accentColor) Ln.words.forEach((w) => { if (w.style.color) w.style.color = o.accentColor; });
      if (NOTEXT) Ln.el.style.opacity = '0';
      return Ln;
    });
  }
  /**
   * Sube un titular por su máscara. beats: beats de las palabras (de wb() o a mano).
   *   modo línea (por defecto): cada línea sube completa en beats[0] + línea × 0.12.
   *   o.perWord = true: cada palabra sube en su propio beat (beats indexa todas las palabras del titular en orden).
   * outAt: beat de salida (usa OUT(siguiente)) o null. Preset 'snappy', salida 0.3 b.
   */
  function riseH(t, Ls, beats, outAt = null, o = {}) {
    let k = 0;
    Ls.forEach((Ln, li) => {
      const n = Ln.words.length;
      const ins = o.perWord ? Ln.words.map((_, i) => beats[Math.min(k + i, beats.length - 1)]) : Ln.words.map(() => beats[0] + li * 0.12);
      TYPE.rise(t, Ln, ins, outAt, { preset: 'snappy', exit: 0.3, stagger: 0, ...o });
      k += n;
    });
  }
  /**
   * Juego tipográfico del hook: la palabra aterriza en `bi`, se hunde ~10 % y rota ±4°, y se recupera dentro de su máscara.
   * Llamar DESPUÉS de riseH (sobrescribe la palabra wi de la línea Ln). dir = ±1 (sentido del giro).
   */
  function hookDip(t, Ln, wi, bi, dir = 1) {
    const pin = spHit(t, bi, 'snappy');
    const k = sp(t, bi + 0.3, 'snappy') - sp(t, bi + 0.62, 'default');
    put(Ln.words[wi], { y: Ln.size * 1.8 * (1 - pin) + Ln.size * 0.1 * k, r: 4 * k * dir, hide: 1.8 * (1 - pin) > 0.87 });
  }
  /** Eyebrow: línea pequeña en --muted (la única que puede entrar con fade). */
  function eyebrow(root, text, y, o = {}) {
    const e = el('div', { class: 'eyebrow', style: `left:${o.x ?? M}px;top:${y}px;font-size:${o.size || EYE}px;${o.color ? 'color:' + o.color : ''}` }, root, text);
    e.dataset.cc = 'eyebrow'; e.dataset.g = ++GID;
    if (NOTEXT) e.style.color = 'transparent';
    return reg(e, { o: 0 });
  }
  /** Muestra el eyebrow (fade + 12 px desde la izquierda) en `at`; desaparece en `out` si se da. */
  function showEye(t, e, at, out = null) {
    const p = sp(t, at, 'snappy'), gone = out != null && beatAt(t) >= beatOf(out);
    put(e, { o: gone ? 0 : p, x: -12 * (1 - p) });
  }

  // ------------------------------------------------------------------ tarjeta escenario
  /** Tarjeta redondeada con canvas propio. Devuelve { wrap, cv, g, B, BOX } (BOX = caja del canvas en coordenadas locales). */
  function card(root, Lc) {
    const B = Lc.CARD;
    const wrap = el('div', { class: 'stagecard', style: `left:${B.x}px;top:${B.y}px;width:${B.w}px;height:${B.h}px;border-radius:${RAD}px;box-shadow:0 22px 48px -30px rgba(10,20,16,.35)` }, root);
    const cv = el('canvas', { width: B.w, height: B.h, style: 'position:absolute;left:0;top:0' }, wrap);
    reg(wrap); reg(cv);
    return { wrap, cv, g: cv.getContext('2d'), B, BOX: { x: 0, y: 0, w: B.w, h: B.h } };
  }
  /** Asentado del frame 0: la tarjeta ya va de 0.94 a 1 cuando arranca el video. */
  function settle(t, K, at = -0.9) { put(K.wrap, { s: 0.94 + 0.06 * sp(t, at, 'default'), o: 1 }); }
  /** Entrada tipo carrusel: el contenido del canvas empuja desde la derecha un 22 % del ancho; el marco no se mueve. */
  function slideIn(t, K, at) { const p = spHit(t, at, 'default'); put(K.cv, { x: Math.round(K.B.w * 0.22 * (1 - p)) }); return p; }
  /** Micro empuje 1.00 → 1.06 (ease.inOut) entre b0 y b1. Multiplica el zoom del material con esto. */
  const push = (t, b0, b1, a = 1, z = 1.06) => lerp(a, z, ease.inOut(seg(t, b0, b1)));
  /** Punch al beat: multiplicador 1 → 1.2 en la palabra clave (preset heavy). */
  const punch = (t, at, amt = 0.2) => lerp(1, 1 + amt, spHit(t, beatOf(at) - 0.1, 'heavy'));
  /** Foto en cover dentro de la caja B con zoom z; py = encuadre vertical (0 arriba, 1 abajo). */
  function photo(g, im, B, z = 1, py = 0.45) {
    const iw = im.naturalWidth || 1, ih = im.naturalHeight || 1, sc = Math.max(B.w / iw, B.h / ih) * z;
    g.drawImage(im, (B.w - iw * sc) * 0.5, (B.h - ih * sc) * py, iw * sc, ih * sc);
  }
  /**
   * Marcador de posición para tu material: superficie, formas suaves sembradas que derivan con t, ícono de play y
   * la etiqueta "TU CLIP AQUÍ". Sustitúyelo por photo() o C.drawSeq() cuando tengas el clip real.
   *   o: { seed, label, sub, z (zoom), tone: 0..1 (variación de color) }
   */
  function placeholder(g, B, t, o = {}) {
    const T = tok(), z = o.z || 1, r = C.mulberry32(o.seed || 7), b = beatAt(t);
    g.save();
    g.fillStyle = T.surface; g.fillRect(0, 0, B.w, B.h);
    g.translate(B.w / 2, B.h / 2); g.scale(z, z); g.translate(-B.w / 2, -B.h / 2);
    const cols = [T.line, T.rail, T.bg, T.d1];
    for (let i = 0; i < 7; i++) {
      const cx = B.w * (0.1 + 0.8 * r()), cy = B.h * (0.1 + 0.8 * r()), rad = Math.min(B.w, B.h) * (0.16 + 0.22 * r());
      const ph = r() * 6.28, dx = Math.sin(b * 0.35 + ph) * 18, dy = Math.cos(b * 0.28 + ph) * 14;
      g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.85;
      g.beginPath(); g.arc(Math.round(cx + dx), Math.round(cy + dy), Math.round(rad), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    // ícono de play y etiqueta (sin zoom: siempre legibles)
    const cx = B.w / 2, cy = B.h * 0.44, R = Math.round(Math.min(B.w, B.h) * 0.09);
    g.fillStyle = T.bg; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = T.ink2; g.beginPath(); g.moveTo(cx - R * 0.3, cy - R * 0.42); g.lineTo(cx + R * 0.48, cy); g.lineTo(cx - R * 0.3, cy + R * 0.42); g.closePath(); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = T.ink2; g.font = `600 ${pick(34, 34, 40)}px UI`;
    if (g.letterSpacing !== undefined) g.letterSpacing = '4px';
    g.fillText(o.label || 'TU CLIP AQUÍ', cx, cy + R + pick(64, 64, 76));
    if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
    if (o.sub) { g.fillStyle = T.muted; g.font = `500 ${pick(28, 28, 32)}px UI`; g.fillText(o.sub, cx, cy + R + pick(108, 108, 124)); }
    g.textAlign = 'start';
  }
  /**
   * Cámara dentro del canvas: zoom z hacia el foco (fx, fy) en coordenadas del canvas. Llama a g.restore() al terminar.
   * Devuelve map(p) → [x, y] en coordenadas del escenario (para anclar etiquetas a puntos del dibujo).
   */
  function camera(g, K, z, fx, fy) {
    const B = K.B;
    g.save(); g.translate(B.w / 2, B.h / 2); g.scale(z, z); g.translate(-fx, -fy);
    return (p) => [B.x + B.w / 2 + (p[0] - fx) * z, B.y + B.h / 2 + (p[1] - fy) * z];
  }


  // ------------------------------------------------------------------ diagrama dibujado y sembrado
  /**
   * Fábrica de un diagrama lineal genérico: N tallos con nodo que nacen de una línea base (sirve para fibras,
   * tallos, señales, barras de datos…). Llámala FUERA de run() (en el cuerpo de film.js): la semilla fija las posiciones.
   *   const F = TARJ.fibers(17, 30);
   *   const tips = F.draw(g, bx, { fall: (i) => 0..1, regrow: (i) => 0..1, refill: (i) => 0..1, hl: índice | -1, gapMark: 0..1 });
   * fall: el trazo cae y se desvanece · regrow: renace corto en acento · refill: se repone largo en acento ·
   * gapMark: la línea base se marca en acento bajo los huecos de F.lost. Devuelve las puntas [{ tip, root }] por índice.
   */
  function fibers(seed = 17, n = 30, o = {}) {
    const r = C.mulberry32(seed);
    const items = Array.from({ length: n }, (_, i) => {
      const u = 0.03 + 0.94 * (i + 0.5 * (r() - 0.5)) / (n - 1);
      const wave = 0.5 + 0.5 * Math.sin(u * 17.0 + 1.3);              // pérdidas agrupadas, no uniformes
      return { u, j: (r() - 0.5) * 8, th: 0.15 + 0.85 * clamp(wave * 0.75 + r() * 0.35, 0, 1), k: r() };
    });
    const cut = o.lost ?? 0.45;
    const lost = items.map((it) => it.th < cut);
    const gaps = (() => { const out = []; let s = -1; lost.forEach((v, i) => { if (v && s < 0) s = i; if ((!v || i === n - 1) && s >= 0) { const e = v ? i : i - 1; if (e - s >= 1) out.push([s, e]); s = -1; } }); return out; })();
    const base = (bx, u) => {
      const x = bx.x + bx.w * (0.08 + 0.84 * u), y = bx.y + bx.h * (0.84 - 0.05 * Math.sin(Math.PI * u));
      const a = Math.atan2(-0.05 * bx.h * Math.PI * Math.cos(Math.PI * u), 0.84 * bx.w);
      return [x, y, a];
    };
    const stroke = (g, x, y, ang, len, curl, col, wd) => {
      const dx = Math.cos(ang), dy = Math.sin(ang), tx = x + dx * len, ty = y + dy * len;
      g.strokeStyle = col; g.lineWidth = wd; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + dx * len * 0.55 + dy * len * curl, y + dy * len * 0.55 - dx * len * curl, tx, ty); g.stroke();
      return [tx, ty];
    };
    function draw(g, bx, st = {}) {
      const T = tok(), unit = bx.h * 0.42, wd = Math.max(2.4, bx.h * 0.007);
      // línea base (en dos tonos: sombra suave + trazo)
      g.lineCap = 'round';
      g.strokeStyle = T.d1; g.lineWidth = wd * 5; g.beginPath();
      for (let s = 0; s <= 30; s++) { const [x, y] = base(bx, s / 30); s ? g.lineTo(x, y + wd * 3) : g.moveTo(x, y + wd * 3); }
      g.stroke();
      g.strokeStyle = T.d2; g.lineWidth = wd * 1.4; g.beginPath();
      for (let s = 0; s <= 30; s++) { const [x, y] = base(bx, s / 30); s ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      const tips = [];
      items.forEach((it, i) => {
        const [x, y, ta] = base(bx, it.u);
        const nrm = ta - Math.PI / 2 + it.j * 0.012;
        const len = unit * (0.45 + 0.5 * it.k);
        const f = st.fall ? st.fall(i) : 0;
        if (f < 1) {
          const dy = f * f * bx.h * 0.6, rot = f * 1.2 * (it.u < 0.5 ? -1 : 1);
          g.globalAlpha = 1 - f;
          const hl = st.hl === i;
          const tip = stroke(g, x, y + dy, nrm + rot, len, 0.06, hl ? T.accent : T.d3, wd * (hl ? 1.5 : 1.15));
          g.fillStyle = hl ? T.accent : T.d3; g.beginPath(); g.arc(tip[0], tip[1], wd * 2.2, 0, Math.PI * 2); g.fill();
          tips[i] = { tip, root: [x, y + dy] };
          g.globalAlpha = 1;
        } else tips[i] = null;
        const rg = st.regrow ? st.regrow(i) : 0;
        const dot = (p, r0) => { g.fillStyle = T.accent; g.beginPath(); g.arc(p[0], p[1], r0, 0, Math.PI * 2); g.fill(); };
        if (rg > 0.02 && f >= 1) dot(stroke(g, x, y, nrm, len * 0.4 * rg, 0.06, T.accent, wd * 1.1), wd * 2.2 * rg);
        const rf = st.refill ? st.refill(i) : 0;
        if (rf > 0.02 && f >= 1) dot(stroke(g, x, y, nrm, len * rf, 0.06, T.accent, wd * 1.4), wd * 2.4 * rf);
      });
      if (st.gapMark > 0.01) {
        g.strokeStyle = T.fill; g.lineWidth = wd * 3.2; g.lineCap = 'round';
        gaps.forEach(([s0, e0]) => {
          const ua = items[s0].u - 0.012, ub = items[e0].u + 0.012, um = lerp(ua, ub, 0.5), half = (ub - ua) / 2 * st.gapMark;
          g.beginPath();
          for (let q = 0; q <= 12; q++) { const [x, y] = base(bx, um - half + 2 * half * q / 12); q ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.stroke();
        });
      }
      return tips;
    }
    return { n, items, lost, gaps, base, draw };
  }

  // ------------------------------------------------------------------ etiquetas que siguen
  /** Píldora de etiqueta. kind: 'ink' (relleno tinta, texto claro) | 'outline' (superficie con borde de acento). */
  function tag(root, text, kind = 'outline') {
    const T = tok(), h = pick(62, 60, 68);
    const ink = kind === 'ink';
    return reg(el('div', { class: 'pill', style: `left:0;top:0;height:${h}px;padding:0 ${pick(24, 22, 26)}px;box-sizing:border-box;font-size:${pick(38, 36, 42)}px;background:${ink ? T.ink : T.surface};color:${ink ? T.bg : T.accent};border:${ink ? 0 : 2}px solid ${T.accent}` }, root, text), { o: 0 });
  }
  /**
   * Coloca una etiqueta junto a la punta (px, py) del trazo, entra en `at` (0.92→1, y+24→0) y respeta la tarjeta
   * y las zonas seguras (9:16: x ≤ 940, y ≥ 280). side: 'right' | 'left'. tw = ancho estimado de la píldora.
   */
  function placeTag(t, tg, px, py, at, K, o = {}) {
    const p = spHit(t, at, 'snappy');
    if (p < 0.01 || o.hide) { put(tg, { o: 0 }); return; }
    const B = K.B, tw = o.tw || 220, th = pick(62, 60, 68), right = (o.side || 'right') === 'right';
    const x = clamp(px + (right ? 26 : -tw - 24), B.x + 16, Math.min(B.x + B.w, TALL ? 940 : C.W) - tw - 16);
    const y = clamp(py + (right ? -th - 18 : 30), Math.max(B.y + 16, TALL ? 280 : 0), B.y + B.h - th - 16);
    put(tg, { o: 1, x: Math.round(x), y: Math.round(y + 24 * (1 - p)), s: 0.92 + 0.08 * p });
  }

  // ------------------------------------------------------------------ puntos de carrusel
  /**
   * Registra una escena (cut:false) con la fila de puntos bajo la tarjeta activa. sections: [[marca, layout], …].
   * El indicador de tinta se estira y viaja al punto de cada sección en su marca. Pon un SFX "tick" suave en cada marca.
   */
  function dots(sections, o = {}) {
    C.scene({
      name: o.name || 'dots', from: o.from || sections[0][0], to: o.to || 'end', cut: false,
      build(root, S) {
        const T = tok();
        root.style.zIndex = 5; root.style.pointerEvents = 'none';
        S.gap = 26; S.d = 12;
        const span = (sections.length - 1) * S.gap + 22;
        S.x0 = WIDE ? null : Math.round(C.W / 2 - span / 2);
        S.wrap = reg(el('div', { class: 'abs', style: 'left:0;top:0;width:1px;height:1px' }, root));
        S.items = sections.map((_, i) => reg(el('div', { class: 'abs', 'data-lint': 'ui', style: `left:${i * S.gap + 5}px;top:0;width:${S.d}px;height:${S.d}px;border-radius:6px;background:${T.rail}` }, S.wrap)));
        S.ind = reg(el('div', { class: 'abs', 'data-lint': 'ui', style: `top:0;height:${S.d}px;border-radius:6px;background:${T.ink}` }, S.wrap));
        S.span = span;
      },
      run(t, b, S) {
        let k = 0; sections.forEach(([m], i) => { if (b >= beatOf(m)) k = i; });
        const Lc = sections[k][1];
        const x0 = WIDE ? Math.round(Lc.CARD.x + Lc.CARD.w / 2 - S.span / 2) : S.x0;
        put(S.wrap, { x: x0, y: Lc.DOTS });
        const stops = sections.map(([m], i) => [bt(m) - C.leadFor('snappy'), i * S.gap, i * S.gap + 22]);
        const ind = Motion.indicator(t, stops);
        put(S.ind, { x: ind.start, css: { width: Math.max(S.d, ind.size) + 'px' } });
      },
    });
  }

  // ------------------------------------------------------------------ riel de tiempo
  /**
   * Riel gris de 6 px con paradas (puntos de 24 px + etiqueta centrada encima).
   *   o: { x0, x1, y, stops: [{ v, label }], max } — v en la misma unidad que max (días, semanas…).
   */
  function rail(root, o) {
    const T = tok(), w = o.x1 - o.x0;
    const R = { o, max: o.max ?? o.stops[o.stops.length - 1].v };
    R.base = reg(el('div', { class: 'abs', style: `left:${o.x0}px;top:${o.y - 3}px;width:${w}px;height:6px;border-radius:3px;background:${T.rail}` }, root), { o: 0 });
    R.fill = reg(el('div', { class: 'abs', style: `left:${o.x0}px;top:${o.y - 3}px;width:${w}px;height:6px;border-radius:3px;background:${T.ink};transform-origin:0 50%` }, root), { o: 0 });
    R.stops = o.stops.map((s) => {
      const x = Math.round(lerp(o.x0, o.x1, s.v / R.max));
      const dot = reg(el('div', { class: 'abs', style: `left:${x - 12}px;top:${o.y - 12}px;width:24px;height:24px;border-radius:12px;background:${T.rail};transform-origin:50% 50%` }, root), { o: 0 });
      const lb = reg(el('div', { class: 'abs', style: `left:${x - 130}px;top:${o.y - pick(66, 62, 72)}px;width:260px;text-align:center;white-space:nowrap;font-family:UI;font-weight:600;font-size:${pick(36, 34, 40)}px;color:${T.muted}` }, root, s.label), { o: 0 });
      return { ...s, dot, lb };
    });
    return R;
  }
  /**
   * Anima el riel: entra en `inAt` (sube 16 px), se llena con progress (0..1, normalmente ease.inOut(seg(...))) y la
   * última parada se vuelve acento con pop ×1.4 en `popAt` que decae en 1 beat. Pon tick por parada y thump en popAt.
   */
  function railRun(t, R, inAt, progress, popAt) {
    const T = tok(), pr = spHit(t, inAt, 'default'), vis = pr > 0.01 ? 1 : 0, dy = Math.round(16 * (1 - pr));
    put(R.base, { o: vis, y: dy }); put(R.fill, { o: vis, y: dy, sx: Math.max(0.001, progress) });
    const last = R.stops.length - 1, pb = beatOf(popAt);
    R.stops.forEach((s, i) => {
      const on = progress >= s.v / R.max - 1e-3, L = i === last;
      const s1 = L ? 1 + 0.4 * spHit(t, pb, 'snappy') * (1 - seg(t, pb + 0.4, pb + 1.4)) : 1;
      put(s.dot, { o: vis, y: dy, s: s1, css: { background: on ? (L ? T.fill : T.ink) : T.rail } });
      put(s.lb, { o: vis, y: dy, css: { color: on && L ? T.accent : T.muted } });
    });
  }

  // ------------------------------------------------------------------ calendario de N puntos
  /** Fila de N puntos (el último acabará en acento) + etiqueta a la derecha. o: { n, x0, x1, y, d, label } */
  function calendar(root, o) {
    const T = tok(), d = o.d || pick(26, 26, 28);
    const K = { n: o.n, dots: [] };
    for (let i = 0; i < o.n; i++) K.dots.push(reg(el('div', { class: 'abs', style: `left:${Math.round(lerp(o.x0, o.x1, i / (o.n - 1)) - d / 2)}px;top:${o.y - d / 2}px;width:${d}px;height:${d}px;border-radius:${d / 2}px;background:${T.rail};transform-origin:50% 50%` }, root), { o: 0 }));
    K.lab = reg(el('div', { class: 'abs', style: `left:${o.x1 - 320}px;top:${o.y - pick(74, 70, 80)}px;width:${320 + d / 2}px;text-align:right;white-space:nowrap;font-family:UI;font-weight:600;font-size:${pick(36, 34, 40)}px;color:${T.accent}` }, root, o.label || ''), { o: 0 });
    return K;
  }
  /** Fija la fila en pinAt, enciende puntos con progress (0..1) y muestra la etiqueta en labelAt. */
  function calendarRun(t, K, pinAt, progress, labelAt) {
    const T = tok(), pin = spHit(t, pinAt, 'default');
    K.dots.forEach((c, i) => {
      const on = progress >= i / (K.n - 1) - 1e-3;
      put(c, { o: pin > 0.01 ? 1 : 0, y: Math.round(14 * (1 - pin)), css: { background: on ? (i === K.n - 1 ? T.fill : T.ink) : T.rail } });
    });
    const pl = spHit(t, labelAt, 'snappy');
    put(K.lab, { o: pl > 0.01 ? 1 : 0, y: Math.round(16 * (1 - pl)) });
  }

  // ------------------------------------------------------------------ anillo de arcos
  /** Anillo de N arcos con un número/texto grande al centro. o: { x, y, size, n, label } */
  function ring(root, o) {
    const T = tok(), s = o.size;
    const R = { n: o.n || 4, s };
    R.cv = reg(el('canvas', { width: s, height: s, class: 'abs', style: `left:${o.x}px;top:${o.y}px;transform-origin:50% 50%` }, root), { o: 0 });
    R.g = R.cv.getContext('2d');
    R.lab = reg(el('div', { class: 'pill', style: `left:${o.x}px;top:${o.y}px;width:${s}px;height:${s}px;line-height:1;color:${T.ink};font-size:${Math.round(s * 0.42)}px;font-family:Display;font-weight:500;transform-origin:50% 50%` }, root, o.label ?? String(R.n)), { o: 0 });
    return R;
  }
  /** Entra en inAt (0.88→1), cierra un arco por medio beat desde firstAt (el último en acento) y colapsa en outAt. */
  function ringRun(t, R, inAt, firstAt, outAt = null) {
    const T = tok(), pr = spHit(t, inAt, 'default'), out = outAt == null ? 0 : sp(t, outAt, 'snappy');
    const vis = pr > 0.01 && out < 0.99, s = (0.88 + 0.12 * pr) * (1 - out);
    put(R.cv, { o: vis ? 1 : 0, s, y: Math.round(20 * (1 - pr)) });
    put(R.lab, { o: vis ? 1 : 0, s, y: Math.round(20 * (1 - pr)) });
    const g = R.g, r = R.s / 2, lw = R.s * 0.06; g.clearRect(0, 0, R.s, R.s); g.lineCap = 'round'; g.lineWidth = lw;
    const fb = beatOf(firstAt), seg2 = (Math.PI * 2) / R.n;
    for (let i = 0; i < R.n; i++) {
      const a0 = -Math.PI / 2 + i * seg2 + 0.14, a1 = a0 + seg2 - 0.28;
      g.strokeStyle = T.line; g.beginPath(); g.arc(r, r, r - lw, a0, a1); g.stroke();
      const f = spHit(t, fb + i * 0.5, 'default');
      if (f > 0.001) { g.strokeStyle = i === R.n - 1 ? T.fill : T.ink; g.beginPath(); g.arc(r, r, r - lw, a0, a0 + (a1 - a0) * f); g.stroke(); }
    }
  }

  // ------------------------------------------------------------------ píldoras de pasos
  /** «1 Paso · 2 Paso · 3 Paso» en superficie. o: { x, y, pw, ph, gap } */
  function steps(root, labels, o = {}) {
    const T = tok(), pw = o.pw || pick(250, 250, 262), ph = o.ph || pick(74, 70, 80), gap = o.gap ?? 16;
    const S = { pw, gap, n: labels.length };
    S.track = reg(el('div', { class: 'abs', style: `left:${o.x ?? M}px;top:${o.y}px;width:${labels.length * pw + (labels.length - 1) * gap}px;height:${ph}px` }, root), { o: 0 });
    labels.forEach((_, i) => el('div', { class: 'pill', style: `left:${i * (pw + gap)}px;top:0;width:${pw}px;height:${ph}px;background:${T.surface}` }, S.track));
    S.ind = reg(el('div', { class: 'pill', style: `left:0;top:0;height:${ph}px;background:${T.ink}` }, S.track));
    S.lab = labels.map((s, i) => reg(el('div', { class: 'pill', style: `left:${i * (pw + gap)}px;top:0;width:${pw}px;height:${ph}px;font-size:${pick(36, 34, 40)}px;color:${T.ink2};white-space:pre` }, S.track, s)));
    return S;
  }
  /** La fila entra en inAt; el indicador de tinta viaja al paso activo en cada marca de `marks`; el texto activo pasa a claro. */
  function stepsRun(t, S, inAt, marks) {
    const T = tok(), pt = spHit(t, inAt, 'default'), b = beatAt(t);
    put(S.track, { o: pt > 0.01 ? 1 : 0, y: Math.round(30 * (1 - pt)) });
    const stops = marks.map((m, i) => [bt(m) - C.leadFor('snappy'), i * (S.pw + S.gap), i * (S.pw + S.gap) + S.pw]);
    const ind = Motion.indicator(t, stops);
    put(S.ind, { x: ind.start, css: { width: Math.max(0, ind.size) + 'px' } });
    let k = 0; marks.forEach((m, i) => { if (b >= beatOf(m)) k = i; });
    S.lab.forEach((l, i) => put(l, { css: { color: i === k ? T.bg : T.ink2 } }));
    return k;
  }

  // ------------------------------------------------------------------ tabla que se construye
  /** Filas [etiqueta, valor] con separador. o: { x, y, rw, rh } */
  function table(root, rows, o) {
    const T = tok(), rh = o.rh || pick(92, 86, 100), rw = o.rw || pick(760, C.W - 2 * M, 860), x = o.x ?? M;
    return rows.map(([a, v], i) => {
      const r = reg(el('div', { class: 'abs', style: `left:${x - 20}px;top:${o.y + i * rh}px;width:${rw + 40}px;height:${rh}px;border-radius:22px` }, root), { o: 0 });
      el('div', { class: 'abs', style: `left:20px;top:${rh - 2}px;width:${rw}px;height:2px;background:${T.line}` }, r);
      el('div', { class: 'abs', style: `left:20px;top:0;height:${rh}px;display:flex;align-items:center;font-family:UI;font-weight:600;font-size:${pick(42, 38, 46)}px;color:${T.ink};white-space:nowrap` }, r, a);
      const val = el('div', { class: 'abs display', style: `left:20px;width:${rw}px;top:0;height:${rh}px;display:flex;align-items:center;justify-content:flex-end;font-size:${pick(58, 52, 62)}px;color:${T.ink}` }, r, v);
      return { r, val };
    });
  }
  /** Las filas suben 26 px cada medio beat desde `at`; en hlAt la fila hl toma superficie y su valor pasa a acento. */
  function tableRun(t, rows, at, hl = -1, hlAt = null) {
    const T = tok(), a = beatOf(at);
    rows.forEach((R, i) => { const p = spHit(t, a + i * 0.5, 'default'); put(R.r, { o: p > 0.01 ? 1 : 0, y: Math.round(26 * (1 - p)) }); });
    if (hl >= 0 && hlAt != null) {
      const on = spHit(t, hlAt, 'snappy') > 0.5;
      put(rows[hl].r, { css: { background: on ? T.surface : 'transparent' } });
      put(rows[hl].val, { css: { color: on ? T.accent : T.ink } });
    }
  }

  // ------------------------------------------------------------------ lista numerada
  /** Círculo de contorno en acento con un número (alinéalo con la línea del titular de al lado). */
  function numeral(root, n, x, y, size = pick(74, 66, 80)) {
    const T = tok();
    return reg(el('div', { class: 'pill', style: `left:${x}px;top:${y}px;width:${size}px;height:${size}px;color:${T.accent};font-size:${Math.round(size * 0.52)}px;transform-origin:50% 50%` }, root,
      `<svg width="${size}" height="${size}" style="position:absolute;left:0;top:0"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1.5}" fill="none" stroke="${T.accent}" stroke-width="3"/></svg>${n}`), { o: 0 });
  }
  /** El número entra con su verbo (sube 18 px, snappy). */
  function numeralRun(t, e, at) { const p = spHit(t, beatOf(at) - 0.1, 'snappy'); put(e, { o: p > 0.01 ? 1 : 0, y: Math.round(18 * (1 - p)) }); }

  // ------------------------------------------------------------------ cierre vivo + puente de loop
  /**
   * Cierre sobre campo oscuro: logo (imagen o palabra de marca), titular CTA, píldora de acento, líneas de contacto y
   * brillo que cruza la píldora. o: { logoSrc | logoText, cta: ['Agenda tu retoque.'], ctaAccent: [[0, 2]], button, lines: [...] }
   */
  function endCard(root, o) {
    const T = tok(), E = {};
    root.style.background = T.night;
    E.blk = reg(el('div', { class: 'abs', style: `left:0;top:0;width:${C.W}px;height:${C.H}px` }, root));
    const ly = pick(170, 170, 430), lw = pick(700, 700, 820);
    E.logo = o.logoSrc
      ? reg(el('img', { src: o.logoSrc, class: 'abs', style: `left:${M}px;top:${ly}px;width:${lw}px;transform-origin:0 50%` }, E.blk), { o: 0 })
      : reg(el('div', { class: 'abs display', style: `left:${M}px;top:${ly}px;font-size:${pick(120, 110, 132)}px;font-weight:600;letter-spacing:-0.02em;color:${T.fill};transform-origin:0 50%` }, E.blk, o.logoText || 'TU MARCA'), { o: 0 });
    const hy = pick(420, 420, 720), hs = pick(110, 100, 124);
    E.h = head(E.blk, o.cta || ['Escríbenos.'], { y: hy, size: hs, color: T.bg, accent: o.ctaAccent || [], accentColor: T.fill });
    const by = hy + (o.cta ? o.cta.length : 1) * hs * LH + pick(60, 60, 90), bw = pick(460, 620, 720), bh = pick(100, 120, 146);
    E.btn = reg(el('div', { class: 'pill', style: `left:${M}px;top:${Math.round(by)}px;width:${bw}px;height:${bh}px;background:${T.fill};color:${T.night};font-family:UI;font-weight:600;font-size:${pick(42, 52, 60)}px;transform-origin:0 50%` }, E.blk, o.button || 'Reservar'), { o: 0 });
    E.lines = (o.lines || []).map((s, i) => reg(el('div', { class: 'abs', style: `left:${M}px;top:${Math.round(by + bh + pick(40, 44, 56) + i * pick(60, 64, 72))}px;font-family:UI;font-weight:${i ? 500 : 600};font-size:${pick(40, 44, 48)}px;color:${i ? T.rail : T.bg};white-space:nowrap` }, E.blk, s), { o: 0 }));
    E.shw = reg(el('div', { class: 'abs', 'data-lint': 'ui', style: `left:${M}px;top:${Math.round(by)}px;width:${bw}px;height:${bh}px;border-radius:999px;overflow:hidden;pointer-events:none` }, E.blk), { o: 0 });
    E.sheen = reg(el('div', { class: 'abs', 'data-lint': 'ui', style: `left:0;top:0;width:${Math.round(bw * 0.35)}px;height:${bh}px;background:linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.5) 50%, rgba(255,255,255,0) 100%)` }, E.shw));
    E.bw = bw;
    [E.btn, ...E.lines].forEach((e) => { e.dataset.cc = 'ui'; e.dataset.g = ++GID; if (NOTEXT) e.style.color = 'transparent'; });
    return E;
  }
  /**
   * Anima el cierre. k: { end, ctaBeats, btn, sheen: [b0, b1], drift: [b0, b1] }
   * El logo se revela de izquierda a derecha con clip-path desde end − 0.16; las líneas suben cada 0.5 b tras btn.
   */
  function endRun(t, E, k) {
    const pl = sp(t, beatOf(k.end) - 0.16, 'default'), rv = clamp(0.35 + 0.65 * pl, 0, 1);
    put(E.logo, { o: 1, y: Math.round(30 * (1 - pl)), s: lerp(0.97, 1, pl), css: { clipPath: `inset(-10% ${(100 * (1 - rv)).toFixed(2)}% -10% 0)` } });
    if (k.drift) put(E.blk, { y: -24 * ease.inOut(seg(t, k.drift[0], k.drift[1])) });
    riseH(t, E.h, k.ctaBeats, null, { preset: 'heavy' });
    const pb = spHit(t, k.btn, 'snappy');
    put(E.btn, { o: pb > 0.01 ? 1 : 0, sx: 0.85 + 0.15 * pb, sy: 0.85 + 0.15 * pb });
    E.lines.forEach((e, i) => { const p = sp(t, beatOf(k.btn) + 0.5 * (i + 1), 'snappy'); put(e, { o: p, y: 14 * (1 - p) }); });
    if (k.sheen) {
      const sh = seg(t, k.sheen[0], k.sheen[1]);
      put(E.shw, { o: sh > 0 && sh < 1 ? 1 : 0 });
      put(E.sheen, { x: Math.round(lerp(-E.bw * 0.4, E.bw * 1.05, ease.inOut(sh))) });
    }
  }
  /**
   * Puente de loop: panel del color de fondo que sube y tapa el cierre en [b0, b1]. paint(panel) construye encima
   * el estado del frame 0 del hook (tarjeta + eyebrow), calculado con t = 0 para que empalme exacto.
   */
  function bridge(root, paint) {
    const T = tok();
    const P = reg(el('div', { class: 'abs', style: `left:0;top:0;width:${C.W}px;height:${C.H}px;background:${T.bg};overflow:hidden` }, root), { o: 0 });
    if (paint) paint(P);
    return P;
  }
  function bridgeRun(t, P, b0, b1) {
    const wp = ease.inOut(seg(t, b0, b1));
    put(P, { o: wp > 0.001 ? 1 : 0, y: Math.round(C.H * (1 - wp)) });
  }

  window.TARJ = {
    tok, M, HS, H3, BIG, EYE, LH, RAD, TALL, WIDE,
    lay, brk, wb, OUT, head, riseH, hookDip, eyebrow, showEye,
    card, settle, slideIn, push, punch, photo, placeholder, camera, fibers,
    tag, placeTag, dots, rail, railRun, calendar, calendarRun, ring, ringRun,
    steps, stepsRun, table, tableRun, numeral, numeralRun, endCard, endRun, bridge, bridgeRun,
  };
})();
