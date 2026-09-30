/**
 * Envios em fila de um só lugar, sempre com o valor mais novo. Puro de
 * propósito (sem React, sem Firebase), para os testes rodarem no Node.
 *
 * Serve para gravações que mandam o estado inteiro (a ordem das centrais):
 * enquanto um envio está no ar, o próximo espera ele terminar, e o que chegar
 * nesse meio tempo troca o que estava esperando. Assim um pedido antigo nunca
 * chega ao servidor depois de um novo, e só o último da fila é enviado.
 */

export type SendOutcome = { status: "sent" } | { status: "failed"; error: unknown } | { status: "skipped" };

export interface LatestSender<T> {
  /** Envia agora ou entra na fila; resolve quando o envio dele termina (ou quando outro mais novo o substitui). */
  send(value: T): Promise<SendOutcome>;
  /** Há um envio no ar. */
  readonly busy: boolean;
}

export function createLatestSender<T>(deliver: (value: T) => Promise<unknown>): LatestSender<T> {
  let busy = false;
  let waiting: { value: T; settle: (outcome: SendOutcome) => void } | null = null;

  async function run(value: T): Promise<SendOutcome> {
    busy = true;
    let outcome: SendOutcome;
    try {
      await deliver(value);
      outcome = { status: "sent" };
    } catch (error) {
      outcome = { status: "failed", error };
    }
    busy = false;
    const next = waiting;
    waiting = null;
    if (next) void run(next.value).then(next.settle);
    return outcome;
  }

  return {
    send(value: T) {
      if (!busy) return run(value);
      waiting?.settle({ status: "skipped" });
      return new Promise<SendOutcome>((settle) => {
        waiting = { value, settle };
      });
    },
    get busy() {
      return busy;
    },
  };
}
