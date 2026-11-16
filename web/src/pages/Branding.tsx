// Marca: guías de marca (tarjetas arriba), generador con IA (fuentes → propuestas) y vista/edición de una guía.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from "react";
import {
  ChevronDown, ChevronUp, Copy, Download, Eye, KeyRound, Pencil, Plus, RotateCcw, Sparkles, Star, Trash2, Upload, X,
} from "lucide-react";
import type { Brand, BrandSource, BrandsResponse, Job } from "../../../shared/types.ts";
import type { BrandGuide } from "../../../shared/schemas.ts";
import { api } from "../api.ts";
import { useApp, useLeaveGuard, usePoll } from "../store.tsx";
import { JobBanner, List } from "../ui.tsx";
import { Button, buttonVariants } from "@/components/ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils";
import { LOCALE } from "@/lib/locale.ts";

const linesOf = (a: string[] | undefined): string => (a || []).join("\n");
const toLines = (t: unknown): string[] => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);

// Como en la versión original, las fuentes del generador y el modo edición sobreviven a la navegación
// entre guías (la página se vuelve a montar al cambiar de ruta).
let brandSourcesMem: BrandSource[] = [];
let brandEditMem = false;

type SrcType = "url" | "instagram" | "text" | "file";
type ValueSrcType = Exclude<SrcType, "file">;
const SRC_PH: Partial<Record<SrcType, string>> = { url: "https://tusitio.com", instagram: "@usuario o link del perfil", text: "Describe la marca, audiencia, tono…" };
const SRC_LABEL: Record<BrandSource["type"], string> = { url: "Web", instagram: "Perfil", text: "Brief", pdf: "PDF", image: "Imagen" };
const SRC_OPTION: Record<SrcType, string> = { url: "Página web", instagram: "Instagram / TikTok", text: "Brief en texto", file: "PDF o imagen" };

const CARD = "rounded-xl border border-border bg-surface-1 p-5";
const FIELD_HINT = "mt-1 text-xs text-muted-foreground";

const fmtDate = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
};

// ---------- Contraste WCAG ----------
const HEX_RE = /^#[0-9a-f]{6}$/i;
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Carga (o reemplaza) la hoja de Google Fonts con las familias de la guía. */
export function loadFonts(names: string[]): void {
  const fams = names.filter(Boolean).map((n) => "family=" + encodeURIComponent(n).replace(/%20/g, "+") + ":wght@400;700").join("&");
  if (!fams) return;
  let l = document.getElementById("brandFonts") as HTMLLinkElement | null;
  if (!l) { l = document.createElement("link"); l.id = "brandFonts"; l.rel = "stylesheet"; document.head.appendChild(l); }
  l.href = `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}

/** Vista completa de una guía de marca (portada, esencia, paleta, voz, pilares…). */
export function GuideView({ g }: { g: BrandGuide }) {
  const fontKey = g.visual.tipografias.map((t) => t.nombre).join("|");
  useEffect(() => { loadFonts(g.visual.tipografias.map((t) => t.nombre)); }, [fontKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const c1 = g.visual.paleta[0]?.hex || "#ffd400", c2 = g.visual.paleta[1]?.hex || "#111";
  const f1 = g.visual.tipografias[0]?.nombre || "Space Grotesk";
  return (
    <>
      <div className="brand-cover" style={{ background: `linear-gradient(135deg, ${c2}, #0b0b0d 70%)`, borderColor: `${c1}55` }}>
        <div className="small" style={{ color: c1, letterSpacing: ".12em", textTransform: "uppercase" }}>Guía de marca</div>
        <div role="heading" aria-level={2} className="break-words" style={{ font: `700 clamp(30px, 7vw, 44px)/1.05 '${f1}', var(--display)`, margin: "8px 0" }}>{g.nombre}</div>
        <p style={{ maxWidth: 720, opacity: 0.85 }}>{g.resumen}</p>
        <p className="small">{g.esencia.personalidad.map((x, i) => <span key={i}>{i ? " " : null}<span className="tag" style={{ borderColor: `${c1}66`, color: c1 }}>{x}</span></span>)}</p>
      </div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <div className="card"><h3>Esencia</h3><p><b>Propósito:</b> {g.esencia.proposito}</p><p><b>Propuesta:</b> {g.esencia.propuesta}</p><p><b>Arquetipo:</b> {g.esencia.arquetipo}</p></div>
        <div className="card"><h3>Audiencia</h3><p>{g.audiencia.perfil}</p><div className="grid2"><div><b className="small">Dolores</b><List items={g.audiencia.dolores} /></div><div><b className="small">Deseos</b><List items={g.audiencia.deseos} /></div></div></div>
      </div>
      <div className="card"><h3>Paleta</h3><div className="palette">{g.visual.paleta.map((c, i) => (
        <div className="pal" key={i}><div className="pal-sw" style={{ background: c.hex }} /><b>{c.nombre}</b><span className="small muted">{c.hex}</span><span className="small muted">{c.uso}</span></div>
      ))}</div></div>
      <div className="grid2">
        <div className="card"><h3>Tipografía</h3>{g.visual.tipografias.map((t, i) => (
          <div style={{ margin: "8px 0" }} key={i}><div className="break-words" style={{ font: `700 28px '${t.nombre}', var(--display)` }}>{t.nombre} — Aa Bb 123</div><span className="small muted">{t.uso}</span></div>
        ))}</div>
        <div className="card"><h3>Dirección visual</h3>
          <p><b>Foto:</b> <span className="muted">{g.visual.fotografia}</span></p>
          <p><b>Video:</b> <span className="muted">{g.visual.video}</span></p>
          <p><b>Subtítulos:</b> <span className="muted">{g.visual.subtitulos}</span></p>
          <p><b>Logo:</b> <span className="muted">{g.visual.logo}</span></p>
        </div>
      </div>
      <div className="card"><h3>Voz · {g.voz.tono}</h3>
        <div className="grid3"><div><b className="small">Reglas</b><List items={g.voz.reglas} /></div><div><b className="small" style={{ color: "var(--ok)" }}>Usar</b><List items={g.voz.usar} /></div><div><b className="small" style={{ color: "var(--bad)" }}>Evitar</b><List items={g.voz.evitar} /></div></div>
        <b className="small">Así suena</b>{g.voz.ejemplos.map((x, i) => <p key={i} className="hook-quote" style={{ fontSize: 17, margin: "6px 0" }}>“{x}”</p>)}
      </div>
      <div className="card"><h3>Pilares de contenido</h3><div className="grid3">{g.pilares.map((p, i) => (
        <div className="card" style={{ background: "var(--panel-2)" }} key={i}><b>{p.nombre}</b><p className="small muted">{p.descripcion}</p><List items={p.ideas} /></div>
      ))}</div></div>
      <div className="grid3">
        <div className="card"><h3>Hooks firma</h3><List items={g.hooksFirma} /></div>
        <div className="card"><h3>Formatos</h3><List items={g.formatos} /></div>
        <div className="card"><h3>CTAs</h3><List items={g.ctas} /></div>
      </div>
      <div className="grid2"><div className="card"><h3 style={{ color: "var(--ok)" }}>Hacer</h3><List items={g.hacer} /></div><div className="card"><h3 style={{ color: "var(--bad)" }}>No hacer</h3><List items={g.noHacer} /></div></div>
    </>
  );
}

// ---------- Modelo del editor ----------
const TEXT_KEYS = [
  "nombre", "resumen", "proposito", "propuesta", "arquetipo", "personalidad", "perfil", "dolores", "deseos",
  "tono", "reglas", "usar", "evitar", "ejemplos", "hacer", "noHacer",
  "fotografia", "video", "subtitulos", "logo", "formatos", "hooksFirma", "ctas",
] as const;
type TextKey = (typeof TEXT_KEYS)[number];
interface PalRow { id: string; nombre: string; hex: string; uso: string }
interface TypoRow { id: string; nombre: string; uso: string }
interface PillarRow { id: string; nombre: string; descripcion: string; ideas: string }
interface Model { f: Record<TextKey, string>; paleta: PalRow[]; tipografias: TypoRow[]; pilares: PillarRow[] }

let rowSeq = 0;
const rid = (): string => "r" + (++rowSeq);

function toModel(g: BrandGuide): Model {
  return {
    f: {
      nombre: g.nombre, resumen: g.resumen,
      proposito: g.esencia.proposito, propuesta: g.esencia.propuesta, arquetipo: g.esencia.arquetipo, personalidad: linesOf(g.esencia.personalidad),
      perfil: g.audiencia.perfil, dolores: linesOf(g.audiencia.dolores), deseos: linesOf(g.audiencia.deseos),
      tono: g.voz.tono, reglas: linesOf(g.voz.reglas), usar: linesOf(g.voz.usar), evitar: linesOf(g.voz.evitar), ejemplos: linesOf(g.voz.ejemplos),
      hacer: linesOf(g.hacer), noHacer: linesOf(g.noHacer),
      fotografia: g.visual.fotografia, video: g.visual.video, subtitulos: g.visual.subtitulos, logo: g.visual.logo,
      formatos: linesOf(g.formatos), hooksFirma: linesOf(g.hooksFirma), ctas: linesOf(g.ctas),
    },
    paleta: g.visual.paleta.map((c) => ({ id: rid(), nombre: c.nombre, hex: c.hex, uso: c.uso })),
    tipografias: g.visual.tipografias.map((t) => ({ id: rid(), nombre: t.nombre, uso: t.uso })),
    pilares: g.pilares.map((p) => ({ id: rid(), nombre: p.nombre, descripcion: p.descripcion, ideas: linesOf(p.ideas) })),
  };
}

function toGuide(m: Model): BrandGuide {
  const f = m.f;
  return {
    nombre: f.nombre.trim(), resumen: f.resumen.trim(),
    esencia: { proposito: f.proposito.trim(), propuesta: f.propuesta.trim(), personalidad: toLines(f.personalidad), arquetipo: f.arquetipo.trim() },
    audiencia: { perfil: f.perfil.trim(), dolores: toLines(f.dolores), deseos: toLines(f.deseos) },
    voz: { tono: f.tono.trim(), reglas: toLines(f.reglas), usar: toLines(f.usar), evitar: toLines(f.evitar), ejemplos: toLines(f.ejemplos) },
    pilares: m.pilares
      .filter((p) => p.nombre.trim() || p.descripcion.trim() || p.ideas.trim())
      .map((p) => ({ nombre: p.nombre.trim(), descripcion: p.descripcion.trim(), ideas: toLines(p.ideas) })),
    visual: {
      paleta: m.paleta.map((c) => ({ nombre: c.nombre.trim(), hex: c.hex.trim().toLowerCase(), uso: c.uso.trim() })),
      tipografias: m.tipografias.filter((t) => t.nombre.trim()).map((t) => ({ nombre: t.nombre.trim(), uso: t.uso.trim() })),
      fotografia: f.fotografia.trim(), video: f.video.trim(), subtitulos: f.subtitulos.trim(), logo: f.logo.trim(),
    },
    formatos: toLines(f.formatos), hooksFirma: toLines(f.hooksFirma), ctas: toLines(f.ctas), hacer: toLines(f.hacer), noHacer: toLines(f.noHacer),
  };
}

// ---------- Campos (fuera de los componentes para que no se vuelvan a montar al escribir) ----------
function TextField({ k, label, value, onChange, rows, hint, placeholder }: {
  k: TextKey; label: string; value: string; onChange: (k: TextKey, v: string) => void; rows?: number; hint?: string; placeholder?: string;
}) {
  const id = "bg-" + k;
  const hintId = hint ? id + "-hint" : undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id}>{label}</label>
      {rows
        ? <textarea id={id} rows={rows} value={value} placeholder={placeholder} aria-describedby={hintId} onChange={(e) => onChange(k, e.target.value)} />
        : <input id={id} value={value} placeholder={placeholder} aria-describedby={hintId} onChange={(e) => onChange(k, e.target.value)} />}
      {hint ? <p id={hintId} className={FIELD_HINT}>{hint}</p> : null}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="m-0 text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
      {desc ? <p className="mt-1 mb-0 text-sm text-muted-foreground">{desc}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ContrastBadge({ hex, bg, bgName }: { hex: string; bg: string; bgName: string }) {
  const ratio = contrast(hex, bg);
  const ok = ratio >= 4.5;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 py-0.5 pr-2 pl-0.5 text-[11px] font-semibold"
      title={`Contraste sobre ${bgName}: ${ratio.toFixed(1)}:1`}
      aria-label={`Texto sobre ${bgName}: contraste ${ratio.toFixed(1)} a 1, ${ok ? "cumple AA" : "no cumple AA"}`}
    >
      <span aria-hidden className="grid h-5 w-6 place-items-center rounded-[5px] text-[11px] font-bold" style={{ background: bg, color: hex }}>Aa</span>
      <span aria-hidden className={ok ? "text-success" : "text-muted-foreground"}>{ok ? "AA" : "—"}</span>
    </span>
  );
}

function PaletteEditor({ rows, onChange }: { rows: PalRow[]; onChange: (rows: PalRow[]) => void }) {
  const addRef = useRef<HTMLButtonElement>(null);
  const patch = (i: number, p: Partial<PalRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    const id = rows[i].id;
    const atEdge = j === 0 || j === rows.length - 1;
    requestAnimationFrame(() => {
      const want = document.getElementById(`pal-${id}-${atEdge ? (dir < 0 ? "down" : "up") : dir < 0 ? "up" : "down"}`);
      (want as HTMLButtonElement | null)?.focus();
    });
  };
  const remove = (i: number) => { onChange(rows.filter((_, k) => k !== i)); requestAnimationFrame(() => addRef.current?.focus()); };
  const add = () => onChange([...rows, { id: rid(), nombre: "", hex: "#ffffff", uso: "" }]);
  const valid = rows.filter((r) => HEX_RE.test(r.hex.trim()));

  return (
    <div>
      {valid.length ? (
        <div className="mb-3">
          <div className="flex h-12 overflow-hidden rounded-lg border border-border" role="img" aria-label={`Vista previa de la paleta: ${valid.map((r) => r.nombre || r.hex).join(", ")}`}>
            {valid.map((r) => <span key={r.id} className="min-w-0 flex-1" style={{ background: r.hex }} title={`${r.nombre || "Sin nombre"} · ${r.hex}`} />)}
          </div>
          <p className={FIELD_HINT}>AA = ese color se lee bien como texto sobre fondo blanco o sobre el fondo oscuro de la app (contraste 4.5:1 o más).</p>
        </div>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r, i) => {
          const n = i + 1;
          const hex = r.hex.trim();
          const ok = HEX_RE.test(hex);
          const errId = `pal-${r.id}-err`;
          return (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color" aria-label={`Color ${n}`} value={ok ? hex.toLowerCase() : "#000000"}
                  onChange={(e) => patch(i, { hex: e.target.value })}
                  className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                />
                <input
                  aria-label={`Código hex del color ${n}`} value={r.hex} spellCheck={false} maxLength={7} placeholder="#rrggbb"
                  aria-invalid={!ok} aria-describedby={ok ? undefined : errId}
                  onChange={(e) => patch(i, { hex: e.target.value })}
                  onBlur={(e) => { const v = e.target.value.trim(); if (/^[0-9a-f]{6}$/i.test(v)) patch(i, { hex: "#" + v }); }}
                  className={cn("w-[7.5rem] shrink-0 font-mono text-sm", !ok && "border-danger")}
                />
                <input aria-label={`Nombre del color ${n}`} placeholder="Nombre (ej. Amarillo marca)" value={r.nombre} onChange={(e) => patch(i, { nombre: e.target.value })} className="min-w-[9rem] flex-1" />
              </div>
              {!ok ? <p id={errId} className="m-0 text-xs text-danger">Usa el formato #rrggbb, por ejemplo #0099ff.</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label={`Uso del color ${n}`} placeholder="Uso (ej. fondos, títulos, botones)" value={r.uso} onChange={(e) => patch(i, { uso: e.target.value })} className="min-w-[10rem] flex-1" />
                {ok ? (
                  <span className="flex items-center gap-1.5">
                    <ContrastBadge hex={hex} bg="#ffffff" bgName="blanco" />
                    <ContrastBadge hex={hex} bg="#090909" bgName="oscuro" />
                  </span>
                ) : null}
                <span className="ml-auto flex items-center gap-1">
                  <Button id={`pal-${r.id}-up`} type="button" variant="ghost" size="icon-sm" aria-label={`Subir color ${n}`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp /></Button>
                  <Button id={`pal-${r.id}-down`} type="button" variant="ghost" size="icon-sm" aria-label={`Bajar color ${n}`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ChevronDown /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar color ${n}`} className="text-danger hover:text-danger" onClick={() => remove(i)}><Trash2 /></Button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {!rows.length ? <p className="text-sm text-muted-foreground">Sin colores todavía.</p> : null}
      <button ref={addRef} type="button" className={cn(buttonVariants({ variant: "translucent", size: "sm" }), "mt-3")} onClick={add}><Plus className="size-4" aria-hidden />Añadir color</button>
    </div>
  );
}

function TypoEditor({ rows, onChange }: { rows: TypoRow[]; onChange: (rows: TypoRow[]) => void }) {
  const patch = (i: number, p: Partial<TypoRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <input aria-label={`Tipografía ${i + 1}`} placeholder="Nombre en Google Fonts" value={r.nombre} onChange={(e) => patch(i, { nombre: e.target.value })} className="min-w-[9rem] flex-1" />
            <input aria-label={`Uso de la tipografía ${i + 1}`} placeholder="Uso (títulos, subtítulos…)" value={r.uso} onChange={(e) => patch(i, { uso: e.target.value })} className="min-w-[9rem] flex-[2]" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar tipografía ${i + 1}`} className="text-danger hover:text-danger" onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2 /></Button>
          </li>
        ))}
      </ul>
      <button type="button" className={cn(buttonVariants({ variant: "translucent", size: "sm" }), "mt-3")} onClick={() => onChange([...rows, { id: rid(), nombre: "", uso: "" }])}><Plus className="size-4" aria-hidden />Añadir tipografía</button>
    </div>
  );
}

function PillarEditor({ rows, onChange }: { rows: PillarRow[]; onChange: (rows: PillarRow[]) => void }) {
  const patch = (i: number, p: Partial<PillarRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div>
      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
        {rows.map((r, i) => (
          <li key={r.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <input aria-label={`Nombre del pilar ${i + 1}`} placeholder={`Pilar ${i + 1}`} value={r.nombre} onChange={(e) => patch(i, { nombre: e.target.value })} className="min-w-0 flex-1 font-semibold" />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar pilar ${i + 1}`} className="text-danger hover:text-danger" onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2 /></Button>
            </div>
            <label htmlFor={`pil-${r.id}-d`}>Descripción</label>
            <textarea id={`pil-${r.id}-d`} rows={2} value={r.descripcion} onChange={(e) => patch(i, { descripcion: e.target.value })} />
            <label htmlFor={`pil-${r.id}-i`}>Ideas (una por línea)</label>
            <textarea id={`pil-${r.id}-i`} rows={3} value={r.ideas} onChange={(e) => patch(i, { ideas: e.target.value })} />
          </li>
        ))}
      </ol>
      <button type="button" className={cn(buttonVariants({ variant: "translucent", size: "sm" }), "mt-3")} onClick={() => onChange([...rows, { id: rid(), nombre: "", descripcion: "", ideas: "" }])}><Plus className="size-4" aria-hidden />Añadir pilar</button>
    </div>
  );
}

/** Editor de la guía por pestañas, con barra fija para guardar cuando hay cambios. */
function GuideEditor({ g, onSave, onDirtyChange, toast }: {
  g: BrandGuide; onSave: (guide: BrandGuide) => Promise<void>; onDirtyChange: (d: boolean) => void; toast: (m: string, bad?: boolean) => void;
}) {
  const [initial] = useState<Model>(() => toModel(g));
  const [initialJson] = useState(() => JSON.stringify(initial));
  const [model, setModel] = useState<Model>(initial);
  const [tab, setTab] = useState("identidad");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(model) !== initialJson;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  // Guardia global: cualquier navegación (otra guía, menú, ⌘K, Atrás) o cerrar la pestaña pide confirmación.
  useLeaveGuard(dirty, "Tienes cambios sin guardar en la guía. Si sales, se pierden.");

  const setF = useCallback((k: TextKey, v: string) => setModel((m) => ({ ...m, f: { ...m.f, [k]: v } })), []);
  const tf = (k: TextKey, label: string, opts: { rows?: number; hint?: string; placeholder?: string } = {}) =>
    <TextField k={k} label={label} value={model.f[k]} onChange={setF} {...opts} />;
  const LINES = "Una por línea.";

  const save = async () => {
    const bad = model.paleta.findIndex((c) => !HEX_RE.test(c.hex.trim()));
    if (bad >= 0) { setTab("visual"); toast(`Revisa el color ${bad + 1}: usa el formato #rrggbb`, true); return; }
    if (!model.f.nombre.trim()) { setTab("identidad"); toast("Ponle un nombre a la marca", true); return; }
    setSaving(true);
    try { await onSave(toGuide(model)); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Secciones de la guía">
          <TabsTrigger value="identidad">Identidad</TabsTrigger>
          <TabsTrigger value="voz">Voz</TabsTrigger>
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="contenido">Contenido</TabsTrigger>
        </TabsList>

        <TabsContent value="identidad" className="flex flex-col gap-4">
          <Section title="Marca" desc="Quién eres, en pocas palabras.">
            {tf("nombre", "Nombre")}
            {tf("resumen", "Resumen", { rows: 3, hint: "2 o 3 frases: quién es la marca y por qué importa." })}
          </Section>
          <Section title="Esencia">
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              {tf("proposito", "Propósito", { rows: 3 })}
              {tf("propuesta", "Propuesta de valor", { rows: 3 })}
              {tf("arquetipo", "Arquetipo", { placeholder: "El rebelde, el sabio, el amigo…" })}
              {tf("personalidad", "Personalidad", { rows: 4, hint: "Un rasgo por línea." })}
            </div>
          </Section>
          <Section title="Audiencia">
            {tf("perfil", "Perfil de tu audiencia", { rows: 3 })}
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              {tf("dolores", "Dolores", { rows: 4, hint: LINES })}
              {tf("deseos", "Deseos", { rows: 4, hint: LINES })}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="voz" className="flex flex-col gap-4">
          <Section title="Tono y reglas" desc="Cómo hablas en tus videos.">
            {tf("tono", "Tono de voz", { placeholder: "Directo, cercano, con humor seco…" })}
            {tf("reglas", "Reglas de escritura", { rows: 4, hint: LINES })}
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              {tf("usar", "Palabras que usas", { rows: 4, hint: LINES })}
              {tf("evitar", "Palabras que evitas", { rows: 4, hint: LINES })}
            </div>
            {tf("ejemplos", "Frases de ejemplo", { rows: 4, hint: "Frases escritas con tu voz. Una por línea." })}
          </Section>
          <Section title="Hacer y no hacer">
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              {tf("hacer", "Hacer", { rows: 5, hint: LINES })}
              {tf("noHacer", "No hacer", { rows: 5, hint: LINES })}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="visual" className="flex flex-col gap-4">
          <Section title="Paleta de colores" desc="Ordena los colores de más a menos importante.">
            <PaletteEditor rows={model.paleta} onChange={(paleta) => setModel((m) => ({ ...m, paleta }))} />
          </Section>
          <Section title="Tipografías" desc="Usa el nombre exacto de Google Fonts para verla en la guía.">
            <TypoEditor rows={model.tipografias} onChange={(tipografias) => setModel((m) => ({ ...m, tipografias }))} />
          </Section>
          <Section title="Dirección visual">
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              {tf("fotografia", "Fotografía", { rows: 3 })}
              {tf("video", "Video", { rows: 3 })}
              {tf("subtitulos", "Subtítulos", { rows: 3 })}
              {tf("logo", "Logo", { rows: 3 })}
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="contenido" className="flex flex-col gap-4">
          <Section title="Pilares de contenido" desc="Los temas que repites y te hacen reconocible.">
            <PillarEditor rows={model.pilares} onChange={(pilares) => setModel((m) => ({ ...m, pilares }))} />
          </Section>
          <Section title="Formatos, hooks y CTAs">
            <div className="grid grid-cols-1 gap-x-4 lg:grid-cols-3">
              {tf("hooksFirma", "Hooks firma", { rows: 5, hint: LINES })}
              {tf("formatos", "Formatos", { rows: 5, hint: LINES })}
              {tf("ctas", "CTAs", { rows: 5, hint: LINES })}
            </div>
          </Section>
        </TabsContent>
      </Tabs>

      {dirty ? (
        <div role="region" aria-label="Cambios sin guardar" className="no-print sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 shadow-lift">
          <p className="m-0 grow text-sm font-medium" aria-live="polite">Tienes cambios sin guardar</p>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setModel(initial)}>Descartar</Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </div>
      ) : null}
    </div>
  );
}

const Dots = ({ hexes, big }: { hexes: string[]; big?: boolean }) => (
  <div className={`dots${big ? " big" : ""}`} aria-hidden>{hexes.map((h, i) => <span key={i} style={{ background: h }} />)}</div>
);

/** Confirmación con Radix Dialog (en lugar de window.confirm). */
function ConfirmDialog({ open, onOpenChange, title, desc, confirmLabel, destructive, onConfirm, returnFocusRef }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; desc: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void;
  /** Botón que abrió el diálogo: recibe el foco al cerrar (Radix lo devolvería a <body> sin DialogTrigger). */
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-border bg-surface-1 shadow-lift"
        onCloseAutoFocus={returnFocusRef ? (e) => { e.preventDefault(); returnFocusRef.current?.focus(); } : undefined}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-[-0.02em]">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{desc}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={() => { onOpenChange(false); onConfirm(); }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Branding({ bid }: { bid?: string }) {
  const { refresh, navigate, toast, act } = useApp();
  const [data, setData] = useState<BrandsResponse | null>(null);
  const [sources, setSourcesState] = useState<BrandSource[]>(brandSourcesMem);
  const [edit, setEditState] = useState<boolean>(brandEditMem);
  const setSources = (s: BrandSource[]) => { brandSourcesMem = s; setSourcesState(s); };
  const setEdit = (v: boolean) => { brandEditMem = v; setEditState(v); };

  const reload = useCallback(async () => {
    try { setData(await api<BrandsResponse>("/api/brands")); } catch (e) { toast((e as Error).message, true); }
  }, [toast]);
  useEffect(() => { void reload(); }, [reload]);

  const brands = data?.brands || [];
  const sel: Brand | null = data && bid && bid !== "nueva" ? brands.find((b) => b.id === bid) || null : null;
  const job: Job | null | undefined = data ? (sel ? sel.job : data.gen.job) : null;
  const running = job?.status === "running";

  // Sondeo cada 2 s mientras haya un trabajo corriendo: actualiza el paso y recarga al terminar.
  usePoll(async () => {
    const d = await api<BrandsResponse>("/api/brands");
    const j = sel ? d.brands.find((x) => x.id === sel.id)?.job : d.gen.job;
    if (j?.status !== "running") { void refresh(); setData(d); }
    else setData((prev) => {
      if (!prev) return d;
      if (sel) return { ...prev, brands: prev.brands.map((b) => (b.id === sel.id && b.job ? { ...b, job: { ...b.job, step: j.step } } : b)) };
      return { ...prev, gen: { ...prev.gen, job: prev.gen.job ? { ...prev.gen.job, step: j.step } : prev.gen.job } };
    });
  }, 2000, running, ["brandGuides", "step:brandGuides", "jobs", "kv"]);

  if (!data) return null;
  const showGen = bid === "nueva" || !sel;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="no-print flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.04em]">Marca</h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">Tu guía de marca le dice a la IA cómo hablas y cómo se ve tu contenido.</p>
        </div>
        <Button asChild variant={showGen ? "translucent" : "default"}>
          <a href="#/branding/nueva" aria-current={bid === "nueva" ? "page" : undefined}><Plus aria-hidden />Nueva guía</a>
        </Button>
      </header>

      {brands.length ? (
        <nav aria-label="Tus guías de marca" className="no-print">
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {brands.map((b) => {
              const active = sel?.id === b.id;
              const isDefault = data.defaultBrandId === b.id;
              const date = fmtDate(b.updatedAt || b.createdAt);
              return (
                <li key={b.id} className="min-w-0">
                  <a
                    href={`#/branding/${b.id}`} aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-full flex-col gap-2 rounded-xl border bg-surface-1 p-4 text-foreground no-underline transition-colors hover:bg-surface-2",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      active ? "border-ring" : "border-border",
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <b className="min-w-0 grow truncate font-semibold tracking-[-0.01em]">{b.name}</b>
                      {isDefault ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium">
                          <Star className="size-3" aria-hidden />Predeterminada
                        </span>
                      ) : null}
                    </span>
                    {b.guide && b.guide.visual.paleta.length
                      ? <Dots hexes={b.guide.visual.paleta.slice(0, 8).map((c) => c.hex)} />
                      : <span className="text-xs text-muted-foreground">{b.guide ? "Sin paleta" : "Guía en texto"}</span>}
                    {date ? <span className="mt-auto text-xs text-muted-foreground">Actualizada el {date}</span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <div id="brandMain" className="min-w-0">
        <JobBanner job={job} />
        {showGen
          ? <GeneratorView data={data} running={running} sources={sources} setSources={setSources} reload={reload} refresh={refresh} navigate={navigate} toast={toast} act={act} />
          : sel ? <GuidePageView key={sel.id} sel={sel} defaultBrandId={data.defaultBrandId} running={running} edit={edit} setEdit={setEdit} reload={reload} refresh={refresh} navigate={navigate} toast={toast} act={act} /> : null}
      </div>
    </div>
  );
}

type AppFns = Pick<ReturnType<typeof useApp>, "refresh" | "navigate" | "toast" | "act">;

function GeneratorView({ data, running, sources, setSources, reload, refresh, navigate, toast, act }: AppFns & {
  data: BrandsResponse; running: boolean; sources: BrandSource[]; setSources: (s: BrandSource[]) => void; reload: () => Promise<void>;
}) {
  const [type, setType] = useState<SrcType>("url");
  const [val, setVal] = useState("");
  const [count, setCount] = useState("1");
  const [instr, setInstr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const gen = data.gen;

  const add = () => {
    if (type === "file") { fileRef.current?.click(); return; }
    const v = val.trim();
    if (!v) return toast("Escribe la fuente", true);
    setSources([...sources, { type, value: v }]);
    setVal("");
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await act(() => api<BrandSource>("/api/brand-files", { method: "POST", body: fd }), "Archivo agregado");
      setSources([...brandSourcesMem, r]);
    } catch { /* ya notificado */ }
  };
  const updateSource = (i: number, p: { type?: ValueSrcType; value?: string }) => {
    setSources(sources.map((s, k) => (k === i && "value" in s ? ({ ...s, ...p } as BrandSource) : s)));
  };
  const generate = async () => {
    const clean = sources.filter((s) => !("value" in s) || s.value.trim());
    if (!clean.length) return toast("Agrega al menos una fuente", true);
    if (clean.length !== sources.length) setSources(clean);
    try { await act(() => api("/api/brands/generate", { method: "POST", body: { sources: clean, count, instructions: instr } })); } catch { return; }
    await reload();
  };
  const blank = async () => {
    try {
      const b = await act(() => api<Brand>("/api/brands", { method: "POST", body: { name: "Nueva guía", raw: "Describe aquí tu marca…" } }));
      await refresh(); navigate(`#/branding/${b.id}`);
    } catch { /* ya notificado */ }
  };
  const saveProposal = async (i: number) => {
    try {
      const nb = await act(() => api<Brand>("/api/brands", { method: "POST", body: { guide: gen.proposals[i], fromProposal: i } }), "Guía guardada");
      setSources([]); await refresh(); navigate(`#/branding/${nb.id}`);
    } catch { /* ya notificado */ }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className={CARD} aria-labelledby="genTitle">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="genTitle" className="m-0 flex items-center gap-2 text-[19px] font-semibold tracking-[-0.03em]"><Sparkles className="size-5 shrink-0" aria-hidden />Crear guía con IA</h2>
            <p className="mt-1 mb-0 max-w-[62ch] text-sm text-muted-foreground">Agrega una o varias fuentes. La IA lee la web (texto, colores, tipografías y una captura), el PDF, el perfil de Instagram o las imágenes, y te propone la guía.</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground">
            <KeyRound className="size-3.5" aria-hidden />Usa tu clave de IA
          </span>
        </div>

        <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 text-xs font-semibold text-muted-foreground">Agregar fuente</legend>
          <div className="flex flex-wrap gap-2">
            <select id="srcType" aria-label="Tipo de fuente" className="w-full sm:w-48" value={type} onChange={(e) => setType(e.target.value as SrcType)}>
              {(Object.keys(SRC_OPTION) as SrcType[]).map((t) => <option key={t} value={t}>{SRC_OPTION[t]}</option>)}
            </select>
            {type === "file" ? (
              <Button type="button" variant="translucent" id="srcAddBtn" onClick={add}><Upload aria-hidden />Elegir archivo</Button>
            ) : (
              <>
                <input
                  id="srcVal" aria-label="Fuente" className="min-w-0 flex-1 basis-56" placeholder={SRC_PH[type]} value={val}
                  onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                />
                <Button type="button" variant="translucent" id="srcAddBtn" onClick={add}><Plus aria-hidden />Agregar</Button>
              </>
            )}
            <input type="file" id="srcFile" accept=".pdf,image/*" hidden ref={fileRef} onChange={onFile} />
          </div>
        </fieldset>

        <div className="mt-3">
          <h3 className="mb-2">Fuentes ({sources.length})</h3>
          {sources.length ? (
            <ul id="srcList" className="m-0 flex list-none flex-col gap-2 p-0">
              {sources.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2">
                  {"value" in s ? (
                    <>
                      <select aria-label={`Tipo de la fuente ${i + 1}`} className="w-auto shrink-0 py-1.5 text-sm" value={s.type} onChange={(e) => updateSource(i, { type: e.target.value as ValueSrcType })}>
                        <option value="url">Web</option><option value="instagram">Perfil</option><option value="text">Brief</option>
                      </select>
                      <input aria-label={`Fuente ${i + 1}`} className="min-w-0 flex-1 basis-40 py-1.5 text-sm" value={s.value} placeholder={SRC_PH[s.type]} onChange={(e) => updateSource(i, { value: e.target.value })} />
                    </>
                  ) : (
                    <>
                      <span className="tag shrink-0">{SRC_LABEL[s.type]}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                    </>
                  )}
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar fuente ${i + 1}`} onClick={() => setSources(sources.filter((_, k) => k !== i))}><X /></Button>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-sm text-muted-foreground">Sin fuentes todavía.</p>}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <div><label htmlFor="genCount">¿Cuántas propuestas?</label><select id="genCount" value={count} onChange={(e) => setCount(e.target.value)}><option value="1">1 guía</option><option value="2">2 direcciones distintas</option><option value="3">3 direcciones distintas</option></select></div>
          <div><label htmlFor="genInstr">Instrucciones (opcional)</label><input id="genInstr" placeholder="Más premium, para audiencia de emprendedores 25-40…" value={instr} onChange={(e) => setInstr(e.target.value)} /></div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button id="genBtn" disabled={running} onClick={() => void generate()}><Sparkles aria-hidden />{running ? "Generando…" : "Generar guía con IA"}</Button>
          <span className="text-sm text-muted-foreground">o</span>
          <Button id="blankBtn" variant="ghost" onClick={() => void blank()}>Crear guía en blanco</Button>
        </div>
      </section>

      {gen.proposals?.length ? (
        <section aria-labelledby="propTitle" className="flex flex-col gap-3">
          <h2 id="propTitle" className="m-0 text-[19px] font-semibold tracking-[-0.03em]">Propuestas</h2>
          {gen.proposals.map((g, i) => (
            <article className={cn(CARD, "proposal mt-0")} key={i}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 grow">
                  <h3 className="mb-1">Propuesta {i + 1}</h3>
                  <p className="m-0 text-lg font-semibold tracking-[-0.02em] break-words">{g.nombre}</p>
                </div>
                <Button variant="translucent" onClick={() => void saveProposal(i)}>Guardar esta guía</Button>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{g.resumen}</p>
              <Dots hexes={g.visual.paleta.map((c) => c.hex)} big />
              <details className="mt-3"><summary className="text-sm">Ver guía completa</summary><div className="mt-3"><GuideView g={g} /></div></details>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function GuidePageView({ sel, defaultBrandId, running, edit, setEdit, reload, refresh, navigate, toast, act }: AppFns & {
  sel: Brand; defaultBrandId: string | null; running: boolean; edit: boolean; setEdit: (v: boolean) => void; reload: () => Promise<void>;
}) {
  const g = sel.guide;
  const nameRef = useRef(sel.name);
  nameRef.current = sel.name;
  const rawRef = useRef<HTMLTextAreaElement>(null);
  const fbRef = useRef<HTMLTextAreaElement>(null);
  const versions = sel.versions || [];
  const [dirty, setDirty] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const delBtnRef = useRef<HTMLButtonElement>(null);
  const isDefault = defaultBrandId === sel.id;

  // Equivale al evento "change" del input original: se guarda al salir del campo o con Enter, si cambió.
  const commitName = (v: string) => {
    if (v === nameRef.current) return;
    nameRef.current = v;
    void api(`/api/brands/${sel.id}`, { method: "PUT", body: { name: v } }).then(refresh).then(reload);
  };
  const setDefault = async () => {
    await api(`/api/brands/${sel.id}/default`, { method: "POST", body: {} });
    toast("Ahora es tu guía predeterminada para proyectos nuevos"); await refresh(); await reload();
  };
  const duplicate = async () => {
    const c = await api<Brand>(`/api/brands/${sel.id}/duplicate`, { method: "POST", body: {} });
    await refresh(); navigate(`#/branding/${c.id}`);
  };
  const del = async () => {
    try { await act(() => api(`/api/brands/${sel.id}`, { method: "DELETE" })); } catch { return; }
    // la guía ya no existe: sus cambios sin guardar no importan, no se pregunta al salir
    await refresh(); navigate("#/branding", { discard: true });
  };
  const saveGuide = async (guide: BrandGuide) => {
    try { await act(() => api(`/api/brands/${sel.id}`, { method: "PUT", body: { guide } }), "Guía guardada"); } catch { return; }
    setEdit(false); await reload();
  };
  const saveRaw = () => { act(() => api(`/api/brands/${sel.id}`, { method: "PUT", body: { raw: rawRef.current?.value ?? "" } }), "Guardado").catch(() => {}); };
  const iterate = async () => {
    const fb = (fbRef.current?.value ?? "").trim();
    if (!fb) return toast("Escribe qué quieres cambiar", true);
    try { await act(() => api(`/api/brands/${sel.id}/iterate`, { method: "POST", body: { feedback: fb } })); } catch { return; }
    await reload();
  };
  const restore = async (i: number) => {
    try { await act(() => api(`/api/brands/${sel.id}/restore/${i}`, { method: "POST", body: {} }), "Versión restaurada"); } catch { return; }
    await reload();
  };
  const toggleEdit = () => {
    if (edit && dirty) { setConfirmLeave(true); return; }
    setEdit(!edit);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <input
          key={sel.name} defaultValue={sel.name} aria-label="Nombre de la guía"
          className="min-w-0 flex-[1_1_16rem] border-transparent bg-transparent px-2 text-[22px] font-semibold tracking-[-0.03em] hover:border-border"
          onBlur={(e) => commitName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitName(e.currentTarget.value); }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {isDefault ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium"><Star className="size-3.5" aria-hidden />Predeterminada</span>
          ) : <Button size="sm" variant="translucent" id="defBtn" onClick={() => void setDefault()}><Star aria-hidden />Usar como predeterminada</Button>}
          {g ? <button type="button" ref={editBtnRef} className={buttonVariants({ size: "sm", variant: "translucent" })} id="editBtn" aria-pressed={edit} onClick={toggleEdit}>{edit ? <><Eye aria-hidden />Ver guía</> : <><Pencil aria-hidden />Editar</>}</button> : null}
          <Button size="sm" variant="translucent" id="dupBtn" onClick={() => void duplicate()}><Copy aria-hidden />Duplicar</Button>
          <Button size="sm" variant="translucent" id="printBtn" onClick={() => window.print()}><Download aria-hidden />Descargar PDF</Button>
          <button type="button" ref={delBtnRef} className={buttonVariants({ size: "sm", variant: "ghost", className: "text-danger hover:text-danger" })} id="delBrand" onClick={() => setConfirmDel(true)}><Trash2 aria-hidden />Eliminar</button>
        </div>
      </div>

      {g
        ? (edit
          ? <GuideEditor key={JSON.stringify(g)} g={g} onSave={saveGuide} onDirtyChange={setDirty} toast={toast} />
          : <div><GuideView g={g} /></div>)
        : (
          <section className={cn(CARD, "print:bg-white print:text-black")}>
            <h3 aria-level={2}>Guía en texto</h3>
            <p className="mt-0 text-sm text-muted-foreground">Esta guía es texto libre. Pídele a la IA que la convierta en una guía completa con el cuadro de abajo.</p>
            <textarea id="rawTxt" aria-label="Guía en texto" key={sel.raw} rows={12} defaultValue={sel.raw} ref={rawRef} />
            <Button variant="translucent" id="saveRaw" className="mt-3" onClick={saveRaw}>Guardar texto</Button>
          </section>
        )}

      <div className="no-print grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="iterTitle">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="iterTitle" aria-level={2} className="m-0">Cambiar con IA</h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><KeyRound className="size-3.5" aria-hidden />Usa tu clave de IA</span>
          </div>
          <label htmlFor="brandFb">Qué quieres cambiar</label>
          <textarea id="brandFb" ref={fbRef} rows={4} placeholder={g ? "Haz la voz más irreverente, cambia la paleta a tonos tierra, agrega un pilar sobre finanzas…" : "Conviértela en una guía completa con paleta, tipografías, pilares y hooks."} />
          <Button variant="translucent" id="iterBtn" className="mt-3" disabled={running} onClick={() => void iterate()}><Sparkles aria-hidden />{running ? "Aplicando…" : "Aplicar cambios con IA"}</Button>
        </section>
        <section className={CARD} aria-labelledby="verTitle">
          <h3 id="verTitle" aria-level={2} className="m-0">Versiones ({versions.length})</h3>
          <p className="mt-1 text-xs text-muted-foreground">Antes de restaurar, guardamos tu versión actual.</p>
          {versions.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {versions.slice().reverse().slice(0, 8).map((v, ri) => {
                const i = versions.length - 1 - ri;
                return (
                  <li className="flex items-center gap-2 text-sm" key={i}>
                    <span className="min-w-0 grow text-muted-foreground"><span className="tabular-nums">{new Date(v.at).toLocaleString(LOCALE)}</span> · {v.note}</span>
                    <Button size="sm" variant="ghost" aria-label={`Restaurar versión del ${new Date(v.at).toLocaleString(LOCALE)}`} onClick={() => void restore(i)}><RotateCcw aria-hidden />Restaurar</Button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="m-0 text-sm text-muted-foreground">Sin versiones anteriores.</p>}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDel} onOpenChange={setConfirmDel} destructive confirmLabel="Eliminar guía"
        title="¿Eliminar esta guía?" desc={`Se borra «${sel.name}» con sus versiones. No se puede deshacer.`}
        onConfirm={() => void del()} returnFocusRef={delBtnRef}
      />
      <ConfirmDialog
        open={confirmLeave} onOpenChange={setConfirmLeave} destructive confirmLabel="Descartar cambios"
        title="¿Descartar los cambios?" desc="Tienes cambios sin guardar en la guía. Si sales del editor, se pierden."
        onConfirm={() => setEdit(false)} returnFocusRef={editBtnRef}
      />
    </div>
  );
}
