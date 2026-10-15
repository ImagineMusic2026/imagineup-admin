import { LONG_CALL_TIMEOUT_MS, call } from "@/lib/callable";
import type { SuspensionReason } from "@/lib/fan-profile";
import type { ProfileTextField, UsernameResetReason } from "@/lib/moderation";

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

/**
 * Troca o @ do fã por um automático; `username` é o @ que a tela mostrou (o
 * servidor confere). O `reason` vai sempre escrito (32.2): com `moderation`, o
 * `changeableAt` volta em ISO, daqui a 30 dias; com `central`, `null`.
 */
export function resetFanUsername(input: { uid: string; username: string; reason: UsernameResetReason }): Promise<{ ok: true; username: string; changeableAt: string | null }> {
  return call("resetFanUsername", input);
}

export function clearFanPhoto(uid: string): Promise<{ ok: true }> {
  return call("clearFanPhoto", { uid });
}

/**
 * Fecha a denúncia de perfil (29.6): "Manter" (`kept`) ou "Resolver"
 * (`actioned`), com o `round` que o card leu. O item que reabriu depois que o
 * card abriu recusa com `stale-report`; o que não está mais na fila, com
 * `profile-not-reported`. A mesma resolução de novo não grava.
 */
export function resolveProfileReport(input: { uid: string; resolution: "kept" | "actioned"; round: number }): Promise<{ ok: true; resolution: "kept" | "actioned" }> {
  return call("resolveProfileReport", input);
}

/**
 * Apaga a bio, as redes ou as duas (28.6). `cleared` traz os campos que
 * saíram, na ordem `bio`, `socials`; vazio quando não havia o que apagar
 * (sem gravar nem auditar). A auditoria guarda os campos, nunca o texto.
 */
export function clearFanProfileText(input: { uid: string; fields: ProfileTextField[] }): Promise<{ ok: true; cleared: ProfileTextField[] }> {
  return call("clearFanProfileText", input);
}
