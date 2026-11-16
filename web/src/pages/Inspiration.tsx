// Inspiración: en pausa ("Próximamente") mientras se prioriza el flujo de producción.
// La versión completa (explorador de outliers + cajón de video) sigue disponible en #/inspiracion/beta.
import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import type { InspoCollection, InspoResponse, InspoVideo, Job, Project } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { useApp, usePoll } from "../store.tsx";
import { fmtN } from "../ui.tsx";
import { AnalysisView } from "./project/AnalysisStage.tsx";

type ListVideo = InspoResponse["videos"][number];
interface Filters { account: string; period: string; min: string; sort: string; q: string; coll: string }

const DEFAULT_F: Filters = { account: "", period: "90", min: "0", sort: "outlier", q: "", coll: "" };
function loadF(): Filters {
  try { return { ...DEFAULT_F, ...(JSON.parse(localStorage.getItem("inspoF") || "{}") as Partial<Filters>) }; } catch { return { ...DEFAULT_F }; }
}
function saveF(f: Filters) { try { localStorage.setItem("inspoF", JSON.stringify(f)); } catch { /* sin almacenamiento */ } }

const engagement = (v: ListVideo) => v.likes + v.comments;
const SORTERS: Record<string, (a: ListVideo, b: ListVideo) => number> = {
  outlier: (a, b) => (b.outlier || 0) - (a.outlier || 0),
  views: (a, b) => (b.views || engagement(b)) - (a.views || engagement(a)),
  recent: (a, b) => new Date(b.postedAt || 0).getTime() - new Date(a.postedAt || 0).getTime(),
  engagement: (a, b) => engagement(b) / (b.views || 1) - engagement(a) / (a.views || 1),
};
const PLAT_SHORT = { instagram: "IG", tiktok: "TT", youtube: "YT" } as const;

const obClass = (o: number) => `ob ${o >= 5 ? "hot" : o >= 2 ? "warm" : ""}`;

function JobLine({ job }: { job: Job | null | undefined }) {
  if (!job || job.status === "done") return null;
  const running = job.status === "running";
  return <div className={`job ${job.status === "error" ? "error" : ""}`}>{running ? <div className="spinner" /> : "⚠️"}<div className="grow">{job.step}</div></div>;
}

export function Inspiration({ beta }: { beta: boolean }) {
  return beta ? <InspoFull /> : <InspoComingSoon />;
}

function InspoComingSoon() {
  const items: [string, string, string][] = [
    ["👀", "Seguir cuentas", "Instagram, TikTok y YouTube Shorts en un solo feed."],
    ["📈", "Outliers", "Detecta los videos que rinden muy por encima del promedio de cada cuenta."],
    ["🔍", "Análisis con IA", "Hook, estructura, retención y cómo adaptarlo a tu marca."],
    ["📁", "Colecciones", "Agrupa ideas por formato, hook o estilo de edición."],
    ["🎬", "Directo a producción", "Un clic y el video entra al flujo con el análisis listo."],
  ];
  return (
    <div className="card" style={{ padding: 40, textAlign: "center", maxWidth: 820, margin: "20px auto" }}>
      <span className="tag y">Próximamente</span>
      <h1 style={{ fontSize: 34, marginTop: 14 }}>Inspiración</h1>
      <p className="muted" style={{ maxWidth: 560, margin: "0 auto 24px" }}>Un explorador de contenido viral para encontrar qué está funcionando en tu nicho y llevarlo a producción. Por ahora, pega links de referencia directamente al crear un proyecto.</p>
      <div className="grid3" style={{ textAlign: "left" }}>
        {items.map(([i, t, d]) => (
          <div key={t} className="card" style={{ background: "var(--panel-2)" }}><div style={{ fontSize: 22 }}>{i}</div><b>{t}</b><p className="small muted">{d}</p></div>
        ))}
      </div>
      <a className="btn primary" href="#/" style={{ marginTop: 24 }}>Ir a Inicio</a>
    </div>
  );
}

function InspoFull() {
  const { act } = useApp();
  const [d, setD] = useState<InspoResponse | null>(null);
  const [f, setFState] = useState<Filters>(loadF);
  const [q, setQ] = useState(f.q);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => { setD(await api<InspoResponse>("/api/inspo")); }, []);
  useEffect(() => { void load(); }, [load]);

  const setF = (patch: Partial<Filters>) => setFState((prev) => { const n = { ...prev, ...patch }; saveF(n); return n; });

  const running = d?.job?.status === "running";
  // Mientras corre un trabajo: actualiza el paso; al terminar recarga todo.
  usePoll(async () => {
    const x = await api<InspoResponse>("/api/inspo");
    if (x.job?.status !== "running") setD(x);
    else setD((prev) => (prev ? { ...prev, job: x.job } : x));
  }, 2500, running, ["accounts", "videos", "collections", "step:videos", "step:accounts", "jobs"]);

  if (!d) return null;

  const now = Date.now();
  const vids = d.videos.filter((v) => {
    if (f.coll) return Boolean(d.collections.find((c) => c.id === f.coll)?.videoIds.includes(v.id));
    if (f.account && v.accountId !== f.account) return false;
    if (f.period !== "all" && v.postedAt && now - new Date(v.postedAt).getTime() > +f.period * 864e5) return false;
    if ((v.outlier || 0) < +f.min) return false;
    if (f.q && !String(v.caption).toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
  vids.sort(SORTERS[f.sort] || SORTERS.outlier);

  const onFollow = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await act(() => api("/api/inspo/accounts", { method: "POST", body: { handles: fd.get("handles"), limit: fd.get("limit") } }));
    await load();
  };
  const onAccClick = (e: MouseEvent<HTMLDivElement>, id: string) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setF({ account: f.account === id ? "" : id, coll: "" });
  };
  const onRefreshAcc = async (id: string) => { await act(() => api(`/api/inspo/accounts/${id}/refresh`, { method: "POST", body: {} })); await load(); };
  const onUnfollow = async (id: string) => {
    if (!confirm("¿Dejar de seguir esta cuenta? Sus videos guardados en colecciones se conservan.")) return;
    await api(`/api/inspo/accounts/${id}`, { method: "DELETE" });
    await load();
  };
  const onRefreshAll = async () => { await act(() => api("/api/inspo/refresh-all", { method: "POST", body: {} })); await load(); };
  const onNewColl = async () => {
    const name = prompt("Nombre de la colección (ej: Hooks de pregunta, Formato lista, Storytelling)");
    if (name) { await api("/api/inspo/collections", { method: "POST", body: { name } }); await load(); }
  };
  // Equivale al evento "change" nativo: se confirma al salir del campo o con Enter, solo si cambió.
  const commitQ = () => { if (q !== f.q) setF({ q }); };
  const onCollToggled = (c: InspoCollection) => setD((prev) => (prev ? { ...prev, collections: prev.collections.map((x) => (x.id === c.id ? { ...x, videoIds: c.videoIds } : x)) } : prev));

  const swallow = (p: Promise<unknown>) => { p.catch(() => { /* el error ya se mostró (o se ignora como en el original) */ }); };

  return (
    <>
      <div className="row"><div className="grow"><h1>Inspiración</h1><p className="muted">Sigue cuentas, encuentra sus <b>outliers</b> (videos muy por encima de su mediana de vistas), analízalos y llévalos a producción.</p></div></div>
      {!d.hasMeta && !d.hasApify ? (
        <div className="card" style={{ borderColor: "rgba(255,159,67,.4)", marginBottom: 12 }}><p className="small"><b>Para Instagram conecta la API oficial (gratis)</b> en <a href="#/ajustes" style={{ color: "var(--cta)" }}>Ajustes → Instagram oficial</a>. YouTube Shorts ya funciona sin configurar nada.</p></div>
      ) : null}
      <JobLine job={d.job} />
      <form className="follow" onSubmit={(e) => swallow(onFollow(e))}>
        <input name="handles" aria-label="Cuentas a seguir" className="grow" placeholder="@cuenta1 @cuenta2 o links de perfiles (Instagram, TikTok, YouTube)" />
        <select name="limit" aria-label="Videos por cuenta" style={{ width: "auto" }}><option value="30">30 videos</option><option value="60">60</option><option value="100">100</option></select>
        <button className="btn primary" disabled={running}>Seguir</button>
      </form>
      <div className="accounts">
        {d.accounts.map((a) => (
          <div key={a.id} className={`acc ${f.account === a.id ? "on" : ""}`} onClick={(e) => onAccClick(e, a.id)}>
            {a.avatar ? <img src={a.avatar} alt="" /> : <div className="av">{(a.username[0] || "?").toUpperCase()}</div>}
            <div><b>@{a.username}</b><div className="small muted">{PLAT_SHORT[a.platform]} · {fmtN(a.followers)} seg. · med {fmtN(a.medianViews)} {a.metric === "engagement" ? "interacc." : "vistas"}</div></div>
            <button className="btn sm ghost" title="Actualizar" aria-label={`Actualizar @${a.username}`} onClick={() => swallow(onRefreshAcc(a.id))}>↻</button>
            <button className="btn sm ghost danger" title="Dejar de seguir" aria-label={`Dejar de seguir a @${a.username}`} onClick={() => swallow(onUnfollow(a.id))}>✕</button>
          </div>
        ))}
        {d.accounts.length ? <button className="btn sm" disabled={running} onClick={() => swallow(onRefreshAll())}>↻ Actualizar todas</button> : null}
      </div>
      <div className="filters">
        <select aria-label="Colección" style={{ width: "auto" }} value={f.coll} onChange={(e) => setF({ coll: e.target.value })}>
          <option value="">Todos los videos</option>
          {d.collections.map((c) => <option key={c.id} value={c.id}>📁 {c.name} ({c.videoIds.length})</option>)}
        </select>
        <select aria-label="Cuenta" style={{ width: "auto" }} value={f.account} onChange={(e) => setF({ account: e.target.value, coll: "" })}>
          <option value="">Todas las cuentas</option>
          {d.accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
        </select>
        <select aria-label="Periodo" style={{ width: "auto" }} value={f.period} onChange={(e) => setF({ period: e.target.value })}>
          {[["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["365", "1 año"], ["all", "Todo"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Outlier mínimo" style={{ width: "auto" }} value={f.min} onChange={(e) => setF({ min: e.target.value })}>
          {[["0", "Cualquier outlier"], ["1.5", "≥ 1.5x"], ["2", "≥ 2x"], ["3", "≥ 3x"], ["5", "≥ 5x"], ["10", "≥ 10x"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Ordenar por" style={{ width: "auto" }} value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
          {[["outlier", "Mayor outlier"], ["views", "Más vistas / interacciones"], ["engagement", "Mejor engagement"], ["recent", "Más recientes"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input aria-label="Buscar en captions" placeholder="Buscar en captions…" value={q} style={{ maxWidth: 220 }} onChange={(e) => setQ(e.target.value)} onBlur={commitQ} onKeyDown={(e) => { if (e.key === "Enter") commitQ(); }} />
        <button className="btn sm" onClick={() => swallow(onNewColl())}>+ Colección</button>
        <span className="small muted" style={{ marginLeft: "auto" }}>{vids.length} videos</span>
      </div>
      <div className="vgrid">
        {vids.length ? vids.map((v) => (
          <div key={v.id} className="vcard" onClick={() => setOpenId(v.id)}>
            <div className="vthumb" style={{ backgroundImage: `url('${v.thumb || ""}')` }}>
              {v.outlier == null ? null : <span className={obClass(v.outlier)}>{v.outlier.toFixed(1)}x</span>}
              {v.analyzed ? <span className="an">✓ analizado</span> : null}
              {v.duration ? <span className="dur">{Math.round(v.duration)}s</span> : null}
            </div>
            <div className="vmeta">
              <b>{v.metric === "engagement" ? fmtN(v.likes + v.comments) + " interacciones" : fmtN(v.views) + " vistas"}</b>
              {v.likes || v.comments ? <span className="small muted">♥ {fmtN(v.likes)} · 💬 {fmtN(v.comments)}</span> : null}
              <span className="small muted">@{v.account}{v.postedAt ? " · " + new Date(v.postedAt).toLocaleDateString() : ""}</span>
            </div>
          </div>
        )) : (
          <div className="card" style={{ gridColumn: "1/-1" }}><p className="muted">{d.accounts.length ? "Ningún video coincide con los filtros." : "Sigue tu primera cuenta arriba para empezar."}</p></div>
        )}
      </div>
      {openId ? <VideoDrawer key={openId} vid={openId} collections={d.collections} onCollToggled={onCollToggled} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function VideoDrawer({ vid, collections, onCollToggled, onClose }: { vid: string; collections: InspoCollection[]; onCollToggled: (c: InspoCollection) => void; onClose: () => void }) {
  const { state, refresh, navigate, act } = useApp();
  const [v, setV] = useState<InspoVideo | null>(null);

  const load = useCallback(async () => { setV(await api<InspoVideo>(`/api/inspo/videos/${vid}`)); }, [vid]);
  useEffect(() => { void load(); }, [load]);

  const running = v?.job?.status === "running";
  usePoll(async () => {
    const x = await api<InspoVideo>(`/api/inspo/videos/${vid}`);
    if (x.job?.status !== "running") { void refresh().catch(() => {}); setV(x); }
    else setV((prev) => (prev ? { ...prev, job: x.job } : x));
  }, 2000, running, [`videos:${vid}`, `step:videos:${vid}`, "jobs"]);

  const [brandId, setBrandId] = useState<string | null>(null);

  if (!v) return null;

  const brands = state?.brands || [];
  const selBrand = brandId ?? (brands.some((b) => b.id === state?.defaultBrandId) ? state!.defaultBrandId! : brands[0]?.id ?? "");

  const onToggle = async (cid: string) => {
    const c = await api<InspoCollection>(`/api/inspo/collections/${cid}/toggle`, { method: "POST", body: { videoId: v.id } });
    onCollToggled(c);
  };
  const onAnalyze = async () => { await act(() => api(`/api/inspo/videos/${v.id}/analyze`, { method: "POST", body: {} })); await load(); };
  const onProduce = async () => {
    const p = await act(() => api<Project>(`/api/inspo/videos/${v.id}/project`, { method: "POST", body: { brandId: selBrand } }), "Proyecto creado");
    await refresh();
    navigate(`#/p/${p.id}`);
  };
  const swallow = (p: Promise<unknown>) => { p.catch(() => {}); };

  const eng = v.metric === "engagement";
  return (
    <div className="drawer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer-in">
        <div className="row"><h2 className="grow">@{v.account}</h2><button className="btn sm ghost" aria-label="Cerrar" onClick={onClose}>✕</button></div>
        <div className="dr-top">
          <a href={v.url} target="_blank" rel="noopener" className="vthumb big" style={{ backgroundImage: `url('${v.thumb || ""}')` }}>
            {v.outlier != null ? <span className={obClass(v.outlier)}>{v.outlier.toFixed(1)}x</span> : null}<span className="play">▶ Abrir</span>
          </a>
          <div className="stack grow">
            <div className="grid2">
              <div><div className="big-num">{eng ? fmtN(v.likes + v.comments) : fmtN(v.views)}</div><span className="small muted">{eng ? "likes + comentarios" : "vistas"}</span></div>
              <div><div className="big-num">{v.outlier != null ? v.outlier.toFixed(1) + "x" : "—"}</div><span className="small muted">vs mediana de la cuenta ({eng ? "interacciones" : "vistas"})</span></div>
              <div><b>{fmtN(v.likes)}</b> <span className="small muted">likes</span></div>
              <div><b>{fmtN(v.comments)}</b> <span className="small muted">comentarios</span></div>
            </div>
            <p className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" }}>{v.caption}</p>
            <div><label id="insp-coll-label">Guardar en colección</label>
              <div className="row" role="group" aria-labelledby="insp-coll-label">
                {collections.length ? collections.map((c) => (
                  <button key={c.id} className={`btn sm ${c.videoIds.includes(v.id) ? "primary" : ""}`} onClick={() => swallow(onToggle(c.id))}>📁 {c.name}</button>
                )) : <span className="small muted">Crea una colección con “+ Colección”.</span>}
              </div>
            </div>
            <div className="row">
              <button className="btn" disabled={running} onClick={() => swallow(onAnalyze())}>{v.analysis ? "Re-analizar" : "🔍 Analizar con IA"}</button>
              <select aria-label="Guía de marca" style={{ width: "auto" }} value={selBrand} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((b) => <option key={b.id} value={b.id}>🎨 {b.name}</option>)}
              </select>
              <button className="btn primary" onClick={() => swallow(onProduce())}>Llevar a producción →</button>
            </div>
            <JobLine job={v.job} />
          </div>
        </div>
        {v.analysis ? <AnalysisView a={v.analysis} frames={v.frameUrls || []} /> : <p className="small muted" style={{ marginTop: 14 }}>Analizar descarga el video, extrae fotogramas, transcribe y la IA lo descompone (consume IA). Si lo llevas a producción ya analizado, el proyecto arranca directo en Guion.</p>}
      </div>
    </div>
  );
}
