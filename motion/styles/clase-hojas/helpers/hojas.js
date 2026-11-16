// Helpers del estilo «Clase en hojas» (window.HOJAS). Funciones puras de t: construir DOM en build(), llamar en run().
// Uso: copia este archivo a film/hojas.js y cárgalo en film/index.html DESPUÉS de type.js y ANTES de film.js:
//   <script src="hojas.js"></script>
// Requiere core.js (window.C) y type.js (window.TYPE). Las clases CSS que usa (.eyebrow, .card, .chip, .slot…) y los
// tokens de color (--bg, --ink, --ink-2, --ink-3, --accent, --tint-*, --card, --on-accent, --bad, --warn) viven en
// demo/index.html: cópialo como film/index.html y cambia solo los tokens.
//
// TIEMPOS: todo lo que recibe `s`, `at`, `a`, `b`, `sout`… está en SEGUNDOS (tiempos de palabra de la voz).
// Las marcas de timeline.json (s1, s2…, endcard) siguen siendo beats y solo se usan para las hojas (cam / section).
// Nada de timers, Math.random, Date ni estado que cambie entre frames.
(() => {
  const C = window.C, TYPE = window.TYPE;
  const { W, H, put, reg, el, sp, spHit, seg, clamp, beatAt, bt, pick } = C;

  // ------------------------------------------------------------------ rejilla por formato
  /** margen izquierdo, ancho útil y posiciones verticales base (16:9 · 1:1/4:5 · 9:16) */
  const PAD = pick(140, 90, 80);
  const CW = pick(1640, 900, 860);               // ancho útil (9:16 deja libre el 12 % derecho de la interfaz)
  const TOP = pick(128, 110, 290);               // eyebrow (9:16: por debajo del 14 % superior)
  const BOTTOM = pick(1000, 1260, 1520);         // límite inferior del contenido (9:16: por encima del 20 % inferior)
  const TITLE = pick(80, 72, 84);                // tamaño de título de sección

  // ------------------------------------------------------------------ tiempo (segundos ↔ beats)
  const B = (s) => beatAt(s);
  const hit = (t, s, preset = 'default') => spHit(t, B(s), preset);
  /** progreso suave 0..1 entre dos tiempos (figuras que avanzan con la voz) */
  const span = (t, a, b) => { const u = clamp((t - a) / Math.max(0.3, b - a)); return u * u * (3 - 2 * u); };
  /** sube en `s` y vuelve a reposo (0 → 1 → 0): pulsos de énfasis */
  const pulse = (t, s, hold = 0.9) => hit(t, s, 'snappy') - hit(t, s + hold, 'default');
  /** golpes repetidos (baja en cada tiempo de `at`, vuelve ~0,45 s después) */
  const strokes = (t, at) => at.reduce((m, s) => Math.max(m, hit(t, s, 'snappy') - hit(t, s + 0.45, 'snappy')), 0);
  /** liberación del empuje de hoja: 0,33 s antes de la marca para que el pico caiga sobre el whoosh a cualquier tempo */
  const LATE = {};                               // ajustes finos por marca, en segundos (p. ej. { endcard: 0.06 })
  const rel = (m) => bt(m) - 0.33 + (LATE[m] || 0);

  // ------------------------------------------------------------------ palabras de la voz
  // window.WORDS = { s1: [{ w, t }], s2: … } (tiempos absolutos). Si no existe, se arma desde window.VO (words.py → sync.mjs):
  // cada frase de vo.json con id s1, s2… aporta sus palabras.
  const norm = (s) => String(s).normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  let CACHE = null;                               // derivado una sola vez de datos fijos: no depende del frame
  function words() {
    if (CACHE) return CACHE;
    if (window.WORDS) return (CACHE = window.WORDS);
    const out = {};
    for (const p of window.VO || []) {
      const id = String(p.id || '').replace(/[_-].*$/, '');
      (out[id] = out[id] || []).push(...(p.words || []).map((w) => ({ w: w.w, t: w.t0 })));
    }
    return (CACHE = out);
  }
  const list = (id) => { const l = words()[id]; if (!l) throw new Error(`no hay palabras para la sección "${id}"`); return l; };
  /** tiempo de la n-ésima palabra de la sección `id` que EMPIEZA por `word` ('dos|2' = cualquiera de las dos) */
  function wt(id, word, n = 0) {
    const ks = word.split('|').map(norm); let c = 0;
    for (const w of list(id)) { const x = norm(w.w); if (x && ks.some((k) => x.startsWith(k))) { if (c++ === n) return w.t; } }
    throw new Error(`palabra "${word}"#${n} no está en ${id}`);
  }
  /** coincidencia exacta («Al» sin atrapar «alarma») */
  function wx(id, word, n = 0) {
    const k = norm(word); let c = 0;
    for (const w of list(id)) if (norm(w.w) === k && c++ === n) return w.t;
    throw new Error(`palabra "${word}" no está en ${id}`);
  }
  /** tiempo de la palabra que está `k` posiciones después de `word` */
  function wk(id, word, k = 0, n = 0) {
    const key = norm(word), ws = list(id); let c = 0;
    for (let i = 0; i < ws.length; i++) if (norm(ws[i].w).startsWith(key)) { if (c++ === n) return ws[Math.min(ws.length - 1, i + k)].t; }
    throw new Error(`palabra "${word}"#${n} no está en ${id}`);
  }
  /**
   * Guion SIN voz (maquetas, demos, animatics): reparte las palabras de `text` desde t0 cada `dt` s, con una pausa extra
   * tras cada signo de puntuación. Devuelve [{ w, t }]. Úsalo para window.WORDS mientras no exista la VO real.
   */
  function script(t0, text, dt = 0.2, pause = 0.12) {
    let t = t0;
    return text.split(/\s+/).filter(Boolean).map((w) => { const o = { w, t: +t.toFixed(3) }; t += dt + (/[.,:;?!]$/.test(w) ? pause : 0); return o; });
  }

  // ------------------------------------------------------------------ movimiento
  /** resorte «pop» propio del estilo: ~6 % de sobretiro, para tarjetas y chips que crecen (ζ 0,72) */
  const POP = { response: 0.3, damping: 0.72 };
  /** crece (escala s0 → 1, sube dy, opacidad asentada en ~4 frames). o: { dx, dy, s0, preset, solid, out } */
  function enter(t, e, s, o = {}) {
    const p = hit(t, s, !o.preset || o.preset === 'snappy' || o.preset === 'pop' ? POP : o.preset);   // tarjetas y chips: pequeño sobretiro
    const s0 = o.s0 ?? 0.9;
    let y = (o.dy ?? 34) * (1 - p), x = (o.dx ?? 0) * (1 - p), sc = s0 + (1 - s0) * p;
    let op = p > 0.003 ? (o.solid ? 1 : Math.min(1, p * 12)) : 0;
    if (o.out != null) {                                                             // colapso: sube, encoge y desaparece
      const q = sp(t, B(o.out), 'snappy');
      y -= 50 * q; sc *= 1 - 0.06 * q; op *= q > 0.35 ? 0 : 1;
    }
    put(e, { o: op, y, x, s: sc });
    return p;
  }
  /** atenuado al 32 % → encendido al 100 % en `s` (filter: opacity, para no pisar la opacidad de entrada) */
  const lit = (t, e, s) => put(e, { css: { filter: `opacity(${(0.32 + 0.68 * hit(t, s, 'snappy')).toFixed(3)})` } });
  /** un fragmento de texto que pasa de gris (30 %) a tinta en `s` */
  const dark = (t, e, s) => put(e, { o: 0.3 + 0.7 * hit(t, s, 'snappy') });
  /** pulso de escala sobre algo ya encendido */
  const ringFx = (t, e, s, k = 0.035) => put(e, { s: 1 + k * pulse(t, s, 0.5) });

  /** micro push + hoja rígida: io = [marca de entrada, marca de salida]. Entra desde W·1,05 y sale a −W·1,05 */
  function cam(t, S, k = 0.02, io = []) {
    const p = io[0] != null ? sp(t, B(rel(io[0])), 'heavy') : 1;
    const q = io[1] != null ? sp(t, B(rel(io[1])), 'heavy') : 0;
    put(S.root, { s: 1 + k * seg(t, S.from, S.to), x: W * 1.05 * (1 - p - q), hide: p < 0.002 || q > 0.995 });
  }
  /** sub-página que sale a la izquierda en `sout` (s) */
  function page(t, g, sout) {
    const q = sout == null ? 0 : sp(t, B(sout), 'heavy');
    put(g, { x: -W * 1.12 * q, hide: q > 0.995 });
  }
  /** sub-página que llega desde la derecha en `sin` (y opcionalmente sale en `sout`) */
  function pageIn(t, g, sin, sout) {
    const p = sp(t, B(sin), 'heavy'), q = sout == null ? 0 : sp(t, B(sout), 'heavy');
    put(g, { x: W * 1.05 * (1 - p) - W * 1.12 * q, hide: p < 0.002 || q > 0.995 });
  }
  /** cambio interno: el grupo A sale a la izquierda mientras B entra desde la derecha, sin crossfade */
  function swap(t, a, b, s) {
    const q = sp(t, B(s), 'heavy');
    put(a, { x: -W * 1.05 * q, hide: q > 0.995 });
    put(b, { x: W * 1.05 * (1 - q), hide: q < 0.002 });
    return q;
  }
  /** foto / clip que se abre de izquierda a derecha tras una máscara redondeada mientras escala 0,94 → 1 */
  function photoIn(t, f, s, r = 32) {
    const p = hit(t, s, 'heavy');
    put(f, { o: p > 0.003 ? 1 : 0, s: 0.94 + 0.06 * p, y: 30 * (1 - p), css: { clipPath: `inset(0 ${(100 * (1 - clamp(p))).toFixed(2)}% 0 0 round ${r}px)` } });
    return p;
  }

  // ------------------------------------------------------------------ DOM
  const grp = (parent) => reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px` }, parent));
  function box(parent, cls, x, y, html = '', style = '') {
    return reg(el('div', { class: cls, style: `left:${x}px;top:${y}px;${style}` }, parent, html), { o: 0 });
  }
  const eyebrow = (p, n, txt, y = TOP) => box(p, 'eyebrow', PAD, y, `<b>${n}</b>${txt}`, `font-size:${pick(30, 32, 36)}px`);
  const chip = (p, x, y, txt, cls = '', ic = '', style = '') => box(p, 'chip ' + cls, x, y, (ic ? `<span class="ic">${ic}</span>` : '') + txt, style);
  const head = (p, text, x, y, size, accent = []) => TYPE.line(p, text, { x, y, size, accent });
  /** las palabras del título suben desde s0 (s) con un pequeño escalonado, o en tiempos explícitos (s[]) */
  function headRun(t, L, s0, gap = 0.12) {
    const per = bt(1) - bt(0);
    const at = Array.isArray(s0) ? s0.map((s) => B(s) - 0.1) : L.words.map((_, i) => B(s0) - 0.15 + i * gap / per);
    TYPE.rise(t, L, at, null, { preset: 'heavy' });
  }

  // iconos (trazo en currentColor: el círculo que los contiene fija el color)
  const svg = (d, sw = 3.2) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    CHECK: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
    CROSS: svg('<path d="M6 6l12 12M18 6L6 18"/>', 3.4),
    PLUS: svg('<path d="M12 5v14M5 12h14"/>', 3.4),
    WARN: svg('<path d="M12 6v8"/><circle cx="12" cy="18.5" r="1.2" fill="currentColor"/>'),
    INFO: svg('<path d="M12 10.5v7"/><circle cx="12" cy="6.5" r="1.2" fill="currentColor"/>'),
    CLOCK: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>', 2.6),
    STAR: svg('<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>', 2.2),
    BOLT: svg('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', 2.4),
    PLAY: svg('<path d="M9 6.5v11l9-5.5z" fill="currentColor"/>', 2),
    CAL: svg('<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>', 2.4),
  };
  /** icono en círculo de color (bg = 'var(--accent)' | 'var(--bad)' | 'var(--warn)') */
  const icon = (svgStr, bg = 'var(--accent)', size = 64) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:var(--on-accent);flex:none">${svgStr.replace('width="24" height="24"', `width="${Math.round(size * 0.5)}" height="${Math.round(size * 0.5)}"`)}</span>`;
  /** número en círculo de acento */
  const num = (n, size = 64) => `<span style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;font:800 ${Math.round(size * 0.53)}px/1 'Display'">${n}</span>`;

  // segmentos que se oscurecen palabra por palabra: [[texto, 'sN', 'palabra', n?], …]
  const segHTML = (segs) => typeof segs === 'string' ? segs : segs.map(([x, id, w, n]) => `<span class="sg" data-id="${id}" data-w="${w}" data-n="${n || 0}">${x}</span>`).join('');
  const segReg = (root) => [...root.querySelectorAll('.sg')].map((e) => reg(e));
  const darkSegs = (t, segsEls, lead = 0.12) => segsEls.forEach((e) => dark(t, e, wt(e.dataset.id, e.dataset.w, +e.dataset.n) - lead));

  /** tarjeta con icono circular, título Display y subtexto UI (sub admite segmentos) */
  function icard(p, x, y, w, h, svgStr, color, title, sub = '', size = 46) {
    const isz = pick(84, 76, 72);
    return box(p, 'card', x, y, `<div style="padding:${pick(44, 40, 36)}px ${pick(44, 40, 38)}px;display:flex;flex-direction:column;gap:22px">${icon(svgStr, color, isz)}<div style="font:800 ${size}px/1.12 'Display';letter-spacing:-0.02em;color:var(--ink)">${segHTML(title)}</div>${sub ? `<div style="font:600 ${pick(32, 32, 38)}px/1.3 UI;color:var(--ink-2)">${segHTML(sub)}</div>` : ''}</div>`, `width:${w}px;height:${h}px`);
  }
  /** fila numerada a todo el ancho útil (o w) con título y sub */
  function rowCard(p, y, lead, title, sub = '', h = 170, w = CW, x = PAD) {
    return box(p, 'card', x, y, `<div style="height:${h}px;display:flex;align-items:center;gap:${pick(32, 28, 28)}px;padding:0 ${pick(40, 36, 34)}px">${lead}<div><div style="font:800 ${pick(44, 42, 46)}px/1.12 'Display';letter-spacing:-0.02em;color:var(--ink)">${segHTML(title)}</div>${sub ? `<div style="margin-top:12px;font:600 ${pick(32, 32, 34)}px/1.25 UI;color:var(--ink-2)">${segHTML(sub)}</div>` : ''}</div></div>`, `width:${w}px;height:${h}px`);
  }
  /** fila clave → valor (fichas y tablas): la clave en acento, el valor en tinta */
  function kv(p, y, k, v, h = 128, kw = pick(360, 280, 250)) {
    return box(p, 'card', PAD, y, `<div style="height:${h}px;display:flex;align-items:center;padding:0 ${pick(44, 36, 34)}px;gap:${pick(40, 28, 26)}px"><div style="flex:none;width:${kw}px;font:800 ${pick(38, 36, 36)}px/1.1 'Display';letter-spacing:-0.01em;color:var(--accent)">${k}</div><div style="font:700 ${pick(36, 34, 34)}px/1.25 UI;color:var(--ink)">${segHTML(v)}</div></div>`, `width:${CW}px;height:${h}px`);
  }
  /** tarjeta con un canvas propio (figuras explicativas). d.g = contexto, d.w/d.h = tamaño */
  function panel(parent, x, y, w, h, bare = false) {
    const d = reg(el('div', { class: 'card', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden${bare ? ';box-shadow:none;background:transparent' : ''}` }, parent), { o: 0 });
    const c = el('canvas', { width: w, height: h, style: `position:absolute;left:0;top:0;width:${w}px;height:${h}px` }, d);
    d.g = c.getContext('2d'); d.w = w; d.h = h;
    return d;
  }
  const canvasPanel = (p, x, y, w, h) => panel(p, x, y, w, h, true);
  /** foto real (recorte cover) en marco redondeado; anima f._im para el push lento */
  function photo(p, src, x, y, w, h, pos = '50% 50%') {
    const f = reg(el('div', { class: 'photo', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px` }, p), { o: 0 });
    f._im = reg(el('img', { src, style: `width:${w}px;height:${h}px;object-fit:cover;object-position:${pos}` }, f));
    return f;
  }
  /** marcador de posición para metraje: tarjeta rayada con «TU CLIP AQUÍ». Se reemplaza por photo() o C.drawSeq */
  function slot(p, x, y, w, h, label = 'TU CLIP AQUÍ', note = 'Foto o video de la clase') {
    const f = reg(el('div', { class: 'photo slot', style: `left:${x}px;top:${y}px;width:${w}px;height:${h}px` }, p,
      `<div class="slot-in">${icon(ICONS.PLAY, 'var(--accent)', pick(96, 92, 104))}<div class="slot-l">${label}</div><div class="slot-n">${note}</div></div>`), { o: 0 });
    return f;
  }

  // ------------------------------------------------------------------ canvas
  const reset = (g) => { g.lineCap = 'butt'; g.lineJoin = 'miter'; g.setLineDash([]); g.globalAlpha = 1; g.textAlign = 'start'; g.textBaseline = 'alphabetic'; g.shadowBlur = 0; g.shadowColor = 'transparent'; g.shadowOffsetY = 0; };
  /** lee un token de color de :root (para pintar en canvas con la paleta del proyecto) */
  const TOK = {};
  const tok = (name) => TOK[name] || (TOK[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888');
  /** mezcla dos colores hex: k = 0 → a, 1 → b */
  function mix(a, b, k) {
    const h = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
    const A = h(a), Bc = h(b);
    return '#' + A.map((v, i) => Math.round(v + (Bc[i] - v) * k).toString(16).padStart(2, '0')).join('');
  }
  /** rampa tonal del acento (datos de varias partes = tonos de UN color, nunca colores distintos) */
  const ramp = (n) => Array.from({ length: n }, (_, i) => mix(tok('--accent'), i < n - 1 ? tok('--bg') : tok('--ink'), i < n - 1 ? 0.62 * (1 - i / Math.max(1, n - 2)) : 0.35));
  /** etiqueta legible sobre canvas (≥ 28 px), con pastilla clara detrás */
  function tag(g, txt, x, y, a = 1, size = 28) {
    if (a <= 0.002) return;
    g.save(); g.globalAlpha = a; g.font = `700 ${size}px UI`;
    const tw = g.measureText(txt).width;
    g.fillStyle = tok('--card'); g.beginPath(); g.roundRect(x, y - size - 6, tw + 26, size + 18, 12); g.fill();
    g.fillStyle = tok('--ink'); g.fillText(txt, x + 13, y);
    g.restore(); reset(g);
  }
  /**
   * Figura «capas»: franjas horizontales que se rellenan de arriba abajo (estructuras, niveles, etapas apiladas).
   * ks[i] = progreso 0..1 de cada capa, labels[i] = rótulo, on = índice de la capa resaltada (anillo de acento) o -1.
   */
  function drawLayers(d, ks, labels = [], on = -1) {
    const g = d.g, w = d.w, h = d.h, n = ks.length;
    g.clearRect(0, 0, w, h); reset(g);
    const cols = ramp(n), gap = 14, lh = (h - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const y = gap + i * (lh + gap), k = clamp(ks[i] || 0);
      g.fillStyle = tok('--tint-50'); g.beginPath(); g.roundRect(gap, y, w - 2 * gap, lh, 18); g.fill();
      if (k > 0.002) {
        g.save(); g.beginPath(); g.roundRect(gap, y, w - 2 * gap, lh, 18); g.clip();
        g.fillStyle = cols[i]; g.beginPath();
        for (let x = 0; x <= (w - 2 * gap) * k + 20; x += 12) g.lineTo(gap + x, y + 6 * Math.sin(x / 38 + i));
        g.lineTo(gap + (w - 2 * gap) * k, y + lh); g.lineTo(gap, y + lh); g.closePath(); g.fill();
        g.restore();
      }
      if (i === on) { g.strokeStyle = tok('--accent'); g.lineWidth = 6; g.beginPath(); g.roundRect(gap - 4, y - 4, w - 2 * gap + 8, lh + 8, 22); g.stroke(); }
      if (labels[i]) tag(g, labels[i], gap + 18, y + lh / 2 + 14, clamp(k * 3));
    }
  }
  /**
   * Figura «proceso»: nodos unidos por una línea que se dibuja con la voz. k = 0..n-1 (avance continuo),
   * labels = rótulos bajo cada nodo, vertical = true para 9:16 estrecho.
   */
  function drawSteps(d, k, labels = [], vertical = false) {
    const g = d.g, w = d.w, h = d.h, n = labels.length || 3;
    g.clearRect(0, 0, w, h); reset(g);
    const pt = (i) => vertical ? [60, 50 + i * (h - 100) / (n - 1)] : [60 + i * (w - 120) / (n - 1), h * 0.38];
    g.lineWidth = 8; g.lineCap = 'round';
    g.strokeStyle = tok('--tint-200'); g.beginPath(); g.moveTo(...pt(0)); g.lineTo(...pt(n - 1)); g.stroke();
    const a = pt(0), b = pt(n - 1), u = clamp(k / (n - 1));
    g.strokeStyle = tok('--accent'); g.beginPath(); g.moveTo(...a); g.lineTo(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u); g.stroke();
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i), on = clamp(k - i + 1);
      g.fillStyle = on > 0.5 ? tok('--accent') : tok('--card'); g.strokeStyle = on > 0.5 ? tok('--accent') : tok('--tint-200'); g.lineWidth = 6;
      g.beginPath(); g.arc(x, y, 22 + 8 * clamp(on), 0, 7); g.fill(); g.stroke();
      if (labels[i]) { g.font = '700 30px UI'; g.fillStyle = on > 0.5 ? tok('--ink') : tok('--ink-3'); g.textAlign = vertical ? 'start' : 'center'; g.fillText(labels[i], vertical ? x + 56 : x, vertical ? y + 10 : y + 76); g.textAlign = 'start'; }
    }
  }
  /**
   * Figura «barra apilada»: partes [[rótulo, peso], …] que crecen cada una en su palabra (ks[i] 0..1), en la rampa del acento.
   * Útil para composición de un precio, de un tiempo o de un plan SIN cifras en pantalla.
   */
  function drawStack(d, parts, ks, o = {}) {
    const g = d.g, w = d.w, h = d.h;
    g.clearRect(0, 0, w, h); reset(g);
    const tot = parts.reduce((s, p) => s + p[1], 0), bh = o.bh || h * 0.5, y = o.y ?? 10, cols = ramp(parts.length);
    g.fillStyle = tok('--tint-100'); g.beginPath(); g.roundRect(0, y, w, bh, 22); g.fill();
    g.save(); g.beginPath(); g.roundRect(0, y, w, bh, 22); g.clip();
    let x = 0;
    parts.forEach(([, wt0], i) => { const pw = w * wt0 / tot, k = clamp(ks[i] || 0); if (k > 0.002) { g.fillStyle = cols[i]; g.fillRect(x, y + bh * (1 - k), pw - 4, bh * k); } x += pw; });
    g.restore();
    x = 0; g.font = '700 28px UI'; g.textAlign = 'center';
    parts.forEach(([name, wt0], i) => { const pw = w * wt0 / tot; g.fillStyle = (ks[i] || 0) > 0.5 ? tok('--ink') : tok('--ink-3'); g.fillText(name, x + pw / 2, y + bh + 42); x += pw; });
    g.textAlign = 'start';
  }

  // ------------------------------------------------------------------ escenas listas
  /**
   * Una sección = una hoja empujada. def:
   *   name, from, to       marcas (beats) de entrada y salida (la de salida es la marca de la siguiente hoja)
   *   push                 micro push total (0,012 densa · 0,02–0,025 pocas tarjetas grandes)
   *   eyebrow: ['01', 'Nombre de la sección']
   *   title: 'Texto' | ['línea 1', 'línea 2'], acc: [índices de palabra con acento, contando todas las líneas], size
   *   titleAt              segundo en que suben las palabras del título (por defecto, la llegada de la hoja)
   *   build(root, S)       S.top = primera y libre bajo el título · S.PAD / S.CW = rejilla
   *   run(t, S, l0)        l0 = segundo de aterrizaje (escalona tus enter() desde ahí; luego lit() en cada palabra)
   */
  function section(def) {
    const size = def.size || TITLE;
    return C.scene({
      name: def.name, from: C.beatOf(def.from) - 1.2, to: C.beatOf(def.to) + 1.5,
      build(root, S) {
        S.PAD = PAD; S.CW = CW;
        S.eb = eyebrow(root, def.eyebrow[0], def.eyebrow[1]);
        const lines = def.title ? [].concat(def.title) : [];
        let off = 0, y = TOP + pick(72, 66, 78);
        S.h = lines.map((tx) => {
          const n = tx.split(' ').length, acc = (def.acc || []).filter((i) => i >= off && i < off + n).map((i) => i - off);
          off += n; const L = head(root, tx, PAD, y, size, acc); y += size * 1.1; return L;
        });
        S.top = y + pick(36, 40, 56);
        def.build && def.build(root, S);
        S.sg = segReg(root);
      },
      run(t, b, S) {
        cam(t, S, def.push ?? 0.02, [def.from, def.to]);
        const l0 = bt(def.from) - 0.9;
        enter(t, S.eb, l0, { dy: 0, solid: true });
        S.h.forEach((L, i) => headRun(t, L, (def.titleAt ?? l0) + i * 0.18, 0.06));
        def.run && def.run(t, S, l0);
        darkSegs(t, S.sg);
      },
    });
  }

  /**
   * Portada + objetivo en una sola escena (marca de inicio 0). def:
   *   to: 's2' · eyebrow: ['1', 'Clase 1 · Nombre del curso'] · t1, t2: título en dos líneas (la 2.ª con punto) · acc: [palabras]
   *   chips: [['Qué es', s], …] (se encienden en su palabra) · fig(root) → elemento · figRun(t, fig, out)
   *   out: segundo del cambio portada → objetivo (p. ej. wx('s1', 'Al') − 0,45)
   *   goal: [[segs | texto, s], …] tarjetas numeradas del objetivo · goalTitle: 'Al terminar, vas a:'
   */
  function titlePage(def) {
    const size = def.size || pick(104, 88, 96);
    return C.scene({
      name: def.name || 'portada', from: 0, to: C.beatOf(def.to) + 1.5,
      build(root, S) {
        S.a = grp(root); S.b = grp(root);
        S.eb = eyebrow(S.a, def.eyebrow[0], def.eyebrow[1]);
        const y1 = TOP + pick(80, 76, 86);
        const n1 = def.t1.split(' ').length;
        S.h1 = head(S.a, def.t1, PAD, y1, size, (def.acc || []).filter((i) => i < n1));
        S.h2 = head(S.a, def.t2, PAD, y1 + size * 1.08, size, (def.acc || []).filter((i) => i >= n1).map((i) => i - n1));
        const cy = y1 + size * 2.16 + pick(60, 50, 60);
        let cx = PAD;                                   // 16:9: chips en fila (ancho estimado por caracteres) · vertical: en columna
        S.ch = (def.chips || []).map(([txt], i) => {
          const e = pick(chip(S.a, cx, cy, txt), chip(S.a, PAD, cy + i * 92, txt), chip(S.a, PAD, cy + i * 96, txt));
          cx += txt.length * 19 + 100; return e;
        });
        S.fig = def.fig ? def.fig(S.a, { y: pick(200, cy + 300, cy + (def.chips || []).length * 96 + 40) }) : null;
        S.eb2 = eyebrow(S.b, def.eyebrow[0], 'Objetivo de la clase', pick(300, 240, TOP));
        S.h3 = head(S.b, def.goalTitle || 'Al terminar, vas a:', PAD, pick(364, 310, TOP + 84), pick(84, 72, 76));
        const gy = pick(520, 460, TOP + 270), gh = pick(170, 180, 250), gs = pick(200, 210, 290);
        S.goal = (def.goal || []).map(([txt], i) => box(S.b, 'card top', PAD, gy + i * gs,
          `<div style="display:flex;align-items:center;gap:${pick(36, 30, 30)}px;height:100%;padding:0 ${pick(56, 44, 40)}px;font:700 ${pick(50, 44, 54)}px/1.15 'Display';letter-spacing:-0.02em;color:var(--ink)">${num(i + 1, pick(76, 70, 84))}<span>${segHTML(txt)}</span></div>`, `width:${CW}px;height:${gh}px`));
        S.sg = segReg(S.b);
      },
      run(t, b, S) {
        cam(t, S, 0.02, [null, def.to]);
        const out = def.out;
        swap(t, S.a, S.b, out);
        enter(t, S.eb, -0.5, { dy: 14 });
        TYPE.rise(t, S.h1, S.h1.words.map((_, i) => -3.6 + i * 0.1), null, { preset: 'heavy' });   // frame 0 ya se lee
        TYPE.rise(t, S.h2, S.h2.words.map((_, i) => -3.3 + i * 0.1), null, { preset: 'heavy' });
        (def.chips || []).forEach(([, s], i) => { enter(t, S.ch[i], -0.3 + i * 0.1, { dy: 16, preset: 'snappy' }); lit(t, S.ch[i], s - 0.2); });
        if (S.fig) { enter(t, S.fig, -0.4, { dy: 40, s0: 0.96 }); def.figRun && def.figRun(t, S.fig, out); }
        enter(t, S.eb2, out - 0.6, { dy: 0, solid: true });
        headRun(t, S.h3, out - 0.5);
        (def.goal || []).forEach(([, s], i) => { enter(t, S.goal[i], out - 0.4 + i * 0.1, { dy: 0, solid: true }); lit(t, S.goal[i], s - 0.15); });
        darkSegs(t, S.sg);
      },
    });
  }

  /**
   * Puntos clave: filas con ✓ que se encienden en su palabra y una barra de tinte que salta a la fila activa.
   * def: from, to, eyebrow: ['04', 'Puntos clave'], title: 'En resumen', rows: [segs | texto, …], at: [s, …], cta: ['Texto', s]
   */
  function summary(def) {
    const rowH = pick(104, 110, 136), gap = pick(150, 150, 210);
    return section({
      name: def.name || 'resumen', from: def.from, to: def.to, push: def.push ?? 0.025,
      eyebrow: def.eyebrow, title: def.title || 'En resumen', size: def.size || pick(92, 80, 84),
      build(root, S) {
        S.ys = def.rows.map((_, i) => S.top + 20 + i * gap);
        S.hl = reg(el('div', { class: 'abs', style: `left:${PAD - 16}px;top:0;width:${CW + 32}px;height:${rowH}px;border-radius:${rowH / 2}px;background:var(--tint-100);border:1.5px solid var(--tint-200);transform-origin:0 50%` }, root), { o: 0 });
        S.r = def.rows.map((segs, i) => box(root, 'abs', PAD, S.ys[i] + (rowH - pick(64, 64, 76)) / 2 - 2, `<div style="display:flex;align-items:center;gap:24px;width:${CW - 20}px;font:800 ${pick(46, 42, 54)}px/1.15 'Display';letter-spacing:-0.02em;color:var(--ink)">${icon(ICONS.CHECK, 'var(--accent)', pick(64, 64, 76))}<span>${segHTML(segs)}</span></div>`));
        if (def.cta) S.cta = chip(root, PAD, S.ys[S.ys.length - 1] + gap + pick(30, 40, 60), def.cta[0], 'solid', '→', `font-size:${pick(52, 46, 56)}px;padding:28px 46px`);
      },
      run(t, S, l0) {
        S.r.forEach((e, i) => { enter(t, e, l0 + i * 0.08, { dx: -20, dy: 0, preset: 'snappy' }); lit(t, e, def.at[i] - 0.2); });
        const hy = C.trk(t, def.at.map((s, i) => [B(s - 0.2), S.ys[i], 'snappy']), 'snappy');
        const ka = hit(t, def.at[0] - 0.2, 'snappy');
        put(S.hl, { o: ka > 0.003 ? 1 : 0, sx: ka, y: hy });
        if (S.cta) { enter(t, S.cta, l0 + 0.4, { preset: 'snappy', s0: 0.9 }); lit(t, S.cta, def.cta[1] - 0.05); put(S.cta, { s: 1 + 0.04 * pulse(t, def.cta[1] + 0.2, 0.6) }); }
      },
    });
  }

  /**
   * Cierre vivo (≤ 2 s útiles): logo + separador + «Siguiente clase» + nombre + módulo. def:
   *   from: 'endcard', to: 'done', n: '1.2', label: 'Siguiente clase', title: 'Nombre<br>de la clase', mod: 'Módulo 1 · …',
   *   logo(root) → elemento (por defecto, un marcador «TU LOGO»)
   */
  function closing(def) {
    return C.scene({
      name: def.name || 'cierre', from: C.beatOf(def.from) - 1.2, to: C.beatOf(def.to) + 4,
      build(root, S) {
        S.logo = def.logo ? def.logo(root) : box(root, 'logo-slot', PAD, pick(430, 300, 420), 'TU LOGO', `width:${pick(700, 600, 600)}px;height:${pick(220, 200, 220)}px`);
        S.sep = pick(box(root, 'abs', 980, 300, '<div style="width:4px;height:480px;border-radius:2px;background:var(--tint-200)"></div>'),
          box(root, 'abs', PAD, 560, `<div style="width:${CW}px;height:4px;border-radius:2px;background:var(--tint-200)"></div>`),
          box(root, 'abs', PAD, 720, `<div style="width:${CW}px;height:4px;border-radius:2px;background:var(--tint-200)"></div>`));
        const x = pick(1060, PAD, PAD), y = pick(340, 620, 800);
        S.nx = box(root, 'eyebrow big', x, y, `<b>${def.n}</b>${def.label || 'Siguiente clase'}`);
        S.t = box(root, 'display', x, y + pick(110, 110, 120), def.title, `font-size:${pick(80, 76, 84)}px;line-height:1.08`);
        S.m = def.mod ? chip(root, x, y + pick(340, 330, 360), def.mod, '', '', 'font-size:32px;padding:16px 26px') : null;
      },
      run(t, b, S) {
        cam(t, S, 0.035, [def.from]);
        const t0 = bt(def.from);
        put(S.logo, { o: 1, s: 1 + 0.05 * pulse(t, t0 - 0.05, 0.5) });
        enter(t, S.sep, t0 + 0.15, { dy: 0 });
        enter(t, S.nx, t0 + 0.3, { dy: 14 });
        enter(t, S.t, t0 + 0.45, { dy: 30 });
        if (S.m) enter(t, S.m, t0 + 0.8, { preset: 'snappy', s0: 0.85 });
      },
    });
  }

  /** barra de progreso de toda la clase (encima de todo, 8 px abajo) */
  function progress(toMark = 'done') {
    return C.scene({
      name: 'progreso', from: 0, to: C.beatOf(toMark) + 4,
      build(root, S) {
        root.style.background = 'none';
        el('div', { class: 'abs', style: `left:0;top:${H - 8}px;width:${W}px;height:8px;background:var(--tint-100)` }, root);
        S.f = reg(el('div', { class: 'abs', style: `left:0;top:${H - 8}px;width:${W}px;height:8px;background:var(--accent);transform-origin:0 50%` }, root));
      },
      run(t, b, S) { put(S.f, { sx: clamp(t / C.DUR) }); },
    });
  }

  window.HOJAS = {
    PAD, CW, TOP, BOTTOM, TITLE, LATE, POP,
    B, hit, span, pulse, strokes, rel, words, wt, wx, wk, script,
    enter, lit, dark, ringFx, cam, page, pageIn, swap, photoIn,
    grp, box, eyebrow, chip, head, headRun, icon, num, ICONS, segHTML, segReg, darkSegs,
    icard, rowCard, kv, panel, canvasPanel, photo, slot,
    reset, tok, mix, ramp, tag, drawLayers, drawSteps, drawStack,
    section, titlePage, summary, closing, progress,
  };
})();
