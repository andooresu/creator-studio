#!/bin/sh
# Caption lab: render any caption preset or style over a neutral sample voice, to try, compare and LEARN formats
# without touching a real reel. Run from anywhere (output defaults to ./caption-lab/).
#
#   sh <skill>/scripts/caption_lab.sh karaoke-amarillo                       a preset from captions/presets.json
#   sh <skill>/scripts/caption_lab.sh pop                                    a bare style
#   sh <skill>/scripts/caption_lab.sh caja-blanca --set '{"accent":"#00C2A8"}'   override knobs (JSON)
#   sh <skill>/scripts/caption_lab.sh mi-nuevo --bg refs/x/frame.jpg         put a reference still behind it (side-by-side check)
#   sh <skill>/scripts/caption_lab.sh all                                    every preset → one comparison video
#   options: --out <dir> (default ./caption-lab) · --audio <vo.wav> --placed <vo_placed.json> --words <vo_words.json>
#            (your own VO instead of the sample) · --keep (keep the scratch project in <out>/_proj-<name>)
# Without --bg the background is dark for 0–6 s and light for 6–12 s, with a hard cut at 6 s: one render shows
# legibility on both and that no chunk straddles a cut.
# → <out>/<name>.mp4 (with the voice) + <out>/<name>_sheet.jpg (4 stills: chunk entry, spoken word, keyword, light bg)
set -e
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$1"; [ -n "$NAME" ] || { sed -n 2,14p "$0"; exit 1; }; shift
OUT="caption-lab"; SET="{}"; BG=""; AUDIO="$SKILL/captions/sample/vo.wav"; PLACED="$SKILL/captions/sample/vo_placed.json"; WORDS="$SKILL/captions/sample/vo_words.json"; KEEP=""
while [ $# -gt 0 ]; do case "$1" in
  --out) OUT="$2"; shift 2;; --set) SET="$2"; shift 2;; --bg) BG="$2"; shift 2;; --keep) KEEP=1; shift;;
  --audio) AUDIO="$2"; shift 2;; --placed) PLACED="$2"; shift 2;; --words) WORDS="$2"; shift 2;;
  *) echo "unknown option $1"; exit 1;; esac; done
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"

if [ "$NAME" = all ]; then
  LIST=$(node -e "const P=require('$SKILL/captions/presets.json');console.log(Object.keys(P).filter(k=>!k.startsWith('_')).join(' '))")
  for p in $LIST; do sh "$0" "$p" --out "$OUT" ${BG:+--bg "$BG"}; done
  ARGS=""; F=""; i=0
  for p in $LIST; do ARGS="$ARGS -i $OUT/$p.mp4"; F="$F[$i:v]scale=360:-2[v$i];"; i=$((i+1)); done
  S=""; j=0; while [ $j -lt $i ]; do S="$S[v$j]"; j=$((j+1)); done
  # shellcheck disable=SC2086
  ffmpeg -v error -y $ARGS -filter_complex "${F}${S}hstack=$i[v]" -map "[v]" -map 0:a -c:v libx264 -crf 22 -pix_fmt yuv420p -c:a aac "$OUT/all.mp4"
  echo "→ $OUT/all.mp4  (left to right: $LIST)"; exit 0
fi

P="$OUT/_proj-$NAME"; rm -rf "$P"
sh "$SKILL/scripts/init.sh" "$P" >/dev/null
cd "$P"
cp "$AUDIO" audio/vo.wav; cp "$PLACED" audio/vo_placed.json; cp "$WORDS" audio/vo_words.json
[ -n "$BG" ] && cp "$BG" assets/bg.${BG##*.}
DUR=$(node -e "const p=require('$P/audio/vo_placed.json');console.log(Math.ceil(p[p.length-1].t1+0.6))")
node - "$NAME" "$SET" "$DUR" "${BG:+bg.${BG##*.}}" <<'EOF'
const fs = require('fs'); const [name, set, dur, bg] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync('film/lib/caption_presets.json', 'utf8'));
const styles = ['pill', 'karaoke', 'pop', 'box', 'word'];
const cap = { formats: ['9x16'], ...(P[name] ? { preset: name } : styles.includes(name) ? { style: name } : (() => { throw new Error(`no preset or style "${name}"`); })()), ...JSON.parse(set) };
const half = Math.round(dur / 2 * 2) / 2;   // seconds; the lab runs at 60 bpm so 1 beat = 1 s
fs.writeFileSync('timeline.json', JSON.stringify({ title: `caption lab · ${name}`, duration: +dur, fps: 30, bpm: 60, formats: ['9x16'],
  music: null, voiceover: null, marks: { a: 0, b: half, end: +dur }, sfx: [], captions: cap, lint: { minText: {}, ignore: [] } }, null, 1));
const bgCss = bg ? `url(../assets/${bg}) center/cover` : null;
fs.writeFileSync('film/film.js', `(() => {
  const { el, scene, H } = C; C.fonts = [];
  const bg = (root, css, lines) => { root.style.background = css;
    for (let i = 0; i < 6; i++) el('div', { class: 'abs', style: \`left:\${80 + i * 150}px;top:\${H * 0.18 + (i % 3) * 260}px;width:120px;height:\${220 + (i % 2) * 180}px;border-radius:24px;background:\${lines}\` }, root); };
  scene({ name: 'dark', from: 'a', to: 'b', build(root) { bg(root, ${JSON.stringify(bgCss || 'linear-gradient(160deg,#1d2733,#0b0f14)')}, 'rgba(255,255,255,.06)'); }, run() {} });
  scene({ name: 'light', from: 'b', to: 'end', build(root) { bg(root, ${JSON.stringify(bgCss || 'linear-gradient(160deg,#f4efe6,#d9e4ec)')}, 'rgba(0,0,0,.07)'); }, run() {} });
  C.start();
})();\n`);
EOF
node scripts/sync.mjs >/dev/null
node scripts/render.mjs --range 0,"$DUR" --fmt 9x16 --blur 0 --fps 30 >/dev/null 2>&1 || node scripts/render.mjs --range 0,"$DUR" --fmt 9x16 --blur 0 --fps 30
ffmpeg -v error -y -i renders/clip_9x16_0-"$DUR".mp4 -i audio/vo.wav -map 0:v -map 1:a -c:v copy -c:a aac -shortest "$OUT/$NAME.mp4"
# stills: first chunk entering, mid-chunk spoken word, the first keyword, a word after the cut (light background)
TS=$(node -e "
const w=require('$P/audio/vo_words.json'), d=$DUR, h=Math.round(d/2*2)/2;
const k=w.find(x=>x.k)||w[3], after=w.find(x=>x.t0>h+0.5)||w[w.length-2];
console.log([w[0].t0+0.05, w[2].t0+0.08, k.t0+0.1, after.t0+0.08].map(x=>x.toFixed(2)).join(','))")
node scripts/render.mjs --at "$TS" --fmt 9x16 >/dev/null 2>&1
set --; for x in $(echo "$TS" | tr ',' ' '); do set -- "$@" "review/stills/9x16/t$(printf '%.3f' "$x").png"; done
ffmpeg -v error -y -i "$1" -i "$2" -i "$3" -i "$4" -filter_complex "[0][1][2][3]hstack=4,crop=iw:ih*0.5:0:ih*0.38,scale=1600:-1" "$OUT/${NAME}_sheet.jpg"
cd "$OUT"; [ -n "$KEEP" ] || rm -rf "$P"
echo "→ $OUT/$NAME.mp4  ·  $OUT/${NAME}_sheet.jpg  (stills at $TS s)"
