# Ilustrado sereno

## Esencia
- Motion design calmo y amable: un fondo profundo y constante, tipografía clara y enorme alineada a la izquierda y un personaje ilustrado plano (vector dibujado en canvas en cada frame) que actúa la situación de quien mira: duda, alivio, solución y llamada a la acción.
- Pensado para pantallas que casi siempre se ven sin sonido y a distancia (salas de espera, pantallas informativas, vitrinas, TV de un local) y para reels en 9:16. Se entiende al 100 % sin audio, porque el texto en pantalla ES el guion y la voz en off lo dice palabra por palabra.
- Su caso natural es la pantalla informativa: dar la bienvenida, orientar a quien espera su turno, explicar un trámite o un cuidado con calma y recordar a quién preguntar. Sirve para un consultorio, un estudio de bienestar, una oficina de atención, una escuela o cualquier lugar donde la gente espera.
- Lo reconocible:
  1. Un **disco de color** detrás del personaje: el torso se recorta redondo y la cabeza y los brazos rompen el borde.
  2. Un **push-in heavy** hacia la cara en el momento de la solución, y luego una deriva lenta hacia el detalle que abre la escena siguiente.
  3. Un **primer plano con luz suave**: un badge de luz, un haz que baja, anillos que barren y un detalle que pasa de borroso a nítido.
  4. **Tarjetas** que se encienden con borde de acento al nombrar cada beneficio.
  5. Un **CTA** con botón de acción que se presiona solo, burbuja de escritura y calendario con un día marcado.
- Ritmo tranquilo: solo 3 cortes duros en toda la pieza. Nada de flashes, glitches ni cortes agresivos. La energía viene de que el cuadro nunca deja de transformarse.
- Demo incluida: `demo/` (≈14 s, 9:16 y 16:9, sin archivos externos): una pantalla de sala de espera («¿Primera vez por aquí?» → «Te guiamos con calma.» → «Mientras esperas:» → «Estamos contigo.»). Vista previa en `demo/preview.jpg`.

## Estructura y ritmo
- **BPM:** 90–100 (la demo usa 96: beat 0.625 s, compás de 4 beats = 2.5 s).
- **Duración:** 12–30 s. Una pieza completa de sala de espera dura 24–30 s (≈40 beats); un reel corto, 12–16 s (≈20–24 beats).
- **Cuatro actos.** Los cortes duros caen en líneas de compás y todo se mide en beats sobre `beats.json`; los tiempos van en `timeline.json` como marcas con nombre.

| Acto | Beats (pieza de 25 s) | Beats (demo de 14 s) | Qué pasa |
|---|---|---|---|
| 1 · Gancho + solución | 0 → 12 (3 compases) | 0 → 8 | El personaje vive el problema (gesto, ceño, un objeto que no entiende). Pregunta en 2–3 líneas. El objeto del problema se disuelve, sorpresa y sonrisa, push-in heavy a la cara y frase de solución con acento en la palabra clave. Deriva lenta hacia el detalle que abre el acto 2 |
| 2 · Cómo funciona | 12 → 20 (2 compases) | 8 → 12 | Primer plano ilustrado en un disco: aparece la fuente de luz, baja un haz suave, anillos de acento barren, el detalle pasa de borroso a nítido, destello y check |
| 3 · Beneficios | 20 → 28 | 12 → 16 | 3 tarjetas atenuadas (fila en 16:9, pila en 9:16). Cada una se enciende (borde de acento + chip) en la palabra que la nombra. Salen hacia abajo justo antes del corte |
| 4 · CTA + nota legal | 28 → 40 | 16 → 23 | Titular con acento, líneas de acción que suben en snappy, botón de acción con burbuja de escritura y presiones, calendario con un día marcado, nota legal. Todo sale para que el loop quede limpio |

- **Algo nuevo cada 1–2 beats** (más denso que la regla general de 2–4 s, pero siempre suave). Ningún plano se sostiene más de 4 beats sin un elemento nuevo.
- **Frame 0:** el personaje ya está visible y la primera palabra ya se lee (la primera línea se suelta en un beat negativo, p. ej. `[-0.4, -0.32]`).
- **La tipografía lidera cada corte:** la línea saliente termina de irse 0.25–0.4 beat antes de la línea de compás, y la nueva entra entre 0.1 y 0.2 beat después.
- **El CTA dura más que un end card normal** (7–12 beats), pero nunca está quieto: flota, escribe, se presiona o marca algo cada 1–1.5 beats.
- Con voz en off, la VO manda: marca en `timeline.json` las palabras clave (`'sol_a'`, `'card2'`…) y úsalas en `rise` y en los encendidos.

## Rejilla y formatos
Todos los números de layout van con `C.pick(16:9, 1:1 y 4:5, 9:16)`. Los helpers ya traen `ILUS.PAD` y `ILUS.SIZE`.
- **16:9 (pantalla de TV):** texto a la izquierda en x = 120. Ilustración y disco a la derecha (centro x ≈ 1450–1500, y ≈ 470–600, radio 380–400). Tarjetas en fila de 3 (533 × 560, separación 40). Calendario a la derecha y botón bajo el texto.
- **9:16 (mismos beats, re-bloqueado):**
  - Ilustración arriba (centro x 540, y 600–690), con el canvas recortado a y ≤ 1050 y un degradado al fondo entre y 860–1050 (`ILUS.fadeToBg`) para que el push-in nunca pise el texto.
  - Texto abajo desde y ≈ 1110–1180, x = 90.
  - Tarjetas apiladas (ancho completo − 180, alto ≈ 305, paso 335, desde y ≈ 470) con el titular arriba en y ≈ 320.
  - CTA: calendario arriba (y ≈ 290), botón debajo (y ≈ 845) y el bloque de texto bajo él; la legal en y ≈ 1440.
  - Zonas seguras: nada clave en el 14 % superior (y < 269), el 20 % inferior (y > 1536) ni el 12 % derecho (x > 950).
- **1:1 o 4:5:** usa el bloqueo de 9:16 comprimido (ilustración arriba ≈ 45 %, texto abajo) con los tamaños de 9:16.
- Re-bloquea por escena; nunca escales ni pongas franjas a la composición de otro formato. Juzga cada formato en su propia hoja de contactos.

## Tipografía
- **Display:** Poppins 800 (900 solo para un símbolo o una palabra de golpe, 700 para etiquetas). **UI:** Inter 500/600 para chips, botón y nota legal. Archivos en `fonts/` (licencia SIL OFL 1.1). Declara `C.fonts = ['800 100px Display', '900 100px Display', '700 40px Display', '500 40px UI', '600 40px UI']`.
- Alineación a la izquierda en x = 120 (16:9) o x = 90 (9:16), en oraciones con la puntuación española completa (¿…? ¡…!). El padding superior de `.line` (0.24em) protege tildes y signos de apertura.
- **Tamaños a 1080 px** (`ILUS.SIZE`, 16:9 / 9:16):
  - Gancho `hook`: 88 / 80.
  - Solución y CTA `solucion`: 100 / 92.
  - Acto 2 `detalle`: 96 / 88.
  - Beneficios `beneficio`: 76 / 72.
  - Líneas de acción `accion`: 60 / 54.
  - Chips `chip`: 46 / 50.
  - Nota legal `legal`: 36, Inter 500 en `--ink-2`.
  - Interlineado `ILUS.LH` = 1.28.
- Mínimo display ≥ 68 px. Todo lo que se lee debe aguantar la prueba del teléfono de 360 px y la de 3 m de distancia (miniatura al 25 %).
- **Acento** solo en la palabra clave o en la segunda frase completa (la palabra del problema, la solución, el nombre del servicio, el beneficio final). Máximo una palabra o frase acentuada por mensaje.
- **Texto en pantalla = guion = VO** palabra por palabra. Nunca resumir.

## Color
Paleta de ejemplo (índigo profundo + menta + rosa de acción). Son tokens `:root` en `demo/index.html`; los helpers los leen solos.

| Rol | Token | Hex | Uso |
|---|---|---|---|
| Fondo | `--bg` | #2F2C5C | Todas las escenas. No hay cambios de campo: la calma viene de un fondo constante |
| Tinta | `--ink` | #FFFDF8 | Tipografía display |
| Secundario | `--ink-2` | #D9D5F0 | Nota legal y textos de apoyo |
| Acento | `--accent` | #8DE2C6 | Palabra clave, luz, anillos, borde de tarjeta activa, chip activo, núcleo del badge, segundo check |
| Acción | `--action` | #F06C93 | Solo el botón, el check principal y algún objeto de acción. Nunca en tipografía |
| Disco | `--disc` | #433F7E | Disco detrás del personaje y del primer plano |
| Tarjeta | `--card` / `--card-in` | #FFFDF8 / #F1EEF8 | Tarjetas, calendario, burbujas e interiores |
| Objetos | `--obj` | #231F45 | Ojos, teléfono, trazo del check sobre acento |

- `--bg-rgb` repite el fondo en r,g,b para los degradados, y `--shadow` es la sombra de tarjetas (rgba oscuro, nunca glow).
- **Un acento + un color de acción.** La acción es la única excepción a la regla de un acento y vive solo en lo que se toca.
- La piel, el pelo y la ropa del personaje son contenido, no UI: tonos cálidos y apagados que contrasten con el disco (`ILUS.LOOK`, cámbialos con `P.look`).
- Si tu marca tiene un fondo claro, invierte los roles con cuidado: tinta oscura, disco un tono más oscuro que el fondo y acento que pase contraste como texto.

## Vocabulario de movimiento
Helpers en `helpers/ilustrado.js` (`window.ILUS`). Cópialo a `film/ilustrado.js` y cárgalo en `film/index.html` después de `type.js` y antes de `film.js`. Referencia completa en `demo/film.js`.

| Movimiento | Cómo se ve | Con el motor |
|---|---|---|
| Pila de líneas palabra por palabra | 2–3 líneas grandes, izquierda; cada palabra sube por su máscara en la sílaba hablada | `ILUS.stack(root, textos, PAD, y, size, accents)` (o `TYPE.line`). Anima con `TYPE.rise(t, L, [b1, b2, …], outBeat)`; un beat por palabra, escalonado 0.08. Preset heavy para titulares |
| Líneas de acción del CTA | Subtítulos de 52–60 px que suben rápido, una tras otra | `rise(t, L, beatOf('cta2') + i*0.6, out, {preset:'snappy', stagger:0.04})` |
| Personaje con gestos | Persona plana con brazos IK, ceño, entrecerrar, sorpresa, sonrisa, parpadeo; sostiene un objeto | `ILUS.person(g, P)` con `tilt, hx, brow, squint, smile, oh, blink, hand, lhand, held`. Mezcla los parámetros con `sp()` y `lerp()` por marca: expresiones en default, sorpresa en snappy, brazos que alcanzan algo en heavy. `held(g, x, y)` dibuja lo que sostiene (`ILUS.sheet`, `ILUS.phone` o tu objeto) |
| Disco de fondo | Círculo detrás del personaje; el torso se recorta redondo y la cabeza sale por arriba | `ILUS.withDisc(g, cx, cy, r, () => ILUS.person(g, P))` |
| Nube de duda | Nube blanca con «?» que aparece sobre la cabeza y flota | `ILUS.thought(g, x, y, spHit(t,'duda','snappy'))` |
| Objeto que se hace polvo | El objeto del problema se disuelve en ~150 partículas que suben y se apagan en 0.65 s | `const DUST = ILUS.dust({seed, cx, cy, rx, ry})` FUERA de `run()`; en `run()`, `ILUS.drawDust(g, DUST, t - bt('dust'))`. Una sola vez, con SFX suave. Nace del contorno del objeto: no es un burst genérico |
| Push-in de solución | La cámara entra heavy a la cara (×1.7–1.85) en la frase de solución y luego deriva lenta hacia el detalle del acto 2 | `push = sp(t,'push','heavy')`, `deriva = ease.inOut(seg(t, b0, corte))`. Compón translate/scale 2D sobre el canvas (patrón en el acto 1 de la demo) + `ILUS.micro(t, b0, b1, 0.04)` |
| Primer plano con luz | Disco con el detalle; un badge de luz aparece en snappy, un haz baja en heavy con bandas viajando, 3 anillos barren y el detalle borroso pasa a nítido de golpe | `ILUS.badge`, `ILUS.beam(g, x0, y0, x1, y1, ancho, spHit(t,'beam','heavy',0.05))`, `ILUS.glow`, `ILUS.scanRings(g, cx, cy, amt, seg(t,'scan','focus'))`, enfoque con `spHit(t,'focus','snappy',0.04)` sobre el blur de `ILUS.clip`, y `ILUS.focusRing` que se expande una vez |
| Check que se dibuja | Círculo que crece en snappy y trazo en 2 tramos (40 % / 60 %) en ~0.6 beat | `ILUS.check(g, cx, cy, R, spHit(t,'check','snappy'), seg(t,'check', beatOf('check')+0.6))` |
| Tarjetas que se encienden | 3 tarjetas entran juntas en default (escalonado 0.12 beat) con velo del fondo al 55 %. En su palabra se va el velo, aparece borde de acento de 10 px, sube 16 px, pulso de escala 1.05 en medio beat y un chip pop | `ILUS.litCard(g, B, {p, lit, act, pulse, gone, draw})` devuelve el rect para colocar el chip `ILUS.pill(...)` con `C.put`. `act = sp(a,'snappy') - sp(z,'snappy')`, chip con `spHit(t, beatOf(a)+0.25, 'snappy')` |
| Salida por abajo | Las tarjetas caen fuera de cuadro con `ease.inOut`, escalonadas 0.03 beat de derecha a izquierda, justo antes del corte | `gone = sp(t, corte - 0.45 + (2-i)*0.03, 'default')` dentro de `litCard` |
| Titular que se desliza | El titular del CTA aterriza bajo y sube 200–240 px en heavy cuando entran las líneas de acción | `put(L.el, {y: 240 * (1 - sp(t, b, 'heavy'))})` |
| Botón que se presiona | Píldora de acción con ícono que crece 0.75 → 1 en snappy; burbuja con 3 puntos de escritura; presiones (−6 %) con anillo que se expande | `ILUS.pill(root, 'Escríbenos', 'chat', {bg: tok().action})`; presión con `ILUS.pulse(t, b, b+0.25)`; en `after()`, `ILUS.pressRing` y `ILUS.typing` sobre `C.rectOf(btn)` |
| Calendario | Tarjeta que entra en snappy con leve giro; la grilla aparece en cascada; un día recibe check de acción con onda y otro uno de acento | `ILUS.calendar(g, CAL, {t, inAt, outAt, floatAt, checkAt, check2At})` |
| Marcador de clip | Tarjeta rayada con play y «TU CLIP AQUÍ» donde irá tu footage o foto | `ILUS.clip(g, x, y, w, h, {t, blur, sub})`. Reemplázalo por `C.drawSeq` con tu clip |
| Hold vivo | Toda escena tiene micro push 1.00 → 1.03–1.07 o flotación | `ILUS.micro(t, inicio, fin, 0.03–0.05)` o `1 + 0.06 * seg(t, 'cta', 'done')` |

- **Resortes:** heavy para titulares, cámara, haz de luz y deslizamiento. Default para tarjetas, personaje y expresiones. Snappy para chips, botón, checks, puntos y líneas de acción. Playful nunca, ni siquiera en el personaje.
- Todo lo que suena usa `C.spHit(t, marca, preset, lead)` con lead de 0.04–0.1 s.
- Los helpers ya parchean `arc()` para que un resorte que se pasa de 0 nunca dé un radio negativo.

## Subtítulos
- No lleva subtítulos quemados (`captions.formats: []`). La tipografía display ya es el guion completo sincronizado con la voz; un segundo bloque de texto competiría y se leería mal desde lejos.
- Si un formato social los exige, usa un preset sobrio (`pill-sobrio`) solo en ese formato y saca la tipografía display de esas escenas para no duplicar.

## Transiciones
- **Corte duro en línea de compás.** La tipografía saliente sale con `rise` 0.25–0.4 beat antes; el contenido gráfico sale 0.15 beat antes.
- **Match por escala:** el push-in y la deriva del acto 1 terminan casi en el detalle (el objeto, la mano, la hoja) que el acto 2 abre en primer plano. El corte cae dentro de esa escala y la escena nueva entra con cámara 0.86 → 1 en `spHit(..., 'snappy')`.
- **Push-in heavy dentro de una escena** (×1.7–1.85 en ~1 beat) como transición emocional problema → solución.
- **Final de loop:** legal, botón, burbuja y calendario se van (escala a 0 / subida de 1200 px) de abajo hacia arriba, para que el loop vuelva al gancho sin salto. El último frame queda solo con el fondo.
- Prohibido: fundidos cruzados, iris, flashes y barridos de color.

## Sonido, música y voz
- **Música:** pista original por proyecto. Pop acústico cálido (guitarra, piano suave), 90–100 BPM, tonalidad mayor o relativa menor amable. Energía por tramo: gancho bajo y curioso; solución y acto 2 se abren; beneficios estable; en el CTA la música se desvanece para que el loop sea limpio.
- **SFX** propios del proyecto, unos 12 en 25 s, todos declarados en `timeline.json` `sfx` y sobre el grid: pop (primer frame, cada tarjeta, segundo día), swish (gesto grande, push-in), click (objeto, botón), puff (disolución), shimmer (haz de luz) y chime (enfoque y check principal). Nada estridente ni con transientes duros. La demo usa los tipos sintetizados del motor y anota en `what` el sonido ideal.
- **Mezcla:** música −1, sfx −6, VO 0, ducking activado; −14 LUFS integrados y true peak ≤ −1 dBTP.
- **Voz en off:** cálida, adulta, clara y pausada; tono cercano, nunca vendedor. Se corta en frases (una por mensaje) y cada frase se coloca en un beat: pregunta en ~0.2 s, solución en el beat del push, acto 2 a +0.6 beat del corte, beneficios y CTA a +0.4. Nunca se acelera una toma.

## Reglas recurrentes y prohibiciones
- El personaje es siempre ilustrado plano y dibujado en canvas: nunca una persona real ni una imagen realista generada.
- Nada que inquiete a quien espera: sin instrumentos, agujas, sangre, cuerpos forzados ni primeros planos clínicos. Los procedimientos se muestran como luz suave sobre una ilustración tranquila.
- Sin cifras de resultados ni promesas («garantizado», «100 %»). Nota legal visible al final si el servicio lo requiere (p. ej. «Sujeto a valoración profesional»).
- Si la pieza es genérica, sin logos, teléfonos ni @: el CTA remite al equipo del lugar o a un botón de chat.
- Debe entenderse sin sonido. Nada de flashes, parpadeos rápidos, glitches, giros ni rebote en UI.
- Un solo fondo; acento único y color de acción solo para lo que se toca.
- Ninguna entrada ni salida por opacidad pura: máscara, crecimiento, caída o recubrimiento. Solo la legal puede fundirse, con un desplazamiento de 12 px.
- Partículas solo con semilla y solo como disolución de un objeto concreto.
- Sin `Math.random`, timers, `Date` ni estado entre frames. Las constantes aleatorias se calculan fuera de `run()`.
- Sin `translate3d` ni `will-change`: transformaciones 2D sobre canvas y `C.put`.

## Qué revisa el crítico
- [ ] Frame 0: personaje visible y primera línea ya legible.
- [ ] Cada palabra sube en la sílaba que dice la VO (±0.1 beat) y el texto coincide letra por letra con el guion.
- [ ] Acento solo en la palabra o frase clave de cada mensaje; color de acción solo en el botón, el check principal y el objeto de acción.
- [ ] Cortes exactamente en líneas de compás. La línea saliente se ha ido ≥ 95 % antes de que aterrice la siguiente, y ningún glifo asoma por la máscara en su primer frame.
- [ ] Ningún tramo de 4 beats sin un evento nuevo; todo hold tiene micro push o flotación.
- [ ] Display ≥ 68 px, legal ≥ 32 px, x = 120 / 90. Prueba de 360 px y vista a 3 m superadas.
- [ ] 9:16: el push-in no pisa el texto y nada clave invade el 14 % superior, el 20 % inferior ni el 12 % derecho.
- [ ] Nada aterrador ni clínico, sin cifras ni promesas; la legal está presente y legible al menos 3 beats.
- [ ] Sin flashes ni fundidos cruzados. El último frame queda limpio para el loop y la música se ha desvanecido.
- [ ] Cada SFX está sobre el grid y en `timeline.json`. Mezcla a −14 LUFS y ≤ −1 dBTP.
- [ ] `render.mjs --verify --all` sin diferencias, lint limpio y puntuación ≥ 8 en todos los criterios en cada formato tras ≥ 2 rondas.

## Cómo usar la demo
1. Copia `demo/index.html` y `demo/film.js` a `film/` del proyecto (reemplazan los del motor) y `demo/timeline.json` a la raíz del proyecto.
2. Copia `helpers/ilustrado.js` a `film/ilustrado.js` (el `index.html` de la demo ya trae su `<script src="ilustrado.js">` antes de `film.js`; si usas tu propio `index.html`, agrégalo ahí después de `type.js`) y `fonts/*` a `assets/fonts/`.
3. Corre: `node scripts/sync.mjs && node scripts/lint.mjs --fmt 9x16 && node scripts/render.mjs --draft --fmt 9x16` (o `--sheet` para la hoja de contactos; `--fmt 16x9` para la versión de TV).

## Si buscas otra cosa
- Para explicar un servicio o un cuidado con material real en tarjeta y un tono premium sobre fondo claro: `tarjeta-escenario`.
- Para un curso o una lección por secciones: `clase-hojas`. Para un método o plan por pasos: `metodo-armado`.
- Para una app o un lanzamiento con energía de motion design: `punto-cinetico` o `producto-por-dentro`.

## Cómo adaptarlo a tu marca
- **Paleta:** cambia los tokens `:root` de `film/index.html` (`--bg`, `--bg-rgb`, `--ink`, `--ink-2`, `--accent`, `--action`, `--disc`, `--card`, `--card-in`, `--obj`). Mantén los roles: un fondo constante, un acento que pase contraste como texto y un color de acción distinto que solo vive en lo que se toca.
- **Tipografías:** apunta los `@font-face` de `Display` y `UI` a los archivos de tu marca en `assets/fonts/` y actualiza `C.fonts`. Mantén una display pesada y redonda y una UI legible.
- **Personaje:** cambia vestuario y pelo con `P.look` (`skin`, `hair`, `top`, `top2`, `lips`) y los objetos con `held` (tu producto, una hoja, un teléfono). Reutiliza la estructura de gestos; no lo conviertas en una persona real.
- **Logo y contacto:** si la pieza lleva marca, el logo va en el CTA (≥ 60 % del ancho en 9:16, sobre el fondo) y el contacto en dos líneas ≥ 44 px. En piezas genéricas, sin logo.
- **Footage:** reemplaza cada `ILUS.clip(...)` («TU CLIP AQUÍ») por tu clip con `C.drawSeq` (secuencia de frames de `seq.py`), en color original. El clip vive dentro de una tarjeta o del disco; el texto nunca va encima.
- **Textos:** reemplaza el copy de ejemplo («¿Primera vez por aquí?», «Te guiamos con calma.», «Todo a tiempo, sin apuros.», «Mientras esperas:», «Estamos contigo.», «Habla con nuestro equipo o escríbenos hoy.») por tu guion exacto, y mueve las marcas de `timeline.json` a las palabras de tu VO.
