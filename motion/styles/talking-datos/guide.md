# Talking con datos

## Esencia
- Persona a cámara (talking head) en 9:16 **dentro de una tarjeta redondeada** sobre un fondo sereno (pizarra oscura con retícula de puntos y un halo del acento). Cuando la voz da un dato, la tarjeta **se encoge a la esquina** y entran **paneles de datos**: una cifra clave que cuenta, barras de comparación o una lista de pasos.
- La persona nunca desaparece: sigue hablando en su tarjeta mientras el dato ocupa el centro; para el cierre la tarjeta vuelve a llenar el cuadro.
- Se ve claro, ordenado y confiable: un solo acento (el de la marca), cifras grandes, nada de adornos.
- Para explicativos, educación, divulgación y videos con datos o comparaciones, 30–90 s.

## Estructura y ritmo
| Tramo | Duración | Qué pasa |
|---|---|---|
| Gancho | 0–2,5 s | Frame 0 con la persona a cuadro casi completo y el título de gancho sobre la parte baja de la tarjeta; la palabra clave en la caja de acento de la marca. Punch-in lento en la palabra fuerte. |
| Datos | cuerpo | Por cada dato: la tarjeta se encoge a la esquina (o ya está ahí), entra la cabecera «Dato N» + título corto y un panel empuja desde la derecha. El panel se anima con la voz: la cifra cuenta, la barra se llena, el paso se marca. Cada dato dura 3–5 s. |
| Remate / CTA | últimos 3–4 s | El último panel sale, la tarjeta vuelve a llenar el cuadro, punch-in en la frase final y píldora de CTA del color de la marca. |

- El ritmo lo dicta la voz: cada panel entra cuando la voz anuncia el dato, y cada animación interna (conteo, barra, paso) cae en la palabra que lo nombra. Sin aire muerto: silencios > 0,3 s se recortan en la edición de tomas.
- Un panel por dato; nunca dos paneles a la vez. Máximo 3–4 datos por video corto: si hay más, divide el video.
- Ningún tramo > 4 s sin un cambio visual (panel nuevo, barra, paso, punch-in o corte de toma).

## Vocabulario de movimiento
Helpers en `helpers/datos.js` (`window.DATOS`): cópialo a `film/datos.js` y cárgalo en `film/index.html` después de `type.js` y antes de `film.js`. La persona se dibuja desde frames (`seq.py`) con `C.drawSeq` dentro de la tarjeta.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Tarjeta que se encoge** | La tarjeta de la persona pasa de casi todo el cuadro a la esquina superior izquierda con resorte pesado, y vuelve en el cierre | `const B = DATOS.cardBox(t, BIG, SMALL, 'd1', 'cta')` → `DATOS.drawCard(g, B, (g, B) => C.drawSeq(g, frames, t, t0, B, { z, pos: [0.5, 0.4] }))`; SFX `whoosh` |
| **Punch-in lento** | La cámara se acerca un poco en la palabra fuerte y vuelve | `DATOS.punch(t, [[0, 1], ['hook_punch', 1.07], ['d1', 1]])` (`heavy`, 1,00 ↔ 1,04–1,09) |
| **Cabecera de sección** | Píldora de acento «Dato N» con pop + título de 1–2 líneas que sube por su máscara al lado de la tarjeta | `DATOS.head(root, 'Dato 1', ['La cifra', 'clave'], { x, y, accent: { 1: [0] } })` + `DATOS.headRun(t, H, inAt, outAt)` |
| **Panel en carrusel** | El panel entra empujando desde la derecha y sale empujado a la izquierda; su contenido aparece de golpe al asentar | `DATOS.panel(root, { x, y, w, h })` + `DATOS.panelRun(t, P, inAt, outAt)`; SFX `whoosh` suave |
| **Dato clave que cuenta** | Cifra grande en acento que cuenta de 0 al valor, con un subrayado de acento que crece | `DATOS.figure(P, { label, suffix: '%', note })` + `DATOS.count(t, F, 0, valor, beat, 2.5)`; SFX `tick` |
| **Barras de comparación** | Dos o tres barras que se llenan en la palabra que las nombra; la destacada en acento | `DATOS.bars(P, [{ label, value, text, accent }])` + `DATOS.barsRun(t, B, [beats])`; SFX `pop` |
| **Lista de pasos** | Filas numeradas que entran una a una; el paso activo con número en acento y los anteriores atenuados | `DATOS.steps(P, labels)` + `DATOS.stepsRun(t, S, [beats])` |
| **Inserto de motion graphics** | Otros apoyos (palabras clave, lista, imagen aprobada) a pantalla completa o en tarjeta | `INS.full(root, { kind, datos, inAt, outAt, modo })` de `lib/inserts.js` en build() + `ins.run(t)` en run(); datos solo de la voz (docs/apoyos.json) |
| **Imagen aprobada** | Ilustración aprobada por el usuario en tarjeta o a pantalla completa con empuje lento | `INS.full(root, { kind: 'imagen', src: '../assets/apoyos/<id>.png', inAt, outAt, modo })` (respeta la forma de la imagen) |
| **Subtítulos en caja** | Trozo de 2–3 palabras; una caja del acento de la marca se desliza detrás de la palabra hablada | `timeline.captions = { formats: ["9x16"], preset: "box-marca", accent: "<acento de la marca>", y: 0.73 }` (lo dibuja `lib/captions.js`) |
| **CTA** | Píldora blanca (`--white`, texto `--on-white` por contraste) con el @ en la caja de acento, salta y pulsa una vez | `DATOS.ctaRun(t, el, 'cta_pill', 'pulse')` |

Resortes: `heavy` para la tarjeta, la cámara y los títulos; `default` para paneles y barras; `snappy` para píldoras y pasos. Nada entra con fade: la opacidad hace snap.

## Tipografía
- Una familia: Montserrat ExtraBold 800 (`assets/fonts/captions/Montserrat-ExtraBold.ttf`), la misma de los subtítulos.
- Título de gancho en MAYÚSCULAS, 84–112 px a 1080 de ancho, alineado a la izquierda en x ≥ 110 px. Cabeceras de sección en frase normal, 60–64 px. Cifra clave 170–200 px con cifras tabulares (no bailan al contar).
- Etiquetas de panel en MAYÚSCULAS espaciadas, 38 px; notas en 36 px. Nada legible < 36 px en 9:16 (prueba del teléfono a 360 px).

## Color
- Fondo pizarra (`--bg` #12161D → `--bg-2`), paneles un tono más claro (`--panel`), texto blanco y gris (`--muted`) para lo secundario.
- **Un solo acento = el de la marca** (`--accent`): caja de los subtítulos, palabra clave del gancho, cifra clave, barra destacada, paso activo, píldoras y @ del CTA. `#4CC9F0` es el acento de plantilla y se usa **solo cuando el proyecto no tiene marca**.
- El texto sobre el acento (`--on-accent`) lo calcula `datos.js` por contraste (#111 o #fff), igual que `boxText: "auto"` de los subtítulos box-marca: un acento oscuro lleva texto blanco y uno claro, texto negro, sin tocar nada.
- El acento usado **como color de texto sobre el panel o el fondo** (cifra clave y su subrayado, valor de la barra destacada, palabras de acento de las cabeceras) va en `--accent-text`, que `datos.js` también calcula: el mismo tono del acento, aclarado (u oscurecido si el fondo es claro) hasta 3:1 si el de la marca no lee sobre `--panel`/`--bg`. La barra destacada, su valor y el número del paso activo van en `--accent-fill` (el acento aclarado hasta 4,5:1 contra `--line` y `--panel`, para que un acento oscuro no desaparezca en su carril), y la barra normal y su cifra (`--bar-plain`, `--val-plain`) se atenúan si resaltarían más que la destacada. Lo que no calcula: las palabras clave de los subtítulos (`captions.accent`) sobre el fondo. Con un acento oscuro (azul marino, verde botella…) pon `captions.boxColor` = el acento de la marca y `captions.accent` = ese tono aclarado; no cambies de color ni preguntes, y anótalo en el resumen final.
- La imagen de la persona en su color original (sin LUT salvo aprobación con antes/después). Sombras profundas y suaves; nunca glow.

## Subtítulos
- Preset **`box-marca`** (elegido sobre `subrayado`: la caja del color de la marca repite el lenguaje de los paneles y lee mejor sobre el fondo oscuro; `boxText: "auto"` resuelve el contraste con cualquier acento). Ajustes del proyecto: `accent` (siempre el acento de la marca), `keywords`, `size` 66 y `y` 0,73 en 9:16.
- Los subtítulos viven **debajo de los paneles**, sobre el fondo, nunca sobre la cara de la persona. Si un panel crece hacia abajo, súbelo o usa `yAt`.
- Siempre quemados en 9:16. Nunca subtitular dos veces lo que ya aparece como título (`skip`, como el gancho de la demo).

## Transiciones
| Transición | Timing |
|---|---|
| Tarjeta grande → esquina | 0,5–0,7 s de resorte `heavy` cuando la voz anuncia el primer dato |
| Panel → panel | el saliente empuja a la izquierda y el entrante llega desde la derecha casi a la vez (`default`) |
| Corte de toma | entre frases, sin aire; si la toma siguiente es del mismo plano, cambia la escala (1,00 ↔ 1,06) |
| Esquina → tarjeta grande | en la frase del CTA, `heavy`; nunca crossfade |

## Sonido y música
- La voz es lo primero: limpia, con compresión ligera, sin ruido de sala.
- Música opcional y original, baja (−18 a −22 dB bajo la voz, ducking), tranquila y con pulso: electrónica suave o lo-fi, 90–105 BPM.
- SFX sutiles: `whoosh` en la tarjeta y los paneles, `tick` en el conteo, `pop` en barras y pasos (suaves), `pop` en el CTA.
- Mezcla −14 LUFS integrado, true peak ≤ −1 dBTP.

## Voz en off
- No hay VO aparte: la voz es la de la persona en cámara. Si se agrega una VO de apoyo (narrador), va en frases colocadas en beats y con subtítulos del mismo preset.
- Cada cifra en pantalla la dice la voz, con la misma unidad y redondeo.

## Formatos
- 9:16 principal: tarjeta grande x 70–1010, y 280–1320; tarjeta pequeña x 80–450, y 290–760; cabecera en x 490; paneles x 80–950, y 830–1290; subtítulos en y 0,73. Nada clave en el 14 % superior, 20 % inferior ni 12 % derecho.
- 1:1 / 4:5: tarjeta pequeña arriba a la izquierda, panel debajo más bajo; subtítulos en y 0,80–0,86 (`yFmt`).
- 16:9: la tarjeta de la persona se va a la mitad izquierda y los paneles ocupan la derecha.

## Reglas recurrentes y prohibiciones
- Frame 0 con la persona ya hablando y el título de gancho visible.
- **Datos reales solo si la voz los dice y el usuario puede respaldarlos.** En la demo las cifras son de ejemplo y lo dicen en pantalla («Cifra de ejemplo», «Valores de ejemplo»): nunca las dejes en un video final ni inventes cifras para rellenar un panel. Si no hay dato, usa una lista o pasos en vez de una cifra.
- Los insertos ilustrativos (motion graphics con `INS` e imágenes que el usuario aprobó en docs/apoyos.json) sí van: ilustran lo que dice la voz y sus textos y cifras salen solo de ella. Nunca IA para "resultados" (antes/después de clientes, métricas, testimonios, capturas que parecen reales), nunca caras de personas reales, nunca imágenes o datos inventados. Los apoyos con `usable: false` se saltan.
- Prohibido: gráficos decorativos sin dato, dos paneles a la vez, ejes y leyendas ilegibles, fuentes de datos falsas, emojis, transiciones de plantilla (giros, glitches, light leaks), fades, subtítulos sobre la cara.

## Qué revisa el crítico
- Cada panel entra cuando la voz anuncia el dato y cada conteo, barra o paso cae en la palabra que lo nombra (±80 ms).
- Las cifras de pantalla coinciden exactamente con lo que dice la voz; ninguna cifra sin respaldo; no queda ninguna marca «de ejemplo» en el video final.
- La cara se ve siempre (tarjeta grande o pequeña) y los subtítulos no tapan la boca ni los ojos ni un panel.
- Texto legible a 360 px y fuera de las zonas de UI; un solo acento y con buen contraste.
- Cada apoyo aprobado y usable (`usable: true` en docs/apoyos.json) aparece en su tramo con sus textos literales de la voz.
- Loudness en objetivo y la música nunca tapa la voz.

## Cómo usar la demo
La demo (14,4 s, 100 BPM, 9:16) es un talking head de ejemplo con **una persona dibujada** como marcador («TU VIDEO A CÁMARA AQUÍ») que explica «lo que dicen los datos»: título de gancho con la caja de acento en «datos», tarjeta que se encoge a la esquina, panel «Tu dato clave» que cuenta hasta una cifra de ejemplo, panel de barras «Opción A / Opción B» con valores de ejemplo, lista de tres pasos, tarjeta que vuelve a llenar el cuadro y la píldora «Sigue a @tumarca». La voz es una VO de ejemplo escrita en `demo/index.html` (`window.VO`) para que los subtítulos se vean sin audio. En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/datos.js` a `film/datos.js` (el `<script src="datos.js">` y el de `lib/inserts.js` ya van antes de `film.js` en `demo/index.html`). La tipografía es Montserrat ExtraBold, que `init.sh` ya deja en `assets/fonts/captions/`: no hay que copiar fuentes.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después pon tu material: tu clip a cámara en lugar de la silueta (`scripts/seq.py` → `C.drawSeq` dentro de `DATOS.drawCard`, con la misma `z` de punch-ins), tu voz (`scripts/vo.py` + `scripts/words.py`; con eso la VO de ejemplo se ignora sola), **tus datos** en los paneles (cifra, etiquetas, barras, pasos; quita las notas «de ejemplo») y tu @ en la píldora. Ajusta las marcas de `timeline.json` a las palabras reales de tu voz.

## Cómo adaptarlo a tu marca
1. **Arranca desde la demo:** sigue «Cómo usar la demo» y parte de esa copia.
2. **Acento:** pon el color de acento de tu marca en `--accent` de `film/index.html` y en `timeline.captions.accent`. Todo lo demás (caja de subtítulos, cifra, barra destacada, pasos, píldoras) lo toma solo, y el texto sobre el acento se ajusta por contraste. La cifra y las palabras de acento usan un tono legible del mismo acento (`--accent-text`, automático); la barra destacada, su valor y el número del paso activo usan `--accent-fill`, el acento aclarado (u oscurecido) si se perdería sobre el carril `--line`, y la barra normal y su cifra se atenúan solas si resaltarían más que la destacada (automático). Solo las palabras clave de los subtítulos no se ajustan solas: con un acento oscuro, sigue lo que dice «Color».
3. **Fondo:** si tu marca es clara, puedes aclarar `--bg`, `--bg-2` y `--panel` y pasar `--white` a un tono de tinta oscuro; entonces oscurece también `--line` (carril de barras y pasos: un gris claro, p. ej. `#D9DCE1`) y `--muted` (etiquetas y notas: un gris medio, p. ej. `#5B6573`), que si no quedan claros sobre claro. El texto de la píldora del CTA (`--on-white`) se ajusta solo al nuevo `--white` (#111 o #fff), y el título de gancho (sobre la tarjeta de video, con su velo oscuro) queda siempre en blanco, sin depender de `--white`. Revisa en el render que el título de gancho, la caja de los subtítulos, las etiquetas y la píldora del CTA sigan leyendo.
4. **Tipografías:** si tu marca tiene una sans propia con peso 800 (o 700), cámbiala en el `@font-face` y en `C.fonts`, y pásala a los subtítulos poniendo en `timeline.captions` tanto `"font"` (tu familia) como `"fontFile": null` (el preset box-marca trae `fontFile` de Montserrat, que si no lo anulas va delante de tu familia y los subtítulos siguen en Montserrat); revisa que las cifras sigan siendo tabulares.
5. **CTA y @:** cambia la píldora «Sigue a @tumarca» por el CTA de tu guía de marca.
6. **Voz y tono:** los títulos de sección y etiquetas siguen la voz de la marca (sus palabras a usar y a evitar).

## Si buscas otra cosa
- ¿Subtítulos palabra por palabra con punch-ins y b-roll, sin paneles? Usa **Talking karaoke**.
- ¿Algo sobrio y profesional, con rótulo de nombre y especialidad, para salud o servicios? Usa **Talking sobrio**.
- ¿La marca al frente: título de gancho, barra de progreso y CTA en su color? Usa **Talking marca**.
- ¿Alta energía, una palabra gigante a la vez y cortes duros para ventas directas? Usa **Talking palabra**.
- ¿Explicar con calma con tarjetas y diagramas, sin persona a cámara? Usa **Tarjeta escenario** o **Paneles con UI**.
