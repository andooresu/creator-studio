// DEMO del estilo "Talking con datos": una persona a cámara explica tres datos en 14 s.
// La persona es un MARCADOR DIBUJADO (silueta plana dentro de una tarjeta redondeada) que respira y asiente con la voz:
// en tu proyecto cámbiala por tu clip (frames con scripts/seq.py y C.drawSeq(g, frames, t, t0, box, { z, pos }) dentro
// de DATOS.drawCard) — la tarjeta que se encoge, los paneles, las barras, los pasos y el CTA funcionan igual.
// Las cifras son de EJEMPLO y lo dicen en pantalla: pon solo cifras que diga tu voz y que puedas respaldar.
// Muestra: título de gancho con caja de acento en el frame 0, tarjeta de la persona que se encoge a la esquina,
// panel de dato clave que cuenta, panel de barras de comparación, lista de pasos, tarjeta que vuelve a llenar el
// cuadro para el CTA y subtítulos box-marca (lib/captions.js). Función pura de t: sin timers, sin Math.random.
(() => {
  const { W, H, pick, put, reg, el, scene, canvas, sp, spHit, seg, clamp, lerp, ease, beatOf, noise1 } = C;
  const { line, rise } = TYPE;
  C.fonts = ["800 100px 'Montserrat'"];
  const T = DATOS.tok();

  // ---------------------------------------------------------------- rejilla 9:16 (nada clave en el 14 % superior,
  // el 20 % inferior ni el 12 % derecho: el texto vive entre x 80–950 e y 290–1500)
  const BIG = { x: 70, y: 280, w: 940, h: 1040, r: 44 };          // persona a cuadro casi completo (gancho y CTA)
  const SMALL = { x: 80, y: 290, w: 370, h: 470, r: 34 };         // persona en la esquina mientras hablan los datos
  const HX = 490, HY = 300;                                        // cabecera de sección al lado de la tarjeta pequeña
  const PANEL = { x: 80, y: 830, w: 870, h: 460 };                // paneles de datos (terminan antes de los subtítulos)

  const nx = noise1(11), ny = noise1(23), nr = noise1(37);

  // ---------------------------------------------------------------- persona dibujada (marcador)
  function rr(g, x, y, w, h, r) { DATOS.rr(g, x, y, w, h, r); }

  function drawRoom(g, B, z, F) {
    // fondo de la habitación: se acerca menos que la persona en los punch-ins
    const k = 1 + (z - 1) * 0.35;
    g.save();
    g.translate(F.x, F.y); g.scale(k, k); g.translate(-F.x, -F.y);
    const bg = g.createLinearGradient(0, B.y, 0, B.y + B.h);
    bg.addColorStop(0, '#34404F'); bg.addColorStop(0.6, '#27313E'); bg.addColorStop(1, '#1C232D');
    g.fillStyle = bg; g.fillRect(B.x - B.w, B.y - B.h, B.w * 3, B.h * 3);
    // ventana a la izquierda y estantería a la derecha (formas planas)
    const wx = B.x + B.w * 0.06, wy = B.y + B.h * 0.1, ww = B.w * 0.22, wh = B.h * 0.42;
    const win = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
    win.addColorStop(0, 'rgba(200,220,240,.26)'); win.addColorStop(1, 'rgba(200,220,240,.05)');
    g.fillStyle = win; rr(g, wx, wy, ww, wh, B.w * 0.02); g.fill();
    g.fillStyle = 'rgba(28,35,45,.6)'; g.fillRect(wx + ww / 2 - B.w * 0.005, wy, B.w * 0.01, wh); g.fillRect(wx, wy + wh / 2 - B.w * 0.005, ww, B.w * 0.01);
    g.fillStyle = 'rgba(12,16,22,.35)';
    for (let i = 0; i < 3; i++) g.fillRect(B.x + B.w * 0.72, B.y + B.h * (0.16 + i * 0.13), B.w * 0.3, B.h * 0.012);
    const books = [[0.74, 0.08, 0.035, '#5E6E84'], [0.78, 0.1, 0.03, '#46566B'], [0.82, 0.07, 0.04, DATOS.hexA(T.accent, 0.45)], [0.76, 0.21, 0.05, '#53627A'], [0.83, 0.23, 0.035, '#3F4D61']];
    for (const [x, y, w, c] of books) { g.fillStyle = c; g.fillRect(B.x + B.w * x, B.y + B.h * (y + 0.02), B.w * w, B.h * (0.16 - 0.02 - (y % 0.13) * 0.4) * 0.6); }
    const lamp = g.createRadialGradient(B.x + B.w * 0.9, B.y + B.h * 0.12, 0, B.x + B.w * 0.9, B.y + B.h * 0.12, B.w * 0.35);
    lamp.addColorStop(0, 'rgba(242,190,120,.30)'); lamp.addColorStop(1, 'rgba(242,190,120,0)');
    g.fillStyle = lamp; g.fillRect(B.x, B.y, B.w, B.h);
    g.restore();
  }

  function drawPerson(g, t, B, z, F) {
    const R = B.w * 0.155, breathe = Math.sin((t / 3.4) * Math.PI * 2);
    // habla: micro asentimiento en el arranque de cada palabra (de window.VO), más deriva sembrada
    let nod = 0;
    for (const p of window.VO || []) for (const w of p.words || []) { const d = t - w.t0; if (d > 0 && d < 0.35) nod += Math.sin((d / 0.35) * Math.PI) * R * 0.03; }
    const hx = F.x + nx(t * 0.5) * R * 0.05, hy = F.y + ny(t * 0.6) * R * 0.035 + nod, tilt = nr(t * 0.4) * 0.03;
    g.save();
    g.translate(F.x, F.y); g.scale(z, z); g.translate(-F.x, -F.y);
    const bottom = B.y + B.h + R;
    const sy = F.y + R * 1.42 - breathe * R * 0.02, sw = R * 2.15;
    const body = g.createLinearGradient(F.x - sw, 0, F.x + sw, 0);
    body.addColorStop(0, '#4C576A'); body.addColorStop(1, '#313A48');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(F.x - sw * 1.25, bottom);
    g.bezierCurveTo(F.x - sw * 1.2, sy + R * 0.5, F.x - sw * 0.95, sy, F.x - R * 0.55, sy - R * 0.08);
    g.lineTo(F.x + R * 0.55, sy - R * 0.08);
    g.bezierCurveTo(F.x + sw * 0.95, sy, F.x + sw * 1.2, sy + R * 0.5, F.x + sw * 1.25, bottom);
    g.closePath(); g.fill();
    // borde de luz cálida (lámpara a la derecha)
    g.save(); g.beginPath(); g.rect(F.x, B.y - B.h, B.w * 2, B.h * 3); g.clip();
    g.strokeStyle = 'rgba(242,190,120,.5)'; g.lineWidth = Math.max(2, R * 0.035);
    g.beginPath(); g.moveTo(F.x + R * 0.55, sy - R * 0.08); g.bezierCurveTo(F.x + sw * 0.95, sy, F.x + sw * 1.2, sy + R * 0.5, F.x + sw * 1.25, bottom); g.stroke();
    g.restore();
    g.fillStyle = '#272E39';
    g.beginPath(); g.ellipse(F.x, sy - R * 0.02, R * 0.62, R * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5D687A';
    rr(g, hx - R * 0.36, hy + R * 0.7, R * 0.72, sy - hy - R * 0.62, R * 0.2); g.fill();
    // cabeza (silueta sin rasgos) + pelo
    g.save();
    g.translate(hx, hy); g.rotate(tilt);
    const head = g.createLinearGradient(-R, 0, R, 0);
    head.addColorStop(0, '#7C879A'); head.addColorStop(1, '#5B6578');
    g.fillStyle = head; g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#20262F';
    g.beginPath(); g.ellipse(0, -R * 0.42, R * 0.95, R * 0.78, 0, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(-R * 0.05, -R * 0.62, R * 0.9, R * 0.5, -0.08, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.rect(0, -R * 2, R * 2, R * 4); g.clip();
    g.strokeStyle = 'rgba(242,190,120,.55)'; g.lineWidth = Math.max(2, R * 0.035);
    g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, -Math.PI * 0.35, Math.PI * 0.45); g.stroke();
    g.restore();
    g.restore();
    g.restore();
  }

  // ---------------------------------------------------------------- el reel
  scene({
    name: 'reel', from: 'hook', to: 'done',
    build(root, S) {
      S.g = canvas(root);

      // marcador "TU VIDEO A CÁMARA AQUÍ": arriba de la tarjeta grande (se esconde cuando la tarjeta se encoge)
      S.tag = el('div', { class: 'abs', style: `left:${BIG.x + BIG.w / 2}px;top:${BIG.y + 70}px;width:0;height:0` }, root);
      el('div', { class: 'tag', style: 'font-size:36px;transform:translate(-50%,-50%)' }, S.tag, 'TU VIDEO A CÁMARA AQUÍ');
      reg(S.tag);

      // título de gancho sobre la parte baja de la tarjeta: la palabra clave en la caja de acento de la marca
      S.hook1 = line(root, 'Lo que dicen', { x: 120, y: 1000, size: 84 });
      S.hook2 = line(root, 'los datos', { x: 116, y: 1104, size: 112 });
      S.hook2.words[1].classList.add('boxw');

      // cabeceras de sección (al lado de la tarjeta pequeña)
      S.h1 = DATOS.head(root, 'Dato 1', ['La cifra', 'clave'], { x: HX, y: HY, accent: { 1: [0] } });
      S.h2 = DATOS.head(root, 'Dato 2', ['Compara', 'A con B'], { x: HX, y: HY, accent: { 1: [2] } });
      S.h3 = DATOS.head(root, 'Pasos', ['Cómo', 'aplicarlo'], { x: HX, y: HY, accent: { 1: [0] } });

      // panel 1: dato clave que cuenta (cifra de EJEMPLO, rotulada como tal)
      S.p1 = DATOS.panel(root, PANEL);
      S.fig = DATOS.figure(S.p1, { label: 'Tu dato clave', suffix: '%', note: 'Cifra de ejemplo · pon la tuya' });
      // panel 2: barras de comparación (valores de ejemplo)
      S.p2 = DATOS.panel(root, PANEL);
      S.bars = DATOS.bars(S.p2, [
        { label: 'Opción A', value: 0.42, text: '42 %' },
        { label: 'Opción B', value: 0.78, text: '78 %', accent: true },
      ]);
      el('div', { class: 'abs note', style: 'left:56px;top:368px' }, S.p2.c, 'Valores de ejemplo');
      // panel 3: pasos
      S.p3 = DATOS.panel(root, PANEL);
      S.steps = DATOS.steps(S.p3, ['Tu primer paso', 'Tu segundo paso', 'Tu tercer paso'], { top: 72 });

      // CTA sobre la parte baja de la tarjeta grande
      S.cta = el('div', { class: 'abs', style: `left:${W / 2}px;top:1130px;width:0;height:0` }, root);
      el('div', { class: 'cta', style: 'font-size:58px;transform:translate(-50%,-50%)' }, S.cta, 'Sigue a <b>@tumarca</b>');
      reg(S.cta, { o: 0 });
    },
    run(t, b, S) {
      // tarjeta: grande en el gancho, se encoge a la esquina en d1 y vuelve a llenar el cuadro en el CTA
      const B = DATOS.cardBox(t, BIG, SMALL, 'd1', 'cta');
      // cámara: punch-ins lentos (heavy) y deriva viva; el cierre nunca queda quieto
      const z = DATOS.punch(t, [[0, 1], ['hook_punch', 1.07], ['d1', 1.0], ['d2', 1.04], ['d3', 1.0], ['cta_punch', 1.08], ['cta_back', 1.03]])
        * (1 + 0.03 * ease.inOut(seg(t, 'cta_pill', 'done')));
      const g = S.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      DATOS.drawBg(g, t);
      DATOS.drawCard(g, B, (g, B) => {
        const F = { x: B.x + B.w * 0.5, y: B.y + B.h * 0.40 };
        drawRoom(g, B, z, F);
        drawPerson(g, t, B, z, F);
        // velo inferior para que el título y el CTA lean sobre la imagen (solo con la tarjeta grande)
        const a = clamp(1 - B.k * 1.6);
        if (a > 0.001) {
          const sc = g.createLinearGradient(0, B.y + B.h * 0.5, 0, B.y + B.h);
          sc.addColorStop(0, 'rgba(0,0,0,0)'); sc.addColorStop(1, `rgba(0,0,0,${0.6 * a})`);
          g.fillStyle = sc; g.fillRect(B.x, B.y, B.w, B.h);
        }
      });

      // marcador: visible solo con la tarjeta grande
      put(S.tag, { o: B.k < 0.12 ? 1 : 0, y: (B.y - BIG.y) });

      // gancho (frame 0): sube y sale por arriba antes de que la tarjeta se encoja
      rise(t, S.hook1, [-0.4, -0.3, -0.2], 'hook_out', { stagger: 0.08 });
      rise(t, S.hook2, 'hook_w2', 'hook_out', { stagger: 0.12 });
      const pb = spHit(t, beatOf('hook_w2') + 0.12, 'snappy');
      put(S.hook2.words[1], { s: 0.9 + 0.1 * pb });

      // cabeceras y paneles en carrusel: entra empujando desde la derecha, sale empujada a la izquierda
      DATOS.headRun(t, S.h1, 'd1_head', 'd1_out');
      DATOS.headRun(t, S.h2, 'd2_head', 'd2_out');
      DATOS.headRun(t, S.h3, 'd3_head', 'd3_out');
      DATOS.panelRun(t, S.p1, 'd1_panel', 'd2');
      DATOS.panelRun(t, S.p2, 'd2_panel', 'd3');
      DATOS.panelRun(t, S.p3, 'd3_panel', 'cta');

      DATOS.count(t, S.fig, 0, 68, 'd1_count', 2.5);
      DATOS.barsRun(t, S.bars, ['d2_bar_a', 'd2_bar_b']);
      DATOS.stepsRun(t, S.steps, ['d3_s1', 'd3_s2', 'd3_s3']);

      DATOS.ctaRun(t, S.cta, 'cta_pill', 'pulse');
    },
  });

  C.start();
})();
