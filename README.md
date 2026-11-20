# Andoo CreatorStudio

**Andoo** es un estudio local para producir Reels con IA en cada paso y tú aprobando todo. Corre en tu Mac: tus videos, tus datos y tus API keys nunca salen de tu computadora (salvo las llamadas a la IA que tú configures).

El programa no trae datos, videos ni imágenes de nadie: cada persona carga sus propios archivos, su API key y su guía de marca.

## Requisitos
- **Mac** con Apple Silicon y macOS 15 o superior (recomendado). En Mac Intel o macOS anterior también funciona, pero Homebrew compila algunas herramientas desde código y la instalación puede tardar mucho. Por ahora no hay instalador para Windows ni Linux.
- [Homebrew](https://brew.sh) y git (viene con las herramientas de línea de comandos de Xcode: `xcode-select --install`).
- Tu propia API key de IA (Claude u OpenAI). Andoo no trae ninguna.

## Instalar (2 pasos)
1. Clona el repositorio con git (no lo descargues como ZIP, así podrás actualizar). Copia el enlace del botón **Code** de esta página y ejecuta en la Terminal:
   ```bash
   git clone <enlace-del-repositorio> ~/CreatorStudio
   ```
2. Abre la carpeta `~/CreatorStudio` y haz doble clic en **`Instalar.command`**. Instala lo que falte y abre Andoo. Es seguro repetirlo. La primera vez descarga unos 2 GB:
   - Con Homebrew: Node, ffmpeg, yt-dlp, whisper-cpp (o lo compila con cmake en `~/.local/src/whisper.cpp`), Python 3.12 y uv.
   - Modelos de transcripción en español: whisper.cpp (~480 MB, en `~/.cache/whisper`) y faster-whisper (~480 MB, en `~/.cache/huggingface`).
   - El entorno de audio del motor en `motion/.venv` (numpy, librosa, faster-whisper…) y el Chromium de Playwright (~150 MB, en `~/Library/Caches/ms-playwright`).

   Para desinstalar, borra la carpeta `~/CreatorStudio` y esas carpetas de caché (más `~/.cache/creator-studio` si instalaste los modelos de audio locales).

Primeros pasos dentro de Andoo:
1. **Ajustes** → elige proveedor (Claude u OpenAI) y pega tu clave de IA; elige tu carpeta de videos crudos.
2. **Marca** → crea tu guía de marca (con IA desde tu web, tu Instagram, un PDF o un brief).
3. **Inicio** → pega un link de referencia y empieza.

- **Abrir:** doble clic en `Abrir Andoo.command` → http://localhost:4747
- **Desarrollo:** `npm run dev` (servidor + interfaz con recarga en vivo) · `npm run typecheck` · `npm run build`
- **Actualizar:** doble clic en `Actualizar.command`. Trae la última versión sin tocar tus datos.
- **Tus datos** viven en `data/` (proyectos, guías, API keys, uso). Está excluido de Git: nunca se comparte ni se sube.

## Atajos
- **⌘K** (Ctrl K en Windows/Linux): buscar proyectos, estilos y secciones, o crear un proyecto nuevo.
- **⌘B** (Ctrl B): contraer o expandir la barra lateral.

## Flujo (video a cámara, 5 pasos)
Al crear el video, en una sola pantalla, eliges la plantilla (ya viene una preseleccionada), escribes el objetivo, pegas links de referencia si quieres y, si tienes clave de IA, la app escribe el guion al crear.

1. **Idea y guion**: tus links y el objetivo. Si hay links, se descargan, se extraen fotogramas y la IA analiza hook, estructura, retención y edición (el análisis queda en un panel al lado). La IA escribe el guion con tu voz (según tu guía de marca). Lo editas, pides cambios, eliges el hook y **apruebas**.
2. **Grabación**: recomendaciones (plano, luz, audio, tomas, B-roll), checklist y teleprompter. Subes el video o lo eliges de tu carpeta de crudos.
3. **Propuesta visual**: la IA ve tu grabación y propone subtítulos, paleta, zooms/B-roll, música y portada. Al **aprobar**, ves el costo estimado y el tope, y arranca la edición sola.
   - **Apoyos visuales**: además propone imágenes y B-roll animado (palabras, cifra, pasos, comparación, lista) anclados a frases de tu guion, encima de ti o a pantalla completa. Cada uno se aprueba, edita, quita o reemplaza con tu propio archivo.
   - Las imágenes se generan **solo cuando tocas «Generar»**, con tu clave de OpenAI (gpt-image), en estilo ilustración/gráfico: nunca fotos de resultados falsos. Ves el costo por imagen antes de generar.
   - Las imágenes aprobadas aparecen también en el corte rápido; el B-roll animado lo arma el productor con la plantilla.
4. **Edición**, un solo camino:
   - Elige las mejores tomas (whisper + IA), corta en silencios reales, reencuadra a 9:16 y deja el audio a -14 LUFS.
   - Luego el productor arma el video con la plantilla elegida, con tu marca ya aplicada (colores, acento de subtítulos y logo) y un brief prellenado, sin volver a preguntarte. La única aprobación es la del video final.
   - Ves el resultado con **Aprobar video** o **Ajustar**. Con «Solo corte rápido» obtienes un corte gratis sin plantilla.
   - En «Avanzado» quedan la selección manual de tomas, volver a cortar, producir de nuevo con otra plantilla y el texto para un pulido con Claude Code.
5. **Publicación**: caption, hashtags, portada, primer comentario y estrategia de Trial Reel.

## Tres tipos de video
- **Talking head propio**: el flujo de 5 pasos de arriba. La plantilla la aplica el motor de video (subtítulos animados, zooms, gráficos según el estilo).
- **Reel comercial** y **Clase o explicador**: los produce el **motor de video** con un agente de Claude que trabaja como una sesión de producción:
  1. Entrevista creativa (las preguntas aparecen en la app).
  2. Música original para elegir de oído y rejilla de beats.
  3. Shotlist para aprobar.
  4. Voz en off.
  5. Escribe la película en código.
  6. Rondas de crítica con los fotogramas renderizados.
  7. Mezcla a −14 LUFS y render en 9:16, 4:5 y 16:9.

  Ves todo en vivo, apruebas cada paso y pides cambios en texto libre.

## Motor de video
- Una película es una función del tiempo: `seek(t)` dibuja cada fotograma en Chromium y ffmpeg lo codifica, con motion blur en el render final.
- El kit está en `motion/`: motor, scripts de audio, render, lint, crítica y CapCut, más el método completo de producción en `motion/skill/`.
- Requiere tu **API key de Anthropic**: el productor solo funciona con Claude.
- **Audio en tres modos** (Ajustes → Audio del motor):
  - **Sintetizado** (por defecto): gratis, sin IA, en cualquier Mac. Voz con las voces de macOS (Paulina, Mónica…), música original con el sintetizador del motor y efectos de UI sintetizados.
  - **Local gratis**: modelos abiertos en tu máquina. Voz con Kokoro (funciona incluso en Mac Intel) o Chatterbox con clonación de voz; música con ACE-Step 1.5; efectos con Stable Audio Open. Chatterbox, ACE-Step y Stable Audio necesitan Apple Silicon o GPU NVIDIA; Stable Audio además pide aceptar su licencia en Hugging Face y un token. Se instalan desde Ajustes en `~/.cache/creator-studio`.
  - **ElevenLabs**: la mejor calidad, de pago, con tu API key.
- Solo corre un render pesado a la vez en todo Andoo.

## Estilos (la app aprende)
Un estilo reúne colores, tipografías, vocabulario de movimiento, plantillas de escenas, reglas, tipo de subtítulos y ejemplos de películas. El agente lo sigue para hacer videos **nuevos** con ese estilo.
- **Importar de tus proyectos**: apunta a la carpeta de un proyecto del motor o a una carpeta con muchos. Se agrupan por familia (p. ej. todas las clases de un curso) y se extrae su material; la IA escribe la guía. Sin API key se arma una guía básica que luego puedes completar con IA.
- **Aprender de un video de referencia**: se mide su ritmo y sus planos, y la IA describe su gramática visual.
- **Crear con IA** desde una descripción y mejorar cualquier estilo con feedback.
- Los estilos que importes o crees se guardan en `data/styles/`, nunca en el repositorio.

### Estilos incluidos (plantillas para empezar)
Vienen 9 estilos base en `motion/styles/`, listos para usar o duplicar. Cada uno trae su guía, helpers, una **demo renderizable** (`demo/`) con textos de ejemplo («TU CLIP AQUÍ», «TU LOGO», «@tumarca») y tipografías libres (OFL). No contienen marcas, clientes ni material de nadie: cambia colores, textos y clips por los tuyos.

Cada estilo se ve **en movimiento** antes de elegirlo: en **Estilos** la galería reproduce su demo al pasar el mouse (y completa al abrirlo), y al crear un proyecto el selector también muestra la vista previa. Los estilos que importes de tus proyectos toman como vista previa un recorte de uno de tus renders; los que tengan demo (por ejemplo, una copia de un estilo base que modificaste) pueden regenerarla con «Generar vista previa». Para regenerar las de los estilos base: `node server/tools/style-previews.ts --force`.

| Estilo | Tipo | Para qué sirve |
|---|---|---|
| Tarjeta escenario | reel | Explicador premium: cada sección es una tarjeta con tu clip o un diagrama y un titular fijo |
| Clase en hojas | clase | Lecciones por secciones, con versión corta vertical |
| Producto por dentro | reel | Recorrido de producto: contador de rodillo, cursor sobre la interfaz, reproductor |
| Paneles con UI | reel | Prueba visual: comparador antes/después y «dato clave» resaltado |
| Método armado | reel | Del caos al método: fichas que se ordenan y carrusel «Paso N» |
| Precisión nocturna | reel | Técnico y nocturno: escaneo punto por punto sobre esquemas de línea fina |
| Punto cinético | reel | Motion tipográfico: cada frase cierra con un punto que se abre a la siguiente escena |
| Ilustrado sereno | reel | Ilustración plana y pausada con personaje, tipografía grande palabra por palabra |
| Talking karaoke | talking | Persona a cámara con subtítulos karaoke, punch-ins y b-roll |

En **Estilos** usa «Duplicar» para crear tu versión editable (se guarda en `data/styles/`); el original queda intacto.

## Seguridad del productor
El agente que produce los videos corre en tu Mac dentro del **sandbox del sistema operativo**:
- **Escritura:** solo en la carpeta de su proyecto y en una carpeta temporal propia.
- **Lectura:** no puede leer tu carpeta personal, la base de datos (donde están tus keys), otros proyectos ni el código de la app.
- **Red:** los comandos que ejecuta no tienen acceso; los modelos de transcripción vienen instalados.

Lo que necesita un navegador o la red lo hace la app con herramientas controladas: render, lint, captura de sitios que tú indicaste o apruebas, y ElevenLabs. Si el sandbox no está disponible, la producción no arranca.

## Secciones
- **Marca**: varias guías de marca, generadas con IA desde una web, un PDF, un perfil de Instagram/TikTok, imágenes o un brief (1-3 propuestas a la vez). Editables, iterables con feedback, con versiones y exportables a PDF. Cada proyecto elige su guía.
- **Inspiración** (próximamente): seguir cuentas, detectar videos *outlier* y llevarlos a producción.

## IA y costos
- Proveedor a elegir: **Claude (Anthropic)** u **OpenAI**, con tu propia API key.
- **Gasto real**: con la *Admin key* del proveedor Andoo lee lo que te cobran este mes.
- Ningún proveedor expone el saldo restante por API: "Queda" = crédito mensual que defines en Ajustes − gasto del mes.
- Cada llamada se registra con tokens y costo estimado; hay freno automático al agotar el crédito.
- **Imágenes de apoyo** (Ajustes): modelo y calidad de gpt-image, con tu clave de OpenAI aunque tu proveedor principal sea Claude. Tienen su propio límite mensual de OpenAI y aparecen aparte en «Uso de IA».

## Herramientas
El instalador pone ffmpeg, yt-dlp y whisper.cpp (modelo en `~/.cache/whisper/ggml-small.bin`). En **Ajustes → Herramientas locales** ves qué está disponible; si algo falta, vuelve a abrir `Instalar.command`.

- En Mac, el render usa la codificación por hardware (VideoToolbox) cuando está disponible.
- Si tu ffmpeg no trae libass, los subtítulos se exportan como `.srt` para que los quemes en el pulido.
- Tus videos originales nunca se modifican; todo lo generado queda en `data/projects/<id>/`.

## Licencia
Andoo se publica bajo la [PolyForm Noncommercial License 1.0.0](LICENSE.md):
- **Puedes** descargarlo, usarlo y modificarlo para ti, tu aprendizaje, tus proyectos personales o una organización sin fines de lucro.
- **No puedes** usarlo con fines comerciales: venderlo, ofrecerlo como servicio ni usarlo dentro de un negocio.
- Si lo compartes, incluye la licencia y la línea `Required Notice` del archivo `LICENSE.md`.

El texto legal vinculante es el de `LICENSE.md` (en inglés). El código y las tipografías de terceros mantienen sus propias licencias: ver [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Marca
Nombre, símbolo, colores y tipografía de Andoo: ver [`docs/brand/README.md`](docs/brand/README.md).

## Stack
- **TypeScript de punta a punta.** Servidor en Node (22.18 o superior; el instalador pone la versión actual), que ejecuta `.ts` directo sin compilar; Express maneja las subidas grandes por streaming.
- **Datos:** SQLite integrado en Node (`node:sqlite`) en `data/studio.db`. Escrituras atómicas y solo de lo que cambió.
- **Interfaz:** React + Vite, un componente por pantalla en `web/src/pages`.
- **Contratos compartidos:** `shared/types.ts` (formas de datos y respuestas de la API) y `shared/schemas.ts` (salidas estructuradas de la IA). Si cambias una forma, `npm run typecheck` señala todo lo que hay que ajustar.
