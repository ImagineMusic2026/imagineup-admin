"use client";

import { useCallback, useMemo, useState } from "react";

import { DataFreshness } from "@/components/painel/data-freshness";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Points } from "@/components/recompensas/reward-bits";
import { BarChart, type BarPoint } from "@/components/ui/bar-chart";
import { DataTable, type Column } from "@/components/ui/data-table";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { DEFAULT_PERIOD, PeriodPicker, type PeriodDays } from "@/components/ui/period-picker";
import { useLoad } from "@/components/ui/use-load";
import { rangeEndingYesterday } from "@/lib/day";
import { countLabel, formatDay, formatDayRange, formatNumber, formatWeekdayDay } from "@/lib/format";
import { getRewardStats } from "@/lib/reward-data";
import { rewardNumbers, rewardTable, type Reward } from "@/lib/rewards";
import { lastClosedAt, seriesByDay, type RewardDay } from "@/lib/stats";

const GRID = "xl:grid xl:grid-cols-[minmax(0,1.6fr)_repeat(7,minmax(0,0.7fr))] xl:items-center xl:gap-4";

type Row = { rewardId: string; numbers: RewardDay };

/** Números: pedidos, pontos gastos, devolvidos e entregues no período, por dia e por recompensa. */
export function NumbersTab({ rewards, now, refreshKey }: { rewards: Reward[] | null; now: number; refreshKey: number }) {
  const [days, setDays] = useState<PeriodDays>(DEFAULT_PERIOD);
  const range = useMemo(() => rangeEndingYesterday(days, now), [days, now]);
  const stats = useLoad(
    useCallback(() => {
      void refreshKey;
      return getRewardStats(range, now);
    }, [range, now, refreshKey]),
  );
  const date = new Date(now);
  const read = stats.state.status === "ready" ? stats.state.data : null;
  const totals = read ? rewardNumbers(read.days) : null;
  const titles = new Map((rewards ?? []).map((reward) => [reward.id, reward.title]));

  const series: BarPoint[] = read
    ? seriesByDay(range, read.days, (day) => day.totals.redeemRequested).map((point) => ({
        key: point.day,
        label: formatDay(point.day, date),
        longLabel: formatWeekdayDay(point.day, date),
        value: point.value,
        partial: point.partial,
        missing: point.missing,
      }))
    : [];

  const columns: Column<Row>[] = [
    { key: "reward", header: "Recompensa", cell: (row) => <span className="font-semibold text-fg">{titles.get(row.rewardId) ?? row.rewardId}</span> },
    { key: "requested", header: "Pedidos", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.numbers.requested)}</span> },
    { key: "spent", header: "Gastos", align: "end", cell: (row) => <Points value={row.numbers.spent} /> },
    { key: "approved", header: "Aprovados", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.numbers.approved)}</span> },
    { key: "delivered", header: "Entregues", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.numbers.delivered)}</span> },
    { key: "refused", header: "Recusados", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.numbers.refused)}</span> },
    { key: "canceled", header: "Cancelados", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.numbers.canceled)}</span> },
    { key: "refunded", header: "Devolvidos", align: "end", cell: (row) => <Points value={row.numbers.refunded} /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PeriodPicker value={days} onChange={setDays} now={now} />
        {read ? <DataFreshness state={read.state} closedAt={lastClosedAt(read.days)} now={date} /> : null}
      </div>

      {stats.state.status === "error" ? (
        <SectionCard id="titulo-numeros-loja" title="Números da loja">
          <LoadError message={stats.state.message} headingId="titulo-numeros-loja" onRetry={stats.reload} />
        </SectionCard>
      ) : (
        <>
          <MetricGrid>
            <MetricCard label="Pedidos" value={totals ? formatNumber(totals.requested) : ""} loading={!totals} />
            <MetricCard label="Pontos gastos" tone="points" value={totals ? formatNumber(totals.spent) : ""} unit="pts" loading={!totals} />
            <MetricCard label="Pontos devolvidos" tone="points" value={totals ? formatNumber(totals.refunded) : ""} unit="pts" loading={!totals} />
            <MetricCard label="Entregues" value={totals ? formatNumber(totals.delivered) : ""} loading={!totals} />
          </MetricGrid>

          <SectionCard id="titulo-pedidos-dia" title="Pedidos por dia" meta={formatDayRange(range.from, range.to, date)}>
            <div className="px-5 pt-1 pb-5">
              {read ? (
                <BarChart
                  title="Pedidos por dia"
                  summary={`${days} dias, ${countLabel(totals?.requested ?? 0, "pedido", "pedidos")} no total`}
                  series={series}
                  describe={(point) => countLabel(point.value, "pedido", "pedidos")}
                />
              ) : (
                <LoadingRow label="Carregando os números..." />
              )}
            </div>
          </SectionCard>

          <SectionCard id="titulo-por-recompensa" title="Por recompensa">
            {read ? (
              <DataTable
                caption="Números por recompensa no período"
                columns={columns}
                rows={rewardTable(read.days)}
                rowKey={(row) => row.rewardId}
                grid={GRID}
                empty="Nenhum pedido no período."
              />
            ) : (
              <LoadingRow label="Carregando os números..." />
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
