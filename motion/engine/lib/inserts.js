// Insertos de motion graphics para videos a cámara (window.INS). Autónomo: solo depende de core.js (window.C).
// Sin IA: anima textos y cifras que DICE la voz (vienen de docs/apoyos.json → datos) y las imágenes aprobadas.
//
// Carga: <script src="lib/inserts.js"></script> después de core.js / type.js / talking.js y ANTES de film.js.
//
//   const ins = INS.full(parent, spec)   // en build(): construye el inserto → { el, run(t) }
//   ins.run(t)                           // en run(): anima el inserto (devuelve cuánto está en pantalla, 0..1)
//
//   spec = {
//     kind:  'palabras' | 'cifra' | 'pasos' | 'comparacion' | 'lista' | 'imagen',
//     datos: string[]      textos/cifras LITERALES de la voz (nunca inventados). *palabra* = va en el acento.
//                          palabras: 1–3 textos · cifra: [cifra, etiqueta?] · pasos/lista: 2–5 ítems ·
//                          comparacion: [a, b, detalleA?, detalleB?]
//     inAt, outAt:         entrada y salida en BEATS o nombres de marca (lo mismo que C.bt / TALK.broll).
//                          Para pasar SEGUNDOS (p. ej. corte.s / corte.e de docs/apoyos.json) usa INS.sec(s) o unit:'s'.
//     unit:  'beat' (por defecto) | 's'
//     modo:  'pantalla_completa' (por defecto) | 'encima' (tarjeta en la parte de arriba; la persona sigue visible)
//     posicion: 'arriba' | 'centro' | 'abajo'  (solo encima; 'abajo' se trata como 'centro' para dejar libres los subtítulos)
//     src:   solo imagen: '../assets/apoyos/<id>.png' (ruta de docs/apoyos.json → archivo, con '../' delante)
//     pos:   solo imagen: object-position (por defecto '50% 45%')
//     move:  true (por defecto y SIEMPRE para los apoyos): el inserto mueve su propio contenedor y sale hacia ARRIBA.
//            false: el contenedor no se mueve y lo anima quien llama. No lo uses con TALK.broll: TALK.broll sale hacia
//            abajo y los textos cruzan la franja de subtítulos justo después de outAt.
//   }
//
//   INS.kenBurns(t, im, inAt, outAt, { from: 1, to: 1.07, pan: [0, -24], unit })   // empuje lento de una imagen
//   INS.sec(s) → beat                    // segundos → beat (para inAt/outAt)
//   INS.liftCaptions(inAt, outAt, y)     // en build(): mueve los subtítulos a y (0..1 del alto) mientras dura el inserto
//
// Diseño: el contenido vive en la franja 0,16–0,58 del alto en 9:16 (fuera de la UI de la plataforma y de la franja de
// subtítulos en y ≈ 0,70), así que no hace falta mover los subtítulos salvo que el film ponga otra cosa ahí. En 16:9 la
// tarjeta «encima» termina en 0,62 del alto (los subtítulos van en ≈ 0,70). Con move:true los insertos salen hacia ARRIBA
// después de outAt: sus textos no pasan por la franja de subtítulos durante la salida.
// Textos largos: nada se corta. En el primer run() (con la fuente ya cargada) cada texto se MIDE y se achica hasta caber
// en su caja, nunca por debajo del mínimo de lint.mjs (32 px; 36 en 9:16): palabras usa más líneas, filas y comparación
// pasan a varias líneas (filas juntan su separación; comparación suelta los detalles). Si «encima» aun así no cabe, el
// inserto pasa a pantalla completa (ins.modo lo dice); si tampoco cabe ahí, run() lanza un error en español.
// Sin datos (o imagen sin src / que no carga) INS.full lanza un error en español: ese apoyo se salta, no se rellena.
// Esta librería es de solo lectura en cada proyecto (la app la repone): los ajustes van en film.js.
// Colores: var(--accent) de la marca o la plantilla (tintes con color-mix); tipografía var(--display) o Montserrat 800.
// Reglas (RULES.md): nada entra con fade (crece 0,88→1 con la opacidad en ≤ 4 frames, sube por máscara o sube desde
// abajo), sin crossfades, todo plano sostenido sigue moviéndose (empuje 1,00→1,04 y deriva), solo transformaciones 2D.
(() => {
  const C = window.C;
  if (!C) throw new Error('lib/inserts.js necesita core.js antes');
  const { el, reg, put, spHit, sp, seg, clamp, lerp, ease, beatOf, beatAt, bt } = C;
  const TALL = C.FMT === '9x16';
  // tamaño mínimo de texto que pide lint.mjs por formato (16:9 32 · 1:1/4:5 32 · 9:16 36)
  // ningún texto se achica por debajo de esto: si no cabe, el inserto usa más líneas, suelta los detalles o (encima) pasa a
  // pantalla completa. La app limita los datos para que siempre quepan a pantalla completa (server/agent/prompt.ts).
  const MIN_TEXT = C.pick(32, 32, 36);
  const PALABRAS_MAX = 3;   // palabras muestra hasta 3 datos (la app no deja aprobar más)
  const FONT = "'InsDisplay'";

  // ---------------------------------------------------------------- estilos (prefijo .ins-*, no pisa los del film)
  const CSS = `
  @font-face { font-family: 'InsDisplay'; src: url(../assets/fonts/captions/Montserrat-ExtraBold.ttf); font-weight: 800; }
  .ins-root { position: absolute; left: 0; top: 0; overflow: hidden; transform-origin: 50% 50%;
    --ins-accent: var(--accent, #FFD43B);
    --ins-ink: #FFFFFF; --ins-mute: rgba(255,255,255,.66);
    --ins-bg: color-mix(in srgb, var(--ins-accent) 16%, #0B0D12);
    --ins-panel: rgba(255,255,255,.08); --ins-line: rgba(255,255,255,.14);
    font-family: var(--display, ${FONT}), ${FONT}, Arial, sans-serif; font-weight: 800; color: var(--ins-ink);
    -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
  .ins-full { background: var(--ins-bg); }
  .ins-card { border-radius: 28px; background: color-mix(in srgb, var(--ins-accent) 10%, #12151C);
    box-shadow: 0 2px 6px rgba(0,0,0,.25), 0 40px 90px -24px rgba(0,0,0,.7); }
  .ins-glow { position: absolute; left: 0; top: 0; pointer-events: none; transform-origin: 50% 50%;
    background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--ins-accent) 34%, transparent) 0%, transparent 62%); }
  .ins-abs { position: absolute; left: 0; top: 0; transform-origin: 50% 50%; }
  .ins-line { position: absolute; left: 0; top: 0; overflow: hidden; white-space: nowrap; line-height: 1;
    padding: 0.1em 0.06em 0.16em; margin: -0.1em -0.06em 0; text-transform: uppercase; letter-spacing: -0.01em; }
  .ins-word { display: inline-block; transform-origin: 50% 100%; }
  .ins-acc { color: var(--ins-accent); }
  .ins-num { position: absolute; left: 0; top: 0; white-space: nowrap; line-height: 1; letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums; transform-origin: 0 50%; }
  .ins-label { position: absolute; left: 0; top: 0; line-height: 1.08; color: var(--ins-mute); text-transform: uppercase; letter-spacing: 0.01em; }
  .ins-bar { position: absolute; left: 0; top: 0; border-radius: 999px; background: var(--ins-accent); transform-origin: 0 50%; }
  .ins-row { position: absolute; left: 0; top: 0; border-radius: 24px; background: var(--ins-panel);
    box-shadow: inset 0 0 0 2px var(--ins-line); transform-origin: 0 50%; }
  .ins-row.on { background: color-mix(in srgb, var(--ins-accent) 22%, rgba(255,255,255,.04));
    box-shadow: inset 0 0 0 3px var(--ins-accent); }
  .ins-dot { position: absolute; left: 0; top: 0; border-radius: 50%; background: var(--ins-accent); color: var(--ins-on-accent, #111);
    display: flex; align-items: center; justify-content: center; line-height: 1; transform-origin: 50% 50%; }
  .ins-text { position: absolute; left: 0; top: 0; line-height: 1.1; color: var(--ins-ink); text-wrap: balance; }
  .ins-check { position: absolute; left: 0; top: 0; border-radius: 14px; background: var(--ins-accent); transform-origin: 50% 50%; }
  .ins-check::after { content: ''; position: absolute; left: 30%; top: 16%; width: 26%; height: 46%;
    border: solid var(--ins-on-accent, #111); border-width: 0 0.16em 0.16em 0; transform: rotate(45deg); font-size: inherit; }
  .ins-panel { position: absolute; left: 0; top: 0; border-radius: 28px; background: var(--ins-panel);
    box-shadow: inset 0 0 0 2px var(--ins-line); transform-origin: 50% 50%; }
  .ins-panel.b { background: color-mix(in srgb, var(--ins-accent) 20%, rgba(255,255,255,.04)); box-shadow: inset 0 0 0 4px var(--ins-accent); }
  .ins-arrow { position: absolute; left: 0; top: 0; transform-origin: 50% 50%; }
  .ins-arrow::before { content: ''; position: absolute; left: 50%; top: 50%; width: 46%; height: 46%;
    border: solid var(--ins-accent); border-width: 0 12px 12px 0; transform: translate(-50%, -70%) rotate(45deg); }
  .ins-arrow.right::before { transform: translate(-70%, -50%) rotate(-45deg); }
  .ins-img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 50%; }
  .ins-img.contain { object-fit: contain; }
  .ins-img-bg { filter: blur(48px) saturate(1.1) brightness(.55); transform: scale(1.15); }
  `;
  if (!document.getElementById('ins-style')) {
    const st = document.createElement('style');
    st.id = 'ins-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  C.extraFonts = [...(C.extraFonts || []), `800 100px ${FONT}`];

  // ---------------------------------------------------------------- utilidades
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const unstar = (s) => String(s).replace(/\*/g, '');
  const sec = (s) => beatAt(s);
  const toBeat = (x, unit) => (unit === 's' ? beatAt(Number(x)) : beatOf(x));
  const show = (p) => (p > 0.02 ? 1 : 0);        // la opacidad entra de golpe (≤ 1 frame), nunca un fundido
  // ancho medio de un carácter en em (Montserrat 800 / sans display): mayúsculas ≈ 0,74, minúsculas ≈ 0,6
  const fitSize = (text, width, upper, max, min) => clamp(width / (Math.max(1, unstar(text).length) * (upper ? 0.74 : 0.6)), Math.max(min, MIN_TEXT), max);

  // Ajuste medido: se llama en el primer run(), cuando la fuente ya cargó (C.start construye antes de esperar las fuentes,
  // así que medir en build() daría el ancho de la fuente de respaldo). Solo achica: nunca agranda lo que ya cabía.
  const fsz = (e) => parseFloat(e.style.fontSize) || 0;
  const setFs = (e, v) => { e.style.fontSize = `${v}px`; };
  /** Achica e (de a 6 %) hasta que fits() o hasta min px (nunca menos que MIN_TEXT). Devuelve el tamaño final. */
  function shrinkUntil(e, fits, min = MIN_TEXT) {
    min = Math.max(min, MIN_TEXT);
    let v = fsz(e);
    for (let i = 0; i < 60 && v > min && !fits(); i++) { v = Math.max(min, v * 0.94); setFs(e, v); }
    return v;
  }
  /** Divide un texto en n líneas de largo parecido sin partir palabras. */
  function splitBalanced(text, n) {
    const ws = String(text).trim().split(/\s+/).filter(Boolean);
    n = Math.max(1, Math.min(n, ws.length));
    if (n === 1) return [ws.join(' ')];
    const len = ws.map((w) => unstar(w).length);
    const total = len.reduce((x, y) => x + y, 0) + ws.length - 1;
    const out = [];
    let cur = [], acc = 0;
    ws.forEach((w, i) => {
      cur.push(w); acc += len[i] + (cur.length > 1 ? 1 : 0);
      const lineNo = out.length + 1, left = ws.length - i - 1, slotsLeft = n - lineNo;
      // corta cuando esta línea llegó a su parte del total, o cuando quedan justo las palabras para las líneas que faltan
      if (slotsLeft > 0 && left > 0 && (acc >= (total * lineNo) / n - out.join(' ').length - (out.length ? 1 : 0) || left === slotsLeft)) {
        out.push(cur.join(' ')); cur = []; acc = 0;
      }
    });
    if (cur.length) out.push(cur.join(' '));
    return out;
  }

  /** Color de texto que lee sobre el acento (negro o blanco según su luminancia), calculado una vez al construir. */
  let onAccent = null;
  function accentInk() {
    if (onAccent) return onAccent;
    const probe = el('div', { style: 'position:absolute;width:0;height:0;color:var(--accent, #FFD43B)' }, C.stage);
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) || ['255', '212', '59'];
    probe.remove();
    const [r, g, b] = m.slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    onAccent = L > 0.36 ? '#111111' : '#FFFFFF';
    return onAccent;
  }

  /** Caja de contenido en px de escenario, fuera de la UI de la plataforma (9:16) y de la franja de subtítulos. */
  function frameOf(modo, posicion) {
    const W = C.W, H = C.H;
    if (modo === 'encima') {
      const w = C.pick(W * 0.44, W * 0.80, W * 0.78), x = C.pick(W * 0.52, (W - W * 0.80) / 2, 96);
      // 16:9: alto 0,46 → termina en 0,62 (centro) o 0,58 (arriba), por encima de los subtítulos (≈ 0,70)
      const h = C.pick(H * 0.46, H * 0.52, H * 0.34);
      const y = posicion === 'arriba' ? C.pick(H * 0.12, H * 0.08, H * 0.15) : C.pick(H * 0.16, H * 0.12, H * 0.215);
      const pad = C.pick(48, 52, 56);
      return { card: { x, y, w, h }, box: { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 } };
    }
    const box = TALL ? { x: 96, y: H * 0.17, w: W * 0.86 - 96 - 8, h: H * 0.40 }
      : C.pick({ x: W * 0.08, y: H * 0.14, w: W * 0.84, h: H * 0.48 }, { x: W * 0.09, y: H * 0.12, w: W * 0.82, h: H * 0.5 });
    return { card: null, box };
  }

  /** Línea con máscara: palabras que suben por ella. *x* = palabra en el acento. → { el, words, size } */
  function maskLine(parent, text, { x, y, size, accentAll = false }) {
    const line = el('div', { class: 'ins-line', style: `left:${x}px;top:${y}px;font-size:${size}px` }, parent);
    const raw = String(text).trim().split(/\s+/);
    const words = raw.map((w, i) => {
      const acc = accentAll || /^\*.*\*[.,:;!?]*$/.test(w) || /^\*/.test(w);
      const s = el('span', { class: 'ins-word' + (acc ? ' ins-acc' : '') }, line, esc(unstar(w)));
      if (i < raw.length - 1) line.appendChild(document.createTextNode(' '));
      return reg(s, { y: 0 });
    });
    reg(line);
    return { el: line, words, size };
  }
  /** Sube las palabras por su máscara (TYPE.rise adelantado, resorte heavy). */
  function riseWords(t, L, b0, stagger = 0.08) {
    const below = L.size * 1.45;
    L.words.forEach((w, i) => {
      const y = below * (1 - spHit(t, b0 + i * stagger, 'heavy'));
      put(w, { y, hide: y >= below * 0.999 });
    });
  }
  /** Crece 0,88→1 con la opacidad en ≤ 4 frames (entrada estándar de tarjetas y filas). */
  const growIn = (t, e, b, { from = 0.88, dx = 0, dy = 0, preset = 'snappy', extra = {} } = {}) => {
    const p = spHit(t, b, preset);
    put(e, { o: show(p), s: from + (1 - from) * p, x: dx * (1 - p), y: dy * (1 - p), ...extra });
    return p;
  };

  // ---------------------------------------------------------------- cifra: parseo y conteo con el formato de la voz
  function parseNumber(str) {
    const m = String(str).match(/^(.*?)(\d[\d.,\s]*\d|\d)(.*)$/);
    if (!m) return null;
    const [, pre, body, post] = m;
    const digits = body.replace(/\s/g, '');
    const lastDot = digits.lastIndexOf('.'), lastCom = digits.lastIndexOf(',');
    let dec = null, thou = null;
    if (lastDot >= 0 && lastCom >= 0) { dec = lastDot > lastCom ? '.' : ','; thou = dec === '.' ? ',' : '.'; }
    else if (lastDot >= 0 || lastCom >= 0) {
      const sepc = lastDot >= 0 ? '.' : ',', parts = digits.split(sepc);
      // 1.500 / 12,000 → miles; 2,5 / 3.75 → decimales
      if (parts.length > 2 || (parts[parts.length - 1].length === 3 && parts[0].length <= 3)) thou = sepc; else dec = sepc;
    }
    const clean = digits.split(thou || '\u0000').join('').replace(dec || '\u0000', '.');
    const value = Number(clean);
    if (!Number.isFinite(value)) return null;
    const decimals = dec ? (digits.split(dec)[1] || '').length : 0;
    return { pre, post, value, decimals, thou, dec, text: String(str) };
  }
  function formatNumber(v, n) {
    const fixed = v.toFixed(n.decimals);
    let [int, frac] = fixed.split('.');
    if (n.thou) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, n.thou);
    return n.pre + int + (frac ? (n.dec || '.') + frac : '') + n.post;
  }

  // ---------------------------------------------------------------- constructores por tipo (todos devuelven run(t, b0, b1))
  const KINDS = {};

  // Tipografía cinética: 1–3 textos en líneas grandes que suben palabra por palabra; barra de acento que crece debajo.
  KINDS.palabras = (box, root, datos) => {
    const src = datos.map((d) => String(d).trim()).filter(Boolean).slice(0, PALABRAS_MAX);
    // cada dato largo se reparte en líneas equilibradas: se prueba de ~6 a ~60 caracteres por línea y se queda el reparto
    // que deja la letra más grande dentro de la caja (ancho y alto). Más líneas antes que letra ilegible.
    const MAXSZ = C.pick(170, 160, 150), LH = 1.12;
    const splits = [];
    for (let per = 6, seen = new Set(); per <= 60; per += 2) {
      const cand = src.flatMap((d) => splitBalanced(d, Math.max(1, Math.ceil(unstar(d).length / per))));
      const key = cand.join('\n');
      if (cand.length && !seen.has(key)) { seen.add(key); splits.push(cand); }
    }
    // emW(líneas) = ancho de la línea más ancha en em: estimado al construir, medido con la fuente cargada en fit()
    const choose = (emW) => {
      let best = null;
      for (const c of splits) {
        const v = Math.min(MAXSZ, box.w / Math.max(0.01, emW(c)), box.h / (c.length * LH + 0.4));
        if (!best || v > best.v + 0.5) best = { v, lines: c };
      }
      return best || { v: MAXSZ, lines: [''] };
    };
    let { v: size, lines } = choose((ls) => ls.reduce((a, l) => Math.max(a, unstar(l).length * 0.74), 0.5));
    size = Math.max(size, MIN_TEXT);
    let L = [];
    const build = () => {
      L.forEach((li) => li.el.remove());
      const hasStar = lines.some((l) => l.includes('*'));
      L = lines.map((l, i) => maskLine(root, l, { x: box.x, y: 0, size, accentAll: !hasStar && lines.length > 1 && i === lines.length - 1 }));
      if (!hasStar && lines.length === 1) { const w = L[0].words[L[0].words.length - 1]; if (w) w.classList.add('ins-acc'); }
    };
    build();
    const bar = reg(el('div', { class: 'ins-bar' }, root), { o: 0 });
    const place = () => {
      const gap = size * 1.12, total = gap * lines.length;
      const y0 = box.y + (box.h - total - size * 0.4) / 2;
      L.forEach((li, i) => { li.size = size; setFs(li.el, size); li.el.style.top = `${y0 + i * gap}px`; });
      Object.assign(bar.style, { top: `${y0 + total + size * 0.12}px`, left: `${box.x}px`, width: `${Math.min(box.w, size * 3.2)}px`, height: `${Math.max(10, size * 0.09)}px` });
    };
    place();
    const run = (t, b0, b1) => {
      const per = Math.min(0.5, (b1 - b0 - 0.6) / Math.max(1, lines.length));
      L.forEach((li, i) => riseWords(t, li, b0 + 0.15 + i * per, 0.08));
      const p = spHit(t, b0 + 0.25 + lines.length * per, 'snappy');
      put(bar, { o: show(p), sx: p * (1 + 0.04 * seg(t, b0, b1)) });
    };
    // medido: se mide cada línea candidata con la fuente real y se elige el reparto con la letra más grande que cabe
    // (ancho y alto). Devuelve false si ni así llega al mínimo legible (quien llama prueba a pantalla completa).
    run.fit = () => {
      const probe = el('div', { class: 'ins-line', style: 'visibility:hidden;font-size:100px' }, root);
      const memo = new Map();
      const wOf = (l) => { if (!memo.has(l)) { probe.textContent = unstar(l); memo.set(l, probe.scrollWidth / 100); } return memo.get(l); };
      const best = choose((ls) => Math.max(...ls.map(wOf)) * 1.01);
      probe.remove();
      if (best.lines.join('\n') !== lines.join('\n')) { lines = best.lines; build(); }
      size = best.v;
      place();
      for (let i = 0; i < 6; i++) {   // redondeos del navegador: un último ajuste fino, nunca bajo el mínimo
        const wmax = Math.max(...L.map((li) => li.el.scrollWidth));
        if (wmax <= box.w + 1 || size <= MIN_TEXT) break;
        size = Math.max(MIN_TEXT, size * Math.min(0.99, box.w / wmax));
        place();
      }
      return size >= MIN_TEXT - 0.5 && Math.max(...L.map((li) => li.el.scrollWidth)) <= box.w + 1;
    };
    return run;
  };

  // Una cifra que dice la voz: cuenta hasta el valor (con su formato) y termina exactamente en el texto de datos[0].
  KINDS.cifra = (box, root, datos) => {
    const raw = String(datos[0] ?? '').trim(), label = datos.slice(1).map((d) => unstar(d).trim()).filter(Boolean).join(' ');
    const n = parseNumber(unstar(raw));
    let size = Math.min(fitSize(unstar(raw) || '0', box.w, true, C.pick(300, 300, 300), 90), box.h * 0.6);
    let lsz = label ? Math.max(44, Math.min(72, fitSize(label.length > 22 ? label.slice(0, Math.ceil(label.length / 2)) : label, box.w, true, 72, 44))) : 0;
    const num = reg(el('div', { class: 'ins-num ins-acc', style: `left:${box.x}px;font-size:${size}px` }, root, esc(unstar(raw))), { o: 0 });
    const bar = reg(el('div', { class: 'ins-bar', style: `left:${box.x}px` }, root), { o: 0 });
    const lab = label ? reg(el('div', { class: 'ins-label', style: `left:${box.x}px;width:${box.w}px;font-size:${lsz}px` }, root, esc(label)), { o: 0 }) : null;
    const place = (labH) => {
      const lh = label ? (labH ?? lsz * 2.3) : 0;
      const blockH = size + (label ? size * 0.22 + lh : 0);
      const y0 = box.y + Math.max(0, (box.h - blockH) / 2);
      setFs(num, size); num.style.top = `${y0}px`;
      Object.assign(bar.style, { top: `${y0 + size * 1.04}px`, width: `${Math.min(box.w, size * 2.2)}px`, height: `${Math.max(10, size * 0.06)}px` });
      if (lab) { setFs(lab, lsz); lab.style.top = `${y0 + size * 1.22}px`; }
    };
    place();
    const run = (t, b0, b1) => {
      const p = growIn(t, num, b0 + 0.15, { from: 0.86, preset: 'heavy' });
      if (n) {
        const dur = Math.max(0.6, Math.min(1.6, (b1 - b0) * 0.4));
        const k = ease.out(seg(t, b0 + 0.15, b0 + 0.15 + dur));
        put(num, { text: k >= 1 ? unstar(raw) : formatNumber(n.value * k, n) });
      }
      const q = spHit(t, b0 + 0.6, 'snappy');
      put(bar, { o: show(q), sx: q });
      if (lab) growIn(t, lab, b0 + 0.85, { from: 0.94, dy: 30 });
      return p;
    };
    // medido: la cifra en una línea dentro de box.w; la etiqueta (que puede ocupar varias líneas) dentro de la caja
    run.fit = () => {
      const NUM_MIN = Math.max(40, MIN_TEXT);
      for (let i = 0; i < 8 && num.scrollWidth > box.w + 1 && size > NUM_MIN; i++) { size = Math.max(NUM_MIN, size * Math.min(0.97, (box.w / num.scrollWidth) * 0.98)); setFs(num, size); }
      place();
      let ok = num.scrollWidth <= box.w + 1;
      if (lab) {
        const room = () => box.y + box.h - (parseFloat(lab.style.top) || 0);
        const labOver = () => lab.scrollHeight > room() + 1 || lab.scrollWidth > box.w + 1;
        for (let i = 0; i < 40 && labOver() && (lsz > MIN_TEXT || size > 60); i++) {
          if (lsz > MIN_TEXT) { lsz = Math.max(MIN_TEXT, lsz * 0.94); setFs(lab, lsz); }
          if (lab.scrollHeight > room() + 1 && size > 60) size = Math.max(60, size * 0.97);
          place(lab.scrollHeight);
        }
        place(lab.scrollHeight);
        ok = ok && !labOver();
      }
      return ok;
    };
    return run;
  };

  // Filas (pasos numerados o lista con check): entran una tras otra; en pasos, la última que entró queda marcada.
  function rows(box, root, datos, numbered) {
    const items = datos.map((d) => unstar(d).trim()).filter(Boolean).slice(0, 5);
    const n = Math.max(1, items.length), gap0 = C.pick(22, 24, 26);
    const ink = accentInk();
    const R = items.map((s, i) => {
      const row = reg(el('div', { class: 'ins-row' }, root), { o: 0 });
      const mark = numbered
        ? el('div', { class: 'ins-dot', style: `color:${ink}` }, row, String(i + 1))
        : el('div', { class: 'ins-check', style: `--ins-on-accent:${ink}` }, row);
      reg(mark, { s: 1 });
      const txt = el('div', { class: 'ins-text', style: 'top:0;display:flex;align-items:center;white-space:nowrap' }, row, esc(s));
      return { row, mark, txt };
    });
    // geometría de las filas para una separación dada. El círculo del número nunca queda tan chico que su cifra baje
    // del mínimo legible (fuente = 0,75 del círculo ≥ MIN_TEXT).
    let rh = 0, tw = 0;
    const lay = (gap) => {
      rh = Math.min(C.pick(130, 150, 160), (box.h - gap * (n - 1)) / n);
      const dot = Math.max(rh * 0.62, Math.min(rh * 0.92, MIN_TEXT / 0.75));
      const tx = rh * 0.2 + dot + rh * 0.3;
      tw = box.w - tx - rh * 0.3;
      const y0 = box.y + (box.h - (rh * n + gap * (n - 1))) / 2;
      R.forEach((r, i) => {
        Object.assign(r.row.style, { left: `${box.x}px`, top: `${y0 + i * (rh + gap)}px`, width: `${box.w}px`, height: `${rh}px` });
        Object.assign(r.mark.style, { left: `${rh * 0.2}px`, top: `${(rh - dot) / 2}px`, width: `${dot}px`, height: `${dot}px`,
          fontSize: `${numbered ? Math.max(MIN_TEXT, Math.min(dot * 0.75, Math.max(dot * 0.52, MIN_TEXT))) : dot * 0.55}px` });
        Object.assign(r.txt.style, { left: `${tx}px`, width: `${tw}px`, height: `${rh}px` });
      });
    };
    lay(gap0);
    const longest = items.reduce((a, s) => Math.max(a, s.length), 1);
    // tamaño de partida: ~0,38 del alto de la fila; si el ítem más largo no entra en 1 línea a ≥ 85 % del objetivo,
    // va en 2 líneas (fit() mide y corrige; nunca < MIN_TEXT)
    const target = Math.max(MIN_TEXT, Math.min(64, rh * 0.38));
    const one = tw / (longest * 0.56);
    const two = one < target * 0.85;
    const fs = two ? Math.max(MIN_TEXT, Math.min(target, rh * 0.36, tw / (Math.ceil(longest / 2 + 2) * 0.56))) : Math.max(MIN_TEXT, Math.min(target, one));
    R.forEach((r) => { setFs(r.txt, fs); if (two) r.txt.style.whiteSpace = 'normal'; });
    const run = (t, b0, b1) => {
      // el escalonado cabe en la ventana: la última fila (y su marca) llega ~0,4 beat antes de outAt, aun en apoyos cortos
      const every = clamp((b1 - b0 - 0.6) / n, 0.12, 1);
      let active = -1;
      R.forEach((r, i) => {
        const bi = b0 + 0.25 + i * every;
        const p = growIn(t, r.row, bi, { from: 0.92, dx: -60, preset: 'default' });
        if (p > 0.02) active = i;
        const m = spHit(t, bi + 0.18, 'snappy');
        put(r.mark, { s: 0.4 + 0.6 * m, o: show(m) });
      });
      if (numbered) R.forEach((r, i) => {
        const on = i === active;
        if (on !== r.row.classList.contains('on')) r.row.classList.toggle('on', on);  // estado derivado de t: sin memoria entre frames
      });
    };
    // medido: si un ítem no cabe en una línea pasa a varias; luego todas las filas se achican al mismo tamaño hasta caber
    // (nunca bajo MIN_TEXT). Si no alcanza, las filas se juntan (menos separación → filas más altas) y se vuelve a probar.
    run.fit = () => {
      const over = (e) => e.scrollWidth > tw + 1 || e.scrollHeight > rh + 1;
      for (const gap of [gap0, Math.round(gap0 / 2), 6]) {
        lay(gap);
        R.forEach((r) => { r.txt.style.whiteSpace = 'nowrap'; setFs(r.txt, fs); });
        if (R.some((r) => over(r.txt))) R.forEach((r) => { r.txt.style.whiteSpace = 'normal'; });
        let v = fs;
        for (const r of R) { setFs(r.txt, v); v = shrinkUntil(r.txt, () => !over(r.txt)); }
        R.forEach((r) => setFs(r.txt, v));
        if (!R.some((r) => over(r.txt))) return true;
      }
      return false;
    };
    return run;
  }
  KINDS.pasos = (box, root, datos) => rows(box, root, datos, true);
  KINDS.lista = (box, root, datos) => rows(box, root, datos, false);

  // Comparación de dos ideas que nombra la voz (A → B). Nunca antes/después de clientes ni resultados.
  KINDS.comparacion = (box, root, datos) => {
    const a = unstar(datos[0] ?? '').trim(), b = unstar(datos[1] ?? '').trim();
    const da = unstar(datos[2] ?? '').trim(), db = unstar(datos[3] ?? '').trim();
    // lado a lado solo si la CAJA es bien apaisada (16:9 a pantalla completa); la tarjeta angosta de 16:9 y los
    // formatos verticales o cuadrados van uno arriba del otro
    const side = box.w / box.h > 2.4;
    const ag = side ? box.w * 0.12 : box.h * 0.16;      // espacio de la flecha
    const pw = side ? (box.w - ag) / 2 : box.w, ph = side ? box.h : (box.h - ag) / 2;
    const pad = Math.min(48, pw * 0.07, ph * 0.12);
    const iw = pw - pad * 2, ih = ph - pad * 2;
    const fitsIn = (e, maxH, lineK, maxLines) => e.scrollWidth <= iw + 1 && e.scrollHeight <= maxH + 1 && e.scrollHeight <= fsz(e) * lineK * maxLines + 2;
    const mk = (txt, det, x, y, cls) => {
      const p = reg(el('div', { class: 'ins-panel' + cls, style: `left:${x}px;top:${y}px;width:${pw}px;height:${ph}px` }, root), { o: 0 });
      const size = Math.max(MIN_TEXT, Math.min(fitSize(txt, iw, true, 110, 48), ph * (det ? 0.36 : 0.5)));
      const dsz = Math.max(MIN_TEXT, 44, Math.min(56, size * 0.5));
      const T = el('div', { class: 'ins-text', style: `left:${pad}px;top:0;width:${iw}px;font-size:${size}px;text-transform:uppercase;white-space:normal;overflow-wrap:normal${cls ? ';color:var(--ins-accent)' : ''}` }, p, esc(txt));
      const D = det ? el('div', { class: 'ins-label', style: `left:${pad}px;top:0;width:${iw}px;font-size:${dsz}px` }, p, esc(det)) : null;
      const place = () => {
        const withD = D && D.style.display !== 'none';
        const th = T.scrollHeight, gap = withD ? fsz(T) * 0.15 : 0, dh = withD ? D.scrollHeight : 0;
        const top = Math.max(0, (ph - (th + gap + dh)) / 2);   // bloque centrado en el panel
        T.style.top = `${top}px`;
        if (D) D.style.top = `${top + th + gap}px`;
      };
      place();
      // medido: título en ≤ 4 líneas y detalle en ≤ 3, sin palabras que se salgan; el bloque entero dentro del panel, nunca
      // bajo MIN_TEXT. withDet=false suelta el detalle (primero se sacrifica el detalle, nunca la idea). → true si cabe
      p.fit = (withDet) => {
        const useD = Boolean(D && withDet);
        if (D) D.style.display = useD ? '' : 'none';
        setFs(T, size);
        const tFits = () => fitsIn(T, useD ? ih * 0.66 : ih, 1.1, 4);
        shrinkUntil(T, tFits);
        let ok = tFits();
        if (useD) {
          setFs(D, Math.min(dsz, Math.max(MIN_TEXT, fsz(T) * 0.6)));
          const dFits = () => fitsIn(D, ih - T.scrollHeight - fsz(T) * 0.15, 1.08, 3);
          shrinkUntil(D, dFits);
          ok = ok && dFits();
        }
        place();
        return ok;
      };
      return p;
    };
    const A = mk(a, da, box.x, box.y, '');
    const B = side ? mk(b, db, box.x + pw + ag, box.y, ' b') : mk(b, db, box.x, box.y + ph + ag, ' b');
    const asz = Math.min(ag * 0.9, 120);
    const arrow = reg(el('div', { class: 'ins-arrow' + (side ? ' right' : ''), style: side
      ? `left:${box.x + pw + (ag - asz) / 2}px;top:${box.y + (ph - asz) / 2}px;width:${asz}px;height:${asz}px`
      : `left:${box.x + (pw - asz) / 2}px;top:${box.y + ph + (ag - asz) / 2}px;width:${asz}px;height:${asz}px` }, root), { o: 0 });
    const run = (t, b0, b1) => {
      const span = Math.max(1.2, Math.min(2.4, b1 - b0 - 0.6));
      growIn(t, A, b0 + 0.2, { from: 0.9, preset: 'default' });
      const pa = spHit(t, b0 + 0.2 + span * 0.35, 'snappy');
      put(arrow, { o: show(pa), s: 0.5 + 0.5 * pa, x: side ? -30 * (1 - pa) : 0, y: side ? 0 : -30 * (1 - pa) });
      const pb = growIn(t, B, b0 + 0.2 + span * 0.55, { from: 0.86, preset: 'default' });
      // B queda viva: micro empuje mientras se sostiene
      if (pb > 0.02) put(B, { s: (0.86 + 0.14 * pb) * (1 + 0.025 * seg(t, b0 + span, b1)) });
    };
    // con detalles si caben en los dos paneles; si no, los dos sin detalle (iguales entre sí)
    run.fit = () => {
      if (!(da || db)) return [A.fit(false), B.fit(false)].every(Boolean);
      if ([A.fit(true), B.fit(true)].every(Boolean)) return true;
      return [A.fit(false), B.fit(false)].every(Boolean);
    };
    return run;
  };

  // Imagen aprobada (generada o subida por el usuario), con Ken Burns. La forma de la imagen manda (como en el corte
  // rápido, server/editor.ts): una ilustración vertical (las generadas son 1024x1536) nunca se recorta a una franja.
  //  · encima: la tarjeta toma la proporción de la imagen dentro de su zona (mismo borde de arriba y alto máximo; una
  //    imagen vertical da una tarjeta vertical, centrada en la zona), así no se pierde nada.
  //  · pantalla completa: cubre el cuadro si recortarla pierde ≤ 20 % (vertical en 9:16); si perdería más (vertical en
  //    16:9 o 1:1), va entera (contain) sobre una copia desenfocada y oscurecida de sí misma que llena el fondo.
  KINDS.imagen = (box, root, datos, spec, frame) => {
    // el Ken Burns mueve el conjunto (fondo + imagen); la imagen y su fondo no se mueven entre sí
    const wrap = reg(el('div', { class: 'ins-abs', style: 'width:100%;height:100%' }, root), { s: 1 });
    const bg = el('img', { class: 'ins-img ins-img-bg', src: spec.src, alt: '', style: 'display:none' }, wrap);
    const im = el('img', { class: 'ins-img', src: spec.src, style: `object-position:${spec.pos || '50% 45%'}` }, wrap);
    const pan = spec.pan || [0, frame.card ? -14 : -28];
    const run = (t, b0, b1) => kenBurns(t, wrap, b0, b1, { from: 1.0, to: spec.zoom || 1.07, pan });
    // READY esperó a todas las imágenes: aquí ya se conoce su tamaño natural (si no tiene píxeles, la ruta está mal)
    run.fit = () => {
      if (im.complete && !im.naturalWidth) throw new Error(`INS.full imagen: no se pudo cargar «${spec.src}». Revisa la ruta ("../" + archivo de docs/apoyos.json); si el apoyo no tiene archivo, sáltalo.`);
      if (!im.naturalWidth || !im.naturalHeight) return;
      const ar = im.naturalWidth / im.naturalHeight;
      if (frame.card) {
        const c = frame.card, zone = c.w / c.h;
        // más vertical que la zona: alto completo y el ancho que pida (centrada); más ancha: ancho completo y menos alto
        const w = ar < zone ? Math.max(c.h * ar, c.w * 0.3) : c.w, h = ar < zone ? c.h : Math.max(c.w / ar, c.h * 0.3);
        Object.assign(root.style, { left: `${c.x + (c.w - w) / 2}px`, top: `${c.y}px`, width: `${w}px`, height: `${h}px` });
        return;
      }
      const fr = C.W / C.H, ratio = Math.max(ar / fr, fr / ar);
      if (ratio > 1.25) { im.classList.add('contain'); bg.style.display = ''; }
    };
    return run;
  };

  // ---------------------------------------------------------------- Ken Burns
  /** Empuje lento de una imagen entre inAt y outAt (beats/marcas, o segundos con unit:'s'). Nunca queda quieta. */
  function kenBurns(t, im, inAt, outAt, { from = 1.0, to = 1.07, pan = [0, -24], unit = 'beat' } = {}) {
    const b0 = toBeat(inAt, unit), b1 = toBeat(outAt, unit);
    const k = ease.inOut(seg(t, b0, b1));
    put(im, { s: lerp(from, to, k), x: pan[0] * k, y: pan[1] * k });
    return k;
  }

  // ---------------------------------------------------------------- envoltura de alto nivel
  /** Por qué el inserto quedaría vacío ("" si tiene con qué construirse). */
  function vacio(kind, datos, spec) {
    const d = datos.map((x) => unstar(x).trim());
    if (kind === 'imagen') return spec.src ? '' : 'falta src (la imagen aprobada no tiene archivo)';
    if (kind === 'comparacion') return d[0] && d[1] ? '' : 'necesita las dos ideas en datos[0] y datos[1]';
    if (kind === 'cifra') return d[0] ? '' : 'falta la cifra en datos[0]';
    return d.some(Boolean) ? '' : 'no tiene datos (textos que dice la voz)';
  }

  function full(parent, spec = {}) {
    const kind = spec.kind || 'palabras';
    if (!KINDS[kind]) throw new Error(`INS.full: tipo desconocido "${kind}" (usa ${Object.keys(KINDS).join(', ')})`);
    const unit = spec.unit === 's' ? 's' : 'beat';
    // sin outAt: 4 beats después de la entrada (ya en beats: no se vuelve a convertir con unit)
    const b0 = toBeat(spec.inAt ?? 0, unit), b1 = spec.outAt != null ? toBeat(spec.outAt, unit) : b0 + 4;
    if (!(b1 > b0)) throw new Error('INS.full: outAt debe ser posterior a inAt');
    let modo = spec.modo === 'encima' ? 'encima' : 'pantalla_completa';
    const datos = (spec.datos || []).map((d) => String(d ?? ''));
    // nunca un panel vacío tapando a la persona: sin datos (o sin imagen) el apoyo se salta
    const empty = vacio(kind, datos, spec);
    if (empty) throw new Error(`INS.full ${kind}: ${empty}. No insertes este apoyo (sáltalo); nunca lo rellenes con textos o imágenes inventados.`);
    const ink = accentInk();
    const W = C.W, H = C.H;
    // el contenedor (ins.el) es siempre el mismo elemento: si «encima» no cabe y pasa a pantalla completa, solo cambian su
    // clase, su caja y su contenido (quien lo mueve con TALK.broll sigue moviendo el mismo nodo)
    const root = reg(el('div', { 'data-ins': kind }, parent), { o: 0 });
    let frame, cw, ch, glow, runInner;
    const setup = (m) => {
      frame = frameOf(m, spec.posicion);
      const c = frame.card || { x: 0, y: 0, w: W, h: H };
      root.textContent = '';
      root.className = `ins-root ${frame.card ? 'ins-card' : 'ins-full'}`;
      Object.assign(root.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
      root.style.setProperty('--ins-on-accent', ink);
      cw = c.w; ch = c.h;
      // fondo vivo: un halo del acento que deriva despacio (los planos sostenidos nunca quedan quietos)
      glow = kind === 'imagen' ? null : reg(el('div', { class: 'ins-glow', style: `width:${cw * 1.6}px;height:${cw * 1.6}px;left:${cw * 0.1}px;top:${-cw * 0.55}px` }, root));
      runInner = KINDS[kind](kind === 'imagen' ? { x: 0, y: 0, w: cw, h: ch } : frame.box, root, datos, spec, frame);
    };
    setup(modo);
    const move = spec.move !== false;
    let fitted = false, broken = null;
    const fits = () => (runInner.fit ? runInner.fit() !== false : true);
    /** Mide con la fuente cargada; si «encima» no cabe a tamaño legible pasa a pantalla completa; si tampoco, error. */
    function fitOnce() {
      if (fits()) return;
      if (frame.card) {
        console.warn(`INS.full ${kind}: los datos no caben legibles en la tarjeta «encima»; va a pantalla completa.`);
        modo = 'pantalla_completa';
        setup(modo);
        if (fits()) return;
      }
      throw new Error(`INS.full ${kind}: los datos no caben a un tamaño legible (mínimo ${MIN_TEXT} px) ni a pantalla completa. No lo achiques ni cambies los textos: avisa al usuario que acorte los datos de este apoyo en Propuesta visual, o sáltalo.`);
    }

    function run(t) {
      if (broken) throw broken;   // una imagen que no cargó sigue fallando en cada cuadro: nunca un panel vacío
      if (!fitted) { fitted = true; try { fitOnce(); } catch (e) { broken = e; throw e; } }
      const full = !frame.card;
      const p = spHit(t, b0, full ? 'default' : 'snappy');
      const q = sp(t, b1, 'default');
      const k = seg(t, b0, b1);
      let vis;
      if (move) {
        if (full) {
          const cover = clamp(p * 1.02), leave = clamp(q * 1.02);
          vis = p > 0.001 && leave < 0.999;
          // entra subiendo desde abajo y sale hacia ARRIBA: tras outAt sus textos nunca cruzan la franja de subtítulos
          // (y ≈ 0,70), que ya volvió a su lugar (liftCaptions solo cubre inAt..outAt)
          put(root, { o: vis ? 1 : 0, y: H * (1 - cover) - H * leave, s: 1 + 0.04 * k });
        } else {
          vis = p > 0.001 && q < 0.999;
          // la tarjeta vive arriba (0,16–0,58) y sale hacia arriba: nunca baja por la franja de subtítulos
          put(root, { o: vis ? 1 : 0, s: (0.88 + 0.12 * p) * (1 + 0.03 * k), y: -H * 0.6 * q, r: -2 * (1 - p) });
        }
      } else {
        const b = beatAt(t);
        vis = b >= b0 - 0.5 && b < b1 + 1.5;   // TALK.broll u otro mueve el contenedor; aquí solo se anima el contenido
      }
      if (!vis) return 0;
      if (glow) put(glow, { x: -cw * 0.25 * k, y: ch * 0.18 * k, s: 1 + 0.08 * Math.sin(k * Math.PI) });
      runInner(t, b0, b1);
      return p - q;
    }
    return { el: root, run, inAt: b0, outAt: b1, kind, get modo() { return modo; } };
  }

  /** En build(): sube (o baja) los subtítulos a y (fracción del alto) mientras dura el inserto. yAt va en segundos. */
  function liftCaptions(inAt, outAt, y = 0.22, unit = 'beat') {
    const cap = C.TL && C.TL.captions;
    if (!cap) return;
    cap.yAt = cap.yAt || [];
    cap.yAt.push({ from: bt(toBeat(inAt, unit)), to: bt(toBeat(outAt, unit)), y });
  }

  window.INS = { full, kenBurns, sec, liftCaptions, parseNumber, formatNumber, KINDS: Object.keys(KINDS) };
})();
