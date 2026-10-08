import { call } from "@/lib/callable";
import type { AdjustInput } from "@/lib/fans";

/**
 * Callables da seção Fãs (26.4), só para quem edita a seção (admin, ou editor
 * com `fans`). As duas gravam auditoria; a busca nunca devolve o e-mail.
 */

export interface AdjustResult {
  status: "applied" | "duplicate";
  balance: number;
  xp: number;
  seasonPoints: number;
}

/**
 * Ajuste de pontos de um fã. O `adjustmentId` é da tentativa: a mesma
 * tentativa repetida depois de uma falha incerta leva o mesmo id e o mesmo
 * corpo (o servidor responde `duplicate` sem lançar de novo).
 */
export function adjustFanPoints(input: AdjustInput): Promise<AdjustResult> {
  return call("adjustFanPoints", input);
}

/** O uid do fã pelo e-mail, ou `null`. Até 50 buscas por pessoa e dia; toda busca conta. */
export function findFanByEmail(email: string): Promise<{ uid: string | null }> {
  return call("findFanByEmail", { email });
}
