# Creative interview: understand exactly the video the user wants

Run this BEFORE scaffolding or generating anything. The goal is a brief the user recognises as "exactly my video".
Every question the user has to answer later (a rejected voice, a forbidden brand name, a missing CTA) costs a build
or critique round; asking it here costs seconds.

## Principles
- **Research first, then ask.** Before round 1, read the site (and Google profile / booking page / socials the user
  gave). Questions offer concrete options grounded in what you found: real services, real claims, real faces. Never ask
  something the site already answers; state it and let the user correct it.
- **Options, not open questions.** Use AskUserQuestion: 2–4 options per question, the recommended one first and marked
  "(Recomendado)", each with a one-line consequence. Use `preview` for options that are easier to judge visually
  (concept storyboards, music structure vs timeline, layout sketches). "Other" is always available for free text.
- **≤ 4 questions per round, 4 rounds max.** Each round builds on the previous answers. Skip a question when the
  answer is already known (brief, preset, earlier answer, memory of past projects for this brand).
- **Speak the user's language** (questions in Spanish for a Spanish-speaking user), plain words, no jargon.
- **Read answers literally.** If an answer adds a constraint ("no menciones X", "suena erótico"), restate it as a rule
  in the brief and in memory, and re-check every planned line, on-screen text and asset against it.
- **Things to hear, hear them.** Music and voice are chosen by ear: generate the candidates (AUDIO.md §1, §3) and send
  the files during the interview rather than describing them.

## Round 1 — Goal and concept (what is this video FOR?)
Ask together:
1. **Objective & where it runs:** e.g. paid ads (Reels/TikTok) to book appointments · organic brand film · launch of a
   new service · recruiting / talent side · event. (Drives duration, CTA, captions, formats.)
2. **Audience:** who must feel "this is for me" — offer 2–3 personas inferred from the site (e.g. "mujer 30–40,
   ejecutiva, alto poder adquisitivo"). Ask for what they value and what would put them off.
3. **Concept:** build them with [STRATEGY.md](STRATEGY.md) (reason to exist → insight → angle → one emotion → hook → structure → proof → CTA) and show each with its checklist score. 3 distinct concepts you can actually build, each with a one-line story and a 4–6 beat preview
   (hook → middle → proof → CTA). Typical families: a mini-story of the customer journey · a service menu / catalogue ·
   a signature/hero offer · team & expertise · before/after with real results · founder's voice.
4. **Length & formats:** 15 s / 20 s / 30 s; 9:16 only vs all four formats.

## Round 2 — What appears on screen (truth, people, proof)
1. **Material:** real footage/photos the user can supply (results, studio, team, product) vs motion graphics only vs
   hybrid with AI ambience. Rule: AI never fakes results, people or the user's premises.
2. **People on screen:** who appears, with names/roles exactly as they should read, and confirm written consent.
3. **Proof & claims:** offer the verified options you found (rating + source + count, awards/years, "N clients",
   press). Ask which may be shown and which source may be NAMED — some platforms are context only.
4. **Brand don'ts:** names, platforms, competitors, words, prices or claims that must never appear; anything legally
   sensitive (medical/aesthetic results, guarantees).

## Round 3 — Look and sound
1. **Visual tone:** 2–3 directions drawn from the brand (e.g. "lujo cálido: negro + dorado, Tenor Sans" · "clean
   clinical: white + one accent" · "editorial bold"), each with a preview of palette + type + one frame description.
2. **Music direction:** 3 genre/mood directions with BPM and instruments that fit the audience and differ from the
   previous reels (check `videos/*/timeline.json` music + `compare_music.py`). Then generate 3–4 variants and send
   them; the user picks by ear (same round or the next message).
3. **Voiceover:** none · VO-led · VO only on the CTA. If VO: the **persona** (age, role, attitude) and what it must
   NOT sound like. Then audition 3–4 voices on the real CTA line and send the takes.
4. **Energy of the cut:** dynamic (pushes, zoom punches, kinetic type, colour wipes; the default for social) · editorial (slow, hard cuts, silence). Ask; a client found an unrequested editorial cut "boring".
5. **Captions:** burned-in on 9:16 (recommended: feeds autoplay muted) · none. If burned in, recommend one of the two house defaults by reel type: `pill-sobrio` (premium / medical / B2B, also works in CapCut) or `karaoke` (talking heads, education, VO-led social, MP4 only). Then offer the catalog (reference/CAPTIONS.md: pop, box, single word, underline, white card…) or a reference to learn from. Ask which words are keywords (accent colour, bigger) and whether emojis fit the brand. Word styles are MP4-only: in a CapCut hand-off they ship as a rendered caption clip (CAPCUT.md).

## Round 4 — Action and confirmation
1. **CTA destination:** website · Instagram handle · WhatsApp · booking link · store — and the exact wording.
2. **Must-show:** the 1–3 things the viewer must remember (a service, a price "desde", a promo, a location).
3. **Reference:** any video/brand they love or hate (link or name) — take its grammar, never its content.
4. **Confirm the creative brief:** send a short summary (objective, audience, concept beats, material, people, proof,
   don'ts, look, music, voice, captions, CTA, formats/duration) and ask "¿Es exactamente el video que quieres?" with
   options: confirm · adjust (free text). Do not build until confirmed.

## Output
- `brief.md` filled completely (no `?` left), plus a **Rules** section listing every don't and constraint verbatim.
- A memory note per brand/project with the durable decisions (persona, don'ts, CTA, proof, people) so the next video
  for the same brand starts from them and skips those questions.
- Then continue with SKILL.md §1 (scaffold). The shotlist approval in §5 still happens — the interview makes it a
  formality instead of a renegotiation.

## Shortcuts
- **Repeat client** (memory or a previous `videos/<slug>` for the same brand): open with "¿Mismas reglas que la vez
  pasada?" listing them; only ask what changes.
- **User says "tú decide"** on a question: use the recommended option and say so in the brief summary.
- **User is in a hurry:** compress to 2 rounds (1+2, then 3+4), but never skip Brand don'ts, People/consent, CTA
  destination, or the final confirmation.
