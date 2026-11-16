# Captions: catalog and how to learn new formats

Captions are a growing library. Every format the user likes becomes a **named preset** in `captions/presets.json`,
which is tested in the **lab** and logged in the catalog below. Over time the user picks a look by name instead of
describing it.

## House defaults (the user decided on 2026-11-09 to keep both)
| Preset | When |
|---|---|
| `pill-sobrio` | Premium, medical, B2B (clínicas, marcas médicas). Quiet, and never competes with the film's own type. Works in CapCut too. |
| `karaoke-amarillo` | Talking heads, education, and VO-led social ads (talking heads propios). Spoken word in yellow, Montserrat ExtraBold, black outline. MP4 only. |

In the interview (INTERVIEW.md round 3), recommend one of these two by reel type, then offer the catalog.

## Catalog
| Preset | Look | Use for | Learned from | Added |
|---|---|---|---|---|
| `pill-sobrio` | Phrase on a dark pill, sentence case | Premium / medical | v2 default | 2026-10-11 |
| `karaoke-amarillo` | 3–4 word chunks, spoken word yellow + bump | Talking heads, education | AutoCaptions-type packs | 2026-11-09 |
| `pop-energia` | Words pop in as spoken, overshoot | Energetic ads, offers | Viral word-pop packs | 2026-11-09 |
| `box-marca` | Accent box slides under the spoken word | Brand-coloured highlight | Highlight-box packs | 2026-11-09 |
| `palabra-hook` | One huge word at a time | Hooks, punchy VO | Single-word packs | 2026-11-09 |
| `subrayado` | Sentence case, upcoming words dimmed, underline slides | Calm read-along | Knob demo | 2026-11-09 |
| `caja-blanca` | Dark words on a white card, spoken word in accent | Busy or light footage | TikTok-style boxed captions | 2026-11-09 |

Look at them all: `sh <skill>/scripts/caption_lab.sh all` writes `caption-lab/all.mp4`, all presets side by side
with voice.

## Using one in a reel
```json
"captions": { "formats": ["9x16"], "preset": "karaoke-amarillo", "accent": "#00C2A8", "keywords": ["gratis"] }
```
The project's keys override the preset (brand accent, y, keywords, emoji). Run `scripts/words.py` and then
`sync.mjs`. Projects created before 2026-11-09 have no `film/lib/caption_presets.json` and no
`assets/fonts/captions/`, so copy both from the skill, along with the new `captions.js`, `core.js` and `sync.mjs`.

## Learning a new format from a reference
The user sends a video, link or screenshot ("quiero subtítulos así"). Take the **format**: type, colour roles,
chunking, motion and timing. Never take the content.

1. **Get frames.** For a video, run `ref_analyze.py` (REFERENCE.md §2), then take a dense strip around 2–3 caption
   changes: `ffmpeg -ss <t-0.1> -t 0.6 -i ref.mp4 -vf fps=60,crop=iw:ih*0.35:0:ih*0.5,tile=6x6 strip.jpg`. LOOK at it.
   For a screenshot, you can only read the static look; ask for a clip if the motion matters.
2. **Measure, and write it down:**
   - **Type:** family class (geometric sans? condensed? rounded?), weight, case, size as % of frame width, letter spacing.
   - **Colour:** base colour, spoken-word colour, keyword colour, already-spoken colour. Sample the pixels.
   - **Edge:** outline width (× size), shadow, background card (colour, radius, padding).
   - **Chunk:** words on screen at once, line count, where it breaks, and whether filler words are dropped.
   - **Reveal:** whole chunk at once, or word by word? What do upcoming words look like (shown / dimmed / hidden)?
   - **Highlight:** colour change, box, underline, scale bump, or none? Does it slide or jump?
   - **Motion:** chunk entrance and word entrance (pop overshoot %, rise distance, fade), exit, tilt.
     Count frames at 60 fps.
   - **Position:** y as a fraction of H, and whether it moves.
   - **Extras:** emojis, icons, sound on each word.
3. **Map it to knobs** (header of `engine/lib/captions.js`: style, enter, wordIn, highlight, bump, upcoming,
   pastColor, bg, stroke, tilt…). Most formats are a new combination. When no combination expresses the
   reference, add **one generic knob** to captions.js. Never write special-case code for one reference. Keep
   determinism, and check it with `render.mjs --verify`.
4. **Font:** if the family is free (Google Fonts, OFL), add the TTF to `captions/fonts/` and set `fontFile`. If not,
   use the closest free match and say so.
5. **Save** the preset in `captions/presets.json` with a Spanish slug and `_meta` (useFor, learnedFrom, added).
6. **Test in the lab:** `sh <skill>/scripts/caption_lab.sh <slug> --bg <reference still>`. Put the lab still next to
   the reference frame and compare type, weight, colour, edge and position. Then watch the mp4 for timing and motion.
   Iterate until a side-by-side comparison passes, then send the user the lab mp4 next to the reference.
7. **Log** a row in the catalog above, and add any new knob to the knob list. On the user's OK, update the skill
   files.

Caption formats are part of the user's taste memory: when a reference repeats choices (say, yellow keywords),
note it in the brand memory or in the user's profile.
