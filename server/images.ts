// Generación de imágenes de apoyo (entrega 4) con OpenAI gpt-image, usando la clave de OpenAI de Ajustes.
// Solo se llama desde la ruta «Generar» (clic del usuario); nunca desde la propuesta ni desde el agente.
// Para pruebas sin gastar crédito: STUDIO_OPENAI_IMAGE_BASE_URL apunta a un servidor local falso
// (no se usa OPENAI_BASE_URL porque también desviaría las llamadas de texto).
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { openaiKey, imageCostOf } from "./ai.ts";
import type { ImageQuality, ImageUsage } from "./ai.ts";
import { getBrand } from "./db.ts";
import type { Apoyo, Project } from "../shared/types.ts";

/** Reglas de estilo del dueño que acompañan cada prompt de imagen. */
export const IMAGE_STYLE_RULES = "Estilo: ilustración limpia o motion graphics, plana o semi-plana, composición simple y legible en un celular. Nada de resultados falsos (antes/después, métricas, testimonios, capturas que finjan ser paneles o pantallas reales), ninguna cara de persona real, ningún texto legible ni logotipos.";

/** Prompt final: el del apoyo + reglas de estilo + paleta y fotografía de la marca activa (si es una guía real) + formato. */
export function composeImagePrompt(project: Project, apoyo: Pick<Apoyo, "prompt">): string {
  const parts = [apoyo.prompt.trim(), IMAGE_STYLE_RULES];
  const g = getBrand(project.brandId)?.guide;
  if (g) {
    const hex = (g.visual?.paleta || []).map((c) => c.hex).filter((h) => /^#[0-9a-f]{3,8}$/i.test(h || ""));
    if (hex.length) parts.push(`Paleta de la marca: ${hex.join(", ")}.`);
    if (g.visual?.fotografia?.trim()) parts.push(`Dirección visual de la marca: ${g.visual.fotografia.trim()}`);
  }
  parts.push("Formato vertical 9:16, sin texto legible.");
  return parts.join("\n").slice(0, 32000);
}

export interface GenerateImageArgs {
  prompt: string;
  model: string;
  quality: ImageQuality;
  /** p. ej. "1024x1536" (vertical) */
  size: "1024x1536" | "1536x1024" | "1024x1024";
  /** ruta absoluta del PNG a escribir */
  outAbs: string;
}
export interface GenerateImageResult { model: string; usage?: ImageUsage; costUsd: number; ms: number }

/** Error de generación. billed = OpenAI pudo haber cobrado la imagen (llegó la respuesta pero no sirve, o la conexión
 *  se cortó sin saber si terminó): quien llama registra el precio estimado. */
export class ImageGenError extends Error {
  billed: boolean;
  constructor(message: string, billed: boolean) { super(message); this.name = "ImageGenError"; this.billed = billed; }
}

export async function generateImage({ prompt, model, quality, size, outAbs }: GenerateImageArgs): Promise<GenerateImageResult> {
  const apiKey = openaiKey();
  if (!apiKey) throw new Error("Falta la clave de OpenAI: agrégala en Ajustes → Imágenes de apoyo.");
  // sin reintentos automáticos: images.generate no es idempotente y un reintento tras un corte se cobraría dos veces
  // con una sola fila de uso. El usuario reintenta con «Reintentar», que vuelve a pasar por el freno de crédito.
  const client = new OpenAI({ apiKey, baseURL: process.env.STUDIO_OPENAI_IMAGE_BASE_URL || undefined, maxRetries: 0, timeout: 5 * 60 * 1000 });
  const started = Date.now();
  let r: OpenAI.Images.ImagesResponse;
  try {
    // gpt-image siempre devuelve b64_json: no se pasa response_format
    r = await client.images.generate({ model, prompt, size, quality, output_format: "png", n: 1 });
  } catch (e) {
    throw new ImageGenError(friendly(e), mayHaveBeenBilled(e));
  }
  // desde aquí la respuesta llegó: la imagen ya se cobró aunque no sirva
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new ImageGenError("OpenAI no devolvió ninguna imagen. Intenta de nuevo.", true);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new ImageGenError("La imagen recibida no es un PNG válido. Intenta de nuevo.", true);
  const tmp = outAbs + ".part";
  try {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, outAbs);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw new ImageGenError("No se pudo guardar la imagen en la carpeta del proyecto: " + (e instanceof Error ? e.message : String(e)).slice(0, 160), true);
  }
  const usage = (r.usage || undefined) as ImageUsage | undefined;
  return { model, ...(usage ? { usage } : {}), costUsd: imageCostOf(model, quality, usage), ms: Date.now() - started };
}

// Códigos de red que significan que la solicitud nunca llegó a OpenAI (sin conexión, DNS, puerto cerrado, TLS):
// OpenAI no pudo cobrar nada, así que no se registra costo estimado.
const NEVER_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ENETDOWN", "EADDRNOTAVAIL", "UND_ERR_CONNECT_TIMEOUT"]);
const TLS_CODE = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_CERT)/;

/** Código de red del error (OpenAI envuelve el error de fetch, que a su vez envuelve el del socket). */
function netCode(e: unknown): string | undefined {
  let x: unknown = e;
  for (let i = 0; i < 6 && x && typeof x === "object"; i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    x = (x as { cause?: unknown }).cause;
  }
  return undefined;
}

/** ¿Pudo OpenAI haber cobrado la imagen? Con una respuesta HTTP de error, no. Si la conexión nunca se abrió (sin red,
 *  DNS, conexión rechazada, TLS), tampoco. Si se agotó el tiempo o la conexión se cortó después de enviar, puede que sí. */
function mayHaveBeenBilled(e: unknown): boolean {
  const status = typeof e === "object" && e && "status" in e ? (e as { status?: unknown }).status : undefined;
  if (typeof status === "number") return false;
  if (e instanceof OpenAI.APIConnectionTimeoutError) return true;
  const code = netCode(e);
  if (code && (NEVER_SENT.has(code) || TLS_CODE.test(code))) return false;
  return true;
}

function friendly(e: unknown): string {
  const status = typeof e === "object" && e && "status" in e ? (e as { status?: number }).status : undefined;
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401) return "OpenAI rechazó la clave (401). Revísala en Ajustes → Imágenes de apoyo.";
  if (status === 403) return "Tu cuenta de OpenAI no tiene acceso a este modelo de imagen (403). Puede requerir verificar la organización o elegir otro modelo en Ajustes.";
  if (status === 429) return "OpenAI limitó las solicitudes o no hay saldo (429). Espera un momento o revisa tu saldo en OpenAI.";
  if (status === 400 && /safety|moderation|policy/i.test(msg)) return "OpenAI rechazó la descripción por sus políticas de contenido. Ajusta el prompt del apoyo.";
  if (status === 400) return "OpenAI rechazó la solicitud: " + msg.slice(0, 200);
  const code = typeof status === "number" ? undefined : netCode(e);
  if (code && (NEVER_SENT.has(code) || TLS_CODE.test(code))) return `No se pudo conectar con OpenAI (${code}): revisa tu conexión a internet e intenta de nuevo. No se cobró nada.`;
  return "No se pudo generar la imagen: " + msg.slice(0, 200);
}
