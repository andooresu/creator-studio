# Paneles con UI

## Esencia
- Es el estilo de la **prueba visual**: muestra un antes y un después en interfaz y prueba el resultado con **un dato clave**. Es limpio y luminoso, pero nunca está quieto: el cuadro respira, la retícula de puntos ondula en cada golpe y la prueba se arma pieza por pieza.
- Su movimiento central es **«dato clave»: anillo + zoom**. Un anillo se cierra sobre la fila que importa, la cámara se acerca a ella y la cifra aterriza y cuenta. Todo el reel se construye para llegar a ese momento.
- Tiene otras dos piezas propias: el **comparador antes/después** (dos capas del mismo encuadre y una cortina con tirador que barre de una a otra) y las **barras de comparación** (antes contra después en la misma escala).
- Es reconocible por el **fondo claro con halo de un tinte**, la **retícula de puntos en el acento**, **una sola familia tipográfica** (Manrope) con los títulos apilados a la izquierda y cifras tabulares, y los **paneles que cubren** la escena anterior con un filo de acento de 14 px.
- Sirve para reels de 15–30 s (9:16 y 4:5) que tienen que **comparar, demostrar un resultado o defender una cifra**: una mejora medible, un rediseño, un proceso más corto, una comparación honesta entre dos opciones.

## Estructura y ritmo
- **BPM de referencia:** 120 (1 beat = 0,5 s; 1 compás = 2 s). Duración típica de 22–24 s (44–48 beats) a 60 fps; el demo dura 13 s (26 beats).
- Mide el grid con `beats.json` y escribe todas las marcas en `timeline.json` en beats con nombre (`wipe`, `ring`, `zoom`, `num`, `logo`, `cta`, `recap`…). Nunca uses segundos fijos en `film.js`.

| Acto | Beats (en 22–24 s) | Qué pasa |
|---|---|---|
| 1. Gancho: el antes y el después | 0 → 8/9 | Título apilado de 2–3 líneas + el comparador que sube; la cortina barre del «antes» al «después» entre b3 y b6 y se asienta al medio. Etiquetas y chip como remates. |
| 2. Dato clave (el centro) | 8/9 → 18/19 | Panel nuevo. La interfaz o el reporte real sube, el anillo se cierra sobre la fila que importa, el título sale y la cámara hace zoom; la cifra aterriza y cuenta. |
| 3. Prueba | ~18 → 32 | Uno o dos paneles que respaldan el dato: barras antes/después, una captura con el resultado, un segundo comparador o un cursor que activa la vista «después». Escenas cortas de 4 beats si llevan una acción. |
| 4. Cierre | últimos 9–12 beats | Logo que aterriza, palabra de llamada a la acción, píldora sólida que crece y late, sub con acento y abanico de 3 piezas. |

- **Densidad:** 22–30 marcas y 20–27 SFX en 22–24 s. Eso da un evento nuevo cada 1–2 beats y **nunca más de 4 beats (2 s) sin algo nuevo**.
- **Cambios de escena:** el panel que cubre termina exacto en la marca de la escena. Esas marcas caen en líneas de compás o, como máximo, en medio compás cuando la voz lo pide.
- **Cortes duros** solo dentro del reproductor (clip A → clip B en la palabra que nombra el segundo).
- **Holds:** ninguna composición queda igual más de 4 beats. Todo hold lleva micro empuje de 1 → 1.03–1.05 a lo largo de la escena (`PAN.hold(t, S.push, from, to, 0.04)`).
- **Frame 0:** la primera línea del gancho arranca su `rise` en beat −0.4, así ya se lee en el primer frame.

### Mapa del demo (13 s)
| Escena | Beats | Movimientos |
|---|---|---|
| Gancho | 0 → 8 | «Mira la / diferencia» · el comparador sube (`heavy`) · etiqueta «Antes» · la cortina barre al «después» · etiqueta «Después» · la cortina se asienta al medio · chip |
| Dato clave | 8 → 16 | Panel desde la derecha · interfaz «Tu resultado» sube · **anillo** sobre «Ahora · 3 pasos» · el título sale y la **cámara hace zoom** a la fila · «3×» aterriza y cuenta de 1× a 3× · «más simple» · chip «Dato clave» |
| Prueba | 16 → 20 | Panel que sube · «La prueba, / en pantalla» · tarjeta de barras · barra «Antes» llena · barra «Después» llena en acento · check · chip |
| Cierre | 20 → 26 | «TU LOGO» aterriza · «Compara» sube · píldora «TÚ MISMO» crece y late · «en @tumarca» · abanico ANTES / DESPUÉS / TU CLIP |

## Archivos del estilo
- `helpers/paneles.js` (`window.PAN`): todos los movimientos. Cópialo a `film/paneles.js` y cárgalo en `film/index.html` **antes** de `film.js`.
- `demo/index.html`: los `@font-face`, los tokens de `:root` y las clases `.line` / `.ui` que el estilo necesita. Úsalo como `film/index.html`.
- `demo/film.js` + `demo/timeline.json`: un film completo de 13 s (antes/después → dato clave → prueba → cierre) con todo de reemplazo. Copia el film a `film/film.js` y el timeline a la raíz del proyecto, luego `node scripts/sync.mjs`.
- `fonts/`: Manrope variable, una sola familia para display y UI (SIL Open Font License 1.1). Cópiala a `assets/fonts/`.
- `demo/preview.jpg`: cuatro frames del demo en 9:16.

## Vocabulario de movimiento
Todo lo que suena usa `C.spHit` (los helpers ya lo hacen); `C.sp` solo para flotes y pulsos sin sonido. Presets: `heavy` para display, logo y piezas grandes; `default` para tarjetas, reproductor y morph; `snappy` para chips, anillos, cursor, píldora, check y subtítulos de apoyo. Nunca `playful`.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Dato clave: anillo + zoom (la firma)** | El anillo se cierra sobre la fila clave; el título sale por su máscara; la cámara se acerca 1.25–1.35x y deja la fila a la izquierda; la cifra aterriza a tamaño fijo y cuenta | Pon título, interfaz y anillo dentro de una caja cámara `reg(el('div', {class: 'abs', …}))`. `PAN.ringOn(...)` en `ring` → `rise(..., out: zoom − 0.35)` para el título → `PAN.zoomTo(t, cam, caja, 'zoom', 1.3, {tx, ty, hold})` 0.6–0.8 beat después del anillo. La cifra va **fuera** de la cámara: `line(root, …)` + `PAN.count(t, palabra, a, b, 'num', 1.2, fmt)`. SFX pop (anillo), whoosh (zoom), thump + 2 ticks (cifra). |
| **Comparador antes/después** | Dos capas del mismo encuadre en una tarjeta; una cortina blanca con tirador de acento barre de «antes» a «después» y se asienta al medio; etiquetas «Antes» (clara) y «Después» (sólida) | `PAN.compare(parent, w, h, capaAntes, capaDespués, {size})` + `PAN.compareOn(t, C, [[beat, fracción], …], [tagA, tagB])`. Fracción 1 = todo antes, 0 = todo después. Barrido de 0.5 beat con `default`. SFX whoosh (barrido) y pop (etiquetas). |
| **Barras de comparación** | Tarjeta con barras en la misma escala; la de «antes» en tinte, la de «después» en acento; la cifra de cada una hace pop | `PAN.bars(parent, {w, size, rows: [{label, value, text, accent}]})` + `PAN.barOn(t, B, i, beat)` una barra por beat (o medio beat). SFX pop. |
| **Título apilado en máscara** | 2–4 líneas a la izquierda; cada palabra sube por su máscara con stagger | `PAN.title(parent, filas, {y, size, accent:{fila:[índices]}})` + `TYPE.rise(t, línea, beat, out, {stagger: 0.07–0.12})`. Primera línea en −0.4; las siguientes a +0.35–0.5 beat o en la palabra de la voz. Para bloques: `PAN.rises(t, líneas, beat, 0.45)`. |
| **Eyebrow** | Línea corta en acento sobre el título | `TYPE.line(..., {color: PAN.COL.accent, size: 40–54})` + `rise(..., {preset: 'snappy', stagger: 0.08})`. |
| **Tarjeta que sube** | La pieza entra desde abajo 140–240 px, de 0.9 → 1, y asienta en el beat | `PAN.cardIn(t, el, x, y, 'marca', {dy, preset})`: `heavy` para documento, mapa o pieza grande; `default` para tarjetas medianas. La opacidad hace snap con `PAN.show(p)`. |
| **Captura real** | Pantalla capturada a 3x dentro de una tarjeta clara con sombra tintada | `PAN.shot(parent, '../assets/ui/x.png', [ancho, alto], k, {r, h, w, flat})`. `[ancho, alto]` en px css de la captura; `k` la escala a px del film. Nunca redibujes una interfaz que existe. |
| **Reemplazo de metraje** | Tarjeta con trama de tinte, botón de play y la etiqueta «TU CLIP AQUÍ» | `PAN.placeholder(parent, w, h, {label, bar})`. Solo para maquetas y demos: cámbiala por tu clip o captura. |
| **Interfaz de maqueta** | Ventana con barra, filas y botón | `PAN.uiCard(parent, {w, head, rows, button, size})`; devuelve `_rows` y `_btn` (rects locales) para apuntar anillos y cursor. |
| **Anillo de resalte** | Contorno de 5 px en acento que se cierra (1.06 → 1) sobre una zona | `PAN.ringEl(parent)` + `PAN.ringOn(t, R, beat, x, y, w, h, pad)`. Lleva SFX pop o click. |
| **Detalle que crece del original** | Un recorte sale de su posición y se agranda 1.5–4x en una tarjeta con borde de acento | `PAN.growFrom(t, el, rectOrigen, {x, y}, beat)` 0.5–0.6 beat después del anillo. Con una captura real, recorta el mismo PNG desplazado dentro de la tarjeta. |
| **Cursor que actúa** | Cursor oscuro con borde claro que se desliza y presiona (−14 %) en el beat; un anillo de clic se expande | `S.cu = PAN.cursor(root)` + `PAN.runCursor(t, S.cu, [[b, x, y], …, ['click', x, y]], 'click')`. Entra desde la esquina inferior derecha ~1.5 beats antes. SFX click. |
| **Check** | Círculo en acento con palomita que hace pop sobre la esquina de una pieza | `PAN.badge(parent, d)` + `PAN.badgeOn(t, B, x, y, beat)` (0.3 → 1, `snappy`). SFX pop o shutter. |
| **Chip** | Píldora clara con texto UI de 40–50 px que salta | `PAN.chip(parent, texto, size, {bg, color})` + `PAN.pop(t, el, x, y, beat)` (0.85 → 1 y +30 px). |
| **Tachado** | Barra de acento de 0.12 × size que cruza una palabra del título | `PAN.strikeEl(parent, size)` + `PAN.strikeOn(t, barra, línea, índice, x, y, beat)`; mide la palabra con su `offsetLeft`/`offsetWidth`. |
| **Caos → orden** | Miniaturas genéricas inclinadas que flotan y se transforman en las filas de una lista sobre la palabra clave; luego la lista hace scroll y un anillo la recorre | Una caja por miniatura + `PAN.morph(t, el, a, b, beatOf('orden') − 0.45 + i × 0.045)`; el anillo con `C.trk`, el scroll con `C.ease.inOut(C.seg(...))`. Las miniaturas genéricas son placeholders explícitos: dilo en un comentario. |
| **Reproductor** | Barra de ventana + clip en canvas + barra de progreso de 8 px en acento | `C.seqBank`, `C.seq`, `C.drawSeq(g, seq, t, t0, box, {z: 1 + 0.04 × seg})`. Entra de 0.5 → 1 con `default` y +120 px. Corte de clip en la palabra. Puede caer fuera de cuadro (`sp(...) × H × 0.7`) cuando entran las tarjetas. |
| **Tarjetas en abanico** | 3–4 piezas suben una por beat (o cada 0.25 en el recap), con giros de −4 a 4°, y flotan | `PAN.fan(t, tarjetas, {x, y, dx}, 'recap', 0.25)`. |
| **Pin → tarjeta** | Un pulso circular late dos veces en un punto y una tarjeta crece desde ahí (0.2 → 1) | `PAN.pulseEl` + `PAN.pulseOn(t, P, x, y, [b, b + 3])` y luego `PAN.growFrom(..., {s0: 0.2})`. |
| **Retícula viva** | Puntos de 3 px en acento al 5–32 % que se inflan como una onda diagonal en cada golpe | `S.D = PAN.bg(root, cx, cy)` (o el que devuelve `PAN.panel`) + `PAN.dots(S.D, t, [beats])` con 3–6 beats por escena: los mismos de los hits principales. |
| **Cierre vivo** | El logo aterriza (1.25 → 1, `heavy`), la palabra de acción sube, la píldora crece (0.8 → 1) y late +7 % cada 1.5 beats, el sub entra con acento y el abanico sube | Escena `end` del demo: `PAN.pill` + `PAN.pillOn(t, P, x, y, 'cta', [pulsos])` + `PAN.fan`. Cambia textos y piezas. |

## Layout
- Cada formato tiene su propio objeto de layout: `PAN.L({ s: {…}, t: {…}, w: {…} })` devuelve el del formato actual (`t` = 9:16, `s` = 4:5 y 1:1, `w` = 16:9). Re-corta filas, tamaños y posiciones por formato; **no escales un layout a otro**.
- **Márgenes:** `PAN.X0` = 72 (9:16), 80 (4:5), 120 (16:9). `PAN.TOP` (primera línea de título) = 290 en 9:16 (fuera del 14 % superior), 80 en 4:5 y 150 en 16:9. El 72/80 en vertical es una excepción medida de este estilo.
- **9:16 (1080×1920, principal):** título de 290–315 hasta ~800–1000; pieza entre 760–1720; subtítulos en 0.755 H. Texto fuera del 14 % superior, del 20 % inferior (salvo subtítulo y abanico decorativo) y del 12 % derecho. Piezas clave ≤ 1000 px de ancho.
- **4:5 (1080×1350):** título arriba en 70–80 a 60–110 px, frases de 2–3 palabras en 1–3 líneas; pieza entre 250–1300; subtítulos en 0.86.
- **16:9 (opcional):** título a la izquierda, pieza a la derecha.
- El micro empuje se ancla arriba (`PAN.pushBox(root, W / 2, PAN.TOP)`) para que el título no suba hacia la zona de la plataforma al escalar.

## Tipografía
- **Una sola familia: Manrope** (variable). La jerarquía sale del peso y del tamaño, no de mezclar fuentes.
- **Display:** Manrope 800 en sentence case, interletrado −0.045 em (más cerrado que lo habitual: es parte de la firma), cifras tabulares.
  - Títulos en 9:16 de 128–160 px (gancho 150; palabra única de 160–170).
  - **Cifra del dato clave:** 220–260 px en el acento, con una unidad corta al lado (60–68 px en la tinta de títulos).
  - Títulos en 4:5 de 90–110 px.
  - Interlínea 1.17 (la máscara de `.line` necesita ese aire; no la cierres).
  - Color: la tinta de títulos (`--title`).
- **UI:** Manrope 600–800 para chips, etiquetas, botones, barras y cuerpos de tarjeta, de 40–58 px. El texto de una interfaz real viene de la captura.
- **Alineación:** siempre a la izquierda en `X0`. Nunca un título centrado.
- **Cortes de línea:** en 9:16, 1–2 palabras por línea (hasta 3 líneas); en 4:5, frases de 2–3 palabras.
- **Acento:** solo en la palabra clave o en la cifra, máximo 1–2 palabras por título.
- **Mínimo legible:** 40 px en chips y 28 px absolutos. Escala la cámara, no la fuente.
- La clase `.line` del demo deja 0.24 em de aire arriba: hace falta para tildes y para los signos «¿» y «¡».

## Color
Paleta del estilo (tokens de `:root` en `demo/index.html`):

| Rol | Token | Valor |
|---|---|---|
| Fondo | `--bg` | `#fdfcff` |
| Tinta (cursor, texto de UI) | `--ink` | `#16131f` |
| Tinta secundaria | `--ink-2` | `#625a72` |
| Acento único | `--accent` | `#7048e8` |
| Tinta de títulos y píldoras | `--title` | `#2a1863` |
| Tinte suave (halo exterior, barras) | `--tint` | `#f3efff` |
| Tinte fuerte (halo interior, bordes) | `--tint-2` | `#e4dbff` |
| Sombras | `--shadow-rgb` | `42,24,99` (la tinta de títulos en r,g,b) |

- **Fondo** claro con halo radial (`--tint-2` 0 % → `--tint` 38 % → `--bg` 72 %), elipse de 0.9 W × 0.7 H. Mueve el centro del halo de esquina en cada panel: (0.9, 0.12) → (0.12, 0.1) → (0.88, 0.12) → (0.5, 0).
- **Acento único:** palabra clave, retícula, anillos, filo del panel, barra de progreso, tachado, check, botón y pulsos.
- **Tinta de títulos** solo como texto y como relleno de la píldora o de un chip pequeño de dato. **Nunca como campo o fondo.**
- **Profundidad** con sombras tintadas (`rgba(var(--shadow-rgb), .3–.6)`), tintes y halo. Sin campos oscuros ni cabeceras de color.
- El metraje real va en su color original.

## Subtítulos
- Preset `pill-sobrio`, solo en 9:16 y 4:5: `y: 0.755` (en 4:5, 0.86), `size: 52`, `maxChars: 30`.
- Pon en `skip` toda frase de voz que ya está escrita en pantalla como título: el gancho, la frase de la solución, la del dato y la del cierre. Subtitula solo lo que la pantalla no dice.
- Los subtítulos nunca tapan piezas clave: reserva la banda 0.72–0.80 H en 9:16.

## Transiciones
1. **Panel que cubre (la principal):**
   - La escena nueva se registra con `pre: PAN.PRE, cut: false` (0.75 beat) y llama `PAN.panel(root, S, cx, cy, dir)` en `build` y `PAN.cover(t, S)` al empezar `run`.
   - Desliza con `ease.inOut` sobre la anterior y termina exacto en `from`.
   - Alterna la dirección: arriba (`'up'`) ↔ desde la derecha (`'left'`).
   - Lleva un filo de acento de 14 px en el borde de ataque y una sombra tintada; el filo desaparece al completar.
   - SFX whoosh que arranca con el panel y golpe en la marca.
2. **Morph dentro de la escena:** una pieza se convierte en otra (miniaturas → filas, fila → detalle, pin → tarjeta) en ~1 beat con `default`.
3. **Corte de clip** dentro del reproductor, en la palabra.
4. **Reproductor que cae fuera de cuadro** (0.5 beat antes) mientras entran las tarjetas.
5. **Intercambio de títulos** dentro de una escena con `rise(t, línea, in, out)`: el saliente se va completo antes del entrante (`out` = siguiente in − salida).

Nunca crossfade, iris genérico ni glitch.

## Sonido y música
- **Música:** pista original por proyecto, house / nu-disco luminoso a ~120 BPM (guitarra funk, Rhodes, bajo analógico). Toma completa sin editar; `compare_music.py` debe dar `distinct` contra tus reels anteriores.
- **Energía:** llena desde b0, se sostiene bajo la voz, sube en el bloque de producto (~60 % del video) y cierra limpia en el logo.
- **SFX:** uno por evento visual, todos declarados en `timeline.json` → `sfx` y sobre el grid:
  - pop: palabras clave, chips, anillos, abanico
  - click: cursor
  - whoosh: paneles y detalle que crece
  - thump: logo y piezas `heavy`
  - tick: contadores
  - shutter o pop: check
- **Mezcla:** `{music: -9, sfx: -6, vo: 0, duck: true}` → `mix.py` a −14 LUFS y ≤ −1 dBTP.

## Voz en off
- Voz cálida, clara y segura, en español latino neutro. Tono de profesional que recomienda, no de locutor de oferta.
- 5–8 frases cortas, cada una colocada en un beat, con ≥ 1 beat de aire entre frases. Nunca aceleres la toma.
- El texto en pantalla se adelanta a la voz: el título arranca ~0.4 beat antes de su frase.
- Los hits de detalle (anillo, check, morph) caen en la palabra que los nombra; márcala en `timeline.json`.
- El copy vende beneficios: sin frases defensivas ni aclaraciones que nadie pidió.
- La voz no dice precios ni datos que cambian, para que una sola locución sirva a todas las versiones.

## Reglas recurrentes y prohibiciones
- Fondo claro siempre; ningún fondo o campo oscuro.
- Un solo acento; la tinta de títulos solo en texto y píldoras.
- Interfaz y documentos reales capturados a 3x, nunca redibujados. La interfaz dibujada (`uiCard`) y las tarjetas «TU CLIP AQUÍ» son para maquetas y demos, o para representar lo genérico (el caos, lo ajeno); dilo en un comentario.
- Un antes/después solo con material real del mismo caso; nunca compares una toma generada o retocada.
- No demuestres técnicas ni resultados con fotos o clips generados. Una imagen generada solo puede ilustrar un concepto, nunca un resultado ni una persona real.
- Sin datos que caduquen: cupos, contadores en vivo, fechas. Los precios van en una versión por moneda y solo en la escena de precio o de cierre.
- El nombre de la marca y las cifras se escriben exactamente como en el brief.
- Prohibido:
  - fundidos como entrada o salida
  - crossfades
  - giros (spins)
  - rebote en la UI
  - partículas
  - glow
  - marcos
  - etiquetas en las esquinas
  - título centrado
- Sin `translate3d` ni `will-change`; todo con `C.put`.
- Cierre ≤ 12 beats, con un elemento nuevo o un pulso cada ≤ 1.5 beats; nunca estático.

## Qué revisa el crítico
- [ ] El frame 0 ya lee la primera línea del gancho; el gancho completo se lee antes de 2 s.
- [ ] Cada panel cubre por completo en su marca; ninguna escena entra sobre un panel a medias; el filo de acento desaparece al terminar.
- [ ] Nada dura más de 4 beats sin un elemento nuevo; cada escena tiene micro empuje.
- [ ] Cada hit visual (rise, pop, anillo, clic, check, logo) coincide con su SFX en el grid (`spHit`); la retícula late en esos mismos beats.
- [ ] Ninguna entrada o salida es un fundido; la opacidad hace snap (`PAN.show`).
- [ ] Todos los títulos están a la izquierda en `X0`, en la tinta de títulos, con 1–2 palabras en acento como máximo; sentence case; ≥ 28 px, chips ≥ 40 px.
- [ ] El intercambio de títulos es secuencial; ninguna palabra asoma en su máscara en el primer frame.
- [ ] Las capturas son reales, nítidas (3x) y sin datos personales; los anillos caen exactos sobre su zona en cada formato.
- [ ] El cursor llega antes del clic, presiona en el beat y el anillo de clic se expande.
- [ ] Los subtítulos no repiten títulos y no tapan piezas; las zonas seguras de 9:16 están libres.
- [ ] No quedan placeholders «TU CLIP AQUÍ» / «TU LOGO» en un video final.
- [ ] No hay fondos oscuros, precios en la voz ni cifras caducables.
- [ ] El dato clave es el momento central: el anillo cae exacto sobre la fila, ningún texto queda cortado por el borde durante el zoom y la cifra se lee a tamaño fijo.
- [ ] El antes y el después comparten encuadre y luz; la cifra del dato sale del brief y es verificable.
- [ ] El cierre está vivo: el logo aterriza, la píldora crece y late, el abanico sube.
- [ ] La mezcla está a −14 LUFS y ≤ −1 dBTP; `render.mjs --verify` es determinista en todos los formatos.

## Cómo adaptarlo a tu marca
1. **Paleta:** cambia los tokens de `:root` en `film/index.html`. Conserva los roles: un fondo claro, una tinta de títulos oscura, un acento saturado y dos tintes suaves del acento para el halo. Pon en `--shadow-rgb` tu tinta de títulos en r,g,b. Los helpers leen los tokens solos (los valores escritos en `paneles.js` son solo respaldo si falta un token).
2. **Fuentes:** reemplaza los `@font-face` de `Display` y `UI` por tu familia (o por una display 800 y una de UI), con los archivos en `assets/fonts/`, y actualiza `C.fonts` en `film.js`. Una sola familia es lo que mejor conserva la firma.
3. **Logo:** cambia la caja «TU LOGO» de la escena `end` por un `<img>` de tu lockup (PNG o SVG) con el mismo ancho, que aterrice con `heavy`.
4. **Material:** pon tu toma «antes» y tu toma «después» en las dos capas del comparador (mismo encuadre, misma luz, sin retoque que cambie el resultado) y quita el `filter: grayscale` del demo. Cambia cada otro `PAN.placeholder` por una captura real (`PAN.shot`) o por tu clip en un reproductor (`C.drawSeq`). Cambia `PAN.uiCard` por capturas de tu interfaz a 3x y apunta los anillos y el cursor a sus zonas en px css × `k`.
5. **Copy y marcas:** reescribe los títulos con tu beneficio (un beneficio por escena), coloca la voz en beats y mueve las marcas de `timeline.json` a las palabras que nombran cada hit. Después: `node scripts/sync.mjs` → lint → hoja de contactos → crítica.

## Cómo usar la demo
1. Copia `demo/index.html` y `demo/film.js` a `film/` de tu proyecto (`film/index.html`, `film/film.js`) y `demo/timeline.json` a la raíz del proyecto (`timeline.json`).
2. Copia `helpers/paneles.js` a `film/paneles.js` (el `<script src="paneles.js">` ya va antes de `film.js` en el `index.html` del demo) y `fonts/*` a `assets/fonts/`.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`).

## Si buscas otra cosa
- Para mostrar una app, plataforma o curso por dentro (contador tipo rodillo, cursor, reproductor que crece desde la fila): **producto-por-dentro**.
- Para pasar del caos a un método, programa o plan por pasos: **metodo-armado**.
- Para explicar un servicio o cuidado con una tarjeta y diagramas dibujados sobre lienzo claro: **tarjeta-escenario**.
