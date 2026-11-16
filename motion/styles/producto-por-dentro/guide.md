# Producto por dentro

## Esencia
- Un recorrido guiado por un producto o servicio: el espectador entra, abre, mira, descarga, termina y se lleva un beneficio. Todo en segunda persona y sobre fondo claro.
- La energía no viene del montaje (≈0,3 cortes por segundo). Viene de la transformación continua: la interfaz se arma sola, un cursor la usa, los números giran como un rodillo y los paneles claros cubren la escena anterior.
- Se reconoce por cuatro rasgos:
  1. Titulares display muy pesados en el color de titular (`--head`), alineados a la izquierda, con la palabra clave en el único color de acento.
  2. Un halo suave con rejilla de puntos de acento que late con los beats.
  3. El filo de acento de 14 px en el borde de ataque de los paneles que entran.
  4. La UI siempre crece de algo: fila → reproductor, pin → ficha, fragmento → lupa.
- Sirve para reels de 20–30 s de plataformas, cursos, apps, portales o el paso a paso de un servicio, en 9:16, 4:5 y 16:9.

## Estructura y ritmo
- **Grid:** 120 BPM medidos (`beats.json`). 1 beat = 0,5 s y 1 compás = 2 s. 60 fps en finales.
- **Duración:** 30 s = 60 beats (versión con VO) o 20 s = 40 beats (showreel sin VO). La demo incluida dura 13 s = 26 beats.
- Todos los límites van como marcas en `timeline.json`, nunca en segundos.

### Plantilla de 30 s (con voz)
| Acto | Beats | Qué pasa |
|---|---|---|
| 1 Hook | 0–6 | Titular de 3–5 renglones apilados y el arte del producto que sube; el cursor llega y pulsa en la marca `enter` |
| 2 Conteo | 6–15,5 | Número gigante que gira de 0 a N, su etiqueta y la lista cayendo en cascada y haciendo scroll; el cursor selecciona una fila |
| 3 Demostración | 15,5–24 | El reproductor o la ventana crece de la fila pulsada; corre el material con cortes en beats; frase-dato |
| 4 Detalle | 24–32 | Dos capturas del contenido (vista general + caja de puntos clave) |
| 5 Entregables | 32–38 | 4 tarjetas caen, una por beat, en una rejilla 2×2; el cursor descarga una |
| 6 Prueba | 38–43 | Un documento (certificado, ficha, resultado); un fragmento se resalta y sale ampliado |
| 7 Pertenencia | 43–47 | Mapa o directorio; cae un pin y de él crece una ficha |
| 8 Oferta | 47–52,5 | Tarjetas de planes, píldora de etiqueta y frase «Desde … al mes» |
| 9 Cierre | 52,5–60 | Golpe del lockup, verbo CTA, píldora de acento y subfrase; vivo hasta el último frame |

### Plantilla de 20 s (showreel sin voz)
- Hook 0–8 · Producto que se arma 8–16 · Tres funciones de 4 beats (16–20, 20–24, 24–28) · Número 28–36 · Cierre 36–40.

### Plantilla corta de 12–15 s (la de la demo)
- Hook 0–6 · Conteo 6–12 · Demostración 12–16 · Entregables 16–20 · Cierre 20–26.

### Reglas de ritmo
- **Cambios de escena:** en líneas de compás o de medio compás (beats pares, o x,5 si la frase de VO lo exige). Los marcan los paneles que cubren, no cortes secos.
- **Densidad:**
  - Algo nuevo cada 0,5–2 beats.
  - Nunca más de 4 beats (un compás) sin un elemento nuevo.
  - La cascada de listas usa un elemento cada 0,25 beat.
  - Los contadores avanzan un paso cada 0,25 beat.
- **Holds:** todo plano sostenido vive dentro de `pushBox` con un empuje de 1,00 → 1,035–1,05 a lo largo de la escena (`PPD.push(t, S, 0.04)`).
- **Cierre:** ≤ 2 s de hold real, con pulsos en los últimos 3 beats.

## Sistema de layout
- **Un solo film para todos los formatos.** Las posiciones van por formato con `PPD.L({w, s, t})` (w = 16:9, s = 1:1 y 4:5, t = 9:16). Nunca escales el cuadro entero.
- **Borde de la tipografía:** `PPD.X0` = 120 (16:9), 80 (4:5) y 72 (9:16). Primer renglón en `PPD.TOP` = 150, 80 y 290. Los valores de 4:5 y 9:16 son la excepción explícita del estilo a la regla general de 120 px.
- **16:9:** dos columnas; tipografía a la izquierda (x 120) y UI a la derecha (x 880–1150). Los titulares pueden partirse en 3 renglones. La cascada de lista usa todo el alto.
- **4:5:** titular arriba (y 80) en uno o dos renglones más largos; UI debajo, desde y ≈ 240–330. Tamaños display 82–118 px.
- **9:16:**
  - Titular desde y 290, para despejar el 14 % superior.
  - UI apilada debajo: el bloque de interfaz vive entre y ≈ 820 y ≈ 1520 (centro hacia 0,45–0,79 H). Ninguna escena deja vacío más del 35 % inferior del cuadro: si sobra aire, baja o agranda la tarjeta, la lista o la rejilla.
  - Nada clave por debajo de y 1536 (20 % inferior) ni en los 130 px de la derecha.
  - Las listas se recortan con un `bottom` (~1510) dentro de `PPD.listWindow`.
  - El reproductor puede ir primero centrado y luego bajar para dejar sitio al dato.
- **1:1:** solo para el showreel; aplica la lógica de 4:5 con alto 1080.
- **Cursor:** su escala sube por formato (1,1 / 1,2 / 1,4) para que se vea en el teléfono. `PPD.cursor` ya lo hace.

## Tipografía
- **Display (Manrope):** 800, tracking −0,035 em, interlineado 1,17 en los titulares apilados (1,05 con peso 700 en las etiquetas del showreel). Sentence case.
- **Tamaños a 1080p:**
  - Hook: 112–128 px.
  - Titulares de escena: 84–170 px.
  - Cifras héroe: 300–560 px.
  - CTA del cierre: 150–210 px.
  - Subfrase del cierre: 58–68 px.
- **UI (Inter):**
  - Eyebrow en mayúsculas: 700, 34–40 px, +0,12 em, en acento. Una sola vez por video.
  - Píldoras: 700, 36–44 px.
  - El resto del texto de UI viene de las capturas del producto.
- **Alineación:** siempre a la izquierda, en `X0`.
- **Acento:** solo en la palabra clave o en el remate de la frase («por dentro.», «quieras», «ves.», «lugar.», «al mes»). Nunca en todo el titular ni en más de un renglón por escena.
- **Color del titular:** `--head` (verde muy oscuro en la plantilla). Nunca negro puro.
- **Mínimo legible:** 36 px en display y 28 px en UI. Marca la UI de reemplazo con `data-lint="ui"` (`PPD.uiCard` ya lo pone en su contenedor, así el lint exige la mitad dentro de las maquetas). Todo texto fuera de una tarjeta de UI va a 36 px o más. Los textos chicos dentro de capturas se amplían con la cámara o con una lupa que crece de ellos, nunca re-tipeándolos.
- **Fuentes:** `fonts/Manrope-var.woff2` (Display) e `Inter-var.woff2` (UI), registradas como en `demo/index.html`. Declara `C.fonts = ['800 100px Display', '700 100px Display', '600 40px UI', '700 40px UI']`. Ambas tienen licencia SIL OFL 1.1 (`fonts/OFL.md`).

## Color
Paleta de la plantilla (tokens de `:root` en `demo/index.html`):

| Rol | Token | Valor |
|---|---|---|
| Fondo | `--bg` | `#fcfcfa` |
| Tinta (cursor, texto de UI) | `--ink` | `#16181d` |
| Tinta secundaria | `--ink-2` | `#5f6470` |
| Acento único | `--accent` | `#0e9f6e` |
| Titulares | `--head` | `#0b3d33` |
| Tinte claro del halo y de superficies | `--tint` | `#e8f6f0` |
| Tinte medio del halo | `--tint-2` | `#cfeee1` |

- **Fondo:** claro siempre, con halo radial (`--tint-2` → `--tint` → `--bg`) cuyo centro alterna esquinas escena por escena (`PPD.bg(root, cx, cy)`).
- **Rejilla de puntos:** en acento, alfa entre 0,05 y 0,32 como máximo, paso de 54–56 px, sembrada con `mulberry32`.
- **Acento único:** palabra clave, anillos, anillo del cursor, pin, barra de progreso, filo de 14 px de los paneles y fondo de la píldora CTA (texto blanco).
- **Superficies:** tarjetas blancas con sombras teñidas del color de titular (`--shadow`), tintes `--tint` y `--tint-2`. Las píldoras de etiqueta usan el color que la etiqueta tiene en el producto.
- **Sin campos oscuros de fondo.** Excepción: el showreel sin VO puede alternar campo de acento (hook y cierre) y campo de titular (número), con puntos blancos, si el brief no exige fondo claro. Ese cambio de campo es el corte.
- **Material real:** con su color original, sin LUT.

## Vocabulario de movimiento
Todos los helpers están en `helpers/producto.js` (`window.PPD`). Cópialo a `film/producto.js` y cárgalo después de `type.js` y antes de `film.js`.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| Titular apilado por renglones | 2–5 renglones display; cada uno sube por su máscara palabra a palabra; el hook ya se lee en el frame 0 | `PPD.title(parent, rows, {y, size, accent: {fila: [índices]}})` y luego `TYPE.rise(t, l, beat, null, {stagger: 0.07–0.08})` o `PPD.rises(t, lines, beat, 0.5)`: un renglón cada 0,5 beat. En el hook, los dos primeros renglones arrancan en beat −0,4 para que la promesa se lea hacia 1,5 s |
| La tipografía adelanta a la voz | Cada renglón llega 0,1–0,3 beat antes de la palabra hablada | `rise(t, l, beatOf('marca') - 0.2)` |
| Captura en tarjeta | Recorte 3x con radio de 10–22 px y sombra; nunca redibujado | `PPD.uiCard(parent, w, h, {src, img, r, flat})` |
| Marcador de posición | Trama diagonal, borde discontinuo y rótulo («TU CLIP AQUÍ», «TU CAPTURA AQUÍ») | `PPD.placeholder(parent, w, h, 'TU CLIP AQUÍ')`. Solo para bocetos y plantillas: en el video final va la captura real |
| Card rise | Sube 140–240 px, escala 0,9 → 1 y aparece de golpe | `PPD.cardIn(t, elm, x, y, beat, {dy, preset})`: `heavy` para piezas grandes, `default` para tarjetas, `snappy` para cajas chicas |
| Arte del producto bajo el hook | Tarjeta grande que sube a 0,5 beat | `PPD.cardIn(..., 'art', {dy: 220, preset: 'heavy'})` |
| Cursor que actúa | Flecha oscura con trazo blanco que entra desde abajo a la derecha, describe un arco y se hunde 14 % al pulsar; un anillo de acento de 90 px se expande | `PPD.cursor(root)` + `PPD.runCursor(t, Cu, [[beat, x, y], …], clickBeat)`. Entra 1–1,2 beats antes del clic. Lleva SFX click |
| Anillo de selección | Marco de 5 px en acento sobre una fila o un fragmento; escala 1,05 → 1 | `PPD.ring(parent)` + `PPD.runRing(t, ring, rect, beat)` |
| Cascada de lista + scroll | Las filas caen una cada 0,25 beat (x +60, y +80 → 0) dentro de su ventana de recorte; luego la lista hace scroll con `ease.inOut` en ~1,5–2,6 beats | `PPD.listWindow(parent, top, bottom)` + `PPD.cascade(t, list, rows, b0, {every: 0.25, scroll, s0, s1})` |
| Contador de rodillo | Número de 300–560 px que avanza en pasos de 0,25 beat de 0 a N y aterriza con thump | `PPD.counter(t, linea.words[0], N, 'count', 'count_land')`. Un tick por paso, thump al aterrizar |
| Crecer de algo | El reproductor nace de la fila pulsada, la ficha del pin y la lupa del fragmento | `PPD.growFrom(t, elm, rectOrigen, destino, beat)`: interpola centro y escala desde el rectángulo real del origen |
| Material en ventana | Frames dentro de una barra de ventana, con barra de progreso de 8 px en acento; cortes secos entre clips en beats | `C.seqBank`, `C.seq` y `C.drawSeq(g, seq, t, t0, box)`. El progreso va con `seg(t, 'play', 'siguiente')` |
| Tarjetas que caen en rejilla | 4 tarjetas caen 240 px con rotación ±4° → 0, una por beat (las impares +0,12) | `PPD.dropGrid(t, cards, beats, {x0, y, w, gap, cols}, {sel, liftAt})` |
| La elegida se levanta | Sube 24 px y escala 1,06 al clic; luego baja a medias | Incluido en `dropGrid` con `sel` y `liftAt` |
| Pin + pulso | Punto de acento con aro blanco que cae 160 px, escala 0,6 → 1 y deja un anillo que se expande en 0,9 s | `PPD.pin(parent)` + `PPD.runPin(t, P, x, y, beat)` |
| Píldora de etiqueta | UI 700 que sube 30 px y escala 0,85 → 1 | `PPD.tagIn(t, e, x, y, beat)` |
| Píldora CTA | Display sobre acento que crece desde su borde izquierdo (0,8 → 1) y respira +7 % en los últimos beats | `PPD.ctaPill(t, e, x, y, beat, [23, 24, 25])` con `transform-origin: 0 50%` |
| Golpe del lockup | El logo baja 40 px y escala 1,25 → 1 en `heavy` | `PPD.lockupHit(t, e, x, y, beat)` |
| Rejilla que late | Puntos de 3 px que crecen hasta +6 px en cada beat listado, en onda diagonal | `PPD.bg(root, cx, cy)` + `PPD.dots(D, t, [beats])`. Lista 3–5 beats por escena, los de los golpes |
| Recorrido de resaltado | Celdas de una barra se encienden una tras otra cada 0,75 beat (+16 % y anillo) | `PPD.highlightWalk(t, cells, b0, 0.75)` |
| Ensamblado de página (showreel) | Cabecera → hero → datos → 4 tarjetas, una por medio beat; luego el grupo se encoge | `C.trkObj` sobre el grupo |

- Todo lo que suena usa `spHit` (adelanta el golpe para que se lea en el beat). Los helpers ya lo hacen.
- `sp` simple solo para lo que no suena: cascadas, scrolls y desplazamientos de grupo.
- `playful` no se usa nunca.

## Transiciones
1. **Panel claro que cubre (por defecto).**
   - La escena nueva entra como panel, hacia arriba o desde la derecha.
   - Dura `PPD.PRE = 0.75` beat con `ease.inOut` y se completa exactamente en el beat `from`.
   - Filo de acento de 14 px en el borde de ataque, visible solo mientras se mueve, y sombra de 80 px.
   - `S.D = PPD.panel(root, S, cx, cy, 'up' | 'left')` en `build` y `PPD.cover(t, S)` al principio de `run`. La escena declara `pre: PPD.PRE, cut: false`.
   - Alterna `'up'` y `'left'` escena por escena.
2. **Corte seco en compás:** solo hacia la escena de demostración, cuando lo nuevo crece del clic anterior. El clic está medio beat antes del corte, así se lee como continuidad.
3. **Crecer de lo pulsado:** fila → reproductor, pin → ficha, fragmento → lupa, en 1 beat con `PPD.growFrom`.
4. **Showreel:** empuje a cámara (×1,25–1,9 en 1,6 beats) + panel con filo, o barrido por recorte con `C.inset` en ~1 beat hacia un campo de color.
5. **Cortes dentro del reproductor:** cortes secos entre clips en beats marcados (`clip2`, `clip3`).

Nunca crossfades, nunca desvanecimientos de escena, nunca un panel que entre sobre una cobertura sin terminar.

## Subtítulos
- **Preset:** `pill-sobrio`, solo en 9:16 y 4:5. En 16:9 no llevan.
- **Ajustes:** `{"formats": ["9x16", "4x5"], "y": 0.755, "yFmt": {"4x5": 0.86}, "size": 52, "maxChars": 30}`.
- **`skip`:** obligatorio para toda frase de VO que ya aparece escrita como titular (hook, frase-dato, CTA). El subtítulo nunca duplica la tipografía grande.
- **Posición:** comprueba que no choque con la UI. Si una captura baja más allá de y ≈ 0,72 H, sube la captura, no el subtítulo.
- **Showreel sin VO:** sin subtítulos.

## Sonido y música
- **Género:** nu-disco o house luminoso a 120 BPM, en tonalidad mayor: guitarra rítmica, Rhodes, bajo analógico y kick a negras. Un track original por proyecto, que debe salir `distinct` en `compare_music.py` frente a tus reels anteriores. Descarta variantes que suenen a deep house genérico.
- **Energía:**
  - Llena desde el beat 0 (con ducking bajo la voz).
  - Sube en el ecuador (las entregas).
  - Cierra limpio en los dos últimos compases, con el golpe del logo.
- **SFX:** 26–38 eventos en 30 s (la demo de 13 s declara 16 eventos más 12 ticks), todos en `timeline.json` `sfx` y en beats.
  - pop: cada renglón del hook, cada tarjeta y cada píldora.
  - click: cada pulsación del cursor.
  - whoosh: apertura del reproductor y panel grande.
  - tick: cada paso del contador, cada 0,25 beat.
  - thump: aterrizaje del número, el documento-prueba y el lockup.
  - check o shutter: sello o descarga.
  - Prefiere muestras propias del proyecto sobre el set de stock.
- **Mezcla:** `{music: -9, sfx: -6, vo: 0, duck: true}` → `mix.py` a −14 LUFS y ≤ −1 dBTP.

## Voz en off
- **Voz:** cálida y segura, a ritmo de conversación.
- **Persona:** segunda persona en presente, con verbos de acción del recorrido: «Entras… Abres el módulo… Descargas la guía… Terminas con…».
- **Copy:** solo beneficios. Nada de frases defensivas, aclaraciones ni justificaciones.
- **Cifras:** las cifras clave se dicen en palabras y se muestran en número.
- **Frases y beats:** unas 8 frases en 30 s, cortadas y colocadas en beats. Patrón de partida: 0, 6, 16, 25, 32, 38, 47, 55. Ajústalas al grid; nunca aceleres una toma.
- **Pausas:** cada frase deja 0,5–1 beat de aire antes del siguiente cambio de escena.
- **Precio:** la voz no lo dice; así una locución sirve para todas las monedas y solo cambia la escena de oferta.
- **CTA hablado:** corto, con puntos suspensivos y una palabra-gatillo en mayúsculas («Comenta GUÍA… y te la envío») o «Empieza hoy… con [beneficio]». Nunca termina en un verbo desnudo.

## Reglas recurrentes y prohibiciones
- **Fondo:** claro siempre, con profundidad por halo, tintes, sombras y la rejilla que late. Sin cabeceras ni fondos oscuros, salvo el showreel autorizado.
- **UI:**
  - UI real capturada a 3x (Playwright), nunca redibujada. Si algo solo existe como imagen, reconstrúyelo pieza por pieza y déjalo comentado.
  - Los marcadores dibujados de la demo son solo plantilla: en un video publicado cada uno se reemplaza por material real.
  - Las técnicas o servicios no se demuestran con fotos ni clips generados: solo material real.
- **Afirmaciones:** solo cifras y afirmaciones que aparecen en la página del producto. Nunca contadores cambiantes (cupos, stock): el número cambia y el video no.
- **Tipografía:** un acento por escena, siempre sobre el remate.
- **Movimiento:**
  - Nada entra con fade: máscara, card rise, crecer de algo, caída con resorte o type-on.
  - Swaps secuenciales.
  - Cada escena tiene su `pushBox` con micro-empuje.
- **Cursor:** como máximo una pulsación por escena, siempre sobre el elemento que causa la escena siguiente.
- **Prohibido:** título centrado sobre degradado, etiquetas en esquinas, marcos, glow, partículas, giros, glitches, bounce en UI, crossfades y `playful`.
- **Determinismo:** solo `mulberry32` sembrado, transformaciones 2D (`C.put`), sin `translate3d`. Corre `--verify --all` una vez.
- **Versiones:** un solo film con parámetros; solo cambia la escena afectada.

## Qué revisa el crítico
- **Arranque:** el frame 0 ya lee el primer renglón del hook y la promesa completa se lee antes de 2 s.
- **Ritmo:**
  - Cada cambio de escena aterriza en un beat de compás (o x,5 justificado).
  - Los paneles terminan exactamente en `from` y su filo de 14 px desaparece al completarse.
  - Ningún tramo de más de 4 beats sin un elemento nuevo.
  - El cierre late en los últimos 3 beats.
- **Golpes:** cada pop, click, thump y tick coincide con un movimiento visible (`spHit`); el contador avanza en pasos sincronizados con los ticks.
- **Tipografía:** alineada en `X0`, en `--head`, con acento solo en la palabra clave; ninguna máscara deja asomar glifos en el primer frame; nada legible por debajo de 28 px en la prueba de 360 px de ancho.
- **Material:** UI nítida (≤ 3x), material acorde al texto y ningún marcador «TU CLIP AQUÍ» en un video publicado.
- **Movimiento:** lo que crece de algo parte realmente de la posición del origen; el cursor pulsa sobre el elemento correcto y en el beat del click; todo hold tiene empuje de 1,035–1,05.
- **Composición 9:16:** ninguna escena deja más del 35 % inferior vacío; el bloque de UI baja o crece hasta llenar la franja 0,45–0,79 H.
- **Formatos:** en 9:16 nada clave invade el 14 % superior, el 20 % inferior ni el 12 % derecho; en 4:5 y 9:16 los subtítulos no tapan la UI ni repiten un titular.
- **Color y fondo:** un solo color de acento, fondo claro con halo, sin crossfades ni fades de entrada o salida.
- **Sonido:** mezcla a −14 LUFS y ≤ −1 dBTP, con la voz siempre inteligible sobre la música con ducking.

## Cómo usar la demo
La demo (13 s, 120 BPM) recorre una plataforma: hook «Así es tu plataforma por dentro», contador de 12 módulos con lista en cascada, reproductor que crece de la fila pulsada, rejilla de secciones y cierre «Pruébalo gratis». En un proyecto creado con `init.sh`:

1. Copia `demo/index.html` y `demo/film.js` a `film/` (sustituyen a los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/producto.js` a `film/producto.js` (el `<script src="producto.js">` ya va antes de `film.js` en `demo/index.html`) y `fonts/*.woff2` a `assets/fonts/`.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`; `--sheet` da la hoja de contactos).

Después reemplaza cada marcador («TU CAPTURA AQUÍ», «TU CLIP AQUÍ», «TU LOGO», «@tumarca») por tu material y ajusta las marcas de `timeline.json` a tu voz y tu música.

## Si buscas otra cosa
- ¿Comparar un antes y un después, o probar un dato? Usa **Paneles UI**.
- ¿Explicar un método o plan paso a paso, del desorden al orden? Usa **Método armado**.
- ¿Explicar un servicio o un cuidado con calma, sin recorrer una interfaz? Usa **Tarjeta escenario**.

## Cómo adaptarlo a tu marca
- **Paleta:** cambia solo los tokens de `:root` en `film/index.html` (`--bg`, `--ink`, `--ink-2`, `--accent`, `--head`, `--tint`, `--tint-2`, `--shadow`). Mantén un solo acento, un color de titular oscuro y dos tintes claros del mismo tono que el acento para el halo.
- **Fuentes:** sustituye `Manrope-var.woff2` e `Inter-var.woff2` por las de tu marca (una display pesada y una de interfaz) en las dos reglas `@font-face`. Revisa los tamaños si tu display es más ancha.
- **Logo:** el lockup «Tu marca» del cierre es un marcador; pon tu logo real (SVG o PNG a 6x) en `assets/brand/` y úsalo con `PPD.lockupHit`.
- **Material:** cambia cada «TU CAPTURA AQUÍ» por una captura real de tu producto con `PPD.uiCard(..., {src})` y cada «TU CLIP AQUÍ» por una secuencia de frames con `C.drawSeq`.
- **Copy:** reescribe los titulares con tu promesa («Así es tu plataforma por dentro», «Un clic y lo ves», «Pruébalo gratis») y usa solo cifras que tu producto pueda sostener.
- **Ritmo:** si tu música no va a 120 BPM, mide el grid con `beats.py`; las marcas siguen en beats y todo se reajusta solo.
