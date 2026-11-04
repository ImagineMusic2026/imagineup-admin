import { call } from "@/lib/callable";
import type { SupportAction, SupportStatus } from "@/lib/support";

/**
 * A callable do Suporte (seção 38), com edição da seção (admin, ou editor
 * com a seção; o Leitor recebe `no-section`). Resolve ou reabre uma mensagem,
 * com a auditoria na mesma transação (`support.message.resolved` ou
 * `support.message.reopened`, sem o texto). A mensagem que já está no estado
 * pedido responde `ok` sem gravar, então repetir depois de uma resposta
 * perdida não grava duas vezes. A que não existe mais recusa com
 * `message-not-found`.
 */
export function resolveSupportMessage(input: { id: string; action: SupportAction }): Promise<{ ok: true; status: SupportStatus }> {
  return call("resolveSupportMessage", input);
}
