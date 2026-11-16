// DEMO del estilo "Paneles con UI" · prueba visual · 13 s · 120 BPM · 9:16 primero (también 4:5). Función pura de t.
// Caso: comparar un antes y un después y probar el resultado con un dato clave (anillo + zoom de cámara).
// Todo es de reemplazo: las capas «TU CLIP AQUÍ», la interfaz dibujada, las cifras y «TU LOGO» se cambian por tu material real.
// Requiere film/paneles.js (helpers del estilo, window.PAN) cargado antes de este archivo.
(() => {
  const { W, H, put, reg, el, scene, spHit, seg, ease, beatOf } = C;
  const { line, rise } = TYPE;
  const P = PAN, { L, X0, PRE, COL, show } = P;
  C.fonts = ['800 100px Display', '600 40px UI', '700 40px UI', '800 40px UI'];

  // ================================================================ 1 GANCHO (b0 → b8): título + comparador antes/después con cortina
  const HK = L({
    s: { rows: ['Mira la diferencia'], size: 96, y: 80, acc: { 0: [2] }, cmp: { x: 80, y: 260, w: 920, h: 760 }, tag: 40, chip: { x: 120, y: 1060, size: 40 } },
    t: { rows: ['Mira la', 'diferencia'], size: 150, y: 300, acc: { 1: [0] }, cmp: { x: 72, y: 720, w: 936, h: 780 }, tag: 44, chip: { x: 112, y: 1420, size: 44 } },
  });
  scene({
    name: 'hook', from: 'hook', to: 'dato',
    build(root, S) {
      S.D = P.bg(root, 0.9, 0.12);
      S.push = P.pushBox(root, W / 2, P.TOP);
      S.lines = P.title(S.push, HK.rows, { y: HK.y, size: HK.size, accent: HK.acc });
      const c = HK.cmp;
      // las dos capas son placeholders: pon aquí tu toma «antes» y tu toma «después» (mismo encuadre, misma luz)
      const a = P.placeholder(S.push, c.w, c.h, { label: 'TU CLIP AQUÍ', labelSize: 42 });
      a.style.filter = 'grayscale(1) contrast(.85)';   // solo para que el demo distinga las capas; tu metraje va en su color
      const b = P.placeholder(S.push, c.w, c.h, { label: 'TU CLIP AQUÍ', labelSize: 42 });
      S.cmp = P.compare(S.push, c.w, c.h, a, b, { size: HK.tag });
      S.chip = P.chip(S.push, 'Mismo ángulo, misma luz', HK.chip.size);
    },
    run(t, b, S) {
      P.dots(S.D, t, [0, 0.6, 'card', 'tag_a', 'wipe', 'tag_b', 'settle', 'hook_chip']);
      P.hold(t, S.push, 0, 8, 0.05);
      S.lines.forEach((l, i) => rise(t, l, [-0.4, 'hook_w2'][i], null, { stagger: 0.08 }));
      const c = HK.cmp;
      P.cardIn(t, S.cmp, c.x, c.y, 'card', { dy: 240, preset: 'heavy' });
      // la cortina arranca casi toda en «antes», barre hasta mostrar el «después» y se asienta al medio
      P.compareOn(t, S.cmp, [['card', 0.94], [beatOf('wipe') - 0.5, 0.94], ['wipe', 0.1], [beatOf('settle') - 0.5, 0.1], ['settle', 0.5]], ['tag_a', 'tag_b']);
      P.pop(t, S.chip, HK.chip.x, HK.chip.y, 'hook_chip');
    },
  });

  // ================================================================ 2 DATO CLAVE (b8 → b16): panel · anillo · ZOOM de cámara · la cifra cuenta
  const DT = L({
    s: { rows: ['El dato clave'], size: 100, y: 80, acc: { 0: [2] }, ui: { x: 80, y: 280, w: 920, fs: 38 }, k: 1.3, tx: 620, ty: 560, num: { x: 80, y: 860, size: 200 }, unit: { x: 520, y: 960, size: 56 }, chip: { x: 80, y: 1140, size: 40 } },
    t: { rows: ['El dato', 'clave'], size: 160, y: 300, acc: { 1: [0] }, ui: { x: 72, y: 760, w: 936, fs: 44 }, k: 1.3, tx: 620, ty: 780, num: { x: 72, y: 1170, size: 260 }, unit: { x: 390, y: 1290, size: 64 }, chip: { x: 390, y: 1395, size: 44 } },
  });
  const ROWS = ['Antes · 9 pasos', 'Ahora · 3 pasos', 'Mismo resultado'];
  scene({
    name: 'dato', from: 'dato', to: 'prueba', pre: PRE, cut: false,
    build(root, S) {
      S.D = P.panel(root, S, 0.12, 0.1, 'left');
      S.cam = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px` }, root));   // la cámara del zoom
      S.lines = P.title(S.cam, DT.rows, { y: DT.y, size: DT.size, accent: DT.acc });
      // interfaz de maqueta: cámbiala por la captura real de tu panel, reporte o resultado (PAN.shot)
      S.ui = P.uiCard(S.cam, { w: DT.ui.w, size: DT.ui.fs, head: 'Tu resultado', rows: ROWS });
      S.ring = P.ringEl(S.cam, 16);
      // la cifra vive fuera de la cámara para que se lea a tamaño fijo
      S.num = line(root, '1×', { x: DT.num.x, y: DT.num.y, size: DT.num.size, color: COL.accent });
      S.unit = line(root, 'más simple', { x: DT.unit.x, y: DT.unit.y, size: DT.unit.size, color: COL.title });
      S.chip = P.chip(root, 'Dato clave', DT.chip.size, { bg: COL.title, color: COL.card });
    },
    run(t, b, S) {
      P.cover(t, S); P.dots(S.D, t, ['dato', 'ui_in', 'ring', 'zoom', 'num', 'dato_chip']);
      const U = DT.ui, r = S.ui._rows[1], box = { x: U.x + r.x, y: U.y + r.y, w: r.w, h: r.h };
      // el título se va antes del zoom: así ninguna palabra queda cortada por el borde al acercar
      S.lines.forEach((l, i) => rise(t, l, i === 0 ? beatOf('dato') - 0.1 : 'dato_w2', beatOf('zoom') - 0.35, { stagger: 0.08 }));
      const hold = 0.03 * seg(t, 'dato', 'prueba');
      P.zoomTo(t, S.cam, box, 'zoom', DT.k, { tx: DT.tx, ty: DT.ty, hold });
      P.cardIn(t, S.ui, U.x, U.y, 'ui_in', { dy: 200, preset: 'heavy' });
      P.ringOn(t, S.ring, 'ring', box.x, box.y, box.w, box.h, 10);
      rise(t, S.num, beatOf('num') - 0.1, null, { preset: 'heavy' });
      P.count(t, S.num.words[0], 1, 3, 'num', 1.2, (n) => `${Math.round(n)}×`);
      rise(t, S.unit, beatOf('num') + 0.3, null, { preset: 'snappy' });
      P.pop(t, S.chip, DT.chip.x, DT.chip.y, 'dato_chip');
    },
  });

  // ================================================================ 3 PRUEBA (b16 → b20): panel que sube · barras antes/después · check
  const PR = L({
    s: { rows: ['La prueba,', 'en pantalla'], size: 96, y: 80, acc: { 1: [1] }, ui: { x: 80, y: 330, w: 920, fs: 42 }, bd: 110, chip: { x: 80, y: 820, size: 40 } },
    t: { rows: ['La prueba,', 'en pantalla'], size: 128, y: 300, acc: { 1: [1] }, ui: { x: 72, y: 780, w: 936, fs: 58 }, bd: 130, chip: { x: 72, y: 1400, size: 46 } },
  });
  scene({
    name: 'prueba', from: 'prueba', to: 'end', pre: PRE, cut: false,
    build(root, S) {
      S.D = P.panel(root, S, 0.88, 0.12, 'up');
      S.push = P.pushBox(root, W / 2, P.TOP);
      S.lines = P.title(S.push, PR.rows, { y: PR.y, size: PR.size, accent: PR.acc });
      // barras de ejemplo: cambia etiquetas y valores por tu medición real
      S.ui = P.bars(S.push, { w: PR.ui.w, size: PR.ui.fs, rows: [
        { label: 'Antes', value: 1, text: '9 pasos' },
        { label: 'Después', value: 0.34, text: '3 pasos', accent: true },
      ] });
      S.bd = P.badge(S.push, PR.bd);
      S.chip = P.chip(S.push, 'Mismo resultado, menos pasos', PR.chip.size);
    },
    run(t, b, S) {
      P.cover(t, S); P.dots(S.D, t, ['prueba', 'pr_ui', 'bar_a', 'bar_b', 'listo', 'pr_chip']);
      P.hold(t, S.push, 16, 20, 0.035);
      P.rises(t, S.lines, beatOf('prueba') - 0.1, 0.45);
      const U = PR.ui;
      P.cardIn(t, S.ui, U.x, U.y, 'pr_ui', { dy: 180, preset: 'heavy' });
      P.barOn(t, S.ui, 0, 'bar_a');
      P.barOn(t, S.ui, 1, 'bar_b');
      P.badgeOn(t, S.bd, U.x + S.ui._w - PR.bd * 0.3, U.y + S.ui._h - PR.bd * 0.3, 'listo');
      P.pop(t, S.chip, PR.chip.x, PR.chip.y, 'pr_chip');
    },
  });

  // ================================================================ 4 CIERRE (b20 → b26): logo · «Compara» · TÚ MISMO · sub · abanico
  const EN = L({
    s: { lk: { x: 80, y: 120, w: 920, h: 150 }, c: { x: 80, y: 330, size: 140 }, pill: { x: 80, y: 530, size: 100 }, sub: { x: 80, y: 740, size: 60 }, fan: { x: 90, y: 880, w: 280, h: 360, dx: 320 } },
    t: { lk: { x: 72, y: 470, w: 936, h: 170 }, c: { x: 72, y: 760, size: 170 }, pill: { x: 72, y: 990, size: 120 }, sub: { x: 72, y: 1240, size: 68 }, fan: { x: 60, y: 1400, w: 300, h: 390, dx: 330 } },
  });
  scene({
    name: 'end', from: 'end', to: 'done', pre: PRE, cut: false,
    build(root, S) {
      S.D = P.panel(root, S, 0.5, 0.0, 'left');
      S.push = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;transform-origin:${EN.lk.x}px ${H / 2}px` }, root));
      const lk = EN.lk;
      // TU LOGO: cámbialo por el lockup de tu marca (PNG/SVG) con el mismo ancho
      S.lk = reg(el('div', { class: 'abs display', style: `width:${lk.w}px;height:${lk.h}px;line-height:${lk.h}px;border:5px dashed ${COL.tint2};border-radius:24px;box-sizing:border-box;color:${COL.title};font-size:${lk.h * 0.42}px;text-align:center;letter-spacing:.04em;transform-origin:0 50%` }, S.push, 'TU LOGO'), { o: 0 });
      S.c = line(S.push, 'Compara', { x: EN.c.x, y: EN.c.y, size: EN.c.size, color: COL.title });
      S.pill = P.pill(S.push, 'TÚ MISMO', EN.pill.size);
      S.sub = line(S.push, 'en @tumarca', { x: EN.sub.x, y: EN.sub.y, size: EN.sub.size, color: COL.title, accent: [1] });
      const F = EN.fan;
      S.fan = ['ANTES', 'DESPUÉS', 'TU CLIP'].map((label) => P.placeholder(S.push, F.w, F.h, { label, labelSize: 38, play: 0.34 }));
    },
    run(t, b, S) {
      P.cover(t, S); P.dots(S.D, t, ['end', 'logo', 'cta_t', 'cta', 'cta_sub', 'recap']);
      put(S.push, { s: 1 + 0.05 * ease.inOut(seg(t, 'end', 'done')) });
      const p = spHit(t, 'logo', 'heavy');
      put(S.lk, { x: EN.lk.x, y: EN.lk.y + 40 * (1 - p), s: 1.25 - 0.25 * p, o: show(p) });
      rise(t, S.c, 'cta_t', null, { preset: 'heavy' });
      P.pillOn(t, S.pill, EN.pill.x, EN.pill.y, 'cta', [23.5, 25]);
      rise(t, S.sub, beatOf('cta_sub') - 0.1, null, { stagger: 0.06, preset: 'snappy' });
      P.fan(t, S.fan, EN.fan, 'recap', 0.25);
    },
  });

  C.start();
})();
