#!/bin/sh
# Scaffold a motion-reel project:  sh <skill>/scripts/init.sh videos/<slug> [--preset presets/<name>]
# Copies the engine (film/), the pipeline scripts (scripts/) and the templates (brief, timeline, docs) into a NEW folder.
# Refuses an existing non-empty folder: parallel sessions often pick the same slug. Pick a distinctive one.
set -e
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$1"
[ -z "$DEST" ] && { echo "usage: sh $0 <project-dir> [--preset <preset-dir>]   e.g. videos/acme-launch-kinetic --preset presets/blank"; exit 1; }
PRESET=""
if [ "$2" = "--preset" ]; then
  # a path, or a bare name looked up in ./presets/ then in the skill's own presets/
  for P in "$3" "presets/$3" "$SKILL/presets/$3" "$SKILL/presets/$(basename "$3")"; do
    [ -f "$P/preset.jsonc" ] && { PRESET="$(cd "$P" && pwd)"; break; }
  done
  [ -n "$PRESET" ] || { echo "no preset '$3' (looked in ./presets and $SKILL/presets)"; exit 1; }
fi
# An existing folder is accepted only if it holds nothing but user-supplied material in assets/ (e.g. the user was
# asked to drop photos into videos/<slug>/assets/real/ before scaffolding). Anything else: another session may own it.
if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null | grep -v -x -e assets -e .DS_Store)" ]; then
  echo "REFUSING: $DEST exists and is not empty (another session may own it). Choose a new slug."; exit 2
fi
mkdir -p "$DEST"/film/lib "$DEST"/scripts "$DEST"/docs "$DEST"/audio/vo "$DEST"/assets/fonts "$DEST"/assets/brand "$DEST"/assets/cap "$DEST"/renders "$DEST"/review
cp "$SKILL"/engine/index.html "$SKILL"/engine/core.js "$SKILL"/engine/type.js "$SKILL"/engine/film.js "$DEST"/film/
cp "$SKILL"/engine/lib/motion.js "$SKILL"/engine/lib/motion.test.js "$SKILL"/engine/lib/media.js "$SKILL"/engine/lib/captions.js "$DEST"/film/lib/
for f in render.mjs sync.mjs sfx.mjs capture.mjs beats.py music.py vo.py words.py mix.py review.py preset.mjs compare_music.py lint.mjs seq.py grade.py ref_analyze.py; do cp "$SKILL/scripts/$f" "$DEST/scripts/"; done
cp "$SKILL"/captions/presets.json "$DEST"/film/lib/caption_presets.json
mkdir -p "$DEST"/assets/fonts/captions && cp "$SKILL"/captions/fonts/* "$DEST"/assets/fonts/captions/
cp "$SKILL"/templates/brief.md "$SKILL"/templates/timeline.json "$DEST"/
cp "$SKILL"/templates/docs/*.md "$DEST"/docs/
date -u +"created %Y-%m-%dT%H:%M:%SZ by motion-reel init" > "$DEST"/.owner

[ -n "$PRESET" ] && node "$SKILL"/scripts/preset.mjs "$PRESET" "$DEST"
cd "$DEST"
# rendering needs playwright: if this project doesn't have it, reuse the copy install.sh put next to the skill
if ! node -e "require.resolve('playwright', { paths: [process.cwd()] })" 2>/dev/null && [ -d "$SKILL/node_modules/playwright" ]; then
  ln -s "$SKILL/node_modules" node_modules && echo "linked playwright from the skill install"
fi
echo "scaffolded $DEST"
# toolchain checks (warn, don't fail)
command -v ffmpeg >/dev/null || echo "WARN: ffmpeg not on PATH"
node -e "require.resolve('playwright', { paths: [process.cwd()] })" 2>/dev/null \
  || echo "WARN: playwright not resolvable from $DEST → run: npm i -D playwright && npx playwright install chromium"
# shared python env (created once, ~1 min the first time): every python script runs as .venv/bin/python scripts/<x>.py
PYBIN="$(sh "$SKILL/scripts/pyenv.sh" 2>/dev/null | tail -1)"
if [ -x "$PYBIN" ]; then ln -sfn "$(dirname "$(dirname "$PYBIN")")" .venv && echo "linked .venv → shared env ($PYBIN)"
else echo "WARN: shared python env failed → run: sh $SKILL/scripts/pyenv.sh"; fi
node film/lib/motion.test.js >/dev/null && echo "motion.js tests pass"
node scripts/sync.mjs >/dev/null && echo "film/data.js written (nominal grid until beats.json exists)"
echo "next: fill brief.md, then follow SKILL.md step 2 (assets)"
