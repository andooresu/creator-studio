# Is this reel's music actually different from the previous reels? Run from the project root.
#   python3 scripts/compare_music.py [audio/music.wav] [--ref a.wav b.wav ...]
# Without --ref it compares against every sibling project's audio/music.wav (../*/audio/music.wav).
# Measures tempo, key (Krumhansl), timbre (MFCC mean+std cosine) and rhythm (onset-envelope autocorrelation cosine).
# Calibration: two reels made with the same music.py recipe score timbre 1.00 / rhythm 1.00. Distinct ElevenLabs
# tracks score ~0.80–0.86 timbre and ~0.65–0.75 rhythm. Exit code 1 = REPEATED (fails the "own sound" rule).
import sys, glob, os, warnings
import numpy as np, librosa
warnings.filterwarnings('ignore')
args = sys.argv[1:]
refs = []
if '--ref' in args:
    i = args.index('--ref'); refs = args[i + 1:]; args = args[:i]
me = args[0] if args else 'audio/music.wav'
if not refs:
    here = os.path.abspath('.')
    refs = sorted(p for p in glob.glob('../*/audio/music.wav') if not os.path.abspath(p).startswith(here + os.sep))
KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
def key(ch):
    return max((np.corrcoef(np.roll(p, k), ch)[0, 1], f"{KEYS[k]}{'' if m == 'M' else 'm'}") for p, m in ((MAJ, 'M'), (MIN, 'm')) for k in range(12))[1]
def feat(p):
    y, sr = librosa.load(p, sr=22050, mono=True, duration=20)
    tempo = float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0])
    if tempo > 140: tempo /= 2
    mf = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)[1:]
    on = librosa.onset.onset_strength(y=y, sr=sr); ac = librosa.autocorrelate(on, max_size=200)
    return dict(tempo=tempo, key=key(librosa.feature.chroma_cqt(y=y, sr=sr).mean(1)), mf=np.r_[mf.mean(1), mf.std(1)], ac=ac / ac[0])
cos = lambda a, b: float(a @ b / np.linalg.norm(a) / np.linalg.norm(b))
name = lambda p: os.path.basename(os.path.dirname(os.path.dirname(os.path.abspath(p))))
F = feat(me)
print(f"{name(me)}: {F['tempo']:.0f} BPM, {F['key']}")
if not refs: print('no previous reels found (../*/audio/music.wav) — nothing to compare'); sys.exit(0)
bad = []
for r in refs:
    G = feat(r); tb, rh = cos(F['mf'], G['mf']), cos(F['ac'], G['ac'])
    same = (tb > 0.95 and rh > 0.9) or (abs(F['tempo'] - G['tempo']) < 4 and F['key'] == G['key'] and tb > 0.9)
    print(f"  vs {name(r):32s} {G['tempo']:.0f} BPM {G['key']:4s}  Δtempo {abs(F['tempo'] - G['tempo']):3.0f}  timbre {tb:.2f}  rhythm {rh:.2f}  {'REPEATED' if same else 'distinct'}")
    if same: bad.append(name(r))
if bad: print(f"REPEATED sound vs: {', '.join(bad)} — make a new track (AUDIO.md §1)"); sys.exit(1)
print('distinct from every previous reel')
