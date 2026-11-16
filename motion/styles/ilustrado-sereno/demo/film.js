// Demo del estilo "Ilustrado sereno": pantalla informativa de sala de espera (~14 s, 9:16 primero, también 16:9) con texto de ejemplo.
// Todo el material es de relleno: un personaje plano dibujado en canvas y tarjetas "TU CLIP AQUÍ". Sin archivos externos.
// Estructura: bienvenida + guía (push-in a la cara) → detalle con luz suave → 3 tarjetas "mientras esperas" → CTA + loop limpio.
// Función pura del tiempo: sin timers, sin Math.random, nada mutado en run(). Tiempos en beats y marcas de timeline.json.
(() => {
  const { W, H, pick, put, reg, el, scene, canvas, sp, spHit, seg, clamp, lerp, ease, bt, beatOf } = C;
  const { line, rise } = TYPE;
  const I = ILUS, TAU = Math.PI * 2;
  C.fonts = ['800 100px Display', '900 100px Display', '700 40px Display', '500 40px UI', '600 40px UI'];
  if (C.TL.render_flags && C.TL.render_flags.notext) document.body.classList.add('notext');
  const TALL = I.TALL, PAD = I.PAD, Z = I.SIZE;

  // ================================================================ 1 · GANCHO + SOLUCIÓN (0 → 8)
  // El personaje no entiende una hoja (ceño, se rasca la cabeza, nube "?"), la nube se hace polvo,
  // sorpresa, push-in heavy a la cara y sonrisa con "Te guiamos con calma." Luego deriva lenta hacia la hoja.
  const BUBBLE = [205, -335];                                   // centro de la nube (espacio del personaje)
  const DUST = I.dust({ seed: 7, n: 150, cx: BUBBLE[0], cy: BUBBLE[1], rx: 100, ry: 70, up: 560, spread: 480 });
  const SHEET_AT = [-226, 80];                                  // la hoja cuando baja la mano: destino de la deriva

  scene({
    name: 'gancho', from: 'hook', to: 'det',
    build(root, S) {
      S.g = canvas(root);
      S.O = pick({ x: 1500, y: 470, s: 1, dx: 1500, dy: 600, dr: 400 }, null, { x: 540, y: 600, s: 0.92, dx: 540, dy: 690, dr: 390 });
      const y0 = pick(330, 330, 1120), lh = Z.hook * I.LH;
      S.a1 = line(root, '¿Primera vez', { x: PAD, y: y0, size: Z.hook });
      S.a2 = line(root, 'por aquí?', { x: PAD, y: y0 + lh, size: Z.hook, accent: [1] });
      [S.b1, S.b2] = I.stack(root, ['Te guiamos', 'con calma.'], PAD, pick(300, 300, 1110), Z.solucion, [null, [1]]);
    },
    run(t, b, S) {
      const g = S.g, O = S.O; g.clearRect(0, 0, W, H);
      // ---- pose
      const out = sp(t, 0.5, 'heavy'), back = sp(t, 3.9, 'default');
      const hand = [lerp(lerp(-240, -330, out), -230, back), lerp(lerp(60, 10, out), 170, back)];
      const gone = sp(t, 'dust', 'snappy');
      const frown = sp(t, 1.0, 'default') * (1 - gone);
      const surprise = sp(t, 3.6, 'snappy') * (1 - sp(t, 4.4, 'default'));
      const smile = sp(t, 4.4, 'default');
      const scratch = sp(t, 1.2, 'default') - sp(t, 3.3, 'default');
      const lhand = [lerp(190, 118, scratch) + 8 * Math.sin(t * 14) * scratch, lerp(440, -205, scratch)];
      const P = {
        tilt: -0.08 * out * (1 - back) + 0.03 * surprise, hx: 8 * out * (1 - back), brow: frown - 0.9 * surprise,
        squint: 0.5 * frown, smile: 0.8 * smile, oh: 0.9 * surprise, blink: I.pulse(t, 6.4, 6.6),
        hand, lhand, held: (gg, x, y) => I.sheet(gg, x + 4, y - 90, -0.08 - 0.08 * out, 3.2 * (1 - gone)),
      };
      // ---- cámara: micro push, push-in a la cara en 'push' y deriva lenta hacia la hoja (el corte entra en ella)
      const push = sp(t, 'push', 'heavy'), toDet = ease.inOut(seg(t, 6, 8));
      const face = [0, -150], F = [lerp(face[0], SHEET_AT[0], toDet), lerp(face[1], SHEET_AT[1], toDet)];
      const z = O.s * I.micro(t, 'hook', 'push', 0.04) * (1 + pick(0.8, 0.8, 0.72) * push) * (1 + 0.45 * toDet);
      const home = [O.x + face[0] * O.s, O.y + face[1] * O.s], target = pick([1460, 500], null, [540, 560]);
      const T = [lerp(home[0], target[0], push), lerp(home[1], target[1], push)];
      if (TALL) { g.save(); g.beginPath(); g.rect(0, 0, W, 1050); g.clip(); }       // 9:16: el push-in nunca pisa el texto
      g.save(); g.translate(T[0], T[1]); g.scale(z, z); g.translate(-F[0], -F[1]);
      const k = 1 / O.s;
      I.withDisc(g, (O.dx - O.x) * k, (O.dy - O.y) * k, O.dr * k, () => I.person(g, P));
      const bk = spHit(t, 'duda', 'snappy') * (1 - clamp(gone * 3));
      I.thought(g, BUBBLE[0], BUBBLE[1] + 6 * Math.sin(t * 3), bk);
      I.drawDust(g, DUST, t - bt('dust'));
      g.restore();
      if (TALL) { I.fadeToBg(g, 860, 1050); g.restore(); }
      // ---- texto: mensaje 1 desde antes del frame 0, mensaje 2 con el push-in; ambos salen antes de su relevo
      rise(t, S.a1, [-0.4, -0.32], 3.6);
      rise(t, S.a2, ['hook_l2', 'acento'], 3.6);
      rise(t, S.b1, ['sol_a', 4.25], 7.62);
      rise(t, S.b2, ['sol_b', 5.05], 7.62);
    },
  });

  // ================================================================ 2 · DETALLE CON LUZ (8 → 12)
  // Primer plano en un disco: aparece el badge de luz, baja un haz suave, los anillos barren y el clip borroso
  // entra en foco de golpe; destello y check. Nada clínico: luz suave sobre una ilustración tranquila.
  scene({
    name: 'detalle', from: 'det', to: 'ben',
    build(root, S) {
      S.g = canvas(root);
      S.D = pick({ x: 1450, y: 600, r: 380 }, null, { x: 540, y: 660, r: 400 });
      S.c = I.stack(root, ['Todo a tiempo,', 'sin apuros.'], PAD, pick(330, 330, 1180), Z.detalle, [null, [0, 1]]);
    },
    run(t, b, S) {
      const g = S.g, D = S.D, R = D.r, Tk = I.tok(); g.clearRect(0, 0, W, H);
      const inn = spHit(t, 'det', 'snappy'), cam = (0.86 + 0.14 * inn) * I.micro(t, 'det', 'ben', 0.05);
      const bm = spHit(t, 'beam', 'heavy', 0.05), off = sp(t, 11.0, 'default'), bl = bm * (1 - off);
      const scan = seg(t, 'scan', 'focus'), foc = spHit(t, 'focus', 'snappy', 0.04), tl = t - bt('det');
      g.save(); g.translate(D.x, D.y); g.scale(cam, cam);
      // disco con el clip adentro (borroso + velo hasta el enfoque)
      g.fillStyle = Tk.disc; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip();
      const cw = R * 1.3, ch = R * 0.9, cx = 0, cy = -R * 0.04;
      g.save(); g.shadowColor = Tk.shadow; g.shadowBlur = 40; g.shadowOffsetY = 14; g.fillStyle = Tk.cardIn;
      I.rrect(g, cx - cw / 2, cy - ch / 2, cw, ch, 28); g.fill(); g.restore();
      I.clip(g, cx - cw / 2, cy - ch / 2, cw, ch, { t, r: 28, blur: 8 * (1 - foc), sub: 'tu espacio o tu equipo' });
      if (foc < 0.99) { g.globalAlpha = 0.6 * (1 - foc); g.fillStyle = Tk.cardIn; I.rrect(g, cx - cw / 2, cy - ch / 2, cw, ch, 28); g.fill(); g.globalAlpha = 1; }
      I.glow(g, cx, cy, bl * (0.75 + 0.25 * Math.sin(tl * 9)), R * 0.5);
      I.scanRings(g, cx, cy, bm * (1 - foc), scan, R * 0.55);
      I.focusRing(g, cx, cy, seg(t, 'focus', 11.8), R * 0.33, R * 0.4);
      g.restore();
      // la fuente de luz y el haz (baja, y se retrae después del enfoque)
      const by = -R - pick(70, 70, 80);
      I.badge(g, 0, by, sp(t, 'badge', 'snappy') * (1 - 0.5 * off), tl);
      I.beam(g, 0, by + 30, cx, cy, R * 0.2, bl, tl);
      // destello y check (suenan: spHit)
      const sk = spHit(t, 'focus', 'snappy', 0.04) * (1 - sp(t, 11.3, 'default'));
      I.sparkle(g, cx + cw * 0.42, cy - ch * 0.42, 36 * sk);
      I.check(g, R * 0.7, R * 0.66, 62, spHit(t, 'check', 'snappy'), seg(t, 'check', beatOf('check') + 0.6));
      g.restore();
      rise(t, S.c[0], [8.1, 8.18, 8.26], 11.62);
      rise(t, S.c[1], ['scan', 9.18], 11.62);
    },
  });

  // ================================================================ 3 · BENEFICIOS (12 → 16)
  // "Mientras esperas": 3 tarjetas entran atenuadas; cada una se enciende (borde de acento + chip) en la palabra que la nombra.
  const CARDS = [['Tu turno', 'clock', 'card1', 'card2'], ['Respira', 'heart', 'card2', 'card3'], ['Pregunta', 'chat', 'card3', 'cards_off']];
  const cardBox = (i) => (TALL ? { x: PAD, y: 470 + i * 335, w: W - 2 * PAD, h: 305 } : { x: PAD + i * 573, y: 340, w: 533, h: 560 });
  function vignette(g, i, w, h, t, act) {
    if (i === 0) {                       // tu clip
      if (TALL) I.clip(g, w * 0.4, h * 0.13, w * 0.54, h * 0.74, { t, r: 20 });
      else I.clip(g, w * 0.08, h * 0.08, w * 0.84, h * 0.62, { t, r: 20 });
    } else if (i === 1) {                // el personaje tranquilo
      const s = TALL ? 0.34 : 0.46, ox = TALL ? w * 0.72 : w * 0.56, oy = TALL ? h * 0.46 : h * 0.4;
      g.save(); g.translate(ox, oy); g.scale(s, s);
      I.withDisc(g, 0, 150, 380, () => I.person(g, { smile: 0.95, lhand: [190, 440], hand: [-200, 400], blink: I.pulse(t, 13.9, 14.05) }));
      g.restore();
    } else {                             // un chat cercano
      const ox = TALL ? w * 0.7 : w * 0.5, oy = TALL ? h * 0.5 : h * 0.38, s = TALL ? 1.15 : 1.5;
      I.phone(g, ox, oy, -0.08 + 0.03 * Math.sin(t * 2), s);
      I.typing(g, ox + (TALL ? 170 : 150), oy - (TALL ? 50 : 120), 0.6 + 0.4 * act, t);
    }
  }
  scene({
    name: 'beneficios', from: 'ben', to: 'cta',
    build(root, S) {
      S.g = canvas(root);
      S.h = line(root, 'Mientras esperas:', { x: PAD, y: pick(150, 150, 320), size: Z.beneficio, accent: [1] });
      S.chips = CARDS.map(([label, icon]) => I.pill(root, label, icon, { size: Z.chip, bg: I.tok().card, color: I.tok().bg }));
    },
    run(t, b, S) {
      const g = S.g, Tk = I.tok(); g.clearRect(0, 0, W, H);
      const cam = I.micro(t, 'ben', 'cta', 0.03);
      g.save(); g.translate(W / 2, H / 2); g.scale(cam, cam); g.translate(-W / 2, -H / 2);
      CARDS.forEach(([, , a, zz], i) => {
        const act = sp(t, a, 'snappy') - sp(t, zz, 'snappy');
        const gone = sp(t, 15.55 + (2 - i) * 0.03, 'default');
        const r = I.litCard(g, cardBox(i), {
          p: sp(t, 12.0 + i * 0.12, 'default'), lit: spHit(t, a, 'snappy', 0.04), act, gone,
          pulse: Math.sin(Math.PI * seg(t, a, beatOf(a) + 0.5)), draw: (gg, w, h) => vignette(gg, i, w, h, t, act),
        });
        if (!r) { put(S.chips[i], { o: 0 }); return; }
        const cp = spHit(t, beatOf(a) + 0.25, 'snappy');
        const sx = (r.x - W / 2) * cam + W / 2, sy = (r.y - H / 2) * cam + H / 2, sh = r.h * cam;
        put(S.chips[i], { o: I.on(cp) * (1 - I.on(gone - 0.3)), x: sx + (TALL ? 26 : 28), y: TALL ? sy + 26 : sy + sh - 100,
          s: (0.7 + 0.3 * cp) * (1 + 0.06 * act), css: { background: act > 0.5 ? Tk.accent : Tk.card, color: act > 0.5 ? Tk.obj : Tk.bg } });
      });
      g.restore();
      rise(t, S.h, [12.05, 12.13], 15.62);
    },
  });

  // ================================================================ 4 · CTA (16 → 23): calendario + botón de acción + nota legal
  scene({
    name: 'cta', from: 'cta', to: 'done',
    build(root, S) {
      S.g = canvas(root);
      const z = Z.solucion, y0 = pick(160, 160, 1000);
      S.r1 = line(root, 'Estamos', { x: PAD, y: y0, size: z });
      S.r2 = line(root, 'contigo.', { x: PAD, y: y0 + z * I.LH, size: z, accent: [0] });
      const q = Z.accion, yq = y0 + z * I.LH * 2 + 30;
      S.q = ['Habla con nuestro equipo', 'o escríbenos hoy.'].map((s, i) => line(root, s, { x: PAD, y: yq + i * q * 1.26, size: q }));
      S.g2 = canvas(root);                                             // anillo y burbuja del botón (siguen su rect vivo)
      S.btn = I.pill(root, 'Escríbenos', 'chat', { size: pick(54, 50, 52), bg: I.tok().action, color: I.tok().card });
      S.legal = el('div', { class: 'abs ui', 'data-lint': 'ui', 'data-notext': '1',
        style: `left:${PAD}px;top:${pick(975, 975, 1440)}px;font-size:${Z.legal}px;font-weight:500;color:var(--ink-2)` }, root, 'Sujeto a valoración profesional');
      reg(S.legal, { o: 0 });
      S.CAL = pick({ x: 1160, y: 250, w: 630, h: 570 }, null, { x: 160, y: 290, w: 760, h: 480 });
      S.BTN = pick({ x: PAD, y: 790 }, null, { x: PAD, y: 845 });
    },
    run(t, b, S) {
      const g = S.g; g.clearRect(0, 0, W, H);
      const cam = 1 + 0.06 * seg(t, 'cta', 'done');
      g.save(); g.translate(W / 2, H / 2); g.scale(cam, cam); g.translate(-W / 2, -H / 2);
      I.calendar(g, S.CAL, { t, inAt: 16.1, outAt: 22.2, floatAt: 19.0, checkAt: 'dia', check2At: 'dia2' });
      g.restore();
      // botón: crece en snappy, se presiona dos veces, sale escalando a 0 para el loop
      const bp = spHit(t, 'btn', 'snappy'), bo = clamp(sp(t, 21.95, 'snappy'));
      const press = I.pulse(t, 19.35, 19.6) + 1.2 * I.pulse(t, 21.0, 21.4, 'default');
      put(S.btn, { o: I.on(bp) * I.on(1 - bo - 0.002), x: S.BTN.x, y: S.BTN.y, s: (0.75 + 0.25 * bp) * (1 - 0.06 * press) * (1 - bo) });
      // titular: aterriza bajo y se desliza hacia arriba cuando entran las líneas de acción
      const glide = pick(200, 240, 240) * (1 - sp(t, 17.3, 'heavy'));
      put(S.r1.el, { y: glide }); put(S.r2.el, { y: glide });
      rise(t, S.r1, [16.05], 22.25);
      rise(t, S.r2, ['cta_r2'], 22.25);
      S.q.forEach((L, i) => rise(t, L, beatOf('cta2') + i * 0.6, 22.25, { preset: 'snappy', stagger: 0.04 }));
      const lg = sp(t, 'legal', 'default'), lo = clamp(sp(t, 22.1, 'default'));
      put(S.legal, { o: lg * I.on(1 - lo - 0.002), y: 12 * (1 - lg) + 40 * lo, s: 1 - lo });
    },
    after(t, b, S) {
      const g = S.g2; g.clearRect(0, 0, W, H);
      if (b < beatOf('btn') - 0.2) return;
      const r = C.rectOf(S.btn);
      I.pressRing(g, r.x, r.y, r.w, r.h, seg(t, 19.35, 20.55));
      I.pressRing(g, r.x, r.y, r.w, r.h, seg(t, 21.0, 21.9));
      const k = sp(t, 18.85, 'snappy') * (1 - clamp(sp(t, 21.85, 'snappy') * 1.4));
      I.typing(g, r.x + r.w + 110, r.cy - 6, k, t - bt('btn'));
    },
  });

  C.start();
})();
