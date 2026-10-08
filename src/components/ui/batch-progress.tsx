"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { batchSummaryText, type BatchProgress as Progress, type BatchSummary } from "@/lib/batch";

/**
 * Progresso de uma ação em lote (`runSequential`): a barra e o texto
 * ("12 de 30 recusados"), o botão de parar e, no fim, o resumo (feitos, já
 * estavam assim, falharam). O texto do progresso fica numa região viva.
 */
export function BatchProgress({
  progress,
  summary,
  doneLabel,
  doneOne,
  running,
  stopping,
  onStop,
}: {
  progress: Progress | null;
  summary: BatchSummary<unknown> | null;
  /** O particípio no plural: "recusados", "arquivadas", "ocultos". */
  doneLabel: string;
  /** O particípio no singular, para o resumo de um só: "arquivada". */
  doneOne?: string;
  running: boolean;
  stopping: boolean;
  onStop: () => void;
}) {
  const total = progress?.total ?? summary?.total ?? 0;
  const attempted = progress?.attempted ?? summary?.attempted ?? 0;
  const done = progress?.done ?? summary?.done ?? 0;
  const ratio = total > 0 ? attempted / total : 0;
  return (
    <div className="flex flex-col gap-3">
      {running || progress ? (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label="Andamento"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={attempted}
            className="h-2 w-full overflow-hidden rounded-full bg-fg/[0.08]"
          >
            <div className="h-full rounded-full bg-cyan" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="m-0 text-[13px] text-fg/80 tabular-nums">
              {done} de {total} {doneLabel}
              {stopping ? ". Parando depois deste..." : ""}
            </p>
            {running ? (
              <Button size="sm" variant="secondary" busy={stopping} onClick={onStop}>
                {stopping ? "Parando..." : "Parar"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {summary && !running ? (
        <Notice tone={summary.failed > 0 ? "error" : "success"}>{batchSummaryText(summary, doneLabel, doneOne)}</Notice>
      ) : null}
    </div>
  );
}
