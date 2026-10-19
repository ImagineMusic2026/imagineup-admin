"use client";

import Link from "next/link";
import { useCallback } from "react";

import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { useLoad } from "@/components/ui/use-load";
import { countPendingApplications } from "@/lib/fan-club-data";
import { formatNumber } from "@/lib/format";

/**
 * O cartão "Aguardando a equipe" da Visão geral (34.10, item 9), só para quem
 * vê a seção Fã-clubes: o alarme possível sem notificação, para o prazo de até
 * 24 horas úteis (decisão 7). Por enquanto conta as candidaturas em análise;
 * as publicações em análise e as denúncias abertas entram com as etapas 2 do
 * servidor e o Painel B. `round` muda no "Atualizar" da Visão geral.
 */
export function FanClubsWaitingCard({ round }: { round: number }) {
  const count = useLoad(
    useCallback(() => countPendingApplications(), []),
    round,
  );

  return (
    <SectionCard id="titulo-aguardando-equipe" title="Aguardando a equipe" meta="Fã-clubes">
      {count.state.status === "error" ? (
        <LoadError message={count.state.message} headingId="titulo-aguardando-equipe" onRetry={count.reload} />
      ) : count.state.status === "loading" ? (
        <LoadingRow label="Carregando o que espera a equipe..." />
      ) : (
        <>
          <dl className="m-0">
            <div className="flex items-baseline justify-between gap-3 px-5 py-3">
              <dt className="text-[13px] text-fg/70">Candidaturas em análise</dt>
              <dd className={count.state.data > 0 ? "m-0 font-display text-[15px] font-semibold text-cyan tabular-nums" : "m-0 font-display text-[15px] font-semibold text-fg tabular-nums"}>
                {formatNumber(count.state.data)}
              </dd>
            </div>
          </dl>
          <p className="m-0 border-t border-line px-5 py-3 text-[12.5px] leading-snug text-fg/60">
            A meta é responder em até 24 horas úteis, de segunda a sexta, das 8h às 17h.{" "}
            <Link href="/fa-clubes" className="font-semibold text-cyan underline-offset-2 hover:underline">
              Abrir Fã-clubes
            </Link>
          </p>
        </>
      )}
    </SectionCard>
  );
}
