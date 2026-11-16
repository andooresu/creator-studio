// DEMO del estilo "Talking karaoke": una persona a cámara da 3 trucos en 13 s.
// La persona es un MARCADOR DIBUJADO (silueta plana en un canvas) que respira y se mueve un poco: en tu proyecto
// cámbiala por tu clip (frames con scripts/seq.py y C.drawSeq(g, frames, t, t0, box, { z, pos })) — los punch-ins,
// cortes de toma, b-roll, etiquetas y CTA de abajo funcionan igual sobre el clip real.
// Muestra: título de gancho en el frame 0, subtítulos karaoke (lib/captions.js, preset karaoke-amarillo), corte de toma
// con cambio de escala, punch-in en el énfasis, punch duro en el remate, b-roll en tarjeta y a pantalla completa,
// barra de progreso y CTA final. Función pura de t: sin timers, sin Math.random.
(() => {
  const { W, H, FMT, pick, put, reg, el, scene, canvas, sp, spHit, trk, seg, clamp, lerp, ease, bt, beatOf, beatAt, noise1 } = C;
  const { line, rise } = TYPE;
  C.fonts = ["800 100px 'Montserrat'"];
  const TALL = FMT === '9x16';
  const PAD = pick(110, 80, 80);

  // encuadre de la persona: cara en el tercio medio-alto (9:16) o a un lado (16:9) — pos [x, y] como en C.drawSeq
  const FACE = { x: W * pick(0.33, 0.5, 0.5), y: H * pick(0.40, 0.40, 0.40) };
  const HEAD = pick(130, 172, 172);              // radio de la cabeza en px a escala 1
  const nx = noise1(11), ny = noise1(23), nr = noise1(37);

  // escala de la "toma": cortes secos entre frases (1,00 ↔ 1,12) para que el salto de toma no se note
  const SHOTS = [['hook', 1.0], ['t1', 1.12], ['t2', 1.0], ['t3', 1.06], ['cta', 1.0]];
  const shotAt = (b) => { let s = 1; for (const [m, v] of SHOTS) if (b >= beatOf(m)) s = v; return s; };

  // ---------------------------------------------------------------- persona dibujada (marcador)
  function drawRoom(g, z) {
    // fondo con algo de profundidad: se acerca menos que la persona en los punch-ins
    const k = 1 + (z - 1) * 0.35;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(k, k); g.translate(-FACE.x, -FACE.y);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2E3949'); bg.addColorStop(0.55, '#222B37'); bg.addColorStop(1, '#161C25');
    g.fillStyle = bg; g.fillRect(-W, -H, W * 3, H * 3);
    // luz de ventana a la izquierda
    const wx = W * pick(0.04, 0.06, 0.06), wy = H * 0.14, ww = W * pick(0.16, 0.26, 0.26), wh = H * pick(0.5, 0.36, 0.36);
    const win = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
    win.addColorStop(0, 'rgba(196,214,236,.30)'); win.addColorStop(1, 'rgba(196,214,236,.06)');
    g.fillStyle = win; roundRect(g, wx, wy, ww, wh, 18); g.fill();
    g.fillStyle = 'rgba(22,28,37,.55)';
    g.fillRect(wx + ww / 2 - 5, wy, 10, wh); g.fillRect(wx, wy + wh / 2 - 5, ww, 10);
    // lámpara cálida y bokeh a la derecha
    const bokeh = [[0.84, 0.2, 260, 'rgba(242,182,107,.42)'], [0.72, 0.31, 120, 'rgba(242,182,107,.20)'], [0.93, 0.36, 90, 'rgba(255,222,170,.16)'], [0.62, 0.12, 70, 'rgba(255,222,170,.10)']];
    for (const [x, y, r, c] of bokeh) {
      const rr = r * pick(0.8, 1, 1);
      const gr = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, rr);
      gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(242,182,107,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(W * x, H * y, rr, 0, Math.PI * 2); g.fill();
    }
    // repisa
    g.fillStyle = 'rgba(10,13,18,.35)'; g.fillRect(W * 0.62, H * pick(0.5, 0.47, 0.47), W * 0.5, 14);
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawPerson(g, t, z) {
    const R = HEAD, breathe = Math.sin((t / 3.4) * Math.PI * 2);
    // habla: micro asentimiento en el arranque de cada palabra (de window.VO), más deriva sembrada
    let nod = 0;
    for (const p of window.VO || []) for (const w of p.words || []) { const d = t - w.t0; if (d > 0 && d < 0.35) nod += Math.sin((d / 0.35) * Math.PI) * 4; }
    const hx = FACE.x + nx(t * 0.5) * 8, hy = FACE.y + ny(t * 0.6) * 5 + nod, tilt = nr(t * 0.4) * 0.03;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(z, z); g.translate(-FACE.x, -FACE.y);
    // torso y hombros (respiran)
    const sy = FACE.y + R * 1.42 - breathe * 3, sw = R * 2.15;
    const body = g.createLinearGradient(FACE.x - sw, 0, FACE.x + sw, 0);
    body.addColorStop(0, '#4A5466'); body.addColorStop(1, '#2F3744');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(FACE.x - sw * 1.25, H + 40);
    g.bezierCurveTo(FACE.x - sw * 1.2, sy + R * 0.5, FACE.x - sw * 0.95, sy, FACE.x - R * 0.55, sy - R * 0.08);
    g.lineTo(FACE.x + R * 0.55, sy - R * 0.08);
    g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40);
    g.closePath(); g.fill();
    // borde de luz cálida (lámpara a la derecha)
    g.save(); g.beginPath(); g.rect(FACE.x, 0, W, H); g.clip();
    g.strokeStyle = 'rgba(242,182,107,.55)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(FACE.x + R * 0.55, sy - R * 0.08); g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40); g.stroke();
    g.restore();
    // cuello del suéter
    g.fillStyle = '#262D38';
    g.beginPath(); g.ellipse(FACE.x, sy - R * 0.02, R * 0.62, R * 0.2, 0, 0, Math.PI * 2); g.fill();
    // cuello
    g.fillStyle = '#5B6678';
    roundRect(g, hx - R * 0.36, hy + R * 0.7, R * 0.72, sy - hy - R * 0.62, R * 0.2); g.fill();
    // cabeza (silueta sin rasgos) + pelo
    g.save();
    g.translate(hx, hy); g.rotate(tilt);
    const head = g.createLinearGradient(-R, 0, R, 0);
    head.addColorStop(0, '#7A8597'); head.addColorStop(1, '#5A6476');
    g.fillStyle = head; g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#20262F';
    g.beginPath(); g.ellipse(0, -R * 0.42, R * 0.95, R * 0.78, 0, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(-R * 0.05, -R * 0.62, R * 0.9, R * 0.5, -0.08, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.rect(0, -R * 2, R * 2, R * 4); g.clip();
    g.strokeStyle = 'rgba(242,182,107,.6)'; g.lineWidth = 5;
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
      // marcador y CTA centrados con CSS (translateX(-50%)) dentro de una caja de ancho 0: escalan desde su centro
      S.tag = el('div', { class: 'abs', style: `left:${FACE.x}px;top:${pick(H * 0.12, H * 0.585, H * 0.585)}px;width:0;height:0` }, root);
      el('div', { class: 'tag', style: `font-size:${pick(36, 40, 40)}px;transform:translate(-50%,-50%)` }, S.tag, 'TU VIDEO A CÁMARA AQUÍ');
      reg(S.tag);
      // b-roll en tarjeta (truco 1): crece sobre la persona cuando la voz dice «luz»
      const cw = pick(760, 760, 780), ch = pick(470, 860, 860);
      S.card = el('div', { class: 'broll', style: `left:${pick(1040, (W - cw) / 2, (W - cw) / 2)}px;top:${pick(150, 390, 390)}px;width:${cw}px;height:${ch}px;font-size:${pick(58, 62, 62)}px;
        background:linear-gradient(160deg,#F6D9A8 0%,#E9A86A 55%,#B9744A 100%)` }, root);
      el('div', { class: 'abs', style: `left:0;top:0;width:${cw}px;height:${ch}px;background:repeating-linear-gradient(115deg,rgba(255,255,255,.18) 0 60px,rgba(255,255,255,0) 60px 150px)` }, S.card);
      el('div', { class: 'ph' }, S.card, '<div class="play"></div><div>TU CLIP AQUÍ</div><small>luz de ventana</small>');
      reg(S.card, { o: 0 });
      // b-roll a pantalla completa (truco 3): sube desde abajo cubriendo y sale hacia abajo
      S.full = el('div', { class: 'abs', style: `left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;font-size:${pick(84, 92, 92)}px;
        background:linear-gradient(200deg,#3C6E8F 0%,#24465F 60%,#152C3D 100%)` }, root);
      el('div', { class: 'abs', style: `left:0;top:0;width:${W}px;height:${H}px;background:radial-gradient(circle at 70% 30%,rgba(255,255,255,.22),rgba(255,255,255,0) 55%)` }, S.full);
      el('div', { class: 'ph', style: `bottom:${pick(28, 30, 30)}%` }, S.full, '<div class="play"></div><div>TU CLIP AQUÍ</div><small>b-roll completo</small>');
      reg(S.full, { o: 0 });

      // capa superior: marcador, gancho, etiquetas, CTA, barra
      S.hook1 = line(root, '3 trucos', { x: pick(1000, PAD, PAD), y: pick(250, 300, 300), size: pick(150, 140, 140), accent: [1] });
      S.hook2 = line(root, 'para grabar mejor', { x: pick(1004, PAD + 4, PAD + 4), y: pick(420, 460, 460), size: pick(72, 66, 66) });
      S.chips = [1, 2, 3].map((n) => reg(el('div', { class: 'chip', style: `left:${pick(1040, PAD, PAD)}px;top:${pick(70, 300, 300)}px;font-size:${pick(46, 50, 50)}px` }, root, `Truco ${n}`), { o: 0 }));
      S.cta = el('div', { class: 'abs', style: `left:${pick(W * 0.7, W / 2, W / 2)}px;top:${pick(H * 0.42, H * 0.57, H * 0.57)}px;width:0;height:0` }, root);
      el('div', { class: 'cta', style: `font-size:${pick(60, 62, 62)}px;transform:translate(-50%,-50%)` }, S.cta, 'Sigue a <b>@tumarca</b>');
      reg(S.cta, { o: 0 });
      S.bar = el('div', { class: 'bar', style: 'width:0px' }, root); reg(S.bar);
    },
    run(t, b, S) {
      // cámara: corte de toma × punch-ins con resorte heavy × punch duro en los remates
      const z = shotAt(b)
        * TALK.punch(t, [[0, 1], ['hook_w3', 1.07], [3.0, 1], ['t2_punch', 1.16], ['t2_back', 1], ['cta', 1]])
        * TALK.hardPunch(t, 't3_hard', 't3_hard_out', 1.15)
        * TALK.hardPunch(t, 'cta_hard', 'cta_pill', 1.1)
        * (1 + 0.035 * ease.inOut(seg(t, 'cta_pill', 'done')));      // el cierre nunca queda quieto
      const g = S.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      drawRoom(g, z);
      drawPerson(g, t, z);

      // gancho (frame 0): sube palabra por palabra y sale por arriba antes del primer truco
      rise(t, S.hook1, [-0.4, 'hook_w2'], 'hook_out');
      rise(t, S.hook2, 'hook_w3', 'hook_out', { stagger: 0.12 });

      // marcador "TU VIDEO A CÁMARA AQUÍ": se esconde bajo el b-roll completo y antes del CTA
      const tagOut = Math.max(sp(t, beatOf('t3_full') - 0.25, 'snappy') - sp(t, 't3_full_out', 'snappy'), sp(t, beatOf('cta_pill') - 0.75, 'snappy'));
      put(S.tag, { s: 1 - 0.08 * tagOut, o: tagOut > 0.98 ? 0 : 1 - tagOut });

      // etiquetas TRUCO N: pop en el beat, se van justo antes de la siguiente
      const chipIn = ['t1_chip', 't2_chip', 't3_chip'], chipOut = [beatOf('t2') - 0.3, beatOf('t3') - 0.3, beatOf('cta') - 0.3];
      S.chips.forEach((c, i) => {
        const p = spHit(t, chipIn[i], 'snappy'), q = sp(t, chipOut[i], 'snappy');
        put(c, { o: p > 0.001 && q < 0.98 ? 1 : 0, s: (0.7 + 0.3 * p) * (1 - 0.2 * q), x: -40 * q, r: -4 * (1 - p) });
      });

      // b-roll
      TALK.broll(t, S.card, 't1_card', 't1_out');
      TALK.broll(t, S.full, 't3_full', 't3_full_out', { full: true });

      // CTA: píldora que salta en su beat y pulsa una vez
      const pc = spHit(t, 'cta_pill', 'snappy'), pulse = Math.sin(Math.PI * clamp((t - bt('pulse')) / 0.3)) * 0.06;
      put(S.cta, { o: pc > 0.001 ? 1 : 0, y: 30 * (1 - pc), s: (0.8 + 0.2 * pc) * (1 + pulse) });

      TALK.progress(t, S.bar);
    },
  });

  C.start();
})();
