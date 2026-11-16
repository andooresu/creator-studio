# Emulating a reference (the user's main brief tool)

The user acts as client and creative director, and sends references ("make it like this"). el reel de referencia and la clase explicativa de referencia were built this way. Take the reference's **grammar**: rhythm, type motion, transitions, colour roles, camera, sound sync. **Never take its content**: footage, words, logos, music.

## 1. Get the file
- Ask for the video file. For a link, ask the user to download it, or download it only with explicit permission. Save it as `refs/<slug>.mp4`.
- Note the format, the platform it came from, and what the user likes about it, in their words. That sentence is the success criterion.

## 2. Measure it
```
.venv/bin/python scripts/ref_analyze.py refs/<slug>.mp4 [--bpm <known tempo>]
```
This writes `refs/<slug>/`:

| File | What it holds |
|---|---|
| `shots.json` | Cuts and shot table (start, end, duration, motion, colours), tempo, phase-free cut rhythm (`intervals_on_half_beat_grid`), palette |
| `sheet_shots.jpg` | First and middle frame of every shot |
| `sheet_time.jpg` | A frame every 0.5 s: reads type animation, transitions and camera |
| `energy.png` | Motion energy. Red = cuts; peaks between cuts = punches, whips, kinetic type |
| `palette.png` | Dominant colours |

Then LOOK: read every sheet. For fast transitions, extract frames around a cut (`ffmpeg -ss <t-0.2> -t 0.4 -vf fps=30 …`) to see exactly how it is built (wipe direction, mask shape, blur, overshoot).

## 3. Write `refs/<slug>/breakdown.md` (template generated)
Fill the shot table ("what happens", "transition in") and every grammar line: hook, acts and energy curve, cut rhythm in beats, type behaviour (class, size vs frame, entry and exit, words per beat, accent rule), transitions catalogue with timings, camera and footage motion, colour roles and texture, graphics, sound (genre, BPM, SFX on cuts, VO style, silences).

End with **the 3 decisions that make it work**. Those are what the critic checks.

## 4. Translate to the brand
- Map each grammar point to the client's real material, brand palette and fonts, and message. Keep the reference's rhythm numbers: cuts per bar, words per beat, hold lengths. Use them in the shotlist (beats on our measured grid, never the reference's seconds).
- **Colour wipes and accent motifs** take the brand accent's tonal ramp. Example: the brand's accent dot scaled up to become the transition.
- Put the measured shot table in `docs/style_guide.md` (Rhythm) and cite the reference in the shotlist.
- **For CapCut delivery** (CAPCUT.md), mark what is native (footage cuts, static text, simple transitions) and what is a **rendered graphic clip** (kinetic type, colour wipes, iris, counters, UI fly-ins). Tell the user up front.

## 5. Critique against the reference
Give the critic `refs/<slug>/breakdown.md` and the two sheets. It scores "matches the reference's grammar" inside Variety/pacing and Motion quality, and checks the 3 key decisions frame by frame, side by side (the reference's `sheet_time.jpg` vs ours).

## Library of past references
Keep each analysed reference in `refs/` of its project. When a new one arrives, compare it with past breakdowns: the user's taste repeats (kinetic type, colour transitions, real UI or real results, a strong sound hit). Record recurring choices in memory.
