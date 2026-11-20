# Talking sobrio

## Esencia
- Persona a cámara (talking head) en 9:16 con **rótulo de nombre y especialidad** (lower third) que entra con una máscara limpia y se retira, **subtítulos en píldora discreta** y **un solo acento contenido** (el de la marca; el verde azulado `#3E8E8A` solo sin marca).
- La calma es el estilo: punch-ins **lentos** (1,00 ↔ 1,06–1,08 con resortes largos), cortes de toma tranquilos, tarjetas claras con tinta oscura; nada de golpes, emojis ni efectos.
- Se ve serio, cercano y confiable: transmite criterio profesional sin parecer anuncio.
- Para clínicas, salud, B2B, consultoría y servicios profesionales: explicar un proceso, responder dudas frecuentes, presentar a un especialista, 20–90 s.

## Estructura y ritmo
| Tramo | Duración | Qué pasa |
|---|---|---|
| Entrada | 0–3 s | Frame 0 ya muestra a la persona hablando + título corto (2–4 palabras) que sube por su máscara sin golpe; a ~1 s entra el rótulo «Tu nombre / Tu especialidad». |
| Desarrollo | cuerpo | Frases de la persona; cada 3–5 s algo cambia con suavidad: corte de toma (1,00 ↔ 1,04), punch-in lento, etiqueta «Pregunta N» / «Paso N», tarjeta de b-roll o inserto. |
| Cierre / CTA | últimos 3–4 s | Rótulo de cierre con el mismo componente del nombre («Escríbenos» + @ o sitio) y un empuje mínimo de cámara; sin estridencia. |

- El ritmo lo dicta la voz: los cortes caen entre frases (silencios > 0,4 s se recortan), nunca a mitad de palabra. Si hay música, los cambios de toma pueden caer en beats, pero sin forzarlos.
- Punch-in cada 3–4 frases como máximo, siempre lento; alterna 1,00 / 1,04 / 1,06–1,08. Nunca dos énfasis iguales seguidos.
- Ningún tramo > 5 s sin un cambio visual, por pequeño que sea.
- El rótulo de nombre aparece una vez (al inicio) y dura 3–4 s; no vuelve salvo que cambie la persona.

## Vocabulario de movimiento
Helpers en `helpers/sobrio.js` (`window.SOB`): cópialo a `film/sobrio.js` y cárgalo en `film/index.html` antes de `film.js`. La persona se dibuja desde frames (`seq.py`) con `C.drawSeq` en un canvas.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Rótulo de nombre (lower third)** | Barra fina de acento que crece, tarjeta clara que se descubre de izquierda a derecha y nombre + especialidad que suben por sus máscaras; sale recogiéndose hacia la barra | `S.lt = SOB.buildLowerThird(root, { x, y, name, role, size })` en build() + `SOB.lowerThird(t, S.lt, inBeat, outBeat)` en run() |
| **Punch-in lento** | La cámara se acerca apenas (1,06–1,08) en la palabra importante y vuelve sin prisa | `const z = SOB.punch(t, [[0, 1], [b1, 1.07], [b2, 1]])` (resorte `SOB.SLOW`, sin rebote) → `C.drawSeq(g, frames, t, t0, box, { z, pos: [0.5, 0.4] })` |
| **Corte de toma tranquilo** | Entre frases la escala cambia seca pero poco (1,00 ↔ 1,04) para que el salto de toma no se note | `z *= SOB.shot(t, [['hook', 1], ['q1', 1.04], …])` |
| **Deriva viva** | Micro deriva muy suave en los holds | incluida en `SOB.punch` (`drift`) |
| **Etiqueta discreta** | Píldora blanca con punto de acento («Pregunta 1», «Paso 2») que se desliza por su máscara | `.sob-chip` + `SOB.chip(t, el, inBeat, outBeat)` |
| **Título de entrada** | 2–4 palabras en tinta oscura (una en acento) que suben por su máscara con resorte largo | `TYPE.line(…, { accent: [i] })` + `SOB.title(t, L, [beats], outAt)` |
| **B-roll en tarjeta** | Tarjeta de esquina 24 px que se descubre de abajo arriba con un leve asiento de escala y se recoge hacia arriba | `SOB.card(t, el, inBeat, outBeat)`; SFX `whoosh` muy suave |
| **Inserto de motion graphics** | Palabras clave, una cifra que dice la voz, pasos, comparación o lista en tarjeta clara o a pantalla completa | `INS.full(root, { kind, datos, inAt, outAt, modo })` de `lib/inserts.js` en build() + `ins.run(t)` en run(); datos solo de la voz (docs/apoyos.json) |
| **Imagen aprobada con Ken Burns** | Ilustración aprobada por el usuario en tarjeta o a cuadro completo con empuje lento | `INS.full(root, { kind: 'imagen', src: '../assets/apoyos/<id>.png', inAt, outAt, modo })` (respeta la forma de la imagen; no uses `C.photo`, que la recorta) |
| **Subtítulos en píldora** | Frase corta sobre una píldora oscura semitransparente, sin resaltado por palabra | `timeline.captions = { formats: ["9x16"], preset: "pill-sobrio" }`; `words.py` + `sync.mjs` (lo dibuja `lib/captions.js`) |
| **Rótulo de cierre** | El mismo componente del nombre con el CTA («Escríbenos» / «@tumarca · enlace en el perfil») | `SOB.buildLowerThird(…)` + `SOB.lowerThird(t, S.cta, ctaBeat, null)` |

Resortes: `SOB.SLOW` (respuesta 1,1 s, sin rebote) para cámara y tarjetas, `SOB.CALM` (0,7 s, sin rebote) para rótulos, etiquetas y títulos. Nada de `snappy` ni `playful`, nada entra con fade.

## Tipografía
- Una familia: **Inter** (variable, `fonts/Inter-var.woff2`, OFL), declarada como `'UI'` en `demo/index.html`: así los subtítulos del preset `pill-sobrio` usan la misma letra sin configurar nada.
- Nombre del rótulo: Inter 700, 54–60 px a 1080 de ancho; especialidad: Inter 500 al 68 % del nombre, en gris tinta.
- Título de entrada: Inter 700, 100–120 px, tracking −0,025 em, alineado a la izquierda en x ≥ 80 px; segunda línea en 500–700 a ~60 % y gris tinta.
- Etiquetas y subtítulos: Inter 600, 40–46 px. Nada legible < 36 px en 9:16; prueba del teléfono a 360 px.
- Nada en MAYÚSCULAS salvo los marcadores de la demo; nunca contorno ni sombras duras en el texto.

## Color
- La imagen de la persona en su color original (sin LUT salvo aprobación con antes/después).
- Acento = el color de acento de la marca, en dosis pequeñas: barra del rótulo, punto de las etiquetas, una palabra del título. `#3E8E8A` es el acento de plantilla y se usa **solo cuando el proyecto no tiene marca**.
- Tarjetas claras (`#FFFFFF` al 94–96 %) con tinta `#15191F` y gris `#566070`; subtítulos blancos sobre píldora oscura.
- Si el acento de la marca es muy claro o muy saturado, no cambies de color ni preguntes: oscurece o desatura el mismo tono para la barra y el punto, y anótalo en el resumen final.
- Sombras suaves y profundas; nunca glow, degradados chillones ni brillos.

## Subtítulos
- Preset `pill-sobrio` (estilo pill, maxChars 34, y 0,72): frase corta sobre píldora oscura, sin resaltado por palabra; nunca compite con el rótulo ni con el título.
- Ajustes del proyecto: `yAt` para subirlos o bajarlos cuando una tarjeta o un rótulo ocupe esa zona, `yFmt` por formato (en 16:9 la demo usa `{ "16x9": 0.86 }`), `skip` para no subtitular lo que ya está como título.
- Siempre quemados en 9:16 (autoplay sin sonido). Nunca encima de la boca ni de los ojos.

## Transiciones
| Transición | Timing |
|---|---|
| Corte de toma | entre frases, sin aire; si la toma siguiente es del mismo plano, cambia la escala (1,00 ↔ 1,04) |
| Punch-in lento | 0,8–1,2 s de resorte `SOB.SLOW` hacia 1,06–1,08 y vuelta igual de lenta |
| Rótulo | barra 0,5 s, máscara de la tarjeta ~1 s, texto escalonado; salida recogiéndose en ~0,7 s |
| B-roll en tarjeta | se descubre de abajo arriba en ~1 s y se recoge hacia arriba; nunca crossfade |

## Sonido y música
- La voz es lo primero: limpia, cálida, con compresión ligera, sin ruido de sala ni eco.
- Música opcional y original, muy baja (−20 a −24 dB bajo la voz, ducking), ambiental o piano/pads suaves, 80–100 BPM, sin melodía protagonista.
- SFX mínimos: `whoosh` muy suave en el rótulo y en la tarjeta, `pop` bajo en las etiquetas; nada de `thump` ni golpes.
- Mezcla −14 LUFS integrado, true peak ≤ −1 dBTP.

## Voz en off
- No hay VO aparte: la voz es la de la persona en cámara. Si se agrega una VO de apoyo (narrador), va en frases tranquilas, con subtítulos del mismo preset.

## Formatos
- 9:16 principal: la cara en el tercio superior-medio (pos y ≈ 0,40), rótulo a la izquierda en y ≈ 0,57, subtítulos en y 0,72, etiquetas en y ≈ 0,16; nada clave en el 14 % superior, 20 % inferior ni 12 % derecho.
- 1:1 / 4:5: encuadre más cerrado, rótulo en y ≈ 0,60 y subtítulos en y 0,80–0,86 (`yFmt`).
- 16:9: persona a un lado (pos x 0,33) y la columna de texto (título, etiqueta, tarjeta, rótulo) en la otra mitad; subtítulos en y 0,86.

## Reglas recurrentes y prohibiciones
- Frame 0 con la persona ya hablando y el título de entrada empezando a subir.
- El rótulo usa los datos reales de la persona (nombre y especialidad que el usuario confirme); nunca inventes títulos, cargos ni credenciales.
- B-roll solo si la voz lo nombra y el clip lo prueba (nada genérico de relleno). Los insertos ilustrativos (motion graphics con `INS` e imágenes que el usuario aprobó en docs/apoyos.json) sí van: ilustran lo que dice la voz y sus textos y cifras salen solo de ella. Nunca IA para "resultados" (antes/después de pacientes o clientes, métricas, testimonios, capturas que parecen reales), nunca caras de personas reales, nunca imágenes o datos inventados.
- Prohibido: punch duros o escalas > 1,10, emojis, palabras saltando, transiciones de plantilla (giros, glitches, light leaks), fades, más de un acento, subtítulos centrados sobre la cara, zoom continuo todo el video.

## Qué revisa el crítico
- El rótulo entra limpio (máscara, sin fade), se lee completo ≥ 2 s y sale antes de que estorbe; nombre y especialidad son los confirmados.
- Subtítulos legibles a 360 px, fuera de las zonas de UI, sin tocar el rótulo ni tapar boca u ojos.
- Hay un cambio visual cada 3–5 s; los punch-ins son lentos, varían de escala (≤ 1,08) y caen en énfasis reales.
- Ningún salto de toma visible sin cambio de escala; sin aire muerto entre frases.
- El acento aparece poco y siempre con el mismo rol.
- El b-roll y los insertos corresponden exactamente a lo que la voz dice en ese momento; cada apoyo aprobado y usable (`usable: true` en docs/apoyos.json) aparece en su tramo y sus textos/cifras son literales de la voz; los `usable: false` se saltan (no se rellenan con otro inserto).
- Loudness en objetivo y la música nunca tapa la voz.

## Cómo usar la demo
La demo (13,4 s, 90 BPM, 9:16 y 16:9) es un talking head de ejemplo con **una persona dibujada** como marcador («TU VIDEO A CÁMARA AQUÍ») que explica «3 preguntas antes de contratar un servicio»: título de entrada en el frame 0, rótulo «Tu nombre / Tu especialidad» que entra con máscara y se retira, subtítulos del preset pill-sobrio, etiquetas «Pregunta 1/2/3», cortes de toma 1,00 ↔ 1,04, punch-ins lentos en «tiempo» y «proceso», b-roll en tarjeta («TU CLIP AQUÍ») y el rótulo de cierre «Escríbenos / @tumarca». La voz es una VO de ejemplo escrita en `demo/index.html` (`window.VO`) para que los subtítulos se vean sin audio. En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/sobrio.js` a `film/sobrio.js` (el `<script src="sobrio.js">` y el de `lib/inserts.js` ya van antes de `film.js` en `demo/index.html`) y `fonts/Inter-var.woff2` a `assets/fonts/`.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después pon tu material: tu clip a cámara en lugar de la silueta (`scripts/seq.py` → `C.drawSeq(g, frames, t, t0, box, { z, pos: [0.5, 0.4] })` con la misma `z` de cortes y punch-ins que usa la demo), tu voz (`scripts/vo.py` + `scripts/words.py`; con eso la VO de ejemplo se ignora sola), tu nombre y especialidad en el rótulo, tus clips de b-roll en la tarjeta y tu @ en el cierre. Ajusta las marcas de `timeline.json` a las palabras reales de tu voz.

## Cómo adaptarlo a tu marca
1. **Arranca desde la demo:** sigue «Cómo usar la demo» y parte de esa copia.
2. **Acento:** pon el color de acento de tu marca en `--accent` de `:root` (`film/index.html`): pinta la barra del rótulo, el punto de las etiquetas y la palabra en acento del título. Conserva los roles: un solo acento, en dosis pequeñas, sobre tarjetas claras con tinta oscura.
3. **Tipografías:** si tu marca tiene una sans sobria con pesos 500–700, cámbiala en el `@font-face` de `'UI'` (así cambian también los subtítulos) y revisa que el nombre más largo quepa en el rótulo a 1080. Si no, quédate con Inter.
4. **Rótulo y CTA:** escribe el nombre y la especialidad confirmados en `SOB.buildLowerThird` y el CTA de tu guía de marca en el rótulo de cierre (con su verbo y su @ o sitio).
5. **Metraje:** reemplaza la silueta por tu clip a cámara (`seq.py` + `C.drawSeq` con la misma `z`) y la tarjeta «TU CLIP AQUÍ» por b-roll real que pruebe lo que dice la voz o por los apoyos aprobados (docs/apoyos.json → `INS.full`); si no tienes ni b-roll ni apoyos, quítala y deja que trabajen los cortes y punch-ins lentos.
6. **Voz y tono:** títulos y etiquetas siguen la voz de la marca (sus palabras a usar y a evitar); este estilo no usa emojis.

## Si buscas otra cosa
- ¿Más energía, subtítulos palabra por palabra y punch-ins marcados? Usa **Talking karaoke**.
- ¿Tu marca muy presente: título de gancho en caja, barra de progreso y CTA con tu color? Usa **Talking marca**.
- ¿Ganchos de alta energía, una palabra gigante a la vez y cortes secos? Usa **Talking palabra**.
- ¿Explicar con cifras, comparaciones y pasos junto a la persona? Usa **Talking con datos**.
- ¿Un reel sin persona a cámara, con tarjetas y diagramas tranquilos? Usa **Tarjeta escenario**.
