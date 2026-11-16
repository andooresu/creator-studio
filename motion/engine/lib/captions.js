// Burned-in captions from the placed voiceover (window.VO, written by vo.py / words.py → sync.mjs).
// Most feeds autoplay muted, so a VO-led reel needs its words on screen. Pure function of t; loads after core.js.
//
// timeline.json:
//   "captions": { "formats": ["9x16"], "style": "karaoke", "y": 0.70, ... }
//
// STYLES
//   pill     phrase chunks on a dark pill (default; needs only vo_placed.json)
//   karaoke  3–4 word chunk appears at once; the spoken word lights up in the accent colour with a small bump
//   pop      words pop in one by one as they are spoken (spring with overshoot); the spoken word is accent
//   box      chunk appears; an accent box slides behind the spoken word, which turns dark
//   word     one big word at a time, popping on the voice; keywords bigger
// The four word styles need word stamps: `.venv/bin/python scripts/words.py` then `node scripts/sync.mjs`.
// Without them they fall back to times split by character share (readable, but not on the syllable).
//
// OPTIONS (all optional)
//   y          caption centre as a fraction of H. 9:16 keeps y ≤ 0.74 (bottom 20 % is platform UI)
//   yFmt       { "4x5": 0.86 } per-format y
//   yAt        [{ from, to, y }] move the captions for a stretch (seconds) to clear on-screen type
//   skip       phrases already shown as on-screen type (never caption the same words twice); a VO phrase
//              can also carry "caption": false
//   font       CSS family (load it in the project like any font; add '800 80px Family' to C.fonts). Default
//              'Display, UI, Arial'
//   weight 800 · size (px; default by style and format) · upper true (word styles) · color '#fff'
//   accent     spoken word / keyword colour, default '#FFD43B'. Use the brand accent when it reads on footage
//   boxText    word colour inside the box (box style), default '#111'
//   stroke     outline px (default size × 0.09 for word styles) · strokeColor '#000'
//   shadow     CSS text-shadow, default '0 4px 18px rgba(0,0,0,.45)'
//   maxWords / maxChars   chunk size (karaoke 4/22, pop 3/18, box 3/18, word 1; pill uses maxChars 34)
//   keywords   ["roas", "gratis"] → accent + kScale (also *marked* in the vo.json text; numbers automatic)
//   autoKeywords true · kScale 1.18 (box 1.12, word 1.35)
//   emoji      { "dinero": "💰", "rápido": "⚡" } → pops above the chunk when that word is spoken
//   upcoming   'show' | 'dim' | 'hide' — words not yet spoken (karaoke/box default 'show', pop/word 'hide')
//   punct      false → drop , . ; : … from word styles (default false)
// COMPOSABLE KNOBS (word styles; each style above is just defaults for these)
//   enter      chunk entrance: 'rise' | 'pop' | 'none'
//   wordIn     each word when spoken: 'pop' | 'rise' | 'fade' | 'none'
//   highlight  spoken word: 'color' | 'box' | 'underline' | 'none' · bump 0.1 = scale bump on the spoken word
//   pastColor  colour of words already spoken (default color) · boxColor (default accent) · boxRadius
//   bg         background behind the whole chunk, e.g. 'rgba(0,0,0,.7)' or '#fff' · bgRadius · bgPadX · bgPadY (× size)
//   fontFile   'Montserrat-ExtraBold.ttf' from assets/fonts/captions/ (copied by init.sh from <skill>/captions/fonts)
//   tilt       degrees, alternating ± per chunk · lineHeight 1.12 · letterSpacing '-.01em' · wordGap 0.13 (× size)
// PRESETS: "captions": { "preset": "karaoke-amarillo", ...overrides } — named looks in film/lib/caption_presets.json
//   (sync.mjs merges preset + overrides into window.TL). Catalog and how to learn new ones: reference/CAPTIONS.md.
// Long phrases are split into chunks; chunks never end on a function word and never straddle a hard cut.
// Run lint.mjs: captions must not overlap the film's own type (OVERLAP) — move the type or use yAt.
(() => {
  const C = window.C, TL = window.TL || {}, CFG = TL.captions;
  if (!CFG || !(CFG.formats || []).includes(C.FMT)) return;
  const { step } = window.Motion;
  const STYLE = CFG.style || 'pill';
  const unstar = (s) => s.replace(/\*/g, '');
  const VO = (window.VO || []).map((p) => ({ t0: p.t0 ?? p.t, t1: p.t1 ?? p.end, text: unstar(p.text || ''), raw: p.text || '', words: p.words, off: p.caption === false }))
    .filter((p) => p.text && !p.off && !(CFG.skip || []).map(unstar).includes(p.text) && p.t1 > p.t0);
  const cutsOf = () => window.CUTS || [];
  const Y0 = (CFG.yFmt || {})[C.FMT] || CFG.y || (STYLE === 'pill' ? 0.72 : 0.70);
  const yShift = (t) => { const ov = (CFG.yAt || []).find((z) => t >= z.from && t < z.to); return ov ? (ov.y - Y0) * C.H : 0; };

  // ---------------------------------------------------------------- pill: phrase chunks on a dark pill
  if (STYLE === 'pill') {
    const MAXC = CFG.maxChars || 34;
    const chunks = [];
    for (const p of VO) {
      // split on clause punctuation first (never "… que conocen tu" / "rostro."), then balance long clauses by length
      const clauses = p.text.split(/(?<=[,.:;?!])\s+/), parts = [];
      for (const cl of clauses) {
        const words = cl.split(/\s+/), n = Math.ceil(cl.length / MAXC), target = cl.length / n;
        let cur = '', k = 0;
        for (const w of words) {
          // never end a chunk on a function word ("de", "a", "con", "y", "el", …)
          const weak = /\b(de|del|a|al|con|y|e|o|el|la|los|las|en|por|tu|un|una|que|sin)$/i.test(cur);
          if (cur && !weak && k < n - 1 && (cur.length + 1 + w.length / 2) > target) { parts.push(cur); cur = w; k++; }
          else cur = cur ? cur + ' ' + w : w;
        }
        if (cur) parts.push(cur);
      }
      // merge tiny fragments into the previous chunk when it still fits
      for (let i = parts.length - 1; i > 0; i--) if (parts[i].length < 8 && parts[i - 1].length + parts[i].length < MAXC + 6) { parts[i - 1] += ' ' + parts[i]; parts.splice(i, 1); }
      const total = parts.reduce((s, x) => s + x.length, 0); let acc = 0;
      for (const x of parts) { const a = p.t0 + (p.t1 - p.t0) * acc / total; acc += x.length; chunks.push({ t0: a, t1: p.t0 + (p.t1 - p.t0) * acc / total, text: x }); }
    }
    const size = CFG.size || C.pick(40, 40, 46), cy = C.H * Y0;
    const box = C.el('div', { class: 'abs', 'data-captions': '1', style: `z-index:50;left:0;top:${cy - size}px;width:${C.W}px;text-align:center;pointer-events:none` }, C.stage);
    const pill = C.el('span', { style: `display:inline-block;max-width:${C.W * 0.84}px;padding:${size * 0.28}px ${size * 0.6}px;border-radius:${size * 0.5}px;
      background:rgba(10,9,8,.62);color:${CFG.color || '#fff'};font:${CFG.weight || 600} ${size}px ${CFG.font || 'UI, Arial, sans-serif'};letter-spacing:.01em;line-height:1.2` }, box);
    C.reg(box, { o: 0 }); C.reg(pill);
    C.hooks.before.push((t) => {
      const c = chunks.find((k) => {
        let a = k.t0 - 0.04, z = k.t1 + 0.12;
        for (const x of cutsOf()) { if (x > a && x - a < 0.45) a = x; else if (x > a && x < z) z = Math.min(z, x); }   // never across a cut
        return t >= a && t < z;
      });
      if (!c) return C.put(box, { o: 0 });
      let a0 = c.t0 - 0.04; for (const x of cutsOf()) if (x > a0 && x - a0 < 0.45) a0 = x;
      const k = C.clamp((t - a0) / 0.12);                   // quick rise, no fade
      C.put(box, { o: 1, y: 10 * (1 - k) + yShift(t) });
      C.put(pill, { text: c.text });
    });
    return;
  }

  // ---------------------------------------------------------------- word styles = presets of composable knobs
  // A style is only a set of defaults for the knobs below; any knob can be overridden in timeline.captions or in a
  // named preset (caption_presets.json, merged by sync.mjs). New formats learned from references are new knob
  // combinations first; add a knob here only when no combination can express the reference (reference/CAPTIONS.md).
  const DEF = {
    karaoke: { maxWords: 4, maxChars: 22, size: C.pick(64, 64, 74), upcoming: 'show', enter: 'rise', wordIn: 'none', highlight: 'color', bump: 0.1, kScale: 1.18 },
    pop:     { maxWords: 3, maxChars: 18, size: C.pick(70, 70, 84), upcoming: 'hide', enter: 'none', wordIn: 'pop', highlight: 'color', bump: 0, kScale: 1.18 },
    box:     { maxWords: 3, maxChars: 18, size: C.pick(66, 66, 78), upcoming: 'show', enter: 'rise', wordIn: 'none', highlight: 'box', bump: 0, kScale: 1.12 },
    word:    { maxWords: 1, maxChars: 99, size: C.pick(110, 110, 132), upcoming: 'hide', enter: 'none', wordIn: 'pop', highlight: 'none', bump: 0, kScale: 1.35 },
  }[STYLE];
  if (!DEF) throw new Error(`captions: unknown style "${STYLE}" (pill | karaoke | pop | box | word)`);
  const O = { upper: true, color: '#fff', accent: '#FFD43B', boxText: '#111', strokeColor: '#000', weight: 800,
    font: 'Display, UI, Arial, sans-serif', shadow: '0 4px 18px rgba(0,0,0,.45)', autoKeywords: true, punct: false,
    lineHeight: 1.12, letterSpacing: '-.01em', wordGap: 0.13, tilt: 0, bg: null, ...DEF, ...CFG };
  O.stroke = CFG.stroke ?? Math.round(O.size * 0.09);
  O.pastColor = CFG.pastColor || O.color;
  O.boxColor = CFG.boxColor || O.accent;
  // fontFile: a TTF/OTF in assets/fonts/captions/ (init.sh copies the skill's caption fonts there) → its own face
  if (O.fontFile) {
    const fam = 'Cap_' + O.fontFile.replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9]/g, '');
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `@font-face{font-family:'${fam}';src:url(../assets/fonts/captions/${O.fontFile});font-weight:100 900;}` }));
    O.font = `'${fam}', ${O.font}`;
    (C.extraFonts = C.extraFonts || []).push(`${O.weight} ${O.size}px '${fam}'`);
  }
  const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%$]/g, '');
  const WEAK = /^(de|del|a|al|con|y|e|o|el|la|los|las|en|por|para|tu|tus|mi|un|una|que|sin|se|lo|le|su|sus|the|an|of|to|and|in|on|for|with|your)$/;
  const KEYS = new Set((O.keywords || []).map(norm));
  const EMOJI = Object.fromEntries(Object.entries(O.emoji || {}).map(([k, v]) => [norm(k), v]));
  const POP = { response: 0.3, damping: 0.52 };       // ~15 % overshoot: caption pops only, never layout
  const BUMP = 'snappy';

  // 1. timed words (word stamps from words.py, else split each phrase by character share)
  const W = [];
  VO.forEach((p, pi) => {
    const raw = p.raw.split(/\s+/).filter(Boolean);
    let list = p.words && p.words.length ? p.words.map((w, i) => ({ ...w, star: !!(raw[i] && raw[i].includes('*')) })) : null;
    if (!list) {
      const L = raw.map((w) => Math.max(1, unstar(w).length)), tot = L.reduce((s, x) => s + x, 0); let acc = 0;
      list = raw.map((w, i) => { const a = p.t0 + (p.t1 - p.t0) * acc / tot; acc += L[i]; return { w: unstar(w), t0: a, t1: p.t0 + (p.t1 - p.t0) * acc / tot, star: w.includes('*') }; });
    }
    for (const w of list) {
      let d = O.punct ? w.w : w.w.replace(/[.,;:…]+$/, '').replace(/^[«"“]|[»"”]$/g, '');
      if (!d) continue;
      if (O.upper) d = d.toLocaleUpperCase('es');
      const n = norm(w.w);
      // a lone symbol token ("80 %", "¡ !") belongs to the previous word: never a chunk of its own
      if (/^[%$€¡!¿?»”)]+$/.test(d) && W.length && W[W.length - 1].ph === pi) {
        const q = W[W.length - 1]; q.d += (d === '%' ? '\u202f' : '') + d; q.t1 = w.t1; q.end = q.end || /[.!?…]$/.test(w.w); continue;
      }
      W.push({ d, t0: w.t0, t1: w.t1, ph: pi, end: /[.!?…;:]["»”]?$/.test(w.w), comma: /,$/.test(w.w), weak: WEAK.test(n),
        k: !!(w.k || w.star || KEYS.has(n) || (O.autoKeywords && /\d/.test(n))), emoji: EMOJI[n] });
    }
  });

  // 2. chunks: break on phrase ends, sentence ends, pauses, cuts and size; never end on a function word
  const cutIn = (a, b) => cutsOf().some((x) => x > a && x <= b);
  const chunks = [];
  W.forEach((w, i) => {
    const prev = W[i - 1], cur = chunks[chunks.length - 1];
    const chars = cur ? cur.words.reduce((s, x) => s + x.d.length + 1, 0) + w.d.length : 0;
    const hard = !cur || w.ph !== prev.ph || prev.end || w.t0 - prev.t1 > 0.35 || cutIn(prev.t0, w.t0 + 0.08);
    const soft = cur && (cur.words.length >= O.maxWords || chars > O.maxChars || (prev.comma && cur.words.length > 1));
    if (hard) chunks.push({ words: [w] });
    else if (soft && prev.weak && cur.words.length > 1) chunks.push({ words: [cur.words.pop(), w] });   // carry "de/el/al…" forward
    else if (soft && !prev.weak) chunks.push({ words: [w] });
    else cur.words.push(w);
  });
  chunks.forEach((c, i) => {
    let a = c.words[0].t0 - 0.06;
    for (const x of cutsOf()) if (x > a && x < c.words[0].t0 + 0.1) a = x;      // wait for a cut right after the start
    const last = c.words[c.words.length - 1], nxt = chunks[i + 1];
    let z = last.t1 + 0.3;
    if (nxt) z = Math.min(z, nxt.words[0].t0 - 0.06);
    for (const x of cutsOf()) if (x > last.t0 && x < z) z = x;                   // stop on a cut
    c.a = a; c.z = Math.max(z, last.t0 + 0.12);
    c.tilt = O.tilt ? (i % 2 ? -1 : 1) * O.tilt : 0;
  });

  // 3. DOM: one line per chunk, built once (lint sees the real layout)
  const cy = C.H * Y0;
  const root = C.el('div', { class: 'abs', 'data-captions': '1', style: `z-index:50;left:0;top:0;width:${C.W}px;height:${C.H}px;pointer-events:none` }, C.stage);
  const font = `${O.weight} ${O.size}px ${O.font}`;
  const bgCss = O.bg ? `background:${O.bg};border-radius:${O.bgRadius ?? O.size * 0.28}px;padding:${O.size * (O.bgPadY ?? 0.18)}px ${O.size * (O.bgPadX ?? 0.3)}px;` : '';
  for (const c of chunks) {
    const wrap = C.el('div', { class: 'abs', style: `left:0;top:${cy}px;width:${C.W}px;text-align:center;transform:translateY(-50%)` }, root);
    c.line = C.el('div', { style: `display:inline-block;position:relative;max-width:${C.W * 0.86}px;font:${font};line-height:${O.lineHeight};letter-spacing:${O.letterSpacing};
      color:${O.color};-webkit-text-stroke:${O.stroke}px ${O.strokeColor};paint-order:stroke fill;text-shadow:${O.shadow};white-space:normal;${bgCss}` }, wrap);
    if (O.highlight === 'box' || O.highlight === 'underline') {
      c.box = C.el('div', { style: `position:absolute;left:0;top:0;z-index:0;border-radius:${O.highlight === 'box' ? O.boxRadius ?? O.size * 0.18 : O.size * 0.05}px;background:${O.boxColor};transform-origin:50% 50%` }, c.line);
      C.reg(c.box, { o: 0 });
    }
    c.spans = c.words.map((w) => {
      const s = C.el('span', { style: `display:inline-block;position:relative;z-index:1;margin:0 ${O.size * O.wordGap}px;padding:0 ${O.size * 0.08}px;transform-origin:50% 70%;vertical-align:middle;${w.k ? `color:${O.accent};font-size:${O.size * O.kScale}px;` : ''}` }, c.line);
      s.textContent = w.d;
      return C.reg(s);
    });
    const emo = c.words.find((w) => w.emoji);
    if (emo) {
      c.emoji = C.el('div', { style: `position:absolute;left:50%;bottom:100%;margin-left:-${O.size * 0.6}px;width:${O.size * 1.2}px;text-align:center;font:${O.size * 1.1}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji';-webkit-text-stroke:0;text-shadow:none` }, c.line, emo.emoji);
      c.emojiAt = emo.t0; C.reg(c.emoji, { o: 0 });
    }
    C.reg(c.line, { o: 0 });
  }

  // 4. per frame
  C.hooks.before.push((t) => {
    const c = chunks.find((k) => t >= k.a && t < k.z);
    if (!c) return;
    const enter = step(t - c.a, O.enter === 'pop' ? POP : BUMP);
    const lp = { o: 1, y: yShift(t), r: c.tilt };
    if (O.enter === 'rise') { lp.y += 14 * (1 - enter); lp.s = 0.94 + 0.06 * enter; }
    else if (O.enter === 'pop') lp.s = 0.6 + 0.4 * enter;
    C.put(c.line, lp);
    let active = -1;
    c.words.forEach((w, j) => { if (t >= w.t0 - 0.03) active = j; });
    // box/underline: the dark text follows the box, switching words half-way through its slide
    const boxK = c.box && active >= 0 ? step(t - (c.words[active].t0 - 0.03), BUMP) : 1;
    const inBox = c.box && O.highlight === 'box' ? (active > 0 && boxK < 0.5 ? active - 1 : active) : -1;
    c.words.forEach((w, j) => {
      const on = t >= w.t0 - 0.03, isAct = j === active;   // keywords are bigger by font-size (layout-aware)
      const p = {};
      if (!on && O.upcoming === 'hide') p.o = 0;
      else if (!on && O.upcoming === 'dim') p.o = 0.45;
      let s = 1, y = 0, o = p.o;
      if (on && O.wordIn !== 'none') {
        const k = step(t - (w.t0 - 0.05), O.wordIn === 'pop' ? POP : BUMP);
        if (O.wordIn === 'pop') { s = 0.45 + 0.55 * k; y = O.size * 0.22 * (1 - Math.min(1, k)); }
        else if (O.wordIn === 'rise') y = O.size * 0.35 * (1 - k);
        else if (O.wordIn === 'fade') o = Math.min(1, k);
      }
      if (O.bump) {
        const nextT = c.words[j + 1] ? c.words[j + 1].t0 - 0.03 : c.z;
        s *= 1 + O.bump * (step(t - (w.t0 - 0.03), BUMP) - step(t - nextT, BUMP));
      }
      if (s !== 1) p.s = s;
      if (y) p.y = y;
      if (o != null) p.o = o;
      if (on) {
        const boxed = j === inBox;
        const col = boxed ? O.boxText : w.k ? O.accent : isAct && O.highlight === 'color' ? O.accent : O.pastColor;
        p.css = boxed ? { color: col, webkitTextStroke: '0px transparent', textShadow: 'none' } : { color: col };
      }
      C.put(c.spans[j], p);
    });
    if (c.box && active >= 0) {
      // the box springs from the previous word's rect to the spoken word's rect (layout offsets ignore transforms)
      const r = (j) => { const e = c.spans[j]; return { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }; };
      const b = r(active), a = active > 0 ? r(active - 1) : b;
      const lerp = (u, v) => u + (v - u) * boxK;
      const grow = active === 0 ? step(t - (c.words[0].t0 - 0.06), POP) : 1;
      const pad = O.size * 0.04;
      const bx = { o: 1, x: lerp(a.x, b.x) - pad, s: grow };
      if (O.highlight === 'box') Object.assign(bx, { y: lerp(a.y, b.y) + O.size * 0.04, css: { width: `${lerp(a.w, b.w) + 2 * pad}px`, height: `${lerp(a.h, b.h) - O.size * 0.06}px` } });
      else Object.assign(bx, { y: lerp(a.y + a.h, b.y + b.h) - O.size * 0.06, css: { width: `${lerp(a.w, b.w) + 2 * pad}px`, height: `${O.size * 0.11}px` } });
      C.put(c.box, bx);
    }
    if (c.emoji && t >= c.emojiAt - 0.05) {
      const k = step(t - (c.emojiAt - 0.05), POP);
      C.put(c.emoji, { o: 1, s: 0.3 + 0.7 * k, r: -12 * (1 - k), y: O.size * 0.3 * (1 - Math.min(1, k)) });
    }
  });
})();
