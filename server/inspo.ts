// Inspiración: seguir cuentas, cargar sus videos con métricas y calcular "outliers"
// (vistas del video ÷ mediana de vistas de la cuenta).
// Fuentes de datos: Apify (Instagram/TikTok, recomendado) o yt-dlp (YouTube Shorts; IG/TikTok con cookies, menos estable).
import fs from "node:fs";
import path from "node:path";
import { load, INSPO_DIR } from "./db.ts";
import { run } from "./media.ts";
import type { InspoVideo, Platform } from "../shared/types.ts";

const APIFY = "https://api.apify.com/v2/acts";

type Metric = "views" | "engagement";

/** Video tal como lo devuelve una fuente, antes de enriquecerlo en fetchProfile. */
export interface RawVideo {
  id: string;
  url: string;
  caption: string;
  thumbUrl: string;
  videoUrl: string;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  postedAt: string | null;
}
/** Video enriquecido (plataforma, cuenta, outlier, miniatura local). */
export interface ProfileVideo extends RawVideo {
  platform: Platform;
  account: string;
  metric: Metric;
  outlier: number | null;
  thumbFile: string | null;
}
interface RawProfile {
  username: string;
  fullName: string;
  biography: string;
  followers: number;
  avatarUrl: string;
  metric?: Metric;
  videos: RawVideo[];
}
export interface Profile extends Omit<RawProfile, "videos" | "metric"> {
  videos: ProfileVideo[];
  platform: Platform;
  metric: Metric;
  avatarFile: string | null;
  medianViews: number;
  dir: string;
}

// Formas (parciales, todo opcional) del JSON externo de Apify / yt-dlp / Graph.
interface ApiError { error?: { message?: string } }
interface IgProfileItem { fullName?: string; biography?: string; followersCount?: number; profilePicUrlHD?: string; profilePicUrl?: string }
interface IgReelItem {
  error?: unknown; shortCode?: string; id?: string; url?: string; caption?: string; displayUrl?: string; thumbnailUrl?: string; videoUrl?: string;
  videoPlayCount?: number; videoViewCount?: number; playsCount?: number; likesCount?: number; commentsCount?: number; videoDuration?: number; timestamp?: string;
}
interface TtItem {
  id?: string; webVideoUrl?: string; text?: string; playCount?: number; diggCount?: number; commentCount?: number; createTimeISO?: string;
  authorMeta?: { nickName?: string; signature?: string; fans?: number; avatar?: string };
  videoMeta?: { coverUrl?: string; originalCoverUrl?: string; downloadAddr?: string; duration?: number };
}
interface YtThumb { url?: string }
interface YtEntry {
  id?: string; url?: string; webpage_url?: string; title?: string; description?: string; thumbnails?: YtThumb[]; thumbnail?: string;
  view_count?: number; like_count?: number; comment_count?: number; duration?: number; timestamp?: number;
}
interface YtPlaylist { channel?: string; uploader?: string; title?: string; description?: string; channel_follower_count?: number; thumbnails?: YtThumb[]; entries?: YtEntry[] }
interface GraphMedia {
  id?: string; caption?: string; like_count?: number; comments_count?: number; media_type?: string; media_product_type?: string;
  permalink?: string; timestamp?: string; media_url?: string; thumbnail_url?: string;
}
interface GraphBusinessDiscovery { name?: string; biography?: string; followers_count?: number; profile_picture_url?: string; media?: { data?: GraphMedia[] } }
interface GraphResponse extends ApiError {
  data?: { name?: string; instagram_business_account?: { id: string; username: string } }[];
  business_discovery?: GraphBusinessDiscovery;
}

async function apify<T>(actor: string, input: unknown, timeoutSec = 240): Promise<T[]> {
  const token = load().settings.apifyToken;
  if (!token) throw new Error("NO_APIFY");
  const r = await fetch(`${APIFY}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeoutSec}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw new Error(`Apify (${actor}) respondió ${r.status}: ${(j as ApiError | null)?.error?.message || ""}`);
  return Array.isArray(j) ? (j as T[]) : [];
}

async function download(url: string | undefined, file: string): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return file;
  } catch { return null; }
}

export function cleanHandle(h: unknown): string {
  const s = String(h).trim();
  const m = s.match(/(?:instagram\.com\/|tiktok\.com\/@|youtube\.com\/@)([\w.\-]+)/i);
  return (m ? m[1] : s).replace(/^@/, "").replace(/\/.*$/, "").toLowerCase();
}

export function detectPlatform(input: string): Platform {
  if (/tiktok\.com/i.test(input)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(input)) return "youtube";
  return "instagram";
}

const median = (a: number[]): number => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- Instagram ----------
async function igApify(username: string, limit: number): Promise<RawProfile> {
  const [profile] = await apify<IgProfileItem>("apify~instagram-profile-scraper", { usernames: [username] }, 120);
  const reels = await apify<IgReelItem>("apify~instagram-reel-scraper", { username: [username], resultsLimit: limit });
  return {
    username,
    fullName: profile?.fullName || "",
    biography: profile?.biography || "",
    followers: profile?.followersCount || 0,
    avatarUrl: profile?.profilePicUrlHD || profile?.profilePicUrl || "",
    videos: reels.filter((x) => !x.error).map((x) => ({
      id: "ig_" + (x.shortCode || x.id),
      url: x.url || (x.shortCode ? `https://www.instagram.com/reel/${x.shortCode}/` : ""),
      caption: x.caption || "",
      thumbUrl: x.displayUrl || x.thumbnailUrl || "",
      videoUrl: x.videoUrl || "",
      views: x.videoPlayCount || x.videoViewCount || x.playsCount || 0,
      likes: x.likesCount || 0,
      comments: x.commentsCount || 0,
      duration: x.videoDuration || 0,
      postedAt: x.timestamp || null,
    })),
  };
}

// ---------- TikTok ----------
async function ttApify(username: string, limit: number): Promise<RawProfile> {
  const items = await apify<TtItem>("clockworks~tiktok-scraper", { profiles: [username], resultsPerPage: limit, shouldDownloadVideos: false, shouldDownloadCovers: false });
  const a = items[0]?.authorMeta || {};
  return {
    username,
    fullName: a.nickName || "",
    biography: a.signature || "",
    followers: a.fans || 0,
    avatarUrl: a.avatar || "",
    videos: items.map((x) => ({
      id: "tt_" + x.id,
      url: x.webVideoUrl || "",
      caption: x.text || "",
      thumbUrl: x.videoMeta?.coverUrl || x.videoMeta?.originalCoverUrl || "",
      videoUrl: x.videoMeta?.downloadAddr || "",
      views: x.playCount || 0,
      likes: x.diggCount || 0,
      comments: x.commentCount || 0,
      duration: x.videoMeta?.duration || 0,
      postedAt: x.createTimeISO || null,
    })),
  };
}

// ---------- yt-dlp (YouTube Shorts y respaldo) ----------
async function ytdlpList(platform: Platform, username: string, limit: number): Promise<RawProfile> {
  const url = platform === "youtube" ? `https://www.youtube.com/@${username}/shorts` : platform === "tiktok" ? `https://www.tiktok.com/@${username}` : `https://www.instagram.com/${username}/reels/`;
  const args = ["--flat-playlist", "-J", "--playlist-end", String(limit)];
  const cookies = load().settings.cookiesBrowser;
  if (cookies && platform !== "youtube") args.push("--cookies-from-browser", cookies);
  args.push(url);
  const { out } = await run("yt-dlp", args, { timeoutMs: 4 * 60 * 1000 });
  const j = JSON.parse(out) as YtPlaylist;
  return {
    username,
    fullName: j.channel || j.uploader || j.title || "",
    biography: j.description || "",
    followers: j.channel_follower_count || 0,
    avatarUrl: (j.thumbnails || []).slice(-1)[0]?.url || "",
    videos: (j.entries || []).map((e) => ({
      id: `${platform.slice(0, 2)}_${e.id}`,
      url: (e.url?.startsWith("http") ? e.url : platform === "youtube" ? `https://www.youtube.com/shorts/${e.id}` : e.webpage_url || e.url) as string,
      caption: e.title || e.description || "",
      thumbUrl: (e.thumbnails || []).slice(-1)[0]?.url || e.thumbnail || "",
      videoUrl: "",
      views: e.view_count || 0,
      likes: e.like_count || 0,
      comments: e.comment_count || 0,
      duration: e.duration || 0,
      postedAt: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null,
    })),
  };
}

// ---------- Instagram Graph API oficial (gratis): Business Discovery ----------
// Requiere: tu cuenta de IG profesional (Creador/Empresa) vinculada a una Página de Facebook,
// una app de Meta y un token de acceso. Solo funciona con cuentas objetivo profesionales.
// No entrega vistas de cuentas ajenas → el outlier se calcula con likes + comentarios.
const graphBase = (): string => `https://graph.facebook.com/${load().settings.graphVersion || "v23.0"}`;

async function graph(pathAndQuery: string): Promise<GraphResponse> {
  const token = load().settings.metaToken;
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const r = await fetch(`${graphBase()}/${pathAndQuery}${sep}access_token=${encodeURIComponent(token)}`);
  const j = (await r.json().catch(() => ({}))) as GraphResponse;
  if (!r.ok || j.error) throw new Error(`Meta: ${j.error?.message || r.status}`);
  return j;
}

export interface IgBusinessAccount { page: string; id: string; username: string }

/** Busca el ID de tu cuenta de Instagram profesional a partir del token (vía tus Páginas de Facebook). */
export async function detectIgUser(): Promise<IgBusinessAccount[]> {
  const j = await graph("me/accounts?fields=name,instagram_business_account{id,username}&limit=50");
  const found: IgBusinessAccount[] = (j.data || []).flatMap((p) => (p.instagram_business_account ? [{ page: p.name as string, id: p.instagram_business_account.id, username: p.instagram_business_account.username }] : []));
  if (!found.length) throw new Error("El token no ve ninguna cuenta de Instagram profesional vinculada a tus Páginas de Facebook.");
  return found;
}

async function igGraph(username: string, limit: number): Promise<RawProfile> {
  const me = load().settings.metaIgUserId;
  if (!me) throw new Error("Falta detectar tu cuenta de Instagram profesional (Ajustes → Instagram oficial → Detectar).");
  const fields = `business_discovery.username(${username}){username,name,biography,followers_count,media_count,profile_picture_url,media.limit(${Math.min(limit, 50)}){id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url}}`;
  let bd: GraphBusinessDiscovery;
  // Como el original: si la respuesta no trae business_discovery, falla más abajo con TypeError.
  try { bd = (await graph(`${me}?fields=${encodeURIComponent(fields)}`)).business_discovery as GraphBusinessDiscovery; }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/business|not found|cannot be found|Invalid user/i.test(msg) ? `@${username} no es una cuenta profesional o no existe (la API oficial solo ve cuentas de Creador/Empresa). ${msg}` : msg);
  }
  const media = (bd.media?.data || []).filter((m) => m.media_type === "VIDEO" || m.media_product_type === "REELS");
  return {
    username,
    fullName: bd.name || "",
    biography: bd.biography || "",
    followers: bd.followers_count || 0,
    avatarUrl: bd.profile_picture_url || "",
    metric: "engagement",
    videos: media.map((m) => ({
      id: "ig_" + m.id,
      url: m.permalink as string,
      caption: m.caption || "",
      thumbUrl: m.thumbnail_url || m.media_url || "",
      videoUrl: m.media_type === "VIDEO" ? m.media_url || "" : "",
      views: 0,
      likes: m.like_count || 0,
      comments: m.comments_count || 0,
      duration: 0,
      postedAt: m.timestamp || null,
    })),
  };
}

/** Carga perfil + videos recientes, guarda miniaturas localmente y calcula outliers. */
export async function fetchProfile(input: string, { platform, limit = 30 }: { platform?: Platform; limit?: number } = {}): Promise<Profile> {
  platform = platform || detectPlatform(input);
  const username = cleanHandle(input);
  const s = load().settings;
  let data: RawProfile;
  if (platform === "youtube") data = await ytdlpList("youtube", username, limit);
  else if (platform === "instagram" && s.metaToken) data = await igGraph(username, limit);
  else if (s.apifyToken) data = platform === "tiktok" ? await ttApify(username, limit) : await igApify(username, limit);
  else {
    try { data = await ytdlpList(platform, username, limit); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(platform === "instagram" ? `Conecta la API oficial de Instagram (gratis) en Ajustes para cargar perfiles. (Intento con yt-dlp falló: ${msg.slice(0, 120)})` : `No pude cargar el perfil de TikTok con yt-dlp: ${msg.slice(0, 140)}`);
    }
  }
  const dir = path.join(INSPO_DIR, `${platform}_${username}`);
  fs.mkdirSync(dir, { recursive: true });
  const avatar = await download(data.avatarUrl, path.join(dir, "avatar.jpg"));
  // Outlier sobre vistas; si la fuente no da vistas (API oficial de IG), sobre likes + comentarios.
  const metric: Metric = data.metric || "views";
  const score = (v: RawVideo): number => (metric === "views" ? v.views : v.likes + v.comments);
  const med = median(data.videos.map(score));
  const videos: ProfileVideo[] = [];
  for (const raw of data.videos) {
    // Se muta el mismo objeto (como el original) para conservar el orden de las claves.
    const v = raw as ProfileVideo;
    v.platform = platform;
    v.account = username;
    v.metric = metric;
    v.outlier = med && score(v) ? +(score(v) / med).toFixed(2) : null;
    const f = path.join(dir, v.id.replace(/[^\w-]/g, "") + ".jpg");
    v.thumbFile = fs.existsSync(f) ? f : await download(v.thumbUrl, f);
    videos.push(v);
  }
  return { ...data, videos, platform, metric, avatarFile: avatar, medianViews: med, dir };
}

/** Descarga el video de un item de inspiración (URL directa de Apify o yt-dlp). */
export async function downloadVideo(video: Pick<InspoVideo, "videoUrl" | "platform" | "url">, dir: string): Promise<string | null> {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "ref.mp4");
  if (fs.existsSync(f)) return f;
  if (video.videoUrl && (await download(video.videoUrl, f))) return f;
  const args = ["--no-playlist", "-f", "mp4/best[ext=mp4]/best", "-o", f, "--max-filesize", "300M"];
  const cookies = load().settings.cookiesBrowser;
  if (cookies && video.platform !== "youtube") args.push("--cookies-from-browser", cookies);
  args.push(video.url);
  await run("yt-dlp", args, { timeoutMs: 5 * 60 * 1000 });
  return fs.existsSync(f) ? f : null;
}
