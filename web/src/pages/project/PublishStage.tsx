// 7. Publicación: paquete (caption, portada, primer comentario), estrategia Trial Reel,
// pasos de subida manual y link del reel publicado.
import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useApp } from "../../store.tsx";
import { copy, Tag } from "../../ui.tsx";
import type { StageProps } from "./contract.ts";

export function PublishStage({ p, running, run, goStage }: StageProps) {
  const { toast } = useApp();
  const k = p.publish;
  const savedUrl = p.published?.url ?? "";
  const [url, setUrl] = useState(savedUrl);
  useEffect(() => { setUrl(savedUrl); }, [savedUrl]);

  // el paquete se lanza solo al aprobar la edición; también se puede regenerar a mano
  const packRunning = running && (p.job?.stage === "publicacion" || p.job?.stage === "publicar");

  const copyBtn = (text: string, what: string) => <Button variant="ghost" size="sm" aria-label={`Copiar ${what}`} onClick={() => copy(text, toast)}><Copy aria-hidden />Copiar</Button>;

  return (
    <div className="grid2">
      <div className="stack">
        <div className="card"><h2>Paquete de publicación</h2>
          <p className="small muted">Caption, hashtags, portada y estrategia para lanzarlo como <b>Trial Reel</b> (se muestra primero a no seguidores).</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button variant={k ? "secondary" : "default"} disabled={running} onClick={() => { run("publish-pack").catch(() => {}); }}><Sparkles aria-hidden />{packRunning ? "Preparando…" : k ? "Regenerar paquete" : "Generar paquete"}</Button>
            {!p.edit?.final ? <Button variant="ghost" onClick={() => goStage("edicion")}>Ir a Edición<ArrowRight aria-hidden /></Button> : null}
          </div>
          {!p.edit?.final ? <p className="small muted mt-2">Aún no tienes el video final. Puedes preparar el paquete, pero necesitarás el MP4 para subirlo.</p> : null}
          {packRunning ? <div className="mt-2 flex items-center gap-2.5" role="status" aria-live="polite"><div className="spinner" /><p className="small muted m-0">La IA está preparando el paquete (empieza solo al aprobar la edición)…</p></div> : null}</div>
        {k ? (
          <>
            <div className="card"><div className="row"><h3 className="grow">Caption</h3>{copyBtn(k.caption + "\n\n" + k.hashtags.join(" "), "caption y hashtags")}</div><p style={{ whiteSpace: "pre-wrap" }}>{k.caption}</p><p className="muted">{k.hashtags.join(" ")}</p></div>
            <div className="card"><div className="row"><h3 className="grow">Texto de portada</h3>{copyBtn(k.textoPortada, "texto de portada")}</div><p className="hook-quote">{k.textoPortada}</p></div>
            <div className="card"><div className="row"><h3 className="grow">Primer comentario</h3>{copyBtn(k.primerComentario, "primer comentario")}</div><p>{k.primerComentario}</p></div>
          </>
        ) : null}
      </div>
      <div className="stack">
        {k ? (
          <div className="card"><h3>Estrategia Trial Reel</h3><p><b>Cuándo:</b> {k.mejorMomento}</p><ul className="clean">{k.trialReel.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <h3 style={{ marginTop: 12 }}>Variantes de hook para otro trial</h3><ul className="clean">{k.variantesHook.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        ) : null}
        <div className="card"><h3>Subir a Instagram</h3>
          <ol className="clean small">
            <li>Descarga el MP4 final{p.edit?.final ? <> (<a href={`/media/${p.id}/${p.edit.final}`} download style={{ color: "var(--cta)" }}>aquí</a>)</> : null} y pásalo al teléfono (AirDrop).</li>
            <li>Instagram → Nuevo reel → activa <b>“Trial”</b> antes de compartir.</li>
            <li>Pega caption, portada y primer comentario.</li>
            <li>Vuelve aquí y marca como publicado con el link.</li>
          </ol>
          <label htmlFor="publish-url">Link del reel publicado</label>
          <input id="publish-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" />
          <Button variant={k ? "default" : "secondary"} className="mt-2" onClick={() => { run("published", { url }, "Marcado como publicado ✓").catch(() => {}); }}><Check aria-hidden />{p.published ? "Actualizar link" : "Marcar como publicado"}</Button>
          {p.published ? <p className="small"><Tag tone="g">Publicado</Tag> {new Date(p.published.at).toLocaleString()}</p> : null}
        </div>
      </div>
    </div>
  );
}
