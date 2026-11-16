// Demo del estilo "Precisión nocturna" · 13,5 s · 124 BPM · 9:16. Función pura de t (sin timers, sin Math.random).
// Caso de uso: presentar un equipo o una línea de precisión (taller, laboratorio, planta) que escanea y mide punto por punto.
// Todo lo visual es un marcador dibujado: el equipo en línea fina, la banda de material, la pantalla con paneles
// «TU CLIP AQUÍ» y los logos «TU LOGO». En un video real cada marcador se reemplaza por el recorte oficial del producto,
// capturas reales de su interfaz y los logos de la marca. Requiere helpers/precision.js (window.PN) antes de este archivo.
// Actos: 1 hook (b0–8, noche) · 2 producto (b8–12, campo claro) · 3 por dentro (b12–20, noche) ·
//        4 interfaz que se arma (b20–24) · 5 tarjeta final viva (b24–28). Cortes duros solo en líneas de compás.
(() => {
  const { W, H, put, reg, el, scene, canvas, sp, seg, clamp, lerp, ease, bt, beatOf } = C;
  const { line, rise } = TYPE;
  const P = window.PN;
  const { PAD, pop, on, micro, outC, SN, stack, riseStack, accentDot, pill, growPill, ctaPulse, handle, runHandle, legal,
    placeholder, floorLine, ringArc, drawRoller, travel, brakeLean, yAt, arcBand, jitter, bursts, meter, runMeter,
    assemble, runAssemble, scanLine, runScan, areaBox, runArea, tok } = P;
  C.fonts = ['700 100px Display', '400 40px UI', '600 40px UI'];
  if (C.TL.render_flags && C.TL.render_flags.notext) document.body.classList.add('notext');

  const LINE = tok('--line', '#86efac'), INK = tok('--ink', '#f5f1ea'), INK2 = tok('--ink-2', '#a6a3b8');
  const GRAPH = tok('--graphite', '#4a4860'), DARK = tok('--dark', '#0c0e1c');
  const FLOOR = 1480;

  // ================================================================ 1 · HOOK (b0 → b8): pila de 3 renglones + el equipo que avanza rodando y frena
  scene({
    name: 'hook', from: 'hook', to: 'product',
    build(root, S) {
      S.g = canvas(root);
      S.L = stack(root, ['Precisión', 'que se puede', 'medir.'], { y: 300, size: 124, lh: 146, accent: { 2: [0] } });
      S.tag = pill(root, 'Tu equipo, en marcha', { x: PAD, y: 790, size: 48, dot: 'var(--line)' });
    },
    run(t, b, S) {
      riseStack(t, S.L, [-0.4, 'hook_w2', beatOf('hook_w3') - 0.1], null, SN);   // el primero ya se lee en el frame 0
      growPill(t, S.tag, 'tag');
      const g = S.g; g.clearRect(0, 0, W, H);
      floorLine(g, FLOOR, LINE);
      // recorrido continuo: se arrastra desde el frame 0, acelera en 'roll', otro empuje en 'roll2', frena en 'brake'
      const x = travel(t, { x0: -300, creep: [0, 3, 90], pushes: [['roll', 300, 'heavy'], ['roll2', 200, 'heavy']] });
      const RW = 400, RH = 500;
      const wr = drawRoller(g, x, FLOOR, { w: RW, h: RH, color: LINE, rot: (x + 300) / (RW * 0.075), lean: brakeLean(t, 'brake', 0.014), shadow: 0.35 });
      // anillo sobre la pantalla del equipo: se traza 0→360° con un pop
      const scrY = FLOOR - RH + (RH - wr * 2 - 6) * 0.3;
      ringArc(g, x + RW / 2, scrY, 150, pop(t, 'ring'), LINE, 5);
    },
  });

  // ================================================================ 2 · PRODUCTO (b8 → b12): corte a campo claro, el marcador grande entra rodando
  scene({
    name: 'product', from: 'product', to: 'inside',
    build(root, S) {
      root.style.background = 'var(--light)';
      S.g = canvas(root);
      S.n1 = line(root, 'Tu equipo', { x: PAD, y: 300, size: 118, color: DARK });
      S.n2 = accentDot(line(root, 'Calibrado', { x: PAD, y: 440, size: 118, color: DARK }));
      S.pp = pill(root, 'Tolerancia: tu dato', { x: PAD, y: 610, size: 50, bg: DARK, color: INK });
    },
    run(t, b, S) {
      rise(t, S.n1, 'name'); rise(t, S.n2, 'dot', null, SN);
      growPill(t, S.pp, 'pill');
      const g = S.g; g.clearRect(0, 0, W, H);
      const cam = micro(t, 'product', 'inside', 0.05);
      g.save(); g.translate(W / 2, FLOOR); g.scale(cam, cam); g.translate(-W / 2, -FLOOR);
      g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, FLOOR, W, H - FLOOR);
      g.strokeStyle = GRAPH; g.lineWidth = 3; g.beginPath(); g.moveTo(0, FLOOR); g.lineTo(W, FLOOR); g.stroke();
      // avanza rodando desde la izquierda (misma dirección que el hook), frena y se balancea
      const r0 = bt('product') - 0.12, rp = clamp((t - r0) / 0.95), roll = outC(rp);
      const RW = 560, RH = 720, x = lerp(-RW - 80, 300, roll);
      const lean = rp < 1 ? 0.025 * (1 - roll) : -0.018 * Math.sin((t - r0 - 0.95) * 14) * Math.exp(-(t - r0 - 0.95) * 6);
      const wr = drawRoller(g, x, FLOOR, { w: RW, h: RH, color: GRAPH, rot: (x + RW + 80) / (RW * 0.075), lean, shadow: 0.18, label: 'TU EQUIPO AQUÍ' });
      ringArc(g, x + RW * 0.76, FLOOR - RH + (RH - wr * 2 - 6) * 0.72, 64 * (0.7 + 0.3 * pop(t, 'ring2')), pop(t, 'ring2'), DARK, 6);
      g.restore();
    },
  });

  // ================================================================ 3 · POR DENTRO (b12 → b20): banda de material plana, medidor que cae, ráfagas → línea
  // La banda es una placa genérica casi plana (radio enorme): el cabezal la recorre y registra un punto por ráfaga.
  const SPOTS = 60, CX = W / 2, BT = 920, BB = 1120, RF = 40000, CYY = BT + RF, RP = RF - (BB - BT) * 0.35, SX0 = 150, SX1 = 930;
  scene({
    name: 'inside', from: 'inside', to: 'ui',
    build(root, S) {
      S.g = canvas(root);
      S.h0 = line(root, 'Escaneo:', { x: PAD, y: 300, size: 112 });
      S.a = stack(root, ['Capa a capa,', 'sin saltos.'], { y: 300, size: 106, lh: 126 });
      S.p = stack(root, ['Cada punto,', 'registrado.'], { y: 300, size: 106, lh: 126 });
      S.c = stack(root, ['Un acabado', 'uniforme'], { y: 300, size: 106, lh: 126 });
      accentDot(S.c[1]);
      S.m = meter(root, { y: 1290, label: 'Desviación' });
      S.jit = jitter(31, SPOTS, 3);
    },
    run(t, b, S) {
      const g = S.g; g.clearRect(0, 0, W, H);
      const cam = micro(t, 'inside', 'ui', 0.05);
      g.save(); g.translate(CX, 980); g.scale(cam, cam); g.translate(-CX, -980);
      // push-through: la banda sube a su lugar en la línea de compás
      const pin = sp(t, beatOf('inside') - 0.3, 'default');
      g.translate(0, 140 * (1 - pin));
      arcBand(g, { cx: CX, cy: CYY, R0: RF, R1: RF - (BB - BT), color: LINE });
      // cabezal en grafito que avanza una posición por ráfaga, con su cono de luz
      const burst = clamp(Math.floor((t - bt('spots') - 0.01) / (bt(beatOf('spots') + 0.25) - bt('spots'))), 0, 9);
      const fx = lerp(SX0, SX1, b < beatOf('spots') ? 0 : (burst + 1) / 10);
      const oy = lerp(640, 690, pin);
      g.globalAlpha = on(pin); g.fillStyle = GRAPH; g.beginPath(); g.roundRect(fx - 130, oy - 30, 260, 48, 12); g.fill();
      g.fillStyle = 'rgba(245,241,234,0.14)'; g.beginPath(); g.moveTo(fx - 76, oy + 18); g.lineTo(fx + 76, oy + 18); g.lineTo(fx, yAt(CX, CYY, RP, fx)); g.closePath(); g.fill();
      bursts(g, t, { n: SPOTS, x0: SX0, x1: SX1, y: (x) => yAt(CX, CYY, RP, x), start: 'spots', bursts: 10, every: 0.25, mergeB: 'cut_line', jit: S.jit, dot: INK, ink: INK });
      g.restore();
      // titulares: swaps secuenciales (sale en siguiente entrada − 0.2)
      rise(t, S.h0, 'inside', beatOf('step') - 0.2, SN);
      riseStack(t, S.a, 'step', beatOf('spots') - 0.2, SN);
      riseStack(t, S.p, 'spots', beatOf('cut_line') - 0.3, SN);
      riseStack(t, S.c, [beatOf('cut_line') - 0.1, beatOf('cut_line') + 0.15], null, SN);
      runMeter(t, S.m, 'step', 0.12);
    },
  });

  // ================================================================ 4 · INTERFAZ (b20 → b24): la pantalla se arma por paneles, barrido único, recuadro
  const BX = 60, BY = 720, BW = 960, BH = 620;
  const rows = (n, w, h, c) => (parent) => { for (let i = 0; i < n; i++) el('div', { class: 'abs', style: `left:20px;top:${24 + i * (h / n)}px;width:${(w - 40) * (i % 2 ? 0.6 : 0.85)}px;height:${Math.max(10, h / n * 0.32)}px;border-radius:8px;background:${c}` }, parent); };
  const PIECES = [
    { x: 0, y: 0, w: BW, h: 60, beat: 'ui', make: (p, w, h) => { el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:var(--card)` }, p); [0, 1, 2].forEach((i) => el('div', { class: 'abs', style: `left:${22 + i * 30}px;top:22px;width:16px;height:16px;border-radius:50%;background:${GRAPH}` }, p)); } },
    { x: 16, y: 76, w: 300, h: 300, beat: 'ui_b', make: (p, w, h) => { el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:var(--card)` }, p); rows(5, w, h, GRAPH)(p); } },
    { x: 332, y: 76, w: 612, h: 300, beat: 21, make: (p, w, h) => placeholder(p, { w, h, r: 8, label: 'TU CLIP AQUÍ', size: 40 }) },
    { x: 16, y: 392, w: 300, h: 212, beat: 21.5, make: (p, w, h) => { el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:var(--card)` }, p); [0.45, 0.7, 0.55, 0.9, 0.62].forEach((k, i) => el('div', { class: 'abs', style: `left:${28 + i * 52}px;top:${h - 24 - (h - 60) * k}px;width:30px;height:${(h - 60) * k}px;border-radius:6px;background:${i === 3 ? LINE : GRAPH}` }, p)); } },
    { x: 332, y: 392, w: 612, h: 212, beat: 22, make: (p, w, h) => { el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:var(--card)` }, p); rows(4, w, h, GRAPH)(p); } },
  ];
  scene({
    name: 'ui', from: 'ui', to: 'end',
    build(root, S) {
      S.h = stack(root, ['Cada medida,', 'en pantalla.'], { y: 300, size: 112, lh: 132, accent: { 1: [1] } });
      S.cam = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:540px 1000px` }, root));
      S.A = assemble(S.cam, { x: BX, y: BY, w: BW, h: BH, pieces: PIECES });
      S.scan = scanLine(S.A.base, { x: 332, y: 76, h: 300 });
      S.box = areaBox(S.cam, { x: BX + 332, y: BY + 76, w: 612, h: 300 });
      S.badge = pill(root, 'Reporte por lote', { x: PAD, y: 596, size: 46, bg: 'var(--track)', dot: 'var(--line)' });
      S.legal = legal(root, 'Texto legal o regulatorio de tu marca aquí');
    },
    run(t, b, S) {
      riseStack(t, S.h, ['ui', 'ui_b']);
      put(S.cam, { s: micro(t, 'ui', 'end', 0.05) });
      runAssemble(t, S.A, 'ui');
      growPill(t, S.badge, 'badge');
      runScan(t, S.scan, 'scan', 607, 1.5);           // una sola pasada (no implica "en vivo")
      runArea(t, S.box, 'area');
      const lg = sp(t, 'legal', 'snappy'); put(S.legal, { o: on(lg), y: 16 * (1 - lg) });
    },
  });

  // ================================================================ 5 · TARJETA FINAL (b24 → b28): wordmark en el golpe, logos, pregunta, CTA que late, handle
  scene({
    name: 'end', from: 'end', to: 'done',
    build(root, S) {
      S.g = canvas(root);
      S.w = line(root, 'Tu marca', { x: PAD, y: 300, size: 128 });
      S.la = reg(placeholder(root, { x: PAD, y: 500, w: 250, h: 108, label: 'TU LOGO', r: 12, size: 36 }), { o: 0 });
      S.dv = reg(el('div', { class: 'abs', style: `left:${PAD + 276}px;top:500px;width:3px;height:108px;background:${GRAPH};transform-origin:0 0` }, root), { o: 0 });
      S.lb = reg(placeholder(root, { x: PAD + 306, y: 500, w: 360, h: 108, label: 'SEGUNDO LOGO', r: 12, size: 36 }), { o: 0 });
      S.ask = line(root, '¿Lo vemos en tu planta?', { x: PAD, y: 730, size: 76 });
      S.cta = pill(root, 'Pide tu demo técnica', { x: PAD, y: 850, size: 70, bg: 'var(--accent)', color: 'var(--dark)', dot: null });
      S.hd = handle(root, { x: PAD, y: 1070, size: 60 });
      S.legal = legal(root, 'Texto legal o regulatorio de tu marca aquí');
    },
    run(t, b, S) {
      const k = pop(t, 'end', 'heavy');
      rise(t, S.w, 'end', null, { stagger: 0.05 });
      // placa atenuada del equipo detrás, con micro push
      const g = S.g; g.clearRect(0, 0, W, H);
      const cam = micro(t, 'end', 'done', 0.06);
      const PF = 1430;                                  // la placa vive abajo a la derecha: nunca bajo el CTA ni el handle
      g.save(); g.translate(850, PF); g.scale(cam, cam); g.translate(-850, -PF); g.globalAlpha = 0.32;
      drawRoller(g, 690, PF + 60 * (1 - k), { w: 380, h: 440, color: GRAPH });
      g.restore();
      const ka = pop(t, 'logoA'), kb = pop(t, 'logoB');
      put(S.la, { o: on(ka), y: 30 * (1 - ka) });
      put(S.dv, { o: on(kb), sy: kb }); put(S.lb, { o: on(kb), y: 30 * (1 - kb) });
      rise(t, S.ask, 'ask', null, SN);
      ctaPulse(t, S.cta, 'cta');
      runHandle(t, S.hd, 'DM @tumarca', 'handle', 'handle_end');
      put(S.legal, { o: 1 });
    },
  });

  C.start();
})();
