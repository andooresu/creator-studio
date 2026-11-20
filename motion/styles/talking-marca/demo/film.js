// DEMO del estilo "Talking marca": una persona a cámara explica en 13 s cómo presentar un negocio, vestida con la marca.
// La persona es un MARCADOR DIBUJADO (silueta plana en un canvas) que respira y se mueve un poco: en tu proyecto
// cámbiala por tu clip (frames con scripts/seq.py y C.drawSeq(g, frames, t, t0, box, { z, pos })) — los punch-ins,
// el gancho, la barra, el logo, las etiquetas, el b-roll y el CTA de abajo funcionan igual sobre el clip real.
// Muestra: gancho con caja de marca en el frame 0, espacio de logo + @, barra de progreso en el acento, subtítulos
// box-marca (caja = acento, texto con contraste automático), etiquetas de paso en el acento, corte de toma con
// cambio de escala, punch-in en el énfasis, b-roll con marco de marca, punch duro en el remate y CTA en el acento.
// Función pura de t: sin timers, sin Math.random.
(() => {
  const { W, H, FMT, pick, put, reg, el, scene, canvas, sp, seg, ease, beatOf, noise1 } = C;
  C.fonts = ["800 100px 'Montserrat'"];
  const PAD = pick(110, 80, 80);
  const ACCENT = MARCA.ink();                     // lee --accent de :root y deja --on-accent con el mejor contraste

  // encuadre de la persona: cara en el tercio medio (9:16, algo más baja para dejar sitio al gancho) o a un lado (16:9)
  const FACE = { x: W * pick(0.33, 0.5, 0.5), y: H * pick(0.40, 0.44, 0.44) };
  const HEAD = pick(130, 172, 172);              // radio de la cabeza en px a escala 1
  const nx = noise1(11), ny = noise1(23), nr = noise1(37);

  // escala de la "toma": cortes secos entre frases (1,00 ↔ 1,08) para que el salto de toma no se note
  const SHOTS = [['hook', 1.0], ['s1', 1.08], ['s2', 1.0], ['s3', 1.06], ['cta', 1.0]];
  const shotAt = (b) => { let s = 1; for (const [m, v] of SHOTS) if (b >= beatOf(m)) s = v; return s; };

  // el acento de la marca tiñe la luz de la pared (si es un hex; si no, queda la luz neutra)
  const rgbOf = (hex) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return '150,160,180';
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
  };
  const TINT = rgbOf(ACCENT);

  // ---------------------------------------------------------------- persona dibujada (marcador)
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawRoom(g, z) {
    // fondo con algo de profundidad: se acerca menos que la persona en los punch-ins
    const k = 1 + (z - 1) * 0.35;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(k, k); g.translate(-FACE.x, -FACE.y);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2A2F3A'); bg.addColorStop(0.55, '#1E222B'); bg.addColorStop(1, '#14171D');
    g.fillStyle = bg; g.fillRect(-W, -H, W * 3, H * 3);
    // luz de pared en el color de la marca (detrás de la persona, a la derecha) + luz fría de relleno a la izquierda
    const glow = [[0.78, 0.26, pick(520, 560, 560), `rgba(${TINT},.38)`], [0.18, 0.62, pick(380, 420, 420), 'rgba(170,190,220,.10)']];
    for (const [x, y, r, c] of glow) {
      const gr = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, r);
      gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(W * x, H * y, r, 0, Math.PI * 2); g.fill();
    }
    // paneles de pared y una repisa: dan escala sin competir con la persona
    g.fillStyle = 'rgba(255,255,255,.035)';
    roundRect(g, W * pick(0.04, 0.05, 0.05), H * 0.16, W * pick(0.14, 0.22, 0.22), H * pick(0.56, 0.4, 0.4), 16); g.fill();
    roundRect(g, W * pick(0.72, 0.74, 0.74), H * pick(0.12, 0.1, 0.1), W * pick(0.12, 0.2, 0.2), H * pick(0.3, 0.2, 0.2), 16); g.fill();
    g.fillStyle = 'rgba(8,10,14,.45)'; g.fillRect(W * 0.6, H * pick(0.52, 0.49, 0.49), W * 0.5, 14);
    // objetos en la repisa: dos bloques en el acento apagado
    g.fillStyle = `rgba(${TINT},.55)`;
    roundRect(g, W * pick(0.8, 0.8, 0.8), H * pick(0.52, 0.49, 0.49) - pick(70, 90, 90), pick(46, 60, 60), pick(70, 90, 90), 8); g.fill();
    g.fillStyle = 'rgba(230,232,238,.22)';
    roundRect(g, W * pick(0.84, 0.87, 0.87), H * pick(0.52, 0.49, 0.49) - pick(44, 56, 56), pick(70, 90, 90), pick(44, 56, 56), 8); g.fill();
    g.restore();
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
    body.addColorStop(0, '#4A5163'); body.addColorStop(1, '#2C323E');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(FACE.x - sw * 1.25, H + 40);
    g.bezierCurveTo(FACE.x - sw * 1.2, sy + R * 0.5, FACE.x - sw * 0.95, sy, FACE.x - R * 0.55, sy - R * 0.08);
    g.lineTo(FACE.x + R * 0.55, sy - R * 0.08);
    g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40);
    g.closePath(); g.fill();
    // borde de luz en el color de la marca (la luz de pared a la derecha)
    g.save(); g.beginPath(); g.rect(FACE.x, 0, W, H); g.clip();
    g.strokeStyle = `rgba(${TINT},.75)`; g.lineWidth = 5;
    g.beginPath(); g.moveTo(FACE.x + R * 0.55, sy - R * 0.08); g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40); g.stroke();
    g.restore();
    // cuello del suéter
    g.fillStyle = '#242934';
    g.beginPath(); g.ellipse(FACE.x, sy - R * 0.02, R * 0.62, R * 0.2, 0, 0, Math.PI * 2); g.fill();
    // cuello
    g.fillStyle = '#5B6475';
    roundRect(g, hx - R * 0.36, hy + R * 0.7, R * 0.72, sy - hy - R * 0.62, R * 0.2); g.fill();
    // cabeza (silueta sin rasgos) + pelo
    g.save();
    g.translate(hx, hy); g.rotate(tilt);
    const head = g.createLinearGradient(-R, 0, R, 0);
    head.addColorStop(0, '#7A8496'); head.addColorStop(1, '#5A6375');
    g.fillStyle = head; g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1E232C';
    g.beginPath(); g.ellipse(0, -R * 0.42, R * 0.95, R * 0.78, 0, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(-R * 0.05, -R * 0.62, R * 0.9, R * 0.5, -0.08, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.rect(0, -R * 2, R * 2, R * 4); g.clip();
    g.strokeStyle = `rgba(${TINT},.8)`; g.lineWidth = 5;
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
      S.tag = el('div', { class: 'abs', style: `left:${FACE.x}px;top:${pick(H * 0.58, H * 0.62, H * 0.62)}px;width:0;height:0` }, root);
      el('div', { class: 'tag', style: `font-size:${pick(36, 40, 40)}px;transform:translate(-50%,-50%)` }, S.tag, 'TU VIDEO A CÁMARA AQUÍ');
      reg(S.tag);
      // b-roll en tarjeta con marco de marca (paso 2): crece sobre la persona cuando la voz dice «a quién ayudas»
      const cw = pick(760, 760, 760), ch = pick(470, 760, 760);
      S.card = el('div', { class: 'broll', style: `left:${pick(1040, (W - cw) / 2, (W - cw) / 2)}px;top:${pick(170, 500, 500)}px;width:${cw}px;height:${ch}px;font-size:${pick(58, 62, 62)}px;
        background:linear-gradient(165deg,#3B4256 0%,#262B38 60%,#1A1E28 100%)` }, root);
      el('div', { class: 'abs', style: `left:0;top:0;width:${cw}px;height:${ch}px;background:radial-gradient(circle at 75% 20%,rgba(${TINT},.55),rgba(${TINT},0) 60%)` }, S.card);
      el('div', { class: 'abs', style: `left:0;top:0;width:${cw}px;height:${ch}px;background:repeating-linear-gradient(115deg,rgba(255,255,255,.06) 0 60px,rgba(255,255,255,0) 60px 150px)` }, S.card);
      el('div', { class: 'ph' }, S.card, '<div class="play"></div><div>TU CLIP AQUÍ</div><small>tu cliente ideal</small>');
      reg(S.card, { o: 0 });

      // capa superior: logo + @, gancho, etiquetas, CTA, barra
      S.brand = el('div', { class: 'brand', style: `left:${pick(80, PAD, PAD)}px;top:${pick(60, 290, 290)}px;font-size:${pick(38, 40, 40)}px` }, root,
        '<div class="slot" data-lint="ui"><i>LOGO</i></div><div class="handle">@tumarca</div>');
      reg(S.brand, { o: 0 });
      S.hook = MARCA.buildHook(root, [
        { text: 'Tu negocio', size: pick(118, 124, 124) },
        { text: 'en 1 frase', size: pick(118, 124, 124), box: true },
      ], { x: pick(1000, PAD, PAD), y: pick(300, 420, 420), gap: pick(22, 26, 26) });
      const chipTxt = [['1', 'Qué haces'], ['2', 'A quién'], ['3', 'Lo distinto']];
      S.chips = chipTxt.map(([n, txt]) => reg(el('div', { class: 'chip', style: `left:${pick(1040, PAD, PAD)}px;top:${pick(180, 400, 400)}px;font-size:${pick(46, 50, 50)}px` }, root, `<b>${n}</b>${txt}`), { o: 0 }));
      S.cta = el('div', { class: 'abs', style: `left:${pick(W * 0.7, W / 2, W / 2)}px;top:${pick(H * 0.42, H * 0.58, H * 0.58)}px;width:0;height:0` }, root);
      el('div', { class: 'cta', style: `font-size:${pick(56, 50, 50)}px;transform:translate(-50%,-50%)` }, S.cta, 'Escríbenos<b>@tumarca</b>');
      reg(S.cta, { o: 0 });
      S.bar = el('div', { class: 'bar', style: 'width:0px' }, root); reg(S.bar);
    },
    run(t, b, S) {
      // cámara: corte de toma × punch-ins con resorte heavy × punch duro en el remate
      const z = shotAt(b)
        * MARCA.punch(t, [[0, 1], ['hook_w2', 1.06], [3.2, 1], ['s1_punch', 1.14], ['s1_back', 1], ['cta', 1]])
        * MARCA.hardPunch(t, 's3_hard', 's3_hard_out', 1.14)
        * (1 + 0.035 * ease.inOut(seg(t, 'cta_pill', 'done')));      // el cierre nunca queda quieto
      const g = S.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      drawRoom(g, z);
      drawPerson(g, t, z);

      // logo + @: visibles desde el frame 0, pulso en el CTA
      MARCA.logo(t, S.brand, -0.4, 'logo_pulse');
      // gancho (frame 0): fila 1 ya arriba, la caja de marca se barre y la fila 2 sube; sale antes del paso 1
      MARCA.hook(t, S.hook, [-0.4, 'hook_w2'], 'hook_out');

      // marcador "TU VIDEO A CÁMARA AQUÍ": se esconde bajo la tarjeta y antes del CTA
      const tagOut = Math.max(sp(t, beatOf('s2_card') - 0.25, 'snappy') - sp(t, 's2_out', 'snappy'), sp(t, beatOf('cta_pill') - 0.75, 'snappy'));
      put(S.tag, { s: 1 - 0.08 * tagOut, o: tagOut > 0.98 ? 0 : 1 - tagOut });

      // etiquetas de paso en el acento: pop en su beat, se van justo antes de la siguiente
      const chipIn = ['s1_chip', 's2_chip', 's3_chip'], chipOut = [beatOf('s2') - 0.3, beatOf('s3') - 0.3, beatOf('cta') - 0.3];
      S.chips.forEach((c, i) => MARCA.tag(t, c, chipIn[i], chipOut[i]));

      // b-roll con marco de marca
      MARCA.broll(t, S.card, 's2_card', 's2_out');

      // CTA en el acento: salta en su beat y pulsa una vez
      MARCA.cta(t, S.cta, 'cta_pill', 'pulse');

      MARCA.progress(t, S.bar);
    },
  });

  C.start();
})();
