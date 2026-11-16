# Clase en hojas

## Esencia
- Una clase narrada en la que **la voz manda**. Cada elemento aparece, se enciende o se dibuja en la palabra exacta que lo nombra (`wt()` sobre las palabras de la VO). La música es solo una cama.
- Se siente limpia, paciente y ordenada, pero nunca quieta. Papel claro con un halo tenue del tinte, títulos en tinta oscura y **un único acento**. Tarjetas claras con sombra teñida del acento, números en círculos de acento y figuras explicativas animadas en canvas.
- Se reconoce por tres rasgos:
  1. la página entera llega como **una hoja rígida empujada** desde la derecha, sobre un whoosh suave;
  2. el contenido aterriza **atenuado al 32 %** y cada ítem se ilumina en su palabra;
  3. la estructura es fija: portada y objetivo → secciones numeradas `01…0n` → errores ✕ → puntos clave → cierre con lo que sigue.
- Sirve para formación, cursos por módulos, lecciones sueltas, protocolos paso a paso, fichas de parámetros y tablas comparativas. Es el estilo de clase del catálogo: sustituye a la antigua «Clase explicativa». La demo es la clase 1 de un curso de guion para video corto («Cómo funciona un buen guion.»).

## Estructura y ritmo
- **Duración:** clase completa de 130–280 s (tope duro: 5 min). Versión corta para redes: 8–30 s con 3–5 hojas (la demo dura 14,4 s).
- **Formato nativo:** 16:9 a 30 fps para clases largas; 9:16 para cápsulas cortas (ver «Formatos»). Si el brief pide 60 fps, se respeta.
- **BPM:** cualquier tempo entre 60 y 140; lo típico es 84–112. El tempo no dicta el contenido: lo dicta la VO. El grid solo fija dónde caen las hojas.
- **Marcas** en `timeline.json`: `s1 … sN` (una por archivo o frase de VO = una por hoja) más `endcard` y `done`.
  - Cada marca se ajusta al **downbeat** más cercano antes de la primera palabra de su sección.
  - Ese downbeat es el empuje de hoja. En una clase larga hay 9–13 empujes (≈ 0,05 cortes/s): la energía es interna, no de montaje.
- **Actos:**

| # | Bloque | Marca | Duración típica | Función |
|---|---|---|---|---|
| 0 | Portada + objetivo | s1 | 16–28 beats | eyebrow con número de clase, título en dos líneas (la 2.ª con punto final), chips del temario y una figura. Justo antes de «Al terminar…» la portada sale a la izquierda y entra el objetivo con 1–3 tarjetas numeradas |
| 1…n | Secciones numeradas | s2…sN | 24–64 beats c/u | eyebrow `01 · Nombre`, un título y 2–6 ítems (tarjetas, filas, chips, figura, clip). Si una sección no cabe, se parte en `· 1/2` y `· 2/2` |
| n+1 | Errores frecuentes | sN+1 | 16–24 beats | 2–3 tarjetas con ✕ en el color de error |
| n+2 | Puntos clave | sN+2 | 16–24 beats | 2–4 puntos que se encienden en su palabra, con una barra de tinte que salta al activo, más un chip de despedida («Hasta la clase 2», «Nos vemos en la siguiente clase») |
| fin | Cierre | endcard | ≤ 2 s útiles | logo, número y nombre de lo que sigue, y el módulo. Vivo: empuje y pulso |

- **Densidad:** algo nuevo cada 2–4 s (una tarjeta que se enciende, un segmento que se oscurece, una figura que avanza). **Ninguna pausa visual > 4 s.** Si la VO describe algo largo, se parte en segmentos (`segHTML`) que se oscurecen palabra por palabra.
- **Holds:** ninguna hoja queda quieta. `cam()` aplica un micro push de 1,000 → 1,012–1,025 a lo largo de la escena: 0,012 en hojas densas, 0,02–0,025 en hojas con pocas tarjetas grandes, 0,035 en el cierre.
- **Escalonado de entrada:** cuando la hoja aterriza, sus ítems hacen `enter()` con 0,06–0,12 s entre sí (`l0 + 0.1 + i * 0.08`), ≈ ⅛–¼ de beat a 100 BPM. Después se encienden uno por uno en su palabra.

## Vocabulario de movimiento
Todo está en `helpers/hojas.js` (`window.HOJAS`). Cópialo a `film/hojas.js`, cárgalo en `film/index.html` después de `type.js` y antes de `film.js`, y usa la demo (`demo/film.js`) como punto de partida. **Los tiempos que reciben los helpers son segundos** (tiempos de palabra); las marcas de `timeline.json` siguen siendo beats.

| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| **Hoja empujada** (cambio de sección) | la página completa entra desde x = W·1,05 y la anterior sale a −W·1,05, como un solo pliego rígido; el pico coincide con el whoosh | `section({ from: 'sN', to: 'sN+1', … })` ya lo hace con `cam(t, S, k, [in, out])`: resorte `heavy` liberado en `rel(m) = bt(m) − 0,33 s`, así el empuje culmina sobre el whoosh a cualquier tempo. Ajustes finos por marca en `HOJAS.LATE` |
| **Aterriza atenuado, se enciende en su palabra** | toda la hoja aterriza a la vez con el contenido al 32 % y cada tarjeta pasa a 100 % en su palabra | `enter(t, el, l0 + i*0.08, { dy: 60, s0: 0.95 })` + `lit(t, el, wt('sN', 'palabra') − 0.15…0.25)`. `lit` usa `filter: opacity(0.32 → 1)` con `snappy` vía `spHit`, para que el golpe se lea EN la palabra |
| **Crecer** (entrada de tarjeta o chip) | escala 0,90–0,97 → 1, sube 34–60 px, la opacidad se asienta en ~4 frames, con un pequeño sobretiro | `enter()` usa por defecto el resorte `POP` del estilo (≈ 6 % de sobretiro); pide `heavy` para títulos y figuras grandes. Filas que se deslizan: `{ dx: -24, dy: 0, preset: 'snappy' }` |
| **Título por palabras** | las palabras suben por máscara, una tras otra, en la primera palabra de la sección | `head()` → `TYPE.line()`, más `headRun(t, L, s0)`. En `section()` pasa `titleAt: wt('sN', 'primera')` |
| **Segmentos que se oscurecen** | la línea secundaria de una tarjeta pasa de gris a tinta fragmento por fragmento mientras se dice | en build: `segHTML([[texto, 'sN', 'palabra'], …])`; `section()` registra y anima todos los `.sg` solo (`segReg` + `darkSegs`). `dark()` lleva la opacidad de 0,3 a 1 |
| **Pulso de énfasis** | una tarjeta ya encendida respira +2–5 % en una palabra clave | `ringFx(t, el, s, 0.035)` o `put(el, { s: 1 + 0.03 * pulse(t, s − 0.1, 0.7) })` |
| **Figura que se dibuja con la voz** | capas, procesos, barras o líneas de tiempo en canvas avanzan según lo narrado | `panel(root, x, y, w, h)` (tarjeta con canvas) o `canvasPanel()` (sin tarjeta) + una función `draw*(d, …)` que recibe progresos 0..1: `span(t, a, b)` para tramos entre dos palabras, `hit(t, s, 'snappy')` para estados que encajan, `strokes(t, [..])` para golpes repetidos. Incluidas: `drawLayers` (franjas apiladas con rótulos), `drawSteps` (nodos unidos por una línea, horizontal o vertical) y `drawStack` (barra apilada en la rampa del acento). Cada `draw*` empieza con `clearRect` + `reset(g)` |
| **Clip o foto que se abre** | la imagen se revela de izquierda a derecha tras una máscara redondeada mientras escala 0,94 → 1 | `photoIn(t, f, s)` sobre `photo(root, '../assets/…', x, y, w, h)`. Mientras no tengas metraje usa `slot()` («TU CLIP AQUÍ»), que se anima igual |
| **Cifra grande** | número en Display 130–190 px (16:9) en acento, con la unidad al lado | `box(root, 'display', …)` con `enter({ dy: 30, s0: 0.9 })` + `lit` en la palabra de la cifra. Sin contador rodante salvo que la clase lo justifique |
| **Tablas y fichas** | filas clave → valor; la clave en acento y el valor en tinta, que se oscurece en su palabra | `kv(root, y, clave, valor, h)` con el valor como segmentos |
| **Listas numeradas** | filas de 150–210 px con número en círculo de acento | `rowCard(root, y, num(i + 1, 64), título, sub, h)` |
| **Tarjeta con icono** | icono circular, título Display y sub UI | `icard(root, x, y, w, h, ICONS.X, color, título, sub, tamaño)`. Iconos: `CHECK`, `CROSS`, `PLUS`, `WARN`, `INFO`, `CLOCK`, `STAR`, `BOLT`, `PLAY`, `CAL` |
| **Cambio dentro de la hoja** | dos estados de una misma escena (portada → objetivo, sub-páginas) | `swap(t, grupoA, grupoB, s)`: A sale a −W·1,05 mientras B entra desde +W·1,05. `page()` / `pageIn()` para sub-páginas sueltas. Nunca crossfade |

**Escenas listas:** `titlePage()`, `section()`, `summary()`, `closing()` y `progress()` (barra de progreso de 8 px abajo). Cubren el 90 % de una clase; lo específico va en los `build`/`run` de cada sección.

**Presets:** `heavy` para hojas, títulos, fotos y cámara; `POP`/`default` para tarjetas y paneles; `snappy` para chips, encendidos (`lit`/`dark`), pulsos, golpes de figura y estados. Todo lo que coincide con un SFX o una palabra usa `spHit` (vía `hit()`); el empuje de hoja ya va adelantado con `rel()`.

## Tipografía
- **Display: Manrope 800** (`fonts/Manrope-var.woff2`) en títulos, títulos de tarjeta, números y cifras.
  - Interletra −0,035em en títulos grandes y −0,02em en tarjetas.
  - Título de portada: 100–112 px (16:9) / 92–100 px (9:16) en dos líneas; la 2.ª cierra con punto.
  - Título de sección: 76–84 px. «Al terminar, vas a:» a 76–84 px.
  - Títulos de tarjeta: 37–60 px. Citas destacadas: 64–84 px. Cifras: 130–190 px.
- **UI: Inter 400–800** (`fonts/Inter-var.woff2`) en subtextos (600, 30–38 px, `--ink-2`), chips (600–700, 30–42 px), rótulos de tabla (700, 28 px, `--ink-3`), eyebrow y etiquetas de figura.
- **Alineación:** todo a la izquierda en `PAD` (140 px en 16:9, 80 px en 9:16). Ancho útil `CW`: 1640 px (16:9) / 860 px (9:16).
- **Rejillas 16:9:** 3 columnas de 520 px con paso de 562 · 2 columnas de 800 px con paso de 840 · figura a la izquierda (x 140, 520–620 px) con tarjetas a la derecha (x 740–840, 940–1040 px) · figura de portada a la derecha en x ≈ 1080, de 660–700 × 700–800.
- **Posiciones verticales 16:9:** eyebrow en y = 128, título en y ≈ 200, contenido entre y 300 y 1000.
- **Acento:** solo la palabra clave o la 2.ª frase (`acc` en `section`/`titlePage`). En las citas, el fragmento clave va en `<span style="color:var(--accent)">`. Un solo eyebrow por sección: número en pastilla + nombre de la sección.
- **Mayúsculas:** frase normal, nunca todo en mayúsculas (la única excepción son los marcadores de plantilla «TU CLIP AQUÍ» / «TU LOGO», que se reemplazan). Comillas angulares «» y punto final en los títulos de portada.
- **Mínimo legible: 28 px**, incluido el texto de canvas (`tag()` ya usa 28 px). Si un dato no cabe a 28 px, la sección se parte en `1/2` y `2/2`; nunca se encoge la letra.

## Color
Tokens en `film/index.html` (`:root`). La paleta de plantilla es neutra y se cambia entera por la de tu marca manteniendo los **roles**:

| Rol | Token | Plantilla | Uso |
|---|---|---|---|
| Fondo | `--bg` | `#fbfaf6` | papel, siempre claro; halo radial de `--tint-100` arriba a la derecha |
| Tinta | `--ink` | `#1f2a24` | títulos y valores |
| Tinta 2 | `--ink-2` | `#55605a` | subtextos |
| Tinta 3 | `--ink-3` | `#7d8781` | rótulos y texto «dormido» |
| Acento único | `--accent` | `#0f7c74` | números en círculo, claves de tabla, cifras, chips `solid`, anillos y zonas en figuras, palabra de acento |
| Tintes | `--tint-50/100/200` | `#f3f8f6` · `#e3f1ee` · `#c6e3dc` | fondos de figura, rieles, chips, barra de resumen, estados vacíos |
| Tarjeta | `--card` / `--on-accent` | `#fffdf9` | superficies (sombra teñida del acento) y texto sobre acento |
| Error | `--bad` | `#c8402f` | **solo** dentro de iconos ✕ |
| Aviso | `--warn` | `#b7791f` | **solo** en insignias de alerta |

- Nunca hay cabeceras de color ni hojas oscuras. La tarjeta destacada lleva `card top` (borde superior de 4 px de acento).
- El «sí» va en acento; un verde semántico solo si el brief lo pide.
- **Datos de varias partes:** se traducen a una rampa tonal del acento (`ramp(n)` en canvas), nunca a colores distintos.
- **Colores propios de una figura** (materiales, tejidos, productos) solo viven dentro de la figura, nunca en tipografía ni en UI.
- **Por escena el color no cambia;** cambia el estado: dormido (32 %) → encendido (100 %).

## Subtítulos
- Por defecto, **sin subtítulos quemados** en 16:9 (`captions.formats: []`): la tipografía de pantalla ya refuerza cada palabra clave y los reproductores de cursos traen los suyos.
- Si el brief los pide (habitual en 9:16 para redes): preset `pill-sobrio` en y = 0,72, `maxChars` 34, sin color de acento. En 16:9 deja libre la franja 860–1000 px; en 9:16 termina el contenido por encima de y ≈ 1300 para que la píldora no tape tarjetas.

## Transiciones
| Transición | Timing | Uso |
|---|---|---|
| Hoja empujada derecha → izquierda | marca en el downbeat; el resorte `heavy` sale 0,33 s antes y el pico cae sobre el whoosh. Entrante y saliente se mueven la misma distancia (W·1,05) | entre todas las secciones |
| Cambio interno de grupo | `swap(t, A, B, wx('s1', 'Al') − 0.45)` | portada → objetivo; sub-páginas dentro de una sección |
| Colapso de ítem | `enter(…, { out: s })`: sube 50 px, se encoge 6 % y desaparece a q > 0,35 | reemplazar una tarjeta dentro de la misma hoja |
| Corte duro | solo hacia el cierre, si la hoja de puntos clave ya terminó | — |

Prohibido: crossfade, iris, glitch, giros, fundidos de entrada y salida. Ninguna hoja entra hasta que la anterior haya salido (`hide` a q > 0,995).

## Sonido y música
- **Música:** pista original por proyecto, suave y de pulso claro (piano, pads o plucks limpios), sin voces. Debe dar `distinct` en `compare_music.py` contra tus videos anteriores.
- **Energía:** constante y baja; se abre un poco en la portada y en el cierre.
- **Mezcla** (`timeline.json`): `music -11`, `sfx -8`, `vo 0`, `duck: true`. Master en −14 LUFS integrados y ≤ −1 dBTP (`mix.py`).
- **SFX** (8–13 por clase larga, todos declarados en `timeline.json`):
  - un **whoosh suave** en cada empuje de hoja;
  - un **thump** corto en el cierre;
  - opcional: un tick discreto al encenderse la cifra principal.
  - Nada de SFX en cada tarjeta: los encendidos son silenciosos.

## Voz en off
- **Voz:** institucional («el curso», «el equipo»), no de una persona concreta. Español latino neutro, didáctico, en segunda persona («vas a», «evita»), frases cortas.
- **Archivos:** una frase o archivo por sección (`s1…sN` en `vo.json`). `vo.py` → `words.py` → `sync.mjs` dejan los tiempos por palabra en `window.VO`; `HOJAS.words()` los agrupa por sección.
- **Colocación:** cada sección arranca en su marca (downbeat). Dentro, la voz corre natural; nunca se acelera una toma: si sobra tiempo, la marca siguiente se mueve al compás posterior.
- **Anclajes:** título en la **primera palabra** de la sección; cada ítem con `wt('sN', 'prefijo')`; `'a|b'` para variantes («dos|2»); `wx()` para coincidencia exacta; `wk()` para «k palabras después». Adelanto de encendido −0,15 a −0,25 s; de figura −0,2 a −0,3 s.
- **Sin voz todavía** (animatic, demo, maqueta): `window.WORDS = { s1: HOJAS.script(t0, 'texto…', 0.17), … }`. Al llegar la VO real se borra ese bloque y los anclajes no cambian.
- **Coherencia:** la VO y la pantalla dicen lo mismo, con los mismos términos y cifras que tu fuente. Si la fuente no da cifras, no se inventan.

## Formatos
- **16:9 (1920×1080):** el formato de las clases largas. Prueba de legibilidad: reducido a un celular horizontal de 640 px de ancho debe seguir leyéndose (mínimo 28 px; títulos de tarjeta ≥ 37 px). Margen de 140 px a los lados y ≥ 100 px arriba y abajo.
- **9:16 (1080×1920):** cápsulas cortas. Respeta las zonas de interfaz: 14 % arriba (eyebrow en y = 290), 20 % abajo (contenido hasta y ≈ 1520) y 12 % a la derecha (ancho útil 860). Una columna: figura o clip arriba y tarjetas apiladas debajo; títulos largos en dos líneas. Las hojas siguen empujando de derecha a izquierda. Todos los helpers re-bloquean con `pick()`.
- **1:1 / 4:5:** figura arriba a todo el ancho (~420 px de alto), tarjetas en una columna debajo, títulos a 72 px.

## Reglas recurrentes y prohibiciones
- Todo animado: sin grabaciones de personas salvo que el brief traiga clips propios; las figuras o retratos generados se indican en un comentario.
- Sin precios en pantalla salvo que el brief los exija. Sin logos ni sellos ajenos.
- Cada sección es una hoja empujada; la página aterriza completa y atenuada, y cada ítem se enciende en su palabra.
- Un solo eyebrow por sección, con numeración `01, 02…` continua.
- Fondo claro siempre. Un solo acento. Error solo en ✕, aviso solo en alertas.
- Las figuras que muestran mejoría enseñan «menos / más fino», nunca una desaparición mágica. Un «después» de plantilla se marca como plantilla.
- Las clases de un mismo módulo comparten figuras y paleta; un proyecto nuevo parte del anterior del módulo y lo indica en la cabecera de `film.js`.
- Determinismo: nada de `Math.random` (usa `C.mulberry32(n)`); cada `draw*` limpia el canvas y llama `reset(g)`; nada de `will-change` ni 3D; `enter`/`lit` en cada frame en que el elemento está registrado.
- El productor decide con la opción recomendada; no se le hacen preguntas de estilo al cliente.

## Qué revisa el crítico
1. **Frame 0:** se lee el título (o su primera palabra) y el eyebrow con el número de clase. Nunca un cuadro vacío.
2. **Cada empuje de hoja:** empieza en un downbeat; su pico coincide con el whoosh (±2 frames); nunca hay dos hojas parcialmente visibles más de lo que dura el empuje; no hay crossfade.
3. **Encendidos:** 0,1 s después de cada palabra ancla, el ítem está al 100 %; en el frame anterior al adelanto, sigue al 32 %.
4. **Pausas:** ningún tramo de más de 4 s sin un cambio visible. Mídelo en la hoja de contactos.
5. **Micro push:** en cada hoja, la escala entre el primer y el último frame difiere 1,2–2,5 %.
6. **Tipografía:** nada por debajo de 28 px; todo alineado en `PAD`; frase normal; acento solo en la palabra clave; un único eyebrow por hoja.
7. **Color:** un solo acento; error solo en ✕ y aviso solo en alertas; colores de figura solo dentro de las figuras; sin hojas oscuras ni cabeceras de color.
8. **Figuras:** se dibujan en sincronía con la VO; etiquetas de canvas ≥ 28 px; mejorías mostradas con honestidad.
9. **Contenido:** términos y conteos idénticos a la fuente; sin cifras inventadas; numeración continua; «· 1/2 / 2/2» donde corresponde; ningún marcador de plantilla («TU CLIP AQUÍ», «TU LOGO») en la versión final.
10. **Cierre:** muestra lo que sigue y el módulo, está vivo (empuje y pulso) y dura ≤ 2 s útiles, con el thump en el beat.
11. **9:16:** nada clave en el 14 % superior, el 20 % inferior ni el 12 % derecho.
12. **Audio:** −14 LUFS ±0,5 y ≤ −1 dBTP; la música se agacha bajo la VO; cada SFX declarado en `timeline.json`.
13. **Determinismo:** `node scripts/render.mjs --verify --all` pasa limpio; `lint.mjs` limpio.
14. **Rondas:** puntuación ≥ 8 en todo, con al menos 2 rondas, juzgando el MP4 renderizado y su hoja de contactos.

## Cómo usar la demo
1. Copia `demo/index.html` y `demo/film.js` a `film/` del proyecto (`film/index.html`, `film/film.js`) y `demo/timeline.json` a la raíz (`timeline.json`).
2. Copia `helpers/hojas.js` a `film/hojas.js` (el `<script src="hojas.js">` ya va en `demo/index.html` antes de `film.js`) y `fonts/*.woff2` a `assets/fonts/`.
3. Ejecuta: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (cambia a `--fmt 16x9` para la versión horizontal).

## Si buscas otra cosa
- ¿Explicar un servicio o un cuidado en un reel premium, sin estructura de clase? → `tarjeta-escenario`.
- ¿Enseñar una app, plataforma o curso por dentro (pantallas, cursor, reproductor)? → `producto-por-dentro`.
- ¿Presentar un método o programa en pasos, del caos al orden? → `metodo-armado`.

## Cómo adaptarlo a tu marca
1. **Arranca desde la demo:** sigue «Cómo usar la demo» y parte de esa copia.
2. **Paleta:** cambia solo los tokens de `:root` respetando los roles de la tabla de color (fondo claro, tinta oscura, un acento con contraste ≥ 4,5:1 sobre la tarjeta, tintes del mismo tono que el acento). Las figuras de canvas leen los tokens con `tok()`, así que cambian solas.
3. **Tipografías:** reemplaza `Manrope` (Display) y `Inter` (UI) por las de tu marca en las `@font-face` y en `C.fonts`. Mantén un peso 800 para Display y revisa que los títulos sigan entrando en el ancho útil.
4. **Logo:** en `closing({ logo: (root) => … })` devuelve tu logo (`<img>` registrado con `C.reg`) en lugar del marcador «TU LOGO».
5. **Metraje:** cambia cada `slot()` por `photo(root, '../assets/…', …)` o por una secuencia con `C.drawSeq`; conserva `photoIn()` para la entrada. Cada clip debe mostrar exactamente lo que dice su tarjeta.
6. **Contenido:** escribe `vo.json` con una frase por sección (`s1…sN`), genera la voz y las palabras, borra el bloque `window.WORDS` de ejemplo y reajusta las marcas al downbeat anterior a cada sección.
