// Helpers del estilo "Ilustrado sereno" (window.ILUS). Funciones puras de t: DOM en build(), dibujo y put() en run().
// Uso: copia este archivo a film/ilustrado.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="ilustrado.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE).
// Colores: se leen de los tokens :root de index.html (--bg, --ink, --ink-2, --accent, --action, --disc, --card,
// --card-in, --obj, --shadow). Cambia los tokens, no este archivo.
// Reglas: nada de timers, Math.random, Date ni estado que cambie entre frames. Tiempos SIEMPRE en beats o marcas.
(() => {
  const C = window.C;
  const { W, H, FMT, pick, put, reg, el, sp, seg, clamp, lerp, ease, mulberry32 } = C;
  const TALL = FMT === '9x16';
  const TAU = Math.PI * 2;

  // Los resortes pueden pasarse de 0: nunca le pases un radio negativo a arc() (si no, el canvas lanza un error).
  if (!CanvasRenderingContext2D.prototype._ilusArc) {
    const arc0 = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (x, y, r, a, b, c) { return arc0.call(this, x, y, Math.max(0, r), a, b, c); };
    CanvasRenderingContext2D.prototype._ilusArc = true;
  }

  // ------------------------------------------------------------------ tokens
  let TOK = null;
  /** Tokens de color leídos una vez de :root (con valores de respaldo de la paleta de ejemplo). */
  function tok() {
    if (TOK) return TOK;
    const cs = getComputedStyle(document.documentElement);
    const g = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    TOK = {
      bg: g('--bg', '#2F2C5C'), ink: g('--ink', '#FFFDF8'), ink2: g('--ink-2', '#D9D5F0'), accent: g('--accent', '#8DE2C6'),
      action: g('--action', '#F06C93'), disc: g('--disc', '#433F7E'), card: g('--card', '#FFFDF8'), cardIn: g('--card-in', '#F1EEF8'),
      obj: g('--obj', '#231F45'), shadow: g('--shadow', 'rgba(10,8,30,0.34)'), bgRgb: g('--bg-rgb', '47,44,92'),
    };
    return TOK;
  }

  // ------------------------------------------------------------------ rejilla y tamaños (C.pick(16:9, 1:1 y 4:5, 9:16))
  const PAD = pick(120, 90, 90);          // margen izquierdo del texto
  const SIZE = {
    hook: pick(88, 78, 80), solucion: pick(100, 88, 92), detalle: pick(96, 84, 88), beneficio: pick(76, 68, 72),
    accion: pick(60, 52, 54), chip: pick(46, 48, 50), legal: pick(36, 34, 36),
  };
  const LH = 1.28;

  // ------------------------------------------------------------------ utilidades
  const on = (p) => (p > 0.002 ? 1 : 0);
  /** Micro empuje de cámara para holds vivos: 1 → 1 + amt entre dos beats. */
  const micro = (t, b0, b1, amt = 0.035) => 1 + amt * ease.inOut(seg(t, b0, b1));
  /** Pulso 0 → 1 → 0 entre a y z (por ejemplo, una presión de botón). */
  const pulse = (t, a, z, preset = 'snappy') => sp(t, a, preset) - sp(t, z, preset);
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

  /** Varias líneas de un mismo mensaje, apiladas a la izquierda. accents[i] = índices de palabra acentuada en la línea i. */
  function stack(root, texts, x, y, size, accents = [], lh = LH) {
    return texts.map((s, i) => TYPE.line(root, s, { x, y: y + i * size * lh, size, accent: accents[i] || undefined }));
  }

  // ------------------------------------------------------------------ personaje plano (canvas, coordenadas locales)
  /** Brazo de 2 huesos. Se estira (estilo cómic) si el objetivo queda fuera de alcance. */
  function ik(S, Hd, L1, L2, sign) {
    const dx = Hd[0] - S[0], dy = Hd[1] - S[1], d = Math.hypot(dx, dy) || 1;
    const f = Math.max(1, d / (L1 + L2 - 0.5)); L1 *= f; L2 *= f;
    const a = Math.atan2(dy, dx), c = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), al = Math.acos(c);
    return [S[0] + L1 * Math.cos(a + sign * al), S[1] + L1 * Math.sin(a + sign * al)];
  }
  function limb(g, A, B, E, wUp, wLo, cUp, cLo) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = cLo; g.lineWidth = wLo; g.beginPath(); g.moveTo(B[0], B[1]); g.lineTo(E[0], E[1]); g.stroke();
    g.strokeStyle = cUp; g.lineWidth = wUp; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(lerp(A[0], B[0], 0.82), lerp(A[1], B[1], 0.82)); g.stroke();
  }
  /** Vestuario por defecto: es contenido, no UI. Cámbialo por personaje con P.look. Tonos cálidos y apagados. */
  const LOOK = { skin: '#E2A987', skin2: '#C68C6C', hair: '#3A2E3B', top: '#5FA3D6', top2: '#4A88BC', lips: '#A2505A', cheek: '226,128,120' };

  /**
   * Personaje plano (adulto, pelo corto, suéter de cuello redondo). Origen = base del cuello. Cabeza ≈ 200 px de alto.
   * P: tilt (rad), hx (desplazamiento de cabeza), brow (+1 ceño, -1 cejas arriba), squint 0..1, smile -1..1,
   *    oh 0..1 (boca de sorpresa), blink 0..1, hand [x,y] (mano derecha del cuadro), lhand [x,y] (mano izquierda),
   *    held(g, x, y): dibuja lo que sostiene la mano derecha, look: {skin, hair, top, ...}
   */
  function person(g, P = {}) {
    const L = Object.assign({}, LOOK, P.look || {}), O = tok().obj;
    const tilt = P.tilt || 0, hx = P.hx || 0;
    const headT = () => { g.translate(hx, 0); g.translate(0, -24); g.rotate(tilt); g.translate(0, 24); };
    // pelo de atrás
    g.save(); headT(); g.fillStyle = L.hair; g.beginPath(); g.ellipse(0, -164, 112, 128, 0, 0, TAU); g.fill(); g.restore();
    // torso (suéter)
    g.fillStyle = L.top; g.beginPath(); g.moveTo(-210, 760); g.lineTo(-210, 140); g.quadraticCurveTo(-206, 40, -100, 28);
    g.lineTo(100, 28); g.quadraticCurveTo(206, 40, 210, 140); g.lineTo(210, 760); g.closePath(); g.fill();
    g.fillStyle = L.skin2; rrect(g, -32, -44, 64, 80, 20); g.fill();                                 // cuello
    g.strokeStyle = L.top2; g.lineWidth = 16; g.lineCap = 'round';                                    // cuello redondo
    g.beginPath(); g.ellipse(0, 26, 60, 24, 0, 0.05 * Math.PI, 0.95 * Math.PI); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(-120, 420); g.quadraticCurveTo(0, 440, 120, 420); g.stroke();   // pliegue
    // cabeza
    g.save(); headT();
    g.fillStyle = L.skin;
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 98, -146, 15, 23, 0, 0, TAU); g.fill(); }
    g.beginPath(); g.ellipse(0, -150, 100, 118, 0, 0, TAU); g.fill();
    const sm = P.smile || 0, sq = clamp(P.squint || 0), br = P.brow || 0;
    if (sm > 0.05) { g.fillStyle = `rgba(${L.cheek},${0.3 * sm})`; for (const cx of [-56, 56]) { g.beginPath(); g.ellipse(cx, -108, 21, 12, 0, 0, TAU); g.fill(); } }
    g.fillStyle = O; g.strokeStyle = O; g.lineWidth = 7; g.lineCap = 'round';
    for (const ex of [-40, 40]) {
      const ry = 12 * (1 - 0.72 * sq) * (1 - 0.55 * clamp(sm - 0.4) / 0.6) * (1 - (P.blink || 0));
      if (ry < 2.5) { g.beginPath(); g.moveTo(ex - 11, -148); g.quadraticCurveTo(ex, -156, ex + 11, -148); g.stroke(); }
      else { g.beginPath(); g.ellipse(ex, -148, 10, ry, 0, 0, TAU); g.fill(); }
    }
    g.strokeStyle = L.hair; g.lineWidth = 8;                                                        // cejas
    for (const s of [-1, 1]) {
      const inner = -184 + 14 * Math.max(0, br) - 12 * Math.max(0, -br), outer = -188 - 3 * Math.max(0, br) - 12 * Math.max(0, -br);
      g.beginPath(); g.moveTo(s * 64, outer); g.quadraticCurveTo(s * 42, outer - 8, s * 18, inner); g.stroke();
    }
    g.strokeStyle = L.skin2; g.lineWidth = 6; g.beginPath(); g.moveTo(0, -138); g.quadraticCurveTo(10, -118, -4, -112); g.stroke();   // nariz
    const oh = clamp(P.oh || 0);
    if (oh > 0.3) { g.fillStyle = L.lips; g.beginPath(); g.ellipse(0, -80, 13 * oh, 16 * oh, 0, 0, TAU); g.fill(); }
    else if (sm > 0.45) {
      g.fillStyle = L.lips; g.beginPath(); g.moveTo(-32, -88); g.quadraticCurveTo(0, -88 + 56 * sm, 32, -88); g.quadraticCurveTo(0, -78, -32, -88); g.fill();
      g.fillStyle = tok().card; g.beginPath(); g.moveTo(-24, -86); g.quadraticCurveTo(0, -80, 24, -86); g.quadraticCurveTo(0, -75, -24, -86); g.fill();
    } else { g.strokeStyle = L.lips; g.lineWidth = 7; g.beginPath(); g.moveTo(-24, -84); g.quadraticCurveTo(0, -84 + 22 * sm, 24, -84); g.stroke(); }
    g.fillStyle = L.hair; g.beginPath(); g.moveTo(-106, -140);                                       // flequillo de lado
    g.bezierCurveTo(-122, -250, -40, -292, 22, -284); g.bezierCurveTo(92, -278, 126, -222, 106, -142);
    g.bezierCurveTo(96, -196, 58, -216, 8, -206); g.bezierCurveTo(-40, -198, -82, -184, -106, -140); g.fill();
    g.restore();
    // brazos: el izquierdo detrás, el derecho (con el objeto) delante
    const SL = [150, 66], SR = [-150, 66];
    if (P.lhand) {
      const E = ik(SL, P.lhand, 160, 165, 1); limb(g, SL, E, P.lhand, 64, 46, L.top, L.skin);
      g.fillStyle = L.skin; g.beginPath(); g.arc(P.lhand[0], P.lhand[1], 25, 0, TAU); g.fill();
    }
    if (P.hand) {
      const E = ik(SR, P.hand, 170, 175, -1); limb(g, SR, E, P.hand, 64, 46, L.top, L.skin);
      if (P.held) P.held(g, P.hand[0], P.hand[1]);
      g.fillStyle = L.skin; g.beginPath(); g.arc(P.hand[0], P.hand[1], 26, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(P.hand[0] + 22, P.hand[1] - 30, 10, 20, -0.4, 0, TAU); g.fill();   // pulgar
    }
  }

  /** Disco de fondo: el torso se recorta redondo abajo y la cabeza y los brazos rompen el borde por arriba del centro. */
  function withDisc(g, cx, cy, r, fn, color = tok().disc) {
    g.fillStyle = color; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.rect(-4000, -4000, 8000, 4000 + cy); g.clip('nonzero'); fn(); g.restore();
  }

  // ------------------------------------------------------------------ objetos ilustrados
  /** Hoja o folleto genérico (el "problema" que no se entiende). blur = px de desenfoque del contenido. */
  function sheet(g, x, y, r = -0.08, blur = 0, k = 1) {
    const T = tok();
    g.save(); g.translate(x, y); g.rotate(r); g.scale(k, k);
    g.fillStyle = T.card; rrect(g, -62, -84, 124, 168, 12); g.fill();
    g.save(); rrect(g, -62, -84, 124, 168, 12); g.clip();
    if (blur > 0.05) g.filter = `blur(${blur.toFixed(2)}px)`;
    g.fillStyle = T.disc; rrect(g, -46, -68, 92, 40, 8); g.fill();
    g.fillStyle = 'rgba(35,31,69,0.45)';
    for (const [lx, ly, lw] of [[-46, -14, 92], [-46, 2, 70], [-46, 18, 86], [-46, 34, 54], [-46, 50, 78]]) g.fillRect(lx, ly, lw, 6);
    g.restore(); g.restore();
  }

  /** Nube de pensamiento con "?" (o el símbolo que pases). k = escala 0..1 (resorte), a = opacidad. */
  function thought(g, x, y, k = 1, sym = '?', a = 1) {
    if (k <= 0.002 || a <= 0.002) return;
    const T = tok();
    g.save(); g.globalAlpha *= a; g.translate(x, y); g.scale(k, k);
    g.fillStyle = T.card;
    for (const [cx, cy, r] of [[-46, 6, 46], [0, -22, 56], [50, 2, 46], [6, 28, 44]]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); }
    for (const [cx, cy, r] of [[-70, 76, 14], [-96, 108, 9]]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); }
    g.fillStyle = T.bg; g.font = '900 86px Display'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(sym, 2, 4);
    g.restore();
  }

  /** Teléfono simple con un chat. */
  function phone(g, x, y, r = -0.08, k = 1) {
    const T = tok();
    g.save(); g.translate(x, y); g.rotate(r); g.scale(k, k);
    g.fillStyle = T.obj; rrect(g, -50, -92, 100, 184, 18); g.fill();
    g.fillStyle = T.cardIn; rrect(g, -43, -82, 86, 164, 12); g.fill();
    g.fillStyle = T.disc; rrect(g, -34, -64, 54, 30, 10); g.fill();
    g.fillStyle = T.accent; rrect(g, -16, -22, 52, 28, 10); g.fill();
    g.fillStyle = T.disc; rrect(g, -34, 16, 62, 36, 10); g.fill();
    g.restore();
  }

  // ------------------------------------------------------------------ marcador de clip ("TU CLIP AQUÍ")
  /**
   * Tarjeta de relleno donde irá tu clip o foto. Rayas diagonales suaves que se desplazan, ícono de play y etiqueta.
   * Dibuja en (x, y, w, h). o: { label, sub, r (radio), blur, t, tone: 'claro' | 'oscuro' }
   */
  function clip(g, x, y, w, h, o = {}) {
    const T = tok(), r = o.r ?? Math.min(w, h) * 0.08, t = o.t || 0, dark = o.tone === 'oscuro';
    g.save(); rrect(g, x, y, w, h, r); g.clip();
    if (o.blur > 0.05) g.filter = `blur(${o.blur.toFixed(2)}px)`;
    g.fillStyle = dark ? T.disc : T.cardIn; g.fillRect(x, y, w, h);
    g.strokeStyle = dark ? 'rgba(255,253,248,0.08)' : 'rgba(47,44,92,0.07)'; g.lineWidth = Math.max(10, w * 0.03);
    const step = Math.max(34, w * 0.09), off = (t * 22) % step;
    for (let d = -h - step; d < w + h; d += step) { g.beginPath(); g.moveTo(x + d + off, y + h); g.lineTo(x + d + off + h, y); g.stroke(); }
    const s = Math.min(w, h), cx = x + w / 2, cy = y + h * (o.label === '' ? 0.5 : 0.42);
    g.fillStyle = dark ? T.ink : T.bg; g.globalAlpha = 0.9;
    g.beginPath(); g.arc(cx, cy, s * 0.13, 0, TAU); g.fill(); g.globalAlpha = 1;
    g.fillStyle = dark ? T.disc : T.card;
    g.beginPath(); g.moveTo(cx - s * 0.04, cy - s * 0.06); g.lineTo(cx + s * 0.065, cy); g.lineTo(cx - s * 0.04, cy + s * 0.06); g.closePath(); g.fill();
    if (o.label !== '') {
      g.fillStyle = dark ? T.ink : T.bg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${Math.round(Math.max(26, s * 0.1))}px Display`; g.fillText(o.label || 'TU CLIP AQUÍ', cx, cy + s * 0.25);
      if (o.sub) { g.font = `600 ${Math.round(Math.max(22, s * 0.06))}px UI`; g.globalAlpha = 0.7; g.fillText(o.sub, cx, cy + s * 0.36); g.globalAlpha = 1; }
    }
    g.restore();
  }

  // ------------------------------------------------------------------ partículas: un objeto que se hace polvo
  /**
   * Partículas sembradas que nacen del CONTORNO de un objeto (una elipse cx, cy, rx, ry). Calcúlalas FUERA de run().
   * o: { n, seed, up (empuje hacia arriba), spread, colors }
   */
  function dust(o = {}) {
    const r = mulberry32(o.seed ?? 42), n = o.n ?? 140, a = [];
    const cols = o.colors || [tok().card, tok().accent];
    for (let i = 0; i < n; i++) {
      const th = r() * TAU, nx = Math.cos(th), ny = Math.sin(th), rr = 1 + r() * 0.08;
      a.push({ x: (o.cx || 0) + nx * (o.rx || 60) * rr, y: (o.cy || 0) + ny * (o.ry || 60) * rr,
        vx: nx * ((o.spread ?? 520) * (0.6 + 0.8 * r())), vy: ny * 260 - (o.up ?? 620) * (0.5 + r()),
        s: 4 + r() * 7, k: 3 + r() * 2, c: r() < 0.6 ? cols[0] : cols[1], d: r() * 0.08 });
    }
    return a;
  }
  /** Dibuja las partículas dt segundos después de la disolución. life = segundos de vida (≈ 0.65). */
  function drawDust(g, parts, dt, life = 0.65) {
    if (dt <= 0) return;
    for (const p of parts) {
      const u = dt - p.d; if (u <= 0) continue;
      const l = clamp(1 - u / life); if (l <= 0) continue;
      const e = (1 - Math.exp(-p.k * u)) / p.k;
      g.globalAlpha = l * l; g.fillStyle = p.c;
      g.beginPath(); g.arc(p.x + p.vx * e, p.y + p.vy * e - 60 * u, p.s * (0.4 + 0.6 * l), 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ luz suave: badge, haz, anillos, enfoque
  /** Badge de luz (blanco cálido con núcleo de acento). k = escala (resorte snappy), tl = segundos (respiración suave). */
  function badge(g, x, y, k, tl = 0) {
    if (k <= 0.002) return;
    const T = tok();
    g.save(); g.translate(x, y); g.scale(k, k);
    g.fillStyle = T.accent; g.globalAlpha = 0.22; g.beginPath(); g.arc(0, 0, 70 + 6 * Math.sin(tl * 6), 0, TAU); g.fill(); g.globalAlpha = 1;
    g.fillStyle = T.card; g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.fill();
    g.fillStyle = T.accent; g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.fill();
    g.restore();
  }
  /** Haz cónico suave de (x0, y0) hacia (x1, y1). amt 0..1 = cuánto ha bajado. Bandas de luz viajan por dentro. */
  function beam(g, x0, y0, x1, y1, w1, amt, tl = 0) {
    if (amt <= 0.002) return;
    const yB = lerp(y0, y1, amt), xB = lerp(x0, x1, amt), w0 = 16, wb = lerp(16, w1, amt);
    const gr = g.createLinearGradient(0, y0, 0, yB);
    gr.addColorStop(0, 'rgba(255,253,240,0.75)'); gr.addColorStop(1, 'rgba(200,245,228,0.30)');
    g.save(); g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - w0, y0); g.lineTo(x0 + w0, y0); g.lineTo(xB + wb, yB); g.lineTo(xB - wb, yB); g.closePath(); g.fill();
    g.clip(); g.fillStyle = 'rgba(255,253,248,0.45)';
    for (let k = 0; k < 3; k++) { const ph = (tl * 0.9 + k / 3) % 1, yy = lerp(y0, yB, ph); g.globalAlpha = amt * Math.sin(ph * Math.PI); g.fillRect(xB - wb - 20, yy - 14, 2 * wb + 40, 28); }
    g.restore();
  }
  /** Brillo donde aterriza la luz + 3 anillos de acento que barren hacia dentro + arco de escaneo. scan 0..1 (seg lineal). */
  function scanRings(g, cx, cy, amt, scan, R = 190) {
    if (amt <= 0.01) return;
    const T = tok();
    g.save(); g.strokeStyle = T.accent; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const ph = (scan * 2.2 + k / 3) % 1; g.globalAlpha = amt * Math.sin(ph * Math.PI); g.lineWidth = 7;
      g.beginPath(); g.arc(cx, cy, lerp(R, R * 0.26, ph), 0, TAU); g.stroke(); }
    g.globalAlpha = amt; g.lineWidth = 12; const a0 = scan * TAU * 1.5 - Math.PI / 2;
    g.beginPath(); g.arc(cx, cy, R * 0.79, a0, a0 + 1.1); g.stroke();
    g.restore();
  }
  /** Resplandor radial suave (sin glow sobre UI: solo sobre la ilustración). */
  function glow(g, cx, cy, amt, R = 170) {
    if (amt <= 0.01) return;
    const rg = g.createRadialGradient(cx, cy, 6, cx, cy, R);
    rg.addColorStop(0, `rgba(230,255,244,${0.6 * amt})`); rg.addColorStop(1, 'rgba(141,226,198,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  }
  /** Anillo blanco que se expande una sola vez con ease.out cuando algo entra en foco. fr 0..1 (seg lineal). */
  function focusRing(g, cx, cy, fr, r0 = 130, grow = 150) {
    if (fr <= 0 || fr >= 1) return;
    g.save(); g.globalAlpha = 0.8 * (1 - fr); g.strokeStyle = tok().card; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, r0 + grow * ease.out(fr), 0, TAU); g.stroke(); g.restore();
  }
  /** Destello de 4 puntas. */
  function sparkle(g, cx, cy, R) {
    if (R <= 0.5) return;
    g.fillStyle = tok().card; g.beginPath(); g.moveTo(cx, cy - R); g.quadraticCurveTo(cx, cy, cx + R, cy); g.quadraticCurveTo(cx, cy, cx, cy + R);
    g.quadraticCurveTo(cx, cy, cx - R, cy); g.quadraticCurveTo(cx, cy, cx, cy - R); g.fill();
  }
  /**
   * Check que se dibuja: círculo que crece (pop 0..1, resorte snappy) y trazo en 2 tramos (40 % / 60 %) según draw 0..1.
   * Usa spHit para pop (suena) y seg(t, b, b + 0.6) para draw.
   */
  function check(g, cx, cy, R, pop, draw, fill = tok().accent, stroke = tok().obj) {
    if (pop <= 0.002) return;
    const rr = R * pop;
    g.fillStyle = fill; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.fill();
    if (draw <= 0) return;
    g.strokeStyle = stroke; g.lineWidth = rr * 0.21; g.lineCap = 'round'; g.lineJoin = 'round';
    const p = [[-0.42, 0.02], [-0.12, 0.32], [0.45, -0.3]].map(([a, c]) => [cx + a * rr, cy + c * rr]);
    g.beginPath(); g.moveTo(p[0][0], p[0][1]);
    if (draw < 0.4) g.lineTo(lerp(p[0][0], p[1][0], draw / 0.4), lerp(p[0][1], p[1][1], draw / 0.4));
    else { g.lineTo(p[1][0], p[1][1]); const v = clamp((draw - 0.4) / 0.6); g.lineTo(lerp(p[1][0], p[2][0], v), lerp(p[1][1], p[2][1], v)); }
    g.stroke();
  }

  // ------------------------------------------------------------------ tarjetas que se encienden
  /**
   * Tarjeta blanca con interior y viñeta. Coordenadas de cuadro.
   * B: {x, y, w, h}; o: { p (entrada 0..1), lit (0..1, quita el velo), act (0..1, borde de acento), pulse (0..1), gone (0..1, sale por abajo),
   *    drop (px que cae al salir), draw(g, w, h) (viñeta en espacio de tarjeta), r }
   */
  function litCard(g, B, o) {
    const T = tok(), r = o.r ?? 30, p = o.p ?? 1, act = o.act || 0, lit = clamp(o.lit ?? 1);
    if (p < 0.002 || (o.gone || 0) > 0.998) return null;
    const y = B.y + 70 * (1 - p) - 16 * act + (o.drop ?? pick(900, 1300, 1300)) * ease.inOut(o.gone || 0);
    const sc = (0.92 + 0.08 * p) * (1 + 0.05 * (o.pulse || 0));
    g.save(); g.translate(B.x + B.w / 2, y + B.h / 2); g.scale(sc, sc); g.translate(-B.w / 2, -B.h / 2);
    g.shadowColor = T.shadow; g.shadowBlur = 40; g.shadowOffsetY = 16 + 8 * act;
    g.fillStyle = T.card; rrect(g, 0, 0, B.w, B.h, r); g.fill(); g.shadowColor = 'transparent';
    g.save(); rrect(g, 0, 0, B.w, B.h, r); g.clip(); g.fillStyle = T.cardIn; g.fillRect(0, 0, B.w, B.h); if (o.draw) o.draw(g, B.w, B.h); g.restore();
    if (lit < 0.999) { g.globalAlpha = 0.55 * (1 - lit); g.fillStyle = T.bg; rrect(g, 0, 0, B.w, B.h, r); g.fill(); g.globalAlpha = 1; }
    if (act > 0.01) { g.globalAlpha = clamp(act); g.strokeStyle = T.accent; g.lineWidth = 10; rrect(g, -5, -5, B.w + 10, B.h + 10, r + 5); g.stroke(); g.globalAlpha = 1; }
    g.restore();
    return { x: B.x + B.w / 2 - (B.w / 2) * sc, y: y + B.h / 2 - (B.h / 2) * sc, w: B.w * sc, h: B.h * sc };
  }

  // ------------------------------------------------------------------ píldoras (DOM) e íconos
  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
  };
  /** Píldora con ícono (chips de tarjetas, botón de acción). Registrada oculta: anímala con put(). */
  function pill(parent, label, icon, { size, bg, color }) {
    const p = el('div', { class: 'pill', style: `padding:${size * 0.36}px ${size * 0.62}px;font-size:${size}px;background:${bg};color:${color}` }, parent,
      `${ICONS[icon] || ''}<span data-notext="1">${label}</span>`);
    return reg(p, { o: 0 });
  }

  // ------------------------------------------------------------------ CTA: burbuja de escritura, anillo de presión, calendario
  /** Burbuja blanca con 3 puntos que "escriben". k = escala/visibilidad 0..1, tl = segundos. */
  function typing(g, x, y, k, tl) {
    if (k <= 0.01) return;
    const T = tok();
    g.save(); g.translate(x, y); g.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
    g.fillStyle = T.card; g.shadowColor = T.shadow; g.shadowBlur = 24; g.shadowOffsetY = 8;
    rrect(g, -70, -40, 140, 64, 32); g.fill(); g.shadowColor = 'transparent';
    for (let i = 0; i < 3; i++) { const ph = Math.sin(tl * 9 - i * 0.9); g.fillStyle = T.bg; g.globalAlpha = 0.45 + 0.4 * ph;
      g.beginPath(); g.arc(-30 + i * 30, -8 - 4 * Math.max(0, ph), 9, 0, TAU); g.fill(); }
    g.restore();
  }
  /** Anillo que se expande alrededor de un botón al presionarlo. rip 0..1 (seg lineal ≈ 1.2 beats). */
  function pressRing(g, x, y, w, h, rip, color = tok().action) {
    if (rip <= 0 || rip >= 1) return;
    g.save(); g.globalAlpha = 0.6 * (1 - rip); g.strokeStyle = color; g.lineWidth = 6;
    rrect(g, x - 24 * rip, y - 24 * rip, w + 48 * rip, h + 48 * rip, (h + 48 * rip) / 2); g.stroke(); g.restore();
  }
  /**
   * Tarjeta de calendario. Entra en snappy con leve giro, la grilla aparece en cascada y un día recibe su check.
   * CAL: {x, y, w, h}; o: { t, inAt, outAt, checkAt, check2At, floatAt (beats), day: [col, fila], day2: [col, fila] }
   */
  function calendar(g, CAL, o) {
    const T = tok(), t = o.t;
    const cp = sp(t, o.inAt, 'snappy'), out = o.outAt != null ? sp(t, o.outAt, 'snappy') : 0;
    if (cp <= 0.002) return;
    const fl = o.floatAt != null ? sp(t, o.floatAt, 'heavy') * Math.sin((t - C.bt(o.floatAt)) * 2.4) : 0;
    const y = CAL.y + 120 * (1 - cp) - 10 * fl - 1200 * ease.out(out);
    g.save(); g.translate(CAL.x + CAL.w / 2, y + CAL.h / 2); g.rotate(-0.04 * (1 - cp) + 0.012 * fl); g.translate(-CAL.w / 2, -CAL.h / 2);
    g.shadowColor = T.shadow; g.shadowBlur = 44; g.shadowOffsetY = 18;
    g.fillStyle = T.card; rrect(g, 0, 0, CAL.w, CAL.h, 32); g.fill(); g.shadowColor = 'transparent';
    g.save(); rrect(g, 0, 0, CAL.w, CAL.h, 32); g.clip(); g.fillStyle = T.bg; g.fillRect(0, 0, CAL.w, 92); g.restore();
    g.fillStyle = T.accent; for (const rx of [CAL.w * 0.25, CAL.w * 0.75]) { rrect(g, rx - 9, -14, 18, 44, 9); g.fill(); }
    const cols = 7, rows = 4, gx = CAL.w / cols, top = 120, gy = (CAL.h - top - 20) / rows, d1 = o.day || [3, 2], d2 = o.day2 || [5, 1];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cx = gx * (c + 0.5), cy = top + gy * (r + 0.5), d = sp(t, C.beatOf(o.inAt) + 0.1 + r * 0.1 + c * 0.02, 'snappy');
      g.fillStyle = r === d1[1] && c === d1[0] ? '#FBDCE6' : '#ECEAF4'; g.globalAlpha = on(d);
      g.beginPath(); g.arc(cx, cy, Math.min(gx, gy) * 0.3 * (0.6 + 0.4 * d), 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    const R = Math.min(gx, gy) * 0.44;
    if (o.checkAt != null) {
      const cx = gx * (d1[0] + 0.5), cy = top + gy * (d1[1] + 0.5);
      const ck = C.spHit(t, o.checkAt, 'default', 0.04);
      check(g, cx, cy, R, ck > 0.002 ? 0.6 + 0.4 * ck : 0, seg(t, o.checkAt, C.beatOf(o.checkAt) + 0.65), T.action, T.card);
      const rip = Math.max(seg(t, C.beatOf(o.checkAt) + 0.15, C.beatOf(o.checkAt) + 1.35), 0);
      if (rip > 0 && rip < 1) { g.globalAlpha = 1 - rip; g.strokeStyle = T.action; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R * (1 + 1.2 * rip), 0, TAU); g.stroke(); g.globalAlpha = 1; }
    }
    if (o.check2At != null) {
      const c2 = C.spHit(t, o.check2At, 'snappy', 0.04);
      check(g, gx * (d2[0] + 0.5), top + gy * (d2[1] + 0.5), R, c2 > 0.002 ? 0.6 + 0.4 * c2 : 0, c2 > 0.002 ? 1 : 0, T.accent, T.obj);
    }
    g.restore();
  }

  /** 9:16: la ilustración se disuelve hacia el fondo antes del bloque de texto (degradado y0 → y1). */
  function fadeToBg(g, y0, y1) {
    const T = tok(), fd = g.createLinearGradient(0, y0, 0, y1);
    fd.addColorStop(0, `rgba(${T.bgRgb},0)`); fd.addColorStop(1, T.bg);
    g.fillStyle = fd; g.fillRect(0, y0, W, y1 - y0 + 1);
  }

  window.ILUS = {
    TALL, PAD, SIZE, LH, TAU, LOOK, ICONS,
    tok, on, micro, pulse, rrect, stack,
    ik, limb, person, withDisc, sheet, thought, phone, clip,
    dust, drawDust, badge, beam, scanRings, glow, focusRing, sparkle, check,
    litCard, pill, typing, pressRing, calendar, fadeToBg,
  };
})();
