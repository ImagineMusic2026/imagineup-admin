"use client";

import { useCallback } from "react";

import { StatsToolbar } from "@/components/crescimento/growth-bits";
import { useTodayStats } from "@/components/painel/data-freshness";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { BarChart } from "@/components/ui/bar-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import type { PeriodDays } from "@/components/ui/period-picker";
import { useLoad } from "@/components/ui/use-load";
import { rangeEndingYesterday } from "@/lib/day";
import { countLabel, formatDay, formatDayRange, formatDelta, formatNumber, formatPercent, formatTime, formatWeekdayDay } from "@/lib/format";
import { activeNumbers, activesSpan, monthLabel, retentionPlan, weekLabel } from "@/lib/growth";
import { previousLabel } from "@/lib/overview";
import { retentionTable, seriesByDay, type RetentionRow } from "@/lib/stats";
import { getStatsDays } from "@/lib/stats-data";

/** O período com o anterior e o mês passado, e, numa consulta à parte, as 8 semanas da retenção. */
async function loadActives(period: PeriodDays, now: number) {
  const range = rangeEndingYesterday(period, now);
  const plan = retentionPlan(range.to);
  const [read, retentionRead] = await Promise.all([getStatsDays(activesSpan(range), now), getStatsDays(plan.range, now)]);
  return {
    range,
    read,
    numbers: activeNumbers(read.days, range),
    retention: retentionTable(retentionRead.days, plan.cohorts, range.to),
  };
}

/** Ativos e retenção: média por dia, únicos da semana e do mês no calendário, e a retenção por coorte semanal. */
export function ActivesTab({ period, onPeriod, now }: { period: PeriodDays; onPeriod: (days: PeriodDays) => void; now: number }) {
  const load = useCallback(() => loadActives(period, now), [period, now]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);
  const today = useTodayStats();
  const data = state.status === "ready" ? state.data : null;
  const numbers = data?.numbers ?? null;
  const nowDate = new Date(now);
  const short = (day: string) => formatDay(day, nowDate);

  if (state.status === "error") {
    return (
      <SectionCard id="titulo-ativos" title="Ativos e retenção">
        <LoadError message={state.message} headingId="titulo-ativos" onRetry={reload} />
      </SectionCard>
    );
  }

  const days = data ? (today.day ? [...data.read.days, today.day] : data.read.days) : [];
  const chartRange = data ? { from: data.range.from, to: today.day ? today.day.day : data.range.to } : null;

  return (
    <>
      <StatsToolbar
        period={period}
        onPeriod={onPeriod}
        now={now}
        read={data?.read ?? null}
        today={today.state}
        onLoadToday={today.load}
        reload={reload}
        reloading={reloading}
        loadedAt={loadedAt}
        refreshError={refreshError}
      />

      <MetricGrid columns={3}>
        <MetricCard
          label="Ativos por dia"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.averagePerDay.value) : ""}
          unit="média"
          delta={numbers ? formatDelta(numbers.averagePerDay.value, numbers.averagePerDay.previous, previousLabel(period)) : null}
          hint={
            today.day && today.state.status === "ready"
              ? `Hoje até ${formatTime(today.state.loadedAt)}: ${formatNumber(today.day.actives.day)} (parcial).`
              : "Fãs que agiram no app no dia (curtir, comentar, confirmar presença...)."
          }
        />
        <MetricCard
          label="Nesta semana"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.week.current) : ""}
          hint={numbers ? `Fãs únicos até ontem. Semana passada inteira: ${formatNumber(numbers.week.previous)}.` : undefined}
        />
        <MetricCard
          label="Neste mês"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.month.current) : ""}
          hint={numbers ? `Fãs únicos até ontem. Em ${monthLabel(numbers.month.previousKey)}: ${formatNumber(numbers.month.previous)}.` : undefined}
        />
      </MetricGrid>

      <SectionCard id="titulo-ativos-por-dia" title="Ativos por dia" meta={data ? formatDayRange(data.range.from, data.range.to, nowDate) : undefined}>
        {data && chartRange ? (
          <div className="px-5 pt-4 pb-5">
            <BarChart
              title="Ativos por dia"
              series={seriesByDay(chartRange, days, (day) => day.actives.day).map((point) => ({
                key: point.day,
                label: short(point.day),
                longLabel: formatWeekdayDay(point.day, nowDate),
                value: point.value,
                partial: point.partial,
                missing: point.missing,
              }))}
              describe={(point) => countLabel(point.value, "fã ativo", "fãs ativos")}
            />
          </div>
        ) : (
          <LoadingRow label="Carregando os ativos..." />
        )}
      </SectionCard>

      <SectionCard
        id="titulo-retencao"
        title="Retenção por semana de cadastro"
        meta="Dos fãs que se cadastraram em cada semana, quantos agiram nas semanas seguintes."
      >
        {data ? <RetentionTable rows={data.retention} short={short} /> : <LoadingRow label="Carregando a retenção..." />}
      </SectionCard>
    </>
  );
}

/** Fundo ciano mais forte quanto maior a retenção; o número está sempre escrito (nunca só a cor). */
function cellBackground(rate: number | null): string | undefined {
  if (rate === null) return undefined;
  return `rgb(61 220 255 / ${(0.06 + Math.min(1, rate) * 0.42).toFixed(3)})`;
}

function RetentionTable({ rows, short }: { rows: RetentionRow[]; short: (day: string) => string }) {
  const columns = Math.max(0, ...rows.map((row) => row.cells.length));
  if (rows.every((row) => row.signups === 0)) {
    return <EmptyState>Nenhum cadastro nas últimas 8 semanas.</EmptyState>;
  }
  return (
    <div className="overflow-x-auto px-5 pt-3 pb-5">
      <table className="w-full min-w-[720px] border-separate border-spacing-1 text-[12.5px] tabular-nums">
        <caption className="sr-only">
          Retenção por semana de cadastro: em cada linha, a semana do cadastro e os cadastros dela; nas colunas, a parte que agiu em cada semana depois.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left group-label font-bold text-fg/50">
              Cadastro
            </th>
            <th scope="col" className="px-2 py-1.5 text-right group-label font-bold text-fg/50">
              Fãs
            </th>
            {Array.from({ length: columns }, (_, offset) => (
              <th key={offset} scope="col" className="px-2 py-1.5 text-center group-label font-bold text-fg/50">
                {offset === 0 ? "Semana 0" : `+${offset}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.week}>
              <th scope="row" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap text-fg">
                {weekLabel(row.week, short)}
              </th>
              <td className="px-2 py-1.5 text-right text-fg/75">{formatNumber(row.signups)}</td>
              {Array.from({ length: columns }, (_, offset) => {
                const cell = row.cells[offset];
                if (!cell) return <td key={offset} />;
                return (
                  <td
                    key={offset}
                    className="rounded-md px-2 py-1.5 text-center text-fg"
                    style={{ background: cellBackground(cell.rate) }}
                    title={`${formatNumber(cell.active)} de ${formatNumber(row.signups)}`}
                  >
                    {cell.rate === null ? <span aria-label="sem cadastro">·</span> : formatPercent(cell.rate)}
                    {cell.partial ? <span className="text-fg/60"> *</span> : null}
                    <span className="sr-only">
                      , {formatNumber(cell.active)} fãs{cell.partial ? ", semana ainda em andamento" : ""}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 mb-0 text-[12px] text-fg/55">* Semana ainda em andamento, ou com dia não fechado.</p>
    </div>
  );
}
