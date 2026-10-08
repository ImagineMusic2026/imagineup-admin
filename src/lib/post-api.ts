import { call } from "@/lib/callable";
import type { PostKind } from "@/lib/posts";

/**
 * Callables do Mural (21.9 e 26.5), para admin e editor com `artists`. O
 * `postId` vem do painel: a nova tentativa do mesmo rascunho responde sem
 * criar outro. Toda mudança fica na auditoria do servidor.
 */

export function createPost(input: { postId: string; artistId: string; kind: PostKind; text: string; eventId?: string | null }): Promise<{ postId: string }> {
  return call("createPost", input);
}

export interface PostMediaInput {
  photoPath: string;
  thumbPath: string;
  /** Só no vídeo: ausente mantém o mp4 de agora; `null` tira. */
  videoPath?: string | null;
}

/** Ausente não muda; `media: null` tira a mídia (só fora do ar). */
export function updatePost(input: { postId: string; text?: string; eventId?: string | null; media?: PostMediaInput | null }): Promise<{ ok: true }> {
  return call("updatePost", input);
}

export function setPostStatus(postId: string, status: "published" | "unpublished"): Promise<{ ok: true }> {
  return call("setPostStatus", { postId, status });
}

/** Só o rascunho que nunca foi ao ar. */
export function deletePost(postId: string): Promise<{ ok: true }> {
  return call("deletePost", { postId });
}
