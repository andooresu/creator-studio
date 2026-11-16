// Demo del estilo "Tarjeta escenario": reel de ~13 s (9:16 primero, también 4:5) con un caso de ejemplo: la guía de
// cuidado posterior a un servicio (qué hacer en casa, qué es normal y cuándo volver).
// Todo el material es de relleno: tarjetas "TU CLIP AQUÍ" y un diagrama dibujado y sembrado. Sin archivos externos.
// Estructura: hook → pasos en casa con píldoras → ruptura con diagrama ("¿Se ve menos?") → riel hasta el retoque → cierre oscuro + puente de loop.
// Función pura del tiempo: sin timers, sin Math.random, nada mutado en run(). Tiempos en beats y marcas de timeline.json.
(() => {
  const { W, H, pick, put, reg, el, scene, sp, spHit, trk, seg, clamp, lerp, ease, beatOf } = C;
  const T = TARJ;
  C.fonts = ['400 100px Display', '500 100px Display', '600 100px Display', '600 40px UI', '500 40px UI'];

  // ---------------------------------------------------------------- layouts (re-bloqueados por formato en lay/brk)
  const L_HOOK = T.lay(860);
  const L_PASOS = T.lay(840, { h45: 720 });
  const L_GIRO = T.brk({ y: 700, h: 800 });
  const L_CICLO = T.lay(920);

  // diagrama sembrado: se construye FUERA de run()
  const F = T.fibers(23, 30);
  const FALL3 = [5, 14, 24];          // tres trazos que caen en la ruptura y renacen en acento
  const TAGI = FALL3[1];              // el que sigue la cámara y lleva la etiqueta

  // ---------------------------------------------------------------- puntos de carrusel
  T.dots([['hook', L_HOOK], ['pasos', L_PASOS], ['giro', L_GIRO], ['ciclo', L_CICLO]], { to: 'end' });

  // ---------------------------------------------------------------- 1 · hook  (0 → 4)
  const hookHead = (root) => T.head(root, ['El después', 'también cuenta.'], { y: L_HOOK.HEAD, size: T.HS, accent: [[0, 1]] });
  const hookRise = (t, h) => { T.riseH(t, [h[0]], [-0.4]); T.riseH(t, [h[1]], [beatOf('hook_w2')]); T.hookDip(t, h[1], 0, beatOf('hook_w2'), 1); };
  scene({
    name: 'hook', from: 'hook', to: 'pasos',
    build(root, S) {
      S.K = T.card(root, L_HOOK);
      S.eye = T.eyebrow(root, 'Guía de cuidado', L_HOOK.EYE);
      S.h = hookHead(root);
      S.tag = T.tag(root, 'día 1', 'ink');
    },
    run(t, b, S) {
      const B = S.K.B; S.K.g.clearRect(0, 0, B.w, B.h);
      T.placeholder(S.K.g, B, t, { seed: 11, sub: 'tu resultado, día 1', z: T.push(t, 0, 4, 1, 1.08) });
      T.settle(t, S.K);
      T.showEye(t, S.eye, -0.6);
      hookRise(t, S.h);
      // algo nuevo en el beat 2.5: la etiqueta entra anclada a la esquina inferior de la tarjeta
      T.placeTag(t, S.tag, B.x + 24, B.y + B.h - 120, 2.5, S.K, { tw: pick(150, 140, 160), side: 'right' });
    },
  });

  // ---------------------------------------------------------------- 2 · pasos en casa con píldoras e indicador  (4 → 8.5)
  const STEP_MARKS = ['pasos', 'paso2', 'paso3'];
  const STEP_SUB = ['gesto 1 · limpiar', 'gesto 2 · hidratar', 'gesto 3 · proteger'];
  scene({
    name: 'pasos', from: 'pasos', to: 'giro',
    build(root, S) {
      const Lc = L_PASOS;
      S.K = T.card(root, Lc);
      S.eye = T.eyebrow(root, 'En casa', Lc.EYE);
      S.h = T.head(root, ['Tres gestos,', 'cada noche.'], { y: Lc.HEAD, size: pick(92, 80, 100), accent: [[1, 0], [1, 1]] });
      S.st = T.steps(root, ['1  Limpia', '2  Hidrata', '3  Protege'], { y: Lc.HEAD + Math.round(2 * pick(92, 80, 100) * T.LH) + pick(40, 36, 50) });
    },
    run(t, b, S) {
      const K = S.K, B = K.B; K.g.clearRect(0, 0, B.w, B.h);
      let k = 0; STEP_MARKS.forEach((m, i) => { if (b >= beatOf(m)) k = i; });
      const b0 = beatOf(STEP_MARKS[k]), b1 = k < 2 ? beatOf(STEP_MARKS[k + 1]) : beatOf('giro');
      // punch al beat en el cambio de paso + micro empuje durante el paso
      T.placeholder(K.g, B, t, { seed: 31 + k * 7, sub: STEP_SUB[k], z: T.push(t, b0, b1, 1.0, 1.07) * T.punch(t, b0 + 0.5, 0.06) });
      T.slideIn(t, K, STEP_MARKS[k]);
      T.showEye(t, S.eye, beatOf('pasos') - 0.3);
      T.riseH(t, S.h, [beatOf('pasos') + 0.25]);
      T.stepsRun(t, S.st, beatOf('pasos') + 0.25, STEP_MARKS);
    },
  });

  // ---------------------------------------------------------------- 3 · ruptura: "¿Se ve menos?" + diagrama  (8.5 → 13.5)
  scene({
    name: 'giro', from: 'giro', to: 'ciclo',
    build(root, S) {
      S.K = T.card(root, L_GIRO);
      S.q = T.head(root, ['¿Se ve menos?'], { y: L_GIRO.HEAD, size: T.BIG });
      S.a = T.head(root, ['Es parte', 'del proceso.'], { y: L_GIRO.HEAD - pick(0, 0, 40), size: pick(110, 96, 118), accent: [[1, 1]] });
      S.tag = T.tag(root, 'renace', 'outline');
    },
    run(t, b, S) {
      const K = S.K, B = K.B, g = K.g; g.clearRect(0, 0, B.w, B.h);
      g.fillStyle = T.tok().bg; g.fillRect(0, 0, B.w, B.h);
      const bx = { x: B.w * 0.04, y: B.h * 0.06, w: B.w * 0.92, h: B.h * 0.86 };
      const a = beatOf('giro_a');
      // cámara: micro empuje y luego zoom heavy hacia el trazo que renace
      const z = trk(t, [[0, 1], [beatOf('giro') + 0.2, 1.04, 'default'], [beatOf('giro_zoom') - 0.3, 1.45, 'heavy']]);
      const [rx, ry] = F.base(bx, F.items[TAGI].u);
      const zz = clamp((z - 1.04) / 0.41, 0, 1), fx = lerp(B.w / 2, rx, zz), fy = lerp(B.h / 2, ry - bx.h * 0.18, zz);
      const map = T.camera(g, K, z, fx, fy);
      F.draw(g, bx, {
        fall: (i) => { const k = FALL3.indexOf(i); return k < 0 ? 0 : clamp(seg(t, beatOf('giro') + 0.6 + k * 0.4, beatOf('giro') + 2.0 + k * 0.4), 0, 1); },
        regrow: (i) => (FALL3.includes(i) ? ease.out(seg(t, a, a + 1.6)) : 0),
      });
      g.restore();
      T.slideIn(t, K, 'giro');
      T.riseH(t, S.q, [beatOf('giro_q')], T.OUT([a]));
      T.riseH(t, S.a, [a]);
      // la etiqueta sigue la punta del trazo que renace a través de la cámara
      const [nx, ny, ta] = F.base(bx, F.items[TAGI].u);
      const len = bx.h * 0.42 * 0.4 * ease.out(seg(t, a, a + 1.6)) * (0.45 + 0.5 * F.items[TAGI].k);
      const tip = [nx + Math.cos(ta - Math.PI / 2) * len, ny + Math.sin(ta - Math.PI / 2) * len];
      const [px, py] = map(tip);
      T.placeTag(t, S.tag, px, py, 'giro_tag', K, { tw: pick(170, 160, 180), side: 'right' });
    },
  });

  // ---------------------------------------------------------------- 4 · ciclo: riel de semanas hasta el retoque, aterriza en acento  (13.5 → 17.5)
  scene({
    name: 'ciclo', from: 'ciclo', to: 'end',
    build(root, S) {
      const Lc = L_CICLO, B = Lc.CARD;
      S.K = T.card(root, Lc);
      S.eye = T.eyebrow(root, 'Cuándo volver', Lc.EYE);
      S.h = T.head(root, ['Retoque a las', 'seis semanas.'], { y: Lc.HEAD, size: T.HS, accent: [[1, 0], [1, 1]] });
      S.rail = T.rail(root, { x0: Math.round(B.x + B.w * 0.14), x1: Math.round(B.x + B.w * 0.84), y: Math.round(B.y + B.h * 0.88),
        stops: [{ v: 0, label: 'Sem. 0' }, { v: 3, label: 'Sem. 3' }, { v: 6, label: 'Sem. 6' }] });
    },
    run(t, b, S) {
      const K = S.K, B = K.B, g = K.g; g.clearRect(0, 0, B.w, B.h);
      g.fillStyle = T.tok().bg; g.fillRect(0, 0, B.w, B.h);
      const pop = beatOf('ciclo_pop');
      const prog = ease.inOut(seg(t, beatOf('ciclo') + 0.4, pop));
      const bx = { x: B.w * 0.04, y: 0, w: B.w * 0.92, h: B.h * 0.76 };
      const z = T.push(t, beatOf('ciclo'), beatOf('end'), 1, 1.06);
      g.save(); g.translate(B.w / 2, B.h * 0.4); g.scale(z, z); g.translate(-B.w / 2, -B.h * 0.4);
      F.draw(g, bx, {
        fall: (i) => (F.lost[i] ? clamp((prog - F.items[i].th / 0.45 * 0.9) / 0.12, 0, 1) : 0),
        refill: (i) => (F.lost[i] ? ease.out(seg(t, pop + 0.3 + (i / F.n) * 1.0, pop + 1.3 + (i / F.n) * 1.0)) : 0),
        gapMark: spHit(t, pop - 0.8, 'default') * (1 - sp(t, pop + 0.2, 'snappy')),
      });
      g.restore();
      T.slideIn(t, K, 'ciclo');
      T.showEye(t, S.eye, beatOf('ciclo') - 0.3);
      T.riseH(t, S.h, [beatOf('ciclo') + 0.25]);
      T.railRun(t, S.rail, 'ciclo', prog, pop);
    },
  });

  // ---------------------------------------------------------------- 5 · cierre oscuro + puente de loop  (17.5 → 22)
  scene({
    name: 'end', from: 'end', to: 'done',
    build(root, S) {
      S.E = T.endCard(root, { logoText: 'TU LOGO', cta: ['Agenda tu', 'retoque.'], ctaAccent: [[1, 0]], button: 'Agendar', lines: ['@tumarca', 'Pide tu guía por mensaje'] });
      // puente: el estado del frame 0 del hook sube sobre el cierre y empalma con el inicio
      S.P = T.bridge(root, (P) => {
        const K = T.card(P, L_HOOK);
        T.placeholder(K.g, K.B, 0, { seed: 11, sub: 'tu resultado, día 1', z: 1 });
        S.pk = K;
        S.pe = T.eyebrow(P, 'Guía de cuidado', L_HOOK.EYE);
        S.ph = hookHead(P);
      });
    },
    run(t, b, S) {
      T.endRun(t, S.E, { end: 'end', ctaBeats: [beatOf('end') + 0.25], btn: 'btn', sheen: [20, 21], drift: [beatOf('end'), 21.5] });
      T.bridgeRun(t, S.P, beatOf('loop'), beatOf('done'));
      T.settle(0, S.pk);
      T.showEye(0, S.pe, -0.6);
      hookRise(0, S.ph);
    },
  });

  C.start();
})();
