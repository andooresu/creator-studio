# Método armado

## Esencia
- La sensación es de **orden que nace del caos**: lo suelto se vuelve método. Las piezas desordenadas se transforman en una lista, la interfaz se ensambla sola sobre un fondo claro con un halo tenue y una retícula de puntos que late con la música.
- Su caso natural es **un método, programa o plan**: «de ideas sueltas a un plan», un curso por semanas, un programa por fases, una membresía con ruta clara. Piezas de 12–30 s (9:16 y 4:5 primero), con voz en off cálida o sin voz, y música con pulso constante (house suave o nu-disco a ~120 BPM).
- Se reconoce por cuatro cosas: títulos enormes en un color profundo que suben palabra por palabra a través de una máscara; paneles claros con un canto de acento que barren sobre la escena anterior; tarjetas que caen una por beat con sombra teñida; y una píldora final que late.
- La energía no viene del montaje (casi no hay cortes duros), sino de la transformación continua dentro del cuadro.
- Demo incluida: `demo/` (13 s, 26 beats, 9:16 y 4:5), caso «De ideas sueltas a un plan» con cierre «Inscríbete hoy», marcadores «TU CLIP AQUÍ» y «TU LOGO». `demo/preview.jpg` muestra cómo se ve.

## Cómo usar la demo
1. Copia `demo/index.html` → `film/index.html`, `demo/film.js` → `film/film.js` y `demo/timeline.json` → `timeline.json` (raíz del proyecto).
2. Copia `helpers/armado.js` → `film/armado.js` (el `index.html` de la demo ya lo carga con `<script src="armado.js">` después de `type.js` y antes de `film.js`) y `fonts/*.ttf` → `assets/fonts/`.
3. Desde la raíz del proyecto: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`).

## Cómo usar los archivos
- Al asignar el estilo a un proyecto, sus archivos quedan en `docs/style/`.
- `helpers/armado.js` (`window.ARM`): cópialo a `film/armado.js` y cárgalo en `film/index.html` después de `type.js` y antes de `film.js`.
- `fonts/*.ttf`: cópialos a `assets/fonts/` (licencia en `fonts/OFL.md`).
- Para partir de la demo, sigue «Cómo usar la demo».
- Los colores viven en los tokens `:root` de `film/index.html` (`--bg`, `--ink`, `--ink-2`, `--accent`, `--title`, `--tint`, `--tint-2`, `--shadow`). Los helpers los leen de ahí, así que cambiar la paleta es editar 8 líneas.

## Estructura y ritmo
- **BPM de referencia:** 120 (1 beat = 0,5 s; 1 compás = 4 beats = 2 s). Usa el grid medido de `beats.json`, nunca segundos fijos. Todo se escribe en beats con marcas con nombre en `timeline.json` (en la demo: `hook_w2`, `dchip`, `orden`, `paso_t`, `ring`, `pasos`, `p1…p3`, `giro`, `pills`, `end`, `cta`, `recap`). Cuenta con unas 15–25 marcas por pieza.
- **Duración típica:** 12–24 s (24–48 beats). La versión larga llega a 30 s (60 beats).
- **Plantilla de actos (pieza de ~44 beats; la demo comprime lo mismo en 26):**

| Acto | Beats | Qué pasa |
|---|---|---|
| 1 Hook | 0 → 5 (hasta 0 → 8 si el hook encadena problema → orden) | Título en pila. En el cuadro 0 ya se lee la fila 1 (entra en b −0,4). Debajo, un motivo de apoyo: fichas sueltas, pills numeradas, una ventana. |
| 2 Demostración | 5 → 26 | La interfaz o el contenido se arma. Bloques de 2–3 beats por ítem (carrusel «Paso N», `STEP = 2,25–3`) o de 4–8 beats por idea. |
| 3 Giro / decisión | 3–4 beats | Chip de giro + frase corta con acento + pills de secuencia o contador. |
| 4 Mecánica / oferta (opcional) | ~8–10 beats | Cómo se activa, qué incluye, tarjetas de planes, número que corre. |
| 5 Cierre vivo | 7–10 beats | El bloque CTA se arma en ≤ 4 beats. El hold final dura ≤ 4 beats y la píldora late en cada compás. |

- **Cortes:** casi nunca hay corte duro. Cada escena entra con el panel claro (`ARM.cover`) que **termina exactamente en el beat `from`** de la escena, y `from` cae en barra o media barra.
- **Densidad:** algo nuevo cada 1–3 beats (una palabra, una tarjeta, un chip, una onda de puntos). Ningún hold pasa de 4 beats sin un elemento nuevo. Calcula ~1 SFX cada 1,5–2 beats.
- **Holds:** siempre con micro push en `pushBox`, de 1,00 a 1,02–1,05: `put(S.push, { s: 1 + 0.035 * seg(t, from, to) })`.

## Sistema de layout
- **Un solo `film.js` para todos los formatos.** `ARM.L({ s: {...}, t: {...} })` devuelve el bloque de 9:16 (`t`) o el de los demás formatos (`s`). Cada escena define su propio bloque con filas, `y`, tamaño y acentos.
- **Margen:** todo el texto a la izquierda en `ARM.X0` = 72 px (9:16), 80 px (4:5 y 1:1) y 120 px (16:9). `ARM.CW` es el ancho útil.
- **Zonas seguras 9:16 (`ARM.SAFE`):** el texto vive entre y = 290 y y = 1520. Nada clave en el 14 % superior, el 20 % inferior ni el 12 % derecho.
- **9:16 (principal):** pila de 2–4 filas con una o dos palabras por fila; título desde y ≈ 300; contenido (lista, tarjeta, pills) en la mitad inferior (y ≈ 700–1520); subtítulos en 0,755·H.
- **4:5:** una o dos filas más anchas; título desde y = 70; contenido desde y ≈ 260–420; las tarjetas se reparten en fila horizontal; subtítulos en 0,86·H.
- **16:9 (si se pide):** título a la izquierda en x = 120, contenido a la derecha (55–60 % del ancho), halo hacia la derecha.
- Re-bloquea por formato. No escales el layout de otro formato ni hagas letterbox.

## Tipografía
- **Display:** Montserrat 800 (y 700), tracking −0,035 em, sentence case, en `--title`. Declara `C.fonts` (los helpers ya lo hacen: `'800 100px Display'`, `'700 100px Display'`, `'400/700/900 40px UI'`).
- **UI:** Lato 400/700/900 para chips, píldoras, filas, sublíneas y eyebrows (MAYÚSCULAS con 0,12 em, solo para una credencial o una etiqueta de marcador).
- **Tamaños a 1080 px de ancho:**
  - 9:16: hook 118–150 px, títulos de escena 110–170 px, temas 70–90 px, sublíneas 46–60 px, chips 38–54 px.
  - 4:5: hook 80–100 px, títulos 60–100 px, sublíneas 40–50 px, chips 32–44 px.
  - Interlineado 1,12–1,17 (`title(..., { lh })`, 1,14 por defecto).
- Calcula el ancho: Montserrat 800 ocupa ~0,62–0,66 em por carácter. Si una fila no cabe en `CW`, pártela o baja el tamaño; nunca la dejes salir del margen derecho.
- **Acento:** el color de acento solo en la palabra clave o en la segunda frase («plan.», «en su lugar.», «hoy.»). Nunca en más de un bloque por título.
- **Mínimo legible:** 36 px en 9:16 (32 px en 4:5) para todo texto de lectura, y prueba del teléfono de 360 px. Solo las etiquetas de marcador y la letra de una maqueta de interfaz pueden bajar a ≥ 28 px, marcadas con `data-lint="ui"` (`clipCard` ya marca su etiqueta). En tarjetas pequeñas usa etiquetas cortas («TU CLIP», «TU FOTO», «TU PIEZA»). Para ampliar algo, escala la cámara, no la fuente.

## Color
Paleta de la plantilla (roles → token → valor):

| Rol | Token | Valor | Uso |
|---|---|---|---|
| Fondo | `--bg` | #fcfbf8 | Siempre claro. Base de todas las escenas. |
| Tinta UI | `--ink` | #1d1b19 | Texto de filas, temas secundarios. |
| Tinta secundaria | `--ink-2` | #6b655e | Sublíneas y textos de apoyo. |
| Acento único | `--accent` | #ef6a3a | Palabra clave, canto del panel, anillo, barras de progreso, último pill, chip de giro, puntos. |
| Tinta de títulos | `--title` | #5b1a33 | Títulos display, relleno de chips y de la píldora final (texto blanco). |
| Tinte suave | `--tint` | #fdf0e8 | Borde del halo, fondos de marcadores, pistas vacías. |
| Tinte fuerte | `--tint-2` | #fbdccb | Centro del halo, segmentos sin llenar, aro del anillo. |
| Sombra | `--shadow` | 91,26,51 | r,g,b de todas las sombras (el color de los títulos, a 0,3–0,6 de opacidad). |

- **Fondo claro siempre**, con halo radial (elipse 0,9·W × 0,7·H: `--tint-2` 0 % → `--tint` 38 % → `--bg` 72 %) más la retícula de puntos. **Nunca hay campos oscuros ni cabeceras de color.** La profundidad sale de los tintes, las sombras y el halo.
- **Superficies:** tarjetas blancas con sombra `0 30px 60px -20px rgba(--shadow,.55)` y radio de 18–26 px.
- **Por escena:** cambia solo la posición del halo (`ARM.bg(root, cx, cy)` / `ARM.panel(...)`): 0,9/0,1 en el hook, 0,12/0,08 en la demostración, 0,85/0,12 en el giro, 0,5/0,0 en el cierre. Ese desplazamiento hace sentir que cambió la escena sin cambiar de color.

## Vocabulario de movimiento

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| Título en pila con máscara | Filas grandes alineadas a la izquierda. Cada palabra sube por su máscara con stagger de 0,07 beats; las filas entran cada 0,35–0,45 beats. | `ARM.title(parent, rows, { y, size, accent: { fila: [índices] } })` y `ARM.rises(t, filas, beat, step, out)`. Por debajo usan `TYPE.line` y `TYPE.rise`. Preset `heavy` en la primera fila o el número grande, `snappy` en las de apoyo. |
| Hook que ya se lee en el cuadro 0 | La fila 1 entra en b −0,4; la palabra acento cae sobre la sílaba tónica de la voz. | En la demo: `HKB = [-0.4, beatOf('hook_w2') - 0.15]` y `rise(t, fila, HKB[i], out)`. |
| Caos → orden (morph) | Fichas genéricas inclinadas (±17°) que flotan con deriva senoidal y, en la marca `orden`, se transforman en las filas de una lista. | `ARM.chaosTile(parent, i, tw, th, rowW, rowH, texto)` (una por fila), `ARM.chaosPoses(n, caja, tw, th, semilla)` y por frame `ARM.chaosRun(t, tiles, poses, { enter, at: 'orden', rx, ry0, gap })`. El relevo de capas ocurre a mitad del morph. Devuelve las posiciones para colgar chips. |
| Chips de duda | Chips sólidos con preguntas («¿Cuánto dura?») sobre las fichas sueltas; desaparecen al ordenarse. | `ARM.chip(parent, texto)` y `spHit(t, beatOf('dchip') + k*0.25, 'snappy')` con escala 0,6 → 1; visibles solo mientras `m < 0,05`. |
| Anillo que recorre la lista | Un anillo de acento de 5 px salta de fila en fila. | `ARM.ring(parent, w, h)` y `ARM.ringRun(t, ring, [[beat, x, y], …])`: una parada por fila (aparece con `snappy`, viaja con `default`). Pon un tick por parada. |
| Lista que se desplaza | Las filas se desplazan dentro de una ventana recortada mientras el anillo avanza. | Contenedor con `overflow:hidden` y `put(lista, { y: -scroll * ease.inOut(seg(t, b0, b1)) })`. |
| Tarjeta que sube | Tarjeta desde 140 px abajo a escala 0,9 que asienta en el beat. | `ARM.cardIn(t, el, x, y, beat, { dy, s0, preset, tilt, out })`. Contenedor: `ARM.card(parent, { w, h })` o `ARM.clipCard(...)`. |
| Carrusel de pasos con progreso | Barra segmentada arriba que se llena por ítem; «Paso N» en display, tema en 2 filas, tarjeta que entra desde la derecha (0,9·W) y sale hacia la izquierda (1,05·W), chip del módulo en la esquina. | `ARM.progress(parent, n, x, y, w)` + `ARM.progressRun(t, segs, enter, ats)`; `ARM.slideItem(t, tarjeta, x, y, at, out)`; títulos con `rise(..., at - 0.15, at + STEP - 0.35)`; chip en `at + 0.6`. |
| Pills de secuencia | 4–7 cuadrados redondeados numerados (el último en acento) que suben 60 px con escala 0,6 → 1 cada 0,22 beats. | `ARM.pills(parent, n, size)` + `ARM.pillsRun(t, ps, x0, y, size, gap, b0, 0.22)`. Pueden ir centrados (única excepción al margen izquierdo). |
| Chip de giro | Chip de acento grande que crece de 0,7 a 1 en el beat; luego el título. | `ARM.chip(..., { bg: COL.accent })` + `spHit(t, 'giro', 'snappy')`; título con `rises(t, S.t, giro + 0.3, 0.35)`. |
| Contador que corre | Número display que corre 0 → N con tick y aterriza con thump. | `ARM.counter(t, el, 0, N, b0, b1, { prefix, suffix })` (formato es-419). |
| Cierre vivo | Lockup que cae pesado (escala 1,25 → 1, 40 px), verbo en display, píldora que crece 0,8 → 1, sublínea, abanico de 3 tarjetas con giros [−4, 2,5, −2]° y zigzag de 24 px. La píldora late +7 %. | Escena `end` de la demo: `spHit(t, 'end', 'heavy')`, `ARM.pulse(t, [beats])`, abanico con `ARM.cardIn(..., { dy: 260, tilt })`. |
| Retícula que late | Puntos de acento de 3 px que crecen hasta 9 px en ondas diagonales en cada beat marcado. | `ARM.bg(root, cx, cy)` devuelve `D`; por frame `ARM.dots(D, t, [beats])`: retícula de 54 px, semilla 7, alfa ≤ 0,3. Pasa 3–6 beats por escena, los mismos de los golpes fuertes. |
| Micro push | La cámara empuja hacia el título. | `ARM.pushBox(root, X0, SAFE.top + 80)` con escala 1 + 0,02–0,05·`seg`. |

- Todo lo que suena usa `spHit`. `sp` se reserva para salidas y flotaciones silenciosas.
- `ARM.fadeUp` y `ARM.para` solo para sublíneas pequeñas («Un paso, una idea.»). Es el único fundido permitido.
- `ARM.show(p)` es la compuerta de opacidad (p > 0,02): úsala en todo lo que entra con resorte para que nada se vea fuera de su ventana.

## Marcadores y contenido real
- `ARM.clipCard(parent, w, h, 'TU CLIP AQUÍ')` dibuja una tarjeta neutra con botón de play. Sustitúyela por tu captura (un `<img>` dentro de `ARM.card`) o por tu secuencia de video (`C.drawSeq` sobre un canvas) con las mismas medidas.
- `ARM.listRow(parent, n, texto, w, h)` dibuja una fila genérica de lista (número, texto, barra). Si tu producto tiene una interfaz real (temario, app, panel), usa recortes de esa interfaz con las mismas medidas en lugar de la fila dibujada.
- Las fichas de la fase de caos son genéricas a propósito: no imitan ninguna interfaz real.

## Subtítulos
- Preset **pill-sobrio**: discreto, no compite con los títulos.
- Quemados solo en 9:16 y 4:5. Ajustes de `timeline.json` → `captions`/`subtitles`: `formats ["9x16","4x5"]`, `y` 0,755 (9:16) y 0,86 (4:5), tamaño ~52, `maxChars` ~30.
- En `skip` van todas las frases de VO que ya aparecen como título grande. El subtítulo nunca duplica el texto display.
- Si el subtítulo choca con una tarjeta o con la píldora CTA, mueve la tarjeta, no el subtítulo.

## Transiciones

| Transición | Timing | Construcción |
|---|---|---|
| Panel claro que barre (principal) | Arranca en `from − 0,75` beats (`ARM.PRE`), `ease.inOut`, termina exacto en `from` | `ARM.panel(root, S, cx, cy, 'left')` (desde la derecha) o `'up'` (desde abajo) en `build`, y `ARM.cover(t, S)` al inicio de `run`. Canto de acento de 14 px y sombra teñida. La escena se declara con `pre: ARM.PRE, cut: false`. |
| Morph de elementos | ~1 beat, aterriza en la marca de voz | Fichas sueltas → filas ordenadas (`chaosRun`). |
| Empuje fuera de cuadro | 0,35 beats antes del siguiente ítem | La tarjeta sale a −1,05·W mientras entra la siguiente desde +0,9·W (`slideItem`). |
| Caída de bloque | 0,5 beats antes de la marca | Un bloque grande cae 0,7–0,9·H (`cardIn` con `out`) y lo cubren las tarjetas nuevas. |
| Corte de clip dentro de una tarjeta | En la marca de voz o en barra | Cambia la secuencia en `drawSeq`, sin fundido. |
| Salida de texto | `out = siguiente_in − 0,35` | `rise(t, l, in, out)`: la línea saliente se va por la máscara antes de que llegue la nueva. La última línea de una escena no sale: la cubre el panel. |

No se permiten crossfades, fundidos a blanco, iris ni wipes de color lleno.

## Sonido, música y voz
- **Música:** original por proyecto, con pulso constante a ~120 BPM (house suave, nu-disco, pop con guitarra rítmica y bajo). Llena desde el beat 0, sube en el tramo de demostración (~60 % de la pieza) y cierra limpia sobre el logo. Verifica `compare_music.py` = `distinct` contra tus reels anteriores.
- **SFX en el grid (todos declarados en `timeline.json` → `sfx`):**
  - pop suave por fila del hook, por cada tarjeta o pill y por la píldora CTA;
  - click en la palabra acentuada y en el chip de giro;
  - whoosh en cada panel (`at` = beat `from`: el whoosh culmina cuando el panel termina);
  - tick por parada del anillo, por pill y por medio beat en contadores o barras;
  - thump en número grande y en el lockup del cierre;
  - shutter opcional en una captura.
- **Mezcla:** `{"music": -9, "sfx": -6, "vo": 0, "duck": true}`; `mix.py` a −14 LUFS integrados y ≤ −1 dBTP.
- **Voz en off (opcional):** cálida, segura y cercana. Tuteo, frases cortas que venden beneficio, en positivo. Se corta en frases y cada frase cae en un beat (una frase nueva cada 6–9 beats, con aire para la música). Nunca se acelera una toma completa.
- El texto en pantalla **adelanta** a la voz 0,15–0,4 beats; la marca de cada palabra clave va sobre la sílaba tónica.
- Si hay variantes de precio o moneda, la voz no dice el precio: una sola locución sirve para todas y solo cambia la escena de oferta.
- El CTA puede ser una acción («Inscríbete hoy», «Empieza el lunes») o «Comenta PALABRA»; la palabra va en MAYÚSCULAS dentro de la píldora.

## Reglas recurrentes y prohibiciones
- Fondo claro siempre. Prohibidos los fondos oscuros y las cabeceras de color.
- Un solo acento. El color de títulos solo como tinta y como relleno de chips y píldora.
- Usa tu interfaz real y tu logo real cuando existan; no redibujes una interfaz que existe. Si solo tienes una captura, reconstrúyela elemento por elemento y coméntalo en el código.
- Demuestra cada servicio con su propio clip, en color original. Nada de stock que finja ser tu servicio.
- Sin datos que caducan (cupos con número, contadores en vivo). Solo pruebas estables.
- Copy en positivo, sin objeciones ni letra pequeña defensiva. Nombres y cifras exactamente como el brief.
- Prohibidos: fundidos como entrada o salida (salvo sublíneas con `fadeUp`), rebotes en UI, giros, glitches, partículas, light leaks, glow, marcos y etiquetas en esquinas.
- Sin `will-change` ni `translate3d`: todo con `put()` en 2D. Aleatoriedad solo con `mulberry32(seed)`. Nada de estado entre frames.
- Cada escena anima todos sus textos en cada frame registrado; las palabras con máscara empiezan ≥ 140 % de su tamaño por debajo (`TYPE.rise` ya lo hace).

## Qué revisa el crítico
1. Cuadro 0: ya se lee la primera fila del hook, con halo y puntos visibles. El hook completo se lee antes de 2 s.
2. Cada transición es un panel claro con canto de acento que termina exactamente en el beat `from`. Sin fundidos ni cortes a mitad de barrido.
3. Ningún fondo oscuro en ningún frame. El halo cambia de posición entre escenas.
4. Títulos a la izquierda en `X0`, en sentence case y en el color de títulos, con acento solo en la palabra clave o la segunda frase. Ninguna fila se sale del margen derecho.
5. Swaps secuenciales: la línea saliente se ha ido ≥ 95 % antes de que aterrice la entrante.
6. Algo nuevo cada 1–3 beats; ningún hold supera 4 beats sin un elemento nuevo, y todos tienen micro push.
7. Cada golpe visual (palabra, tarjeta, pill, anillo, número, logo) cae en beat o medio beat con `spHit` y tiene su SFX declarado.
8. En el morph caos → orden nunca hay una ficha vacía, y las fichas genéricas no imitan una interfaz real.
9. Los marcadores «TU CLIP AQUÍ» se reemplazaron por clips o capturas que muestran exactamente lo que nombra el texto.
10. Subtítulos sin duplicar títulos, sin tapar tarjetas ni CTA, en 0,755 (9:16) / 0,86 (4:5).
11. Zonas seguras de 9:16 respetadas.
12. Cierre vivo: el lockup cae pesado, la píldora crece y late, el hold final dura ≤ 2 s.
13. Todo lo que se lee mide ≥ 36 px en 9:16 (≥ 28 px solo dentro de `data-lint="ui"`), pasa la prueba de 360 px y `lint.mjs` sale sin problemas bloqueantes. En el carrusel, las etiquetas de la tarjeta se apagan al cruzar el borde (`data-edge-fade`).
14. Voz por frases en beats, texto que adelanta 0,15–0,4 beats, ducking suave.
15. Mezcla a −14 LUFS y ≤ −1 dBTP; `render.mjs --verify` determinista.

## Cómo adaptarlo a tu marca
- **Paleta:** cambia los 8 tokens de `:root` en `film/index.html`. Conserva los roles: fondo claro, un color profundo para títulos, un solo acento vivo, dos tintes del acento para el halo y `--shadow` con el r,g,b de tus títulos. Comprueba que el acento se lea sobre blanco.
- **Tipografías:** reemplaza los `@font-face` de `Display` y `UI` por tus archivos en `assets/fonts/` y actualiza `C.fonts` en `armado.js` si cambian los pesos. Mantén una display pesada y una UI legible, y revisa los anchos de las filas.
- **Logo:** sustituye el recuadro «TU LOGO» de la escena `end` por tu logo (SVG o PNG) con el mismo tamaño y la misma caída pesada.
- **Contenido:** cambia `ROWS`, `DUDAS` y `STEPS` de la demo por tu temario, tus preguntas frecuentes y tus pasos; cambia los marcadores «TU CLIP AQUÍ» por tus clips o capturas.
- **Copy y ritmo:** reescribe los títulos con tus palabras (una o dos por fila en 9:16), mueve las marcas de `timeline.json` a tu voz o a tu música y vuelve a ejecutar `node scripts/sync.mjs`.

## Si buscas otra cosa
- Para mostrar una app, plataforma o curso **por dentro** (cursor que actúa, contador tipo rodillo, reproductor que crece desde una fila), usa **Producto por dentro**.
- Para **comparar o probar un resultado** (antes/después en interfaz, un dato clave con anillo y zoom), usa **Paneles UI**.
- Para una **clase o lección** por secciones con cierre «Siguiente clase», usa **Clase hojas**; para explicar un servicio o cuidado con una tarjeta sobre lienzo claro, **Tarjeta escenario**.
