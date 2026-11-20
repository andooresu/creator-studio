// DEMO del estilo "Talking sobrio": una persona a cámara explica «3 preguntas antes de contratar un servicio» en 13 s.
// La persona es un MARCADOR DIBUJADO (silueta plana en un canvas) que respira y asiente un poco: en tu proyecto
// cámbiala por tu clip (frames con scripts/seq.py y C.drawSeq(g, frames, t, t0, box, { z, pos })) — el rótulo de nombre,
// los punch-ins lentos, los cortes tranquilos, la tarjeta de b-roll y el cierre funcionan igual sobre el clip real.
// Muestra: título de entrada en el frame 0, rótulo «Tu nombre / Tu especialidad» que entra con máscara y sale,
// subtítulos del preset pill-sobrio (lib/captions.js), etiquetas «Pregunta N», cortes de toma 1,00 ↔ 1,04,
// punch-ins lentos a 1,06–1,08 en los énfasis, b-roll en tarjeta y cierre con rótulo de contacto.
// Función pura de t: sin timers, sin Math.random.
(() => {
  const { W, H, FMT, pick, put, reg, el, scene, canvas, sp, seg, clamp, ease, beatOf, noise1 } = C;
  const { line } = TYPE;
  C.fonts = ["700 100px 'UI'", "600 100px 'UI'", "500 100px 'UI'"];
  const PAD = pick(120, 80, 80);
  const RIGHT = pick(1010, PAD, PAD);             // columna de texto: a la derecha de la persona en 16:9, a la izquierda en 9:16

  // encuadre de la persona: cara en el tercio medio-alto (9:16) o a un lado (16:9) — pos [x, y] como en C.drawSeq
  const FACE = { x: W * pick(0.33, 0.5, 0.5), y: H * pick(0.42, 0.40, 0.40) };
  const HEAD = pick(130, 172, 172);              // radio de la cabeza en px a escala 1
  const nx = noise1(11), ny = noise1(23), nr = noise1(37);

  // cortes de toma tranquilos entre frases (1,00 ↔ 1,04): el salto no se nota y nada golpea
  const SHOTS = [['hook', 1.0], ['q1', 1.04], ['q2', 1.0], ['q3', 1.04], ['cta', 1.0]];

  // ---------------------------------------------------------------- persona dibujada (marcador)
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawRoom(g, z) {
    // consulta / estudio claro: pared cálida, ventana suave, cuadro y repisa; el fondo se acerca menos que la persona
    const k = 1 + (z - 1) * 0.35;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(k, k); g.translate(-FACE.x, -FACE.y);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#EEEAE3'); bg.addColorStop(0.6, '#E2DDD4'); bg.addColorStop(1, '#CFC8BD');
    g.fillStyle = bg; g.fillRect(-W, -H, W * 3, H * 3);
    // luz de ventana a la izquierda (difusa)
    const lx = W * pick(0.02, 0.0, 0.0), ly = H * 0.1;
    const lg = g.createRadialGradient(lx, ly, 0, lx, ly, W * pick(0.5, 0.9, 0.9));
    lg.addColorStop(0, 'rgba(255,255,255,.65)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(-W, -H, W * 3, H * 3);
    // cuadro en la pared (derecha) y repisa con libros
    const fx = W * pick(0.72, 0.74, 0.74), fy = H * pick(0.16, 0.2, 0.2), fw = W * pick(0.14, 0.2, 0.2), fh = fw * 1.25;
    g.fillStyle = 'rgba(60,52,44,.16)'; roundRect(g, fx + 6, fy + 10, fw, fh, 6); g.fill();
    g.fillStyle = '#F6F3EE'; roundRect(g, fx, fy, fw, fh, 6); g.fill();
    g.fillStyle = 'rgba(62,142,138,.22)'; roundRect(g, fx + fw * 0.12, fy + fh * 0.1, fw * 0.76, fh * 0.8, 4); g.fill();
    const shy = H * pick(0.62, 0.5, 0.5), shx = W * pick(0.68, 0.7, 0.7), shw = W * 0.4;
    g.fillStyle = 'rgba(84,70,58,.35)'; g.fillRect(shx, shy, shw, 12);
    const books = [[0, 0.11, 0.55, '#B9AE9E'], [0.035, 0.09, 0.62, '#8C9AA6'], [0.065, 0.1, 0.5, '#C9BFB1'], [0.13, 0.09, 0.42, '#A7B5AE']];
    for (const [bx, bw, bh, c] of books) { g.fillStyle = c; g.fillRect(shx + shw * bx * 2, shy - fh * bh * 0.5, shw * bw * 0.6, fh * bh * 0.5); }
    // planta discreta a la izquierda abajo
    const px = W * pick(0.06, 0.1, 0.1), py = H * pick(0.78, 0.7, 0.7);
    g.fillStyle = 'rgba(92,120,104,.45)';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(px + (i - 2.5) * 22, py - 60 - (i % 3) * 30, 22, 70, (i - 2.5) * 0.28, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  function drawPerson(g, t, z) {
    const R = HEAD, breathe = Math.sin((t / 3.8) * Math.PI * 2);
    // habla: asentimiento leve en el arranque de cada palabra (de window.VO), más deriva sembrada
    let nod = 0;
    for (const p of window.VO || []) for (const w of p.words || []) { const d = t - w.t0; if (d > 0 && d < 0.4) nod += Math.sin((d / 0.4) * Math.PI) * 2.5; }
    const hx = FACE.x + nx(t * 0.4) * 6, hy = FACE.y + ny(t * 0.5) * 4 + nod, tilt = nr(t * 0.3) * 0.02;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(z, z); g.translate(-FACE.x, -FACE.y);
    // torso con saco y camisa clara (respira)
    const sy = FACE.y + R * 1.42 - breathe * 3, sw = R * 2.15;
    const body = g.createLinearGradient(FACE.x - sw, 0, FACE.x + sw, 0);
    body.addColorStop(0, '#3A4759'); body.addColorStop(1, '#273241');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(FACE.x - sw * 1.25, H + 40);
    g.bezierCurveTo(FACE.x - sw * 1.2, sy + R * 0.5, FACE.x - sw * 0.95, sy, FACE.x - R * 0.55, sy - R * 0.08);
    g.lineTo(FACE.x + R * 0.55, sy - R * 0.08);
    g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40);
    g.closePath(); g.fill();
    // camisa (V clara) y solapas
    g.fillStyle = '#E8ECF0';
    g.beginPath(); g.moveTo(FACE.x - R * 0.5, sy - R * 0.06); g.lineTo(FACE.x + R * 0.5, sy - R * 0.06); g.lineTo(FACE.x, sy + R * 1.5); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(15,20,28,.55)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(FACE.x - R * 0.5, sy - R * 0.06); g.lineTo(FACE.x - R * 0.05, sy + R * 1.55); g.stroke();
    g.beginPath(); g.moveTo(FACE.x + R * 0.5, sy - R * 0.06); g.lineTo(FACE.x + R * 0.05, sy + R * 1.55); g.stroke();
    // luz suave de ventana en el borde izquierdo
    g.save(); g.beginPath(); g.rect(0, 0, FACE.x, H); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(FACE.x - R * 0.55, sy - R * 0.08); g.bezierCurveTo(FACE.x - sw * 0.95, sy, FACE.x - sw * 1.2, sy + R * 0.5, FACE.x - sw * 1.25, H + 40); g.stroke();
    g.restore();
    // cuello
    g.fillStyle = '#7C8796';
    roundRect(g, hx - R * 0.34, hy + R * 0.7, R * 0.68, sy - hy - R * 0.62, R * 0.2); g.fill();
    // cabeza (silueta sin rasgos) + pelo
    g.save();
    g.translate(hx, hy); g.rotate(tilt);
    const head = g.createLinearGradient(-R, 0, R, 0);
    head.addColorStop(0, '#9AA4B2'); head.addColorStop(1, '#7D8898');
    g.fillStyle = head; g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2A3039';
    g.beginPath(); g.ellipse(0, -R * 0.42, R * 0.95, R * 0.78, 0, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(R * 0.05, -R * 0.62, R * 0.9, R * 0.5, 0.06, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.rect(-R * 2, -R * 2, R * 2, R * 4); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, Math.PI * 0.6, Math.PI * 1.3); g.stroke();
    g.restore();
    g.restore();
    g.restore();
  }

  // ---------------------------------------------------------------- el reel
  scene({
    name: 'reel', from: 'hook', to: 'done',
    build(root, S) {
      S.g = canvas(root);
      // marcador centrado con CSS (translateX(-50%)) dentro de una caja de ancho 0: escala desde su centro
      S.tag = el('div', { class: 'abs', style: `left:${FACE.x}px;top:${pick(H * 0.62, H * 0.56, H * 0.56)}px;width:0;height:0` }, root);
      el('div', { class: 'tag', style: `font-size:${pick(34, 38, 38)}px;transform:translate(-50%,-50%)` }, S.tag, 'TU VIDEO A CÁMARA AQUÍ');
      reg(S.tag);

      // b-roll en tarjeta (pregunta 1): se descubre de abajo arriba cuando la voz dice «incluye»
      const cw = pick(680, 800, 800), ch = pick(370, 600, 600);
      S.card = el('div', { class: 'broll', style: `left:${pick(RIGHT, (W - cw) / 2, (W - cw) / 2)}px;top:${pick(200, 410, 410)}px;width:${cw}px;height:${ch}px;font-size:${pick(52, 58, 58)}px;
        background:linear-gradient(160deg,#9CC7C2 0%,#5E9E99 55%,#3C716E 100%)` }, root);
      el('div', { class: 'abs', style: `left:0;top:0;width:${cw}px;height:${ch}px;background:repeating-linear-gradient(115deg,rgba(255,255,255,.14) 0 60px,rgba(255,255,255,0) 60px 150px)` }, S.card);
      el('div', { class: 'ph' }, S.card, '<div class="play"></div><div>TU CLIP AQUÍ</div><small>qué incluye el servicio</small>');
      reg(S.card, { o: 0 });

      // título de entrada (frame 0)
      S.t1 = line(root, '3 preguntas', { x: RIGHT, y: pick(300, 310, 310), size: pick(104, 112, 112), accent: [0] });
      S.t2 = line(root, 'antes de contratar', { x: RIGHT + 4, y: pick(430, 440, 440), size: pick(62, 66, 66) });
      S.t2.el.style.color = 'var(--ink-2)';

      // etiquetas «Pregunta N»
      S.chips = [1, 2, 3].map((n) => reg(el('div', { class: 'sob-chip', style: `left:${RIGHT}px;top:${pick(100, 300, 300)}px;font-size:${pick(40, 42, 42)}px` }, root, `<i></i>Pregunta ${n}`), { o: 0 }));

      // rótulo de nombre + especialidad, y el rótulo de cierre (mismo componente)
      const ltY = pick(600, 1090, 1090), ltS = pick(54, 58, 58);
      S.lt = SOB.buildLowerThird(root, { x: RIGHT, y: ltY, name: 'Tu nombre', role: 'Tu especialidad', size: ltS, w: pick(460, 500, 500) });
      S.cta = SOB.buildLowerThird(root, { x: RIGHT, y: ltY, name: 'Escríbenos', role: '@tumarca · enlace en el perfil', size: ltS });
    },
    run(t, b, S) {
      // cámara: corte de toma tranquilo × punch-ins lentos (resorte largo) × empuje mínimo en el cierre
      const z = SOB.shot(t, SHOTS)
        * SOB.punch(t, [[0, 1], ['hook_push', 1.04], ['q1', 1], ['q2_punch', 1.07], ['q2_back', 1], ['q3_punch', 1.08], ['cta', 1]])
        * (1 + 0.025 * ease.inOut(seg(t, 'cta', 'done')));
      const g = S.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      drawRoom(g, z);
      drawPerson(g, t, z);

      // título de entrada: sube por su máscara (sin golpe) y sale hacia arriba antes de «Pregunta 1»
      SOB.title(t, S.t1, [-0.6, 0.4], 'hook_out');
      SOB.title(t, S.t2, 1.0, 'hook_out');

      // rótulo de nombre: entra con máscara, se queda ~3 s y se recoge
      SOB.lowerThird(t, S.lt, 'lt_in', 'lt_out');
      SOB.lowerThird(t, S.cta, 'cta_card', null);

      // etiquetas «Pregunta N»
      SOB.chip(t, S.chips[0], 'q1', 'q1_out');
      SOB.chip(t, S.chips[1], 'q2', 'q2_out');
      SOB.chip(t, S.chips[2], 'q3', 'q3_out');

      // b-roll en tarjeta
      const vc = SOB.card(t, S.card, 'q1_card', 'q1_card_out');

      // marcador "TU VIDEO A CÁMARA AQUÍ": se aparta mientras hay rótulo, tarjeta o cierre en pantalla
      const busy = Math.max(
        sp(t, beatOf('lt_in') - 0.4, SOB.CALM) - sp(t, beatOf('lt_out') + 0.6, SOB.CALM),
        vc,
        sp(t, beatOf('cta_card') - 0.4, SOB.CALM));
      const v = clamp(1 - busy);
      put(S.tag, { s: 0.94 + 0.06 * v, o: v < 0.02 ? 0 : v });
    },
  });

  C.start();
})();
