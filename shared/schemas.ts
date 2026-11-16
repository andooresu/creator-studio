// Esquemas de salida estructurada de la IA (fuente única para servidor e interfaz).
// El servidor los usa para pedir/validar JSON; la interfaz solo importa sus tipos.
import { z } from "zod";

export const Analysis = z.object({
  resumen: z.string(),
  formato: z.string(),
  hook: z.object({ texto: z.string(), tipo: z.string(), porQueFunciona: z.string() }),
  estructura: z.array(z.object({ tiempo: z.string(), beat: z.string(), descripcion: z.string() })),
  tecnicasRetencion: z.array(z.string()),
  edicion: z.object({ ritmo: z.string(), subtitulos: z.string(), broll: z.string(), musica: z.string(), efectos: z.string() }),
  emocion: z.string(),
  cta: z.string(),
  porQueSeViraliza: z.string(),
  adaptacion: z.object({ angulo: z.string(), ideasDeHook: z.array(z.string()), riesgos: z.array(z.string()) }),
  replicabilidad: z.number().describe("1 a 10: qué tan fácil es replicarlo con la marca"),
});

export const Script = z.object({
  titulo: z.string(),
  hooks: z.array(z.string()).describe("3 variantes del hook, la primera es la recomendada"),
  guion: z.array(z.object({ seccion: z.string(), texto: z.string().describe("lo que se dice, palabra por palabra"), direccion: z.string().describe("gesto, plano o acción") })),
  duracionSeg: z.number(),
  textoEnPantalla: z.array(z.string()),
  grabacion: z.object({
    plano: z.string(), luz: z.string(), audio: z.string(), energia: z.string(), locacion: z.string(), vestuario: z.string(),
    tomas: z.array(z.string()), broll: z.array(z.string()), checklist: z.array(z.string()),
  }),
});

export const Concept = z.object({
  resumen: z.string(),
  estiloGeneral: z.string(),
  hookVisual: z.string(),
  subtitulos: z.object({ fuente: z.string(), estilo: z.string(), colorAcento: z.string().describe("hex, ej #FFD400"), posicion: z.string(), animacion: z.string() }),
  paleta: z.array(z.string()).describe("colores hex"),
  momentos: z.array(z.object({ tiempo: z.string(), tipo: z.string().describe("zoom | broll | texto | sfx | corte | grafico"), descripcion: z.string() })),
  musica: z.object({ estilo: z.string(), bpm: z.string(), notas: z.string() }),
  portada: z.object({ texto: z.string(), idea: z.string() }),
  ritmo: z.string(),
});

export const Publish = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
  textoPortada: z.string(),
  primerComentario: z.string(),
  mejorMomento: z.string(),
  trialReel: z.array(z.string()).describe("recomendaciones para lanzarlo como Trial Reel y leer resultados"),
  variantesHook: z.array(z.string()),
});

export const TakePlan = z.object({
  decisiones: z.array(z.object({
    id: z.number().describe("id del segmento"),
    mantener: z.boolean(),
    motivo: z.string().describe("breve: 'mejor toma', 'repetida — se queda la #12', 'arranque en falso', 'fuera del guion', 'muletilla'…"),
  })),
  resumen: z.string().describe("1-2 frases: qué se quitó y cómo queda la historia"),
});

export const BrandGuide = z.object({
  nombre: z.string(),
  resumen: z.string().describe("2-3 frases: quién es la marca y por qué importa"),
  esencia: z.object({ proposito: z.string(), propuesta: z.string(), personalidad: z.array(z.string()), arquetipo: z.string() }),
  audiencia: z.object({ perfil: z.string(), dolores: z.array(z.string()), deseos: z.array(z.string()) }),
  voz: z.object({
    tono: z.string(), reglas: z.array(z.string()),
    usar: z.array(z.string()).describe("palabras/expresiones de la marca"),
    evitar: z.array(z.string()).describe("palabras/expresiones prohibidas"),
    ejemplos: z.array(z.string()).describe("frases de ejemplo escritas con la voz"),
  }),
  pilares: z.array(z.object({ nombre: z.string(), descripcion: z.string(), ideas: z.array(z.string()) })),
  visual: z.object({
    paleta: z.array(z.object({ nombre: z.string(), hex: z.string(), uso: z.string() })),
    tipografias: z.array(z.object({ nombre: z.string().describe("nombre exacto de Google Font si aplica"), uso: z.string() })),
    fotografia: z.string(), video: z.string(), subtitulos: z.string(), logo: z.string(),
  }),
  formatos: z.array(z.string()),
  hooksFirma: z.array(z.string()),
  ctas: z.array(z.string()),
  hacer: z.array(z.string()),
  noHacer: z.array(z.string()),
});

export const BrandProposals = z.object({ propuestas: z.array(BrandGuide) });

export type Analysis = z.infer<typeof Analysis>;
export type Script = z.infer<typeof Script>;
export type Concept = z.infer<typeof Concept>;
export type Publish = z.infer<typeof Publish>;
export type TakePlan = z.infer<typeof TakePlan>;
export type BrandGuide = z.infer<typeof BrandGuide>;
