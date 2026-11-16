// Demo del estilo "Producto por dentro" · 13 s · 120 BPM · 9:16 primero (también 4:5 y 16:9). Función pura de t.
// Todo lo visual es un marcador dibujado (tarjetas, filas, ilustraciones en canvas y rótulos «TU CLIP AQUÍ»):
// en un video real cada marcador se reemplaza por una captura 3x o un clip real del producto.
// Requiere helpers/producto.js (window.PPD) cargado antes de este archivo.
(() => {
  const { W, H, pick, put, reg, el, scene, sp, spHit, seg, lerp, ease, bt, beatOf } = C;
  const { rise, line } = TYPE;
  const P = window.PPD;
  const { L, X0, title, rises, bg, dots, PRE, panel, cover, pushBox, push, uiCard, placeholder, cardIn, growFrom,
    ring, runRing, cursor, runCursor, cascade, listWindow, counter, dropGrid, ctaPill, lockupHit, tok, show } = P;
  C.fonts = ['800 100px Display', '700 100px Display', '600 40px UI', '700 40px UI'];

  // ---------------------------------------------------------------- piezas dibujadas (marcadores)
  /** Barra de ventana genérica: tres puntos y una píldora vacía. */
  function windowBar(parent, w, h) {
    const bar = el('div', { class: 'abs', style: `width:${w}px;height:${h}px;background:var(--card);border-bottom:2px solid var(--tint)` }, parent);
    const d = Math.round(h * 0.28);
    ['#e4e6ea', '#e4e6ea', '#e4e6ea'].forEach((c, i) => el('div', { class: 'abs', style: `left:${h * 0.45 + i * d * 1.7}px;top:${(h - d) / 2}px;width:${d}px;height:${d}px;border-radius:50%;background:${c}` }, bar));
    el('div', { class: 'abs', style: `left:${w * 0.3}px;top:${h * 0.24}px;width:${w * 0.4}px;height:${h * 0.52}px;border-radius:${h}px;background:var(--tint)` }, bar);
    return bar;
  }
  /** Arte del producto: ventana con captura de marcador, renglones grises y un botón de acento (el cursor lo pulsa). */
  function productArt(parent, w, h) {
    const card = uiCard(parent, w, h, { r: 26 });
    const bh = Math.round(h * 0.1);
    windowBar(card, w, bh);
    const ph = placeholder(card, w - 56, h * 0.5, 'TU CAPTURA AQUÍ', { r: 16, flat: true, size: Math.round(w * 0.04) });
    reg(ph, { x: 28, y: bh + 28, o: 1 });
    const y0 = bh + 28 + h * 0.5 + 34;
    [0.62, 0.44].forEach((k, i) => el('div', { class: 'abs', style: `left:28px;top:${y0 + i * 44}px;width:${w * k}px;height:24px;border-radius:12px;background:${i ? 'var(--tint)' : 'var(--tint-2)'}` }, card));
    const btn = { x: w - 28 - w * 0.3, y: h - 28 - h * 0.13, w: w * 0.3, h: h * 0.13 };
    el('div', { class: 'abs', style: `left:${btn.x}px;top:${btn.y}px;width:${btn.w}px;height:${btn.h}px;border-radius:${btn.h}px;background:var(--accent);color:#fff;font:700 ${Math.round(btn.h * 0.36)}px/${btn.h}px UI, sans-serif;text-align:center` }, card, 'Entrar');
    card._btn = btn;
    return card;
  }
  /** Fila de lista: insignia numerada, título y chevron. */
  function listRow(parent, i, w, h) {
    const r = uiCard(parent, w, h, { r: 14 });
    const d = Math.round(h * 0.62), n = String(i + 1).padStart(2, '0');
    el('div', { class: 'abs', style: `left:${h * 0.2}px;top:${(h - d) / 2}px;width:${d}px;height:${d}px;border-radius:50%;background:var(--tint);color:var(--accent);font:700 ${Math.round(d * 0.42)}px/${d}px UI, sans-serif;text-align:center` }, r, n);
    el('div', { class: 'abs', style: `left:${h * 0.2 + d + 26}px;top:0;height:${h}px;font:600 ${Math.max(30, Math.round(h * 0.31))}px/${h}px UI, sans-serif;color:var(--ink);white-space:nowrap` }, r, `Módulo ${n} · Tu tema aquí`);
    el('div', { class: 'abs', style: `left:${w - h * 0.62}px;top:0;height:${h}px;font:600 ${Math.round(h * 0.5)}px/${h}px UI, sans-serif;color:var(--ink-2)` }, r, '›');
    return r;
  }
  /** Tarjeta de sección de la plataforma: zona de icono dibujado, etiqueta y dos renglones. */
  const DELIV = ['Panel', 'Informes', 'Tareas', 'Pagos'];
  function delivCard(parent, i, w, h) {
    const c = uiCard(parent, w, h, { r: 18 });
    const ih = h * 0.52;
    const icon = el('div', { class: 'abs', style: `width:${w}px;height:${ih}px;background:var(--tint)` }, c);
    const s = Math.round(ih * 0.46), ix = (w - s) / 2, iy = (ih - s) / 2;
    const shapes = [
      `left:${ix}px;top:${iy}px;width:${s * 0.78}px;height:${s}px;border-radius:8px;background:var(--card);border:5px solid var(--accent);box-sizing:border-box`,
      `left:${ix}px;top:${iy}px;width:${s}px;height:${s}px;border-radius:10px;background:repeating-linear-gradient(180deg,var(--accent) 0 8px,transparent 8px 22px);opacity:.85`,
      `left:${ix}px;top:${iy}px;width:${s}px;height:${s}px;border-radius:50%;border:8px solid var(--accent);box-sizing:border-box`,
      `left:${ix}px;top:${iy}px;width:${s}px;height:${s * 0.74}px;border-radius:8px;background:var(--card);border:5px solid var(--accent);box-sizing:border-box`,
    ];
    el('div', { class: 'abs', style: shapes[i] }, icon);
    if (i === 2) el('div', { class: 'abs', style: `left:${ix + s * 0.3}px;top:${iy + s * 0.22}px;width:${s * 0.24}px;height:${s * 0.42}px;border-right:8px solid var(--accent);border-bottom:8px solid var(--accent);transform:rotate(40deg)` }, icon);
    if (i === 3) el('div', { class: 'abs', style: `left:${ix + s * 0.62}px;top:${iy + s * 0.5}px;width:${s * 0.34}px;height:${s * 0.34}px;border-radius:50%;background:var(--accent)` }, icon);
    const fs = Math.max(30, Math.round(w * 0.105));
    el('div', { class: 'abs', style: `left:${w * 0.09}px;top:${ih + h * 0.07}px;font:700 ${fs}px/1.1 UI, sans-serif;color:var(--head)` }, c, DELIV[i]);
    [0.7, 0.5].forEach((k, j) => el('div', { class: 'abs', style: `left:${w * 0.09}px;top:${ih + h * 0.07 + fs * 1.5 + j * 30}px;width:${w * k}px;height:16px;border-radius:8px;background:var(--tint-2)` }, c));
    return c;
  }
  /** Ilustración en canvas dentro del reproductor: trama + figuras que se mueven + rótulo. Dos "clips" con corte seco. */
  function drawClip(g, w, h, t, t0, which, ac, head) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = tok('--tint', '#e8f6f0'); g.fillRect(0, 0, w, h);
    g.strokeStyle = tok('--tint-2', '#cfeee1'); g.lineWidth = 22;
    for (let x = -h; x < w + h; x += 44) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); }
    const u = Math.max(0, t - t0), cx = w * 0.5, cy = h * 0.4;
    g.fillStyle = ac; g.strokeStyle = ac;
    if (which === 0) {
      // clip 1: un núcleo y tres satélites en órbita
      const R = h * 0.15;
      g.globalAlpha = 0.18; g.beginPath(); g.arc(cx, cy, R * 2.1, 0, Math.PI * 2); g.lineWidth = 6; g.stroke(); g.globalAlpha = 1;
      g.beginPath(); g.arc(cx, cy, R * (0.92 + 0.08 * Math.sin(u * 6)), 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 3; i++) {
        const a = u * 1.6 + i * (Math.PI * 2 / 3);
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 2.1, cy + Math.sin(a) * R * 2.1, R * 0.32, 0, Math.PI * 2); g.fill();
      }
    } else {
      // clip 2: barras que crecen
      const n = 5, bw = w * 0.08, gap = w * 0.04, x0 = cx - (n * bw + (n - 1) * gap) / 2, base = h * 0.66;
      for (let i = 0; i < n; i++) {
        const k = Math.min(1, Math.max(0, (u - i * 0.12) / 0.5)), e = 1 - Math.pow(1 - k, 3);
        const bh = h * (0.16 + 0.07 * i) * e;
        g.globalAlpha = 0.55 + 0.09 * i; g.fillRect(x0 + i * (bw + gap), base - bh, bw, bh);
      }
      g.globalAlpha = 1;
    }
    const fs = Math.round(h * 0.075);
    g.font = `700 ${fs}px UI, sans-serif`; g.textAlign = 'center'; g.fillStyle = head;
    g.fillText('TU CLIP AQUÍ', cx, h * 0.84);
    g.font = `600 ${Math.round(fs * 0.62)}px UI, sans-serif`; g.globalAlpha = 0.7;
    g.fillText(which === 0 ? 'Clip 1' : 'Clip 2', cx, h * 0.84 + fs * 0.95); g.globalAlpha = 1;
  }

  // ================================================================ 1 HOOK (b0 → b6)
  const HK = L({
    w: { rows: ['Así es', 'tu plataforma', 'por dentro.'], y: 170, size: 128, art: { x: 1010, y: 200, w: 790, h: 600 } },
    s: { rows: ['Así es', 'tu plataforma', 'por dentro.'], y: 80, size: 112, art: { x: 140, y: 560, w: 800, h: 600 } },
    t: { rows: ['Así es', 'tu plataforma', 'por dentro.'], y: 290, size: 116, art: { x: 81, y: 860, w: 918, h: 660 } },
  });
  scene({
    name: 'hook', from: 'hook', to: 'count',
    build(root, S) {
      S.D = bg(root, 0.9, 0.12);
      S.push = pushBox(root);
      S.lines = title(S.push, HK.rows, { y: HK.y, size: HK.size, accent: { 2: [0, 1] } });
      S.art = productArt(S.push, HK.art.w, HK.art.h);
      S.cu = cursor(root);
    },
    run(t, b, S) {
      dots(S.D, t, [0, 1.5, 4]);
      put(S.push, { s: 1 + 0.05 * seg(t, 0, 6) });
      const beats = [-0.4, -0.4, 'hook_w3'];
      S.lines.forEach((l, i) => rise(t, l, beats[i], null, { stagger: 0.08 }));
      const A = HK.art; cardIn(t, S.art, A.x, A.y, 'art', { dy: 220, preset: 'heavy' });
      const bt0 = S.art._btn, ax = A.x + bt0.x + bt0.w * 0.55, ay = A.y + bt0.y + bt0.h * 0.55;
      runCursor(t, S.cu, [[4.2, W * 0.92, H * 0.92], [5.0, ax, ay], ['enter', ax, ay]], 'enter');
    },
  });

  // ================================================================ 2 CONTEO (b6 → b12): 12 módulos, la lista cae y hace scroll
  const CT = L({
    w: { n: { x: 120, y: 110, size: 400 }, c: { x: 120, y: 560, size: 150 }, m: { x: 120, y: 780, size: 120 }, list: { x: 900, top: 70, bottom: 1092, w: 900, h: 104, gap: 14 }, scroll: 420 },
    s: { n: { x: 80, y: 95, size: 300 }, c: { x: 470, y: 230, size: 130 }, m: { x: 80, y: 450, size: 104 }, list: { x: 67, top: 640, bottom: 1110, w: 946, h: 104, gap: 14 }, scroll: 354 },
    t: { n: { x: 72, y: 310, size: 400 }, c: { x: 560, y: 550, size: 96 }, m: { x: 72, y: 850, size: 112 }, list: { x: 67, top: 1060, bottom: 1510, w: 946, h: 104, gap: 14 }, scroll: 354 },
  });
  const SEL = 4, NROWS = 12;
  /** Rectángulo de la fila elegida al final del conteo (con el micro-empuje de 1,04 aplicado): de aquí crece el reproductor. */
  function selRect() {
    const M = CT.list, pitch = M.h + M.gap, k = 1.04;
    const r = { x: M.x, y: M.top - CT.scroll + SEL * pitch, w: M.w, h: M.h };
    return { x: W / 2 + (r.x - W / 2) * k, y: H / 2 + (r.y - H / 2) * k, w: r.w * k, h: r.h * k };
  }
  scene({
    name: 'count', from: 'count', to: 'play', pre: PRE, cut: false,
    build(root, S) {
      S.D = panel(root, S, 0.12, 0.1, 'up');
      S.push = pushBox(root);
      S.n = line(S.push, '12', { x: CT.n.x, y: CT.n.y, size: CT.n.size, color: 'var(--head)' });
      S.c = line(S.push, 'módulos', { x: CT.c.x, y: CT.c.y, size: CT.c.size, color: 'var(--head)' });
      S.m = line(S.push, 'cuando quieras', { x: CT.m.x, y: CT.m.y, size: CT.m.size, color: 'var(--head)', accent: [1] });
      const M = CT.list;
      S.win = listWindow(S.push, M.top, M.bottom);
      S.rows = Array.from({ length: NROWS }, (_, i) => listRow(S.win.list, i, M.w, M.h));
      S.ring = ring(S.win.list, 18);
      S.cu = cursor(root);
    },
    run(t, b, S) {
      cover(t, S); dots(S.D, t, [6, 8, 9, 11]);
      push(t, S, 0.04);
      rise(t, S.n, 5.6, null, { preset: 'heavy' });
      counter(t, S.n.words[0], 12, 'count', 'count_land');
      rise(t, S.c, 7, null, { preset: 'heavy' });
      rise(t, S.m, 'mods', null, { stagger: 0.12 });
      const M = CT.list;
      const sc = cascade(t, S.win.list, S.rows, 6.2, { every: 0.25, gap: M.gap, x: M.x, scroll: CT.scroll, s0: 9.4, s1: 10.8 });
      const pitch = M.h + M.gap;
      runRing(t, S.ring, { x: 0, y: SEL * pitch, w: M.w, h: M.h }, 'sel', 8);
      const tx = M.x + M.w * 0.32, ty = M.top - sc + SEL * pitch + M.h * 0.55;
      runCursor(t, S.cu, [[10.3, W * 0.95, H * 0.9], [11.1, tx, ty], ['open', tx, ty]], 'open');
    },
  });

  // ================================================================ 3 DEMOSTRACIÓN (b12 → b16): el reproductor crece de la fila
  const VD = L({
    w: { rows: ['Un clic', 'y lo ves.'], acc: [1, 2], ty: 360, size: 150, p: { x: 880, y: 230, w: 930 } },
    s: { rows: ['Un clic y lo ves.'], acc: [0, 4], ty: 80, size: 104, p: { x: 40, y: 330, w: 1000 } },
    t: { rows: ['Un clic', 'y lo ves.'], acc: [1, 2], ty: 290, size: 150, p: { x: 40, y: 820, w: 1000 } },
  });
  scene({
    name: 'demo', from: 'play', to: 'grid',
    build(root, S) {
      S.D = bg(root, 0.85, 0.12, 9);
      S.push = pushBox(root);
      const p = VD.p, bh = Math.round(p.w * 0.056), vh = Math.round(p.w * 9 / 16);
      S.box = { bh, vh };
      S.player = uiCard(S.push, p.w, bh + vh, { r: 20 });
      windowBar(S.player, p.w, bh);
      S.cv = el('canvas', { width: p.w, height: vh, style: `top:${bh}px;width:${p.w}px;height:${vh}px` }, S.player);
      S.g = S.cv.getContext('2d');
      S.bar = reg(el('div', { class: 'abs', style: `left:0;top:${bh + vh - 8}px;height:8px;width:0;background:var(--accent)` }, S.player));
      S.ac = tok('--accent', '#0e9f6e'); S.head = tok('--head', '#0b3d33');
      const n = VD.rows.length;
      S.lines = title(S.push, VD.rows, { y: VD.ty, size: VD.size, accent: { [VD.acc[0]]: [VD.acc[1]] } });
    },
    run(t, b, S) {
      dots(S.D, t, [12, 14, 15]);
      push(t, S, 0.035);
      growFrom(t, S.player, selRect(), VD.p, 'play', { preset: 'default', hit: false });
      const clip = b < beatOf('clip2') ? 0 : 1;
      drawClip(S.g, VD.p.w, S.box.vh, t, clip ? bt('clip2') : bt('play'), clip, S.ac, S.head);
      put(S.bar, { css: { width: VD.p.w * seg(t, 'play', 'grid') + 'px' } });
      rises(t, S.lines, beatOf('why') - 0.2, 0.5, { stagger: 0.1 });
    },
  });

  // ================================================================ 4 SECCIONES (b16 → b20): 4 tarjetas caen, el cursor abre una
  const GR = L({
    w: { rows: ['Todo,', 'en un lugar.'], size: 120, ty: 360, g: { x0: 1100, y: 90, w: 330, gap: 30, cols: 2 } },
    s: { rows: ['Todo, en un lugar.'], size: 84, ty: 80, g: { x0: 229, y: 240, w: 300, gap: 22, cols: 2 } },
    t: { rows: ['Todo,', 'en un lugar.'], size: 100, ty: 290, g: { x0: 167, y: 590, w: 360, gap: 26, cols: 2 } },
  });
  scene({
    name: 'grid', from: 'grid', to: 'end', pre: PRE, cut: false,
    build(root, S) {
      S.D = panel(root, S, 0.15, 0.1, 'left');
      S.push = pushBox(root);
      const n = GR.rows.length;
      S.lines = title(S.push, GR.rows, { y: GR.ty, size: GR.size, accent: { [n - 1]: [n === 1 ? 3 : 2] } });
      S.cards = DELIV.map((_, i) => delivCard(S.push, i, GR.g.w, GR.g.w * 1.25));
      S.cu = cursor(root);
    },
    run(t, b, S) {
      cover(t, S); dots(S.D, t, [16, 17, 18, 19]);
      push(t, S, 0.04);
      rises(t, S.lines, 15.9, 0.5);
      const r = dropGrid(t, S.cards, ['grid', 'g2', 'g3', 'g4'], GR.g, { sel: 2, liftAt: 'dl' });
      const tx = r.x + r.w * 0.55, ty = r.y + r.h * 0.6;
      runCursor(t, S.cu, [[18.1, W * 0.96, H * 0.95], [18.8, tx, ty], ['dl', tx, ty]], 'dl');
    },
  });

  // ================================================================ 5 CIERRE (b20 → b26): lockup, verbo CTA, píldora, subfrase; late hasta el final
  const EN = L({
    w: { logo: { x: 120, y: 150 }, cta: { y: 330, size: 210 }, pill: { x: 120, y: 610, size: 150 }, sub: { x: 120, y: 880, size: 60 } },
    s: { logo: { x: 80, y: 120 }, cta: { y: 330, size: 190 }, pill: { x: 80, y: 590, size: 140 }, sub: { x: 80, y: 860, size: 58 } },
    t: { logo: { x: 72, y: 470 }, cta: { y: 730, size: 205 }, pill: { x: 72, y: 1000, size: 150 }, sub: { x: 72, y: 1310, size: 62 } },
  });
  scene({
    name: 'end', from: 'end', to: 'done', pre: PRE, cut: false,
    build(root, S) {
      S.D = panel(root, S, 0.5, 0.2, 'up');
      S.push = pushBox(root);
      const d = pick(88, 84, 96);
      S.logo = reg(el('div', { class: 'abs', style: `display:flex;align-items:center;gap:${d * 0.28}px;transform-origin:0 50%` }, S.push,
        `<div style="width:${d}px;height:${d}px;border-radius:${d * 0.28}px;background:var(--accent);position:relative"><div style="position:absolute;left:${d * 0.27}px;top:${d * 0.27}px;width:${d * 0.46}px;height:${d * 0.46}px;border-radius:50%;background:#fff"></div></div>` +
        `<div class="display" style="font-size:${d * 0.72}px;font-weight:700;color:var(--head);letter-spacing:-0.02em">TU LOGO</div>`), { o: 0 });
      S.cta = title(S.push, ['Pruébalo'], { y: EN.cta.y, size: EN.cta.size });
      const ps = EN.pill.size;
      S.pill = reg(el('div', { class: 'abs display', style: `font-size:${ps}px;line-height:1.05;padding:${ps * 0.1}px ${ps * 0.36}px ${ps * 0.16}px;border-radius:${ps}px;background:var(--accent);color:#fff;box-shadow:0 30px 60px -20px var(--shadow);transform-origin:0 50%` }, S.push, 'gratis'), { o: 0 });
      S.sub = reg(el('div', { class: 'abs', style: `font:600 ${EN.sub.size}px/1.2 UI, sans-serif;color:var(--ink-2);white-space:nowrap` }, S.push, 'Empieza hoy en @tumarca'), { o: 0 });
    },
    run(t, b, S) {
      cover(t, S); dots(S.D, t, [20, 21, 23, 24, 25]);
      push(t, S, 0.04);
      lockupHit(t, S.logo, EN.logo.x, EN.logo.y, 'end');
      rises(t, S.cta, 20.3, 0.5);
      ctaPill(t, S.pill, EN.pill.x, EN.pill.y, 'cta', [23, 24, 25]);
      const p = spHit(t, 'sub', 'snappy');
      put(S.sub, { x: EN.sub.x, y: EN.sub.y + 30 * (1 - p), o: show(p) });
    },
  });

  C.start();
})();
