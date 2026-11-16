# Precisión nocturna

## Esencia
- Se siente como estar dentro de la máquina: una sala técnica a oscuras, líneas finas de escáner que se dibujan solas y un solo color de señal que marca lo importante.
- Para reels de equipos, tecnología y procesos de precisión (una máquina, un instrumento de medición, una línea de producción, un laboratorio, un software técnico B2B) de 30 a 75 s, 9:16 primero, con voz en off calmada que lee afirmaciones literales y verificables.
- Reconocible por: titulares Display 700 enormes apilados a la izquierda que suben por máscara en la palabra exacta de la VO; el producto (recorte oficial) que avanza rodando, frena y se balancea; esquemas de línea fina de 3–6 px que explican el mecanismo; interfaz real que se arma por paneles (esqueleto → pieza); pastillas que crecen; tarjeta final viva con CTA de acento que late en cada beat.
- La energía no viene del montaje (5–6 cortes en 30 s) sino de la transformación continua del cuadro: algo se dibuja, avanza rodando, se arma o se funde en cada beat.

La carpeta trae una demo original (`demo/`) de 13,5 s, el caso «presentar un equipo de precisión que escanea y mide punto por punto», con todos los movimientos firma en marcadores dibujados, y `helpers/precision.js` (`window.PN`) con las piezas reutilizables.

## Cómo usar la demo
1. Copia `demo/index.html` y `demo/film.js` a `film/` (reemplazan los del proyecto) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/precision.js` a `film/precision.js` (el `<script src="precision.js">` ya va antes de `film.js` en `demo/index.html`; si usas tu propio `index.html`, agrégalo en ese orden) y `fonts/*.woff2` a `assets/fonts/`.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (el borrador queda en `renders/draft_9x16.mp4`).

## Estructura y ritmo
BPM típico: **124** (enérgico, 30 s ≈ 63 beats; beat 0,484 s, compás 1,935 s) o **92** (pausado, 60–75 s, cuando hay testimonio, más texto o más datos). Los downbeats salen de `beats.json` (fase medida); nunca escribas segundos fijos.

Plantilla a 124 BPM (≈ 63 beats):

| Acto | Beats | Qué pasa |
|---|---|---|
| 1 Hook | 0–9 | Pregunta o promesa de 3 renglones que sube en b0 (ya visible en el frame 0: entra en −0.4), b2 y b4. Debajo, esquema en línea fina (piso + objeto) y el producto que se arrastra desde el frame 0, acelera hacia b5 y frena hacia b8 con un anillo que se traza (pop). |
| 2 Producto | 9–25 | Corte duro a campo claro. El recorte grande entra rodando, nombre del producto (b9.5), palabra clave con punto de acento (b14). Sin cortar, la escena se transforma en plano o corredor y la cámara empuja hacia el destino (≈ 3–4 beats). Segunda afirmación con su frase clave en acento. |
| 3 Detalle | 25–29 | Corte a la foto oficial en primer plano (fondo blanco, color original), micro push ≤ 1.12, anillo sobre la pieza que importa, pastilla persistente arriba. |
| 4 Por dentro | 29–41 | Esquema de corte transversal a pantalla completa. Tres pares de titulares (≈ b32, b36, b39), un medidor que aparece y cae, ráfagas de puntos sembrados cada 1/4 de beat que se funden en una línea limpia. |
| 5 Interfaz | 41–53 | Corte a la pantalla real que se arma en 5–6 paneles, uno cada 0,5 beat; pastilla de afirmación; línea punteada que se dibuja; un solo barrido de escaneo de 1,5–2 beats. Corte opcional a una segunda pantalla con 3 áreas, cada una con su titular y un recuadro que se cierra 1.08→1. La línea legal aparece aquí y se queda. |
| 6 Tarjeta final | 53–fin | En el golpe final de la música: wordmark (heavy), logos (+0.5 y +1 beat), pregunta, pastilla CTA de acento, handle que se tipea. Último elemento nuevo ≤ 2 s antes del final; la pastilla late en cada beat. |

Versión corta (la demo, 28 beats a 124 BPM): hook b0–8 · producto b8–12 · por dentro b12–20 · interfaz b20–24 · tarjeta final b24–28.

A 92 BPM (formato largo): hook con número gigante, testimonio o footage con tarjetas de nombre, 3–5 escenas de dato y cierre con logos.

### Reglas de pacing
- Cortes duros solo en líneas de compás (ej. 8, 12, 20, 24 o 9, 25, 29, 41, 45, 53 según la fase medida). Entre cortes, la escena se transforma (push, morph de plano, ensamblaje).
- Algo nuevo cada 1–2 beats (≈ 1 s); nunca más de un compás sin elemento nuevo.
- Eventos internos en beats, medios o cuartos de beat. El texto que debe leerse en su palabra entra en el beat de esa palabra de la VO, con 0.1–0.12 beat de adelanto.
- Todo hold lleva micro push: `PN.micro(t, b0, b1, 0.04–0.06)`; en un primer plano de producto hasta 0.12 si la resolución de la foto lo permite.

## Sistema de layout (9:16, 1080×1920)
- Margen izquierdo `PN.PAD` = 120 px. Toda la tipografía alineada a la izquierda; si un renglón no cabe en 840 px, baja el tamaño 4–8 px (no el margen).
- Bloque de titulares en el tercio superior: y ≈ 290–600. Pastilla bajo el bloque (y ≈ 600–800).
- Visual principal en la mitad inferior: y ≈ 700–1500. El piso de los esquemas vive en y ≈ 1480.
- Línea legal en y ≈ 1462. Nada clave en el 14 % superior (< 269 px), el 20 % inferior (> 1536 px) ni el 12 % derecho (> 950 px): el producto puede invadir la derecha, el texto no.
- 1:1 (1080×1080): titulares y = 140–380 en 88–100 px, visual reducido a 0.7 y anclado abajo a la derecha, un titular por pantalla en vez de pares.
- 16:9 (1920×1080): columna de texto a la izquierda (x 120–860, 96–112 px), visual en la mitad derecha a escala completa; el producto avanza rodando en horizontal con ~60 % más recorrido; la interfaz al 85 % de la altura útil.
- Re-bloquea por formato con `C.pick(ancho, cuadrado, alto)`; escala la cámara, no la fuente.

## Tipografía
- **Display:** Reddit Sans 700 (`fonts/RedditSans-700.woff2`), tracking −0.02em, interlineado 0.95, sentence case, puntuación española completa (¿? ¡!).
- **UI:** Inter 400 (rótulos de esquema, legal, subs) e Inter 600 (pastillas, etiquetas de dato en mayúsculas con 0.12em, handle).
- Tamaños 9:16: hook 112–128 px; titulares de escena 100–112 px; números gigantes 210–300 px; pastillas 44–54 px (CTA 70); handle 60 px; rótulos de esquema 38–40 px; legal 32 px (mínimo 28; lo que deba leerse, ≥ 36).
- Interlineado de las pilas: 125–146 px (`PN.stack(..., { lh })`). Segundo renglón de un par a +0.25 beat.
- El `.line` lleva padding superior de 0.26em: protege tildes y signos de apertura.

## Color
| Token | Hex | Rol |
|---|---|---|
| `--bg` | #0c0e1c | Noche índigo: fondo de casi todas las escenas ("dentro de la máquina") |
| `--ink` | #f5f1ea | Titulares y texto principal sobre oscuro |
| `--ink-2` | #a6a3b8 | Rótulos secundarios, legal, fuentes |
| `--accent` | #ff6b2c | Señal naranja: el ÚNICO acento de texto + pastilla CTA + caret + punto de pastillas |
| `--line` | #86efac | Línea técnica menta: esquemas, anillos, recuadros, barrido, medidor. Solo gráfico, nunca texto |
| `--graphite` | #4a4860 | Cabezales, esqueletos, divisores, esquemas sobre claro |
| `--light` | #ecebe4 | Campo claro de la escena del producto; tinta `--dark` |

Tokens auxiliares en `demo/index.html`: `--card` #171a2c (paneles y pastillas sobre oscuro), `--track` #22253a (pista del medidor, pastilla secundaria), `--dark` = `--bg`.

- Los campos cambian en cortes de compás: noche (hook) → claro (producto) → blanco (foto oficial de estudio) → noche (por dentro, interfaz, final). El cambio de campo ES el corte.
- Fotos oficiales con fondo blanco van sobre campo claro o blanco, nunca recortadas a la fuerza sobre la noche. Color original, sin LUT.
- Footage: color original; oscurécelo solo con la banda `PN.shade()` o con blur + brightness 0.32 en el cierre.

## Vocabulario de movimiento
| Movimiento | Cómo se ve | Cómo construirlo |
|---|---|---|
| Pila de titulares | 2–3 renglones Display 700 a la izquierda; cada uno sube por máscara en su beat; la frase clave en acento | `PN.stack(root, rows, {y, size, lh, accent: {fila: [palabras]}})` + `PN.riseStack(t, L, [b1, b2, b3], outB, PN.SN)`. Heavy por defecto; `PN.SN` (snappy) para lo que cae en una palabra de VO. Salida: `outB` = siguiente entrada − 0.2. |
| Punto de acento | Solo el signo final de la palabra clave en acento | `PN.accentDot(line)` (agrega el punto si falta). |
| Producto que avanza rodando | Entra desde la izquierda, las ruedecillas giran con el recorrido, frena y se balancea con oscilación amortiguada, sombra elíptica | Recorte real: `PN.drawCutout(g, img, x, y, w, {w, h, wheels: [[cx, cy, r]]}, rot, lean)`. Marcador: `PN.drawRoller(g, x, yPiso, {w, h, color, rot, lean, shadow})`. Recorrido: `PN.travel(t, {x0, creep: [b0, b1, px], pushes: [[beat, px, 'heavy']]})`; `rot = recorrido / radio`; `lean = PN.brakeLean(t, beatFreno, 0.012)`. Si no avanza rodando, usa el mismo patrón para deslizar y asentar. |
| Esquema en línea fina | Piso, objeto, cámaras, cortes transversales en línea técnica 3–6 px sobre noche, o grafito sobre claro | Canvas (`C.canvas`), `PN.floorLine(g, y, color)`, `PN.arcBand(g, {cy, R0, R1, color})` con `PN.yAt(cx, cy, R, x)`; relleno al 7–8 %. En la demo la banda es una placa de material casi plana (radio muy grande); dale la forma de la pieza real de TU equipo. Dibujo progresivo con `seg()` o `sp(t, b, 'default')`. |
| Anillo de señalamiento | Círculo que se traza 0→360° sobre la pieza que importa | Canvas: `PN.ringArc(g, x, y, r, PN.pop(t, b), color)`. Sobre foto: `PN.ringDiv()` + `PN.runRingDiv()`. Suena (pop). |
| Morph de plano + push | La vista lateral se vuelve plano o corredor y la cámara empuja hacia el destino, sin corte | `toPlan = sp(t, b, 'default')`, cámara `K = 1 + 0.38 * ease.inOut(seg(t, b0, b1))` alrededor de un punto focal; `lerp` de tamaño y posición del producto entre vistas. |
| Ráfagas de puntos → línea | Puntos sembrados aparecen en 10 ráfagas, una por cuarto de beat, y luego se funden en una línea limpia | `S.jit = PN.jitter(seed, n)` en build; `PN.bursts(g, t, {n, x0, x1, y, start, bursts: 10, every: 0.25, mergeB, jit, dot, ink})`. Cada ráfaga = un tick en `timeline.sfx` (`every: 0.25`). |
| Medidor que cae | Pista grafito con relleno de línea técnica que aparece y cae a ~12 % (sin número) | `PN.meter(root, {y, label})` + `PN.runMeter(t, M, beat, 0.12)`. |
| Interfaz que se arma | Base gris, esqueletos oscuros por panel; cada pieza real aparece 0.9→1 cada 0,5 beat; la base sube 120 px | `PN.assemble(parent, {x, y, w, h, pieces: [{x, y, w, h, beat, make}]})` + `PN.runAssemble(t, A, b0)`. En un video real cada `make` pone el recorte de captura real; nunca redibujes una interfaz que existe. |
| Barrido de escaneo único | Línea de 5 px que cruza un panel una sola vez | `PN.scanLine(base, {x, y, h})` + `PN.runScan(t, s, beat, recorridoPx, 1.5–2)`. Nunca en bucle (no sugiere "en vivo"). |
| Recuadro de área | Borde de 6 px que se cierra 1.08→1 sobre una zona, con su titular | `PN.areaBox(parent, {x, y, w, h})` + `PN.runArea(t, box, beat)`. |
| Pastilla que crece | Pastilla UI 600 con punto de acento (o de línea técnica para la secundaria), crece desde la izquierda | `PN.pill(parent, texto, {x, y, size, bg, color, dot})` + `PN.growPill(t, p, beat)`. |
| Número gigante | Etiqueta en mayúsculas, valor Display 210–300 px, regla 160×4 que se extiende, sub 72 px, nota 32 px | `PN.bigNumber(root, {label, value, size, subs, note, count})` + `PN.runBigNumber(t, N, b0)`: etiqueta b0−0.1, valor b0, regla b0+0.35, subs b0+0.4 (+0.15 c/u), nota b0+0.8; `count` cuenta hasta el valor. |
| Footage con banda | B-roll a pantalla completa con banda oscura inferior que tapa texto quemado y aloja la tipografía | `PN.broll(g, seq, t, t0, {z, pos, fps})` + `PN.shade(root, 0.4)` (usa `--bg`). Zoom 1.45→1.52 y deriva lateral ±0.04. |
| Tarjeta de dato / nombre | Panel oscuro con barra izquierda de acento que se revela por clip izquierda→derecha | `PN.tagCard(root, {y, eyebrow, lines})` + `PN.runTag(t, T, inB, outB)`. |
| Handle que se tipea | "DM @tumarca" letra a letra con caret de acento que parpadea cada medio beat | `PN.handle(root, {x, y})` + `PN.runHandle(t, H, texto, b0, b1)`. El primer carácter cae sobre el click. |
| CTA vivo | Pastilla de acento crece en su cue y luego late 1.07→1 en cada beat | `PN.ctaPulse(t, pill, beat)`. |
| Logos | Wordmark sube con el golpe final (heavy), logos suben 30 px (snappy), divisor grafito crece en vertical | `PN.pop(t, 'end', 'heavy')`, `PN.pop(t, 'logoA')`, `put(divisor, {sy: k})`. Placa del producto atenuada (opacidad 0.3 o `brightness(.3)`) con micro push 0.06, abajo a la derecha, nunca bajo el CTA. |

Básicos de `PN`: `pop` (todo lo que suena), `on`, `micro`, `outC`, `SN`, `tok`, `hexA`.

## Subtítulos
Preset `pill-sobrio`, quemados solo en 9:16: size 50, maxChars 30, y = 0.745 (banda inferior por encima del 20 % de UI de plataforma). Bájalos a 0.775 con `yAt` en tramos donde el visual ocupa esa zona. Agrega a `skip` toda línea de VO que ya está en pantalla como titular (hook, nombre en pastilla, línea final con CTA): nunca dupliques texto. Sin color de acento ni karaoke: los subtítulos no compiten con el titular.

## Transiciones
| Transición | Timing |
|---|---|
| Corte duro + cambio de campo de color | En línea de compás |
| Push de cámara hacia el destino | 3–4 beats, `ease.inOut(seg())`, K hasta 1.38, sin corte |
| Morph de vista (lateral → plano) | `sp default` 1–2 beats; el producto hace `lerp` entre posiciones |
| Push-through a corte transversal | Entra en la línea de compás; el esquema sube 140 px con `sp(t, b − 0.3, 'default')` |
| Panel que sube (tarjeta, pantalla) | 120–140 px, `sp default` arrancando 0.1 beat antes del compás |
| Swap de titulares | Sale por máscara en (siguiente entrada − 0.2), entra en el beat de la palabra |
| Bloque que se levanta | Contenedor y −70 px con `sp snappy` 0.6 beat antes del siguiente bloque |
| Golpe del wordmark | En el golpe final de la música, heavy |

Prohibido: crossfades, giros, glitches, light leaks, rebote en UI, zoom más allá de los píxeles de la fuente (si pixela, corta antes).

## Sonido, música y voz
- **Música:** electrónica minimal de precisión (pulso limpio, bajo contenido, sin suspenso ni épica). 124 BPM en tonalidad menor para 30 s; 92 BPM más bajo y cálido para formatos largos. Pista original por proyecto (generada o archivo provisto) y `compare_music.py` = distinct. Groove desde b0; el golpe final cae exactamente en el wordmark; el CTA suena sobre la cola.
- **SFX** (declarados en `timeline.json` `sfx`, todos en el grid; 18–34 por reel): pop limpio en cada renglón del hook, anillos, recuadros y pastillas; whoosh suave en el arranque del producto y en el push-through; thump grave en nombre y wordmark; shutter en cortes duros a foto o pantalla; click en pastillas, paneles y primer carácter del handle; tick en cada ráfaga de puntos (cuartos de beat).
- **Mezcla** con `mix.py`: −14 LUFS, TP ≤ −1 dBTP, duck bajo la VO. Pista masterizada: music 0, sfx −3, vo 0. Pista generada más presente: music −9, sfx −8, vo 0.
- **Voz en off:** calmada, técnica, cercana; acento latino neutro; nunca vendedora ni de tráiler. Solo afirmaciones literales y cortas de la fuente oficial (≈ 6 líneas en 30 s). Cortada en frases, cada frase colocada en un beat; tempo de toma 1.0–1.1 como máximo, nunca acelerar la toma entera. Pausa ≥ 1 beat antes del CTA. Los titulares suben en el tiempo de palabra de la VO con −0.1 beat de adelanto. Siglas y nombres extranjeros se escriben fonéticamente en el texto TTS y se validan en la escucha.

## Reglas recurrentes y prohibiciones
- Solo afirmaciones textuales de la fuente oficial; ningún número inventado; nada de cifras de otros modelos o productos hermanos. Anota la fuente de cada afirmación en el shotlist.
- Sin comparaciones con competidores, sin promesas de resultados, sin clientes o usuarios ficticios, sin imágenes generadas que imiten el producto. El producto se muestra con fotos oficiales y recortes reales.
- Formulación conservadora: si la fuente no dice "en vivo" o "continuo", el visual tampoco lo sugiere (barrido único, nada en bucle).
- Enfoque en el producto protagonista; no muestres equipos complementarios que el brief excluya.
- Línea legal o regulatoria en pantalla (UI 400, 32 px, `--ink-2`, `data-lint="ui"`) desde la escena de interfaz hasta el final cuando el rubro lo exige.
- CTA por mensaje directo con handle tipeado; la redacción del CTA es la del brief vigente (confírmala antes de renderizar).
- Logos de la marca (y un segundo logo, si aplica) en la tarjeta final, con divisor grafito.
- Un solo acento; la línea técnica solo gráfica; sin glow, sin degradados de fondo, sin bordes de cuadro, sin etiquetas de esquina.
- Nunca un fundido como entrada o salida: opacidad siempre con `PN.on(k)`. Todo lo que suena usa `spHit` / `PN.pop`.
- Nada de `Math.random`: jitter con `PN.jitter` / `mulberry32` creado en `build()`. Sin CSS 3D; profundidad con sombras y escala 2D.

## Qué revisa el crítico
- Frame 0: el primer renglón del hook ya se lee y el producto o esquema ya está en cuadro.
- Cada corte duro cae en una línea de compás medida; ningún crossfade.
- Ningún tramo de más de un compás sin elemento nuevo; holds con micro push visible.
- Cada titular entra en el beat de su palabra de VO (±1 frame del `spHit` adelantado) y sale por máscara antes de que entre el siguiente (≤ 1 frame de solape, ≥ 95 % fuera).
- Ningún glifo asoma por el borde de la máscara en el primer frame; tildes y ¿ completos.
- Acento solo en una frase clave por escena, el punto de acento y el CTA; la línea técnica nunca en texto.
- Texto a x ≥ 120, ≥ 28 px, legible en la prueba de 360 px; nada en las zonas de UI de 9:16.
- Las ruedecillas giran coherentes con el desplazamiento; el balanceo al frenar se amortigua sin rebote.
- Interfaz real (recortes), nunca redibujada; los esqueletos desaparecen cuando llega su pieza.
- Ráfagas de puntos y ticks coinciden cuadro a cuadro.
- Subtítulos que no duplican titulares (`skip` correcto) ni tapan el visual (`yAt`).
- Línea legal presente y legible hasta el final (si aplica).
- Tarjeta final: wordmark en el golpe final, último elemento nuevo ≤ 2 s antes del fin, CTA que late en cada beat, caret que parpadea, placa que no tapa el CTA.
- Mezcla −14 LUFS / TP ≤ −1; `render.mjs --verify --all` determinista; puntaje ≥ 8 en todas las categorías tras ≥ 2 rondas.

## Cómo adaptarlo a tu marca
1. **Paleta:** cambia los tokens de `:root` en `film/index.html`. Conserva los roles: un fondo oscuro profundo (`--bg`), una tinta clara cálida (`--ink`), una secundaria apagada (`--ink-2`), UN acento saturado para texto clave y CTA (`--accent`) y una línea técnica de otro tono, solo para gráficos (`--line`). El acento y la línea deben distinguirse a simple vista. Los helpers leen los tokens; no hace falta tocarlos.
2. **Fuentes:** reemplaza los `@font-face` por la Display y la UI de tu marca (archivos reales en `assets/fonts/`). Mantén una sola Display pesada y una sola UI; ajusta `C.fonts` en `film.js`.
3. **Producto:** cambia `PN.drawRoller` por `PN.drawCutout` con el recorte oficial de tu producto (PNG con transparencia) y mide en la imagen fuente el centro y el radio de cada avanza rodando. Si tu producto no avanza rodando (una app, un servicio, un curso), usa el mismo patrón para deslizarlo y asentarlo, o convierte el acto 2 en una pantalla que sube.
4. **Interfaz y footage:** reemplaza cada pieza `make()` y cada «TU CLIP AQUÍ» por recortes reales de capturas (3x) o secuencias de frames de tus clips (`seq.py` + `PN.broll`).
5. **Esquema:** dibuja en línea fina el mecanismo de TU producto (cómo funciona por dentro); el corte transversal y las ráfagas de la demo son solo un ejemplo.
6. **Logos y cierre:** pon tu wordmark real en lugar de «Tu marca», tus logos en lugar de «TU LOGO / SEGUNDO LOGO», tu handle real y el texto legal que exija tu rubro.
7. **Copy:** escribe los titulares desde las afirmaciones literales de tu fuente oficial, en sentence case y con puntuación completa; una frase en acento por escena.

## Si buscas otra cosa
- ¿Fondo claro y un tono más cálido para explicar un servicio o un cuidado? Usa **Tarjeta escenario**.
- ¿Mostrar una app o plataforma por dentro con cursor y contadores? Usa **Producto por dentro**.
- ¿Una prueba visual, un antes/después o un dato clave con anillo y zoom? Usa **Paneles UI**.
