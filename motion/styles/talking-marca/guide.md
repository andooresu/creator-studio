# Talking marca

## Esencia
- Persona a cámara (talking head) en 9:16 **vestida con la marca**: un solo color de acento (el de la marca) aparece en todo lo que no es la persona — la caja del título de gancho, la barra de progreso, el espacio del logo, las etiquetas de paso, el marco del b-roll, la píldora del CTA y la caja de los subtítulos.
- Subtítulos `box-marca`: trozos de 2–3 palabras y una caja del color de la marca que salta de palabra en palabra; el texto dentro de la caja se pone negro o blanco solo, según el contraste con el acento.
- La energía viene de la cámara y del montaje sobre la voz: punch-ins en los énfasis, cortes de toma con cambio de escala, b-roll e insertos ilustrativos cuando la voz nombra algo mostrable.
- Se ve propio y reconocible sin ser una plantilla recargada: la marca está en los detalles, la persona sigue mandando.
- Para uso general con marca: consejos, presentación de servicios, anuncios guiados por la voz, 20–90 s.

## Estructura y ritmo
| Tramo | Duración | Qué pasa |
|---|---|---|
| Gancho | 0–2 s | Frame 0 ya muestra a la persona hablando, el logo con el @ y la fila 1 del gancho; la caja de marca se barre bajo la fila 2 y sus palabras suben. El gancho sale antes del primer paso. |
| Desarrollo | cuerpo | Frases de la persona; cada idea lleva su etiqueta en el acento («1 Qué haces»); cada 2–4 s algo cambia: punch-in, corte de toma, b-roll con marco de marca, inserto. |
| Remate / CTA | últimos 3–5 s | Punch duro en la palabra del remate; píldora del CTA en el acento con el @ en blanco; el logo da un pulso; cierre sin quedar estático. |

- El ritmo lo dicta la voz: los cortes caen entre frases (sin aire muerto: silencios > 0,3 s se recortan en la edición de tomas). Si hay música, los punch-ins fuertes caen en beats.
- Punch-in cada 2–3 frases como máximo; alterna plano base (1,00) / medio (1,08) / cerrado (1,14). Nunca dos énfasis iguales seguidos.
- Ningún tramo > 4 s sin un cambio visual.

## Vocabulario de movimiento
Helpers en `helpers/marca.js` (`window.MARCA`): cópialo a `film/marca.js` y cárgalo en `film/index.html` antes de `film.js`. La persona se dibuja desde frames (`seq.py`) con `C.drawSeq` en un canvas.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Texto sobre el acento** | Todo texto que va sobre el color de la marca sale negro o blanco, el que más contraste dé | `MARCA.ink()` una vez al cargar `film.js`: lee `--accent` y deja `--on-accent` en `:root` (misma regla que `boxText: "auto"` de los subtítulos) |
| **Gancho con caja de marca** | Fila 1 en blanco con contorno; la caja del acento se barre de izquierda a derecha y la fila 2 sube por su máscara encima | `MARCA.buildHook(root, [{ text, size }, { text, size, box: true }], { x, y })` en build(); `MARCA.hook(t, S.hook, [-0.4, 'hook_w2'], 'hook_out')` en run() |
| **Logo + @** | Espacio del logo en el acento y el @ al lado, arriba a la izquierda (debajo del 14 % superior); pulsa en el CTA | elemento `.brand` + `MARCA.logo(t, el, -0.4, 'logo_pulse')`; con logo real pon `<img src="../assets/brand/logo.png">` dentro de `.slot` |
| **Barra de progreso** | Barra fina del acento pegada al borde superior que avanza con el video | `MARCA.progress(t, bar)` sobre un elemento de 6–8 px |
| **Etiqueta de paso** | Píldora del acento con número («1 Qué haces») que salta en su beat y se va a la izquierda antes de la siguiente | `MARCA.tag(t, el, inAt, outAt)`; `snappy` |
| **Punch-in en el énfasis** | La cámara se acerca a la cara en la palabra fuerte y vuelve en la frase siguiente | `const z = MARCA.punch(t, [[0, 1], [b1, 1.14], [b2, 1]])` → `C.drawSeq(g, frames, t, t0, box, { z, pos: [0.5, 0.44] })`; `heavy` |
| **Punch duro (remate)** | Salto seco de escala en la palabra del remate | multiplica por `MARCA.hardPunch(t, b0, b1, 1.14)` |
| **B-roll con marco de marca** | Tarjeta con borde del acento crece sobre la persona cuando la voz lo nombra y sale empujada hacia abajo | `MARCA.broll(t, el, inBeat, outBeat, { full })`; SFX `whoosh` suave |
| **Inserto de motion graphics** | Palabras clave, una cifra que dice la voz, pasos, comparación o lista animados a pantalla completa (o en tarjeta arriba) | `INS.full(root, { kind, datos, inAt, outAt, modo })` de `lib/inserts.js` en build() + `ins.run(t)` en run(); datos solo de la voz (docs/apoyos.json) |
| **Imagen aprobada con Ken Burns** | Ilustración aprobada por el usuario cubre el cuadro o una tarjeta con empuje lento | `INS.full(root, { kind: 'imagen', src: '../assets/apoyos/<id>.png', inAt, outAt, modo })` (respeta la forma de la imagen; no uses `C.photo`, que la recorta) |
| **CTA en el acento** | Píldora del acento con el verbo y el @ en una pastilla blanca; salta y pulsa una vez | `MARCA.cta(t, el, 'cta_pill', 'pulse')` |
| **Subtítulos box-marca** | Trozo de 2–3 palabras; la caja del acento salta a la palabra hablada | `timeline.captions = { formats: ["9x16"], preset: "box-marca", accent: "<acento de la marca>" }`; `words.py` + `sync.mjs` (lo dibuja `lib/captions.js`) |

Resortes: `heavy` para cámara, gancho y caja; `snappy` para etiquetas, logo y CTA; nada entra con fade.

## Tipografía
- Subtítulos: Montserrat ExtraBold 800 (`captions/fonts/Montserrat-ExtraBold.ttf`), MAYÚSCULAS, contorno negro fuera de la caja; tamaño por defecto del preset; y = 0,70 del alto.
- Gancho: misma familia en 800, 110–130 px a 1080 de ancho, alineado a la izquierda en x = 80 px, dos filas de 2–3 palabras (la segunda sobre la caja de marca). Si una fila no cabe en el 88 % del ancho, acórtala; no bajes de 96 px.
- Etiquetas 46–50 px, @ y CTA 40–58 px. Nada legible < 36 px a 1080 de ancho (el texto «LOGO» del espacio vacío es un marcador y se reemplaza).

## Color
- La imagen de la persona en su color original (sin LUT salvo aprobación con antes/después).
- **Un solo acento = el color de la marca**, en `--accent` de `film/index.html` y en `timeline.captions.accent` (los dos el mismo). `#5B3DF5` (violeta) es el acento de plantilla y se usa **solo cuando el proyecto no tiene marca**.
- El texto sobre el acento nunca se elige a mano: `--on-accent` (lo calcula `MARCA.ink()`) en el gancho, etiquetas, logo y CTA, y `boxText: "auto"` en los subtítulos. Con un acento claro sale negro; con uno oscuro, blanco.
- Blanco para el texto sobre la imagen, contorno negro. El @ del CTA va siempre negro sobre blanco.
- Si el acento casi no se distingue del fondo de la toma (por ejemplo, marca azul oscuro sobre una pared azul oscuro), no cambies de color: aclara u oscurece el mismo tono en `--accent` y en `captions.accent`, y anótalo en el resumen final.
- Esquinas 24–32 px en tarjetas, sombras profundas suaves; nunca glow.

## Subtítulos
- Preset `box-marca` (estilo box: maxWords 3, maxChars 18, y 0,70, `boxText: "auto"`); el nombre es de la plantilla, el color lo pone el proyecto. Ajustes del proyecto: `accent` (siempre el acento de la marca), `keywords` con moderación (van en el acento sobre la imagen: úsalos solo si el acento lee sobre la toma), `autoKeywords: false` si el acento es oscuro, `yAt` para subirlos cuando haya b-roll o un título en esa zona.
- Siempre quemados en 9:16 (autoplay sin sonido). Nunca subtitular dos veces lo que ya aparece como título (`skip`: la frase del gancho va en `skip`).

## Transiciones
| Transición | Timing |
|---|---|
| Corte de toma | entre frases, sin aire; si la toma siguiente es del mismo plano, cambia la escala (1,00 ↔ 1,08) |
| Punch-in | 0,25–0,5 s de resorte `heavy` en la palabra fuerte |
| Caja del gancho | se barre en ≈ 0,3 s (`heavy`) un cuarto de beat antes de sus palabras; sale recogiéndose a la izquierda |
| B-roll de tarjeta | crece en ≤ 0,3 s (`snappy`), sale empujada hacia abajo; nunca crossfade |

## Sonido y música
- La voz es lo primero: limpia, con compresión ligera, sin ruido de sala.
- Música opcional y original, baja (−18 a −22 dB bajo la voz, ducking), con pulso que acompañe sin melodía protagonista: pop electrónico suave, 90–110 BPM.
- SFX sutiles: `whoosh` en la caja del gancho y en el b-roll, `pop` en etiquetas, CTA y pulso del logo, `thump` en el remate.
- Mezcla −14 LUFS integrado, true peak ≤ −1 dBTP.

## Voz en off
- No hay VO aparte: la voz es la de la persona en cámara. Si se agrega una VO de apoyo (narrador), va en frases colocadas en beats y con subtítulos del mismo preset.

## Formatos
- 9:16 principal: la cara algo más baja que en otros talking (pos y ≈ 0,44) para dejar sitio al logo y al gancho; subtítulos en y 0,70; nada clave en el 14 % superior (solo la barra de progreso), 20 % inferior ni 12 % derecho.
- 1:1 / 4:5: encuadre más cerrado, gancho de una fila con caja, subtítulos en y 0,78–0,86 (`yFmt`).
- 16:9: persona a un lado (pos x 0,33), gancho, etiquetas, b-roll y CTA en la otra mitad; logo arriba a la izquierda.

## Reglas recurrentes y prohibiciones
- Frame 0 con la persona ya hablando, el logo + @ y el gancho visibles.
- Un solo acento: nada de segundo color de marca compitiendo (salvo que la guía de marca lo pida).
- Sin silencios muertos: el ritmo no se pierde nunca.
- B-roll solo si la voz lo nombra y el clip lo prueba (nada genérico de relleno). Los insertos ilustrativos (motion graphics con `INS` e imágenes que el usuario aprobó en docs/apoyos.json) sí van: ilustran lo que dice la voz y sus textos y cifras salen solo de ella. Nunca IA para "resultados" (antes/después de clientes, métricas, testimonios, capturas que parecen reales), nunca caras de personas reales, nunca imágenes o datos inventados.
- Prohibido: zoom continuo lento todo el video, transiciones de plantilla (giros, glitches, light leaks), texto sobre el acento con color elegido a mano, logos deformados o recoloreados, subtítulos centrados sobre la cara, fades.

## Qué revisa el crítico
- La caja de los subtítulos cae en la palabra que se oye (±80 ms) y los trozos no cortan frases de forma rara.
- El texto dentro de la caja y sobre cada elemento del acento se lee (contraste automático) a 360 px; subtítulos fuera de las zonas de UI y sin tapar boca ni ojos.
- El acento es el de la marca en todos los elementos (gancho, barra, logo, etiquetas, marco, CTA, subtítulos) y no hay un segundo color colado.
- Hay un cambio visual cada 2–4 s; los punch-ins varían de escala y caen en énfasis reales.
- El b-roll y los insertos corresponden exactamente a lo que la voz dice en ese momento; cada apoyo aprobado y usable (`usable: true` en docs/apoyos.json) aparece en su tramo y sus textos/cifras son literales de la voz; los `usable: false` se saltan (no se rellenan con otro inserto).
- Loudness en objetivo y la música nunca tapa la voz.

## Cómo usar la demo
La demo (13,2 s, 100 BPM, 9:16 y 16:9) es un talking head de ejemplo con **una persona dibujada** como marcador («TU VIDEO A CÁMARA AQUÍ») que explica cómo presentar un negocio en una frase: logo + @ y gancho «Tu negocio / en 1 frase» con caja de marca en el frame 0, barra de progreso, etiquetas «1 Qué haces / 2 A quién / 3 Lo distinto», subtítulos box-marca, corte de toma con cambio de escala, punch-in en «haces», b-roll con marco de marca («TU CLIP AQUÍ»), punch duro en «distinto» y la píldora final «Escríbenos @tumarca». La voz es una VO de ejemplo escrita en `demo/index.html` (`window.VO`) para que los subtítulos se vean sin audio. En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/marca.js` a `film/marca.js` (el `<script src="marca.js">` y el de `lib/inserts.js` ya van antes de `film.js` en `demo/index.html`). La tipografía es Montserrat ExtraBold, que `init.sh` ya deja en `assets/fonts/captions/`: no hay que copiar fuentes.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después pon tu material: tu clip a cámara en lugar de la silueta (`scripts/seq.py` → `C.drawSeq(g, frames, t, t0, box, { z, pos: [0.5, 0.44] })` con la misma `z` de punch-ins que usa la demo), tu voz (`scripts/vo.py` + `scripts/words.py`; con eso la VO de ejemplo se ignora sola), tus clips de b-roll en la tarjeta, tu logo y tu @. Ajusta las marcas de `timeline.json` a las palabras reales de tu voz.

## Cómo adaptarlo a tu marca
1. **Arranca desde la demo:** sigue «Cómo usar la demo» y parte de esa copia.
2. **Acento:** pon el color de acento de tu marca en `--accent` de `film/index.html` y el mismo en `timeline.captions.accent`. No toques `--on-accent`: `MARCA.ink()` lo calcula. Si el acento no se distingue del fondo de tu toma, ajusta su tono antes que cambiar de color.
3. **Logo:** si tu marca tiene logo (la app lo deja en `assets/brand/logo.<ext>`), cambia el contenido de `.slot` por `<img src="../assets/brand/logo.png" style="width:100%;height:100%;object-fit:contain">` y quita el fondo del acento si el logo ya trae el suyo. Nunca lo deformes ni lo recolorees. Sin logo, deja solo el @ (borra `.slot`).
4. **Tipografías:** si tu marca tiene una sans propia con peso 800 (o 700), cámbiala en el `@font-face` y en `C.fonts`, y pásala a los subtítulos poniendo en `timeline.captions` tanto `"font"` (tu familia) como `"fontFile": null` (el preset box-marca trae `fontFile` de Montserrat, que si no lo anulas va delante de tu familia y los subtítulos siguen en Montserrat); revisa que el gancho y los trozos de 3 palabras sigan entrando en el ancho útil a 1080. Si no, quédate con Montserrat ExtraBold.
5. **CTA y @:** cambia «Escríbenos @tumarca» por el CTA de tu guía de marca (su verbo y su @ o sitio).
6. **Metraje:** reemplaza la silueta por tu clip a cámara y la tarjeta «TU CLIP AQUÍ» por b-roll real que pruebe lo que dice la voz o por los apoyos aprobados (docs/apoyos.json → `INS.full`); si no tienes ni b-roll ni apoyos, quítala y deja que trabajen los punch-ins y las etiquetas.
7. **Voz y tono:** el gancho y las etiquetas siguen la voz de la marca (sus palabras a usar y a evitar).

## Si buscas otra cosa
- ¿Subtítulos karaoke palabra por palabra, más nativo de redes y sin vestir la marca? Usa **Talking karaoke**.
- ¿Algo sobrio para clínicas, salud o servicios profesionales, con rótulo de nombre y especialidad? Usa **Talking sobrio**.
- ¿Alta energía, una palabra gigante a la vez y cortes duros para ganchos o ventas directas? Usa **Talking palabra**.
- ¿Explicar con cifras, comparaciones o pasos en paneles junto a la persona? Usa **Talking con datos**.
- ¿Un reel sin persona a cámara, todo en tipografía y motion? Usa **Punto cinético**.
