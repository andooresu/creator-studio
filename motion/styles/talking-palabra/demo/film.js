// DEMO del estilo "Talking palabra": una persona a cámara da un consejo de ventas en 12,5 s, una palabra a la vez.
// La persona es un MARCADOR DIBUJADO (silueta plana en un canvas) que respira y asiente al hablar: en tu proyecto
// cámbiala por tu clip (frames con scripts/seq.py y C.drawSeq(g, frames, t, t0, box, { z, pos })) — los saltos de
// cámara, golpes de palabra y CTA de abajo funcionan igual sobre el clip real.
// Muestra: gancho estampado palabra por palabra en el frame 0, subtítulos de una palabra (lib/captions.js, preset
// palabra-hook), cámara SIN resortes (saltos secos de escala y encuadre en los beats, cambio cada 1–2 s), dos golpes
// de palabra a pantalla completa en el acento y CTA final. Función pura de t: sin timers, sin Math.random.
(() => {
  const { W, H, FMT, pick, put, reg, el, scene, canvas, clamp, seg, ease, bt, noise1 } = C;
  C.fonts = ["800 100px 'Montserrat'"];
  const PAD = pick(110, 80, 80);
  const ACC = PALA.token('--accent', '#FF5A1F');      // el acento del :root (la marca lo cambia ahí)
  const INK = PALA.inkOn(ACC);                         // texto sobre el acento: negro o blanco, el que más contraste

  // encuadre: cara en el tercio medio (9:16) o a un lado (16:9) — pos [x, y] como en C.drawSeq
  const FACE = { x: W * pick(0.33, 0.5, 0.5), y: H * pick(0.42, 0.44, 0.45) };
  const HEAD = pick(130, 160, 130);
  const nx = noise1(11), ny = noise1(23), nr = noise1(37);

  // cámara: SOLO saltos secos (sin resorte). z = escala, x = desplazamiento del encuadre (corte a otro ángulo)
  const CAM = [
    [0, { z: 1.0, x: 0 }], ['hook_w3', { z: 1.22, x: 0 }],
    ['p3', { z: 1.0, x: -40 }], ['p3_hit', { z: 1.25, x: -40 }],
    ['p4', { z: 1.08, x: 40 }], ['p4_hit', { z: 1.32, x: 40 }], ['p4_back', { z: 1.12, x: 40 }],
    ['p6', { z: 1.0, x: 0 }], ['p6_hit', { z: 1.22, x: 0 }], ['p6_b', { z: 1.1, x: 0 }],
    ['p7', { z: 1.08, x: -30 }], ['p7_hit', { z: 1.3, x: -30 }], ['cta', { z: 1.0, x: 0 }],
  ];
  const HITS = ['hook_w3', 'slam1', 'slam2', 'p7_hit'];

  const rgba = (hex, a) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) return `rgba(255,90,31,${a})`;
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  };

  // ---------------------------------------------------------------- persona dibujada (marcador)
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawRoom(g, z) {
    // estudio oscuro con dos tiras de luz (una en el acento): se acerca menos que la persona en los saltos
    const k = 1 + (z - 1) * 0.35;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(k, k); g.translate(-FACE.x, -FACE.y);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1C1F26'); bg.addColorStop(0.55, '#121418'); bg.addColorStop(1, '#0A0B0D');
    g.fillStyle = bg; g.fillRect(-W, -H, W * 3, H * 3);
    // halo de acento detrás de la persona
    const halo = g.createRadialGradient(FACE.x, FACE.y - HEAD * 0.2, 0, FACE.x, FACE.y - HEAD * 0.2, HEAD * 4.2);
    halo.addColorStop(0, rgba(ACC, 0.26)); halo.addColorStop(0.5, rgba(ACC, 0.08)); halo.addColorStop(1, rgba(ACC, 0));
    g.fillStyle = halo; g.fillRect(-W, -H, W * 3, H * 3);
    // tira de luz de acento (derecha) y tira blanca fría (izquierda)
    const strips = [[pick(0.86, 0.84, 0.84), ACC, 0.9], [pick(0.08, 0.14, 0.14), '#C9D6EA', 0.35]];
    for (const [x, c, a] of strips) {
      const sx = W * x, y0 = H * pick(0.12, 0.16, 0.16), y1 = H * pick(0.86, 0.6, 0.6);
      const glow = g.createLinearGradient(sx - 90, 0, sx + 90, 0);
      glow.addColorStop(0, rgba(c, 0)); glow.addColorStop(0.5, rgba(c, 0.22 * a)); glow.addColorStop(1, rgba(c, 0));
      g.fillStyle = glow; g.fillRect(sx - 90, y0 - 40, 180, y1 - y0 + 80);
      g.fillStyle = rgba(c, a); roundRect(g, sx - 7, y0, 14, y1 - y0, 7); g.fill();
    }
    // piso
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-W, H * pick(0.82, 0.7, 0.7), W * 3, H);
    g.restore();
  }

  function drawPerson(g, t, z) {
    const R = HEAD, breathe = Math.sin((t / 3.0) * Math.PI * 2);
    // habla: asentimiento en el arranque de cada palabra (de window.VO), más deriva sembrada
    let nod = 0;
    for (const p of window.VO || []) for (const w of p.words || []) { const d = t - w.t0; if (d > 0 && d < 0.3) nod += Math.sin((d / 0.3) * Math.PI) * 5; }
    const hx = FACE.x + nx(t * 0.5) * 8, hy = FACE.y + ny(t * 0.6) * 5 + nod, tilt = nr(t * 0.4) * 0.035;
    g.save();
    g.translate(FACE.x, FACE.y); g.scale(z, z); g.translate(-FACE.x, -FACE.y);
    const sy = FACE.y + R * 1.42 - breathe * 3, sw = R * 2.15;
    const body = g.createLinearGradient(FACE.x - sw, 0, FACE.x + sw, 0);
    body.addColorStop(0, '#3A404C'); body.addColorStop(1, '#22262E');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(FACE.x - sw * 1.25, H + 40);
    g.bezierCurveTo(FACE.x - sw * 1.2, sy + R * 0.5, FACE.x - sw * 0.95, sy, FACE.x - R * 0.55, sy - R * 0.08);
    g.lineTo(FACE.x + R * 0.55, sy - R * 0.08);
    g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40);
    g.closePath(); g.fill();
    // borde de luz de acento (la tira de la derecha)
    g.save(); g.beginPath(); g.rect(FACE.x, 0, W, H); g.clip();
    g.strokeStyle = rgba(ACC, 0.75); g.lineWidth = 6;
    g.beginPath(); g.moveTo(FACE.x + R * 0.55, sy - R * 0.08); g.bezierCurveTo(FACE.x + sw * 0.95, sy, FACE.x + sw * 1.2, sy + R * 0.5, FACE.x + sw * 1.25, H + 40); g.stroke();
    g.restore();
    g.fillStyle = '#1C2027';
    g.beginPath(); g.ellipse(FACE.x, sy - R * 0.02, R * 0.62, R * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#56606F';
    roundRect(g, hx - R * 0.36, hy + R * 0.7, R * 0.72, sy - hy - R * 0.62, R * 0.2); g.fill();
    g.save();
    g.translate(hx, hy); g.rotate(tilt);
    const head = g.createLinearGradient(-R, 0, R, 0);
    head.addColorStop(0, '#7A8597'); head.addColorStop(1, '#58616F');
    g.fillStyle = head; g.beginPath(); g.ellipse(0, 0, R * 0.86, R * 1.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#181B21';
    g.beginPath(); g.ellipse(0, -R * 0.42, R * 0.95, R * 0.78, 0, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(-R * 0.05, -R * 0.62, R * 0.9, R * 0.5, -0.08, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.rect(0, -R * 2, R * 2, R * 4); g.clip();
    g.strokeStyle = rgba(ACC, 0.8); g.lineWidth = 6;
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
      // marcador centrado con CSS (translateX(-50%)) dentro de una caja de ancho 0: escala desde su centro
      S.tag = el('div', { class: 'abs', style: `left:${FACE.x}px;top:${pick(H * 0.8, H * 0.74, H * 0.74)}px;width:0;height:0` }, root);
      el('div', { class: 'tag', style: `font-size:${pick(34, 36, 36)}px;transform:translate(-50%,-50%)` }, S.tag, 'TU VIDEO A CÁMARA AQUÍ');
      reg(S.tag);

      // gancho: tres palabras estampadas, una por palabra dicha (la última en acento)
      const HS = pick(120, 120, 128), HX = pick(W * 0.56, PAD, PAD), HY = pick(H * 0.2, H * 0.15, H * 0.151);
      S.hook = [['¿Quieres', false], ['vender', false], ['más?', true]].map(([w, acc], i) =>
        reg(el('div', { class: 'stamp' + (acc ? ' acc' : ''), style: `left:${HX}px;top:${HY + i * HS * 1.08}px;font-size:${HS}px` }, root, w), { o: 0 }));

      // golpes de palabra a pantalla completa: fondo de acento, palabra con tinta por contraste
      S.slams = ['Escucha', 'Simple'].map((w) => {
        const card = el('div', { class: 'slam', style: `width:${W}px;height:${H}px` }, root);
        el('div', { class: 'lines' }, card);
        const size = PALA.fitSize(w, W * pick(0.55, 0.74, 0.74), 300);
        const word = el('div', { class: 'word', style: `left:0;width:${W * pick(1, 0.94, 0.94)}px;top:${H * 0.46 - size / 2}px;font-size:${size}px;text-align:center;color:${INK}` }, card, w);
        reg(word);
        reg(card, { o: 0 });
        return { card, word };
      });

      // CTA: píldora de acento
      S.cta = el('div', { class: 'abs', style: `left:${pick(W * 0.7, W * 0.47, W * 0.47)}px;top:${pick(H * 0.5, H * 0.72, H * 0.72)}px;width:0;height:0` }, root);
      el('div', { class: 'cta', style: `font-size:${pick(58, 58, 58)}px;color:${INK};transform:translate(-50%,-50%)` }, S.cta, 'Escríbenos · @tumarca');
      reg(S.cta, { o: 0 });
    },
    run(t, b, S) {
      // cámara: saltos secos + sacudida sembrada en los golpes + empuje lineal final (el cierre nunca queda quieto)
      const cam = PALA.snap(t, CAM), sh = PALA.shake(t, HITS);
      const z = cam.z * (1 + 0.05 * ease.inOut(seg(t, 'cta', 'done')));
      const g = S.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      g.translate(cam.x + sh.x, sh.y);
      g.translate(W / 2, H / 2); g.rotate((sh.r * Math.PI) / 180); g.translate(-W / 2, -H / 2);
      drawRoom(g, z);
      drawPerson(g, t, z);

      // gancho: cada palabra se estampa al decirse y todo se va con el primer golpe de palabra
      ['hook', 'hook_w2', 'hook_w3'].forEach((m, i) => PALA.stamp(t, S.hook[i], m, 'slam1'));

      // golpes de palabra a pantalla completa (corte seco de entrada y de salida)
      PALA.slam(t, S.slams[0].card, S.slams[0].word, 'slam1', 'slam1_out');
      PALA.slam(t, S.slams[1].card, S.slams[1].word, 'slam2', 'slam2_out', { tilt: 2 });

      // marcador: visible salvo en el CTA
      put(S.tag, { o: b < C.beatOf('cta') ? 1 : 0 });

      // CTA: se estampa seco y late en el pulso
      const pc = PALA.stamp(t, S.cta, 'cta', null, { from: 1.3 });
      const pulse = Math.sin(Math.PI * clamp((t - bt('pulse')) / 0.25)) * 0.07;
      if (pc) put(S.cta, { s: (1.3 - 0.3 * pc) * (1 + pulse) });
    },
  });

  C.start();
})();
