# Audio: grid, music, SFX, voiceover, mix

All commands run from the project root.

## 1. Music → beat grid
**Every reel gets its own sound.** `music.py` is a single hard-coded recipe (same kit, same FM mallet, same motif, same patterns); two reels made with it measure timbre 1.00 / rhythm 1.00 in `compare_music.py`, even with different seeds — the seed only changes noise texture. So the default is an original track per project:

**Original track (default) — ElevenLabs Music** (`creative_generate_in_flow`, `node_type: "music"`, `model_id: "eleven_music_v2_5"`):
1. Write a music brief for THIS brand: genre/sub-genre, BPM, key instruments, mood, production style, and the energy curve against the shotlist ("quiet intro 0–3 s, groove from ~8 s, swell ~14 s, clean resolved ending"). Describe sound only. Say "instrumental, no lyrics" — the instrumental flag is not exposed and defaults to off.
2. Generate 3 variants of the chosen direction + 1 contrasting direction in one flow (`generations_count`). Download them to `audio/variants/` (signed URLs expire in 2 h).
3. Analyse each (tempo, energy every 2 s) and send them to the user to pick by ear, with a recommendation tied to the shotlist (quiet start under the first VO, groove where the cuts accelerate, a clean ending for the logo).
4. The tracks come back ~40 s long whatever length you ask for. Run `beats.py` on the full pick, then edit it to the film length by joining segments on **downbeats** (e.g. intro + a later groove + the natural ending) with ~12 ms equal-power crossfades cut a few ms before each downbeat, so the real ending lands on the logo mark. Write `audio/music.wav` (48 kHz), set `timeline.bpm`, rerun `beats.py audio/music.wav`.
5. `python3 scripts/compare_music.py` → must say `distinct` against every previous reel.

**Synth fallback** (`music.source: "synth"`, only when no generator is available): change the bpm, key/chords and section layout away from the template defaults and away from the previous reels, then still pass `compare_music.py`. Write `timeline.music.chords` (one per bar) and `sections` against the marks. Kinds: `intro` · `full` · `dark` · `build` · `gap` · `drop` · `outro`; see the header of `scripts/music.py`. Put `accents` on the logo and CTA.
**Synthesize** (`music.source: "synth"`): write `timeline.music.chords` (one per bar) and `sections` against the marks. Kinds: `intro` · `full` · `dark` · `build` · `gap` · `drop` · `outro`; see the header of `scripts/music.py`. Put `accents` on the logo and CTA.
```
python3 scripts/music.py                                   → audio/music.wav + audio/drums.wav
python3 scripts/beats.py audio/music.wav --stem audio/drums.wav
node scripts/sync.mjs
```
**Supplied track:** copy it to `audio/music.wav` (48 kHz WAV: `ffmpeg -i in.mp3 -ar 48000 audio/music.wav`), set `timeline.bpm` to its tempo (hint), and run `beats.py audio/music.wav`. If the track is longer than the film, pick the section first: trim with `-ss/-t`, choosing a window whose drop lands on your logo mark. Put the marks on its `downbeats`. If `beats.py` reports a downbeat phase other than 0, shift marks or trim so bar 1 starts on beat 0.

Check `beats.py` output. The max grid residual should be < 15 ms. If snapped beats are few or the BPM is off by 2×, fix the hint and rerun.

## 2. SFX
`sfx.mjs` synthesizes the same click/pop/whoosh set in every project. For a distinct sound, generate a small sample set per project (ElevenLabs `node_type: "sfx"`, `eleven_text_to_sound_v2`: e.g. tap+chime, a brand-appropriate swish, a shimmer, a ping), measure each sample's onset (`librosa.onset.onset_detect`) and place the samples on `cues.json` with a per-type lead. Otherwise:
Declare every sound in `timeline.json` `sfx`, by mark or beat, with a `what`. `sync.mjs` snaps each cue to a measured hit within ±40 ms. Then:
```
node scripts/sfx.mjs                                        → audio/sfx.wav
```
| type | use | timing |
|---|---|---|
| `pop` | something appears (word, pill, card) | on the cue |
| `click` | cursor press, button, send | on the cue |
| `tick` | typing (use `every: 0.25` over the typing window) | on the cue |
| `whoosh` | whip, morph, push-through | builds 0.3 s, PEAKS on the cue (put the cue on the landing) |
| `riser` | build into a drop | builds 2 s, PEAKS on the cue (put the cue on the drop) |
| `thump` | logo, impact | on the cue |
| `shutter` | hard cut, wipe | on the cue |
Gains: primary hits 0.7–0.9, secondary 0.45–0.6, texture 0.3–0.4. Don't stack more than two sounds on one frame.

## 3. Voiceover (when the brief asks for it)
**ElevenLabs** (`creative_list_voices` filtered by the brief's persona → `creative_generate_speech`, `eleven_v4`, one node per line in the project's flow): audition the CTA line on 3–4 voices first and let the user pick by ear — library previews mislead (a "warm" preview can read as sensual). Then follow steps 4–7 below with the downloaded takes. Placed phrases feed the 9:16 captions automatically (`timeline.captions`).

**Fish Audio MCP:**
Tools: `search_voices`, `get_voice`, `text_to_speech` (returns a permanent audio URL), `get_credit_balance`.
1. Write the script one line per shot, in the shotlist. Short lines of 2–3 s each, with the brand's punctuation.
2. Cost is 1 credit per UTF-8 byte of text, audio tags included. Put the total byte count and `get_credit_balance` in the shotlist message, so the user's OK covers the spend.
3. Choose the voice. Test the TIGHTEST line on 2–3 candidates first; most narrator voices read too slowly for 2–3 s beats. A confident, energetic narrator voice usually fits. Start with the one the user names, or search `search_voices` (language en, sort by task_count). Avoid celebrity-clone voices.
4. Generate one `text_to_speech` call per line. Add delivery tags such as `[confident]` or `[fast-paced]` in brackets; they are performed, not spoken. Download each take: `curl -L -o audio/vo/l1.mp3 "<url>"`.
5. Run `python3 scripts/vo.py --scan` to list the speech segments in every take. Write `vo.json` phrases: cut at silences, `at` = the beat or mark where the phrase starts, and `tempo` 0.85–1.2 only on a phrase that must fit.
6. Run `python3 scripts/vo.py` (→ `audio/vo.wav`, `audio/vo_placed.json`). For animated captions (any `captions.style` but `pill`) or kinetic type on single words, run `.venv/bin/python scripts/words.py` (faster-whisper word stamps aligned to the vo.json text → `audio/vo_words.json`, ~15 s; mark keywords `*like this*` in the vo.json text). Then `node scripts/sync.mjs`. `window.VO` holds phrase times and, with words.py, `VO[i].words = [{w, t0, t1, k}]`, so kinetic words land with the voice (`C.beatAt(p.t0)`). Re-run words.py whenever vo.py runs (sync.mjs warns when it is stale); listen to any phrase it flags below 80 % matched.
7. Words on screen match the VO word-for-word, or they're a deliberate shorter caption. Never a paraphrase.

## 4. Mix and master
```
python3 scripts/mix.py            → audio/mix.wav  (-14 LUFS integrated, true peak ≤ -1 dBTP, 48 kHz 24-bit)
```
- **Codec headroom:** AAC encoding adds ~1 dB of true peak. Measure the MP4 itself (`ffmpeg -i renders/9x16.mp4 -af ebur128=peak=true -f null -`); if it exceeds -1 dBTP, lower the limiter in `mix.py` (e.g. `limit=0.75`, about -2.5 dBTP).
- **Levels:** set them in `timeline.mix` (dB). SFX default to -3 dB under the music.
- **Ducking:** music ducks under the VO with a side-chain.
- **Loudness:** linear gain into a limiter at 4× oversampling (synth transients produce inter-sample overs).
- **Warnings:** if it prints a WARNING, the limiter is working too hard. Lower the loudest stem, usually SFX, and rerun.
- **Muxing:** `render.mjs` muxes `audio/mix.wav` automatically. After a remix, run `node scripts/render.mjs --mux --all` instead of re-rendering.

## 5. Sync checks (review.py)
`metrics.json.sync` lists, per cue, the visual onset minus the audio onset.
- **Target:** hits (pop, click, thump, shutter) within ±45 ms.
- **Picture late (positive):** lead the visual with `C.spHit`, or move the cue.
- **Picture early (negative, beyond -45 ms):** reduce the lead.
- **Whoosh/riser:** these build into their cue by design. Judge them by ear and eye.
