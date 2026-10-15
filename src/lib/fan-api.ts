import { call } from "@/lib/callable";
import type { FanDataPage, FanDataPageRequest, FanDataStart } from "@/lib/fan-data-export";
import type { AdjustInput } from "@/lib/fans";

/**
 * Callables da seção Fãs: o ajuste e a busca (26.4), para quem edita a seção
 * (admin, ou editor com `fans`), e os pedidos de dados (32.2), só para admin.
 * Gravam auditoria (menos as páginas da exportação); a busca nunca devolve o
 * e-mail.
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

/*
 * Pedidos de dados (LGPD, 32.2), só para admin, com o prazo padrão do SDK. O
 * `email` é o que a pessoa da equipe digitou: o servidor confere com o da
 * conta e nunca o grava no log nem na auditoria.
 */

/** A primeira chamada da exportação: o começo do arquivo e as partes. Audita e conta no teto de 20 do dia. */
export function exportFanDataStart(input: { uid: string; email: string }): Promise<FanDataStart> {
  return call("exportFanData", input);
}

/** Uma página de uma parte; o pedido sai do `pageRequest`, sem a chave `after` na primeira. */
export function exportFanDataPage(request: FanDataPageRequest): Promise<FanDataPage> {
  return call("exportFanData", request);
}

/** A exclusão da conta, a mesma do "Excluir conta" do app. */
export function deleteFanAccount(input: { uid: string; email: string }): Promise<{ status: "deleted" | "pending" }> {
  return call("deleteFanAccount", input);
}
