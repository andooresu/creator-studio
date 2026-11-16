// Uso de IA: gasto del mes (real del proveedor vía Admin API o estimado por Andoo), crédito restante,
// medidor de costo por sección y por modelo, y últimas llamadas. Sin librería de gráficas.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, Settings } from "lucide-react";
import type { UsageSummary } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useApp } from "../store.tsx";
import { fmtN, PROV_LABEL, STAGE_NAME_AI } from "../ui.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils";
import { LOCALE } from "@/lib/locale.ts";

// Nombres visibles de las secciones (los ids crudos del registro no se muestran).
const SECTION_LABEL: Record<string, string> = {
  ...STAGE_NAME_AI,
  analisis: "Análisis",
  branding: "Marca",
  produccion: "Producción",
  estilos: "Estilos",
};
const sectionName = (k: string) => SECTION_LABEL[k] || k.charAt(0).toUpperCase() + k.slice(1);

// Colores de las series: tokens de gráfica y luego neutros.
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#999999", "#5c5c5c"];
const seriesColor = (i: number) => SERIES[Math.min(i, SERIES.length - 1)];

/** Dinero en dólares con formato del español del navegador: 2 decimales desde US$1, 3 por debajo. */
function usd(n: number | null | undefined): string {
  const v = n || 0;
  const d = Math.abs(v) >= 1 ? 2 : 3;
  return "US$ " + v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
}
const pctFmt = (p: number) => p.toLocaleString(LOCALE, { maximumFractionDigits: p < 10 ? 1 : 0 }) + " %";
const fmtDate = (d: string | number) =>
  new Date(d).toLocaleString(LOCALE, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
/** "2026-11" → "Noviembre 2026". */
function monthName(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  const name = new Date(y, mo - 1, 1).toLocaleString(LOCALE, { month: "long" });
  return name.charAt(0).toUpperCase() + name.slice(1) + " " + y;
}

const tile = "rounded-xl border border-border bg-surface-1 p-5 flex flex-col gap-2 min-w-0";
const tileLabel = "text-sm text-muted-foreground";
const bigNum = "text-[32px] leading-none font-semibold tracking-[-0.04em] tabular-nums text-foreground";
const sectionTitle = "text-base font-semibold tracking-[-0.02em] text-foreground";

function Chip({ tone, icon, children }: { tone: "neutral" | "success" | "warning"; icon?: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    neutral: "border-border bg-surface-2 text-foreground",
    success: "border-success/40 bg-success/10 text-success",
    warning: "border-warning/40 bg-warning/10 text-warning",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", tones[tone])}>
      {icon}
      {children}
    </span>
  );
}

/** Barra horizontal apilada de gasto por sección, a escala, con leyenda. */
function StageMeter({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!entries.length || total <= 0) return <p className="text-sm text-muted-foreground">Sin gasto este mes.</p>;
  const summary =
    "Gasto por sección: " + entries.map(([k, v]) => `${sectionName(k)} ${usd(v)} (${pctFmt((v / total) * 100)})`).join(", ") + ".";
  return (
    <div className="flex flex-col gap-4">
      <div role="img" aria-label={summary} className="flex h-4 w-full overflow-hidden rounded-full bg-surface-3">
        {entries.map(([k, v], i) => (
          <span
            key={k}
            className="h-full border-r-2 border-surface-1 last:border-r-0"
            style={{ width: `${(v / total) * 100}%`, background: seriesColor(i) }}
          />
        ))}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2" aria-hidden>
        {entries.map(([k, v], i) => (
          <li key={k} className="flex items-center gap-2 text-sm min-w-0">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(i) }} />
            <span className="truncate text-foreground">{sectionName(k)}</span>
            <span className="ml-auto shrink-0 tabular-nums text-foreground">{usd(v)}</span>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{pctFmt((v / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lista ordenada de modelos con barra proporcional al mayor gasto. */
function ModelList({ data, labelOf }: { data: Record<string, number>; labelOf: (k: string) => string }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="text-sm text-muted-foreground">Sin gasto este mes.</p>;
  const max = entries[0][1];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <ol className="flex flex-col gap-3">
      {entries.map(([k, v]) => (
        <li key={k} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2 text-sm min-w-0">
            <span className="truncate text-foreground">{labelOf(k)}</span>
            <span className="ml-auto shrink-0 tabular-nums text-foreground">{usd(v)}</span>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{pctFmt((v / total) * 100)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function LoadingView() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando el uso de IA…</span>
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function Usage() {
  const { state, refresh } = useApp();
  const [u, setU] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      setU(await api<UsageSummary>("/api/usage" + (force ? "?refresh=1" : "")));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
      void refresh().catch(() => {});
    } finally {
      setRefreshing(false);
    }
  };

  if (!u && error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px] font-semibold tracking-[-0.04em]">Uso de IA</h1>
        <div role="alert" className="rounded-xl border border-danger/40 bg-surface-1 p-5 flex flex-col gap-3">
          <p className="text-foreground">No pude cargar el uso de IA.</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div><Button variant="translucent" size="sm" onClick={() => { void load(); }}>Reintentar</Button></div>
        </div>
      </div>
    );
  }
  if (!u) return <LoadingView />;

  const pricing = state?.pricing || {};
  const modelName = (k: string) => pricing[k]?.label || k;
  const pi = u.providerInfo;
  const P = PROV_LABEL[u.provider] || u.provider;
  const real = u.source === "proveedor" && pi.available;
  const usedPct = u.credit ? (u.spent / u.credit) * 100 : 0;
  const remaining = Math.max(0, u.remaining ?? (u.credit - u.spent));
  const over = u.credit > 0 && u.spent > u.credit;
  const barTone = usedPct > 90 ? "bg-danger" : usedPct > 70 ? "bg-warning" : "bg-foreground";
  const adminKeyWhere = u.provider === "openai" ? "platform.openai.com → Settings → Admin keys" : "console.anthropic.com → Settings → Admin keys";
  // El resumen no dice si hay Admin key: el servidor (server/ai.ts) solo usa este motivo cuando falta. Cualquier otro
  // motivo es un error real al consultar al proveedor (key inválida, sin permisos, red…) y se muestra tal cual.
  const noAdminKey = !pi.reason || /^Agrega la Admin key/i.test(pi.reason);

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* Encabezado */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1 grow min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-foreground">Uso de IA</h1>
            <p className="text-sm text-muted-foreground">{monthName(u.month)}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => { void onRefresh(); }} disabled={refreshing} aria-label="Actualizar datos de uso">
            <RefreshCw className={cn("size-4", refreshing && "motion-safe:animate-spin")} aria-hidden />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="neutral">Proveedor: {P}</Chip>
          {real ? (
            <Chip tone="success" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>Gasto real del proveedor</Chip>
          ) : (
            <Chip tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>Estimado por Andoo</Chip>
          )}
        </div>
        {real ? (
          <p className="text-sm text-muted-foreground">
            Leído de la Admin API de {P}. Incluye lo que gastes fuera de Andoo.
            {pi.refreshedAt ? ` Datos completos hasta ${fmtDate(pi.refreshedAt)}.` : ""}
            {pi.note ? ` ${pi.note}` : ""}
          </p>
        ) : (
          <div className="rounded-xl border border-warning/30 bg-surface-1 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Info className="size-4 shrink-0 text-warning hidden sm:block" aria-hidden />
            <p className="text-sm text-muted-foreground grow">
              Calculo el gasto con las llamadas que hace Andoo y los precios públicos de {P}. No incluye lo que gastes fuera de Andoo.
              {noAdminKey
                ? ` Para ver el gasto real, agrega la Admin key de ${P} (${adminKeyWhere}).`
                : <> No pude leer el gasto real de {P}: <span className="text-foreground">{pi.reason}</span>. Revisa la Admin key en Ajustes o pulsa Actualizar.</>}
              {pi.note ? ` ${pi.note}` : ""}
            </p>
            <a href="#/ajustes" className={cn(buttonVariants({ variant: "translucent", size: "sm" }), "shrink-0 self-start sm:self-auto")}>
              <Settings className="size-4" aria-hidden />{noAdminKey ? "Agregar Admin key" : "Revisar Admin key"}
            </a>
          </div>
        )}
      </header>

      {/* Resumen: 3 tarjetas */}
      <section aria-label="Resumen del mes" className="grid gap-4 md:grid-cols-3">
        <div className={tile}>
          <span className={tileLabel}>Gastado este mes</span>
          <span className={bigNum}>{usd(u.spent)}</span>
          <span className="text-sm text-muted-foreground">
            {real ? `Desde Andoo: ${usd(u.studioSpent)}` : "Según el registro de Andoo"}
          </span>
        </div>

        {u.credit ? (
          <div className={tile}>
            <span className={tileLabel}>Te queda</span>
            <span className={cn(bigNum, over && "text-danger")}>{usd(remaining)}</span>
            <div
              role="progressbar"
              aria-label="Crédito usado este mes"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(100, usedPct))}
              aria-valuetext={`${pctFmt(usedPct)} usado de ${usd(u.credit)}`}
              className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
            >
              <span className={cn("block h-full rounded-full", barTone)} style={{ width: `${Math.min(100, usedPct)}%` }} />
            </div>
            <span className={cn("text-sm", usedPct > 90 ? "text-danger" : usedPct > 70 ? "text-warning" : "text-muted-foreground")}>
              {over
                ? `Superaste tu límite de ${usd(u.credit)} por ${usd(u.spent - u.credit)}`
                : `Usaste ${pctFmt(usedPct)} de ${usd(u.credit)}`}
            </span>
          </div>
        ) : (
          <div className={tile}>
            <span className={tileLabel}>Te queda</span>
            <p className="text-sm text-muted-foreground">Pon un límite mensual y te muestro cuánto te queda y cuándo te acercas.</p>
            <a href="#/ajustes" className={cn(buttonVariants({ variant: "translucent", size: "sm" }), "self-start mt-auto")}>
              <Settings className="size-4" aria-hidden />Poner límite en Ajustes
            </a>
          </div>
        )}

        <div className={tile}>
          <span className={tileLabel}>Llamadas</span>
          <span className={bigNum}>{u.calls.toLocaleString(LOCALE)}</span>
          <span className="text-sm text-muted-foreground">
            <abbr title="tokens de entrada" className="no-underline">{fmtN(u.tokensIn)}</abbr> tokens de entrada ·{" "}
            <abbr title="tokens de salida" className="no-underline">{fmtN(u.tokensOut)}</abbr> de salida
          </span>
          {u.cacheHitRate !== null && u.cacheHitRate !== undefined ? (
            <span className="text-sm text-muted-foreground" title="Parte de la entrada que se leyó de la caché del proveedor: cuesta una fracción del precio normal.">
              {Math.round(u.cacheHitRate * 100)} % de la entrada desde la caché
            </span>
          ) : null}
        </div>
      </section>
      <p className="-mt-3 text-sm text-muted-foreground">
        «Te queda» = crédito que pusiste − gasto del mes. Los proveedores no exponen el saldo real por API.
      </p>

      {/* Medidor de costo */}
      <section aria-labelledby="usage-breakdown" className="grid gap-4 lg:grid-cols-2">
        <h2 id="usage-breakdown" className="sr-only">Desglose del gasto</h2>
        <div className={cn(tile, "gap-4")}>
          <div className="flex flex-col gap-0.5">
            <h3 className={sectionTitle}>Por sección</h3>
            <p className="text-sm text-muted-foreground">Gasto desde Andoo: {usd(u.studioSpent)}</p>
          </div>
          <StageMeter data={u.byStage} />
        </div>
        <div className={cn(tile, "gap-4")}>
          <div className="flex flex-col gap-0.5">
            <h3 className={sectionTitle}>Por modelo</h3>
            <p className="text-sm text-muted-foreground">Ordenado de mayor a menor gasto</p>
          </div>
          <ModelList data={u.byModel} labelOf={modelName} />
        </div>
      </section>

      {/* Últimas llamadas */}
      <section aria-labelledby="usage-recent" className={cn(tile, "gap-4 p-0")}>
        <div className="px-5 pt-5">
          <h2 id="usage-recent" className={sectionTitle}>Últimas llamadas</h2>
        </div>
        {u.recent.length ? (
          <div className="overflow-x-auto pb-2" tabIndex={0} aria-label="Tabla de últimas llamadas, desplázala si no cabe">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="px-5 py-2 font-medium">Fecha</th>
                  <th scope="col" className="px-3 py-2 font-medium">Sección</th>
                  <th scope="col" className="px-3 py-2 font-medium">Modelo</th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">Entrada</th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">Salida</th>
                  <th scope="col" className="px-5 py-2 font-medium text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {u.recent.map((r) => (
                  <tr key={r.id} className="even:bg-surface-2">
                    <td className="px-5 py-2.5 whitespace-nowrap text-foreground">{fmtDate(r.at)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-foreground">{sectionName(r.stage)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{modelName(r.model)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{r.inputTokens.toLocaleString(LOCALE)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{r.outputTokens.toLocaleString(LOCALE)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums whitespace-nowrap text-foreground">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 pb-5 text-sm text-muted-foreground">Aún no hay llamadas este mes. Cuando el productor trabaje, las verás aquí.</p>
        )}
      </section>
    </div>
  );
}
