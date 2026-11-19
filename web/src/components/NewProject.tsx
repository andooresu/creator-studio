// Diálogo "Nuevo video" en UNA pantalla: tipo (segmentado) · plantilla · título, objetivo, links, marca y
// «Escribir el guion con IA al crear». Crea con un solo POST /api/projects (con referencias y autoScript) y abre
// el proyecto (#/p/<id>). Usa el Dialog de Radix (shadcn): atrapa el foco, deja inerte la página de fondo y
// cierra con Escape; al cerrar, el foco vuelve al botón que lo abrió.
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { Clapperboard, GraduationCap, Mic, Plus, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils";
import type { Project, ProjectKind, StyleSummary } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useApp } from "../store.tsx";
import { LinkChip, extractUrls, platformOf, urlKey } from "./LinkChips.tsx";
import { StyleThumb } from "./StylePreview.tsx";

const KINDS: { id: ProjectKind; label: string; desc: string; icon: LucideIcon }[] = [
  { id: "talking", label: "A cámara", desc: "Te grabas hablando: idea y guion, grabación, propuesta visual, edición y publicación.", icon: Mic },
  { id: "reel", label: "Reel animado", desc: "Video de producto o promo animado con música al ritmo, hecho por el productor.", icon: Clapperboard },
  { id: "clase", label: "Clase o explicador", desc: "Explica un tema con texto animado, voz en off y diagramas, paso a paso.", icon: GraduationCap },
];
const DEFAULT_TITLE: Record<ProjectKind, string> = { talking: "Nuevo reel", reel: "Nuevo reel comercial", clase: "Nueva clase" };
const TITLE_PLACEHOLDER: Record<ProjectKind, string> = {
  talking: "Ej.: 3 errores al empezar en redes",
  reel: "Ej.: Lanzamiento de la nueva app",
  clase: "Ej.: Cómo funciona el interés compuesto",
};
const GOAL_PLACEHOLDER: Record<ProjectKind, string> = {
  talking: "¿Qué debe lograr este video? (vender, explicar, captar seguidores…)",
  reel: "¿Qué debe lograr este reel? (lanzar un producto, anunciar una oferta…)",
  clase: "¿Qué debe aprender quien la vea?",
};
const HINT_BAD = "Eso no parece un link. Pega la dirección completa del video (https://…).";

const isOwn = (s: StyleSummary) => s.origin !== "base";

/** Flechas, Inicio y Fin entre las opciones [role=radio] de un grupo: mueven el foco y seleccionan (patrón ARIA). */
function onRadioKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || !items.length) return;
  e.preventDefault();
  let n = i;
  if (e.key === "Home") n = 0;
  else if (e.key === "End") n = items.length - 1;
  else if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % items.length;
  else n = (i - 1 + items.length) % items.length;
  const el = items[n];
  if (!el) return;
  el.focus();
  el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  el.click();
}

/** true mientras la media query se cumpla. */
function useMedia(query: string): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/** Estilos que sirven para un tipo: primero los del tipo, luego los genéricos ("any"). */
function stylesFor(all: StyleSummary[], kind: ProjectKind): StyleSummary[] {
  return [...all.filter((s) => s.kind === kind), ...all.filter((s) => s.kind === "any")];
}

interface Props {
  initialTitle?: string;
  initialKind?: ProjectKind;
  initialStyleId?: string;
  onClose: () => void;
}

export function NewProjectDialog({ initialTitle, initialKind, initialStyleId, onClose }: Props) {
  const { state, refresh, navigate, toast, act } = useApp();
  const [kind, setKind] = useState<ProjectKind>(initialKind || "talking");
  const [title, setTitle] = useState(initialTitle || "");
  const [goal, setGoal] = useState("");
  // null = todavía sin elegir: se usa la predeterminada (así reacciona si el estado llega después de abrir)
  const [brandChoice, setBrandChoice] = useState<string | null>(null);
  // null = automática (la inicial si sirve o la primera); "" = «Sin plantilla» (solo A cámara)
  const [styleChoice, setStyleChoice] = useState<string | null>(null);
  const [links, setLinks] = useState<{ key: string; url: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const [live, setLive] = useState("");
  const [scriptChoice, setScriptChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const desktop = useMedia("(min-width: 640px)");

  // el diálogo se desmonta al cerrar, así que el foco se devuelve a mano al botón que lo abrió
  const opener = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  useEffect(() => () => {
    const el = opener.current as HTMLElement | null;
    setTimeout(() => {
      if (document.activeElement !== document.body) return;
      if (el && el.isConnected) { el.focus({ preventScroll: true }); return; }
      // Abierto desde la barra lateral en móvil: el botón desapareció con la hoja, así que el foco va al
      // botón "Abrir menú" si está visible o, si no, al contenido principal.
      const trigger = document.querySelector<HTMLElement>('button[aria-label="Abrir menú"]');
      if (trigger && trigger.getClientRects().length > 0) { trigger.focus({ preventScroll: true }); return; }
      const main = document.querySelector<HTMLElement>("main");
      if (main) {
        if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
        main.focus({ preventScroll: true });
      }
    }, 0);
  }, []);

  const talking = kind === "talking";
  const styles = useMemo(() => stylesFor(state?.styles || [], kind), [state?.styles, kind]);
  const defaultStyleId = (initialStyleId && styles.some((s) => s.id === initialStyleId) ? initialStyleId : styles[0]?.id) || "";
  const styleId = styleChoice === "" && talking ? "" : styleChoice && styles.some((s) => s.id === styleChoice) ? styleChoice : defaultStyleId;
  const selectedStyle = styles.find((s) => s.id === styleId) || null;

  const brands = state?.brands || [];
  const brandId = brandChoice ?? (state?.defaultBrandId || brands[0]?.id || "");

  // Links: los chips más lo que quede escrito en el campo
  const draftUrls = extractUrls(draft).urls.filter((u) => !links.some((x) => x.key === urlKey(u)));
  const allLinks = [...links.map((x) => x.url), ...draftUrls];
  const keySet = !!state?.usage.keySet;
  const hasInput = allLinks.length > 0 || goal.trim().length > 0;
  const scriptDisabled = !keySet || !hasInput;
  const autoScript = talking && !scriptDisabled && (scriptChoice ?? true);

  const pickKind = (k: ProjectKind) => {
    if (k === kind) return;
    setKind(k);
    setStyleChoice(null);
  };

  /** Convierte texto en chips; devuelve cuántos se agregaron. */
  const addFromText = (text: string): number => {
    const { urls, rest } = extractUrls(text);
    const known = new Set(links.map((x) => x.key));
    const fresh = urls.filter((u) => !known.has(urlKey(u)));
    if (fresh.length) {
      setLinks((cur) => [...cur, ...fresh.map((url) => ({ key: urlKey(url), url }))]);
      setLive(fresh.length === 1 ? `Link de ${platformOf(fresh[0]).label} agregado` : `${fresh.length} links agregados`);
    }
    if (!urls.length && rest.length) setHint(HINT_BAD);
    else if (urls.length && !fresh.length) setHint("Ese link ya está en la lista.");
    else if (rest.length) setHint(`Agregamos ${fresh.length === 1 ? "el link" : "los links"}; ignoramos el texto que no era link.`);
    else setHint("");
    return fresh.length;
  };
  const commitDraft = () => {
    if (!draft.trim()) return;
    addFromText(draft);
    if (extractUrls(draft).urls.length) setDraft("");
  };
  const onLinkPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!extractUrls(text).urls.length) return; // pegado normal; el aviso sale al confirmar
    e.preventDefault();
    addFromText(`${draft} ${text}`);
    setDraft("");
  };
  const onLinkKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
  };
  const dropLink = (key: string, url: string) => {
    setLinks((cur) => cur.filter((x) => x.key !== key));
    setLive(`Link de ${platformOf(url).label} quitado`);
    linkRef.current?.focus();
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    // texto en el campo de links que no es un link: se avisa en lugar de crear sin él
    if (talking && draft.trim() && !extractUrls(draft).urls.length) {
      setHint(HINT_BAD);
      linkRef.current?.focus();
      return;
    }
    const t = title.trim() || DEFAULT_TITLE[kind];
    setBusy(true);
    try {
      const p = await act(() => api<Project>("/api/projects", {
        method: "POST",
        body: {
          title: t,
          goal: goal.trim(),
          brandId: brandId || null,
          kind,
          // "" = «Sin plantilla» elegida a propósito (A cámara); null = sin estilos disponibles
          styleId: styleId || (talking && styleChoice === "" ? "" : null),
          ...(talking ? { references: allLinks.map((url) => ({ url })), autoScript } : {}),
        },
      }));
      await refresh().catch(() => {});
      onClose();
      navigate(`#/p/${p.id}`);
      toast(p.job?.status === "running" ? "Escribiendo tu guion…" : "Proyecto creado");
    } catch { /* el error ya se mostró como notificación; el diálogo sigue abierto */ } finally { setBusy(false); }
  };

  const motionNotReady = !talking && state?.motion && !state.motion.ready;
  const kindDesc = KINDS.find((k) => k.id === kind)?.desc || "";

  // Vista grande de la plantilla elegida (solo en pantallas anchas)
  const preview = selectedStyle ? (
    <>
      <StyleThumb
        key={selectedStyle.id}
        sid={selectedStyle.id}
        preview={selectedStyle.preview}
        palette={selectedStyle.palette}
        autoPlay
        label={`Vista previa de ${selectedStyle.name}`}
        style={{ borderRadius: 15 }}
      />
      <div className="mt-2 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold tracking-[-0.02em]">{selectedStyle.name}</span>
          <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {isOwn(selectedStyle) ? "Tuya" : "Incluida"}
          </span>
        </div>
        {selectedStyle.description ? <p className="m-0 text-[12px] leading-snug text-muted-foreground">{selectedStyle.description}</p> : null}
      </div>
    </>
  ) : (
    <>
      <div className="grid aspect-[9/16] w-full place-items-center rounded-[15px] border border-dashed border-border bg-surface-2 text-ink-faint">
        {talking ? <Mic className="size-8" aria-hidden /> : <Clapperboard className="size-8" aria-hidden />}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <span className="text-[14px] font-semibold tracking-[-0.02em]">{talking ? "Sin plantilla" : "Sin plantilla elegida"}</span>
        <p className="m-0 text-[12px] leading-snug text-muted-foreground">
          {talking ? "Solo el corte del video; puedes elegir una plantilla después." : "El productor trabajará con tu guía de marca y te propondrá un estilo."}
        </p>
      </div>
    </>
  );

  const optionCls = (sel: boolean) => cn(
    "flex min-w-0 flex-col gap-1.5 rounded-md p-1.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "w-[84px] shrink-0 snap-start sm:w-auto",
    sel && "bg-surface-2 ring-2 ring-inset ring-blue",
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-xl border-0 bg-surface-1 p-0 shadow-lift sm:max-w-[820px]"
        // el foco va al tipo marcado (no a un campo: en el teléfono no abre el teclado)
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          bodyRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
        }}
      >
        {/* noValidate: la validación de links la hace onSubmit (acepta links sin https:// y avisa en español) */}
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-5 pt-5 pb-4 pr-12">
            <DialogTitle className="m-0 text-[19px] font-semibold tracking-[-0.03em]">Nuevo video</DialogTitle>
            <DialogDescription className="m-0 mt-1 text-[13px] text-muted-foreground">Elige el tipo y la plantilla, cuéntanos la idea y listo.</DialogDescription>
          </div>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">
            {/* Tipo: control segmentado */}
            <h3 id="np-kind-h" className="sr-only">Tipo de video</h3>
            <div
              role="radiogroup"
              aria-labelledby="np-kind-h"
              aria-describedby="np-kind-desc"
              onKeyDown={onRadioKeys}
              className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1"
            >
              {KINDS.map((k) => {
                const sel = kind === k.id;
                const Icon = k.icon;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    tabIndex={sel ? 0 : -1}
                    key={k.id}
                    onClick={() => pickKind(k.id)}
                    className={cn(
                      "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-center text-[13px] font-medium leading-tight outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:flex-col max-sm:gap-1 max-sm:text-[12px]",
                      sel ? "bg-surface-1 text-foreground shadow-sm ring-1 ring-blue" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0">{k.label}</span>
                  </button>
                );
              })}
            </div>
            <p id="np-kind-desc" className="m-0 mt-2 text-[12px] leading-snug text-muted-foreground">{kindDesc}</p>

            <div className="mt-5 flex min-w-0 gap-6">
              {/* Vista previa grande (escritorio) */}
              {desktop ? (
                <div className="w-[200px] shrink-0" aria-live="polite">
                  <div className="sticky top-0">{preview}</div>
                </div>
              ) : null}

              <div className="flex min-w-0 flex-1 flex-col">
                {/* Plantilla */}
                <h3 id="np-style-h" className="m-0 mb-2 text-[14px] font-semibold tracking-[-0.02em]">
                  Plantilla{talking ? <span className="font-normal text-muted-foreground"> (opcional)</span> : null}
                </h3>
                {styles.length || talking ? (
                  <div
                    role="radiogroup"
                    aria-labelledby="np-style-h"
                    onKeyDown={onRadioKeys}
                    className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(88px,1fr))] sm:overflow-visible sm:px-0"
                  >
                    {styles.map((s, i) => {
                      const sel = styleId === s.id;
                      const tabbable = sel || (!styleId && !talking && i === 0);
                      return (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          tabIndex={tabbable ? 0 : -1}
                          key={s.id}
                          onClick={() => setStyleChoice(s.id)}
                          title={s.description || undefined}
                          className={optionCls(sel)}
                        >
                          <StyleThumb sid={s.id} preview={s.preview} palette={s.palette} badge={false} focusPlay={false} label={`Vista previa de ${s.name}`} />
                          <span className="truncate text-[12px] font-medium text-foreground">{s.name}</span>
                        </button>
                      );
                    })}
                    {talking ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={!styleId}
                        tabIndex={!styleId ? 0 : -1}
                        onClick={() => setStyleChoice("")}
                        className={optionCls(!styleId)}
                      >
                        <span aria-hidden className="grid aspect-[9/16] w-full place-items-center rounded-[10px] border border-dashed border-border bg-surface-2 text-ink-faint">
                          <Mic className="size-5" />
                        </span>
                        <span className="truncate text-[12px] font-medium text-foreground">Sin plantilla</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {!styles.length && !talking ? (
                  <p className="m-0 text-[13px] text-muted-foreground">Aún no hay plantillas para este tipo. Puedes continuar: el productor usará tu guía de marca y te propondrá un estilo.</p>
                ) : !desktop ? (
                  <p className="m-0 mt-1 text-[12px] text-muted-foreground" aria-live="polite">
                    {selectedStyle ? <>Elegida: <span className="text-foreground">{selectedStyle.name}</span></> : "Sin plantilla: solo el corte del video."}
                  </p>
                ) : null}

                {/* Detalles */}
                <label htmlFor="np-title-input">Título <span className="font-normal text-muted-foreground">(opcional)</span></label>
                <input
                  id="np-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={TITLE_PLACEHOLDER[kind]}
                  aria-describedby="np-title-hint"
                  autoComplete="off"
                />
                <p id="np-title-hint" className="m-0 mt-1 text-[12px] text-ink-faint">Si lo dejas vacío, se llamará «{DEFAULT_TITLE[kind]}».</p>

                <label htmlFor="np-goal">Objetivo</label>
                <textarea id="np-goal" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={GOAL_PLACEHOLDER[kind]} />

                {talking ? (
                  <>
                    <label htmlFor="np-links">Links de referencia <span className="font-normal text-muted-foreground">(opcional)</span></label>
                    <div className="flex min-w-0 gap-2">
                      <input
                        id="np-links"
                        ref={linkRef}
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        enterKeyHint="done"
                        value={draft}
                        onChange={(e) => { setDraft(e.target.value); if (hint) setHint(""); }}
                        onPaste={onLinkPaste}
                        onKeyDown={onLinkKeyDown}
                        placeholder="https://www.instagram.com/reel/…"
                        aria-invalid={hint === HINT_BAD || undefined}
                        aria-describedby="np-links-hint"
                        className="min-w-0 flex-1"
                      />
                      <Button type="button" variant="secondary" className="h-auto shrink-0" onClick={commitDraft} disabled={!draft.trim()} aria-label="Agregar link">
                        <Plus aria-hidden /><span className="max-[420px]:sr-only">Agregar</span>
                      </Button>
                    </div>
                    <p id="np-links-hint" className={cn("m-0 mt-1 text-[12px]", hint === HINT_BAD ? "text-destructive" : "text-ink-faint")}>
                      {hint || "Videos que te gustan (Instagram, TikTok, YouTube…). Puedes pegar varios a la vez."}
                    </p>
                    <div className="sr-only" aria-live="polite" role="status">{live}</div>
                    {links.length ? (
                      <ul className="mt-2 flex list-none flex-col gap-2 p-0" aria-label="Links agregados">
                        {links.map((x) => <LinkChip key={x.key} url={x.url} onRemove={() => dropLink(x.key, x.url)} />)}
                      </ul>
                    ) : null}
                  </>
                ) : null}

                <label htmlFor="np-brand">Guía de marca</label>
                <select id="np-brand" value={brandId} onChange={(e) => setBrandChoice(e.target.value)}>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === state?.defaultBrandId ? " (predeterminada)" : ""}</option>)}
                  {!brands.length ? <option value="">Sin guía de marca</option> : null}
                </select>

                {talking ? (
                  <div className="mt-4">
                    <label className={cn("m-0! inline-flex! cursor-pointer items-start gap-2 text-[13px]! font-normal! text-foreground!", scriptDisabled && "cursor-not-allowed text-muted-foreground!")}>
                      <input
                        type="checkbox"
                        checked={autoScript}
                        disabled={scriptDisabled}
                        onChange={(e) => setScriptChoice(e.target.checked)}
                        aria-describedby={scriptDisabled ? "np-script-hint" : undefined}
                        style={{ width: 16, height: 16, padding: 0, margin: "2px 0 0", accentColor: "var(--blue)", flex: "none" }}
                      />
                      Escribir el guion con IA al crear (usa tu clave de IA)
                    </label>
                    {scriptDisabled ? (
                      <p id="np-script-hint" className="m-0 mt-1 pl-6 text-[12px] text-ink-faint">
                        {!keySet
                          ? "Conecta tu IA en Ajustes para que escriba el guion. Puedes hacerlo después desde el proyecto."
                          : "Escribe el objetivo o pega un link para que la IA escriba el guion"}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {motionNotReady ? (
                  <p className="m-0 mt-4 flex items-start gap-2 text-[13px] text-warning">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>El motor de video aún no está listo en este equipo. Puedes crear el proyecto y revisar los requisitos dentro.</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>{busy ? "Creando…" : "Crear video"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
