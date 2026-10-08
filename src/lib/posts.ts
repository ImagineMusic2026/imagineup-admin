import type { ImageSpec } from "@/lib/image-prep";
import { toDate } from "@/lib/staff";
import { cleanMultiline, isVisibleMultiline } from "@/lib/visible-line";

/**
 * O mural das centrais (21 e 26.16), puro: o post lido, os tipos e as
 * situações, o formulário com a validação do servidor e as regras da mídia
 * (foto e capa no navegador; o mp4 até 50 MB).
 */

export const POST_KINDS = ["photo", "video", "text", "event"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_KIND_LABELS: Record<PostKind, string> = { photo: "Foto", video: "Vídeo", text: "Texto", event: "Show" };

export type PostStatus = "draft" | "published" | "unpublished";
export const POST_STATUS_LABELS: Record<PostStatus, string> = { draft: "Rascunho", published: "No ar", unpublished: "Fora do ar" };

export const POST_TEXT_MAX = 2_000;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const POSTS_PAGE_SIZE = 25;
export const COMMENTS_PAGE_SIZE = 20;

/** Foto e capa: a proporção dela entre 4:5 e 16:9, até 1080 de largura, com a miniatura de 480. */
export const POST_IMAGE_SPEC: ImageSpec = { aspectRange: { min: 4 / 5, max: 16 / 9 }, large: 1080, thumb: 480, minWidth: 600 };

export const COUNTS_HINT = "As contagens chegam alguns segundos depois.";
export const EVENT_DRAFT_WARNING = "Este show ainda não está no ar: o post só publica depois dele.";
export const WAS_PUBLISHED_POST_TEXT = "Este post já esteve no ar. Tire do ar em vez de apagar.";

export interface MediaImage {
  url: string;
  path: string;
  width: number;
  height: number;
}

export interface PostMedia {
  photo: MediaImage | null;
  thumb: MediaImage | null;
  video: { url: string; path: string; size: number } | null;
}

export interface Post {
  id: string;
  artistId: string;
  kind: PostKind;
  text: string;
  media: PostMedia | null;
  eventId: string | null;
  status: PostStatus;
  publishedAt: Date | null;
  createdAt: Date | null;
  likeCount: number;
  commentCount: number;
}

function image(value: unknown): MediaImage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.url !== "string" || typeof data.path !== "string") return null;
  return { url: data.url, path: data.path, width: Number(data.width) || 0, height: Number(data.height) || 0 };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function parsePost(id: string, data: Record<string, unknown>): Post {
  const media = data.media && typeof data.media === "object" ? (data.media as Record<string, unknown>) : null;
  const video = media?.video && typeof media.video === "object" ? (media.video as Record<string, unknown>) : null;
  return {
    id,
    artistId: typeof data.artistId === "string" ? data.artistId : "",
    kind: (POST_KINDS as readonly unknown[]).includes(data.kind) ? (data.kind as PostKind) : "text",
    text: typeof data.text === "string" ? data.text : "",
    media: media
      ? {
          photo: image(media.photo),
          thumb: image(media.thumb),
          video: video && typeof video.url === "string" && typeof video.path === "string" ? { url: video.url, path: video.path, size: count(video.size) } : null,
        }
      : null,
    eventId: typeof data.eventId === "string" && data.eventId ? data.eventId : null,
    status: data.status === "published" || data.status === "unpublished" ? data.status : "draft",
    publishedAt: toDate(data.publishedAt),
    createdAt: toDate(data.createdAt),
    likeCount: count(data.likeCount),
    commentCount: count(data.commentCount),
  };
}

/** O que a foto e o vídeo pedem antes de publicar. */
export function needsMedia(kind: PostKind): boolean {
  return kind === "photo" || kind === "video";
}

/** Apagar só o post que nunca foi ao ar. */
export function postDeleteBlocked(post: Pick<Post, "publishedAt">): string | null {
  return post.publishedAt ? WAS_PUBLISHED_POST_TEXT : null;
}

/** O vídeo: mp4 até 50 MB; MOV e outros formatos recusados com a frase. */
export function videoFileProblem(file: { type: string; name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (file.type === "video/quicktime" || name.endsWith(".mov")) return "Vídeo MOV não vale. Exporte em MP4 e tente de novo.";
  if (file.type !== "video/mp4" && !name.endsWith(".mp4")) return "O vídeo precisa ser MP4.";
  if (file.size > VIDEO_MAX_BYTES) return "O vídeo passa de 50 MB. Envie uma versão menor.";
  if (file.size === 0) return "O arquivo do vídeo está vazio.";
  return null;
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface PostForm {
  artistId: string;
  kind: PostKind;
  text: string;
  eventId: string;
}

export function postFormOf(post: Post): PostForm {
  return { artistId: post.artistId, kind: post.kind, text: post.text, eventId: post.eventId ?? "" };
}

export type PostErrors = Partial<Record<keyof PostForm | "media", string>>;

/** O texto limpo como o servidor (`cleanMultiline`): obrigatório no texto e no show, opcional na foto e no vídeo. */
export function validatePost(form: PostForm): { errors: PostErrors; text: string | null } {
  const errors: PostErrors = {};
  if (!form.artistId) errors.artistId = "Escolha a central.";
  const text = cleanMultiline(form.text);
  const required = form.kind === "text" || form.kind === "event";
  if (required && !text) errors.text = "Escreva o texto do post.";
  else if (text.length > POST_TEXT_MAX) errors.text = `Até ${POST_TEXT_MAX.toLocaleString("pt-BR")} caracteres.`;
  else if (text && !isVisibleMultiline(text)) errors.text = "O texto tem caracteres que não aparecem no app.";
  if (form.kind === "event" && !form.eventId) errors.eventId = "Escolha o show.";
  return Object.keys(errors).length > 0 ? { errors, text: null } : { errors, text };
}

/** "123 de 2.000". */
export function textCounter(text: string): string {
  return `${cleanMultiline(text).length.toLocaleString("pt-BR")} de ${POST_TEXT_MAX.toLocaleString("pt-BR")}`;
}

/** As duas linhas do texto na tabela. */
export function postExcerpt(text: string, max = 140): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "173 KB" ou "12,4 MB". */
export function fileSizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** A criação sem resposta: pode ter gravado, e a nova tentativa com o mesmo id não cria outro. */
export function uncertainCreateText(what: string): string {
  return `Não deu para confirmar se ${what} foi criado. Salve de novo: a nova tentativa não cria outro.`;
}
