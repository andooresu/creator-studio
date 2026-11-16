// Demo del estilo "Método armado" (13 s, 120 BPM, 26 beats). Caso: «De ideas sueltas a un plan» (programa/curso con
// inscripción). Copy de ejemplo y marcadores "TU CLIP AQUÍ":
// cambia los textos, pon tus capturas o clips en las tarjetas y tu logo en el cierre.
// Actos: 1 hook + caos → orden (b0–8) · 2 pasos en carrusel (b8–15) · 3 giro con pills (b15–19) · 4 cierre vivo (b19–26).
(() => {
  const { W, H, put, el, scene, sp, spHit, seg, ease, beatOf } = C;
  const { rise } = TYPE;
  const A = ARM, { L, X0, CW, PRE, show, COL } = A;

  // ================================================================ 1 HOOK + CAOS → ORDEN
  const HK = L({
    s: { hk: { rows: ['De ideas sueltas', 'a un plan.'], size: 80, y: 70 }, o: { rows: ['Cada paso, en su lugar.'], size: 80, y: 70 },
         box: { x0: 80, x1: 1000, y0: 300, y1: 1000 }, tile: [280, 210], row: { x: 80, y: 260, w: 920, h: 132, gap: 24 } },
    t: { hk: { rows: ['De ideas', 'sueltas', 'a un plan.'], size: 112, y: 300 }, o: { rows: ['Cada paso,', 'en su lugar.'], size: 118, y: 300 },
         box: { x0: 72, x1: 1008, y0: 760, y1: 1330 }, tile: [300, 230], row: { x: 72, y: 700, w: 936, h: 128, gap: 26 } },
  });
  const ROWS = ['Tu objetivo', 'Tus recursos', 'Las tareas', 'El calendario', 'El primer paso'];
  const DUDAS = [[0, '¿Por dónde?'], [2, '¿Cuándo?'], [4, '¿Y luego?']];

  scene({
    name: 'hook', from: 'hook', to: 'pasos',
    build(root, S) {
      S.D = A.bg(root, 0.9, 0.1);
      S.push = A.pushBox(root, X0, A.SAFE.top + 80);
      const [tw, th] = HK.tile, R = HK.row;
      S.tiles = ROWS.map((txt, i) => A.chaosTile(S.push, i, tw, th, R.w, R.h, txt));
      S.poses = A.chaosPoses(ROWS.length, HK.box, tw, th, 11);
      S.chips = DUDAS.map(([, txt]) => A.chip(S.push, txt, { size: L({ s: 34, t: 40 }) }));
      S.ring = A.ring(S.push, R.w, R.h, R.h * 0.22 + 6);
      const nh = HK.hk.rows.length, acc = { [nh - 1]: [2] };   // acento en «plan.»
      S.hk = A.title(S.push, HK.hk.rows, { y: HK.hk.y, size: HK.hk.size, accent: acc });
      S.o = A.title(S.push, HK.o.rows, { y: HK.o.y, size: HK.o.size, accent: HK.o.rows.length === 1 ? { 0: [2, 3, 4] } : { 1: [0, 1, 2] } });
    },
    run(t, b, S) {
      A.dots(S.D, t, [0, 1, 'orden', 'paso_t']);
      put(S.push, { s: 1 + 0.035 * seg(t, 'hook', 'pasos') });
      // hook: la fila 1 entra en b −0.4 (el cuadro 0 ya se lee); la palabra acento cae en hook_w2
      const last = S.hk.length - 1;
      S.hk.forEach((l, i) => rise(t, l, i === last ? beatOf('hook_w2') - 0.15 : -0.4 + i * 0.3, 5.15, { stagger: 0.07, preset: i ? 'snappy' : 'heavy' }));
      A.rises(t, S.o, beatOf('paso_t') - 0.15, 0.4, null, { preset: 'snappy' });
      // fichas sueltas → filas ordenadas sobre «orden»
      const R = HK.row;
      const at = A.chaosRun(t, S.tiles, S.poses, { enter: 0.2, enterStep: 0.18, at: 'orden', rx: R.x, ry0: R.y, gap: R.gap });
      // cada ficha suelta "pregunta" algo; los chips desaparecen cuando todo se ordena
      S.chips.forEach((c, k) => {
        const T = at[DUDAS[k][0]], p = spHit(t, beatOf('dchip') + k * 0.25, 'snappy');
        put(c, { x: T.x + 16, y: T.y + 16, s: 0.6 + 0.4 * p, o: show(p) * (T.m < 0.05 ? 1 : 0) });
      });
      // el anillo recorre las filas de la primera a la última
      const yRow = (i) => R.y + i * (R.h + R.gap);
      const r0 = beatOf('ring'), rs = (beatOf('ring_end') - r0) / (ROWS.length - 1);
      A.ringRun(t, S.ring, ROWS.map((_, i) => [r0 + i * rs, R.x, yRow(i)]));   // una parada por fila
    },
  });

  // ================================================================ 2 PASOS (carrusel con progreso)
  const PS = L({
    s: { bar: 70, n: { y: 110, size: 96 }, tp: { y: 230, size: 60 }, card: { y: 420, w: 920, h: 560 }, sub: { y: 1030, size: 40 } },
    t: { bar: 300, n: { y: 350, size: 150 }, tp: { y: 540, size: 84 }, card: { y: 800, w: 936, h: 600 }, sub: { y: 1440, size: 48 } },
  });
  const STEPS = [['p1', 'Paso 1', ['Define', 'la meta']], ['p2', 'Paso 2', ['Divide en', 'tareas']], ['p3', 'Paso 3', ['Ponle', 'fecha']]];
  const STEP = 2.25;

  scene({
    name: 'pasos', from: 'pasos', to: 'giro', pre: PRE, cut: false,
    build(root, S) {
      S.D = A.panel(root, S, 0.12, 0.08, 'left');
      S.push = A.pushBox(root, X0, A.SAFE.top + 80);
      S.bar = A.progress(S.push, STEPS.length, X0, PS.bar, CW, 10, 12);
      S.items = STEPS.map(([m, n, tp], i) => {
        const card = A.clipCard(S.push, PS.card.w, PS.card.h, 'TU CLIP AQUÍ', { hue: i + 1 });
        const ch = A.chip(card, `Semana ${i + 1}`, { size: L({ s: 32, t: 38 }), bg: COL.accent });
        ch.style.left = '28px'; ch.style.top = '28px';
        return {
          m, card, ch,
          n: A.title(S.push, [n], { y: PS.n.y, size: PS.n.size, accent: { 0: [1] } }),
          tp: A.title(S.push, tp, { y: PS.tp.y, size: PS.tp.size, color: COL.ink }),
        };
      });
      S.sub = A.para(S.push, 'Un paso por semana. Nada suelto.', { y: PS.sub.y, size: PS.sub.size });
    },
    run(t, b, S) {
      A.cover(t, S);
      A.dots(S.D, t, ['pasos', 'p1', 'p2', 'p3']);
      put(S.push, { s: 1 + 0.03 * seg(t, 'pasos', 'giro') });
      A.progressRun(t, S.bar, beatOf('pasos') - 0.2, STEPS.map(([m]) => m));
      S.items.forEach((it, i) => {
        const at = beatOf(it.m), last = i === S.items.length - 1, out = last ? null : at + STEP - 0.35;
        rise(t, it.n[0], at - 0.15, out, { preset: 'snappy', stagger: 0.07 });
        A.rises(t, it.tp, at, 0.3, out, { preset: 'snappy' });
        A.slideItem(t, it.card, X0 + (CW - PS.card.w) / 2, PS.card.y, at - 0.1, out);
        const q = spHit(t, at + 0.6, 'snappy');
        put(it.ch, { s: 0.6 + 0.4 * q, o: show(q) });
      });
      A.fadeUp(t, S.sub, beatOf('p1') + 0.75);
    },
  });

  // ================================================================ 3 GIRO (chip + título + pills de secuencia)
  const GI = L({
    s: { chip: { y: 70, size: 44 }, t: { rows: ['Tu plan,', 'en marcha.'], size: 96, y: 170 }, pills: { y: 560, size: 120, gap: 26 }, sub: { y: 760, size: 42 } },
    t: { chip: { y: 300, size: 54 }, t: { rows: ['Tu plan,', 'ya en', 'marcha.'], size: 140, y: 420 }, pills: { y: 1010, size: 150, gap: 28 }, sub: { y: 1240, size: 50 } },
  });

  scene({
    name: 'giro', from: 'giro', to: 'end', pre: PRE, cut: false,
    build(root, S) {
      S.D = A.panel(root, S, 0.85, 0.12, 'up');
      S.push = A.pushBox(root, X0, A.SAFE.top + 80);
      S.chip = A.chip(S.push, 'Paso final', { size: GI.chip.size, bg: COL.accent });
      S.t = A.title(S.push, GI.t.rows, { y: GI.t.y, size: GI.t.size, accent: { [GI.t.rows.length - 1]: [GI.t.rows.length === 3 ? 0 : 1] } });
      S.pills = A.pills(S.push, 5, GI.pills.size);
      S.sub = A.para(S.push, 'Sabes qué toca hoy y qué sigue.', { y: GI.sub.y, size: GI.sub.size });
    },
    run(t, b, S) {
      A.cover(t, S);
      A.dots(S.D, t, ['giro', 'pills', 17]);
      put(S.push, { s: 1 + 0.03 * seg(t, 'giro', 'end') });
      const c = spHit(t, 'giro', 'snappy');
      put(S.chip, { x: X0, y: GI.chip.y, s: 0.7 + 0.3 * c, o: show(c) });
      A.rises(t, S.t, beatOf('giro') + 0.3, 0.35);
      const P = GI.pills, x0 = Math.round((W - (5 * P.size + 4 * P.gap)) / 2);
      A.pillsRun(t, S.pills, x0, P.y, P.size, P.gap, 'pills', 0.22);
      A.fadeUp(t, S.sub, 17.25);
    },
  });

  // ================================================================ 4 CIERRE VIVO
  const EN = L({
    s: { logo: { y: 70, w: 320, h: 100 }, t: { rows: ['Inscríbete hoy.'], size: 90, y: 220 }, cta: { y: 380, size: 54 }, sub: { y: 490, size: 42 }, fan: { y: 640, w: 290, h: 360, step: 320 } },
    t: { logo: { y: 310, w: 400, h: 124 }, t: { rows: ['Inscríbete', 'hoy.'], size: 140, y: 520 }, cta: { y: 940, size: 64 }, sub: { y: 1080, size: 50 }, fan: { y: 1190, w: 300, h: 330, step: 318 } },
  });

  scene({
    name: 'end', from: 'end', to: 'done', pre: PRE, cut: false,
    build(root, S) {
      S.D = A.panel(root, S, 0.5, 0.0, 'left');
      S.push = A.pushBox(root, W / 2, H / 2);
      const lg = EN.logo;
      S.logo = el('div', { class: 'abs', style: `left:${X0}px;top:${lg.y}px;width:${lg.w}px;height:${lg.h}px;border-radius:18px;border:4px dashed ${COL.title};box-sizing:border-box;display:flex;align-items:center;justify-content:center;font:900 ${lg.h * 0.34}px UI;letter-spacing:.14em;color:${COL.title};transform-origin:0 50%` }, S.push, 'TU LOGO');
      C.reg(S.logo, { o: 0 });
      const n = EN.t.rows.length;
      S.t = A.title(S.push, EN.t.rows, { y: EN.t.y, size: EN.t.size, accent: n === 1 ? { 0: [1] } : { 1: [0] } });   // acento en «hoy.»
      S.cta = A.chip(S.push, 'INSCRIPCIÓN ABIERTA&nbsp;&nbsp;›', { size: EN.cta.size });
      S.sub = A.para(S.push, 'Te enviamos el plan completo.', { y: EN.sub.y, size: EN.sub.size });
      const F = EN.fan;
      S.fan = ['TU CLIP', 'TU FOTO', 'TU PIEZA'].map((lab, i) => A.clipCard(S.push, F.w, F.h, lab, { hue: i + 4, r: 22 }));
    },
    run(t, b, S) {
      A.cover(t, S);
      A.dots(S.D, t, ['end', 'cta', 'recap', 24]);
      put(S.push, { s: 1 + 0.03 * ease.inOut(seg(t, 'end', 'done')) });
      const lp = spHit(t, 'end', 'heavy');
      put(S.logo, { o: show(lp), y: 40 * (1 - lp), s: 1.25 - 0.25 * lp });
      A.rises(t, S.t, beatOf('end') + 0.6, 0.4);
      const g = spHit(t, 'cta', 'snappy');
      put(S.cta, { x: X0, y: EN.cta.y, o: show(g), s: (0.8 + 0.2 * g) * A.pulse(t, [22.5, 24, 25.5]) });
      A.fadeUp(t, S.sub, beatOf('cta') + 0.5);
      const F = EN.fan, tilt = [-4, 2.5, -2], zig = [0, 24, 0];
      S.fan.forEach((c, i) => {
        const p = A.cardIn(t, c, X0 + i * F.step, F.y + zig[i], beatOf('recap') + i * 0.25, { dy: 260, preset: 'snappy', tilt: tilt[i] });
        if (p > 0.98) put(c, { y: F.y + zig[i] - 14 * sp(t, beatOf('recap') + 1 + i * 0.25) });
      });
    },
  });

  C.start();
})();
