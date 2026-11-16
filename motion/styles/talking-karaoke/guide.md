# Talking karaoke

## Esencia
- Persona a cámara (talking head) en 9:16 con **subtítulos karaoke**: trozos de 3–4 palabras y la palabra que se está diciendo en el color de acento (el de la marca; amarillo `#FFD43B` solo sin marca) con un pequeño salto.
- La energía viene de la cámara y del montaje sobre la voz: **punch-ins** en los énfasis, cortes de tomas limpios, **b-roll** que entra sobre la imagen cuando la voz nombra algo mostrable.
- Se ve nativo de redes, directo y rápido; nada de adornos de plantilla.
- Para opinión, educación corta, consejos, anuncios guiados por la voz, 20–90 s.

## Estructura y ritmo
| Tramo | Duración | Qué pasa |
|---|---|---|
| Gancho | 0–2 s | Frame 0 ya muestra a la persona hablando + título de gancho grande (2–5 palabras) que sube por su máscara; punch-in en la primera palabra fuerte. |
| Desarrollo | cuerpo | Frases de la persona; cada 2–4 s algo cambia: punch-in, corte de toma, b-roll, palabra clave destacada o emoji. |
| Remate / CTA | últimos 3–5 s | Punch-in fuerte en la frase final; CTA como tipografía o píldora; cierre sin quedar estático. |

- El ritmo lo dicta la voz: los cortes caen entre frases (sin aire muerto: silencios > 0,3 s se recortan en la edición de tomas). Si hay música, los punch-ins fuertes caen en beats.
- Punch-in cada 2–3 frases como máximo; alterna plano base (1,00) / medio (1,12) / cerrado (1,20). Nunca dos énfasis iguales seguidos.
- Ningún tramo > 4 s sin un cambio visual.

## Vocabulario de movimiento
Helpers en `helpers/talking.js` (`window.TALK`): cópialo a `film/talking.js` y cárgalo en `film/index.html` antes de `film.js`. La persona se dibuja desde frames (`seq.py`) con `C.drawSeq` en un canvas.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Punch-in en el énfasis** | La cámara se acerca a la cara en la palabra fuerte y vuelve en la frase siguiente | `const z = TALK.punch(t, [[0, 1], [b1, 1.15], [b2, 1]])` → `C.drawSeq(g, frames, t, t0, box, { z, pos: [0.5, 0.4] })`; `heavy`; el beat del énfasis sale de las palabras de la voz |
| **Punch duro (remate)** | Salto seco de escala en el remate o chiste | multiplica por `TALK.hardPunch(t, b0, b1, 1.18)` |
| **Deriva viva** | Micro deriva sembrada en los holds | incluida en `TALK.punch` (`drift`) |
| **B-roll sobre la imagen** | Tarjeta con imagen o clip crece sobre la persona (o cubre todo el cuadro) cuando la voz lo nombra y sale empujada hacia abajo | `TALK.broll(t, el, inBeat, outBeat, { full })`; SFX `whoosh` suave con pico al asentar |
| **Título de gancho** | 2–5 palabras grandes suben palabra por palabra en los primeros 2 s | `TALK.hookTitle(t, L, [-0.4, 'w2', 'w3'], outAt)` con `TYPE.line(…, { accent: [i] })` |
| **Subtítulos karaoke** | Trozo de 3–4 palabras; la palabra hablada en el acento con salto 10 % | `timeline.captions = { formats: ["9x16"], preset: "karaoke-amarillo", accent: "<acento de la marca>" }` (sin marca, omite `accent`); `words.py` + `sync.mjs` (lo dibuja `lib/captions.js`) |
| **Palabra clave + emoji** | Palabras clave más grandes en acento; emoji que salta sobre el trozo | `captions.keywords: [...]`, `captions.emoji: { "dinero": "💰" }` (con moderación: ≤ 1 emoji cada 8–10 s) |
| **Barra de progreso (opcional)** | Barra fina arriba que avanza con el video | `TALK.progress(t, bar)` sobre un elemento de 6–8 px pegado al borde superior |

Resortes: `heavy` para cámara y títulos, `snappy` para tarjetas pequeñas y pops; nada entra con fade.

## Tipografía
- Subtítulos: Montserrat ExtraBold 800 (`captions/fonts/Montserrat-ExtraBold.ttf`), MAYÚSCULAS, contorno negro, sombra suave; tamaño por defecto del preset; y = 0,70 del alto.
- Título de gancho: misma familia en 800, 110–140 px a 1080 de ancho, alineado a la izquierda en x ≥ 80 px, acento en la palabra clave.
- Nada legible < 28 px a 1080p; prueba del teléfono a 360 px.

## Color
- La imagen de la persona en su color original (sin LUT salvo aprobación con antes/después).
- Acento = el color de acento de la marca: palabra hablada, palabras clave, acento del título de gancho y píldora del CTA. `#FFD43B` es el acento de plantilla y se usa **solo cuando el proyecto no tiene marca**.
- Blanco para el texto base de subtítulos, negro para el contorno.
- Si el acento de la marca no lee sobre la imagen (contraste bajo con la piel o el fondo), no cambies de color ni preguntes: aclara u oscurece el mismo tono, engrosa el contorno o pon una caja detrás de la palabra, y anótalo en el resumen final.
- Tarjetas de b-roll con esquina 24–32 px y sombra profunda suave; nunca glow.

## Subtítulos
- Preset `karaoke-amarillo` (maxWords 4, maxChars 22, bump 0,1, y 0,70); el nombre es de la plantilla, el color lo pone el proyecto. Ajustes del proyecto: `accent` (siempre el acento de la marca cuando hay marca, ajustado de tono si hace falta para que lea; sin marca se queda el amarillo del preset), `keywords`, `emoji`, `yAt` para subirlos cuando haya b-roll o un título en esa zona.
- Siempre quemados en 9:16 (autoplay sin sonido). Nunca subtitular dos veces lo que ya aparece como título (`skip`).

## Transiciones
| Transición | Timing |
|---|---|
| Corte de toma | entre frases, sin aire; si la toma siguiente es del mismo plano, cambia la escala (1,00 ↔ 1,12) para que el salto no se note |
| Punch-in | 0,25–0,5 s de resorte `heavy` en la palabra fuerte |
| B-roll de tarjeta | crece en ≤ 0,3 s (`snappy`), sale empujada hacia abajo |
| B-roll a pantalla completa | sube desde abajo cubriendo (`default`) y sale hacia abajo; nunca crossfade |

## Sonido y música
- La voz es lo primero: limpia, con compresión ligera, sin ruido de sala.
- Música opcional y original, baja (−18 a −22 dB bajo la voz, ducking), con pulso que acompañe sin melodía protagonista: hip-hop suave, electrónica minimal, 90–110 BPM.
- SFX sutiles: `whoosh` en b-roll, `pop` en emojis o palabras clave importantes (no en todas), `thump` en el remate.
- Mezcla −14 LUFS integrado, true peak ≤ −1 dBTP.

## Voz en off
- No hay VO aparte: la voz es la de la persona en cámara. Si se agrega una VO de apoyo (narrador), va en frases colocadas en beats y con subtítulos del mismo preset.

## Formatos
- 9:16 principal: la cara en el tercio superior-medio (pos y ≈ 0,40), subtítulos en y 0,70, nada clave en el 14 % superior, 20 % inferior ni 12 % derecho.
- 1:1 / 4:5: encuadre más cerrado, subtítulos en y 0,78–0,86 (`yFmt`).
- 16:9: persona a un lado (pos x 0,35), b-roll en la otra mitad.

## Reglas recurrentes y prohibiciones
- Frame 0 con la persona ya hablando y el título de gancho visible.
- Sin silencios muertos: el ritmo no se pierde nunca.
- B-roll solo si la voz lo nombra y el clip lo prueba (nada genérico de relleno); nunca IA para "resultados".
- Prohibido: zoom continuo lento todo el video, transiciones de plantilla (giros, glitches, light leaks), emojis en cada frase, subtítulos centrados sobre la cara, fades.

## Qué revisa el crítico
- La palabra resaltada coincide con lo que se oye (±80 ms) y los trozos no cortan frases de forma rara.
- Subtítulos legibles a 360 px y fuera de las zonas de UI; no tapan la boca ni los ojos.
- Hay un cambio visual cada 2–4 s; los punch-ins varían de escala y caen en énfasis reales.
- Ningún salto de toma visible sin cambio de escala; sin aire muerto entre frases.
- El b-roll corresponde exactamente a lo que la voz dice en ese momento.
- Loudness en objetivo y la música nunca tapa la voz.

## Cómo usar la demo
La demo (13,2 s, 100 BPM, 9:16 y 16:9) es un talking head de ejemplo con **una persona dibujada** como marcador («TU VIDEO A CÁMARA AQUÍ») que da «3 trucos para grabar mejor»: título de gancho en el frame 0, subtítulos karaoke-amarillo palabra por palabra, etiquetas «Truco 1/2/3», corte de toma con cambio de escala, punch-in en «ojos», b-roll en tarjeta («TU CLIP AQUÍ») sobre la persona, b-roll a pantalla completa, punch duro en «amigo» y «Síguenos», y la píldora final «Sigue a @tumarca». La voz es una VO de ejemplo escrita en `demo/index.html` (`window.VO`) para que los subtítulos se vean sin audio. En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/talking.js` a `film/talking.js` (el `<script src="talking.js">` ya va antes de `film.js` en `demo/index.html`). La tipografía es Montserrat ExtraBold, que `init.sh` ya deja en `assets/fonts/captions/`: no hay que copiar fuentes.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después pon tu material: tu clip a cámara en lugar de la silueta (`scripts/seq.py` → `C.drawSeq(g, frames, t, t0, box, { z, pos: [0.5, 0.4] })` con la misma `z` de punch-ins que usa la demo), tu voz (`scripts/vo.py` + `scripts/words.py`; con eso la VO de ejemplo se ignora sola), tus clips de b-roll en las tarjetas y tu @ en la píldora. Ajusta las marcas de `timeline.json` a las palabras reales de tu voz.

## Cómo adaptarlo a tu marca
1. **Arranca desde la demo:** sigue «Cómo usar la demo» y parte de esa copia.
2. **Acento:** pon el color de acento de tu marca en `timeline.captions.accent` y úsalo también en el acento del título de gancho (`TYPE.line(…, { accent: [i] })`), las palabras clave y la píldora del CTA. Conserva los roles: un solo acento, texto base blanco, contorno negro. Si no lee sobre tu imagen, ajusta el tono (más claro u oscuro) o el contorno antes que cambiar de color.
3. **Tipografías:** si tu marca tiene una sans propia con peso 800 (o 700), cámbiala en el `@font-face` y en `C.fonts`, y pásala a los subtítulos; revisa que los trozos de 4 palabras sigan entrando en el ancho útil a 1080. Si no, quédate con Montserrat ExtraBold.
4. **CTA y @:** cambia la píldora «Sigue a @tumarca» por el CTA de tu guía de marca (con su verbo y su @ o sitio).
5. **Metraje:** reemplaza la silueta por tu clip a cámara (`seq.py` + `C.drawSeq` con la misma `z` de punch-ins) y las tarjetas «TU CLIP AQUÍ» por b-roll real que pruebe lo que dice la voz; si no tienes b-roll, quítalas y deja que trabajen los punch-ins.
6. **Voz y tono:** los títulos de gancho, palabras clave y emojis siguen la voz de la marca (sus palabras a usar y a evitar); si la marca evita emojis, no los uses.

## Si buscas otra cosa
- ¿Un reel sin persona a cámara, todo en tipografía y motion? Usa **Punto cinético**.
- ¿Explicar un servicio o un cuidado con calma, con tarjetas y diagramas? Usa **Tarjeta escenario**.
- ¿Una clase o lección por secciones? Usa **Clase en hojas**.
