// Fast pre-critic lint: reads the live DOM at 10 samples/s (no video render) and flags the problems critics keep
// finding. Run from the project root after each build pass, BEFORE rendering drafts for a critique round.
//
//   node scripts/lint.mjs [--fmt 9x16 | --all] [--step 0.1]
//
// Checks (per visible text element — any element with its own text, visible after opacity/visibility/mask clipping):
//   SIZE     effective font size (computed size × current scale) below the format minimum → unreadable on a phone.
//            Minimums (px at native resolution) default to { 9x16: 36, 4x5: 32, 1x1: 30, 16x9: 32 } (9:16 ≈ 12 px on a 360 px phone);
//            override in timeline.json "lint": { "minText": { "9x16": 40 }, "ignore": ["selector", ...] }.
//            Text inside an element with data-lint="ui" (e.g. a phone mockup's fine print) uses half the minimum.
//   SAFE     9:16 only: text inside the platform UI zones (top 14 %, bottom 20 %, right 12 %).
//   OVERLAP  two unrelated visible text boxes intersect → double exposure at a swap, or type colliding.
//   EDGE     text box crosses the frame edge (cropped type).
// Text hidden under something painted on top (elementFromPoint at the ink-box centre) is skipped.
// Output: grouped time ranges per issue, review/lint_<fmt>.json. Exit 1 if any SIZE/OVERLAP/EDGE issue lasts ≥ 3 samples.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
// STUDIO_KIT_NODE_PATH (set by Andoo): load playwright from the kit, never from the project folder.
const KIT_NM = process.env.STUDIO_KIT_NODE_PATH;
const require = createRequire(KIT_NM ? path.join(path.resolve(KIT_NM), '.studio-kit-resolver.cjs') : path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const TL = JSON.parse(fs.readFileSync('timeline.json', 'utf8'));
const LINT = TL.lint || {};
const MIN = { '9x16': 36, '4x5': 32, '1x1': 30, '16x9': 32, ...(LINT.minText || {}) };
const SIZES = { '16x9': [1920, 1080], '1x1': [1080, 1080], '4x5': [1080, 1350], '9x16': [1080, 1920] };
const FORMATS = argv.includes('--all') ? TL.formats : [opt('fmt', TL.formats[0])];
const STEP = +opt('step', 0.1);

// Only regular files whose REAL path (symlinks resolved) is inside realpath(ROOT) are served.
const ROOT_REAL = fs.realpathSync(ROOT);
function openInside(url) {
  let rel; try { rel = decodeURIComponent(String(url).split('?')[0]); } catch { return null; }
  if (rel.includes('\0')) return null;
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT + path.sep)) return null;
  let real; try { real = fs.realpathSync(f); } catch { return null; }
  if (!real.startsWith(ROOT_REAL + path.sep)) return null;
  let fd; try { fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch { return null; }
  let again = null; try { again = fs.realpathSync(f); } catch {}
  if (!fs.fstatSync(fd).isFile() || again !== real) { fs.closeSync(fd); return null; }
  return { fd, real };
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = http.createServer((q, r) => {
  const o = openInside(q.url);
  if (!o) { r.writeHead(404); return r.end(); }
  const type = MIME[path.extname(o.real).toLowerCase()];
  if (type) r.setHeader('Content-Type', type);
  fs.createReadStream(null, { fd: o.fd }).pipe(r);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// Network lockdown: the film page may only reach this script's own server (plus data:/blob:).
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const deadProxy = net.createServer((s) => s.destroy());
await new Promise((r) => deadProxy.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp'],
  proxy: { server: `http://127.0.0.1:${deadProxy.address().port}`, bypass: `<-loopback>,127.0.0.1:${server.address().port}` },
});
const sameOrigin = (u) => { if (u.startsWith('data:') || u.startsWith('blob:')) return true; try { return new URL(u).origin === ORIGIN; } catch { return false; } };
let bad = 0;

for (const fmt of FORMATS) {
  const [W, H] = SIZES[fmt];
  const page = await browser.newPage({ viewport: { width: W, height: H }, serviceWorkers: 'block' });
  await page.context().route('**/*', (route) => {
    const u = route.request().url();
    if (sameOrigin(u)) return route.continue().catch(() => {});
    console.log('[blocked]', u.slice(0, 120));
    return route.abort('blockedbyclient').catch(() => {});
  });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/film/index.html?fmt=${fmt}`);
  await page.waitForFunction(() => window.READY); await page.evaluate(() => window.READY);
  const DUR = await page.evaluate(() => window.DURATION);
  const hits = [];
  for (let t = 0; t < DUR; t += STEP) {
    const found = await page.evaluate(({ t, W, H, fmt, min, ignore }) => {
      window.seek(t);
      const stage = document.getElementById('stage').getBoundingClientRect(), k = stage.width / W;
      const rel = (r) => ({ x: (r.left - stage.left) / k, y: (r.top - stage.top) / k, w: r.width / k, h: r.height / k });
      const visible = (e) => {
        for (let n = e; n && n.id !== 'stage'; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false;
        }
        return true;
      };
      // visible fraction after every overflow:hidden ancestor (masks, cards, scenes)
      const shown = (e, r) => {
        let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
        for (let n = e.parentElement; n && n.id !== 'stage'; n = n.parentElement) {
          if (getComputedStyle(n).overflow !== 'visible') { const c = n.getBoundingClientRect(); x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom); }
        }
        return Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / Math.max(1, r.width * r.height);
      };
      const out = [], boxes = [];
      for (const e of document.querySelectorAll('#stage *')) {
        if (ignore.some((s) => e.matches(s))) continue;
        const own = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (!own || !visible(e)) continue;
        const rg = document.createRange(); rg.selectNodeContents(e);
        const r = rg.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;   // the ink box, not the element box
        if (shown(e, r) < 0.6) continue;                           // mid-rise inside a mask: judged when it lands
        // occluded by something painted on top (an incoming card, a sheet sliding over a UI)?
        const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        // captions are an overlay: they never hide type (a caption over a name must surface as OVERLAP)
        const top = document.elementsFromPoint(cx, cy).find((n) => !n.closest('[data-captions]'));
        if (!e.closest('[data-captions]') && top && !(e.contains(top) || top.contains(e))) continue;
        const s = getComputedStyle(e), eb = e.getBoundingClientRect(), scale = e.offsetWidth ? eb.width / e.offsetWidth : 1;
        const px = parseFloat(s.fontSize) * scale / k, b = rel(r);
        const label = (e.textContent.trim().slice(0, 28) || e.tagName);
        const lim = e.closest('[data-lint="ui"]') ? min / 2 : min;
        if (px < lim - 0.5) out.push({ kind: 'SIZE', what: `${label} ${px.toFixed(0)}px < ${lim}` });
        if (fmt === '9x16' && (b.y < H * 0.14 || b.y + b.h > H * 0.8 || b.x + b.w > W * 0.88)) out.push({ kind: 'SAFE', what: label });
        if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) out.push({ kind: 'EDGE', what: label });
        boxes.push({ e, b, label });
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        if (A.e.contains(B.e) || B.e.contains(A.e)) continue;
        const ix = Math.min(A.b.x + A.b.w, B.b.x + B.b.w) - Math.max(A.b.x, B.b.x), iy = Math.min(A.b.y + A.b.h, B.b.y + B.b.h) - Math.max(A.b.y, B.b.y);
        if (ix > 4 && iy > 4 && ix * iy > 0.15 * Math.min(A.b.w * A.b.h, B.b.w * B.b.h)) out.push({ kind: 'OVERLAP', what: `${A.label} × ${B.label}` });
      }
      return out;
    }, { t, W, H, fmt, min: MIN[fmt], ignore: LINT.ignore || [] });
    for (const f of found) hits.push({ t: +t.toFixed(2), ...f });
  }
  // group consecutive samples of the same issue into ranges
  const open = new Map(), list = [];
  for (const h of hits) {
    const key = h.kind + '|' + h.what.replace(/\d+px/, '');
    const g = open.get(key);
    if (g && h.t - g.t1 <= STEP * 1.5 + 1e-6) { g.t1 = h.t; g.n++; }
    else { const ng = { kind: h.kind, what: h.what, t0: h.t, t1: h.t, n: 1 }; open.set(key, ng); list.push(ng); }
  }
  list.sort((a, b) => a.t0 - b.t0);
  fs.mkdirSync('review', { recursive: true });
  fs.writeFileSync(`review/lint_${fmt}.json`, JSON.stringify(list, null, 1));
  const serious = list.filter((g) => g.kind !== 'SAFE' && g.n >= 3);
  bad += serious.length;
  console.log(`\n${fmt}: ${list.length} issue ranges (${serious.length} blocking)`);
  for (const g of list) console.log(`  ${g.kind.padEnd(7)} ${g.t0.toFixed(1)}–${g.t1.toFixed(1)}s  ${g.what}${g.kind !== 'SAFE' && g.n >= 3 ? '' : '   (minor)'}`);
  await page.close();
}
await browser.close(); server.close(); deadProxy.close();
if (bad) { console.log(`\nLINT: ${bad} blocking issue(s) — fix before rendering drafts for the critic`); process.exit(1); }
console.log('\nLINT: clean');
