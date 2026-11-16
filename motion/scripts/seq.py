# Real footage → frame sequences the film can draw deterministically (a <video> cannot be seeked frame-exactly).
# Run from the project root:
#   .venv/bin/python scripts/seq.py <name> <video> <start_s> <dur_s> [--fps 30] [--max 1920]
#   → assets/seq/<name>/001.jpg … and prints the frame count + size for C.seq(...) in film.js
# Also: .venv/bin/python scripts/seq.py --strip <video> [--n 8]  → review/src/strip_<video>.jpg  (pick windows by eye)
# Picking a window: favour steady, well-lit 1–1.5 s moments; avoid burnt-in text overlays; portrait sources suit 9:16.
import sys, os, subprocess, json, glob

def sh(a): r = subprocess.run(a, capture_output=True, text=True); r.returncode and sys.exit(r.stderr[-1500:]); return r.stdout
def opt(k, d):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
def probe(v):
    j = json.loads(sh(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', v]))
    return float(j['format']['duration'])

if '--strip' in sys.argv:
    v = sys.argv[sys.argv.index('--strip') + 1]; n = int(opt('--n', 8)); d = probe(v)
    os.makedirs('review/src', exist_ok=True)
    # timestamps are drawn with PIL: many ffmpeg builds (e.g. Homebrew without freetype) lack the drawtext filter
    from PIL import Image, ImageDraw
    strip = Image.new('RGB', (240 * n, 240), (13, 11, 10))
    for k in range(n):
        t = d * (k + 0.5) / n; f = f'review/src/_s{k}.png'
        sh(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', v, '-frames:v', '1', '-vf',
            'scale=240:240:force_original_aspect_ratio=decrease,pad=240:240:(ow-iw)/2:(oh-ih)/2', f])
        im = Image.open(f).convert('RGB'); dr = ImageDraw.Draw(im); dr.rectangle([0, 0, 52, 18], fill=(0, 0, 0)); dr.text((4, 3), f'{t:.1f}s', fill=(255, 220, 0))
        strip.paste(im, (240 * k, 0)); os.remove(f)
    out = f"review/src/strip_{os.path.splitext(os.path.basename(v))[0].replace(' ', '_')}.jpg"
    strip.save(out, quality=88)
    print(out, f'({d:.1f} s)'); sys.exit(0)

name, v, start, dur = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
fps, mx = int(opt('--fps', 30)), int(opt('--max', 1920))
d = f'assets/seq/{name}'; os.makedirs(d, exist_ok=True)
for f in glob.glob(f'{d}/*.jpg'): os.remove(f)
# ffmpeg auto-rotates phone footage (rotation side data), so portrait clips come out portrait
sh(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', v, '-vf', f"fps={fps},scale='min({mx},iw)':-2", '-q:v', '3', f'{d}/%03d.jpg'])
n = len(glob.glob(f'{d}/*.jpg'))
wh = sh(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f'{d}/001.jpg']).strip()
print(f"{d}: {n} frames @ {fps} fps, {wh}  →  C.seq(bank, '{name}', {n})")
