# Shot matching + one common look ("LUT") for every real-footage sequence.
#   .venv/bin/python scripts/grade.py [name ...]        (default: every folder in assets/seq_raw or assets/seq)
# First run moves assets/seq/<name> → assets/seq_raw/<name> (untouched originals); graded frames are written to
# assets/seq/<name> (long side ≤ 1920). Deterministic: per-shot stats come from the raw frames only.
# Per-shot overrides in grade.json: {"<name>": {"wb": 0..1, "expo": 0..1, "L50": 55, "sat": 0.88, "da": 0, "db": 0}}
#   1. white balance  — the cast of the low-chroma pixels (whites, greys, gloves, sheets) is pulled to a warm neutral
#   2. exposure       — L percentiles p3/p50/p97 mapped toward a common target (same blacks, mids, highlights)
#   3. common look    — chroma ×0.88, soft S-curve, black floor at the brand black, warm shadows / neutral highlights
import sys, os, glob, json, shutil
import numpy as np
from PIL import Image

ROOT = os.getcwd()
RAW, OUT = 'assets/seq_raw', 'assets/seq'
TARGET = dict(a=5.0, b=11.0, p3=10.0, p50=56.0, p97=93.0)   # warm neutral, common tonal range (Lab)
DEF = dict(wb=0.9, expo=0.8, sat=0.80, da=0.0, db=0.0)

M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
Mi = np.linalg.inv(M); WHITE = np.array([0.95047, 1.0, 1.08883])

def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin2srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
def f(t): return np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
def fi(t): return np.where(t ** 3 > 216 / 24389, t ** 3, (116 * t - 16) / (24389 / 27))

def rgb2lab(rgb):
    xyz = srgb2lin(rgb) @ M.T / WHITE
    fx, fy, fz = f(xyz[..., 0]), f(xyz[..., 1]), f(xyz[..., 2])
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], -1)

def lab2rgb(lab):
    fy = (lab[..., 0] + 16) / 116; fx = fy + lab[..., 1] / 500; fz = fy - lab[..., 2] / 200
    xyz = np.stack([fi(fx), fi(fy), fi(fz)], -1) * WHITE
    return np.clip(lin2srgb(xyz @ Mi.T), 0, 1)

def load(p, maxside=1920):
    im = Image.open(p).convert('RGB')
    s = maxside / max(im.size)
    if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255

def stats(frames):
    labs = []
    for p in frames:
        im = Image.open(p).convert('RGB'); im.thumbnail((320, 320))
        labs.append(rgb2lab(np.asarray(im, np.float32) / 255).reshape(-1, 3))
    lab = np.concatenate(labs)
    L, a, b = lab.T; C = np.hypot(a, b)
    # robust gray-world: mid/high tones, minus the most saturated 20 % (lips, neon shields, LED strips)
    m = (L > 30) & (L < 92) & (C < np.percentile(C, 80))
    return dict(ca=float(np.median(a[m])), cb=float(np.median(b[m])), wbw=1.0,
                p3=float(np.percentile(L, 3)), p50=float(np.percentile(L, 50)), p97=float(np.percentile(L, 97)))

def scurve(L):                                    # soft S on 0..100, pivot 50
    x = L / 100; y = x + 0.12 * (x - 0.5) * (1 - abs(2 * x - 1))
    return np.clip(y, 0, 1) * 100

def grade(rgb, st, o):
    lab = rgb2lab(rgb); L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    k = o['wb'] * st['wbw']
    a = a - k * (st['ca'] - TARGET['a']) + o['da']
    b = b - k * (st['cb'] - TARGET['b']) + o['db']
    e = o['expo']; t50 = o.get('L50', TARGET['p50'])
    src = np.array([0, st['p3'], st['p50'], st['p97'], 100])
    dst = np.array([0, (1 - e) * st['p3'] + e * TARGET['p3'], (1 - e) * st['p50'] + e * t50, (1 - e) * st['p97'] + e * TARGET['p97'], 100])
    src = np.maximum.accumulate(src + np.arange(5) * 1e-3)
    L = np.interp(L, src, dst)
    L = scurve(L)
    L = 4.0 + L * (96.0 / 100)                        # black floor ≈ #0d0b0a, highlights just under paper white
    # selective colour: purple/magenta LED spill is not a brand colour.
    # Hues from -90° to 20° (violet → magenta → pink) rotate toward the skin hue (55°) and lose chroma;
    # reds of lips (~25–35°) and everything warmer are untouched. Blues (< -90°) are desaturated.
    C = np.hypot(a, b); h = np.degrees(np.arctan2(b, a))
    k = o.get('purple', 1.0)
    w = np.clip((20 - h) / 35, 0, 1) * (h > -100) * np.clip(C / 6, 0, 1) * k
    h = h + w * (55 - h)
    C = C * (1 - w * (0.35 + 0.45 * np.clip((C - 25) / 30, 0, 1)))
    blue = np.clip((-90 - h) / 30, 0, 1) * (h < -90) * k
    C = C * (1 - 0.75 * blue)
    a, b = C * np.cos(np.radians(h)), C * np.sin(np.radians(h))
    a, b = a * o['sat'], b * o['sat']
    sh = np.clip(1 - L / 45, 0, 1)                    # warm shadows
    a = a + 2.0 * sh; b = b + 5.0 * sh
    hl = np.clip((L - 70) / 30, 0, 1)                 # creamy highlights
    a = a + 0.8 * hl; b = b + 3.0 * hl
    return lab2rgb(np.stack([L, a, b], -1))

N = 33
def make_lut(st, o):
    g = np.linspace(0, 1, N, dtype=np.float32)
    rgb = np.stack(np.meshgrid(g, g, g, indexing='ij'), -1)            # [r][g][b]
    return grade(rgb.reshape(-1, 3), st, o).reshape(N, N, N, 3).astype(np.float32)

def apply_lut(img, lut):
    x = img * (N - 1); i0 = np.clip(np.floor(x).astype(np.int32), 0, N - 2); t = x - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]; tr, tg, tb = t[..., :1], t[..., 1:2], t[..., 2:]
    c = lambda dr, dg, db: lut[r0 + dr, g0 + dg, b0 + db]
    c00 = c(0, 0, 0) * (1 - tr) + c(1, 0, 0) * tr; c10 = c(0, 1, 0) * (1 - tr) + c(1, 1, 0) * tr
    c01 = c(0, 0, 1) * (1 - tr) + c(1, 0, 1) * tr; c11 = c(0, 1, 1) * (1 - tr) + c(1, 1, 1) * tr
    return (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb

def _job(args):
    p, dst, lut = args
    out = (np.clip(apply_lut(load(p), lut), 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(dst, quality=92)

def shot_setup(n, over):
    if not os.path.isdir(f'{RAW}/{n}'):
        shutil.move(f'{OUT}/{n}', f'{RAW}/{n}')
    frames = sorted(glob.glob(f'{RAW}/{n}/*.jpg'))
    st = stats(frames[::max(1, len(frames) // 6)])
    return frames, st, make_lut(st, {**DEF, **over.get(n, {})})

def preview(names, over, out='review/grade_preview.jpg', h=560):
    cols = []
    for n in names:
        frames, st, lut = shot_setup(n, over)
        raw = load(frames[len(frames) // 2], 900)
        a = Image.fromarray((raw * 255).astype(np.uint8)); b = Image.fromarray((np.clip(apply_lut(raw, lut), 0, 1) * 255).astype(np.uint8))
        w = round(a.width * h / a.height); w = min(w, round(h * 9 / 16))
        def fit(im):
            s = max(w / im.width, h / im.height); im = im.resize((round(im.width * s) + 1, round(im.height * s) + 1))
            l, t = (im.width - w) // 2, (im.height - h) // 2; return im.crop((l, t, l + w, t + h))
        cols.append((fit(a), fit(b)))
    W = sum(c[0].width for c in cols) + 6 * (len(cols) + 1)
    board = Image.new('RGB', (W, 2 * h + 18), (13, 11, 10)); x = 6
    for a, b in cols:
        board.paste(a, (x, 6)); board.paste(b, (x, h + 12)); x += a.width + 6
    os.makedirs('review', exist_ok=True); board.save(out, quality=88); print('preview →', out)

def main():
    over = json.load(open('grade.json')) if os.path.exists('grade.json') else {}
    if '--preview' in sys.argv:
        names = [a for a in sys.argv[1:] if not a.startswith('--')] or sorted(os.listdir(RAW))
        for n in sorted(d for d in os.listdir(OUT) if os.path.isdir(f'{OUT}/{d}') and not os.path.isdir(f'{RAW}/{d}')):
            shutil.move(f'{OUT}/{n}', f'{RAW}/{n}')
        return preview(sorted(os.listdir(RAW)) if not names else names, over)
    from multiprocessing import Pool
    os.makedirs(RAW, exist_ok=True)
    names = sys.argv[1:] or sorted(set(os.listdir(RAW)) | set(d for d in os.listdir(OUT) if os.path.isdir(f'{OUT}/{d}')))
    for n in names:
        frames, st, lut = shot_setup(n, over)
        shutil.rmtree(f'{OUT}/{n}', ignore_errors=True); os.makedirs(f'{OUT}/{n}')
        with Pool() as pool:
            pool.map(_job, [(p, f'{OUT}/{n}/{os.path.basename(p)}', lut) for p in frames])
        print(f'{n}: cast a{st["ca"]:+.1f} b{st["cb"]:+.1f} (w{st["wbw"]}) · L {st["p3"]:.0f}/{st["p50"]:.0f}/{st["p97"]:.0f} → graded {len(frames)} frames')

if __name__ == '__main__':
    main()
