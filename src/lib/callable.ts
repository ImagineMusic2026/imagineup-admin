import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";

/**
 * Chamada às Cloud Functions do painel (callables de 2ª geração em
 * southamerica-east1). O token de login vai junto sozinho; quem confere papel,
 * seção e dados é o servidor. Todo `*-api.ts` usa este.
 *
 * Erros chegam como `FunctionsError`, com o `code` ("functions/permission-denied"),
 * a frase do servidor em `message` e `details.reason`. A tela traduz com
 * `callableErrorMessage` (errors.ts).
 */

/**
 * Prazo das callables que rodam até 120 s no servidor (`closeSeasonNow`,
 * `hideFanComments`). O SDK desiste em 70 s por padrão e devolve
 * `deadline-exceeded`, um erro incerto: a chamada pode ter terminado depois.
 */
export const LONG_CALL_TIMEOUT_MS = 130_000;

export interface CallOptions {
  /** Prazo em ms; sem ele, o padrão do SDK (70 s). */
  timeout?: number;
}

export async function call<Request, Response>(name: string, data: Request, options: CallOptions = {}): Promise<Response> {
  const callable = httpsCallable<Request, Response>(
    functions(),
    name,
    options.timeout ? { timeout: options.timeout } : undefined,
  );
  const result = await callable(data);
  return result.data;
}
