# Punto cinético

## Esencia
- Se siente rápido, preciso y limpio. La energía no sale del montaje (unos 6–7 cortes en 14–20 s), sino de un cuadro que nunca deja de transformarse.
- Sirve para lanzar algo digital: una app, una versión nueva, una función, una lista de espera o una cuenta regresiva al día del lanzamiento. Lo típico son 14–20 s (28–40 beats a 120 BPM), y se puede alargar hasta 30 s.
- **Elige este cuando** tu mensaje cabe en frases cortas que cierran con punto, quieres que la tipografía sea la protagonista (una sola familia, sin fotos ni personas) y hay un momento de lanzamiento que contar: «llega», «ya está», «faltan N días». Si lo que necesitas es recorrer la plataforma por dentro con calma, probar un dato o explicar un servicio, mira «Si buscas otra cosa».
- Lo hace reconocible **un punto final en color de acento** que hace *pop* al cerrar cada afirmación. Dos veces, ese punto crece desde su glifo hasta llenar el cuadro (iris) y se vuelve la transición.
- Otros rasgos propios:
  - Display enorme en Inter 800, alineado a la izquierda, palabra por palabra sobre el beat.
  - Una interfaz que se ensambla pieza por pieza y un cursor que actúa sobre ella.
  - Campos de color planos (claro, gris claro, noche, acento) que cambian en las líneas de compás. El cambio de campo ES el corte.
- La carpeta trae `helpers/punto.js` (todos los movimientos), `demo/` (un reel de 14 s listo para renderizar, con `film.js`, `index.html` con los tokens y `timeline.json`) y `fonts/` (Inter variable, licencia OFL).

## Estructura y ritmo
- **Tempo:** 120 BPM, 4/4. Un compás = 4 beats = 2 s, a 60 fps. Todo el timing se escribe en beats (marcas de `timeline.json`), nunca en segundos fijos.
- **Plantilla de 28 beats (14 s, la de la demo):**

| Acto | Beats | Contenido | Campo |
|---|---|---|---|
| 1 · Gancho | 0–8 | Dos afirmaciones en tipografía cinética. La palabra 1 ya se lee en el frame 0. La segunda frase lleva el acento. Cierra con el iris del punto. | Claro `--bg` |
| 2 · Producto | 8–16 | Slam del logotipo sobre el acento, type-on letra a letra, la hoja clara cubre desde abajo, el logo vuela al nav, la página se arma y el cursor presiona el CTA. | Acento → claro |
| 3 · Función | 16–20 | Un titular corto + una pieza de UI que actúa (pila de avisos, cascada, clic). Sale con un push past camera. | Noche |
| 4 · Número | 20–24 | Contador tragamonedas que aterriza en un beat, etiqueta que sube y una lista que prueba el número. Cierra con un iris claro. | Acento |
| 5 · Cierre | 24–28 | Logotipo que sube por máscara, el punto entra al final, línea con CTA, píldora que crece y pulso del punto. | Claro |

- **Plantilla de 40 beats (20 s):** gancho 0–8, producto 8–16, tres funciones de un compás (16–20 / 20–24 / 24–28, en gris claro, noche y claro), número 28–36 y cierre 36–40.
- **Para 30 s:** agrega una cuarta función (4 beats) y alarga el producto a 12 beats. No alargues los holds.
- **Cortes:** solo en líneas de compás. Dos de ellos son iris del punto (gancho → producto y número → cierre) y uno es un push past camera (última función → número).
- **Eventos internos:** en beats o medios beats. La densidad ronda 2 SFX por segundo.
- **Frecuencia de novedad:** algo nuevo cada ≤ 1 beat en el gancho y cada ≤ 2 beats en el resto. Ningún elemento se sostiene más de un compás sin que llegue otro.
- **Cámara en los holds:** micro push constante de 1.00 a 1.04–1.07 en cada escena (`PUNTO.microPush(t, S.cam, inicio, fin, 0.04)`).
- **Cierre:** dura 4 beats (2 s) y siempre se mueve.

## Vocabulario de movimiento
Copia `helpers/punto.js` a `film/punto.js` y cárgalo en `film/index.html` después de `type.js` y antes de `film.js` (la demo ya lo hace). Todo vive en `window.PUNTO`. Toma `demo/film.js` como punto de partida.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| Pila de palabras por beat | Display gigante, 1–3 palabras por línea, cada palabra sube por su máscara en su beat. La frase 1 se lee en el frame 0. | `PUNTO.words(parent, lines, {x:PAD, y, size, accent:[índices], accentColor, dotColor})` + `PUNTO.rise(t, L, [beats])`. `rise` adelanta `EARLY = 0.13` beat sobre `TYPE.rise` para que cada glifo esté ~90 % fuera en el cue. Usa un beat negativo (`-0.4`, `-1`) para la palabra que ya está en el frame 0. Resorte `heavy`. Palabras cada 0.5–0.75 beat. |
| Acento en el remate | La segunda frase o la palabra clave en el color de acento | La opción `accent:[gi]` de `words()` (índice global de palabra). Sobre noche o acento usa `accentColor:'var(--accent-2)'` y `dotColor:'var(--accent-2)'`. |
| Pop del punto | El punto final rebota (overshoot del 32 %) medio beat a un beat después de la última palabra | `PUNTO.dotPop(t, L.dots[0], beat)`. Un `.` al final de una palabra en `words()` se vuelve su propio `span.dot`. Lleva SFX pop. |
| Iris del punto | El punto crece desde su glifo hasta cubrir el cuadro con color sólido. La cobertura total cae exactamente en la línea de compás. | En `build`: `S.iris = PUNTO.irisEl(root, 'var(--accent)')`. En `after()`: `PUNTO.iris(t, S.iris, dot, b0, b1)` con b0 = compás − 0.8. Si la escena siguiente entra con `pre:0.22, cut:true`, b1 = compás − 0.22. Lleva whoosh. |
| Swap por empuje | La frase A sale hacia arriba del cuadro mientras la B empuja desde abajo. La primera palabra de B llega con el empuje en el compás. | `PUNTO.pushSwap(t, aBox, bBox, compás)`: el resorte arranca 0.38 beat antes. Secuencial: A se va por completo. |
| Slam de logotipo + type-on | El logotipo en negativo cae pesado sobre el acento (escala 1.14 → 1, sube 120 px). Luego se teclea un texto corto tras el punto, una letra cada 0.25 beat. | `PUNTO.logo(parent, {size, color:'#fff', dotColor:'var(--accent-2)'})`, `spHit(t, 'prod', 'heavy')` para el slam y `PUNTO.typeOn(t, span, 'com', b0, b1)`. Thump + ticks. |
| La hoja cubre el campo | La hoja clara sube desde abajo. El logotipo pasa de negativo a color exactamente en el borde. | `edge = PUNTO.pageCover(t, page, beat)` y clips complementarios en las dos versiones del logo (`inset(0 0 X% 0)` / `inset(X% 0 0 0)`). Resorte `default`, unos 0.6 beat. |
| Logotipo vuela al nav | El logotipo encoge y viaja a su sitio en el nav | `sp(t, beat, 'heavy')` e interpolas x, y y escala con `lerp`. Al aterrizar, un logo fijo dentro del nav toma el relevo para moverse con la cámara de la página. Whoosh. |
| UI que se arma sola | Las piezas entran cada 0.25 beat: el nav se despliega, el badge y el CTA crecen, el titular sube por su máscara y la nota hace fade | `PUNTO.enter(t, pieza, beat, 'grow' / 'rise' / 'fade')`. `grow` = `0.7 + 0.3·popS`. `rise` mueve `pieza._inner` dentro de su caja. Solo la línea pequeña puede hacer fade. Un pop por pieza. |
| Tarjeta en perspectiva falsa | La tarjeta sube 380–500 px, rotada 4–5°, con `skewY(-5°)` y `scale(0.9)`, hasta asentarse plana | `PUNTO.tilt(t, el, x, y, beat, {dy, rot, skew})`. Solo transformaciones 2D: nunca `perspective`, `rotateX` ni `translate3d`. |
| Push hacia el CTA | La cámara de la página entra (escala +0.25–0.5) hacia el CTA | `sp(t, b, 'heavy')` sobre la cámara de la página, con `transformOrigin:'0 0'` (fórmula en la demo). En 9:16 no hay push: el cursor lleva la acción. |
| El cursor actúa | Flecha oscura con borde blanco a 1.35x. Entra desde fuera del cuadro, se desliza y se presiona (escala −14 %) en un beat. La UI responde en ese mismo frame (escala 0.95, brillo −6 %). | `PUNTO.cursorEl(root)` + `press = PUNTO.cursor(t, c, [[beat,x,y],…], pressBeat, inBeat)`. SFX click en `pressBeat`. |
| Pila de avisos | Sobre noche, las tarjetas caen desde arriba cada beat y empujan hacia abajo a la anterior | `PUNTO.stackDrop(t, cards, beats, {x, top, gap})`. Cada tarjeta lleva `_w` y `_h`. Pops. |
| Push past camera | Salida en el último medio beat: zoom a 3.2x con blur de 18 px | `o = PUNTO.pushPast(t, b0, compás)` y luego `put(S.cam, {s: base * o.mul, filter: o.filter})`. Whoosh en el corte. |
| Contador tragamonedas | Dígitos blancos de ~45–52 % del alto giran en columnas enmascaradas, desaceleran y se detienen en el beat con un bump del 7 % | `PUNTO.counterEl(parent, {x, y, size})` + `PUNTO.counter(t, ctr, N, b0, bLand, bLand, desde)`. Valores de 0 a 29. Con `desde` > N es una cuenta regresiva (la demo va de 29 a 10). La última astilla salta, así que no quedan restos del dígito anterior. Ticks por dígito y thump al aterrizar. |
| Lista que prueba el número | Una tarjeta cuyo clip baja una fila cada medio beat | `clip: PUNTO.listClip(t, alto, bordesDeFila, beat, 0.5)`. Pop en la primera. |
| Punch de cámara | Antes del iris final, la cámara gana +16 % hacia el número | `sp(t, irisBeat − 0.4, 'default')` multiplicado sobre el micro push. |
| Cierre vivo | El logotipo sube por máscara (heavy), su punto hace pop 0.125 beat después, la línea sube, la píldora crece y el punto pulsa (+35 %) en el último compás | `PUNTO.logo` dentro de una máscara, `logo._dot` con `dotPop`/`popS`, `PUNTO.pulse(t, beat)` y `popHit` para la píldora. |

Presets de resorte:
- `heavy`: display, logotipos y cámara.
- `default`: tarjetas, hoja y cámara de escena.
- `snappy`: píldoras, el punto, el cursor, avisos y filas.
- Nunca uses `playful`.

Todo lo que suena se anima con `spHit`, `PUNTO.popHit` o `PUNTO.dotPop`, para que se lea EN el beat. `PUNTO.vis(p)` hace aparecer un elemento de golpe al iniciar su resorte (nunca fade-in). `PUNTO.popS(p)` da el overshoot, y solo va en pops, el punto y las píldoras.

## Tipografía
- **Una sola familia:** Inter variable (`fonts/Inter-Variable.woff2` y `fonts/Inter-Variable-LatinExt.woff2`). Copia `fonts/` a `assets/fonts/` y declara `C.fonts = ['800 100px Inter','700 100px Inter','600 100px Inter','500 40px Inter']`.
- **Display:** Inter 800, tracking −0.045em, sentence case, alineado a la izquierda. Interlineado de 1.0–1.05 entre líneas apiladas (`words()` usa 1.04 por defecto, que pasa el lint de solapes).
  - Tamaños a 1080p, como `pick(16x9, 1x1, 9x16)`:

| Uso | 16:9 | 1:1 | 9:16 |
|---|---|---|---|
| Gancho | 240–262 | 160–168 | 150–172 |
| Segunda afirmación | 210–232 | 150 | 150–164 |
| Función corta | 170–190 | 130–170 | 176 |
| Función larga (3 líneas) | 118 | 104 | 112 |
| Número | 500–560 | 400–420 | 470 |
| Etiqueta del número | 118 | 84 | 104–110 |

  - Regla práctica: cada línea del gancho ocupa un 8–12 % del alto del cuadro en 9:16 y un 22–25 % en 16:9.
- **UI y texto secundario:**
  - Inter 600 para el texto tecleado y la línea del cierre (84/56/66 px, tracking −0.02em, color `--ink-2`).
  - Inter 700 en píldoras y Inter 500 en notas.
- **Puntuación:** cada afirmación termina en punto, y el punto siempre va en acento (`--accent-2` sobre noche o acento). El punto es su propio `span.dot` dentro de la palabra. Si una frase es pregunta, deja que la siguiente afirmación cierre con el punto.
- **Acento:** solo en la segunda frase o en la palabra clave (p. ej. «Todo en *un toque.*»). Nunca pongas dos acentos en una frase.
- **Legibilidad:**
  - Mínimo 36 px en display y 28 px en UI (marca la UI de reemplazo con `data-lint="ui"`).
  - Tiene que pasar la prueba de teléfono de 360 px.
  - Si falta espacio, escala la cámara, no la fuente.
- **Margen izquierdo:** `PAD` ≥ 120 px en 16:9 y 80 px en 9:16. En 9:16, parte las líneas (una palabra por línea) para que nada invada el 12 % derecho.
- **Máscaras:** `.line` lleva 0.24em de padding arriba para tildes y ¿ ¡. Las palabras empiezan ≥ 145 % de su tamaño bajo la máscara (`TYPE.rise` ya lo hace).

## Color
- **Tokens** (`demo/index.html`, `:root`):

| Token | Hex | Rol |
|---|---|---|
| `--bg` | #FCFBF8 | campo claro (gancho, página, cierre) e iris claro |
| `--bg-2` | #EFEDE8 | campo gris claro de una función, filas y rellenos de UI |
| `--ink` | #17151A | texto display y UI, cursor |
| `--ink-2` | #57525C | texto secundario, línea del cierre, notas |
| `--accent` | #D61F69 | el acento: punto, palabra clave, CTA, campo de slam y de número, iris 1 |
| `--accent-2` | #FF9CC2 | el acento sobre noche o sobre el campo de acento (punto, palabra clave) |
| `--accent-soft` | #FBE3EC | relleno suave de badges (derivado del acento) |
| `--night` | #1A1220 | campo noche de una función |

- **Un solo acento** como rampa tonal: `--accent` sobre claro, `--accent-2` sobre noche y sobre el acento, y `--accent-soft` para rellenos. No uses colores de estado (verde de éxito, rojo de error) como segundo acento.
- **Campos por escena** (el cambio de campo ES el corte, siempre en compás):
  - El gancho va en claro y el slam en acento.
  - La página va en claro.
  - Las funciones alternan gris claro, noche y claro.
  - El número va en acento (dígitos blancos, punto `--accent-2`) y el cierre en claro.
- **Iris:** el primero es del color de acento y el segundo claro, siempre del color del campo que viene.
- **Textura:** campos planos, sin degradados, sin grano y sin glow.
  - Las tarjetas de UI llevan sombra de contacto profunda `0 40px 90px -30px rgba(ink, .38)` y radio de 20–30 px (clase `.shot`).

## Subtítulos
`style.json` declara `captionPreset: "pill-sobrio"`, pero la demo no quema subtítulos (`voiceover: null`). La tipografía cinética ya es el texto en pantalla y coincide palabra por palabra con la VO si la hay: un subtítulo competiría con el display. Si hay VO y la plataforma o el cliente exigen subtítulos, usa `pill-sobrio` solo en los tramos de UI y sácalos de los tramos de display con `skip`.

## Transiciones
| Transición | Timing | Uso |
|---|---|---|
| Iris del punto | Crece en ~0.8 beat con `expoIn`. La cobertura total cae exacta en el compás, o en compás − 0.22 si la escena entrante usa `pre:0.22, cut:true`. | Gancho → producto y número → cierre. Máximo 2 por reel. |
| Corte duro + cambio de campo | En el frame del compás | Entre funciones. |
| Empuje vertical de frase | `sp default` iniciado 0.38 beat antes del compás | Dentro del gancho. |
| Cubierta de hoja | 0.6 beat, `default`, desde abajo | Campo de acento → página clara. |
| Push past camera | Último 0.6 beat de la escena, `expoIn`, zoom +220 % y blur de 18 px | Función → número. |
| Lift por máscara | `rise` con `outAt` = entrada siguiente menos salida | Tipografía que se va dentro de una escena. |

Nunca uses crossfade, wipe genérico, spin ni glitch.

## Sonido y música
- **Música:** synth pop o electrónica limpia a 120 BPM en tonalidad menor (p. ej. i–VI–III–VII). Una pista original por proyecto que `compare_music.py` marque como `distinct`.
- **Mapa de energía (plantilla de 28 beats):**

| Tramo | Energía |
|---|---|
| b0–6 | Intro bajo el gancho |
| b6 | Build con riser hasta b8 |
| b8 | DROP en el slam del logotipo |
| b16 | Groove completo en la función |
| b20 | Oscuro y filtrado bajo el número |
| b23.5 | Hueco de silencio |
| b24 | DROP + crash en el logotipo del cierre |

- **SFX** (≈ 2 por segundo, todos declarados en `timeline.json` `sfx` y sobre la grilla):
  - pop por palabra, por punto, por pieza de UI y por aviso
  - click en cada presión del cursor
  - whoosh en el iris, el vuelo del logo, la hoja y el push past camera
  - thump en el slam y en el aterrizaje del número
  - ticks en el type-on y en cada dígito del contador
  - crash en el drop final
- **Mezcla:** −14 LUFS integrados, true peak ≤ −1 dBTP. Los pops quedan por debajo de la música y los thumps al frente.

## Voz en off
- Es opcional: el estilo funciona sin VO. Si la usas, sigue estas reglas.
- **Tono:** voz ágil y segura, con acento neutro o regional según el público. Prueba 3 voces con la frase más larga.
- **Texto:** la VO dice exactamente lo que está en pantalla («Algo nuevo llega. Todo en un toque.», «Diez días.», «Únete a la lista hoy.»).
- **Colocación:**
  - Una toma por frase, cortada en los silencios.
  - Cada frase arranca en un beat y cada palabra clave coincide con el `rise` de su palabra.
  - Nunca aceleres una toma completa.
- **Mezcla:** duck de la música bajo la VO.

## Formatos
- Usa `pick(16x9, 1x1, 9x16)` para tamaños y posiciones. No escales un formato a otro: re-bloquea cada uno.
- **9:16 (primero):**
  - Una palabra por línea, con la tipografía en la banda central-alta (y 280–900).
  - La UI va debajo (y 700–1500) con piezas grandes (≥ 85 % del ancho), sin push de cámara en el producto.
  - Zonas seguras: nada clave en el 14 % superior (< 269 px), el 20 % inferior (> 1536 px) ni el 12 % derecho (> 950 px). El nav puede vivir arriba porque es UI.
- **16:9:** tipografía a la izquierda y UI a la derecha (x ≈ 1060–1760). Push suave hacia el CTA.
- **1:1 / 4:5:** como 16:9 pero apilado: tipografía arriba y tarjetas abajo (y ≈ 450–1000).
- Revisa todos los formatos entregados en la última ronda.

## Reglas recurrentes y prohibiciones
- El frame 0 ya muestra la palabra 1, y el gancho completo se lee en 2 s.
- Cada afirmación termina con un punto de acento que hace pop. El iris del punto se usa exactamente dos veces.
- La UI que muestres debe ser la real de tu producto: recortes nítidos a 2–3x o piezas reconstruidas elemento por elemento, anotadas en un comentario. No uses datos de personas reales (nombres, fotos de perfil) sin permiso.
- Un número en pantalla debe ser verdadero y verificable. Si el dato no se sostiene, cambia el acto 4 por otra función.
- Los swaps son secuenciales: nunca dos frases leyéndose a la vez.
- Los elementos aparecen de golpe con `vis(p)`. El fade solo se permite en líneas pequeñas.
- La perspectiva siempre es 2D (skew + rotate + scale + sombra).
- Pureza del render:
  - nada mutado en `run()`
  - ni `Math.random` ni timers
  - sin `will-change` ni `translate3d`
  - `render.mjs --verify` una vez por proyecto
- Prohibido:
  - títulos centrados sobre degradado
  - crossfades
  - glow
  - partículas
  - bordes de cuadro
  - etiquetas en esquinas
  - rebote en tarjetas o UI grande
  - `playful`
- El cierre dura 2 s y siempre se mueve: micro push, punto que entra al final y pulso.

## Qué revisa el crítico
1. Frame 0: la palabra 1 se lee completa, sin glifos asomando por la máscara.
2. Todos los cortes caen en líneas de compás.
3. Cada palabra está ≥ 90 % fuera de su máscara en su beat. Cada pop, clic y aterrizaje se ve en el frame del beat.
4. No pasan 2 beats sin un elemento nuevo, y ninguna escena se queda quieta: la escala de cámara cambia entre su inicio y su fin.
5. El punto de cada afirmación es de acento y hace pop. Hay exactamente 2 iris, con cobertura total en su frame, y ninguna escena entra sobre un iris incompleto.
6. Hay un solo acento por frase, en la segunda frase o la palabra clave.
7. En los swaps hay como máximo 1 frame de solapamiento, con la frase saliente ≥ 95 % fuera.
8. La UI es nítida, las sombras son las de `.shot` y no hay datos personales.
9. El cursor se presiona en el beat del click y la UI responde en ese mismo frame.
10. El contador se detiene exacto en su beat, sin fragmentos del dígito anterior, y la lista revela una fila por medio beat.
11. El texto mide ≥ 36 px (≥ 28 px en UI) y pasa la prueba de 360 px. En 9:16 no hay nada clave en las zonas de la plataforma.
12. No hay fades de entrada ni de salida en display ni en tarjetas, ni crossfades, glow o degradados.
13. El cierre dura ≤ 2 s, el punto pulsa y la píldora CTA está presente.
14. Audio: −14 LUFS y TP ≤ −1 dBTP, drops en el slam y en el cierre, silencio justo antes del cierre, cada SFX declarado y la música `distinct`.
15. `node scripts/lint.mjs --all` limpio y `node scripts/render.mjs --verify --all` sin diferencias. Las hojas de contacto puntúan ≥ 8.

## Vocabulario cinético de la casa
Reglas generales de tipografía cinética que valen para cualquier reel de este tipo (no solo para el punto):
- **El cuadro nunca para:** pocos cortes duros (≈ 0,3 por segundo) y mucho movimiento dentro del plano; todo hold lleva micro push de 1.00 a 1.03–1.08.
- **Palabras por máscara:** display pesado, alineado a la izquierda, una palabra por beat que sube por su máscara desde ≥ 140 % de su tamaño; la palabra 1 se suelta en un beat negativo para que el frame 0 ya lea.
- **Un acento por frase:** solo en la palabra clave o en la segunda frase.
- **Cambios secuenciales:** la línea saliente se va antes de que aterrice la entrante (`outAt` = entrada siguiente − salida); nunca dos frases a la vez.
- **El motivo de marca es la transición:** un signo (el punto, una forma del logo) crece hasta llenar el cuadro y la escena siguiente entra cuando cubre.
- **La UI se arma sola y responde:** piezas que entran una por beat o medio beat, cursor que presiona en el beat del click y UI que reacciona en ese mismo frame.
- **Campos de color como cortes:** el fondo cambia entre claro, acento y noche exactamente en líneas de compás; el acento como campo completo dura como máximo un compás.
- **Resortes, no fades:** `heavy` para tipografía, logos y cámara; `default` para tarjetas y paneles; `snappy` para botones, píldoras y pops; nunca `playful`. Todo lo que suena usa `spHit` para leerse EN el beat.
- **Escala la cámara, no la fuente:** todo lo legible ≥ 28 px a 1080p y pasa la prueba del teléfono a 360 px.

## Cómo usar la demo
La demo (14 s, 120 BPM, 9:16 y 16:9) lanza una app de ejemplo: «Algo nuevo llega. / Todo en un toque.», slam de «tu marca.app» y landing que se arma con «Únete a la lista», avisos apilados sobre noche, cuenta regresiva de 29 a 10 «días.» con la lista de hitos y cierre «Quiero acceso». En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/punto.js` a `film/punto.js` (el `<script src="punto.js">` ya va antes de `film.js` en `demo/index.html`) y `fonts/*.woff2` a `assets/fonts/`.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después reemplaza los marcadores («tu marca.», «TU CLIP AQUÍ», la UI dibujada) por tu material y ajusta las marcas de `timeline.json` a tu voz y tu música.

## Si buscas otra cosa
- ¿Mostrar tu app o plataforma por dentro, pantalla a pantalla, con un reproductor que crece? Usa **Producto por dentro**.
- ¿Probar un resultado, comparar un antes y un después o destacar un dato? Usa **Paneles UI**.
- ¿Explicar un servicio o un cuidado con calma? Usa **Tarjeta escenario**.

## Cómo adaptarlo a tu marca
- **Paleta:** reemplaza los tokens de `:root` en `index.html`. Pon tu color principal en `--accent`, una versión clara de ese mismo color en `--accent-2` (debe leerse sobre `--night` y sobre `--accent`) y un tinte muy suave en `--accent-soft`. Conserva los roles: un solo acento.
- **Tipografía:** si tu marca tiene su propia sans, cambia `@font-face` y `C.fonts`. Mantén un peso 800 para el display y ajusta el tracking hasta que las palabras queden compactas (−0.03 a −0.05em).
- **Logotipo:** `PUNTO.logo()` es un texto de reemplazo («tu marca.»). Cámbialo por el SVG de tu marca y conserva un elemento `.wm-dot` (el punto o la forma que haga de punto) para el pop, el pulso y el iris. Si tu logo no tiene punto, usa una forma simple de la marca.
- **Material:** sustituye las tarjetas «TU CLIP AQUÍ», el nav y las piezas dibujadas por recortes reales de tu sitio o app, o por tu metraje (dibújalo con `C.drawSeq`). Cambia el texto de ejemplo («Algo nuevo llega», «Únete a la lista», «Quiero acceso») por tus afirmaciones, cada una con su punto.
- **Número:** usa una fecha o un dato real tuyo (días para el lanzamiento, minutos, pasos, ciudades). Si no tienes uno verificable, convierte el acto 4 en otra función.
