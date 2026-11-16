// Capa de IA multi-proveedor (Claude / OpenAI) con registro por llamada
// y lectura del gasto real directo del proveedor (Admin API).
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { load, save, id } from "./db.ts";
import type { AiStage, Effort, ModelPrice, Provider, ProviderSpend, UsageSummary } from "../shared/types.ts";

// USD por millón de tokens. Claude: tarifas API Anthropic (nov-2026).
// OpenAI: editables en Ajustes — verifica en openai.com/api/pricing.
export const MODELS: Record<Provider, Record<string, ModelPrice>> = {
  anthropic: {
    "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, label: "Claude Opus 5.5" },
    "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, label: "Claude Sonnet 5.5" },
    "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, label: "Claude Haiku 5.5" },
    "claude-fable-5-2": { in: 8, out: 40, cacheRead: 0.2, label: "Claude Fable 5.2" },
  },
  openai: {
    "gpt-5": { in: 1.25, out: 10, cacheRead: 0.125, label: "GPT-5" },
    "gpt-5-mini": { in: 0.25, out: 2, cacheRead: 0.025, label: "GPT-5 mini" },
  },
};
// modelos a los que puede caer el fallback del servidor de Anthropic
const EXTRA: Record<string, ModelPrice> = {
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5, label: "Claude Opus 5" },
  "claude-opus-4-8": { in: 5, out: 25, cacheRead: 0.5, label: "Claude Opus 4.8" },
  "claude-sonnet-5": { in: 2, out: 10, cacheRead: 0.2, label: "Claude Sonnet 5" },
};

export function priceTable(): Record<string, ModelPrice> {
  const s = load().settings;
  const t: Record<string, ModelPrice> = { ...MODELS.anthropic, ...EXTRA, ...MODELS.openai };
  for (const [m, p] of Object.entries(s.customPrices || {})) t[m] = { ...(t[m] || { label: m }), ...p } as ModelPrice;
  return t;
}

function priceFor(model: string): ModelPrice {
  const t = priceTable();
  if (t[model]) return t[model];
  const base = Object.keys(t).find((k) => model.startsWith(k)); // ej. gpt-5-2025-08-07
  return (base && t[base]) || { in: 0, out: 0, cacheRead: 0, label: model };
}

/** cacheWrite = escrituras de 5 min (1.25× la entrada); cacheWrite1h = escrituras de 1 hora (2×). */
export interface TokenUsage { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cacheWrite1h?: number }

const isHaiku = (model: string): boolean => model.startsWith("claude-haiku");

export function costOf(model: string, u: TokenUsage): number {
  let p = priceFor(model);
  // Claude Haiku 5.5 cobra 5× en todo cuando el prompt pasa de 100.000 tokens (tarifa de contexto largo)
  const prompt = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) + (u.cacheWrite1h || 0);
  if (model.startsWith("claude-haiku-5-5") && prompt > 100_000 && !load().settings.customPrices?.[model]) p = { ...p, in: p.in * 5, out: p.out * 5, cacheRead: p.cacheRead * 5 };
  return ((u.input || 0) * p.in + (u.output || 0) * p.out + (u.cacheRead || 0) * p.cacheRead + (u.cacheWrite || 0) * p.in * 1.25 + (u.cacheWrite1h || 0) * p.in * 2) / 1e6;
}

export function monthKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}

const keyOf = (prov: Provider): string | undefined => {
  const s = load().settings;
  return prov === "openai" ? s.openaiKey || process.env.OPENAI_API_KEY : s.apiKey || process.env.ANTHROPIC_API_KEY;
};
export const hasKey = (prov: Provider = load().settings.provider): boolean => Boolean(keyOf(prov));

// ---------- Gasto real del proveedor (Admin API) ----------
type SpendData = { spent: number; refreshedAt: string | null; note: string };
const providerCache: Partial<Record<Provider, { at: number; data: ProviderSpend }>> = {};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface AnthropicCostPage { data?: { amount?: string | number }[]; data_refreshed_at?: string; has_more?: boolean; next_page?: string; error?: { message?: string } }
interface OpenAICostPage { data?: { results?: { amount?: { value?: number | string } }[] }[]; has_more?: boolean; next_page?: string; error?: { message?: string } }

async function anthropicSpend(adminKey: string): Promise<SpendData> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const qs = new URLSearchParams({ starting_at: start.toISOString(), ending_at: now.toISOString(), limit: "1000" });
  let total = 0;
  let refreshed: string | null = null;
  let page: string | null = null;
  do {
    if (page) qs.set("page", page);
    const r = await fetch(`https://api.anthropic.com/v1/organizations/analytics/cost?${qs}`, {
      headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01", "anthropic-beta": "analytics-usage-cost-2026-08-24" },
    });
    const j = (await r.json().catch(() => ({}))) as AnthropicCostPage;
    if (!r.ok) throw new Error(j?.error?.message || `Anthropic respondió ${r.status}`);
    for (const row of j.data || []) total += parseFloat(String(row.amount || 0)) / 100; // centavos → USD
    refreshed = j.data_refreshed_at || refreshed;
    page = j.has_more ? j.next_page || null : null;
  } while (page);
  return { spent: total, refreshedAt: refreshed, note: "Costo tras descuentos y antes de créditos. Retraso típico 4-24 h." };
}

async function openaiSpend(adminKey: string): Promise<SpendData> {
  const now = new Date();
  const start = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
  let total = 0;
  let page: string | null = null;
  do {
    const qs = new URLSearchParams({ start_time: String(start), bucket_width: "1d", limit: "31" });
    if (page) qs.set("page", page);
    const r = await fetch(`https://api.openai.com/v1/organization/costs?${qs}`, { headers: { Authorization: `Bearer ${adminKey}` } });
    const j = (await r.json().catch(() => ({}))) as OpenAICostPage;
    if (!r.ok) throw new Error(j?.error?.message || `OpenAI respondió ${r.status}`);
    for (const b of j.data || []) for (const res of b.results || []) total += Number(res.amount?.value || 0);
    page = j.has_more ? j.next_page || null : null;
  } while (page);
  return { spent: total, refreshedAt: new Date().toISOString(), note: "Costos de la organización en OpenAI (agrupados por día)." };
}

export async function providerSpend(force = false): Promise<ProviderSpend> {
  const s = load().settings;
  const prov = s.provider;
  const adminKey = prov === "openai" ? s.openaiAdminKey : s.anthropicAdminKey;
  if (!adminKey) return { provider: prov, available: false, reason: "Agrega la Admin key del proveedor en Ajustes para leer el gasto real." };
  const c = providerCache[prov];
  if (!force && c && Date.now() - c.at < 10 * 60 * 1000) return c.data;
  try {
    const d = prov === "openai" ? await openaiSpend(adminKey) : await anthropicSpend(adminKey);
    const data: ProviderSpend = { provider: prov, available: true, ...d, fetchedAt: new Date().toISOString() };
    providerCache[prov] = { at: Date.now(), data };
    return data;
  } catch (e) {
    return { provider: prov, available: false, reason: errMsg(e) };
  }
}

export async function usageSummary({ force = false }: { force?: boolean } = {}): Promise<UsageSummary> {
  const db = load();
  const s = db.settings;
  const mk = monthKey();
  const month = db.usage.filter((u) => u.at.startsWith(mk));
  const local = month.filter((u) => (u.provider || "anthropic") === s.provider);
  const studioSpent = local.reduce((a, u) => a + u.cost, 0);
  const byStage: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  for (const u of local) {
    byStage[u.stage] = (byStage[u.stage] || 0) + u.cost;
    byModel[u.model] = (byModel[u.model] || 0) + u.cost;
  }
  // tasa de caché: solo las llamadas que ya registran lectura/escritura de caché
  const tracked = local.filter((u) => u.cacheRead !== undefined);
  const trackedIn = tracked.reduce((a, u) => a + u.inputTokens, 0);
  const prov = await providerSpend(force);
  // Igual que el original: si el proveedor está disponible se usa su gasto (spent siempre viene definido en ese caso).
  const spent = prov.available ? (prov.spent as number) : studioSpent;
  const credit = Number(s.credits?.[s.provider] ?? 0);
  return {
    provider: s.provider,
    month: mk,
    source: prov.available ? "proveedor" : "estudio",
    providerInfo: prov,
    spent,
    studioSpent,
    credit,
    remaining: credit ? credit - spent : null,
    calls: local.length,
    tokensIn: local.reduce((a, u) => a + u.inputTokens, 0),
    tokensOut: local.reduce((a, u) => a + u.outputTokens, 0),
    tokensCacheRead: tracked.reduce((a, u) => a + (u.cacheRead || 0), 0),
    cacheHitRate: trackedIn ? tracked.reduce((a, u) => a + (u.cacheRead || 0), 0) / trackedIn : null,
    byStage,
    byModel,
    recent: db.usage.slice(-60).reverse(),
    keySet: hasKey(s.provider),
  };
}

// ---------- Conversión de contenido neutral → formato de cada proveedor ----------
/** Contenido neutral: {type:"text",text} | {type:"image",data(base64 jpg/png),mime} | {type:"pdf",data,name} */
export type ContentBlock =
  | { type: "text"; text: string; /** fin de una parte estable: punto de caché (solo Claude) */ cache?: boolean }
  | { type: "image"; data: string; mime?: string }
  | { type: "pdf"; data: string; name?: string };

type AnthropicImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toAnthropic(content: ContentBlock[], cache: Anthropic.Beta.BetaCacheControlEphemeral): Anthropic.Beta.BetaContentBlockParam[] {
  return content.map((b): Anthropic.Beta.BetaContentBlockParam => {
    if (b.type === "text" && b.cache) return { type: "text", text: b.text, cache_control: cache };
    if (b.type === "image") return { type: "image", source: { type: "base64", media_type: (b.mime || "image/jpeg") as AnthropicImageMime, data: b.data } };
    if (b.type === "pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.data } };
    return { type: "text", text: b.text };
  });
}
function toOpenAI(content: ContentBlock[]): OpenAI.Chat.ChatCompletionContentPart[] {
  return content.map((b): OpenAI.Chat.ChatCompletionContentPart => {
    if (b.type === "image") return { type: "image_url", image_url: { url: `data:${b.mime || "image/jpeg"};base64,${b.data}` } };
    if (b.type === "pdf") return { type: "file", file: { filename: b.name || "doc.pdf", file_data: `data:application/pdf;base64,${b.data}` } };
    return { type: "text", text: b.text };
  });
}

type CacheTtl = "5m" | "1h";
interface CallArgs { model: string; system: string; content: ContentBlock[]; schema: z.ZodType; maxTokens: number; effort: Effort; cacheTtl: CacheTtl }
interface CallResult { model: string; text: string; usage: Required<TokenUsage> }

const errStatus = (e: unknown): number | undefined => (typeof e === "object" && e !== null && "status" in e ? (e as { status?: number }).status : undefined);

/** Formato JSON de salida sin la función parse que agrega zodOutputFormat (la respuesta se valida aparte). */
function jsonFormat(schema: z.ZodType): { type: "json_schema"; schema: Record<string, unknown> } {
  const f = zodOutputFormat(schema) as unknown as { type: "json_schema"; schema: Record<string, unknown> };
  return { type: f.type, schema: f.schema };
}

async function callAnthropic({ model, system, content, schema, maxTokens, effort, cacheTtl }: CallArgs): Promise<CallResult> {
  const ws = load().settings.anthropicWorkspaceId;
  const client = new Anthropic({ apiKey: keyOf("anthropic"), ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}) });
  // El mismo TTL en todos los puntos de caché (la API exige que los de 1 h vayan antes que los de 5 min).
  const cache: Anthropic.Beta.BetaCacheControlEphemeral = cacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  const params = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text" as const, text: system, cache_control: cache }],
    messages: [{ role: "user" as const, content: toAnthropic(content, cache) }],
    // Sin la función parse del SDK: el texto se valida después (así un corte por max_tokens llega a nuestro aviso en español).
    output_config: { effort, format: jsonFormat(schema) },
  };
  // Siempre en streaming (.finalMessage()): el SDK rechaza peticiones sin stream con max_tokens grandes
  // ("Streaming is required for operations that may take longer than 10 minutes").
  let res: Anthropic.Beta.BetaMessage | Anthropic.Message;
  // Claude Haiku no tiene fallback del servidor: no se le envía el parámetro.
  const haiku = isHaiku(model);
  try {
    // Fallback del servidor: si un clasificador de seguridad rechaza, otro modelo continúa.
    res = haiku
      ? await client.messages.stream(params as unknown as Anthropic.Messages.MessageStreamParams).finalMessage()
      : await client.beta.messages
        .stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)
        .finalMessage();
  } catch (e) {
    if (/not scoped to a workspace|anthropic-workspace-id/i.test(errMsg(e))) throw new Error("Tu API key es de organización y necesita el Workspace ID: cópialo en console.anthropic.com → Settings → Workspaces (empieza con wrkspc_) y pégalo en Ajustes → Claude (Anthropic).");
    if (!haiku && errStatus(e) === 400 && /fallback/i.test(errMsg(e))) res = await client.messages.stream(params as unknown as Anthropic.Messages.MessageStreamParams).finalMessage();
    else throw e;
  }
  if (res.stop_reason === "refusal") {
    throw new Error(haiku
      ? "Claude Haiku declinó esta solicitud. Reintenta, ajusta el contenido o elige otro modelo para esta etapa en Ajustes → IA."
      : "Claude declinó esta solicitud. Ajusta el contenido o el feedback.");
  }
  if (res.stop_reason === "max_tokens") throw new Error("La respuesta se cortó por longitud. Intenta de nuevo.");
  const u = (res.usage || {}) as {
    input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
  };
  const written = u.cache_creation_input_tokens || 0;
  const w1h = Math.min(written, u.cache_creation?.ephemeral_1h_input_tokens || 0);
  const blocks = res.content as { type: string; text?: string }[];
  return {
    model: res.model || model,
    text: blocks.filter((b) => b.type === "text").map((b) => b.text || "").join(""),
    usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: written - w1h, cacheWrite1h: w1h },
  };
}

async function callOpenAI({ model, system, content, schema, maxTokens, effort }: CallArgs): Promise<CallResult> {
  const client = new OpenAI({ apiKey: keyOf("openai") });
  const efforts: Record<string, OpenAI.ReasoningEffort> = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };
  const res = await client.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    reasoning_effort: efforts[effort] || "medium",
    messages: [{ role: "system", content: system }, { role: "user", content: toOpenAI(content) }],
    response_format: { type: "json_schema", json_schema: { name: "respuesta", strict: true, schema: zodOutputFormat(schema).schema as Record<string, unknown> } },
  });
  const ch = res.choices[0];
  if (ch.message.refusal) throw new Error("OpenAI declinó esta solicitud: " + ch.message.refusal);
  if (ch.finish_reason === "length") throw new Error("La respuesta se cortó por longitud. Intenta de nuevo.");
  const u: Partial<OpenAI.CompletionUsage> = res.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return { model: res.model || model, text: ch.message.content || "", usage: { input: (u.prompt_tokens || 0) - cached, output: u.completion_tokens || 0, cacheRead: cached, cacheWrite: 0, cacheWrite1h: 0 } };
}

export interface AskOptions<S extends z.ZodType> {
  stage: AiStage;
  projectId?: string;
  system: string;
  content: ContentBlock[];
  schema: S;
  maxTokens?: number;
  /** "1h" cuando el usuario suele tardar entre 5 y 60 min en volver (iterar con feedback): la caché de 1 hora
   *  cuesta 2× al escribir en vez de 1.25×, pero evita reescribir el prefijo en cada vuelta. */
  cacheTtl?: CacheTtl;
}

/**
 * Llamada con salida estructurada (Zod). stage = analisis | guion | concepto | publicar | branding | inspiracion
 */
export async function ask<S extends z.ZodType>({ stage, projectId, system, content, schema, maxTokens = 16000, cacheTtl = "5m" }: AskOptions<S>): Promise<z.infer<S>> {
  const db = load();
  const s = db.settings;
  const prov: Provider = s.provider || "anthropic";
  if (!hasKey(prov)) throw new Error(`Falta tu API key de ${prov === "openai" ? "OpenAI" : "Anthropic"}. Agrégala en Ajustes.`);
  const sum = await usageSummary();
  if (s.hardStop && sum.credit && sum.spent >= sum.credit) {
    throw new Error(`Crédito del mes agotado ($${sum.spent.toFixed(2)} de $${sum.credit}). Ajústalo en Ajustes o desactiva el freno.`);
  }
  const provModels = s.models?.[prov] as (Partial<Record<AiStage, string>> & { default?: string }) | undefined;
  const model = provModels?.[stage] || provModels?.default || Object.keys(MODELS[prov])[0];
  const started = Date.now();
  const r = await (prov === "openai" ? callOpenAI : callAnthropic)({ model, system, content, schema, maxTokens, effort: s.efforts?.[stage] || s.effort || "medium", cacheTtl });
  db.usage.push({
    id: id(), at: new Date().toISOString(), provider: prov, stage, projectId, model: r.model,
    inputTokens: r.usage.input + r.usage.cacheRead + r.usage.cacheWrite + r.usage.cacheWrite1h, outputTokens: r.usage.output,
    cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite + r.usage.cacheWrite1h,
    cost: costOf(r.model, r.usage), ms: Date.now() - started,
  });
  save();
  try {
    return schema.parse(JSON.parse(r.text)) as z.infer<S>;
  } catch {
    throw new Error("No pude leer la respuesta estructurada del modelo. Reintenta.");
  }
}
