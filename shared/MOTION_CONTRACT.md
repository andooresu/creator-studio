# Contrato: motor de video, producción con agente y estilos

Tipos en `shared/types.ts`: `ProjectKind`, `Production`, `ProductionEvent`, `PendingAction`, `AgentQuestion`, `AgentApproval`, `RenderOutput`, `Format`, `Style`, `StyleSummary`, `MotionEnv`.
Rutas de datos en `server/db.ts`: `MOTION_DIR` (kit incluido en la app), `STYLES_DIR` (estilos del usuario), `projectDir(pid)`.

## Tipos de proyecto
- `talking` (o ausente): flujo actual por etapas. En la etapa Edición se puede pedir además un **render con estilo** con el motor (ver producción, `mode: "talking"`).
- `reel` y `clase`: no usan el stepper. La vista del proyecto es la **sesión de producción**: un agente de Claude trabaja como en las sesiones de Claude Code con el skill motion-reel (entrevista, música, shotlist, voz, película, crítica, render).

## Carpeta del motor por proyecto
`data/projects/<pid>/motion/` (= `Production.dir`). Tiene la estructura de un proyecto motion-reel: `film/`, `scripts/`, `audio/`, `assets/`, `docs/`, `renders/`, `review/`, `brief.md`, `timeline.json`, `node_modules` → symlink a `<APP>/node_modules`, `.venv` → symlink a `<APP>/motion/.venv`. Se sirve por HTTP como `/media/<pid>/motion/...`.
- `film/lib/inserts.js` (`window.INS`, del kit `motion/engine/lib/inserts.js`): insertos de motion graphics sin IA para videos a cámara. `INS.full(parent, { kind: "palabras"|"cifra"|"pasos"|"comparacion"|"lista"|"imagen", datos, inAt, outAt, unit?: "beat"|"s", modo?: "pantalla_completa"|"encima", posicion?, src?, move? }) → { el, run(t), modo }` (para los apoyos siempre con su movimiento propio, `move` por defecto: sale hacia arriba; `move: false` + `TALK.broll` saldría hacia abajo cruzando los subtítulos), `INS.kenBurns(t, im, inAt, outAt, opts)`, `INS.sec(s)` (segundos → beat), `INS.liftCaptions(inAt, outAt, y)` (agrega `captions.yAt` en segundos). inAt/outAt en beats o marcas como `C.bt`. Solo depende de `window.C`; colores de `--accent` (tintes con color-mix), tipografía `var(--display)` o Montserrat 800 de `assets/fonts/captions/`. Se carga en `film/index.html` después de talking.js y antes de `film.js`. Textos medidos en el primer `run()` (con la fuente cargada): se achican y reparten en líneas hasta caber en su caja, nunca se cortan ni bajan del mínimo de `lint.mjs` (32 px; 36 en 9:16); si un «encima» no cabe así pasa a pantalla completa (`ins.modo` lo refleja; `ins.el` sigue siendo el mismo nodo) y si tampoco cabe, `run()` lanza un error. Los límites de datos de la app (`shared/apoyoLimits.ts`: palabras ≤ 3 textos, cifra ≤ 18 caracteres, ninguna palabra > 24) garantizan que quepan a pantalla completa. Lanza un error en español si el inserto quedaría vacío (sin datos, comparación sin las dos ideas, imagen sin `src` o que no carga). Es de solo lectura en el proyecto: `repairEngineLibs` la repone en cada inicio.
- `assets/apoyos/<id>.<ext>` + `docs/apoyos.json`: apoyos visuales APROBADOS del proyecto (los escribe `syncApoyos` al iniciar/reanudar la producción; `assets/apoyos/` es de la app: borra solo los archivos que ella copió y ya no corresponden — los del `docs/apoyos.json` anterior y `<id>.<ext>` de apoyos no aprobados —; los derivados del productor van en `assets/img/`). Cada entrada: `{ id, tipo, modo, posicion, contenido, animacion, datos, frase, original: {s,e}, corte: {s,e} | null, archivo: "assets/apoyos/<id>.<ext>" | null, usable: boolean, motivo? }` (`usable: false` = aprobado pero sin archivo, sin animación, o sin datos que su animación pueda mostrar legibles (`datosProblem` de `shared/apoyoLimits.ts`): el productor lo salta; segundos; `corte` mapeado con `mapToCut(s, e, p.edit.ranges)`, null sin tramos o si el corte quitó el tramo).

## server/motion/kit.ts (módulo "motion-kit")
```ts
export function motionEnv(): MotionEnv
export interface ScaffoldOpts { style?: Style | null; presetDir?: string; timelinePatch?: Record<string, unknown>; extraFiles?: { from: string; rel: string }[] }
export function scaffoldMotion(p: Project, opts?: ScaffoldOpts): string // crea data/projects/<pid>/motion (como motion/scripts/init.sh), copia archivos del estilo a docs/style/, devuelve la carpeta
export function scaffoldDir(dir: string, owner: string, opts?: ScaffoldOpts): string // igual en cualquier carpeta
// Solo en carpeta nueva, en orden: estilo → extraFiles → preset.mjs (si el preset no trae fuentes, se conservan los @font-face
// originales de film/index.html) → timelinePatch (objetos mezclados a un nivel, p. ej. captions) → motion.test.js → sync.mjs
export function styleDir(style: Style): string // motion/styles/<id> si origin === "base", si no data/styles/<id>
export async function runMotion(dir: string, cmd: "node" | "python", args: string[], opts?: { onLine?: (l: string) => void; heavy?: boolean; timeoutMs?: number }): Promise<{ code: number; out: string }>
// heavy=true → cola global: un solo render pesado a la vez en toda la app
export async function renderMotion(dir: string, opts: { mode: "draft" | "final"; formats: Format[]; onProgress?: (msg: string) => void }): Promise<RenderOutput[]> // usa scripts/render.mjs; paths relativos a dir
export async function sheetMotion(dir: string, fmt: Format): Promise<string[]> // contact sheet por beat → rutas relativas (review/sheets/...)
export function mediaUrl(pid: string, relInMotion: string): string // "/media/<pid>/motion/<rel>"
export function repairEngineLibs(dir: string): string[] // carpeta ya preparada: copia film/lib/inserts.js si falta o difiere, crea assets/apoyos y agrega <script src="lib/inserts.js"> antes de film.js si falta; devuelve lo que cambió ("film/lib/inserts.js (repuesta)" si reemplazó una copia distinta: startProduction avisa al agente)
```

## server/agent/* (módulo "producer")
- `runner.ts`
```ts
export function startProduction(p: Project, opts: { mode?: "reel" | "clase" | "talking"; brief?: string; changeMode?: boolean; restyle?: boolean; flags?: unknown; capUsd?: number; notice?: string }): void // notice: aviso de la app para el agente (p. ej. «hay un corte nuevo»); scaffold si falta (talking + marca activa: preset de marca), arranca query() del SDK en segundo plano
export function productionPreflight(): void // lanza los mismos errores que startProduction (API key de Anthropic, entorno de Python) sin arrancar nada
// Al pasar la producción a "done" con un render final, Project.editRun.state "plantilla" → "listo".
export function sendMessage(p: Project, text: string): void   // feedback libre del usuario → reanuda la sesión (resume: sessionId)
export function answerQuestion(p: Project, questionId: string, answers: Record<string, string>): void
export function decideApproval(p: Project, approvalId: string, approved: boolean, feedback?: string): void
export function stopProduction(p: Project): void
export function currentRenders(p: Project, prod?: Production | null): RenderOutput[] // renders de la corrida actual (posteriores a editRun.startedAt o a la grabación)
export function resetProductionForNewRecording(p: Project): void // grabación nueva: detiene y olvida sesión y renders
export function approveFinalFromEdit(p: Project): boolean // «Aprobar video» cuenta como la aprobación final pendiente
export function syncApoyos(p: Project, dir: string): string // copia los archivos de los apoyos aprobados a assets/apoyos/ y escribe docs/apoyos.json; nota para el agente si la lista cambió ("" si no). Lo llama startProduction en ambas ramas (con repairEngineLibs)
```
- `tools.ts`: servidor MCP en proceso (`createSdkMcpServer`, nombre `studio`) con herramientas: `ask_user` (preguntas con opciones, bloquea hasta respuesta), `request_approval` (puerta: shotlist, música, borrador, final), `show_media` (publica audio/video/imagen en la sesión), `elevenlabs_music`, `elevenlabs_tts`, `elevenlabs_sfx`, `elevenlabs_voices`, `render` (borrador/final vía kit), `sheet`.
- `elevenlabs.ts`: API REST de ElevenLabs con la key de Ajustes (`settings.elevenlabsKey`).
- `brandPreset.ts`: `brandPresetFor(p, flags, style)` → preset temporal (colores de la marca por rol, acento de subtítulos, logo de la marca → `assets/brand/logo.<ext>`) para el scaffold nuevo de talking; null sin marca activa. `cleanup()` borra la carpeta temporal.
- `prompt.ts`: `briefPrefill(p, mode, brand, flags, style)` (bloque «Brief prellenado» de talking, tras «Datos del proyecto») y `onlyFinalApproval(p, mode)` (talking con guion y propuesta aprobados: `request_approval` solo acepta kind "final"); arma el system prompt: rol, ruta del skill de referencia (`<APP>/motion/skill/SKILL.md` y `reference/*.md`, leídos por el agente), guía del estilo, guía de marca (`brandToPrompt`), datos del proyecto (guion, grabación, tomas, palabras, apoyos aprobados con sus tiempos de corte vía `apoyosData(p)`), adaptadores (usar `mcp__studio__*` en lugar de AskUserQuestion / herramientas MCP de ElevenLabs), reglas de la app.
- Costo: cada resultado del SDK (`total_cost_usd`, `usage`) se registra en `db.usage` con `stage: "produccion"` y se suma a `Production.costUsd`.

## server/styles/* (módulo "styles")
```ts
export function listStyles(): Style[]               // base (motion/styles/*/style.json, solo lectura) + usuario (db.styles)
export function getStyle(id: string): Style | undefined
export async function importStylesFromPath(path: string, step: (m: string) => void): Promise<Style[]> // carpeta de UN proyecto motion-reel o carpeta con VARIOS (agrupa por familia)
export async function learnStyleFromVideo(file: string, step: (m: string) => void): Promise<Style> // ref_analyze.py + análisis con visión
export async function createStyle(input: { name: string; kind: StyleKind; description: string; brandId?: string | null }, step: (m: string) => void): Promise<Style>
export async function iterateStyle(style: Style, feedback: string, step: (m: string) => void): Promise<Style>
```
Estilos base incluidos en el repo (genéricos, sin clientes): `motion/styles/<id>/style.json` + `guide.md` (+ helpers .js opcionales).

## Endpoints HTTP
Routers Express que `server/index.ts` monta: `motionRouter` (server/routes/motion.ts), `productionRouter` (server/routes/production.ts), `stylesRouter` (server/routes/styles.ts). Todas las respuestas JSON; errores `400 {error}` en español.
| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | /api/motion/env | – | MotionEnv |
| POST | /api/projects/:id/motion/render | `{mode, formats}` | Project (job en segundo plano; resultados en `production.renders`) |
| POST | /api/projects/:id/production/start | `{mode?: "reel"\|"clase"\|"talking", brief?, styleId?, flags?, capUsd?, newRun?}` (newRun: corrida nueva de plantilla desde Edición → editRun "plantilla", limpia finalVideo/editApproved y, si hay sesión, avisa al agente que entregue un render final nuevo) | Project |
| POST | /api/projects/:id/production/message | `{text}` (talking con editRun ya listo, corte rápido o aprobado: corrida nueva de plantilla, como newRun) | Project |
| POST | /api/projects/:id/production/answer | `{questionId, answers}` | Project |
| POST | /api/projects/:id/production/approve | `{approvalId, approved, feedback?}` | Project |
| POST | /api/projects/:id/production/stop | – | Project |
| GET | /api/styles | – | `{ styles: Style[], job: Job \| null }` |
| GET | /api/styles/:sid | – | Style |
| POST | /api/styles/import | `{path}` | `{ job }` |
| POST | /api/styles/learn | multipart `file` | `{ job }` |
| POST | /api/styles/create | `{name, kind, description, brandId?}` | `{ job }` |
| PUT | /api/styles/:sid | `{name?, description?, guide?, kind?}` | Style |
| POST | /api/styles/:sid/iterate | `{feedback}` | `{ job }` |
| POST | /api/styles/:sid/duplicate | – | Style |
| DELETE | /api/styles/:sid | – | `{ok}` |
| GET | /styles-files/:sid/* | – | archivo del estilo |
| POST | /api/projects | `{title, goal?, brandId?, kind?, styleId?}` | Project (existente, ampliado) |
`GET /api/state` añade `styles: StyleSummary[]`, `motion: MotionEnv`, y cada ProjectSummary trae `kind` y `productionStatus`.
