"use client";

import { useCallback } from "react";

import { ShareBar, ShareCell, StatsToolbar } from "@/components/crescimento/growth-bits";
import { useTodayStats } from "@/components/painel/data-freshness";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { BarChart } from "@/components/ui/bar-chart";
import { DataTable, type Column } from "@/components/ui/data-table";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/notice";
import type { PeriodDays } from "@/components/ui/period-picker";
import { useLoad } from "@/components/ui/use-load";
import { previousRange, rangeEndingYesterday, spanOf } from "@/lib/day";
import { countLabel, formatDay, formatDayRange, formatDelta, formatNumber, formatPercent, formatTime, formatWeekdayDay } from "@/lib/format";
import { signupNumbers, type KindRow, type ShareRow } from "@/lib/growth";
import { previousLabel } from "@/lib/overview";
import { originKindLabel, seriesByDay, utmLabel } from "@/lib/stats";
import { getStatsDays } from "@/lib/stats-data";

async function loadSignups(period: PeriodDays, now: number) {
  const range = rangeEndingYesterday(period, now);
  const read = await getStatsDays(spanOf(range, previousRange(range)), now);
  return { range, read, numbers: signupNumbers(read.days, range) };
}

const KIND_GRID = "xl:grid xl:grid-cols-[minmax(0,1fr)_100px_100px_100px] xl:items-center xl:gap-4";
const SHARE_GRID = "xl:grid xl:grid-cols-[minmax(0,1fr)_100px_150px] xl:items-center xl:gap-4";

/** Cadastros e origem: os cadastros do período, a parte por convite, os tipos de link, as campanhas e as origens. */
export function SignupsTab({ period, onPeriod, now }: { period: PeriodDays; onPeriod: (days: PeriodDays) => void; now: number }) {
  const load = useCallback(() => loadSignups(period, now), [period, now]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);
  const today = useTodayStats();
  const data = state.status === "ready" ? state.data : null;
  const numbers = data?.numbers ?? null;
  const nowDate = new Date(now);
  const comparison = previousLabel(period);
  const todayAt = today.state.status === "ready" ? formatTime(today.state.loadedAt) : "";

  if (state.status === "error") {
    return (
      <SectionCard id="titulo-cadastros" title="Cadastros e origem">
        <LoadError message={state.message} headingId="titulo-cadastros" onRetry={reload} />
      </SectionCard>
    );
  }

  const days = data ? (today.day ? [...data.read.days, today.day] : data.read.days) : [];
  const chartRange = data ? { from: data.range.from, to: today.day ? today.day.day : data.range.to } : null;
  const byDay = new Map(days.map((day) => [day.day, day]));

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

      {numbers && numbers.signups.value === 0 && numbers.visits.value === 0 && numbers.links.value === 0 ? (
        <Notice tone="info">Nenhum cadastro neste período.</Notice>
      ) : null}

      <MetricGrid>
        <MetricCard
          label="Cadastros"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.signups.value) : ""}
          delta={numbers ? formatDelta(numbers.signups.value, numbers.signups.previous, comparison) : null}
          hint={today.day ? `Hoje até ${todayAt}: ${formatNumber(today.day.signups.total)} (parcial).` : undefined}
        />
        <MetricCard
          label="Vindos de convite"
          tone="accent"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.invited.value) : ""}
          delta={numbers ? formatDelta(numbers.invited.value, numbers.invited.previous, comparison) : null}
          hint={
            <>
              {numbers?.invitedShare !== null && numbers?.invitedShare !== undefined ? `${formatPercent(numbers.invitedShare)} dos cadastros. ` : ""}
              Conta no dia em que o convite foi usado, até 7 dias depois do cadastro.
            </>
          }
        />
        <MetricCard
          label="Visitas pelos links"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.visits.value) : ""}
          delta={numbers ? formatDelta(numbers.visits.value, numbers.visits.previous, comparison) : null}
          hint="Quem abriu um link de convite com conta no app."
        />
        <MetricCard
          label="Links criados"
          loading={!numbers}
          value={numbers ? formatNumber(numbers.links.value) : ""}
          delta={numbers ? formatDelta(numbers.links.value, numbers.links.previous, comparison) : null}
        />
      </MetricGrid>

      <SectionCard
        id="titulo-cadastros-por-dia"
        title="Cadastros por dia"
        meta={data ? `${formatDayRange(data.range.from, data.range.to, nowDate)}. Em ciano, a parte que veio de convite.` : undefined}
      >
        {data && chartRange ? (
          <div className="px-5 pt-4 pb-5">
            <BarChart
              title="Cadastros por dia, com a parte por convite"
              series={seriesByDay(chartRange, days, (day) => day.signups.total).map((point) => ({
                key: point.day,
                label: formatDay(point.day, nowDate),
                longLabel: formatWeekdayDay(point.day, nowDate),
                value: point.value,
                part: byDay.get(point.day)?.signups.invited ?? 0,
                partial: point.partial,
                missing: point.missing,
              }))}
              describe={(point) =>
                `${countLabel(point.value, "cadastro", "cadastros")}, ${formatNumber(point.part ?? 0)} por convite`
              }
            />
          </div>
        ) : (
          <LoadingRow label="Carregando os cadastros..." />
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <KindsCard rows={numbers?.byKind ?? null} />
        <div className="flex min-w-0 flex-col gap-6">
          <ShareCard
            id="titulo-campanhas"
            title="Campanhas"
            meta="Pelo utm_campaign do link. Só os cadastros por convite."
            rows={numbers?.campaigns ?? null}
            empty="Nenhum cadastro por campanha neste período."
          />
          <ShareCard
            id="titulo-origens-links"
            title="Origens"
            meta="Pelo utm_source do link. Só os cadastros por convite."
            rows={numbers?.sources ?? null}
            empty="Nenhum cadastro com origem neste período."
          />
        </div>
      </div>
    </>
  );
}

function KindsCard({ rows }: { rows: KindRow[] | null }) {
  const total = rows?.reduce((sum, row) => sum + row.signups, 0) ?? 0;
  const columns: Column<KindRow>[] = [
    { key: "kind", header: "Tipo de link", cell: (row) => <span className="font-semibold text-fg">{originKindLabel(row.kind)}</span> },
    { key: "signups", header: "Cadastros", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.signups)}</span> },
    { key: "visits", header: "Visitas", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.visits)}</span> },
    { key: "links", header: "Links", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.links)}</span> },
  ];
  return (
    <SectionCard id="titulo-tipos-de-link" title="Por tipo de link">
      {rows ? (
        <>
          {total > 0 ? (
            <div className="px-5 pt-4">
              <ShareBar parts={rows.map((row) => ({ key: row.kind, share: row.signups / total }))} />
            </div>
          ) : null}
          <DataTable
            caption="Cadastros, visitas e links por tipo de link"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.kind}
            grid={KIND_GRID}
            empty="Nenhum link usado neste período."
          />
        </>
      ) : (
        <LoadingRow label="Carregando os tipos de link..." />
      )}
    </SectionCard>
  );
}

function ShareCard({ id, title, meta, rows, empty }: { id: string; title: string; meta: string; rows: ShareRow[] | null; empty: string }) {
  const campaigns = title === "Campanhas";
  const columns: Column<ShareRow>[] = [
    {
      key: "key",
      header: campaigns ? "Campanha" : "Origem",
      cell: (row) => <span className="font-semibold text-fg">{utmLabel(row.key, campaigns ? undefined : "Sem origem")}</span>,
    },
    { key: "signups", header: "Cadastros", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.signups)}</span> },
    { key: "share", header: "Parte", align: "end", cell: (row) => <ShareCell share={row.share} /> },
  ];
  return (
    <SectionCard id={id} title={title} meta={meta}>
      {rows ? (
        <DataTable caption={title} columns={columns} rows={rows} rowKey={(row) => row.key} grid={SHARE_GRID} empty={empty} />
      ) : (
        <LoadingRow label="Carregando..." />
      )}
    </SectionCard>
  );
}
