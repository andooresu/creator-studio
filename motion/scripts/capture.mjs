// Capture a product site's real brand material. Run from the project root.
//   node scripts/capture.mjs https://example.com [--sections "Pricing,Built for teams,Get started"]
// Writes:
//   assets/site/hero.png, full.png (2x)      what the site looks like
//   assets/site/info.json                    title, description, font families in use (by element count), @font-face
//                                            sources, text/bg colours by frequency, :root CSS variables, headings with
//                                            family/size/weight, images, videos, og:image, favicons, header SVGs
//   assets/fonts/<family>-<weight>[-italic].<ext>   every @font-face file the site serves (the real faces)
//   assets/brand/logo_<n>.svg, og.<ext>, favicon_<n>.<ext>
//   assets/cap/<slug>.png (3x)               with --sections: the smallest block ≥ 500 px wide containing each text
// Use real UI and real assets. Never redraw product UI that exists on the site.
//
// Network guard (SSRF): every request the browser makes (navigation, subresources, redirects, websockets) goes through a
// small filtering proxy in this process that resolves the host itself and refuses loopback, private, link-local, CGNAT,
// multicast/reserved and cloud-metadata addresses, then connects to the vetted IP (no DNS-rebinding window). A
// context.route() check does the same on top, and the downloads below (fonts, og:image, favicons) use the same pinned
// lookup and re-check every redirect hop.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
// STUDIO_KIT_NODE_PATH (set by Andoo): load playwright from the kit, never from the project folder.
const KIT_NM = process.env.STUDIO_KIT_NODE_PATH;
const require = createRequire(KIT_NM ? path.join(path.resolve(KIT_NM), '.studio-kit-resolver.cjs') : path.join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

// ------------------------------------------------------------------ SSRF guard
// Separate lists: Node matches IPv4 addresses against an IPv6 ::ffff:0:0/96 rule, which would block every IPv4.
const BL4 = new net.BlockList(), BL6 = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BL4.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) BL6.addSubnet(a, p, 'ipv6');
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$|^metadata(\.google\.internal)?$/i;
/** true if the address must never be fetched (loopback, private, link-local, CGNAT, metadata, reserved…). */
function blockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return BL4.check(ip, 'ipv4');
  if (v !== 6) return true;
  const m = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip); // IPv4-mapped
  if (m) {
    const v4 = m[1] || [parseInt(m[2], 16) >> 8, parseInt(m[2], 16) & 255, parseInt(m[3], 16) >> 8, parseInt(m[3], 16) & 255].join('.');
    return BL4.check(v4, 'ipv4');
  }
  return BL6.check(ip, 'ipv6');
}
const bare = (h) => String(h || '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
const blockedErr = (host, why) => Object.assign(new Error(`destino bloqueado (red local o interna): ${host}${why ? ` → ${why}` : ''}`), { code: 'EBLOCKED' });
/** dns.lookup replacement for http(s)/net: resolves every address and fails if ANY is internal (the result is what gets connected). */
function safeLookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  const h = bare(host);
  if (!h || BLOCKED_NAMES.test(h)) return process.nextTick(cb, blockedErr(h));
  dns.lookup(h, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => blockedIp(a.address));
    if (bad || !addrs.length) return cb(blockedErr(h, bad?.address));
    if (opts && opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}
const resolveSafe = (host) => new Promise((ok, ko) => {
  const h = bare(host);
  if (net.isIP(h)) return blockedIp(h) ? ko(blockedErr(h)) : ok({ address: h, family: net.isIP(h) });
  safeLookup(h, {}, (e, address, family) => (e ? ko(e) : ok({ address, family })));
});
const verdicts = new Map();
/** Is this URL safe to fetch? data:/blob:/about: yes; http(s) only if the host resolves to public addresses only. */
function urlAllowed(u) {
  let x; try { x = new URL(u); } catch { return Promise.resolve(false); }
  if (['data:', 'blob:', 'about:'].includes(x.protocol)) return Promise.resolve(true);
  if (!['http:', 'https:'].includes(x.protocol)) return Promise.resolve(false);
  const h = bare(x.hostname);
  if (!verdicts.has(h)) verdicts.set(h, resolveSafe(h).then(() => true, () => false));
  return verdicts.get(h);
}

// Filtering forward proxy: Chromium sends everything here (loopback included), we vet and pin the IP.
const HOP = ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade'];
const proxy = http.createServer((req, res) => {
  let x; try { x = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
  if (x.protocol !== 'http:') { res.writeHead(403); return res.end(); }
  const h = bare(x.hostname);
  if (net.isIP(h) && blockedIp(h)) { console.log('blocked:', req.url.slice(0, 120)); res.writeHead(403); return res.end(); }
  const headers = { ...req.headers }; for (const k of HOP) delete headers[k];
  const up = http.request({ host: h, port: x.port || 80, path: x.pathname + x.search, method: req.method, headers, lookup: safeLookup }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers); r.pipe(res);
  });
  up.on('error', (e) => { if (e.code === 'EBLOCKED') console.log('blocked:', req.url.slice(0, 120)); if (!res.headersSent) res.writeHead(e.code === 'EBLOCKED' ? 403 : 502); res.end(); });
  req.pipe(up);
});
proxy.on('connect', (req, sock, head) => {
  sock.on('error', () => {});
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url || '');
  if (!m) return sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  resolveSafe(m[1]).then(({ address }) => {
    const up = net.connect(+m[2], address, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('close', () => up.destroy());
  }, () => { console.log('blocked:', req.url); sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
proxy.unref();

const url = process.argv[2];
if (!url || url.startsWith('--')) { console.error('usage: node scripts/capture.mjs <url> [--sections "a,b"]'); process.exit(1); }
if (!(await urlAllowed(url))) { console.error(`No se captura ${url}: solo se permiten URLs http/https públicas (no localhost, redes privadas ni direcciones internas).`); process.exit(2); }
const si = process.argv.indexOf('--sections');
const sections = si > 0 ? process.argv[si + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
for (const d of ['assets/site', 'assets/fonts', 'assets/brand', 'assets/cap']) fs.mkdirSync(d, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const browser = await chromium.launch({
  proxy: { server: `http://127.0.0.1:${proxy.address().port}`, bypass: '<-loopback>' },
  args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'],
});
/** Every request of the context (navigation, redirects, subresources) is re-checked; internal destinations are aborted. */
const guard = async (c) => {
  await c.route('**/*', async (route) => {
    const u = route.request().url();
    if (await urlAllowed(u)) return route.continue().catch(() => {});
    console.log('blocked:', u.slice(0, 120));
    return route.abort('blockedbyclient').catch(() => {});
  });
};
const newCtx = async (o) => { const c = await browser.newContext({ ...o, serviceWorkers: 'block' }); await guard(c); return c; };
const ctx = await newCtx({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const media = new Set();
page.on('response', (r) => { const u = r.url(); if (/\.(woff2?|ttf|otf|png|jpe?g|webp|avif|svg|mp4|webm)(\?|$)/i.test(u)) media.add(u); });
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => page.goto(url, { waitUntil: 'domcontentloaded' }));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'assets/site/hero.png' });
const Hs = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < Hs; y += 700) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(300); }
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(1000);
await page.screenshot({ path: 'assets/site/full.png', fullPage: true }).catch((e) => console.log('full-page screenshot failed:', e.message));

const info = await page.evaluate(() => {
  const count = (m, k) => { m[k] = (m[k] || 0) + 1; };
  const fams = {}, colors = {}, bgs = {};
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { count(fams, cs.fontFamily); count(colors, cs.color); }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') count(bgs, cs.backgroundColor);
  }
  const faces = [], vars = {};
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) {
        const src = r.style.getPropertyValue('src'), m = [...src.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((x) => new URL(x[1], sh.href || location.href).href);
        faces.push({ family: r.style.getPropertyValue('font-family').replace(/["']/g, '').trim(), weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal', range: r.style.getPropertyValue('unicode-range') || '', urls: m });
      }
      if (r.selectorText && /^:root/.test(r.selectorText)) for (const k of r.style) if (k.startsWith('--')) vars[k] = r.style.getPropertyValue(k).trim();
    }
  }
  const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
  const headings = [...document.querySelectorAll('h1,h2,h3,p,a,button,li')].map((h) => {
    const t = h.innerText.trim(), cs = getComputedStyle(h);
    return t && t.length < 160 ? `${h.tagName}: ${t.replace(/\n/g, ' | ')}  [${cs.fontFamily.slice(0, 50)} ${cs.fontSize} ${cs.fontWeight} ls ${cs.letterSpacing} ${cs.color}]` : null;
  }).filter(Boolean).slice(0, 150);
  return {
    url: location.href, title: document.title, description: document.querySelector('meta[name=description]')?.content,
    font_families_by_use: top(fams, 12), font_faces: faces, text_colors: top(colors, 20), bg_colors: top(bgs, 20), css_vars: vars, headings,
    images: [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight })).slice(0, 120),
    videos: [...document.querySelectorAll('video')].map((v) => ({ src: v.currentSrc || v.src, poster: v.poster })),
    og_image: document.querySelector('meta[property="og:image"]')?.content,
    favicons: [...document.querySelectorAll('link[rel*=icon]')].map((l) => l.href),
    header_svgs: [...document.querySelectorAll('header svg, nav svg, a[href="/"] svg')].map((s) => s.outerHTML).filter((s) => s.length < 20000).slice(0, 6),
  };
});
info.network_media = [...media];
fs.writeFileSync('assets/site/info.json', JSON.stringify(info, null, 2));

// downloads: fonts, logos, og image, favicons
// Downloads go through the same pinned, SSRF-checked lookup; each redirect hop is re-validated (max 5, 50 MB).
const fetchSafe = (u, hops = 0) => new Promise((ok, ko) => {
  let x; try { x = new URL(u); } catch (e) { return ko(e); }
  if (!['http:', 'https:'].includes(x.protocol)) return ko(new Error('protocolo no permitido'));
  const h = bare(x.hostname);
  if (BLOCKED_NAMES.test(h) || (net.isIP(h) && blockedIp(h))) return ko(blockedErr(h));
  const mod = x.protocol === 'https:' ? https : http;
  const rq = mod.get(x, { lookup: safeLookup, timeout: 30000, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) CreatorStudioCapture', accept: '*/*' } }, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      r.resume();
      if (hops >= 5) return ko(new Error('demasiadas redirecciones'));
      return fetchSafe(new URL(r.headers.location, x).href, hops + 1).then(ok, ko);
    }
    if (r.statusCode !== 200) { r.resume(); return ko(new Error(`HTTP ${r.statusCode}`)); }
    const parts = []; let n = 0;
    r.on('data', (d) => { n += d.length; if (n > 50 * 1024 * 1024) { rq.destroy(new Error('archivo demasiado grande')); } else parts.push(d); });
    r.on('end', () => ok(Buffer.concat(parts)));
    r.on('error', ko);
  });
  rq.on('timeout', () => rq.destroy(new Error('timeout')));
  rq.on('error', ko);
});
const get = async (u, f) => {
  try { fs.writeFileSync(f, await fetchSafe(u)); return true; }
  catch (e) { if (e && e.code === 'EBLOCKED') console.log('blocked download:', String(u).slice(0, 120)); }
  return false;
};
const done = new Set(); let nf = 0;
for (const f of info.font_faces) {
  const u = f.urls.find((x) => /woff2/i.test(x)) || f.urls[0]; if (!u || done.has(u) || u.startsWith('data:')) continue; done.add(u);
  const ext = (u.match(/\.(woff2?|ttf|otf)(\?|$)/i) || [, 'woff2'])[1];
  // unicode-range subsets share a family/weight: the one covering Latin "A" keeps the plain name, others get a suffix
  const ranges = [...f.range.matchAll(/U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/gi)].map(([, a, b]) => [parseInt(a.replace(/\?/g, '0'), 16), parseInt((b || a).replace(/\?/g, 'F'), 16)]);
  const latin = !ranges.length || ranges.some(([a, b]) => a <= 0x41 && 0x41 <= b);
  const name = `assets/fonts/${slug(f.family)}-${f.weight.replace(/\s+/g, '_')}${f.style === 'italic' ? '-italic' : ''}${latin ? '' : '-u' + ranges[0][0].toString(16)}.${ext}`;
  if (await get(u, name)) nf++;
}
info.header_svgs.forEach((s, i) => fs.writeFileSync(`assets/brand/logo_${i}.svg`, s.includes('xmlns') ? s : s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')));
if (info.og_image) await get(info.og_image, `assets/brand/og${path.extname(new URL(info.og_image).pathname) || '.png'}`);
for (const [i, u] of info.favicons.entries()) await get(u, `assets/brand/favicon_${i}${path.extname(new URL(u).pathname) || '.png'}`);

// section crops at 3x
if (sections.length) {
  const p3 = await (await newCtx({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 3 })).newPage();
  await p3.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  const H3 = await p3.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < H3; y += 700) { await p3.evaluate((y) => scrollTo(0, y), y); await p3.waitForTimeout(250); }
  for (const text of sections) {
    const ok = await p3.evaluate(([text, name]) => {
      const el = [...document.querySelectorAll('body *')].find((e) => [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.includes(text)));
      if (!el) return false; let n = el; while (n.parentElement && n.getBoundingClientRect().width < 500) n = n.parentElement;
      n.setAttribute('data-cap', name); return true;
    }, [text, slug(text)]);
    if (!ok) { console.log('section not found:', text); continue; }
    const loc = p3.locator(`[data-cap="${slug(text)}"]`).first();
    await loc.scrollIntoViewIfNeeded(); await p3.waitForTimeout(1200);
    await loc.screenshot({ path: `assets/cap/${slug(text)}.png` }).then(() => console.log('assets/cap/' + slug(text) + '.png'), (e) => console.log('failed', text, e.message.slice(0, 80)));
  }
}
await browser.close(); proxy.close();
console.log(`assets/site/info.json  title "${info.title}"`);
console.log(`fonts in use: ${info.font_families_by_use.slice(0, 4).map(([f, n]) => `${f.split(',')[0]} (${n})`).join(', ')}`);
console.log(`font files downloaded: ${nf} → assets/fonts/   logos: ${info.header_svgs.length}   colours: ${info.text_colors.slice(0, 5).map((c) => c[0]).join(' ')}`);
