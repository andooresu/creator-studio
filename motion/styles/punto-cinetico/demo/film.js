// DEMO del estilo "Punto cinético" (caso: lanzamiento de una app, cuenta regresiva) · 14 s · 120 BPM · 28 beats · 9:16 primero (también 16:9). Función pura de t.
// Todo es de reemplazo: "tu marca." es el logotipo, las tarjetas "TU CLIP AQUÍ" y la UI dibujada se cambian por tu
// material real (recortes de tu sitio o app, tu SVG). Requiere film/punto.js (window.PUNTO) cargado antes de este archivo.
// Estructura: gancho (b0–8) → producto (b8–16) → función (b16–20) → número (b20–24) → cierre (b24–28).
(() => {
  const { W, H, FMT, pick, put, reg, el, scene, sp, spHit, seg, clamp, lerp } = C;
  const P = PUNTO, { rise, words, dotPop, popHit, popS, vis } = P;
  C.fonts = ['800 100px Inter', '700 100px Inter', '600 100px Inter', '500 40px Inter'];
  const PAD = pick(120, 90, 80);
  const TALL = FMT === '9x16';

  // ================================================================= 1 · GANCHO (b0 → b8): dos afirmaciones + iris
  scene({
    name: 'hook', from: 'hook', to: 'prod',
    build(root, S) {
      root.style.background = 'var(--bg)';
      S.cam = P.cam(root);
      S.aBox = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px` }, S.cam));
      S.bBox = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px` }, S.cam), { o: 0 });
      S.a = words(S.aBox, pick(['Algo nuevo', 'llega.'], ['Algo nuevo', 'llega.'], ['Algo', 'nuevo', 'llega.']),
        { x: PAD, y: pick(300, 380, 560), size: pick(240, 160, 150) });
      S.b = words(S.bBox, pick(['Todo en', 'un toque.'], ['Todo en', 'un', 'toque.'], ['Todo', 'en', 'un', 'toque.']),
        { x: PAD, y: pick(290, 300, 470), size: pick(210, 150, 150), accent: [2, 3] });
      S.iris = P.irisEl(root, 'var(--accent)');
    },
    run(t, b, S) {
      P.microPush(t, S.cam, 0, 8, 0.07);
      rise(t, S.a, [-0.4, 'hook_w2', 'hook_w3']);          // la palabra 1 ya se lee en el frame 0
      dotPop(t, S.a.dots[0], 'hook_dot');
      P.pushSwap(t, S.aBox, S.bBox, 'swap');                // la frase A sale hacia arriba, la B empuja desde abajo
      rise(t, S.b, [-1, 'swap_w2', 'swap_w3', 'swap_w4']);  // la palabra 1 de B llega con el empuje
      dotPop(t, S.b.dots[0], 'swap_dot');
    },
    after(t, b, S) { P.iris(t, S.iris, S.b.dots[0], 'iris1', 'prod'); },   // cobertura total EXACTA en b8
  });

  // ================================================================= 2 · PRODUCTO (b8 → b16): slam, type-on, hoja, UI que se arma, cursor
  const L = pick(
    { logo: { x: PAD, y: 420, size: 230 }, nav: { x: 60, y: 40, w: 1800, h: 92 }, navLogo: { x: 96, y: 64, size: 44 },
      badge: [160, 250, 30], h1: [160, 310, 110], sub: [160, 560], cta: [160, 680, 40], cta2: [580, 680, 40], note: [160, 790, 28],
      card: [1060, 230, 700, 600], push: 0.3 },
    { logo: { x: PAD, y: 400, size: 170 }, nav: { x: 40, y: 36, w: 1000, h: 84 }, navLogo: { x: 72, y: 58, size: 40 },
      badge: [90, 190, 28], h1: [90, 240, 92], sub: [90, 450], cta: [90, 550, 36], cta2: [470, 550, 36], note: [90, 650, 26],
      card: [90, 720, 900, 300], push: 0.25 },
    { logo: { x: PAD, y: 840, size: 130 }, nav: { x: 40, y: 130, w: 1000, h: 100 }, navLogo: { x: 80, y: 157, size: 46 },
      badge: [80, 330, 34], h1: [80, 400, 124], sub: [80, 680], cta: [80, 800, 44], cta2: [590, 800, 44], note: [80, 925, 30],
      card: [80, 1010, 920, 500], push: 0 });
  scene({
    name: 'product', from: 'prod', to: 'feat',
    build(root, S) {
      root.style.background = 'var(--accent)';
      S.page = reg(el('div', { class: 'abs', style: `width:${W}px;height:${H}px;background:var(--bg)` }, root), { o: 0 });
      S.pcam = reg(el('div', { class: 'abs', 'data-lint': 'ui', style: `width:${W}px;height:${H}px` }, S.page));   // UI de reemplazo: letra chica permitida (≥ 28 px)
      const pc = S.pcam;
      // nav dibujado: caja con hueco para el logo + enlaces de esqueleto + botón
      S.nav = reg(el('div', { class: 'abs', style: `left:${L.nav.x}px;top:${L.nav.y}px;width:${L.nav.w}px;height:${L.nav.h}px;border-radius:${L.nav.h / 2}px;background:var(--card);box-shadow:0 2px 6px rgba(23,21,26,.05),0 20px 50px -24px rgba(23,21,26,.25)` }, pc), { o: 0 });
      const lk = L.nav.w * 0.5;
      [0, 1, 2].forEach((i) => el('div', { class: 'abs', style: `left:${lk + i * L.nav.w * 0.1}px;top:${L.nav.h / 2 - 9}px;width:${L.nav.w * 0.07}px;height:18px;border-radius:9px;background:rgba(0,0,0,.1)` }, S.nav));
      // logo fijo del nav: toma el relevo cuando aterriza el logotipo que vuela (b11.6) y se mueve con la cámara de la página
      S.navLogo = P.logo(S.nav, { size: L.navLogo.size });
      reg(S.navLogo, { o: 0, x: L.navLogo.x - L.nav.x, y: L.navLogo.y - L.nav.y });
      el('div', { class: 'abs', style: `left:${L.nav.w - L.nav.h * 2.3}px;top:${L.nav.h * 0.2}px;width:${L.nav.h * 2}px;height:${L.nav.h * 0.6}px;border-radius:${L.nav.h}px;background:var(--ink)` }, S.nav);
      // piezas del hero (todas de reemplazo)
      const place = (e, [x, y]) => { e._x = x; e._y = y; return e; };
      S.badge = place(P.pillEl(pc, 'PRÓXIMAMENTE · v1.0', { size: L.badge[2], bg: 'var(--accent-soft)', color: 'var(--accent)' }), L.badge);
      S.h1 = place(reg(el('div', { class: 'abs', style: `width:${W - 2 * L.h1[0]}px;height:${L.h1[2] * 2.1}px` }, pc), { o: 0 }), L.h1);
      S.h1._inner = reg(el('div', { class: 'abs display', style: `font-size:${L.h1[2]}px;line-height:1.02;white-space:normal;width:${W - 2 * L.h1[0]}px` }, S.h1, 'Llega en<br>diez días<span style="color:var(--accent)">.</span>'));
      S.h1._h = L.h1[2] * 2.1;
      S.sub = place(P.skeleton(pc, pick([720, 560], [640, 480], [820, 640]), { h: pick(24, 22, 26), gap: 20 }), L.sub);
      S.cta = place(P.pillEl(pc, 'Únete a la lista', { size: L.cta[2] }), L.cta);
      S.cta2 = place(P.pillEl(pc, 'Ver demo', { size: L.cta2[2], bg: 'transparent', color: 'var(--ink)', border: 'var(--ink)' }), L.cta2);
      S.note = place(reg(el('div', { class: 'abs', style: `font-size:${L.note[2]}px;font-weight:500;color:var(--ink-2);white-space:nowrap` }, pc, 'Acceso anticipado sin costo'), { o: 0 }), L.note);
      S.card = P.placeholder(pc, L.card[2], L.card[3]);
      // logotipo de reemplazo: versión negativa (sobre acento) y a color (sobre la hoja), partidas en el borde de la hoja
      S.wmBox = reg(el('div', { class: 'abs', style: `width:${W}px;height:${L.logo.size * 1.2}px` }, root));
      S.wmNeg = P.logo(S.wmBox, { size: L.logo.size, color: '#fff', dotColor: 'var(--accent-2)' });
      S.typed = reg(el('span', { style: 'display:inline-block;font-weight:600;letter-spacing:-0.025em' }, S.wmNeg), { y: 0 });
      S.wmCol = P.logo(S.wmBox, { size: L.logo.size, color: 'var(--ink)', dotColor: 'var(--accent)' });
      S.cur = P.cursorEl(root);
    },
    run(t, b, S) {
      const size = L.logo.size;
      // --- slam del logotipo (b8) + type-on de "app" después del punto (b9 → b9.75, una letra por 0.25 beat)
      P.typeOn(t, S.typed, 'app', 'type', 9.75);
      put(S.typed, { o: b < 10.45 ? 1 : 0, y: -40 * sp(t, 10.3, 'snappy') });
      const slam = spHit(t, 'prod', 'heavy');
      // --- vuela al hueco del logo en el nav (b10.5)
      const fly = sp(t, 'cover', 'heavy');
      const k = lerp(1, L.navLogo.size / size, fly) * (1 + 0.14 * (1 - slam));
      const x = lerp(L.logo.x, L.navLogo.x, fly), y = lerp(L.logo.y + 120 * (1 - slam), L.navLogo.y, fly);
      put(S.wmBox, { x, y, s: k, o: b < 11.6 ? 1 : 0 });
      put(S.navLogo, { o: b < 11.6 ? 0 : 1 });
      // --- la hoja cubre el campo desde abajo; el logotipo cambia de negativo a color exactamente en su borde
      const edge = P.pageCover(t, S.page, 'cover');
      const f = clamp((edge - y) / Math.max(1, size * k)) * 100;   // % del logo sobre el borde (sigue en negativo)
      put(S.wmNeg, { clip: `inset(0 0 ${(100 - f).toFixed(3)}% 0)` });
      put(S.wmCol, { o: f < 99.9 ? 1 : 0, clip: `inset(${f.toFixed(3)}% 0 0 0)` });
      // --- la página se arma pieza por pieza (cada 0.25 beat)
      const navP = sp(t, 'ui', 'snappy');
      put(S.nav, { o: vis(navP), clip: `inset(0 ${((1 - navP) * 100).toFixed(2)}% 0 0 round ${L.nav.h / 2}px)` });
      P.enter(t, S.h1, 'ui', 'rise');
      P.enter(t, S.badge, 'ui_badge', 'grow');
      P.enter(t, S.sub, 'ui_badge', 'fade');
      P.enter(t, S.cta, 'ui_cta', 'grow');
      P.enter(t, S.cta2, 'ui_cta2', 'grow');
      P.enter(t, S.note, 12.5, 'fade');            // solo la línea pequeña puede hacer fade
      P.tilt(t, S.card, L.card[0], L.card[1], 'ui_card', { dy: pick(420, 380, 500) });
      // --- push de cámara hacia el CTA (no en 9:16) y el cursor lo presiona en b15
      const ctaC = { x: L.cta[0] + L.cta[2] * 5.4, y: L.cta[1] + L.cta[2] * 0.62 };
      const push = L.push ? sp(t, 13.5, 'heavy') : 0;   // 9:16: sin push, el cursor lleva la acción
      const zs = 1 + L.push * push;
      const dx = (W * 0.5 - ctaC.x) * 0.35 * push, dy = (H * 0.5 - ctaC.y) * 0.35 * push;
      put(S.pcam, { s: zs, x: ctaC.x * (1 - zs) + dx, y: ctaC.y * (1 - zs) + dy, css: { transformOrigin: '0 0' } });
      const tx = (px) => px * zs + ctaC.x * (1 - zs) + dx, ty = (py) => py * zs + ctaC.y * (1 - zs) + dy;
      const press = P.cursor(t, S.cur, [['cur_in', W + 80, H + 80], [14.1, tx(ctaC.x + 60), ty(ctaC.y + 50)], [14.7, tx(ctaC.x), ty(ctaC.y)]], 'click', 14.1);
      if (b > 14.5) put(S.cta, { s: 1 - 0.05 * press, css: { transformOrigin: '50% 50%', filter: `brightness(${(1 - 0.06 * press).toFixed(3)})` } });
    },
  });

  // ================================================================= 3 · FUNCIÓN (b16 → b20): campo noche, pila de avisos, push past camera
  const NW = pick(680, 760, 880), NH = pick(150, 150, 172);
  scene({
    name: 'feature', from: 'feat', to: 'num',
    build(root, S) {
      root.style.background = 'var(--night)';
      S.cam = P.cam(root, pick(1440, 620, W / 2), pick(500, 700, 1100));
      S.h = words(S.cam, ['Avisos', 'útiles.'], { x: PAD, y: pick(380, 110, 300), size: pick(170, 130, 176), color: '#fff', accent: [1], accentColor: 'var(--accent-2)', dotColor: 'var(--accent-2)' });
      const notes = [['Ya estás en la lista', 'Puesto 128'], ['Tu acceso anticipado está listo', 'Hace 1 min'], ['Faltan 10 días', 'Te avisamos el día uno']];
      S.cards = notes.map(([a, c]) => {
        const e = reg(el('div', { class: 'shot', 'data-lint': 'ui', style: `width:${NW}px;height:${NH}px;border-radius:28px` }, S.cam), { o: 0 });
        const ic = NH * 0.5;
        e.innerHTML = `<div style="position:absolute;left:${NH * 0.25}px;top:${NH * 0.25}px;width:${ic}px;height:${ic}px;border-radius:${ic * 0.3}px;background:var(--accent)"></div>
          <div style="position:absolute;left:${NH * 0.25 + ic * 0.32}px;top:${NH * 0.25 + ic * 0.3}px;width:${ic * 0.36}px;height:${ic * 0.36}px;border-radius:50%;background:#fff"></div>
          <div style="position:absolute;left:${NH * 0.95}px;top:${NH * 0.24}px;font-weight:700;font-size:${NH * 0.22}px;color:var(--ink);white-space:nowrap">${a}</div>
          <div style="position:absolute;left:${NH * 0.95}px;top:${NH * 0.56}px;font-weight:500;font-size:${NH * 0.18}px;color:var(--ink-2);white-space:nowrap">${c}</div>`;
        e._w = NW; e._h = NH;
        return e;
      });
    },
    run(t, b, S) {
      const out = P.pushPast(t, 'past', 'num');
      put(S.cam, { s: (1 + 0.04 * seg(t, 16, 20)) * out.mul, filter: out.filter });
      rise(t, S.h, ['feat', 'feat_w2']);
      dotPop(t, S.h.dots[0], 'feat_dot');
      // cada aviso cae desde arriba en su beat y empuja hacia abajo al anterior
      P.stackDrop(t, S.cards, ['notif1', 'notif2', 'notif3'], { x: pick(1120, 250, (W - NW) / 2), top: pick(150, 400, 720), gap: 26 });
    },
  });

  // ================================================================= 4 · NÚMERO (b20 → b24): cuenta regresiva 29 → 10, lista de hitos, iris blanco
  const STEPS = ['Abre la lista de espera', 'Llega el acceso anticipado', 'Se lanza la app', 'Disponible para todos'];
  const LW = pick(700, 560, 820), ROWH = pick(96, 80, 96), HEAD = pick(84, 70, 84);
  const ROWS = [0, HEAD, ...STEPS.map((_, i) => HEAD + (i + 1) * ROWH)];
  scene({
    name: 'number', from: 'num', to: 'end',
    build(root, S) {
      root.style.background = 'var(--accent)';
      S.size = pick(500, 400, 470);
      S.nx = PAD; S.ny = pick(150, 110, 290);
      S.cam = P.cam(root, S.nx + S.size * 0.6, S.ny + S.size * 0.5);
      S.ctr = P.counterEl(S.cam, { x: S.nx, y: S.ny, size: S.size });
      S.h = words(S.cam, ['días.'], { x: PAD, y: S.ny + S.size * 1.12, size: pick(118, 84, 110), color: '#fff', dotColor: 'var(--accent-2)' });
      S.lh = ROWS[ROWS.length - 1] + 16;
      S.list = reg(el('div', { class: 'shot', 'data-lint': 'ui', style: `width:${LW}px;height:${S.lh}px;border-radius:30px` }, S.cam), { o: 0 });
      let html = `<div style="position:absolute;left:36px;top:${HEAD * 0.34}px;font-weight:700;font-size:${HEAD * 0.34}px;letter-spacing:0.06em;color:var(--ink-2)">CUENTA REGRESIVA</div>`;
      STEPS.forEach((s, i) => {
        const y = HEAD + i * ROWH;
        html += `<div style="position:absolute;left:24px;right:24px;top:${y}px;height:${ROWH - 12}px;border-radius:18px;background:var(--bg-2)"></div>
          <div style="position:absolute;left:44px;top:${y + (ROWH - 12) / 2 - ROWH * 0.22}px;width:${ROWH * 0.44}px;height:${ROWH * 0.44}px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;font-size:${ROWH * 0.3}px;line-height:${ROWH * 0.44}px;text-align:center">${i + 1}</div>
          <div style="position:absolute;left:${60 + ROWH * 0.6}px;top:${y + (ROWH - 12) / 2 - ROWH * 0.15}px;font-weight:600;font-size:${ROWH * 0.3}px;color:var(--ink);white-space:nowrap">${s}</div>`;
      });
      S.list.innerHTML = html;
      S.lx = pick(1100, 470, (W - LW) / 2); S.ly = pick(220, 620, 1060);
      S.iris = P.irisEl(root, 'var(--bg)');
    },
    run(t, b, S) {
      const punch = sp(t, 22.6, 'default');
      put(S.cam, { s: (1 + 0.06 * seg(t, 20, 23.2)) * (1 + 0.16 * punch) });
      P.counter(t, S.ctr, 10, 'num', 'num_land', 'num_land', 29);   // cuenta regresiva 29 → 10, aterriza EXACTO en b22 (thump)
      rise(t, S.h, ['num_label']);
      dotPop(t, S.h.dots[0], 'num_dot');
      // la tarjeta sube en perspectiva falsa y revela un paso por medio beat
      const ep = sp(t, 20.5, 'default');
      put(S.list, { o: vis(ep), clip: P.listClip(t, S.lh, ROWS, 'rows', 0.5),
        css: { transform: `translate(${S.lx}px, ${(S.ly + 600 * (1 - ep) - 30 * seg(t, 21, 24)).toFixed(2)}px) rotate(${(-3 + 3 * (1 - ep)).toFixed(3)}deg) skewY(${(-4 * (1 - ep)).toFixed(3)}deg)` } });
    },
    // el punto de "días." crece en iris blanco: cubre justo cuando entra el cierre (pre 0.22 → b23.78)
    after(t, b, S) { P.iris(t, S.iris, S.h.dots[0], 'iris2', 23.78); },
  });

  // ================================================================= 5 · CIERRE (b24 → b28): logo sube, punto entra al final, línea, píldora, pulso
  scene({
    name: 'end', from: 'end', to: 'done', pre: 0.22, cut: true,   // entra el frame en que el iris blanco termina
    build(root, S) {
      root.style.background = 'var(--bg)';
      S.cam = P.cam(root, W / 2, H / 2);
      S.ws = pick(250, 190, 190);
      S.wy = pick(300, 330, 700);
      S.mask = reg(el('div', { class: 'abs', style: `top:${S.wy}px;width:${W}px;height:${S.ws * 1.25}px;overflow:hidden` }, S.cam));
      S.wm = P.logo(S.mask, { size: S.ws });
      S.wm.style.width = W + 'px'; S.wm.style.textAlign = 'center'; S.wm.style.paddingTop = S.ws * 0.08 + 'px';
      const ty = S.wy + S.ws * 1.25 + pick(30, 24, 40);
      S.line = el('div', { class: 'line', style: `left:0;top:${ty}px;width:${W}px;text-align:center;font-size:${pick(84, 56, 66)}px;font-weight:600;letter-spacing:-0.02em;color:var(--ink-2)` }, S.cam);
      S.lw = reg(el('span', { class: 'word' }, S.line, 'Únete a la lista <span style="color:var(--accent)">hoy</span>'), { y: 0 });
      reg(S.line);
      S.ctaRow = reg(el('div', { class: 'abs', style: `top:${ty + pick(150, 110, 140)}px;width:${W}px;display:flex;justify-content:center;transform-origin:50% 50%` }, S.cam), { o: 0 });
      el('div', { class: 'ui-pill', style: `position:relative;font-size:${pick(52, 40, 50)}px;background:var(--accent);color:#fff` }, S.ctaRow, 'Quiero acceso');
    },
    run(t, b, S) {
      put(S.cam, { s: 1 + 0.04 * seg(t, 24, 28) });
      const p = sp(t, 23.4, 'heavy');
      put(S.wm, { y: S.ws * 1.45 * (1 - p), s: 1.08 - 0.08 * p, css: { transformOrigin: '50% 100%' } });
      // el punto entra al final y pulsa en b26.9: el cierre nunca queda quieto
      const dp = spHit(t, 'end_dot', 'snappy', 0.035);
      put(S.wm._dot, { s: popS(dp) * (1 + 0.35 * P.pulse(t, 'pulse')), o: vis(dp) });
      const lp = spHit(t, 'cta', 'heavy');
      put(S.lw, { y: 170 * (1 - lp), hide: lp < 0.002 });
      const cp = popHit(t, 'cta_pill');
      put(S.ctaRow, { o: vis(cp), s: 0.7 + 0.3 * popS(cp) });
    },
  });

  C.start();
})();
