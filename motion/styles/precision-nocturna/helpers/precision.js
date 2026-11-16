// Helpers del estilo "Precisión nocturna" (window.PN). Funciones puras de t: construir DOM en build(), animar en run().
// Uso: copia este archivo a film/precision.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="precision.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Sin timers, sin Math.random, sin estado entre frames.
// Los colores salen de los tokens de :root (--bg, --ink, --ink-2, --accent, --line, --graphite, --card, --track, --light):
// para tu marca cambia los tokens, no este archivo.
(() => {
  const C = window.C;
  const { W, H, put, reg, el, sp, spHit, seg, clamp, lerp, ease, beatOf, beatAt, mulberry32 } = C;
  const { line, rise, type } = window.TYPE;

  // ------------------------------------------------------------------ tokens y básicos
  /** Lee un token de color de :root (llámalo en build o al cargar, nunca en run). */
  const tok = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  /** Hex (#rrggbb) → rgba(r,g,b,a). Para bandas y sombras teñidas con el fondo de la marca. */
  function hexA(hex, a) {
    const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  /** Margen izquierdo de toda la tipografía (1080 px de ancho). */
  const PAD = C.pick(120, 120, 120);
  /** 0→1 para todo lo que SUENA: resorte adelantado para que se lea en el beat. */
  const pop = (t, b, preset = 'snappy') => spHit(t, b, preset);
  /** Opacidad que salta con el resorte (nunca un fundido). */
  const on = (k) => (k > 0.002 ? 1 : 0);
  /** Micro push de un hold: 1 → 1 + amt entre dos beats (0.04–0.06; hasta 0.12 si la fuente tiene píxeles). */
  const micro = (t, b0, b1, amt = 0.04) => 1 + amt * ease.inOut(seg(t, b0, b1));
  const outC = (x) => 1 - (1 - clamp(x)) ** 3;
  /** Opciones para titulares que caen sobre una palabra de la VO. */
  const SN = { preset: 'snappy' };

  // ------------------------------------------------------------------ titulares
  /**
   * Pila de titulares Display a la izquierda: un renglón por string.
   * o: { x, y, size, lh (interlineado en px, por defecto size*1.18), color, accent: {fila: [índices de palabra]} }
   */
  function stack(parent, rows, o = {}) {
    const size = o.size || 112, lh = o.lh || Math.round(size * 1.18);
    return rows.map((r, i) => line(parent, r, { x: o.x ?? PAD, y: (o.y ?? 300) + i * lh, size, color: o.color, accent: (o.accent || {})[i] }));
  }
  /**
   * Hace subir cada renglón en su beat. ins: array de beats (uno por renglón) o un beat inicial (+step por renglón).
   * outB: beat de salida (siguiente entrada − 0.2) o null. o: opciones de TYPE.rise (preset, stagger).
   */
  function riseStack(t, Ls, ins, outB = null, o = {}) {
    Ls.forEach((L, i) => {
      const b = Array.isArray(ins) ? beatOf(ins[i]) : beatOf(ins) + i * (o.step ?? 0.25);
      rise(t, L, b, outB, { stagger: 0.05, ...o });
    });
  }
  /** Punto de acento: el signo final de la palabra (o un punto nuevo) en color de acento. word: índice o -1 = última. */
  function accentDot(L, word = -1) {
    const w = L.words[word < 0 ? L.words.length + word : word];
    const s = w.textContent, m = /[.!?…]$/.test(s);
    w.innerHTML = `${m ? s.slice(0, -1) : s}<span style="color:var(--accent)">${m ? s.slice(-1) : '.'}</span>`;
    return L;
  }

  // ------------------------------------------------------------------ pastillas, CTA, handle, legal
  /** Pastilla UI 600 con punto (acento por defecto; pasa dot: 'var(--line)' para la secundaria, null sin punto). */
  function pill(parent, text, { x, y, size = 46, bg = 'var(--card)', color = 'var(--ink)', dot = 'var(--accent)' } = {}) {
    const p = el('div', { class: 'pill', style: `left:${x}px;top:${y}px;padding:${size * 0.42}px ${size * 0.7}px;font-size:${size}px;background:${bg};color:${color}` }, parent,
      `${dot ? `<span style="width:${size * 0.36}px;height:${size * 0.36}px;border-radius:50%;background:${dot}"></span>` : ''}<span>${text}</span>`);
    return reg(p, { o: 0 });
  }
  /** La pastilla crece desde la izquierda en su beat (se revela por recorte 45 %→100 % con un leve 0.92→1), con resorte
   *  snappy adelantado. El texto nunca baja del 92 % de su tamaño: pasa el lint de legibilidad en todos los frames. */
  const growPill = (t, p, b) => {
    const k = pop(t, b), c = clamp(k, 0, 1);
    p.style.clipPath = `inset(-4px ${((1 - c) * 55).toFixed(2)}% -4px -4px round 999px)`;
    put(p, { o: on(k), sx: 0.92 + 0.08 * k, sy: 0.92 + 0.08 * k }); return k;
  };
  /** CTA vivo: crece en su cue y desde cue+0.75 late 1.07→1 en cada beat (nunca estático). */
  function ctaPulse(t, p, b) {
    const bb = beatAt(t), ck = pop(t, b), live = bb > beatOf(b) + 0.75;
    const f = bb - Math.floor(bb), s = live ? 1 + 0.07 * Math.exp(-f * 6) : 0.6 + 0.4 * ck;
    put(p, { o: on(ck), sx: s, sy: live ? s : 0.85 + 0.15 * ck });
  }
  /** Handle que se tipea con caret de acento (5 px) que parpadea cada medio beat. */
  function handle(parent, { x, y, size = 60 } = {}) {
    const d = el('div', { class: 'abs ui', 'data-notext': '1', style: `left:${x}px;top:${y}px;font-size:${size}px;color:var(--ink)` }, parent);
    const txt = el('span', {}, d, ''), car = el('span', { style: `display:inline-block;width:5px;height:${size * 1.03}px;margin-left:6px;vertical-align:-${size * 0.15}px;background:var(--accent)` }, d);
    reg(d); reg(txt); reg(car, { o: 0 });
    return { d, txt, car };
  }
  /** Tipea text entre b0 y b1 (el primer carácter cae sobre el click de b0). */
  function runHandle(t, Hd, text, b0, b1) {
    type(t, Hd.txt, text, beatOf(b0) + 0.02, beatOf(b1));
    const bb = beatAt(t), started = bb >= beatOf(b0) + 0.02;
    put(Hd.car, { o: started && (bb < beatOf(b1) || Math.floor(bb * 2) % 2 === 0) ? 1 : 0 });
  }
  /** Línea legal / regulatoria: UI 400, 32 px, tinta secundaria, marcada data-lint="ui". */
  function legal(parent, text, { x = PAD, y = 1462, size = 32 } = {}) {
    const d = el('div', { class: 'abs ui', 'data-lint': 'ui', 'data-notext': '1', style: `left:${x}px;top:${y}px;font-size:${size}px;font-weight:400;color:var(--ink-2)` }, parent, text);
    return reg(d, { o: 0 });
  }

  // ------------------------------------------------------------------ marcadores (para plantillas y bocetos)
  /** Tarjeta marcador oscura con borde punteado en línea técnica y rótulo centrado ("TU CLIP AQUÍ"). */
  function placeholder(parent, { x = 0, y = 0, w, h, label = 'TU CLIP AQUÍ', r = 18, bg = 'var(--card)', ink = 'var(--ink-2)', size } = {}) {
    const fs = size || Math.max(28, Math.round(Math.min(w, h) * 0.075));
    const d = el('div', { class: 'abs', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}px;background:${bg};` +
      `border:3px dashed var(--line);box-sizing:border-box;display:flex;align-items:center;justify-content:center;transform-origin:50% 50%` }, parent);
    el('div', { class: 'ui', style: `font-size:${fs}px;letter-spacing:0.12em;color:${ink};text-align:center` }, d, label);
    return d;
  }

  // ------------------------------------------------------------------ canvas: esquemas en línea fina
  /** Piso del esquema: línea técnica a 45 % y un velo del mismo color que se apaga hacia abajo. */
  function floorLine(g, y, color, alpha = 0.45) {
    g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    const gr = g.createLinearGradient(0, y, 0, y + 160); gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.07; g.fillStyle = gr; g.fillRect(0, y, W, 160); g.restore();
  }
  /** Anillo de señalamiento: arco que se traza de −90° a −90° + 360°·k. Acompáñalo de un pop. */
  function ringArc(g, x, y, r, k, color, lw = 5) {
    if (k <= 0.01) return;
    g.save(); g.globalAlpha = 1; g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(k)); g.stroke(); g.restore();
  }
  /**
   * Equipo genérico en línea fina sobre ruedecillas (marcador del producto real). (x, yFloor) = esquina inferior izquierda.
   * o: { w, h, rot (rad de las ruedecillas), lean (rad), color, fill, shadow (0..1), label }
   */
  function drawRoller(g, x, yFloor, o = {}) {
    const w = o.w || 420, h = o.h || 520, wr = Math.round(w * 0.075), color = o.color, fill = o.fill || color;
    g.save(); g.translate(x + w / 2, yFloor);
    if (o.shadow) { g.globalAlpha = clamp(o.shadow); g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, -4, w * 0.48, 18, 0, 0, Math.PI * 2); g.fill(); }
    g.rotate(o.lean || 0); g.translate(-w / 2, 0);
    g.lineWidth = 4; g.strokeStyle = color; g.lineJoin = 'round';
    const by = -h, bh = h - wr * 2 - 6;
    g.globalAlpha = 0.08; g.fillStyle = fill; g.beginPath(); g.roundRect(0, by, w, bh, 22); g.fill();
    g.globalAlpha = 1; g.beginPath(); g.roundRect(0, by, w, bh, 22); g.stroke();
    g.beginPath(); g.roundRect(w * 0.12, by + bh * 0.12, w * 0.76, bh * 0.36, 12); g.stroke();          // pantalla
    g.globalAlpha = 0.5; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(w * 0.12, by + bh * (0.62 + i * 0.1)); g.lineTo(w * (0.5 - i * 0.08), by + bh * (0.62 + i * 0.1)); g.stroke(); }
    g.globalAlpha = 1; g.beginPath(); g.arc(w * 0.76, by + bh * 0.72, w * 0.07, 0, Math.PI * 2); g.stroke();  // perilla
    for (const cx of [w * 0.18, w * 0.82]) {                                                                 // ruedecillas que giran
      const cy = -wr; g.beginPath(); g.arc(cx, cy, wr, 0, Math.PI * 2); g.stroke();
      for (let s = 0; s < 3; s++) { const a = (o.rot || 0) + s * Math.PI * 2 / 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * wr * 0.8, cy + Math.sin(a) * wr * 0.8); g.stroke(); }
    }
    if (o.label) { g.globalAlpha = 0.9; g.fillStyle = color; g.font = `600 ${Math.round(w * 0.065)}px UI`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.label, w / 2, by + bh * 0.3); }
    g.restore();
    return wr;
  }
  /**
   * Recorte real de un producto con ruedecillas: dibuja la imagen y redibuja cada avanza rodando recortada y girada, para que las
   * ruedecillas reales giren con el recorrido. src = { w, h, wheels: [[cx, cy, r], …] } en píxeles de la imagen fuente.
   */
  function drawCutout(g, im, x, y, w, src, rot = 0, lean = 0, shadow = 0.16) {
    const k = w / src.w, h = src.h * k;
    g.save(); g.translate(x + w / 2, y + h);
    if (shadow > 0) { g.globalAlpha = clamp(shadow); g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, -8 * k, w * 0.46, 26 * k, 0, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1; g.rotate(lean); g.translate(-w / 2, -h);
    g.drawImage(im, 0, 0, w, h);
    for (const [cx, cy, r] of src.wheels || []) {
      g.save(); g.beginPath(); g.arc(cx * k, cy * k, r * k, 0, Math.PI * 2); g.clip();
      g.translate(cx * k, cy * k); g.rotate(rot); g.translate(-cx * k, -cy * k);
      g.drawImage(im, 0, 0, w, h); g.restore();
    }
    g.restore();
  }
  /**
   * Recorrido continuo: se arrastra desde el frame 0 y suma empujes con resorte.
   * o: { x0, creep: [b0, b1, px], pushes: [[beat, px, preset='heavy'], …] } → x en px.
   */
  function travel(t, o) {
    let x = o.x0 || 0;
    if (o.creep) x += o.creep[2] * seg(t, o.creep[0], o.creep[1]);
    for (const [b, px, pr] of o.pushes || []) x += px * sp(t, b, pr || 'heavy');
    return x;
  }
  /** Balanceo amortiguado al frenar (sin rebote de UI): amp·sin(dt·15)·e^(−dt·6) desde el beat de frenado. */
  function brakeLean(t, beat, amp = 0.012) {
    const dt = t - C.bt(beat);
    return dt > 0 ? amp * Math.sin(dt * 15) * Math.exp(-dt * 6) : 0;
  }
  /** Altura y de un arco de círculo (centro cx, cy; radio R) en x. Para cortes transversales. */
  const yAt = (cx, cy, R, x) => cy - Math.sqrt(Math.max(0, R * R - (x - cx) ** 2));
  /** Corte transversal: banda entre dos arcos (R0 exterior, R1 interior) con relleno al 8 % y trazo de 4 px. */
  function arcBand(g, { cx = W / 2, cy, R0, R1, color, fill = 0.08, lw = 4 }) {
    g.save(); g.beginPath();
    for (let x = 0; x <= W; x += 10) g.lineTo(x, yAt(cx, cy, R0, x));
    for (let x = W; x >= 0; x -= 10) g.lineTo(x, yAt(cx, cy, R1, x));
    g.closePath(); g.globalAlpha = fill; g.fillStyle = color; g.fill();
    g.globalAlpha = 0.95; g.strokeStyle = color; g.lineWidth = lw;
    for (const R of [R0, R1]) { g.beginPath(); for (let x = 0; x <= W; x += 10) g.lineTo(x, yAt(cx, cy, R, x)); g.stroke(); }
    g.restore();
  }
  /** Jitter sembrado para las ráfagas de puntos: créalo en build(), nunca en run(). */
  const jitter = (seed, n, amp = 3) => { const r = mulberry32(seed); return Array.from({ length: n }, () => (r() - 0.5) * amp); };
  /**
   * Ráfagas de puntos → línea limpia. Los n puntos aparecen en `bursts` ráfagas, una cada `every` beats desde `start`
   * (cada ráfaga = un tick en timeline.sfx); `mergeB` es el beat en que se funden en una línea.
   * o: { n, x0, x1, y: (x) => y, start, bursts=10, every=0.25, mergeB, jit, dot, ink, r=13 }
   */
  function bursts(g, t, o) {
    const n = o.n, nb = o.bursts || 10, every = o.every || 0.25, r0 = o.r || 13;
    const merge = o.mergeB != null ? sp(t, o.mergeB, 'default') : 0;
    g.save();
    for (let i = 0; i < n; i++) {
      const x = lerp(o.x0, o.x1, i / (n - 1)), ti = C.bt(beatOf(o.start) + every * Math.floor(i * nb / n)) + 0.01;
      const age = clamp((t - ti) / 0.04), r = r0 * age * (1 - 0.7 * merge);
      if (r <= 0.05) continue;
      g.globalAlpha = 0.9; g.fillStyle = o.dot; g.beginPath(); g.arc(x, o.y(x) + (o.jit ? o.jit[i] : 0) * (1 - merge), r, 0, Math.PI * 2); g.fill();
    }
    if (merge > 0.001) {
      g.globalAlpha = 1; g.strokeStyle = o.ink || o.dot; g.lineWidth = 8; g.lineCap = 'round';
      g.beginPath(); const xe = lerp(o.x0, o.x1, clamp(merge));
      for (let x = o.x0; x <= xe; x += 8) g.lineTo(x, o.y(x)); g.stroke();
    }
    g.restore();
    return merge;
  }

  // ------------------------------------------------------------------ DOM: medidor, ensamblaje, barrido, recuadros
  /** Medidor: rótulo + pista grafito + relleno en línea técnica (sin número). */
  function meter(parent, { x = PAD, y, w = W - 2 * PAD, label = '' } = {}) {
    const lab = reg(el('div', { class: 'abs ui', style: `left:${x}px;top:${y}px;font-size:40px;font-weight:400;color:var(--ink-2)` }, parent, label), { o: 0 });
    const trk = reg(el('div', { class: 'abs', style: `left:${x}px;top:${y + 66}px;width:${w}px;height:22px;border-radius:11px;background:var(--track)` }, parent), { o: 0 });
    const fil = reg(el('div', { class: 'abs', style: `left:${x}px;top:${y + 66}px;width:${w}px;height:22px;border-radius:11px;background:var(--line);transform-origin:0 50%` }, parent), { o: 0 });
    return { lab, trk, fil };
  }
  /** Aparece en b (pop, suena) y cae a `floor` (0..1) con resorte heavy 0.35 beat después. */
  function runMeter(t, M, b, floor = 0.12) {
    const a = pop(t, b), f = sp(t, beatOf(b) + 0.35, 'heavy');
    put(M.lab, { o: on(a) }); put(M.trk, { o: on(a), sx: a }); put(M.fil, { o: on(a), sx: a * lerp(1, floor, f) });
  }
  /**
   * Interfaz que se arma: base, un esqueleto oscuro por pieza y la pieza real encima.
   * pieces: [{ x, y, w, h, beat, make(parent, w, h) → elemento }]. Coordenadas relativas a la base.
   */
  function assemble(parent, { x, y, w, h, pieces, bg = 'var(--track)', r = 14 }) {
    const base = reg(el('div', { class: 'abs', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}px;background:${bg};overflow:hidden` }, parent), { o: 0 });
    const sk = [], pc = [];
    for (const p of pieces) {
      sk.push(reg(el('div', { class: 'abs', style: `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;background:var(--card);border-radius:8px` }, base), { o: 0 }));
      const wrap = el('div', { class: 'abs', style: `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;transform-origin:50% 50%;overflow:hidden;border-radius:8px` }, base);
      p.make(wrap, p.w, p.h);
      pc.push(reg(wrap, { o: 0 }));
    }
    return { base, sk, pc, pieces };
  }
  /** La base sube 120 px desde b0 − 0.1 (default); cada pieza aparece 0.9→1 en su beat; su esqueleto se va al llegar. */
  function runAssemble(t, A, b0) {
    const pb = sp(t, beatOf(b0) - 0.1, 'default');
    put(A.base, { o: on(pb), y: 120 * (1 - pb), s: 0.94 + 0.06 * pb });
    A.pieces.forEach((p, i) => {
      const k = pop(t, p.beat);
      put(A.sk[i], { o: on(pb) * (k < 0.98 ? 1 : 0) });
      put(A.pc[i], { o: on(k), s: 0.9 + 0.1 * k });
    });
    return pb;
  }
  /** Barrido de escaneo único: línea vertical de 5 px que cruza `travelPx` una sola vez en `beats` beats. */
  const scanLine = (parent, { x, y, h }) => reg(el('div', { class: 'abs', style: `left:${x}px;top:${y}px;width:5px;height:${h}px;background:var(--line)` }, parent), { o: 0 });
  function runScan(t, s, b, travelPx, beats = 2) {
    const ph = seg(t, b, beatOf(b) + beats);
    put(s, ph > 0 && ph < 1 ? { o: 1, x: ease.out(ph) * travelPx } : { o: 0 });
  }
  /** Recuadro de área: borde de 6 px en línea técnica que se cierra 1.08→1 sobre una zona. */
  const areaBox = (parent, { x, y, w, h, r = 14 }) => reg(el('div', { class: 'abs', style: `left:${x - 6}px;top:${y - 6}px;width:${w + 12}px;height:${h + 12}px;border:6px solid var(--line);border-radius:${r}px;box-sizing:border-box;transform-origin:50% 50%` }, parent), { o: 0 });
  const runArea = (t, a, b) => { const k = pop(t, b); put(a, { o: on(k), s: 1.08 - 0.08 * k }); return k; };
  /** Anillo DOM (círculo con borde 6 px) para señalar sobre fotos; crece 0.6→1 con pop. */
  const ringDiv = (parent, { x, y, d = 180 }) => reg(el('div', { class: 'abs', style: `left:${x - d / 2}px;top:${y - d / 2}px;width:${d}px;height:${d}px;border-radius:50%;border:6px solid var(--line);box-sizing:border-box;transform-origin:50% 50%` }, parent), { o: 0 });
  const runRingDiv = (t, r, b, s = 1) => { const k = pop(t, b); put(r, { o: on(k), s: (0.6 + 0.4 * k) * s }); return k; };

  // ------------------------------------------------------------------ número gigante + etiqueta + regla
  /** Etiqueta en mayúsculas espaciadas (UI). */
  function label(parent, s, x, y, size = 44, o = {}) {
    const L = line(parent, s, { x, y, size, cls: 'ui', color: o.color || 'var(--ink)' });
    L.el.style.fontWeight = o.w || 600; L.el.style.letterSpacing = o.ls || '0.12em';
    return L;
  }
  /** Regla de size×4 px que se extiende desde la izquierda. */
  const rule = (parent, x, y, w = 160) => reg(el('div', { class: 'abs', style: `left:${x}px;top:${y}px;width:${w}px;height:4px;background:var(--ink);transform-origin:0 0` }, parent), { o: 0 });
  const runRule = (t, r, b) => { const u = sp(t, b, 'default'); put(r, { o: on(u), sx: u }); };
  /**
   * Bloque de dato: etiqueta, valor gigante, regla, subs y nota chica.
   * o: { x, y, label, value, size (210–300), subs: [], note, count: {from, to, fmt: '#x'} }
   */
  function bigNumber(parent, o) {
    const x = o.x ?? PAD, y = o.y ?? 920, vs = o.size || 240;
    const N = { o };
    N.lab = label(parent, o.label, x + 4, y, 52);
    N.val = line(parent, o.value, { x: x - 6, y: y + 124, size: vs });
    N.rule = rule(parent, x, y + 124 + vs * 1.08 + 8);
    const sy = y + 124 + vs * 1.08 + 30;
    N.subs = (o.subs || []).map((s, k) => label(parent, s, x + 2, sy + k * 88, 72, { w: 400, ls: '0' }));
    if (o.note) { N.note = label(parent, o.note, x + 2, sy + N.subs.length * 88 + 14, 32, { w: 400, ls: '0', color: 'var(--ink-2)' }); N.note.el.dataset.lint = 'ui'; }
    return N;
  }
  /** Tiempos medidos: etiqueta b0−0.1, valor b0 (heavy), regla b0+0.35, subs b0+0.4 (+0.15 c/u), nota b0+0.8. */
  function runBigNumber(t, N, b0, outB = null) {
    const b = beatOf(b0), o = N.o;
    rise(t, N.lab, b - 0.1, outB, { preset: 'snappy', stagger: 0.03 });
    rise(t, N.val, b, outB, { preset: 'heavy', stagger: 0.08 });
    if (o.count) {
      const k = ease.out(seg(t, b + 0.1, b + (o.count.beats || 1.6)));
      put(N.val.words[0], { text: (o.count.fmt || '#').replace('#', String(Math.round(lerp(o.count.from || 0, o.count.to, k)))) });
    }
    runRule(t, N.rule, b + 0.35);
    N.subs.forEach((L, k) => rise(t, L, b + 0.4 + k * 0.15, outB, { preset: 'snappy', stagger: 0.03 }));
    if (N.note) rise(t, N.note, b + 0.8, outB, { preset: 'snappy', stagger: 0.01 });
  }

  // ------------------------------------------------------------------ footage: banda y tarjeta de dato
  /** Banda oscura inferior (color de --bg) para tapar texto quemado del footage y alojar tipografía. top: 0..1. */
  function shade(parent, top = 0.42) {
    const bg = tok('--bg', '#000000');
    const d = el('div', { class: 'abs', style: `width:${W}px;height:${H}px;background:linear-gradient(180deg,${hexA(bg, 0.35)} 0%,${hexA(bg, 0)} 18%,` +
      `${hexA(bg, 0)} ${top * 100}%,${hexA(bg, 0.85)} ${top * 100 + 12}%,${bg} ${top * 100 + 18}%,${bg} 100%)` }, parent);
    return reg(d);
  }
  /** Footage a pantalla completa desde una secuencia de frames (lib/media.js), con zoom y encuadre. */
  const broll = (g, f, t, t0, o = {}) => C.drawSeq(g, f, t, t0, { x: 0, y: 0, w: W, h: H }, { pos: o.pos || [0.5, 0.38], z: o.z || 1.45, fps: o.fps || 30, filter: o.filter || 'none' });
  /**
   * Tarjeta de dato / nombre: panel oscuro con barra izquierda de acento; se revela por clip de izquierda a derecha.
   * lines: strings (56 px) u objetos { s, size, accent: [] }.
   */
  function tagCard(parent, { x = PAD - 28, y, w = W - 2 * PAD + 8, eyebrow = '', lines = [] }) {
    const box = el('div', { class: 'abs', style: `left:${x}px;top:${y}px;width:${w}px;background:var(--card);border-left:8px solid var(--accent);border-radius:14px;box-sizing:border-box` }, parent);
    reg(box, { o: 0 });
    const eb = label(box, eyebrow, 36, 26, 36, { color: 'var(--accent)' });
    let ly = 88;
    const L = lines.map((l) => {
      const o = typeof l === 'string' ? { s: l } : l, size = o.size || 56;
      const r = line(box, o.s, { x: 34, y: ly, size, accent: o.accent || [] }); ly += size * 1.25; return r;
    });
    box.style.height = ly + 30 + 'px';
    return { box, eb, L };
  }
  function runTag(t, T, inB, outB = 1e9) {
    const p = pop(t, inB), q = sp(t, outB, 'snappy');
    put(T.box, { o: p > 0.06 && q < 0.7 ? 1 : 0, clip: C.inset(0, (1 - p) * 100, 0, q * 100, 14) });
    rise(t, T.eb, beatOf(inB) - 0.05, null, { preset: 'snappy', stagger: 0.02 });
    T.L.forEach((L, i) => rise(t, L, beatOf(inB) + 0.06 + i * 0.27, null, { preset: 'snappy', stagger: 0.03 }));
  }

  window.PN = {
    tok, hexA, PAD, pop, on, micro, outC, SN,
    stack, riseStack, accentDot,
    pill, growPill, ctaPulse, handle, runHandle, legal, placeholder,
    floorLine, ringArc, drawRoller, drawCutout, travel, brakeLean, yAt, arcBand, jitter, bursts,
    meter, runMeter, assemble, runAssemble, scanLine, runScan, areaBox, runArea, ringDiv, runRingDiv,
    label, rule, runRule, bigNumber, runBigNumber, shade, broll, tagCard, runTag,
  };
})();
