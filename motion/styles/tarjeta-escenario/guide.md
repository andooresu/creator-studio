# Tarjeta escenario

## Esencia
- Se siente como un carrusel editorial que cobra vida: calma, precisión y lujo silencioso. El fondo claro domina (≈70 %), la tinta marca (≈22 %) y el acento aparece solo donde está la respuesta (≈8 %).
- Sirve para reels explicativos de 15–40 s, con o sin voz en off: un problema convertido en pregunta, el porqué, la solución, el ritmo o la frecuencia, la prueba y el CTA. Funciona muy bien para una clínica, un estudio, un curso, un servicio profesional o un producto premium.
- Se reconoce por tres cosas:
  1. La **tarjeta escenario**: una caja redondeada con el material adentro (clip, foto o diagrama) y el texto SIEMPRE fuera de ella, debajo o al lado.
  2. Los **diagramas dibujados y sembrados**, que explican lo que una foto no debe o no puede mostrar (un proceso, un ciclo, un desgaste, un antes y un después abstracto).
  3. Los **puntos de carrusel** que avanzan bajo la tarjeta, y el **cierre en campo oscuro** con la marca en acento.
- La energía viene del movimiento continuo dentro de la tarjeta (empujes de cámara, diagramas que cambian, rieles que se llenan, anillos que cierran), no de cortes rápidos.
- Demo incluida: `demo/` (≈13 s, 9:16 y 4:5, sin archivos externos) con un caso de guía de cuidado posterior a un servicio: qué hacer en casa, qué es normal y cuándo volver. Vista previa en `demo/preview.jpg`.

## Estructura y ritmo
- **BPM:** 90–116. Lo típico es 94–104 con voz y 108–116 sin voz (las piezas sin voz cargan el ritmo en el titular y los SFX).
- **Duración:** 15–40 s. Densidad orientativa: 15–25 marcas en `timeline.json` y 15–35 SFX (sin voz, casi el doble).
- **Actos típicos** (en beats, a ~100 BPM). Usa los que tu historia necesite, en este orden:
  1. **Hook** (0–8 b): tarjeta con el resultado o el material más atractivo + titular-pregunta o promesa de 2–3 líneas. El frame 0 ya muestra la tarjeta asentada, el eyebrow y la línea 1 legible.
  2. **Giro / ruptura** (8–18 b): rompe la plantilla con tipo enorme arriba y la tarjeta-diagrama abajo (una pregunta corta, por ejemplo «¿Se ve menos?», → la explicación).
  3. **Cómo funciona** (18–40 b): 2–3 subsecciones. Cada una con su clip o su estado del diagrama y su titular, que se reemplaza en secuencia. Aquí viven las píldoras de pasos.
  4. **Tiempo / ciclo** (16–24 b): riel de días o semanas, calendario de N puntos o anillo de N arcos que se llena con la voz y aterriza en acento.
  5. **Solución / cuidado** (8–16 b): una pregunta corta en tipo grande («¿Y entonces?») y luego la respuesta con el acento.
  6. **Prueba o precio** (8–18 b): tabla que se construye fila por fila o una prueba verificable (calificación + número de reseñas, premio real).
  7. **Cierre** (6–8 b): campo oscuro, marca en acento, CTA, contacto y puente de loop.
- La demo usa 1 → 3 → 2 → 4 → 7 en 22 beats (los pasos van antes de la ruptura porque el caso es un cuidado: primero qué hacer, luego qué es normal): `hook` 0, `pasos` 4, `giro` 8.5, `ciclo` 13.5, `end` 17.5, `loop` 21.25, `done` 22. Puedes volver al orden 1 → 2 → 3 cuando tu historia empieza por el porqué.
- **Cortes:** los cambios de sección caen en la línea de compás o en el inicio de la frase de voz, ajustado al beat más cercano.
- **Eventos internos** en beats o medios beats; con voz, derivados de `TARJ.wb(id)` (beat de cada palabra hablada). Nunca en segundos fijos.
- **Algo nuevo cada 1–2 beats:** una palabra, una etiqueta, un punto del riel, una fila, un arco, un paso. Ningún estado dura más de 1 compás sin un elemento nuevo.
- **Hold máximo:** 4 beats, siempre con micro empuje. El cierre dura ≤ 2 s útiles y nunca queda estático.

## Rejilla y formatos
Usa `TARJ.lay(altoTarjeta)` para la plantilla estándar y `TARJ.brk()` para la ruptura; ambos ya re-bloquean por formato y devuelven `{ CARD, EYE, HEAD, DOTS }`.
- **9:16:**
  - Tarjeta en x=64, y=170, w=952, h=800–1030 (la altura varía por escena para que el bloque de texto llegue hasta y≈1450–1530).
  - Puntos 26 px bajo la tarjeta, eyebrow 56 px bajo la tarjeta y titular 70 px bajo el eyebrow. Máximo 3 líneas.
  - Ruptura: tipo grande en y≈340, tarjeta en y=720, h≈790.
  - El texto clave nunca queda en el 14 % superior (y<269), en el 20 % inferior (y>1536) ni pasado x=940. Las etiquetas se limitan a esa zona (`placeTag` ya lo hace).
- **4:5 y 1:1:** tarjeta en 60, 60, ancho completo menos márgenes, alto 720–800 (4:5) o ≈600 (1:1); eyebrow 52 px bajo la tarjeta y titular 64 px más abajo. En la ruptura, tipo arriba y tarjeta desde y≈400. En 1:1, si una lista no cabe debajo, ponla al lado de la tarjeta.
- **16:9:** la tarjeta ocupa la mitad derecha (≈46 % del ancho) y el bloque de texto va a la izquierda en x=120, centrado vertical. Los puntos van bajo la tarjeta.
- Re-bloquea por escena: nunca escales la composición 9:16. Juzga cada formato en su propia hoja de contactos.

## Tipografía
- **Una sola familia:** Plus Jakarta Sans (incluida en `fonts/`, licencia SIL OFL 1.1). Display en 400–500, UI en 500–600. Nada de serifas decorativas ni una segunda familia.
- **Display de peso ligero (400):** la elegancia viene del tamaño y del aire, no del negro. Line-height 1.13, sentence case y punto final en las afirmaciones. Las preguntas llevan ¿ ? completos. El padding superior de `.line` (0.32em) protege tildes y signos de apertura.
- **Tamaños a 1080 px de ancho** (constantes en `TARJ`, por formato con `C.pick(16:9, 4:5 y 1:1, 9:16)`):
  - Titular de 2 líneas `TARJ.HS`: 100 en 9:16, 80 en 4:5.
  - Titular de 3 líneas `TARJ.H3`: 90 / 70.
  - Afirmación de ruptura `TARJ.BIG`: 128 / 120.
  - Palabra única de cierre de sección: 150–170.
  - Eyebrow `TARJ.EYE`: 38 / 33, en mayúsculas espaciadas y color `--muted`.
  - Píldoras y etiquetas: 36–44. Etiquetas de riel: 34–40. Precios: 58–62.
  - Nada que deba leerse queda bajo 33 px.
- **Alineación:** todo a la izquierda en `TARJ.M`. La única excepción son las etiquetas centradas sobre un punto del riel.
- **Acento:** solo en la palabra clave o en la segunda frase (la respuesta, el número, el verbo del cambio), con `accent: [[línea, palabra]]`, y nunca en más de 3 palabras por titular.
- Si no cabe, escala la tarjeta, no la letra.

## Color
Paleta de ejemplo (verde salvia sobre papel). Son tokens `:root` en `demo/index.html`; los helpers los leen solos.

| Rol | Token | Hex | Uso |
|---|---|---|---|
| Fondo | `--bg` | #F3F4F0 | Lienzo de todas las secciones (≈70 %) |
| Superficie | `--surface` | #E6EAE3 | Píldoras de pasos, fila resaltada, marcador de clip |
| Tinta | `--ink` | #15201B | Titulares, indicador de puntos, relleno de rieles (≈22 %) |
| Tinta 2 | `--ink-2` | #4F5B55 | Texto secundario, píldoras inactivas |
| Muted | `--muted` | #6D7871 | Eyebrows y etiquetas de riel |
| Acento relleno | `--accent-fill` | #3E8E78 | Último punto, último arco, marcas del diagrama, marca y píldora CTA del cierre |
| Acento texto | `--accent` | #2B6B59 | Palabra acento sobre fondo claro, elementos que cambian en el diagrama, valor ganador |

- Tokens auxiliares derivados: `--line` (separadores, arcos vacíos), `--rail` (riel y puntos apagados), `--night` (campo del cierre; puede ser igual a la tinta) y `--diagram-1/2/3` (grises del diagrama, del más suave al más fuerte).
- **Un solo acento en dos tonos:** el de texto debe pasar contraste sobre el fondo; el de relleno se usa en formas y sobre el campo oscuro.
- El diagrama va en los grises del diagrama; el acento solo en lo que cambia (cae, nace, se rellena).
- Todas las secciones van sobre el fondo claro. El único cambio de campo es el oscuro del cierre (y el fondo claro del puente de loop).
- Una variante de marca puede abrir en campo oscuro con una banda de acento que cruza; aun así, el texto nunca va sobre la foto.
- **Footage siempre en color original:** sin grade, LUT ni filtros decorativos, salvo un antes/después aprobado.

## Vocabulario de movimiento
Helpers en `helpers/tarjeta.js` (`window.TARJ`). Cópialo a `film/tarjeta.js` y cárgalo en `film/index.html` después de `type.js` y antes de `film.js`.

| Movimiento | Cómo se ve | Con el motor |
|---|---|---|
| Tarjeta escenario | Caja redondeada (radio 40 px en 9:16) con canvas propio y sombra suave y larga | `K = TARJ.card(root, L)`; dibuja en `K.g` cada frame (limpia primero) |
| Material real | Foto en cover con zoom; footage desde secuencias | `TARJ.photo(K.g, img, K.B, z, py)` · `C.drawSeq(K.g, frames, t, bt(marca), K.BOX, { pos, z, fps })` |
| Marcador de clip | Superficie con formas suaves que derivan, ícono de play y «TU CLIP AQUÍ» | `TARJ.placeholder(K.g, K.B, t, { seed, sub, z })`. Sustitúyelo por tu material |
| Asentado del frame 0 | La tarjeta va de 0.94 a 1 cuando arranca el video; el eyebrow ya es visible | `TARJ.settle(t, K)` · `TARJ.showEye(t, eye, -0.6)` · primera línea con beat −0.4 |
| Entrada de carrusel | Al cambiar de sección, el contenido empuja desde la derecha un 22 % del ancho; el marco no se mueve | `TARJ.slideIn(t, K, marca)` + SFX de deslizamiento en la marca |
| Micro empuje | El material crece de 1.00 a 1.06–1.10 durante la sección | `z = TARJ.push(t, b0, b1, 1, 1.06)` |
| Punch al beat | En la palabra clave el material salta un 6–20 % | `z *= TARJ.punch(t, beat, 0.2)` |
| Titular por voz | Cada línea sube por su máscara cuando se pronuncia; líneas escalonadas 0.12 b, o palabra por palabra | `h = TARJ.head(root, líneas, { y: L.HEAD, size, accent })` + `TARJ.riseH(t, h, beats, salida, { perWord })` |
| Swap secuencial | La línea saliente termina de salir 0.26 b antes de la siguiente | `TARJ.riseH(t, h1, b1, TARJ.OUT(b2))`. Nunca dos titulares a la vez |
| Juego del hook | La palabra-concepto aterriza, se hunde ~10 %, rota ±4° y se recupera dentro de su máscara | `TARJ.hookDip(t, línea, índice, beat, ±1)` después de `riseH` |
| Eyebrow | Línea pequeña en `--muted`, fade + 12 px desde la izquierda (la única que puede hacer fade) | `TARJ.eyebrow(root, texto, L.EYE)` + `TARJ.showEye(t, e, beat, salida)` |
| Puntos de carrusel | Fila de puntos de 12 px bajo la tarjeta activa; el indicador de tinta se estira y viaja | `TARJ.dots([[marca, layout], …], { to: 'end' })` (registra su propia escena). Tick suave por cambio |
| Diagrama sembrado | Ilustración lineal en grises; lo que cambia va en acento | `F = TARJ.fibers(semilla, n)` FUERA de `run`; en `run`: `F.draw(g, caja, { fall, regrow, refill, hl, gapMark })`. Para tu propio dibujo, sigue el mismo patrón: datos sembrados fuera, estado como función de t |
| Cámara en el diagrama | Zoom heavy hacia el detalle que se nombra y regreso a la vista general | `z = C.trk(t, [[0,1],[b-0.3,1.45,'heavy']])`; `map = TARJ.camera(g, K, z, fx, fy)` … `g.restore()` |
| Etiqueta que sigue | Píldora anclada a la punta de un trazo a través de la cámara, dentro de la tarjeta y de las zonas seguras | `tg = TARJ.tag(root, 'nuevo')` + `TARJ.placeTag(t, tg, ...map(punta), beat, K, { tw })` |
| Riel de tiempo | Riel de 6 px que se llena en tinta; paradas que se encienden; la última pasa a acento con pop ×1.4 | `R = TARJ.rail(root, { x0, x1, y, stops })` + `TARJ.railRun(t, R, entrada, progreso, beatPop)` |
| Calendario de N puntos | N puntos que se encienden uno a uno; el último en acento; etiqueta a la derecha | `TARJ.calendar(...)` + `TARJ.calendarRun(t, K, fijar, progreso, etiqueta)` |
| Anillo de arcos | N arcos que cierran uno por medio beat; el último en acento; número al centro | `TARJ.ring(root, { x, y, size, n })` + `TARJ.ringRun(t, R, entrada, primerArco, colapso)` |
| Píldoras de pasos | «1 Evalúa · 2 Aplica · 3 Mantén»; el indicador de tinta se desliza bajo el activo y su texto se aclara | `TARJ.steps(root, etiquetas, { y })` + `TARJ.stepsRun(t, S, entrada, marcas)` |
| Tabla que se construye | Filas que suben 26 px cada medio beat; la ganadora toma superficie y su valor pasa a acento | `TARJ.table(root, filas, { y })` + `TARJ.tableRun(t, filas, beat, índice, beatResalte)` |
| Lista numerada | Círculo de contorno en acento con número que entra con su verbo | `TARJ.numeral(root, n, x, y)` + `TARJ.numeralRun(t, e, beat)` |
| Cierre vivo | Campo oscuro; la marca se revela de izquierda a derecha; CTA heavy; píldora que crece 0.85→1; líneas que suben cada 0.5 b; brillo que cruza una vez; deriva de −24 px | `E = TARJ.endCard(root, { logoText | logoSrc, cta, button, lines })` + `TARJ.endRun(t, E, { end, ctaBeats, btn, sheen, drift })` |
| Puente de loop | Un panel claro con el estado del frame 0 sube y tapa el cierre en los últimos 0.75 b | `P = TARJ.bridge(root, pintarFrame0)` + `TARJ.bridgeRun(t, P, b0, b1)`; el hook se recalcula con t = 0 |

**Presets:** `heavy` para la cámara del diagrama, los punches y el titular del cierre; `default` para tarjetas, rieles, filas y anillos; `snappy` para titulares de cuerpo, píldoras, puntos y etiquetas. Todo lo que suena va con `spHit` (los helpers ya lo usan), nunca `sp`.

## Subtítulos
- **Preset `pill-sobrio` con `formats: []`:** por defecto no se queman, porque el titular ya es la frase hablada y competiría con él.
- Actívalos solo si se piden para un formato. En ese caso:
  - van debajo del bloque de titular, fuera de la tarjeta, en tinta sobre píldora de superficie;
  - usa `skip` en las frases que ya están literalmente en pantalla;
  - nunca van sobre una foto o un clip.

## Transiciones
| Transición | Timing | Notas |
|---|---|---|
| Slide de carrusel dentro de la tarjeta | `spHit` default en la marca, ~0.6 b para asentarse | Transición principal. El marco y los puntos se quedan; cambian contenido y titular |
| Swap de titular | Salida que termina en `siguiente − 0.26`; entrada en la palabra hablada | Lift por la máscara, sin superposición visible |
| Ruptura de plantilla | Corte duro en la línea de compás | Tipo grande arriba y tarjeta abajo (`TARJ.brk()`) |
| Reemplazo de material | En la palabra que lo nombra, con `slideIn` | Clip → foto, diagrama → clip, paso → paso |
| Colapso | El anillo o la etiqueta se encogen con `sp(salida, 'snappy')` | Para retirar elementos de interfaz |
| Al cierre oscuro | Corte duro en el compás; la marca se revela con clip-path en 1 b | Sin fundido |
| Puente de loop | Panel claro que sube en los últimos 0.75 b | El último frame empalma con el frame 0 |

Prohibido: crossfades, giros, glitches, destellos y transiciones de opacidad pura.

## Sonido y música
- **Música original por proyecto** (generada o un archivo propio). `compare_music.py` debe dar `distinct` contra tus reels anteriores.
- **Género:** house profundo minimalista o pop cálido con piano o Rhodes, bajo redondo, percusión suave (clap o rim limpio), sin vocales. Debe sonar cuidado y sereno; nunca club agresivo.
- **Energía:** intro de 1 compás con la textura ya sonando (el frame 0 nunca está mudo) → groove estable bajo la explicación → leve subida en la sección de ciclo → acorde final o drop suave en el cierre. Sin silencios dramáticos.
- **SFX** suaves y táctiles, todos declarados en `timeline.json` `sfx` y sobre el grid:
  - deslizamiento de papel o tarjeta en cada `slideIn`;
  - tick seco en cada punto del riel, del calendario o del carrusel;
  - clic suave en las píldoras de pasos;
  - pop leve en las etiquetas;
  - golpe cálido (thump) cuando algo aterriza en acento;
  - roce sutil cuando el diagrama cambia;
  - campanita limpia en la píldora CTA y su brillo.
  - Sin voz: un SFX por evento (hasta ~1.5 por beat en los punches).
- **Mezcla:** `music: -1`, `sfx: -6` (−4 sin voz), `vo: 0/+1`, `duck: true`. −14 LUFS integrados y TP ≤ −1 dBTP.

## Voz en off
- **Cuándo:** en piezas explicativas, sí. En piezas de marca o de preguntas puede no haber voz y el titular carga todo sobre los beats.
- **Tono:** cálido y profesional, español latino neutro, cercano pero sobrio, con tuteo. Frases cortas de 4–12 palabras. Las preguntas despiertan curiosidad y nunca insinúan que alguien se veía mal o hizo algo mal.
- **Colocación:** cortar en frases `p1…pN`; cada frase en un beat con 0.5–1 b de aire; nunca acelerar la toma completa. Las marcas de sección van en el beat de inicio de su frase. Los titulares usan `TARJ.wb('pN', respaldo)` para subir exactamente cuando se pronuncia cada palabra; puedes adelantar 0.2 b la palabra que debe leerse en su pop.
- **El texto en pantalla es la frase hablada, condensada:** misma palabra clave, mismo orden.

## Reglas recurrentes y prohibiciones
- **Nada de texto sobre fotos o clips:** el material vive en tarjetas redondeadas y el texto va debajo o al lado. (Las etiquetas sobre el diagrama dibujado sí se permiten.)
- **Material real para resultados:** nada de imágenes generadas que se presenten como resultados reales, sin retoque engañoso, sin emojis en pantalla.
- **Los problemas o defectos se muestran solo en el diagrama dibujado,** nunca en una persona real. El material real muestra resultados o el proceso.
- **Cada servicio o paso nombrado lleva el clip exacto de ese servicio** (verifícalo por nombre de archivo o contenido; si hay duda, pregunta).
- **Una familia tipográfica; acento ≤ 8 % del cuadro y en ≤ 3 palabras por titular.**
- **Tono sobrio:** nada de urgencia barata, nada de mayúsculas sostenidas en titulares, nada sensual.
- **El CTA es directo** («Agenda tu retoque.», «Pide tu guía», «Escríbenos») más tu usuario o canal de contacto. La prueba solo si es verificable.
- **Precisión de afirmaciones:** describe frecuencias y duraciones exactas; si varían, preséntalas como rango o como mantenimiento recomendado.
- **Diagramas sembrados** (`C.mulberry32` fuera de `run`); nada mutado en `run`; posiciones enteras (`Math.round`) en elementos grandes.
- **Tiempos en beats y marcas,** nunca en segundos fijos.
- **Sin fades** salvo en eyebrows. Sin glow, sin bordes de cuadro, sin etiquetas en esquinas, sin degradados de fondo.
- **El frame 0 ya muestra tarjeta, eyebrow y línea 1;** el último frame empalma con el frame 0.

## Qué revisa el crítico
1. Frame 0: tarjeta asentada, eyebrow visible y línea 1 legible. El hook se entiende en ≤ 2 s.
2. Ningún frame tiene texto encima de una foto o clip, ni emojis.
3. Una sola familia; titulares a la izquierda en el margen del formato y en sentence case.
4. El acento solo está en la palabra clave o la segunda frase, en el último punto o arco y en el cierre; a ojo, ≤ 8 % del cuadro.
5. Cada palabra aterriza en el beat de su palabra hablada. Nunca hay dos titulares legibles a la vez y la salida está ≥ 95 % fuera antes de la siguiente entrada.
6. En el primer frame de cada entrada no asoman glifos por la máscara.
7. Hay algo nuevo cada 1–2 beats y ningún estado quieto supera 4 beats; todo hold tiene empuje.
8. El `slideIn` dispara en cada marca de sección con su SFX, y el indicador de puntos llega al punto correcto en la misma marca.
9. Las etiquetas siguen la punta del trazo durante el zoom y no salen de la tarjeta ni de las zonas seguras.
10. Rieles, calendarios y anillos se llenan con la voz; el elemento final pasa a acento con pop y golpe sonoro en su beat.
11. Cada servicio o paso coincide con su clip; ninguna persona real aparece como ejemplo del problema.
12. El footage conserva su color original.
13. Cierre: corte duro al campo oscuro en el compás; la marca se revela de izquierda a derecha; la píldora crece en su hit; las líneas suben cada 0.5 b; nunca queda estático; ≤ 2 s útiles; el puente empalma con el frame 0.
14. 9:16: nada legible en el 14 % superior, el 20 % inferior ni el 12 % derecho. Los demás formatos están re-bloqueados, no escalados.
15. Lectura a 360 px de ancho: eyebrows, etiquetas y valores se leen.
16. Audio: SFX sobre el grid y declarados; −14 LUFS y TP ≤ −1; voz por frases sin acelerar; música `distinct`.
17. `node scripts/render.mjs --verify --all` pasa y `node scripts/lint.mjs --all` está limpio.

## Cómo usar la demo
1. Copia `demo/index.html` y `demo/film.js` a `film/` (sobrescriben los del proyecto) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/tarjeta.js` a `film/tarjeta.js` (el `<script src="tarjeta.js">` ya va antes de `film.js` en `demo/index.html`; si usas tu propio `index.html`, agrégalo ahí) y los `.ttf` de `fonts/` a `assets/fonts/`.
3. Ejecuta `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (usa `--sheet` para la hoja de contactos).

## Si buscas otra cosa
- Para una clase o lección por secciones con cierre «Siguiente clase», usa **Clase hojas**.
- Para comparar un antes y un después o probar un dato en una interfaz, usa **Paneles UI**; para mostrar una app o plataforma por dentro, **Producto por dentro**.
- Para un mensaje calmado de sala de espera con un personaje dibujado, usa **Ilustrado sereno**.

## Cómo adaptarlo a tu marca
- **Paleta:** cambia los tokens de `:root` en `film/index.html`. Mantén los roles: un fondo claro, una superficie un poco más oscura, una tinta casi negra y UN acento en dos tonos (texto con buen contraste sobre el fondo y relleno para formas y campo oscuro). Ajusta `--line`, `--rail` y los grises del diagrama a la misma temperatura que tu fondo.
- **Tipografía:** si tu marca usa otra familia, reemplaza los `@font-face` de `Display` y `UI` (una sola familia, display ligero) y actualiza `C.fonts` en `film.js`. Revisa que los titulares sigan cabiendo; si no, baja la altura de la tarjeta antes que la letra.
- **Logo:** en el cierre usa `logoSrc: '../assets/brand/tu-logo.png'` en lugar de `logoText`. Mejor una versión en el color de acento o en claro, con fondo transparente.
- **Material:** sustituye cada `TARJ.placeholder(...)` por `TARJ.photo(...)` o `C.drawSeq(...)` con tus clips. Un clip por sección, del servicio exacto que nombra el titular.
- **Diagrama:** `TARJ.fibers` es un punto de partida neutro; dibuja tu propio diagrama (un proceso, una capa, un ciclo) con la misma regla: datos sembrados fuera de `run`, estado como función de t y acento solo en lo que cambia.
- **Textos:** reescribe titulares, eyebrows, pasos y etiquetas del riel con tu caso (tu servicio, tu producto, tu curso). Mantén frases cortas y el acento en la respuesta.
- **Contacto:** cambia `@tumarca` y la línea de mensaje por tu usuario o canal real en `endCard`.
