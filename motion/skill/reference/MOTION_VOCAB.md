# Motion vocabulary: the house style ("cómo se mueven los textos y la UI")

This is the house style that the base styles build on: explainer reels and classes share the same family.

Measured with `ref_analyze.py`: **only 7 hard cuts in 20 s (0.3 cuts/s)**. The energy is not editing. It is **continuous motion design**: the frame keeps transforming. Type builds word by word on the beat, real UI assembles piece by piece, a cursor acts on it, cards stack, a number rolls, and a brand motif becomes the transition.

Default to this vocabulary when the user asks for "dynamic" or "like the house reel". Code to copy from is in those projects' `film/film.js`; the line numbers mark each section.

| Move | What it looks like | Where (film.js) |
|---|---|---|
| **Word-per-beat stack** | Huge heavy type (Inter 800 / Oswald), one word per line, each rising through its mask ON a beat; stacked left-aligned; frame 0 already reads word 1 | el reel de referencia `words()` l.32, hook l.71 |
| **Accent on the payoff** | The second phrase or key word turns brand accent (e.g. the last word of the hook, the price word, the benefit) | el reel de referencia hook / 3a / 3c |
| **Punctuation motif** | The brand dot or period pops on every statement, then **scales up to fill the frame** as the transition (accent-colour iris) and closes as an iris later | el reel de referencia b7→b8, b35.5 |
| **Wordmark slam + type-on** | Logo slams in heavy on a hit, the rest types after it (brand name, then the domain suffix) | el reel de referencia product l.112 |
| **UI assembles itself** | Real UI crops (Playwright 3x) fly into place one per beat: nav → badge → H1 → CTA pill grows → card rises in perspective → camera pushes into the CTA | el reel de referencia l.112–205 |
| **Cursor acts** | An eased cursor glides, presses (scale-down) on a beat with a click SFX, and the UI responds (row expands, card lifts, check stamps) | el reel de referencia `cursor()` l.63 · la clase de referencia `runCursor()` l.53 |
| **Notification stack** | Cards drop in like push notifications on a night background, stacking with snappy springs | el reel de referencia 3b l.239 |
| **Cascade + push past camera** | A grid of cards cascades in, then is pushed past the camera into the next scene | el reel de referencia 3c l.264 |
| **Slot-roll counter** | A big number rolls 0→N with ticks, lands with a thump; the label rises; a list reveals one group per half beat | el reel de referencia l.303 |
| **Living end card** | Wordmark slam, the dot pops last, CTA pill grows, the dot pulses; never static, ≤ 2 s | el reel de referencia l.362 |
| **Colour fields** | Background flips between brand white, brand accent field and night on bar lines; that flip is the cut | el reel de referencia throughout |

**Feel:** spring physics (heavy for type and logos, snappy for UI and pills), no fades, everything lands on the beat (`spHit`), micro camera push on holds, real UI never redrawn.

**For CapCut delivery:** almost all of this is a **rendered graphic clip** (it can't be native CapCut layers). Plan the CapCut project as rendered motion-design segments plus native footage cuts, static editable text and audio tracks, and tell the user. The CapCut-editable part grows with how much real footage the reel uses.
