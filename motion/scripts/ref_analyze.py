"""Deconstruct a reference video into measurable grammar, so it can be emulated with the client's own content.
    .venv/bin/python scripts/ref_analyze.py <video> [--name slug] [--thresh 0.15] [--bpm 100]
(thresh 0.15 caught every hard cut on a test film; pushes/zoom-throughs also register — they are transitions worth noting.
 --bpm gives librosa a tempo hint: dembow/reggaetón is often misread, e.g. 136 for a real 100.)
→ refs/<slug>/
    shots.json        cuts, shot table (start, end, dur), per-shot motion energy, mean brightness, dominant colours
    sheet_shots.jpg   first + middle frame of every shot, labelled with time and duration (LOOK at it)
    sheet_time.jpg    one frame every 0.5 s (reads type animation, transitions, camera moves)
    energy.png        motion-energy curve with cuts (and beats, if the video has music)
    palette.png       dominant colours across the whole video, with hex values
    breakdown.md      measured numbers + the grammar sections to fill in after watching (REFERENCE.md)
No content is copied into the film: the reference supplies rhythm, motion, transitions, type behaviour and sound sync only.
"""
import json, os, sys, subprocess, tempfile
import numpy as np
from PIL import Image, ImageDraw

def opt(k, d=None): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
src = sys.argv[1]
name = opt('--name', os.path.splitext(os.path.basename(src))[0].replace(' ', '_')[:40])
TH = float(opt('--thresh', 0.15))
BPM_HINT = float(opt('--bpm', 0)) or None
out = f'refs/{name}'; os.makedirs(out, exist_ok=True)
meta = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                           'stream=codec_type,width,height,r_frame_rate,duration:stream_side_data=rotation:stream_tags=rotate,DURATION:format=duration',
                                           '-of', 'json', src]).decode())
v = next(s for s in meta['streams'] if s['codec_type'] == 'video')
has_audio = any(s['codec_type'] == 'audio' for s in meta['streams'])
num, den = map(int, v['r_frame_rate'].split('/')); fps_src = num / den if den else 0.0

def _num(x):
    try: return float(x)
    except (TypeError, ValueError): return None
def _hms(x):  # Matroska/WebM keep the stream duration as a tag "HH:MM:SS.fff"
    try: h, m_, s_ = str(x).split(':'); return int(h) * 3600 + int(m_) * 60 + float(s_)
    except (ValueError, AttributeError): return None
fmt_dur = _num(meta.get('format', {}).get('duration'))
tags = v.get('tags') or {}
# duration of the VIDEO stream (the container's is the longest stream: an audio tail would stretch it)
v_dur = _num(v.get('duration')) or _hms(tags.get('DURATION') or tags.get('duration'))

# rotation metadata (display matrix side data or the legacy "rotate" tag): ffmpeg autorotates the decoded frames
rot = 0.0
for sd in v.get('side_data_list') or []:
    if _num(sd.get('rotation')) is not None: rot = _num(sd.get('rotation')); break
else:
    rot = _num(tags.get('rotate')) or 0.0
W0, H0 = int(v.get('width') or 0), int(v.get('height') or 0)
if int(round(abs(rot))) % 180 == 90: W0, H0 = H0, W0

# 1. decode small frames at 15 fps (enough for cuts and motion), autorotated
FPS, SW = 15, 160
VF = f'fps={FPS},scale={SW}:-2'
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-an', '-vf', VF, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                     capture_output=True, check=True).stdout
# probe the decoded frame size directly (same filter chain, one frame) instead of guessing it from the byte count
import io
probe = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-an', '-vf', VF, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                       capture_output=True, check=True).stdout
fw, fh = Image.open(io.BytesIO(probe)).size
n = len(raw) // (fw * fh * 3)
if n < 1: sys.exit('ref_analyze: could not decode any video frame from ' + src)
F = np.frombuffer(raw[:n * fw * fh * 3], np.uint8).reshape(n, fh, fw, 3).astype(np.float32)
t = np.arange(n) / FPS
# the decoded frames are the ground truth for how long the picture lasts; trust stream metadata only when it agrees
dur = n / FPS
if v_dur and abs(v_dur - dur) <= 2.0 / FPS: dur = v_dur
elif fmt_dur and abs(fmt_dur - dur) <= 2.0 / FPS: dur = fmt_dur
# decoded aspect already reflects autorotation: if metadata disagrees on orientation, the decoded frames win
if W0 and H0 and (fh > fw) != (H0 > W0) and abs(fh - fw) > 2: W0, H0 = H0, W0
if not (W0 and H0): W0, H0 = fw, fh

# 2. cuts: colour-histogram distance between consecutive frames, adaptive peak picking
def hist(f):
    h = [np.histogram(f[..., c], bins=16, range=(0, 255))[0] for c in range(3)]
    h = np.concatenate(h).astype(np.float32); return h / h.sum()
Hs = np.array([hist(f) for f in F])
dh = np.r_[0, 0.5 * np.abs(np.diff(Hs, axis=0)).sum(1)]
motion = np.r_[0, np.abs(np.diff(F, axis=0)).mean((1, 2, 3)) / 255]
med = np.median(dh) + 1e-6
cuts = [0.0]
for i in range(1, n - 1):
    if dh[i] > TH and dh[i] >= dh[i - 1] and dh[i] >= dh[i + 1] and dh[i] > 4 * med and t[i] - cuts[-1] > 0.12:
        cuts.append(round(float(t[i] - 0.5 / FPS), 3))          # the cut sits between frame i-1 and i
bounds = cuts + [dur]
shots = []
for k in range(len(cuts)):
    a, b = bounds[k], bounds[k + 1]; ia, ib = int(a * FPS), max(int(a * FPS) + 1, int(b * FPS))
    seg = F[ia:ib]
    q = Image.fromarray(seg[len(seg) // 2].astype(np.uint8)).quantize(4)
    pal = q.getpalette()[:12]; cnt = sorted(q.getcolors(), reverse=True)
    cols = ['#%02x%02x%02x' % tuple(pal[i * 3:i * 3 + 3]) for _, i in cnt[:3]]
    shots.append({'i': k + 1, 'start': round(a, 3), 'end': round(b, 3), 'dur': round(b - a, 3),
                  'motion': round(float(motion[ia + 1:ib].mean()) if ib - ia > 1 else 0, 4),
                  'brightness': round(float(seg.mean() / 255), 3), 'colors': cols})

# 3. music grid (optional): tempo + how many cuts land on a beat (± half a sample frame + 40 ms)
beats, tempo, on_beat, on_grid = [], None, None, None
if has_audio:
    try:
        import librosa
        tmp = tempfile.mktemp(suffix='.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '22050', tmp], check=True)
        y, sr = librosa.load(tmp, sr=22050); os.remove(tmp)
        tempo, bf = librosa.beat.beat_track(y=y, sr=sr, **({'bpm': BPM_HINT} if BPM_HINT else {})); tempo = float(np.atleast_1d(tempo)[0])
        beats = librosa.frames_to_time(bf, sr=sr).tolist()
        if beats and len(cuts) > 1:
            bb = np.array(beats); on_beat = round(float(np.mean([np.min(np.abs(bb - c)) <= 0.5 / FPS + 0.04 for c in cuts[1:]])), 2)
            # phase-free: are cut-to-cut intervals multiples of half a beat? (librosa's beat PHASE is often off on VO mixes)
            iv = np.diff(cuts) / (60 / tempo) * 2
            on_grid = round(float(np.mean(np.abs(iv - np.round(iv)) <= (0.5 / FPS + 0.03) / (60 / tempo) * 2)), 2)
    except Exception as e:
        print('audio analysis skipped:', e)

# 4. sheets
def label(im, txt):
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 8 * len(txt) + 8, 16], fill=(0, 0, 0)); d.text((4, 2), txt, fill=(255, 220, 0)); return im
def frame_at(sec, w=220):
    sec = min(max(0, sec), max(0, dur - 1.0 / FPS))
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{sec:.3f}', '-i', src, '-an', '-frames:v', '1', '-vf', f'scale={w}:-2', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                       capture_output=True).stdout
    if r: return Image.open(io.BytesIO(r)).convert('RGB')
    # past the last decodable frame: fall back to the nearest decoded small frame
    k = min(n - 1, max(0, int(sec * FPS)))
    im = Image.fromarray(F[k].astype(np.uint8)); return im.resize((w, max(2, round(w * fh / fw / 2) * 2)))
tiles = []
for s in shots:
    for which, sec in (('in', s['start'] + 0.04), ('mid', (s['start'] + s['end']) / 2)):
        tiles.append(label(frame_at(sec), f"#{s['i']} {sec:.2f}s {s['dur']:.2f}s" if which == 'in' else f"#{s['i']} mid"))
def grid(ims, cols, path):
    w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
    g = Image.new('RGB', (cols * w, rows * h), (20, 20, 20))
    for k, im in enumerate(ims): g.paste(im.resize((w, h)), ((k % cols) * w, (k // cols) * h))
    g.save(path, quality=85)
grid(tiles, 8, f'{out}/sheet_shots.jpg')
grid([label(frame_at(x, 180), f'{x:.1f}s') for x in np.arange(0, dur, 0.5)], 10, f'{out}/sheet_time.jpg')

# energy curve
W_, H_ = 1400, 260; im = Image.new('RGB', (W_, H_), (16, 16, 16)); d = ImageDraw.Draw(im)
m = motion / (motion.max() + 1e-6)
pts = [(int(x / dur * W_), int(H_ - 20 - y * (H_ - 40))) for x, y in zip(t, m)]
for b in beats: x = int(b / dur * W_); d.line([(x, H_ - 14), (x, H_)], fill=(90, 90, 160))
for c in cuts[1:]: x = int(c / dur * W_); d.line([(x, 0), (x, H_)], fill=(200, 60, 60))
d.line(pts, fill=(255, 220, 0), width=2)
for s_ in range(int(dur) + 1): x = int(s_ / dur * W_); d.text((x + 2, 2), f'{s_}s', fill=(160, 160, 160))
im.save(f'{out}/energy.png')
# palette
allf = Image.fromarray(F[::max(1, n // 60)].reshape(-1, fw, 3).astype(np.uint8)).quantize(8)
pal = allf.getpalette()[:24]; cnt = sorted(allf.getcolors(), reverse=True)
pim = Image.new('RGB', (8 * 120, 90), (0, 0, 0)); d = ImageDraw.Draw(pim); hexes = []
for k, (c, i) in enumerate(cnt[:8]):
    rgb = tuple(pal[i * 3:i * 3 + 3]); hx = '#%02x%02x%02x' % rgb; hexes.append(hx)
    d.rectangle([k * 120, 0, k * 120 + 118, 64], fill=rgb); d.text((k * 120 + 4, 70), hx, fill=(230, 230, 230))
pim.save(f'{out}/palette.png')

durs = np.array([s['dur'] for s in shots])
summary = {'source': src, 'duration': round(dur, 2), 'fps': round(fps_src, 2), 'size': [W0, H0], 'rotation': rot, 'shots': len(shots),
           'cuts_per_sec': round(len(cuts[1:]) / dur, 2), 'shot_len': {'median': round(float(np.median(durs)), 2), 'min': round(float(durs.min()), 2),
           'max': round(float(durs.max()), 2)}, 'tempo_bpm': round(tempo, 1) if tempo else None, 'cuts_on_beat': on_beat, 'intervals_on_half_beat_grid': on_grid,
           'motion_mean': round(float(motion.mean()), 4), 'palette': hexes}
json.dump({'summary': summary, 'cuts': cuts, 'shots': shots, 'beats': beats}, open(f'{out}/shots.json', 'w'), indent=1)
beat_s = 60 / tempo if tempo else None
rows = '\n'.join(f"| {s['i']} | {s['start']:.2f}–{s['end']:.2f} | {s['dur']:.2f}" + (f" ({s['dur'] / beat_s:.1f} beats)" if beat_s else '') +
                 f" | {s['motion']:.3f} | {' '.join(s['colors'])} |  |  |" for s in shots)
open(f'{out}/breakdown.md', 'w').write(f"""# Reference breakdown — {os.path.basename(src)}

Measured by ref_analyze.py: {summary['duration']} s · {summary['shots']} shots · {summary['cuts_per_sec']} cuts/s · shot length median {summary['shot_len']['median']} s (min {summary['shot_len']['min']}, max {summary['shot_len']['max']}) · music {summary['tempo_bpm']} BPM · cut intervals on the ½-beat grid {summary['intervals_on_half_beat_grid']} (cuts on detected beats {summary['cuts_on_beat']}; beat phase can be off) · palette {' '.join(hexes)}

LOOK at sheet_shots.jpg, sheet_time.jpg, energy.png, palette.png (and play the file) before filling the sections below.

## Shot table (fill "what happens" and "transition into it")
| # | time (s) | dur | motion | colours | what happens | transition in |
|---|---|---|---|---|---|---|
{rows}

## Grammar to emulate (never the content)
- **Hook (0–2 s):** how it grabs (type slam? face? question? sound hit?)
- **Structure / acts:** where the energy lifts, drops, resolves (energy.png)
- **Cut rhythm:** cuts per beat or bar, accelerations, holds
- **Type behaviour:** fonts (class), size vs frame, entry/exit motion, words per beat, colour/accent rule
- **Transitions catalogue:** e.g. colour wipe, whip pan, zoom-through, mask reveal, match cut — with timing
- **Camera / footage motion:** push-ins, punches, speed ramps, shake, parallax
- **Colour & texture:** palette role (bg, accent), grade, grain, overlays
- **Graphics:** shapes, stickers, UI, counters, lines
- **Sound:** music genre/BPM, SFX on cuts, VO style, silences
- **What makes it feel premium / viral:** the 3 decisions that matter most

## Translation to our brand
Map each grammar point to the client's real material, brand colours/fonts and message. List what CapCut can do natively vs what must be a rendered graphic clip.
""")
print(json.dumps(summary, indent=1)); print(f'→ {out}/ (sheet_shots.jpg, sheet_time.jpg, energy.png, palette.png, breakdown.md)')
