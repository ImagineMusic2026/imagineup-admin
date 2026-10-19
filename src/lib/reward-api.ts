import { call } from "@/lib/callable";
import { CODE_PATTERN, type RewardInput, type RewardPatch } from "@/lib/rewards";
import { isWhatsapp } from "@/lib/whatsapp";

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
  /**
   * O WhatsApp de agora do fã (seção 35 da nota do app), em E.164, ou `null`:
   * o fã que só resgatou pelo app de antes, a conta que saiu, ou o servidor de
   * antes da seção 35, que não manda o campo.
   */
  whatsapp: string | null;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * Um contato da resposta, com o que falta valendo `null` e o WhatsApp
 * conferido de novo. O código fora do formato do pedido vira "" e o contato
 * sai da lista: ele entraria no texto do link da conversa.
 */
export function parseRedemptionContact(raw: unknown): RedemptionContact {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    redemptionId: typeof data.redemptionId === "string" && CODE_PATTERN.test(data.redemptionId) ? data.redemptionId : "",
    name: textOrNull(data.name),
    username: textOrNull(data.username),
    email: textOrNull(data.email),
    whatsapp: isWhatsapp(data.whatsapp) ? data.whatsapp : null,
  };
}

/**
 * A conta que saiu do Auth: o servidor devolve o contato com tudo `null`. Uma
 * conta que existe sem e-mail (o login sem e-mail que o bloco B pode trazer)
 * não é excluída: o diálogo mostra "Sem e-mail" e o WhatsApp dela.
 */
export function isDeletedContact(contact: RedemptionContact): boolean {
  return contact.name === null && contact.username === null && contact.email === null && contact.whatsapp === null;
}

/**
 * O nome, o @, o e-mail e o WhatsApp de agora de quem fez os pedidos abertos
 * (até 50; fica na auditoria, sem os contatos). O resultado vive só no
 * diálogo que o pediu.
 */
export async function getRedemptionContacts(redemptionIds: string[]): Promise<{ contacts: RedemptionContact[] }> {
  const result = await call<{ redemptionIds: string[] }, { contacts?: unknown }>("getRedemptionContacts", { redemptionIds });
  const contacts = Array.isArray(result?.contacts) ? result.contacts : [];
  return { contacts: contacts.map(parseRedemptionContact).filter((contact) => contact.redemptionId !== "") };
}
