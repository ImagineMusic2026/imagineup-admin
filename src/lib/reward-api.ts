import { call } from "@/lib/callable";
import type { RewardInput, RewardPatch } from "@/lib/rewards";

/**
 * Callables da loja (25.8), para admin e editor com `rewards`. Todas gravam
 * auditoria. Os contatos só vivem no diálogo que os pediu: nada aqui guarda.
 */

/** O rascunho, com o id gerado no painel: o mesmo id de novo (resposta perdida) não cria outro. */
export function createReward(input: { rewardId: string } & RewardInput): Promise<{ rewardId: string }> {
  return call("createReward", input);
}

/** O que mudou, e a foto (`{ photoPath }`, ou `null` para tirar). */
export function updateReward(input: { rewardId: string; photo?: { photoPath: string } | null } & RewardPatch): Promise<{ ok: true }> {
  return call("updateReward", input);
}

/** `published` publica o rascunho ou reabre a encerrada; `closed` encerra a no ar. */
export function setRewardStatus(rewardId: string, status: "published" | "closed"): Promise<{ ok: true }> {
  return call("setRewardStatus", { rewardId, status });
}

export function setRewardStock(rewardId: string, stockTotal: number | null): Promise<{ ok: true; remaining: number | null }> {
  return call("setRewardStock", { rewardId, stockTotal });
}

/** A lista inteira dos rascunhos e das no ar, na ordem nova. */
export function reorderRewards(rewardIds: string[]): Promise<{ ok: true }> {
  return call("reorderRewards", { rewardIds });
}

export function deleteReward(rewardId: string): Promise<{ ok: true }> {
  return call("deleteReward", { rewardId });
}

export interface RedemptionStatusInput {
  redemptionId: string;
  status: "approved" | "delivered" | "refused";
  /** Só na recusa: o motivo que o fã vê, ou `null`. */
  reason?: string | null;
  /** Só na recusa: a vaga volta ao estoque (padrão do servidor: sim). */
  restock?: boolean;
}

export function setRedemptionStatus(input: RedemptionStatusInput): Promise<{ ok: true; status: string; refundedPoints: number }> {
  return call("setRedemptionStatus", input);
}

export interface RedemptionContact {
  redemptionId: string;
  name: string | null;
  username: string | null;
  email: string | null;
}

/** O nome, o @ e o e-mail de agora de quem fez os pedidos abertos (até 50; fica na auditoria). */
export function getRedemptionContacts(redemptionIds: string[]): Promise<{ contacts: RedemptionContact[] }> {
  return call("getRedemptionContacts", { redemptionIds });
}
