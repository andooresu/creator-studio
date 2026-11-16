---
name: motion-reel
description: Produce a beat-synced product launch reel / showreel / promo video in code. The pipeline interviews the user until the brief is exactly their video, captures a product URL's real brand assets, writes a style guide, measures the beat grid, and gets a shotlist approved. It then builds a deterministic seek(t) film with springs, lints the live DOM, runs 2+ scored critique rounds to 8+, and delivers editable CapCut desktop projects (one per format, built from the original clips; MP4s on request) with an original per-project music track (checked distinct from previous reels), SFX and optional voiceover in 16:9, 1:1, 4:5 and 9:16. Use when the user asks for a launch video, product reel, motion reel, showreel, promo, sizzle or social ad for a product or URL, or says "motion-reel".
---

# Motion reel

A film is a pure function of time. `window.seek(t)` paints frame t in headless Chromium, and ffmpeg encodes it. Picture and sound share one `timeline.json` in beats on a measured grid.

**Read before building:** [reference/RULES.md](reference/RULES.md) (contract, look, rhythm, motion, sound).
**Start with:** [reference/INTERVIEW.md](reference/INTERVIEW.md) (the creative interview) and [reference/STRATEGY.md](reference/STRATEGY.md) (**ad strategy & concept method** — every concept is built with it and scored on its 10-point checklist).
**Also here:** [reference/ENGINE.md](reference/ENGINE.md) (engine API, patterns, commands), [reference/AUDIO.md](reference/AUDIO.md) (music, grid, SFX, VO, mix), [reference/CRITIQUE.md](reference/CRITIQUE.md) (critic prompt), [reference/CAPCUT.md](reference/CAPCUT.md) (**default hand-off: editable CapCut projects**), [reference/REFERENCE.md](reference/REFERENCE.md) (**emulating a reference video** — the user's main brief tool), [reference/MOTION_VOCAB.md](reference/MOTION_VOCAB.md) (**the user's favourite motion style** — house kinetic type + UI that assembles itself).
**Toolchain:** node + playwright (chromium), ffmpeg, python3 with numpy, scipy, soundfile, librosa, pillow and fonttools. `init.sh` checks them. CapCut desktop (Mac) for the hand-off.

## 0. Creative interview (always — before scaffolding or generating anything)
Interview the user until the brief is exactly their video. Follow [reference/INTERVIEW.md](reference/INTERVIEW.md):
research the site first, then up to 4 AskUserQuestion rounds (≤ 4 questions each, concrete options with the
recommended one first, previews for concepts/music/layout), each round building on the last:
1. **Goal & concept** — objective and placement, audience persona, 3 buildable concepts, length & formats
2. **On screen** — real material vs AI ambience, people + consent, verified proof (and which sources may be NAMED), brand don'ts
3. **Look & sound** — visual direction, music direction (then generate variants and let the user pick by ear; must pass the own-sound gate, AUDIO.md §1), voice persona (then audition on the real CTA line), captions
4. **Action & confirm** — CTA destination and wording, must-show, references, then a one-screen creative brief summary the user explicitly confirms

Output: `brief.md` with no `?` left and a **Rules** section (every don't, verbatim), plus a memory note for the brand so the next video starts from those decisions. Repeat client → confirm last time's rules and ask only what changes. "Tú decide" → recommended option, stated in the summary.

If the user names a preset, apply it in step 1. `--preset <name>` looks in the project's `presets/` first, then in this skill's own `presets/` (`blank`, plus any the user added): it fills the brand, colours, fonts, timeline defaults, voiceover and house notes — skip the interview questions it already answers.

If the user will supply photos/footage, create `videos/<slug>/assets/real/{equipo,estudio,resultados}/` during the interview and say where to drop them — `init.sh` accepts a folder that holds only `assets/`.

## 1. Scaffold
Python scripts run with the shared env: `.venv/bin/python scripts/<x>.py` (`init.sh` links `.venv` → `<skill>/.venv`, built once by `scripts/pyenv.sh`).
```
sh <skill>/scripts/init.sh videos/<distinctive-slug> [--preset presets/<name>]
```
`--preset` runs `scripts/preset.mjs`. It copies the preset's fonts to `assets/fonts/`, writes its colour tokens into `film/index.html`, merges its timeline defaults and prefills `brief.md`. Start from `presets/blank/preset.jsonc`, which documents every field.
Parallel sessions may run the same brief. `init.sh` refuses an existing folder, so never write into one you didn't create. Work from the project root from here on.

## 2. Assets
```
node scripts/capture.mjs <url> --sections "Feature A,Feature B,Get started"
```
This gathers real screenshots, font files, colours, CSS variables, logos and the OG image into `assets/`. Add anything the user supplies. Point `film/index.html` `@font-face` at the real display and UI faces, and set the `:root` tokens.
If a reference film is given (the usual case: the user acts as creative director and sends references to emulate), follow [reference/REFERENCE.md](reference/REFERENCE.md):
```
.venv/bin/python scripts/ref_analyze.py refs/<slug>.mp4 [--bpm <tempo>]   # cuts, shot table, rhythm, energy, palette, sheets
```
LOOK at the sheets, fill `refs/<slug>/breakdown.md` (grammar + the 3 decisions that make it work), and carry its rhythm into the style guide and shotlist. Take the grammar, never the content.

## 3. Style guide
Write `docs/style_guide.md` from the template: palette (measured hex and source), type, rhythm (the reference's measured shot table), transitions, camera, texture, text in/out, and sound. Take the reference's grammar, never its content.

## 4. Beat grid
Set the bpm, duration and marks in `timeline.json`. Then:
- **Original track (default):** generate 3–4 variants from a project-specific music brief (ElevenLabs Music, AUDIO.md §1), let the user pick by ear, edit the pick to length on downbeats into `audio/music.wav`, then `python3 scripts/beats.py audio/music.wav`.
- **Supplied music:** copy it to `audio/music.wav`, then `python3 scripts/beats.py audio/music.wav`.
- **Synth music (last resort):** `python3 scripts/music.py`, then `python3 scripts/beats.py audio/music.wav --stem audio/drums.wav`. Never with the template defaults (120 BPM, Am F C G).
- **Own-sound gate (every project):** `python3 scripts/compare_music.py` must print `distinct` against every previous reel before the shotlist goes to the user. Record the track's origin, genre, BPM and key in `timeline.json` `music`.

Then run `node scripts/sync.mjs`. Details: AUDIO.md §1.

## 5. Shotlist, then STOP for the OK
Write `docs/shotlist.md` from the template. Each shot needs beats and time, exact on-screen text, motion and transition, the SFX mark, the exact VO line, and 9:16 notes. It must satisfy the rules: hook by 2 s, something new every 2–4 s, end card ≤ 2 s.

Send the user a short summary: shotlist table, palette, fonts, music plan, VO voice, and the VO credit cost if any. **Wait for an explicit OK.** Build nothing until then. Mark the shotlist APPROVED, and reflect every change the user asks for.

## 6. Voiceover (only if requested)
**Audition on the real script, never on library previews:** filter voices by the persona from the brief (language, accent, age, descriptives), generate the CTA line with 3–4 candidates in one go, send the takes, let the user pick. Then one take per line, `vo.py --scan`, `vo.json`, `vo.py`, `sync.mjs`. ElevenLabs (`creative_generate_speech`, `eleven_v4`) or Fish Audio; details AUDIO.md §3.

## 7. Build with springs
Replace the starter scenes in `film/film.js`. One `C.scene()` per shot; marks and cues live in `timeline.json`. Use:
- `C.spHit` for anything with a sound
- `TYPE.rise` for type
- `C.pick` for per-format layout
- `Motion.indicator` / `track` for multi-target motion

Real media: `C.photo(parent, src, box, pos)` for stills; footage via `.venv/bin/python scripts/seq.py <name> <video> <start> <dur>` (pick windows with `seq.py --strip <video>`) and `C.seq` / `C.drawSeq` on a canvas (engine/lib/media.js). Captions come from `timeline.captions` + the placed VO automatically (engine/lib/captions.js): `style` pill · karaoke · pop · box · word, plus font, accent, keywords, emoji, y/yFmt/yAt — options in the file header. Word styles need `scripts/words.py` (AUDIO.md §3 step 6). Named looks: `captions.preset` (house defaults `pill-sobrio` and `karaoke-amarillo`); catalog, lab (`scripts/caption_lab.sh`) and **how to learn a new caption format from a reference**: [reference/CAPTIONS.md](reference/CAPTIONS.md).

Declare every SFX in `timeline.sfx` as you build it. After each edit, check with:
```
node scripts/lint.mjs --all                  # 5–20 s, no render: text too small, 9:16 UI zones, overlapping/cropped type, captions over type
node scripts/render.mjs --sheet [--fmt 9x16] # LOOK at review/sheets/*.jpg (Read the images)
node scripts/render.mjs --at 3.2,3.25 [--fmt 9x16]
node scripts/render.mjs --range 3,5
```
Verify determinism once, before the final render: `node scripts/render.mjs --verify --all` (must report all probes identical). Lint must be clean (or every remaining item consciously accepted) before any critique round.

## 8. Critique loop: until every score is ≥ 8 (target: 2 rounds; at least 2, the last on all formats)
Speed rule: rounds before the last iterate on the **primary format only** (usually 9:16); the other formats are judged in the final round. Each round:
0. `node scripts/lint.mjs --all` → clean. (Lint catches size/zone/overlap problems in seconds; don't spend a critic round on them.)
1. sound for sync scoring: `node scripts/sfx.mjs` (or the project's sample placer) `&& .venv/bin/python scripts/mix.py`
2. primary-only rounds: `node scripts/render.mjs --sheet --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16`; last round: `--sheet` per format and `node scripts/render.mjs --draft --all` (formats render in parallel)
3. `.venv/bin/python scripts/review.py <N> --draft [--fmt 9x16]`
4. **Critic:** spawn a fresh subagent with `reference/CRITIQUE.md`, the project path and N. It LOOKS at every sheet and strip, scores the 8 criteria with evidence, and appends the round to `docs/review_log.md`.
5. Fix the 3 worst problems, verify each fix with stills or clips, and log what changed.

Stop only when the verdict is SHIP: every score ≥ 8, at least 2 rounds done, the last one on every format. Keep the same critic agent across rounds (SendMessage) so it checks its own previous fixes. Never show the user a film before that.

## 9. Final render, SFX, mix, all formats
Default hand-off is CapCut (§10). Render final MP4s only when the user asks for them; the CapCut export still needs the mix (steps 2–3) and, for rendered graphics, the no-type plates (CAPCUT.md).
1. **Render** (on request): `node scripts/render.mjs --all` renders every format in parallel (adaptive 180° motion blur, ≤ 12 sub-frames). Use `--fps 30` for social-only delivery (Reels/TikTok/Shorts play 30 fps; half the time of 60). Check with `.venv/bin/python scripts/review.py final`.
2. **SFX:** re-check `metrics.sync` on the final. Nudge marks or gains in `timeline.sfx`, then run `sync.mjs` and `sfx.mjs`.
3. **Mix:** `python3 scripts/mix.py`. It must reach -14 LUFS with true peak ≤ -1 dBTP and print no WARNING.
4. **Audio-only changes:** `node scripts/render.mjs --mux --all` (seconds, no re-render). Measure the delivered MP4's true peak (AUDIO.md §4). Look at every `phone_*.jpg` and `safe_9x16.jpg`.

## 10. Deliver: CapCut projects (default)
Follow [reference/CAPCUT.md](reference/CAPCUT.md):
1. Render the no-type plates (only needed for the graphics CapCut can't make natively).
2. Write `scripts/capcut_project.py` from `capcut/capcut_lib.py (ver CAPCUT.md)`. The video comes from the **original clips** (in-points, framing, overlay tracks for split and grid). Text becomes editable layers with the calibrated size rule. Music, VO phrases and SFX go on separate tracks.
3. Ask the user to **close CapCut**, run the script (test first with `--root /tmp/x`), then ask them to open the projects and check:
   - media loads
   - boxes (split, grid, 16:9 panel) and rotated clips sit right
   - text size and position are right
   If anything is off, ask for the CapCut UI values (size, X, Y) of one element and correct the rule. Don't guess twice.

Report:
- the project names in CapCut (one per format) and what is editable vs rendered
- what doesn't transfer (engine-only motion: pushes, punches, kinetic rises) and how to recreate it in CapCut
- final scores (the table from `review_log.md`) and the contact sheet
- MP4 paths, duration and loudness, if renders were requested
- anything knowingly left imperfect

Offer tweaks. Changes go through `timeline.json` / `film.js` (then `--draft`, `review.py`) and are re-exported to CapCut, or the user edits directly in CapCut.
