// 1. Referencias: un solo campo para pegar links (cada uno se vuelve un chip con nota opcional),
// objetivo del video en una línea editable y un botón que guarda, analiza y escribe el guion.
import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowRight, Check, LoaderCircle, Pencil, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { LinkChip, extractUrls, platformOf, urlKey } from "@/components/LinkChips.tsx";
import type { Project } from "../../../../shared/types.ts";
import { api } from "../../api.ts";
import { useApp } from "../../store.tsx";
import type { StageProps } from "./contract.ts";

/** Link pegado que aún no se guarda en el proyecto. */
interface Pending { key: string; url: string; note: string }

const HINT_BAD = "Eso no parece un link. Pega la dirección completa del video (https://…).";

export function RefsStage({ p, running, run, setProject }: StageProps) {
  const { refresh, toast, act } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [hint, setHint] = useState("");
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);

  // Objetivo: viene del proyecto y se edita en una línea compacta
  const [goal, setGoal] = useState(p.goal || "");
  const [editingGoal, setEditingGoal] = useState(false);
  // solo se resincroniza cuando cambia el objetivo guardado (no al salir del campo: así no se pierde lo escrito
  // mientras se guarda, ni si el guardado falla)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!editingGoal) setGoal(p.goal || ""); }, [p.id, p.goal]);
  // re-analizar con un guion existente lo reemplaza: se pregunta antes
  const [confirmReplace, setConfirmReplace] = useState(false);
  // Al cambiar de proyecto se descartan los links sin guardar
  useEffect(() => { setPending([]); setDraft(""); setHint(""); }, [p.id]);

  const savedKeys = new Set(p.references.filter((r) => r.url).map((r) => urlKey(r.url)));

  /** Convierte texto en chips; devuelve cuántos se agregaron. */
  const addFromText = (text: string): number => {
    const { urls, rest } = extractUrls(text);
    const known = new Set([...savedKeys, ...pending.map((x) => x.key)]);
    const fresh = urls.filter((u) => !known.has(urlKey(u)));
    if (fresh.length) {
      setPending((cur) => [...cur, ...fresh.map((url) => ({ key: urlKey(url), url, note: "" }))]);
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
    // si había al menos un link válido, se limpia el campo; si no, se deja para corregirlo
    if (extractUrls(draft).urls.length) setDraft("");
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!extractUrls(text).urls.length) return; // pegado normal; el aviso sale al confirmar
    e.preventDefault();
    addFromText(`${draft} ${text}`);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
  };

  const setNote = (key: string, note: string) => setPending((cur) => cur.map((x) => (x.key === key ? { ...x, note } : x)));
  const dropPending = (x: Pending) => {
    setPending((cur) => cur.filter((y) => y.key !== x.key));
    setLive(`Link de ${platformOf(x.url).label} quitado`);
    inputRef.current?.focus();
  };

  const delRef = async (rid: string) => {
    try {
      setProject(await act(() => api<Project>(`/api/projects/${p.id}/references/${rid}`, { method: "DELETE" })));
      setLive("Referencia quitada");
    } catch { /* ya notificado */ }
  };

  /** Guarda los chips pendientes (y lo que haya en el campo). Devuelve false si falló. */
  const savePending = async (): Promise<boolean> => {
    const extra = extractUrls(draft).urls
      .filter((u) => !savedKeys.has(urlKey(u)) && !pending.some((x) => x.key === urlKey(u)))
      .map((url) => ({ key: urlKey(url), url, note: "" }));
    const all = [...pending, ...extra];
    if (!all.length) return true;
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/references`, {
        method: "POST",
        body: { links: all.map((x) => ({ url: x.url, note: x.note.trim() })) },
      }));
      setProject(np);
      setPending([]);
      if (extra.length) setDraft("");
      setHint("");
      refresh().catch(() => {});
      return true;
    } catch {
      // se conservan los chips para reintentar
      if (extra.length) { setPending(all); setDraft(""); }
      return false;
    }
  };

  const saveGoal = async (): Promise<boolean> => {
    const g = goal.trim();
    if (g === (p.goal || "").trim()) return true;
    try {
      setProject(await act(() => api<Project>(`/api/projects/${p.id}`, { method: "PATCH", body: { goal: g } })));
      return true;
    } catch { return false; }
  };

  const onSaveOnly = async () => {
    setBusy(true);
    try { if (await savePending()) toast("Links guardados"); } finally { setBusy(false); }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    toast("Subiendo…");
    try {
      const np = await act(() => api<Project>(`/api/projects/${p.id}/references/upload`, { method: "POST", body: fd }), "Video subido");
      setProject(np);
      setLive("Video subido");
    } catch { /* ya notificado */ } finally {
      input.value = "";
    }
  };

  const onAnalyze = async () => {
    setBusy(true);
    try {
      setEditingGoal(false);
      if (!(await savePending())) return;
      if (!(await saveGoal())) return;
      await run("analyze").catch(() => {});
    } finally { setBusy(false); }
  };

  const draftUrls = extractUrls(draft).urls.length;
  const total = p.references.length + pending.length + draftUrls;
  // sin links pero con objetivo, el guion se escribe solo desde el objetivo y la marca
  const goalOnly = !total && Boolean(goal.trim());
  const onPrimary = () => { if (p.script) setConfirmReplace(true); else void onAnalyze(); };
  const working = busy || running;
  const hintId = "refs-link-hint";

  return (
    <div className="card mx-auto w-full max-w-3xl">
      <h2>Referencias</h2>
      <p className="muted small">Videos que quieres copiar, emular o que te inspiran.</p>

      {/* Campo principal: pegar o escribir + Enter */}
      <label htmlFor="refs-link" className="mt-4! text-sm! text-foreground!">
        Pega el link de un video que te guste (Instagram, TikTok, YouTube…)
      </label>
      <div className="flex gap-2">
        <input
          id="refs-link"
          ref={inputRef}
          type="url"
          inputMode="url"
          autoComplete="off"
          enterKeyHint="done"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (hint) setHint(""); }}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          placeholder="https://www.instagram.com/reel/…"
          aria-invalid={hint === HINT_BAD || undefined}
          aria-describedby={hintId}
          className="h-12 min-w-0 flex-1 text-base!"
        />
        <Button type="button" variant="secondary" className="h-12 shrink-0" onClick={commitDraft} disabled={!draft.trim()} aria-label="Agregar link">
          <Plus aria-hidden /><span className="max-[420px]:sr-only">Agregar</span>
        </Button>
      </div>
      <p id={hintId} className={hint === HINT_BAD ? "small mt-1.5 text-destructive" : "small muted mt-1.5"}>
        {hint || "Puedes pegar varios links a la vez."}
      </p>
      <div className="sr-only" aria-live="polite" role="status">{live}</div>

      {/* Chips: pendientes primero, luego los guardados */}
      {pending.length || p.references.length ? (
        <ul className="mt-3 flex list-none flex-col gap-2 p-0" aria-label="Referencias">
          {pending.map((x) => (
            <LinkChip key={x.key} url={x.url} pending onRemove={() => dropPending(x)}>
              <label htmlFor={`note-${x.key}`} className="sr-only">¿Qué quieres tomar de este?</label>
              <input
                id={`note-${x.key}`}
                value={x.note}
                onChange={(e) => setNote(x.key, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); inputRef.current?.focus(); } }}
                placeholder="¿Qué quieres tomar de este? (opcional)"
                className="py-1.5! text-sm"
              />
            </LinkChip>
          ))}
          {p.references.map((r) => (
            <LinkChip key={r.id} url={r.url} name={r.name} onRemove={() => { void delRef(r.id); }}>
              {r.note || r.info?.views ? (
                <>
                  {r.note ? <p className="small muted m-0">{r.note}</p> : null}
                  {r.info?.views ? (
                    <p className="small m-0 mt-1 flex flex-wrap gap-1">
                      <span className="tag">{(r.info.views / 1000).toFixed(0)}k vistas</span>
                      {r.info.likes ? <span className="tag">{(r.info.likes / 1000).toFixed(1)}k likes</span> : null}
                      {r.info.uploader ? <span className="tag">{r.info.uploader}</span> : null}
                    </p>
                  ) : null}
                </>
              ) : null}
            </LinkChip>
          ))}
        </ul>
      ) : null}

      {/* Opción secundaria: subir el archivo */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden />Subir video
        </Button>
        <span className="small muted">Si el link no descarga, sube el archivo.</span>
        <input ref={fileRef} type="file" accept="video/*" hidden aria-label="Video de referencia" onChange={(e) => { void onFile(e); }} />
        {pending.length ? (
          <Button type="button" variant="link" size="sm" className="ml-auto px-0" disabled={working} onClick={() => { void onSaveOnly(); }}>
            Guardar sin analizar
          </Button>
        ) : null}
      </div>

      {/* Objetivo en una línea editable */}
      <div className="mt-4 border-t border-[var(--line)] pt-3">
        {editingGoal ? (
          <div>
            <label htmlFor="refs-goal" className="mt-0!">Objetivo de este video</label>
            <div className="flex gap-2">
              <input
                id="refs-goal"
                autoFocus
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); setEditingGoal(false); void saveGoal(); }
                  if (e.key === "Escape") { e.preventDefault(); setGoal(p.goal || ""); setEditingGoal(false); }
                }}
                onBlur={() => { setEditingGoal(false); void saveGoal(); }}
                placeholder="Ej: replicar la estructura contando mi historia."
                className="min-w-0 flex-1"
              />
              <Button type="button" variant="secondary" size="icon" aria-label="Guardar objetivo" onMouseDown={(e) => e.preventDefault()} onClick={() => { setEditingGoal(false); void saveGoal(); }}>
                <Check aria-hidden />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0 font-semibold text-muted-foreground">Objetivo:</span>
            <span className={goal.trim() ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-muted-foreground italic"} title={goal || undefined}>
              {goal.trim() || "Sin definir (opcional)"}
            </span>
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditingGoal(true)} aria-label="Editar objetivo de este video">
              <Pencil aria-hidden />Editar
            </Button>
          </div>
        )}
      </div>

      {/* Acción principal */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button size="lg" className="w-full sm:w-auto" disabled={working || (!total && !goalOnly) || confirmReplace} onClick={onPrimary}>
          {working ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {goalOnly ? "Escribir guion desde el objetivo" : p.analysis ? "Volver a analizar y escribir" : "Analizar y escribir guion"}
          {working ? null : <ArrowRight aria-hidden />}
        </Button>
        <span className="small muted">
          {total
            ? "Analizamos las referencias y escribimos tu guion con tu marca. Tarda ~1–2 min."
            : goalOnly ? "Sin referencias: escribimos el guion con tu objetivo y tu marca." : "Agrega un link o escribe el objetivo para empezar."}
        </span>
      </div>
      {confirmReplace ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-3 text-sm">
          <span className="min-w-0 flex-1">Esto escribe un guion nuevo y reemplaza el actual{p.scriptApproved ? " (que ya aprobaste)" : ""}. ¿Seguimos?</span>
          <Button size="sm" variant="destructive" onClick={() => { setConfirmReplace(false); void onAnalyze(); }}>Sí, reemplazar guion</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmReplace(false)}>Cancelar</Button>
        </div>
      ) : null}
    </div>
  );
}
