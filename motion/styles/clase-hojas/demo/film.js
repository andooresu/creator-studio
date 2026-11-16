// DEMO del estilo «Clase en hojas» (9:16 primero; también re-bloquea a 16:9 con pick). Función pura del tiempo.
// Caso de ejemplo: la clase 1 de un curso de guion para video corto. Todo es de plantilla: textos de ejemplo, figuras dibujadas en canvas y marcadores «TU CLIP AQUÍ» / «TU LOGO».
// No hay voz: window.WORDS se arma con HOJAS.script() (tiempos simulados). En un proyecto real borra ese bloque:
// las palabras salen de la VO (vo.py → words.py → sync.mjs) y los anclajes wt('sN', 'palabra') siguen igual.
// Firma del estilo que muestra: portada → objetivo con cambio interno · hojas empujadas sobre el whoosh ·
// contenido que aterriza atenuado y se enciende en su palabra · segmentos que se oscurecen · figura que se dibuja ·
// clip que se abre tras máscara · tarjetas ✕ · puntos clave con barra que salta · cierre vivo · barra de progreso.
(() => {
  const { put, bt, pick } = C;
  const Hj = window.HOJAS;
  const { PAD, CW, wt, wx, hit, span, pulse, enter, lit, photoIn, ringFx, icon, num, ICONS, rowCard, icard, slot, panel, drawLayers, drawSteps, section, titlePage, summary, closing, progress } = Hj;
  C.fonts = ['800 100px Display', '700 100px Display', '500 40px UI', '600 40px UI', '700 40px UI'];

  // ------------------------------------------------------------------ guion de ejemplo (sustituye a la voz real)
  window.WORDS = {
    s1: Hj.script(0.25, 'Clase uno: cómo funciona un buen guion. Gancho, desarrollo y cierre. Al terminar, vas a escribir tu gancho y ordenar tus ideas.', 0.17),
    s2: Hj.script(4.95, 'Tres partes: un gancho que detiene, un desarrollo con una idea por escena y un cierre que invita.', 0.17),
    s3: Hj.script(9.1, 'Dos errores comunes: empezar presentándote y meter muchas ideas juntas.', 0.17),
    s4: Hj.script(11.5, 'En resumen: engancha primero, una idea por escena y hasta la siguiente clase.', 0.11),
  };
  const tall = C.FMT === '9x16';

  // =================================================================== 0 · PORTADA + OBJETIVO  (s1)
  const out = wx('s1', 'Al') - 0.45;                       // la portada se va a la izquierda justo antes de «Al terminar…»
  titlePage({
    to: 's2', eyebrow: ['1', 'Clase 1 · Curso de guion'], t1: 'Cómo funciona', t2: 'un buen guion.', acc: [4],
    chips: [['Gancho', wt('s1', 'gancho')], ['Desarrollo', wt('s1', 'desarrollo')], ['Cierre', wt('s1', 'cierre')]],
    fig: (root, o) => panel(root, pick(1080, PAD, PAD), pick(200, o.y, o.y), pick(700, CW, CW), pick(760, 380, 500)),
    figRun: (t, f, outAt) => drawLayers(f, [span(t, 0.0, 0.9), span(t, 0.5, 1.5), span(t, 1.0, 2.0)], ['El gancho', 'El desarrollo', 'El cierre'],
      hit(t, wt('s1', 'cierre') - 0.2, 'snappy') > 0.5 ? 1 : -1),
    out,
    goal: [
      [[['Escribir ', 's1', 'escribir'], ['tu gancho', 's1', 'tu']], wt('s1', 'escribir')],
      [[['Ordenar ', 's1', 'ordenar'], ['tus ideas', 's1', 'ideas']], wt('s1', 'ordenar')],
    ],
  });

  // =================================================================== 1 · LAS TRES PARTES  (s2)
  section({
    name: 'partes', from: 's2', to: 's3', push: 0.015, eyebrow: ['01', 'La estructura'], title: 'Tres partes', acc: [1],
    titleAt: wt('s2', 'tres') - 0.1,
    build(root, S) {
      const rows = [
        ['El gancho', [['Detiene el dedo', 's2', 'detiene']]],
        ['El desarrollo', [['Una idea por escena', 's2', 'escena']]],
        ['El cierre', [['Dice qué hacer después', 's2', 'invita']]],
      ];
      if (tall) {
        S.clip = slot(root, PAD, S.top, CW, 440, 'TU CLIP AQUÍ', 'Un ejemplo de la clase');
        S.r = rows.map(([ti, sub], i) => rowCard(root, S.top + 480 + i * 190, num(i + 1, 72), ti, sub, 170));
      } else {
        S.clip = slot(root, PAD, S.top, 620, 680, 'TU CLIP AQUÍ', 'Un ejemplo de la clase');
        S.r = rows.map(([ti, sub], i) => rowCard(root, S.top + 20 + i * 220, num(i + 1, 64), ti, sub, 190, 940, 840));
      }
    },
    run(t, S, l0) {
      photoIn(t, S.clip, l0 + 0.1);
      ringFx(t, S.clip, wt('s2', 'tres') - 0.1, 0.02);
      ['gancho', 'desarrollo', 'cierre'].forEach((w, i) => { enter(t, S.r[i], l0 + 0.2 + i * 0.08, { dx: -24, dy: 0, preset: 'snappy' }); lit(t, S.r[i], wt('s2', w) - 0.2); });
    },
  });

  // =================================================================== 2 · ERRORES FRECUENTES  (s3)
  section({
    name: 'errores', from: 's3', to: 's4', push: 0.025, eyebrow: ['02', 'Errores frecuentes'],
    title: tall ? ['Dos errores', 'comunes'] : 'Dos errores comunes', acc: [0, 1], titleAt: wt('s3', 'dos') - 0.1,
    build(root, S) {
      const E = [['Empezar presentándote', [['Abre con lo que importa', 's3', 'present']]],
        ['Meter muchas ideas', [['Una por escena, siempre', 's3', 'juntas']]]];
      S.cards = E.map(([ti, sub], i) => tall
        ? icard(root, PAD, S.top + i * 450, CW, 410, ICONS.CROSS, 'var(--bad)', ti, sub, 60)
        : icard(root, PAD + i * 840, S.top + 40, 800, 420, ICONS.CROSS, 'var(--bad)', ti, sub, 56));
    },
    run(t, S, l0) {
      ['empezar', 'meter'].forEach((w, i) => { enter(t, S.cards[i], l0 + i * 0.12, { dy: 60, s0: 0.95 }); lit(t, S.cards[i], wt('s3', w) - 0.15); });
    },
  });

  // =================================================================== 3 · PUNTOS CLAVE  (s4)
  summary({
    from: 's4', to: 'endcard', eyebrow: ['03', 'Puntos clave'], title: 'En resumen',
    rows: [[['Engancha primero', 's4', 'engancha']], [['Una idea por escena', 's4', 'idea']]],
    at: [wt('s4', 'engancha'), wt('s4', 'idea')],
    cta: ['Hasta la clase 2', wt('s4', 'hasta')],
  });

  // =================================================================== 4 · CIERRE  (endcard → done)
  closing({ from: 'endcard', to: 'done', n: '2', label: 'Siguiente clase', title: 'Cómo escribir<br>tu gancho', mod: 'Módulo 1 · Guion' });

  progress('done');
  C.start();
})();
