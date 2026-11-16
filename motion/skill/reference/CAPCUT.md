# CapCut delivery (default hand-off)

The client finishes and re-edits in **CapCut desktop (Mac, 9.x)**. So the deliverable is one **editable CapCut project per format**, built from the ORIGINAL clips, plus MP4s only if asked.

Library: `capcut/capcut_lib.py`. Worked example: `capcut/capcut_lib.py (ver CAPCUT.md)` (copy it to `<project>/scripts/capcut_project.py` and adapt it). Probado en reels reales.

## What goes in the project
| Layer | Source | Editable in CapCut |
|---|---|---|
| Main video track | **Original client clips** (full files) with the shot's in-point and duration. Framing = scale + offset (full canvas) or crop (smaller box). Upside-down footage gets clip rotation 180°. | Trim or extend into the full original, reframe, replace |
| Overlay video tracks | Split screens and grids built natively, one original per box | Yes |
| Rendered graphics | Only what CapCut can't make natively: letters-as-windows, logo sheen, kinetic or colour-wipe sequences. Cut from the **no-type plate**. | Replace or remove |
| Text tracks | Every on-screen line as a CapCut text layer (brand TTF, colour, multi-size styles such as "Es" small + word big) | Yes. Entry animations are NOT transferred; add them in CapCut |
| Audio tracks | Music · VO, one clip per phrase at its placed time · SFX stem | Yes |

Lost in translation, so tell the user: engine-only motion (push transitions, zoom punches, kinetic per-word rises), and **animated captions** (`captions.style` karaoke/pop/box/word). For those, either deliver the MP4 (recommended when the caption style is the point), or in CapCut use plain text layers per chunk with a native `Pop Up` in-animation and say that the word-level highlight is lost. Recreate it in CapCut with native transitions and animations, or ship that stretch as a rendered graphic clip.

## Workflow (after the critique loop says SHIP)
1. **Rendered graphics only, never full plates.** A full 30 s, 3-format, motion-blurred no-type render took over an hour. The two graphics took 6 min with `--range`. In no-type mode, render just each graphic's span per format:
   ```
   node scripts/render.mjs --range <a>,<b> --fmt <fmt>    →  renders/clip_<fmt>_<a>-<b>.mp4   (gfx() in the example picks these up)
   ```
   Always restore the flag and re-run `sync.mjs` afterwards. A stale `film/data.js` with notext silently hides all type in stills and lint. Older notes on no-type plates:
   - Gate every type scene in film.js on `const NOTEXT = !!(TL.render_flags && TL.render_flags.notext)`.
   - Set `"render_flags": {"notext": true}` and only the formats you need in `timeline.json`.
   - Run `sync.mjs` and `render.mjs --all --fps 30`, move `renders/<fmt>.mp4` → `capcut_export/plates/plate_<fmt>.mp4`.
   - Remove the flag again.
2. **Write `scripts/capcut_project.py`** from the example:
   - The shot table mirrors film.js: track, beats, source file, in-point, box, anchor, zoom, rot180, label. Each caption must show THAT service.
   - Text blocking mirrors film.js in design px: top-left (x, y) of each block.
   - Audio: music, VO phrases sliced from `audio/vo.wav` at `vo_placed.json` times, SFX.
3. **Close CapCut**, then run `.venv/bin/python scripts/capcut_project.py` (it refuses while CapCut runs). Test first with `--root /tmp/x`.
4. Ask the user to open the projects and check: media loads, split/grid boxes, rotated clips, text size and position. If something is off, ask for the **CapCut UI values (size, X, Y)** of one element and fix the rule (see Calibration). Never guess twice.

## Facts about CapCut's format (Mac 9.5, new_version ~185)
- **Location:** drafts in `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<name>/`. Registry in `root_meta_info.json` (`all_draft_store`); the library backs it up into `capcut_export/`.
- **Plain JSON:** `draft_info.json` is plain JSON and duplicated in `Timelines/<timeline id>/draft_info.json`. Also `Timelines/project.json`, `timeline_layout.json` and `draft_meta_info.json` (`draft_materials` type 0 lists the imported videos).
- **Schema:** cloned from the user's own drafts. The samples and an empty-draft skeleton are in `capcut/schema/`. Every id is a fresh UUID; times are in **microseconds**.
- **Video:** a material (`type: video`, path, displayed width/height, `crop` as 4 normalised corners). Its segment has `source_timerange` (in-point), `target_timerange`, `clip {scale, rotation, transform, flip, alpha}`, volume 0 for picture-only, and extras (speeds, canvases, placeholder_infos, sound_channel_mappings, material_colors, vocal_separations, material_animations).
  - Main video track: `flag 0`. Overlays: `flag 2`, with `render_index` / `track_render_index` = overlay number.
- **Text:** a material (`type: text`, `content` = JSON `{styles:[{fill, range:[utf16 start,end], size, font:{path}}], text}`, `font_path`, `font_size`, `alignment 0` = left). Segment `clip.transform` is the **centre of the text box**.
- **Audio:** a local file is `type: extract_music`, `category_name: local`.
- **Sandbox:** CapCut only reads media **inside its own draft folder** (or files the user imported by hand). Media in `~/Documents/...` shows as missing.
  - The library copies everything into `<draft>/media/` with **ASCII filenames** (no ñ or accents).
  - Once CapCut saves, it rewrites in-draft paths as `##_draftpath_placeholder_<id>_##/media/…`; treat that prefix as "inside the draft".
- **CapCut must be closed** while drafts are written. It overwrites them on save.

## Calibration (client-measured, 16:9 text layer)
- **Position:** UI **X = transform.x × W**, **Y = −transform.y × H** (UI Y points DOWN), measured from the canvas centre. Verified exactly: transform (−0.529, −0.456) shows as X −1016, Y 492.
- **Text size is relative to the canvas WIDTH:** CapCut size = **design px ÷ 11 × (1920 / W)**. That is 12 for a 132 px line on 16:9, and ≈ 18 for a 116 px line on 9:16, where the client first measured 11 as too small. Text then renders at ≈ design px × 8.7 / 11 (≈ 0.79×, the client's preferred scale) in every format. The library recomputes each box centre from that rendered size, so the design's left edge and top line hold.
- **Video framing:** full-canvas box → scale = cover × zoom ÷ contain-fit, offset from the anchor. Smaller box → crop the material to the visible part, then fit the crop into the box.
  - **Unverified:** that CapCut re-fits a cropped clip. If split or grid boxes land wrong, get UI values from the user and correct `place()`.

## Fix-ups
- `capcut/textscale.py <factor>` scales all text in place.
- `capcut/localize_media.py` copies outside media into existing drafts.
- Both back up every file first and refuse while CapCut runs.

## Motion in the CapCut project (native, editable)
The engine's motion is rebuilt with CapCut's own tools, so the client keeps editing it:
- **Keyframes:** `video(..., kf=[(t, scale_mult), …])` writes `KFTypeScaleX` keyframes with uniform scale. Use them for the slow push-in across a clip, a punch on a beat (base → ×1.09 → base over 0.3 s), and the grid-cell pop (0.86 → 1 in 0.2 s). Helper: `motion()` in the example.
- **Transitions:** `video(..., trans_out='Heat Swipe')` puts the transition on the cut AFTER that clip. Presets: Heat Swipe, Glare, Glare II, Twinkle Zoom, Camera Glow, Passing Light.
- **Text animations:** `text(..., anim_in='Slide Up' | 'Pop Up' | 'Fade In' | 'Typing Cursor' | 'Letter Pop-In' | …, anim_out=…)`.
- **Where the presets live:** `capcut/schema/effects.json`, cloned from the user's own drafts. CapCut re-downloads an effect by its id when the local cache misses it.
- **Coherence with motion:** split title and benefit into separate text layers. The benefit layer starts on the RESULT cut, never over the process.
