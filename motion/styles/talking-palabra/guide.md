# Talking palabra

## Esencia
- Persona a cámara (talking head) en 9:16 con **una sola palabra grande a la vez** en pantalla (preset `palabra-hook`): cada palabra salta al decirse; las palabras clave, más grandes y en el color de acento.
- La cámara **no usa resortes**: todo es corte seco. Saltos de escala (1,00 → 1,22–1,32) y de encuadre caen en los beats y en las palabras fuertes; nada se desliza.
- Cada tanto, un **golpe de palabra a pantalla completa**: el cuadro entero se vuelve del color de acento con UNA palabra gigante (la que dice la voz) y vuelve a la persona con otro corte seco.
- Alta energía y ritmo rápido: algo cambia cada 1–2 s. Para ganchos, ventas directas, ofertas y anuncios cortos de 10–45 s.

## Estructura y ritmo
| Tramo | Duración | Qué pasa |
|---|---|---|
| Gancho | 0–2 s | Frame 0 ya muestra a la persona hablando + la primera palabra del gancho estampada arriba; cada palabra del gancho se estampa al decirse (la última en acento) con salto de cámara. |
| Golpe 1 | ~2 s | Primer golpe de palabra a pantalla completa (una palabra corta: «Escucha», «Ojo», «Mira»). Se lleva el gancho. |
| Desarrollo | cuerpo | Frases cortas, una palabra en pantalla; salto de cámara en cada palabra clave y corte de encuadre en cada frase nueva; un golpe de palabra cada 4–6 s como máximo. |
| Remate / CTA | últimos 2–3 s | Salto duro en el verbo del CTA; píldora de acento estampada que late una vez; empuje lineal lento para que el cierre no quede quieto. |

- El ritmo lo dicta la voz: frases de 1–2 s, sin silencios > 0,25 s (se recortan en la edición de tomas). Con música, los saltos fuertes y los golpes de palabra caen en beats.
- Nunca dos saltos de escala iguales seguidos: alterna 1,00 / 1,08–1,12 / 1,22–1,32 y desplaza el encuadre (±30–40 px) en cada frase nueva para que el corte se sienta como otro ángulo.
- Ningún tramo > 2 s sin un cambio visual.

## Vocabulario de movimiento
Helpers en `helpers/palabra.js` (`window.PALA`): cópialo a `film/palabra.js` y cárgalo en `film/index.html` antes de `film.js`. La persona se dibuja desde frames (`seq.py`) con `C.drawSeq` en un canvas.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Salto seco de cámara** | La escala y el encuadre cambian de golpe en el beat de la palabra fuerte; sin resorte | `const cam = PALA.snap(t, [[0, { z: 1, x: 0 }], ['w_fuerte', { z: 1.25, x: 0 }], ['frase2', { z: 1, x: -40 }]])` → `C.drawSeq(g, frames, t, t0, box, { z: cam.z, pos })` con el lienzo desplazado `cam.x` |
| **Sacudida del golpe** | 0,2 s de temblor sembrado tras un golpe | `PALA.shake(t, ['golpe1', 'golpe2'], { amp: 14 })` → suma `x`, `y`, `r` al canvas; solo en golpes y remate |
| **Golpe de palabra a pantalla completa** | Corte seco a fondo de acento con una palabra gigante que baja de 1,12 a 1,00 en 0,12 s y empuja un 4 %; sale con corte seco | `PALA.slam(t, card, word, inAt, outAt)`; tamaño con `PALA.fitSize(palabra, W * 0.74)`; tinta con `PALA.inkOn(acento)`; la frase va en `captions.skip` |
| **Gancho estampado** | Cada palabra del gancho aparece seca al decirse (1,4 → 1,0 en 0,1 s), apiladas a la izquierda | `PALA.stamp(t, el, beat, outAt)` por palabra |
| **Subtítulos de una palabra** | Una palabra grande a la vez saltando con la voz; las clave más grandes en acento | `timeline.captions = { formats: ["9x16"], preset: "palabra-hook", accent: "<acento de la marca>" }`; `words.py` + `sync.mjs` (lo dibuja `lib/captions.js`) |
| **Inserto de motion graphics** | Palabras clave, una cifra que dice la voz, pasos o comparación animados a pantalla completa | `INS.full(root, { kind, datos, inAt, outAt, modo })` de `lib/inserts.js` en build() + `ins.run(t)` en run(); datos solo de la voz (docs/apoyos.json) |
| **Imagen aprobada** | Ilustración aprobada por el usuario a pantalla completa o en tarjeta, entra con corte seco | `INS.full(root, { kind: 'imagen', src: '../assets/apoyos/<id>.png', inAt, outAt, modo })` (respeta la forma de la imagen; no uses `C.photo`, que la recorta) |
| **CTA estampado** | Píldora de acento que cae seca y late una vez | `PALA.stamp(t, cta, 'cta', null, { from: 1.3 })` + un pulso de 0,25 s |

Nada entra con fade ni con resorte lento en la cámara; los únicos rebotes son los propios de los subtítulos.

## Tipografía
- Subtítulos: Montserrat ExtraBold 800 (`captions/fonts/Montserrat-ExtraBold.ttf`), MAYÚSCULAS, contorno negro, sombra suave; y = 0,62 del alto; tamaño 92–110 px a 1080 (la demo usa 92 con `kScale` 1,12 para que «SOLUCIÓN» o «EL PROBLEMA» no entren al 12 % derecho).
- Gancho: misma familia en 800, 110–130 px, alineado a la izquierda en x ≥ 80 px, una palabra por línea, la última en acento.
- Golpe de palabra: 170–300 px según el largo (`PALA.fitSize`), interletrado −0,04 em, una sola palabra de ≤ 8 letras.
- Nada legible < 36 px a 1080 × 1920; prueba del teléfono a 360 px.

## Color
- La imagen de la persona en su color original (sin LUT salvo aprobación con antes/después).
- Acento = el color de acento de la marca: palabras clave de los subtítulos, última palabra del gancho, fondo de los golpes de palabra y píldora del CTA. `#FF5A1F` es el acento de plantilla y se usa **solo cuando el proyecto no tiene marca**.
- Todo lo de color sale de `--accent` en `:root` (también el halo y la luz de borde de la persona dibujada): cambiarlo ahí recolorea la demo entera. El texto sobre el acento se elige solo por contraste (`PALA.inkOn`: negro o blanco).
- Blanco para el texto base, negro para el contorno.
- Si el acento de la marca no lee sobre la imagen, no cambies de color ni preguntes: aclara u oscurece el mismo tono o engrosa el contorno, y anótalo en el resumen final.

## Subtítulos
- Preset `palabra-hook` (estilo `word`: una palabra a la vez, y 0,62). Las palabras de función («el», «tu», «una») viajan pegadas a la siguiente, así que a veces se ven dos palabras: es intencional. Ajustes del proyecto: `accent` (siempre el de la marca cuando hay marca), `keywords`, `size`, `kScale`, `yAt` si hay un inserto en esa zona.
- Siempre quemados en 9:16 (autoplay sin sonido). Lo que ya está en pantalla como gancho o golpe de palabra va en `skip` (nunca subtitular dos veces).
- Nunca sobre la boca ni los ojos: con la cara en y ≈ 0,45 los subtítulos caen sobre el pecho.

## Transiciones
| Transición | Timing |
|---|---|
| Corte de toma | entre frases, seco, siempre con cambio de escala o de encuadre |
| Salto de cámara | instantáneo en el beat de la palabra fuerte (sin resorte) |
| Golpe de palabra | entra y sale con corte seco; dura 0,6–0,8 s |
| Inserto / imagen | entra y sale con corte seco o subiendo rápido desde abajo; nunca crossfade |

## Sonido y música
- La voz es lo primero: limpia, con compresión algo más fuerte que en un talking tranquilo, sin ruido de sala.
- Música opcional y original, con pulso marcado (trap suave, electrónica, 110–130 BPM), −16 a −20 dB bajo la voz con ducking.
- SFX: `thump` en cada golpe de palabra y en el remate, `click` en los saltos de cámara de las palabras clave, `pop` en el gancho y el CTA. Sin `whoosh`: aquí nada se desliza.
- Mezcla −14 LUFS integrado, true peak ≤ −1 dBTP.

## Voz en off
- No hay VO aparte: la voz es la de la persona en cámara. Para un golpe de palabra, conviene que esa palabra se diga sola (frase de una palabra: «Escucha.», «Simple.»); así entra en `skip` sin cortar otra frase.

## Formatos
- 9:16 principal: cara en el tercio medio (pos y ≈ 0,45), subtítulos en y 0,62, nada clave en el 14 % superior, 20 % inferior ni 12 % derecho (el gancho empieza en y 0,15, el CTA en y 0,72).
- 1:1 / 4:5: encuadre más cerrado, subtítulos en y 0,74–0,80 (`yFmt`), golpes de palabra al 74 % del ancho.
- 16:9: persona a un lado (pos x 0,33), gancho y golpes en la otra mitad.

## Reglas recurrentes y prohibiciones
- Frame 0 con la persona ya hablando y la primera palabra del gancho visible.
- Sin silencios muertos y sin tramos quietos de más de 2 s.
- B-roll solo si la voz lo nombra y el clip lo prueba (nada genérico de relleno). Los insertos ilustrativos (motion graphics con `INS` e imágenes que el usuario aprobó en docs/apoyos.json) sí van: ilustran lo que dice la voz y sus textos y cifras salen solo de ella. Nunca IA para "resultados" (antes/después de clientes, métricas, testimonios, capturas que parecen reales), nunca caras de personas reales, nunca imágenes o datos inventados.
- Prohibido: resortes o zoom lento en la cámara (salvo el empuje final del CTA), fades, crossfades, transiciones de plantilla (giros, glitches, light leaks), más de un golpe de palabra cada 4 s, golpes con frases largas, subtítulos sobre la cara, emojis.

## Qué revisa el crítico
- La palabra en pantalla coincide con lo que se oye (±80 ms); las palabras de función no quedan solas.
- Subtítulos legibles a 360 px y fuera de las zonas de UI; no tapan la boca ni los ojos.
- Hay un cambio visual cada 1–2 s; los saltos de cámara son secos, caen en palabras fuertes y varían de escala.
- Los golpes de palabra usan la palabra que dice la voz, leen de un vistazo y no se repiten como subtítulo.
- El b-roll y los insertos corresponden exactamente a lo que la voz dice en ese momento; cada apoyo aprobado y usable (`usable: true` en docs/apoyos.json) aparece en su tramo y sus textos/cifras son literales de la voz; los `usable: false` se saltan (no se rellenan con otro inserto).
- Loudness en objetivo y la música nunca tapa la voz.

## Cómo usar la demo
La demo (12,5 s, 120 BPM, 9:16) es un talking head de ejemplo con **una persona dibujada** como marcador («TU VIDEO A CÁMARA AQUÍ») que da un consejo de venta genérico: gancho «¿Quieres vender más?» estampado palabra por palabra, golpes de palabra «Escucha» y «Simple» a pantalla completa en el acento, subtítulos de una palabra (preset palabra-hook) con «problema», «solución» y «oferta» como palabras clave, saltos secos de cámara con cambio de encuadre y la píldora final «Escríbenos · @tumarca». La voz es una VO de ejemplo escrita en `demo/index.html` (`window.VO`) para que los subtítulos se vean sin audio. En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/palabra.js` a `film/palabra.js` (el `<script src="palabra.js">` y el de `lib/inserts.js` ya van antes de `film.js` en `demo/index.html`). La tipografía es Montserrat ExtraBold, que `init.sh` ya deja en `assets/fonts/captions/`: no hay que copiar fuentes.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después pon tu material: tu clip a cámara en lugar de la silueta (`scripts/seq.py` → `C.drawSeq(g, frames, t, t0, box, { z: cam.z, pos: [0.5, 0.45] })` con la misma tabla `CAM` de saltos que usa la demo), tu voz (`scripts/vo.py` + `scripts/words.py`; con eso la VO de ejemplo se ignora sola), tus palabras de golpe y tu @ en la píldora. Ajusta las marcas de `timeline.json` a las palabras reales de tu voz y los textos de `skip`.

## Cómo adaptarlo a tu marca
1. **Arranca desde la demo:** sigue «Cómo usar la demo» y parte de esa copia.
2. **Acento:** pon el color de acento de tu marca en `--accent` (`:root` de `film/index.html`) y en `timeline.captions.accent`. Recolorea golpes de palabra, gancho, palabras clave, CTA y la luz de la escena; el texto sobre el acento se vuelve negro o blanco solo. Conserva los roles: un solo acento, texto base blanco, contorno negro.
3. **Tipografías:** si tu marca tiene una sans propia con peso 800 (o 700), cámbiala en el `@font-face` y en `C.fonts`, y pásala a los subtítulos poniendo en `timeline.captions` tanto `"font"` (tu familia) como `"fontFile": null` (el preset palabra-hook trae `fontFile` de Montserrat, que si no lo anulas va delante de tu familia y los subtítulos siguen en Montserrat); revisa que la palabra más larga del golpe siga entrando (ajusta `em` en `PALA.fitSize`). Si no, quédate con Montserrat ExtraBold.
4. **CTA y @:** cambia la píldora «Escríbenos · @tumarca» por el CTA de tu guía de marca (con su verbo y su @ o sitio).
5. **Metraje:** reemplaza la silueta por tu clip a cámara (`seq.py` + `C.drawSeq` con la misma tabla de saltos) y usa los apoyos aprobados (docs/apoyos.json → `INS.full`) donde la voz los nombra; si no hay, deja que trabajen los saltos y los golpes de palabra.
6. **Voz y tono:** las palabras de golpe y las palabras clave siguen la voz de la marca (sus palabras a usar y a evitar); si la marca es sobria, usa menos golpes (uno o ninguno) o cambia de plantilla.

## Si buscas otra cosa
- ¿El mismo talking head con subtítulos de varias palabras y b-roll, más versátil? Usa **Talking karaoke**.
- ¿Algo calmado y profesional, con nombre y especialidad en pantalla? Usa **Talking sobrio**.
- ¿Tu marca muy presente (título con caja de color, barra de progreso, CTA de marca)? Usa **Talking marca**.
- ¿Explicar con cifras, comparaciones y pasos junto a la persona? Usa **Talking con datos**.
- ¿Un reel sin persona a cámara, todo en tipografía y motion? Usa **Punto cinético**.
