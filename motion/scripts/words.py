"""Word-level timing for animated captions: Whisper word stamps aligned to the SCRIPT (spelling, accents and
punctuation come from vo.json, only the times come from Whisper). Run from the project root, after vo.py and before
sync.mjs, with the shared venv:

  .venv/bin/python scripts/words.py                   audio/vo.wav + audio/vo_placed.json → audio/vo_words.json
  .venv/bin/python scripts/words.py --model medium    more accurate stamps (slower; small is the default)
  .venv/bin/python scripts/words.py --lang en         language (default: timeline.captions.lang, else "es")
  .venv/bin/python scripts/words.py --audio take.wav --out words.json
                                                      free mode (talking head, no vo.json): Whisper's own words

vo_words.json: [{ "w": "ROAS", "t0": 1.234, "t1": 1.61, "p": "h1", "k": 1 }, ...]
  p  the vo.json phrase id     k  keyword (marked *like this* in the vo.json text) → accent colour / bigger in captions
Keywords can also be listed in timeline.captions.keywords; numbers are keywords automatically (captions.autoKeywords).

Each phrase is aligned only against the Whisper words that fall inside its placed window, so one misheard word
never shifts the rest of the reel. Unmatched script words get times interpolated between their matched neighbours.
Check the match rate it prints: below 80 % listen to the phrase — usually the take and the vo.json text differ.
"""
import json, re, subprocess, sys, unicodedata
from difflib import SequenceMatcher
from pathlib import Path
import numpy as np

argv = sys.argv[1:]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
TL = json.loads(Path('timeline.json').read_text()) if Path('timeline.json').exists() else {}
LANG = opt('--lang', (TL.get('captions') or {}).get('lang', 'es'))
MODEL = opt('--model', 'small')


def norm(w):
    w = unicodedata.normalize('NFD', w.lower())
    return re.sub(r'[^a-z0-9%$]', '', ''.join(c for c in w if unicodedata.category(c) != 'Mn'))


def whisper(path):
    from faster_whisper import WhisperModel
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
                         capture_output=True, check=True).stdout
    m = WhisperModel(MODEL, device='cpu', compute_type='int8')
    segs, _ = m.transcribe(np.frombuffer(pcm, np.float32), language=LANG, word_timestamps=True, beam_size=5,
                           vad_filter=False, condition_on_previous_text=False)
    return [{'w': w.word.strip(), 't0': round(w.start, 3), 't1': round(w.end, 3)} for s in segs for w in s.words if w.word.strip()]


def align(script, heard, t0, t1):
    """script: display words of one phrase; heard: whisper words inside its window → [(t0, t1)] per script word."""
    a, b = [norm(w) for w in script], [norm(h['w']) for h in heard]
    times = [None] * len(script)
    for blk in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size): times[blk.a + k] = (heard[blk.b + k]['t0'], heard[blk.b + k]['t1'])
    # second pass: unequal stretches of the same length (misheard words) map one-to-one
    sm = SequenceMatcher(None, a, b, autojunk=False)
    for op, i0, i1, j0, j1 in sm.get_opcodes():
        if op == 'replace' and i1 - i0 == j1 - j0:
            for k in range(i1 - i0): times[i0 + k] = (heard[j0 + k]['t0'], heard[j0 + k]['t1'])
    matched = sum(1 for x in times if x)
    # interpolate the rest between matched neighbours (or the phrase edges), split by character share
    i = 0
    while i < len(times):
        if times[i]: i += 1; continue
        j = i
        while j < len(times) and not times[j]: j += 1
        lo = times[i - 1][1] if i > 0 else t0
        hi = times[j][0] if j < len(times) else t1
        if hi <= lo: hi = lo + 0.12 * (j - i)
        L = [max(1, len(norm(w))) for w in script[i:j]]; tot, acc = sum(L), 0
        for k in range(i, j):
            a0 = lo + (hi - lo) * acc / tot; acc += L[k - i]
            times[k] = (round(a0, 3), round(lo + (hi - lo) * acc / tot, 3))
        i = j
    # monotonic, inside the phrase, no zero-length words
    out, prev = [], t0
    for x0, x1 in times:
        x0 = max(x0, prev, t0); x1 = min(max(x1, x0 + 0.06), t1 + 0.15)
        out.append((round(x0, 3), round(x1, 3))); prev = x0
    return out, matched


def main():
    if '--audio' in argv:   # free mode: Whisper's words as-is
        words = whisper(opt('--audio'))
        Path(opt('--out', 'words.json')).write_text(json.dumps(words, ensure_ascii=False, indent=0))
        print(f'{len(words)} words → {opt("--out", "words.json")}'); return
    placed = json.loads(Path('audio/vo_placed.json').read_text())
    heard = whisper('audio/vo.wav')
    out, tot_m, tot_w = [], 0, 0
    for p in placed:
        script = [w for w in re.split(r'\s+', p['text'].strip()) if w]
        disp = [w.replace('*', '') for w in script]
        keys = [w.startswith('*') or w.rstrip('.,;:!?…"»)').endswith('*') for w in script]
        inside = [h for h in heard if p['t0'] - 0.12 <= (h['t0'] + h['t1']) / 2 <= p['t1'] + 0.12]
        times, m = align(disp, inside, p['t0'], p['t1'])
        tot_m += m; tot_w += len(disp)
        flag = '' if m >= 0.8 * len(disp) else '   ← LISTEN: script and take differ?'
        print(f"{p['t0']:6.2f}  {p['id']:6s} {m}/{len(disp)}  {' '.join(disp)}{flag}")
        for w, (a, b), k in zip(disp, times, keys):
            out.append({'w': w, 't0': a, 't1': b, 'p': p['id'], **({'k': 1} if k else {})})
    Path('audio/vo_words.json').write_text(json.dumps(out, ensure_ascii=False, indent=0))
    print(f'audio/vo_words.json: {len(out)} words, {tot_m}/{tot_w} matched ({100 * tot_m / max(1, tot_w):.0f} %) · model {MODEL}, lang {LANG}')
    print('next: node scripts/sync.mjs')


main()
