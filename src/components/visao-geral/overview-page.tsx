"use client";

import { useCallback, useState } from "react";

import { DataFreshness, useTodayStats, type TodayState } from "@/components/painel/data-freshness";
import { PageHeader } from "@/components/painel/page-header";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { BarChart, type BarPoint } from "@/components/ui/bar-chart";
import { cx } from "@/components/ui/cx";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { DeltaBadge, MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/notice";
import { DEFAULT_PERIOD, PeriodPicker, type PeriodDays } from "@/components/ui/period-picker";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { rangeEndingYesterday, type DayRange } from "@/lib/day";
import { countLabel, formatDayRange, formatDelta, formatNumber, formatPoints, formatSigned, formatTime, formatDay, formatWeekdayDay, type Delta } from "@/lib/format";
import { createGameNamesReader } from "@/lib/game-names-data";
import { engagementOf, overviewNumbers, overviewSpan, previousLabel, type Comparison, type OverviewNumbers } from "@/lib/overview";
import { lastClosedAt, seriesByDay, sourceLabel, type StatsDay } from "@/lib/stats";
import { getStatsDays, type StatsRead } from "@/lib/stats-data";

interface OverviewData {
  range: DayRange;
  read: StatsRead;
  numbers: OverviewNumbers;
  missionTitles: Map<string, string>;
  achievementNames: Map<string, string>;
}

/** Os dias do período, o anterior e o começo do mês, mais os nomes das missões e conquistas que aparecem. */
async function loadOverview(days: PeriodDays, now: number): Promise<OverviewData> {
  const range = rangeEndingYesterday(days, now);
  const read = await getStatsDays(overviewSpan(range), now);
  const numbers = overviewNumbers(read.days, range);
  const names = createGameNamesReader();
  const [missionTitles, achievementNames] = await Promise.all([
    numbers.topMissions.length > 0 ? names.missionTitles(numbers.topMissions.map((item) => item.id)) : new Map<string, string>(),
    numbers.achievements.length > 0 ? names.achievementNames() : new Map<string, string>(),
  ]);
  return { range, read, numbers, missionTitles, achievementNames };
}

function deltaOf(comparison: Comparison, days: number): Delta {
  return formatDelta(comparison.value, comparison.previous, previousLabel(days));
}

/** Visão geral (`/`): números fechados até ontem, sem ação de mudança (todos os níveis veem o mesmo). */
export function OverviewPage() {
  const [now] = useState(() => Date.now());
  const [period, setPeriod] = useState<PeriodDays>(DEFAULT_PERIOD);
  const load = useCallback(() => loadOverview(period, now), [period, now]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);
  const today = useTodayStats();

  const data = state.status === "ready" ? state.data : null;
  const nowDate = new Date(now);

  return (
    <>
      <PageHeader
        title="Visão geral"
        subtitle="Números fechados até ontem."
        actions={<RefreshButton onClick={reload} busy={reloading} loadedAt={loadedAt} />}
      />

      <div className="flex flex-col gap-3">
        <PeriodPicker value={period} onChange={setPeriod} now={now} />
        {data ? (
          <DataFreshness
            state={data.read.state}
            closedAt={lastClosedAt(data.read.days)}
            now={nowDate}
            today={today.state}
            onLoadToday={today.load}
          />
        ) : null}
      </div>

      {refreshError ? <Notice tone="error">Não deu para atualizar: {refreshError}</Notice> : null}

      {state.status === "error" ? (
        <SectionCard id="titulo-visao-geral" title="Números do período">
          <LoadError message={state.message} headingId="titulo-visao-geral" onRetry={reload} />
        </SectionCard>
      ) : data && data.read.state.kind === "not-started" ? (
        <Notice tone="info">Os números ainda não começaram: o fechamento espera a carga dos cadastros.</Notice>
      ) : (
        <OverviewContent data={data} period={period} now={nowDate} today={today} />
      )}
    </>
  );
}

function OverviewContent({
  data,
  period,
  now,
  today,
}: {
  data: OverviewData | null;
  period: PeriodDays;
  now: Date;
  today: { state: TodayState; day: StatsDay | null };
}) {
  const numbers = data?.numbers ?? null;
  const loading = !numbers;
  const todayDay = today.state.status === "ready" ? today.day : null;
  const todayAt = today.state.status === "ready" ? formatTime(today.state.loadedAt) : "";
  const todayHint = (value: string) => (todayDay ? <span className="block">Hoje até {todayAt}: {value} (parcial)</span> : null);

  return (
    <>
      {data && numbers && numbers.daysWithData === 0 ? (
        <Notice tone="info">Ainda não há dias fechados neste período. O fechamento roda à 00:20.</Notice>
      ) : null}

      <MetricGrid>
        <MetricCard
          label="Fãs"
          loading={loading}
          value={numbers?.fans ? formatNumber(numbers.fans.value) : "Sem retrato"}
          hint={
            numbers?.fans ? (
              <>
                {numbers.fans.change !== null ? `${formatSigned(numbers.fans.change)} no período. ` : ""}
                Retrato da noite de {formatDay(numbers.fans.day, now)}.
              </>
            ) : (
              "Sai no próximo fechamento."
            )
          }
        />
        <MetricCard
          label="Cadastros"
          loading={loading}
          value={numbers ? formatNumber(numbers.signups.value) : ""}
          delta={numbers ? deltaOf(numbers.signups, period) : null}
          hint={
            numbers ? (
              <>
                {formatNumber(numbers.signups.invited)} por convite.
                {todayHint(formatNumber(todayDay?.signups.total ?? 0))}
              </>
            ) : null
          }
        />
        <MetricCard
          label="Pontos distribuídos"
          tone="points"
          loading={loading}
          value={numbers ? formatNumber(numbers.earned.value) : ""}
          unit="pts"
          delta={numbers ? deltaOf(numbers.earned, period) : null}
          hint={
            numbers ? (
              <>
                Ajustes da equipe no saldo: {formatSigned(numbers.adjustments.points)} em{" "}
                {countLabel(numbers.adjustments.events, "ajuste", "ajustes")}.
                {todayHint(formatPoints(todayDay?.totals.earned ?? 0))}
              </>
            ) : null
          }
        />
        <MetricCard
          label="Ativos por dia"
          loading={loading}
          value={numbers ? formatNumber(numbers.activesAverage.value) : ""}
          unit="média"
          delta={numbers ? deltaOf(numbers.activesAverage, period) : null}
          hint={
            numbers ? (
              <>
                Nesta semana: {formatNumber(numbers.activesWeek)}. Neste mês: {formatNumber(numbers.activesMonth)}.
                {todayHint(formatNumber(todayDay?.actives.day ?? 0))}
              </>
            ) : null
          }
        />
      </MetricGrid>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <DailyChart data={data} now={now} todayDay={todayDay} />
          <SourcesCard numbers={numbers} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <EngagementCard numbers={numbers} period={period} />
          <StoreCard numbers={numbers} />
          <MissionsCard data={data} />
          <AchievementsCard data={data} />
        </div>
      </div>
    </>
  );
}

type ChartKey = "signups" | "actives" | "points" | "engagement";

function DailyChart({ data, now, todayDay }: { data: OverviewData | null; now: Date; todayDay: StatsDay | null }) {
  const [tab, setTab] = useState<ChartKey>("signups");
  const meta = data ? formatDayRange(data.range.from, data.range.to, now) : undefined;
  if (!data) {
    return (
      <SectionCard id="titulo-por-dia" title="Por dia">
        <LoadingRow label="Carregando os números..." />
      </SectionCard>
    );
  }

  const days = todayDay ? [...data.read.days, todayDay] : data.read.days;
  const range = todayDay ? { from: data.range.from, to: todayDay.day } : data.range;
  const byDay = new Map(days.map((day) => [day.day, day]));

  function series(pick: (day: StatsDay) => number): BarPoint[] {
    return seriesByDay(range, days, pick).map((point) => ({
      key: point.day,
      label: formatDay(point.day, now),
      longLabel: formatWeekdayDay(point.day, now),
      value: point.value,
      partial: point.partial,
      missing: point.missing,
    }));
  }

  function chart(key: ChartKey) {
    switch (key) {
      case "signups":
        return (
          <BarChart
            title="Cadastros por dia"
            series={series((day) => day.signups.total)}
            describe={(point) => countLabel(point.value, "cadastro", "cadastros")}
          />
        );
      case "actives":
        return (
          <BarChart
            title="Ativos por dia"
            series={series((day) => day.actives.day)}
            describe={(point) => countLabel(point.value, "fã ativo", "fãs ativos")}
          />
        );
      case "points":
        return (
          <BarChart
            title="Pontos distribuídos por dia"
            tone="points"
            series={series((day) => day.totals.earned)}
            describe={(point) => formatPoints(point.value)}
          />
        );
      case "engagement":
        return (
          <BarChart
            title="Engajamento por dia"
            series={series(engagementOf)}
            describe={(point) => {
              const day = byDay.get(point.key);
              if (!day) return countLabel(point.value, "interação", "interações");
              return `${countLabel(day.totals.likes, "curtida", "curtidas")}, ${countLabel(day.totals.comments, "comentário", "comentários")}, ${countLabel(day.totals.rsvps, "presença", "presenças")}`;
            }}
          />
        );
    }
  }

  return (
    <SectionCard id="titulo-por-dia" title="Por dia" meta={meta}>
      <div className="px-5 pt-1 pb-5">
        <Tabs
          label="Número do gráfico"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "signups", label: "Cadastros", render: () => chart("signups") },
            { id: "actives", label: "Ativos", render: () => chart("actives") },
            { id: "points", label: "Pontos", render: () => chart("points") },
            { id: "engagement", label: "Engajamento", render: () => chart("engagement") },
          ]}
        />
      </div>
    </SectionCard>
  );
}

const SOURCE_GRID = "xl:grid xl:grid-cols-[minmax(0,1fr)_140px_110px] xl:items-center xl:gap-4";

function SourcesCard({ numbers }: { numbers: OverviewNumbers | null }) {
  const columns: Column<OverviewNumbers["bySource"][number]>[] = [
    { key: "source", header: "Origem", cell: (row) => <span className="font-semibold text-fg">{sourceLabel(row.source)}</span> },
    {
      key: "points",
      header: "Pontos",
      align: "end",
      // Ganhos e saídas lado a lado: o resgate é débito e o ajuste pode ser negativo, então o número vai sem "+".
      cell: (row) => <span className="font-semibold text-lime tabular-nums">{formatNumber(row.points)}</span>,
    },
    { key: "events", header: "Eventos", align: "end", cell: (row) => <span className="tabular-nums">{formatNumber(row.events)}</span> },
  ];
  return (
    <SectionCard id="titulo-origens" title="Pontos por origem" meta="Pontos que entraram e saíram das carteiras no período.">
      {numbers ? (
        <DataTable
          caption="Pontos por origem"
          columns={columns}
          rows={numbers.bySource}
          rowKey={(row) => row.source}
          grid={SOURCE_GRID}
          empty="Nenhum ponto neste período."
        />
      ) : (
        <LoadingRow label="Carregando as origens..." />
      )}
    </SectionCard>
  );
}

/** Linha de número de um cartão lateral: o rótulo à esquerda, o valor à direita. */
function SideStat({ label, value, points = false, delta }: { label: string; value: string; points?: boolean; delta?: Delta }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line px-5 py-3 first:border-t-0">
      <dt className="text-[13px] text-fg/70">{label}</dt>
      <dd className="m-0 flex items-baseline gap-2">
        {delta ? <DeltaBadge delta={delta} /> : null}
        <span className={cx("font-display text-[15px] font-semibold tabular-nums", points ? "text-lime" : "text-fg")}>{value}</span>
      </dd>
    </div>
  );
}

function EngagementCard({ numbers, period }: { numbers: OverviewNumbers | null; period: PeriodDays }) {
  return (
    <SectionCard id="titulo-engajamento" title="Engajamento">
      {numbers ? (
        <dl className="m-0">
          <SideStat label="Curtidas" value={formatNumber(numbers.engagement.likes.value)} delta={deltaOf(numbers.engagement.likes, period)} />
          <SideStat
            label="Comentários"
            value={formatNumber(numbers.engagement.comments.value)}
            delta={deltaOf(numbers.engagement.comments, period)}
          />
          <SideStat label="Presenças" value={formatNumber(numbers.engagement.rsvps.value)} delta={deltaOf(numbers.engagement.rsvps, period)} />
          <SideStat label="Denúncias" value={formatNumber(numbers.engagement.reports.value)} delta={deltaOf(numbers.engagement.reports, period)} />
        </dl>
      ) : (
        <LoadingRow label="Carregando o engajamento..." />
      )}
    </SectionCard>
  );
}

function StoreCard({ numbers }: { numbers: OverviewNumbers | null }) {
  return (
    <SectionCard id="titulo-loja" title="Loja">
      {numbers ? (
        <dl className="m-0">
          <SideStat label="Pedidos" value={formatNumber(numbers.store.requested)} />
          <SideStat label="Pontos gastos" value={formatPoints(Math.abs(numbers.store.spent))} points />
          <SideStat label="Pontos devolvidos" value={formatPoints(numbers.store.refunded)} points />
          <SideStat label="Entregues" value={formatNumber(numbers.store.delivered)} />
        </dl>
      ) : (
        <LoadingRow label="Carregando a loja..." />
      )}
    </SectionCard>
  );
}

function RankedList({ items }: { items: { key: string; name: string; value: string }[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {items.map((item, index) => (
        <li key={item.key} className="flex items-baseline gap-3 border-t border-line px-5 py-3 first:border-t-0">
          <span aria-hidden="true" className="w-4 shrink-0 text-right text-[12.5px] text-fg/45 tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{item.name}</span>
          <span className="shrink-0 text-[13px] text-fg/75 tabular-nums">{item.value}</span>
        </li>
      ))}
    </ol>
  );
}

function MissionsCard({ data }: { data: OverviewData | null }) {
  return (
    <SectionCard id="titulo-missoes-concluidas" title="Missões mais concluídas">
      {!data ? (
        <LoadingRow label="Carregando as missões..." />
      ) : data.numbers.topMissions.length === 0 ? (
        <EmptyState>Nenhuma missão concluída neste período.</EmptyState>
      ) : (
        <RankedList
          items={data.numbers.topMissions.map((item) => ({
            key: item.id,
            name: data.missionTitles.get(item.id) ?? item.id,
            value: countLabel(item.completed, "conclusão", "conclusões"),
          }))}
        />
      )}
    </SectionCard>
  );
}

function AchievementsCard({ data }: { data: OverviewData | null }) {
  return (
    <SectionCard id="titulo-conquistas" title="Conquistas desbloqueadas">
      {!data ? (
        <LoadingRow label="Carregando as conquistas..." />
      ) : data.numbers.achievements.length === 0 ? (
        <EmptyState>Nenhuma conquista desbloqueada neste período.</EmptyState>
      ) : (
        <RankedList
          items={data.numbers.achievements.map((item) => ({
            key: item.id,
            name: data.achievementNames.get(item.id) ?? item.id,
            value: countLabel(item.unlocked, "fã", "fãs"),
          }))}
        />
      )}
    </SectionCard>
  );
}
