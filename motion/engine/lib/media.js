// Real media for the film: stills with cover-crop + slow push, and footage as frame sequences on a canvas.
// Loads after core.js. Everything stays a pure function of t (images are awaited by READY before frame 0).
(() => {
  const C = window.C;

  /** A still that fills a box (object-fit: cover). Returns { wrap, im }; animate im with put(im, { s, x, y }).
   *  box {x,y,w,h} in stage px · pos = CSS object-position (aim at the face/subject) · origin = zoom anchor. */
  C.photo = (parent, src, box, pos = '50% 40%', origin = '50% 50%') => {
    const wrap = C.el('div', { class: 'abs', style: `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;overflow:hidden` }, parent);
    const im = C.el('img', { src, style: `position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;object-position:${pos};transform-origin:${origin}` }, wrap);
    C.reg(wrap); C.reg(im);
    return { wrap, im };
  };

  /** Frame sequence made by scripts/seq.py (assets/seq/<name>/NNN.jpg). bank = a hidden holder element.
   *  Returns an array of <img>; draw with C.drawSeq. */
  C.seq = (bank, name, n, base = '../assets/seq') =>
    Array.from({ length: n }, (_, i) => C.el('img', { src: `${base}/${name}/${String(i + 1).padStart(3, '0')}.jpg` }, bank));
  C.seqBank = (root) => C.el('div', { style: 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0' }, root);

  /** Draw the frame of `frames` that plays at time t (sequence starts at t0, fps 30, holds the last frame) into box,
   *  cover-cropped at anchor pos [0..1, 0..1], with zoom z. Optional clip = {x,y,w,h} reveal rectangle. */
  C.drawSeq = (g, frames, t, t0, box, { pos = [0.5, 0.5], z = 1, fps = 30, clip = null, filter = 'none' } = {}) => {
    const im = frames[C.clamp(Math.floor((t - t0) * fps), 0, frames.length - 1)];
    const iw = im.naturalWidth || 1, ih = im.naturalHeight || 1;
    const sc = Math.max(box.w / iw, box.h / ih) * z, dw = iw * sc, dh = ih * sc;
    g.save();
    const c = clip || box; g.beginPath(); g.rect(c.x, c.y, c.w, c.h); g.clip();
    g.filter = filter;
    g.drawImage(im, box.x + (box.w - dw) * pos[0], box.y + (box.h - dh) * pos[1], dw, dh);
    g.restore();
  };
})();
