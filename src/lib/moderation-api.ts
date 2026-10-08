import { LONG_CALL_TIMEOUT_MS, call } from "@/lib/callable";
import type { SuspensionReason } from "@/lib/fan-profile";

/**
 * Callables da seção `moderation` (21.9 e 26.4), todas com edição da seção.
 * Moram na fundação porque a Moderação e o Mural (comentários de um post)
 * chamam o `moderateComment`. Toda mudança fica na auditoria do servidor.
 * As que mudam um fã recusam a conta de quem chama (`self`).
 */

export type ModerationAction = "hide" | "keep" | "restore";

/** Ocultar, manter na fila resolvida ou reexibir um comentário. */
export function moderateComment(input: { postId: string; commentId: string; action: ModerationAction }): Promise<{ ok: true; status: string }> {
  return call("moderateComment", input);
}

export interface SetFanSuspendedInput {
  uid: string;
  suspended: boolean;
  /** Só ao suspender. */
  reason?: SuspensionReason;
  /** Só ao suspender; até 280, uma linha. */
  note?: string;
}

export function setFanSuspended(input: SetFanSuspendedInput): Promise<{ ok: true; suspended: boolean }> {
  return call("setFanSuspended", input);
}

/**
 * Oculta uma página (até 24) dos comentários visíveis do fã, numa transação
 * com a auditoria. Chame de novo até `more: false`. Roda até 120 s no
 * servidor, por isso o prazo longo.
 */
export function hideFanComments(uid: string): Promise<{ hidden: number; more: boolean }> {
  return call("hideFanComments", { uid }, { timeout: LONG_CALL_TIMEOUT_MS });
}

/** Troca o @ do fã por um automático; `username` é o @ que a tela mostrou (o servidor confere). */
export function resetFanUsername(input: { uid: string; username: string }): Promise<{ ok: true; username: string }> {
  return call("resetFanUsername", input);
}

export function clearFanPhoto(uid: string): Promise<{ ok: true }> {
  return call("clearFanPhoto", { uid });
}
