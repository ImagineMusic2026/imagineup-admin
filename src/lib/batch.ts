/**
 * Ações em lote feitas pelo painel uma chamada por vez, puro: arquivar as
 * missões encerradas, recusar os pedidos de um show cancelado, ocultar os
 * comentários de um fã. Uma por vez porque cada chamada pode depender da
 * anterior (o `version` da configuração) e para a pessoa poder parar no meio.
 * O servidor não tem lote: cada chamada é uma mudança, com a auditoria dela.
 */

/** O que uma chamada fez: mudou, ou já estava assim (o servidor respondeu sem gravar). */
export type ItemOutcome = "done" | "unchanged";

export interface BatchProgress {
  /** Itens já tentados. */
  attempted: number;
  total: number;
  done: number;
  unchanged: number;
  failed: number;
}

export interface BatchFailure<T> {
  item: T;
  error: unknown;
}

export interface BatchSummary<T> extends BatchProgress {
  failures: BatchFailure<T>[];
  /** Parou antes do fim: a pessoa pediu, ou um erro do `stopOn`. */
  stopped: boolean;
  /** O erro que parou o lote (`stopOn`), se foi isso. */
  stopError: unknown;
}

export interface RunSequentialOptions {
  onProgress?: (progress: BatchProgress) => void;
  /** Erro que não adianta repetir nos próximos (o acesso caiu, a configuração mudou): para o lote. */
  stopOn?: (error: unknown) => boolean;
  /** Conferido antes de cada item: `true` para parar (o botão "Parar"). */
  shouldStop?: () => boolean;
}

export async function runSequential<T>(
  items: readonly T[],
  run: (item: T, index: number) => Promise<ItemOutcome>,
  { onProgress, stopOn, shouldStop }: RunSequentialOptions = {},
): Promise<BatchSummary<T>> {
  const summary: BatchSummary<T> = {
    attempted: 0,
    total: items.length,
    done: 0,
    unchanged: 0,
    failed: 0,
    failures: [],
    stopped: false,
    stopError: null,
  };
  const report = () =>
    onProgress?.({
      attempted: summary.attempted,
      total: summary.total,
      done: summary.done,
      unchanged: summary.unchanged,
      failed: summary.failed,
    });
  for (const [index, item] of items.entries()) {
    if (shouldStop?.()) {
      summary.stopped = true;
      break;
    }
    try {
      const outcome = await run(item, index);
      if (outcome === "unchanged") summary.unchanged += 1;
      else summary.done += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ item, error });
      if (stopOn?.(error)) {
        summary.attempted += 1;
        summary.stopped = true;
        summary.stopError = error;
        report();
        break;
      }
    }
    summary.attempted += 1;
    report();
  }
  return summary;
}

/**
 * O resumo por extenso: "12 recusados, 2 já estavam assim e 1 falhou."
 * `doneLabel` é o particípio no plural ("recusados", "arquivadas").
 */
export function batchSummaryText(summary: Pick<BatchSummary<unknown>, "done" | "unchanged" | "failed" | "stopped" | "attempted" | "total">, doneLabel: string): string {
  const parts = [`${summary.done} ${doneLabel}`];
  if (summary.unchanged > 0) parts.push(`${summary.unchanged} já ${summary.unchanged === 1 ? "estava" : "estavam"} assim`);
  if (summary.failed > 0) parts.push(`${summary.failed} ${summary.failed === 1 ? "falhou" : "falharam"}`);
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
  const rest = summary.total - summary.attempted;
  return summary.stopped && rest > 0 ? `${text}. Parou antes do fim: ${rest} ${rest === 1 ? "ficou" : "ficaram"} sem tentar.` : `${text}.`;
}
