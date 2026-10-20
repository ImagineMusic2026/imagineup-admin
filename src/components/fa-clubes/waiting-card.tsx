"use client";

import Link from "next/link";

import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import type { LoadResult } from "@/components/ui/use-load";
import type { WaitingCounts } from "@/lib/fan-clubs";
import { formatNumber } from "@/lib/format";

const ROWS: { key: keyof WaitingCounts; label: string; href: string }[] = [
  { key: "applications", label: "Candidaturas em análise", href: "/fa-clubes" },
  { key: "posts", label: "Publicações em análise", href: "/fa-clubes?aba=publicacoes" },
  { key: "reports", label: "Denúncias abertas", href: "/fa-clubes?aba=denuncias" },
];

/**
 * O cartão "Aguardando a equipe" da Visão geral (34.10, item 9), só para quem
 * vê a seção Fã-clubes: as candidaturas e as publicações em análise e as
 * denúncias abertas, cada uma por `count()`. É o alarme possível sem
 * notificação, para o prazo de até 24 horas úteis (decisão 7). A contagem vem
 * da Visão geral, que a lê uma vez e no "Atualizar": o cartão muda de lugar na
 * árvore conforme o estado dos números (o erro, o "ainda não começaram", a
 * grade), e com a leitura dentro dele cada troca contaria de novo.
 */
export function FanClubsWaitingCard({ count }: { count: LoadResult<WaitingCounts> }) {
  return (
    <SectionCard id="titulo-aguardando-equipe" title="Aguardando a equipe" meta="Fã-clubes">
      {count.state.status === "error" ? (
        <LoadError message={count.state.message} headingId="titulo-aguardando-equipe" onRetry={count.reload} />
      ) : count.state.status === "loading" ? (
        <LoadingRow label="Carregando o que espera a equipe..." />
      ) : (
        <>
          <dl className="m-0">
            {ROWS.map((row) => {
              const value = count.state.status === "ready" ? count.state.data[row.key] : 0;
              return (
                <div key={row.key} className="flex items-baseline justify-between gap-3 border-t border-line px-5 py-3 first:border-t-0">
                  <dt className="text-[13px] text-fg/70">
                    <Link href={row.href} className="underline-offset-2 hover:text-fg hover:underline">
                      {row.label}
                    </Link>
                  </dt>
                  <dd className={value > 0 ? "m-0 font-display text-[15px] font-semibold text-cyan tabular-nums" : "m-0 font-display text-[15px] font-semibold text-fg tabular-nums"}>{formatNumber(value)}</dd>
                </div>
              );
            })}
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
