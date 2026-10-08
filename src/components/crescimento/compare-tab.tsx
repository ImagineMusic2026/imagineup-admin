"use client";

import { useCallback, useId, useMemo, useState } from "react";

import { StatsToolbar } from "@/components/crescimento/growth-bits";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { CompareBars, type CompareGroup, type CompareSeries } from "@/components/ui/bar-chart";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, TextInput } from "@/components/ui/field";
import { FilterChips, FilterSelect } from "@/components/ui/filter-bar";
import { DeltaBadge } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/notice";
import { DEFAULT_PERIOD, PeriodPicker, type PeriodDays } from "@/components/ui/period-picker";
import { useLoad } from "@/components/ui/use-load";
import { artistNameOf, getArtistNames } from "@/lib/artist-names-data";
import {
  ARTIST_METRICS,
  COMPARE_MAX,
  COMPARE_MIN,
  PERIOD_METRICS,
  alignedSeries,
  artistSummary,
  artistsInDays,
  campaignGroupValue,
  campaignKeys,
  campaignValue,
  groupValue,
  groupingFor,
  groupsOf,
  periodTotal,
  topArtistsByJoined,
  type ArtistMetric,
  type ArtistSummary,
  type CampaignMetric,
  type CampaignMode,
  type Group,
  type PeriodMetric,
} from "@/lib/compare";
import { daysBetween, previousRange, rangeEndingYesterday, rangeStartingAt, shiftDay, type DayRange } from "@/lib/day";
import { formatDay, formatDayRange, formatDecimal, formatDelta, formatNumber, formatSigned } from "@/lib/format";
import { originKindLabel, utmLabel, type StatsDay } from "@/lib/stats";
import { getStatsDays } from "@/lib/stats-data";
import { useStaffMember } from "@/lib/staff-context";

type Mode = "artists" | "campaigns" | "periods";

const MODES: { value: Mode; label: string }[] = [
  { value: "artists", label: "Artistas" },
  { value: "campaigns", label: "Campanhas" },
  { value: "periods", label: "Períodos" },
];

/**
 * Comparativo (UP-39): centrais, campanhas ou períodos lado a lado, com um
 * período próprio (7, 30 ou 90 dias terminando ontem). Uma consulta do
 * período (duas nos Períodos), mais os nomes das centrais.
 */
export function CompareTab({ now }: { now: number }) {
  const [mode, setMode] = useState<Mode>("artists");
  const [period, setPeriod] = useState<PeriodDays>(DEFAULT_PERIOD);
  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterChips label="O que comparar" options={MODES} value={mode} onChange={(value) => setMode(value as Mode)} />
        <PeriodPicker value={period} onChange={setPeriod} now={now} label="Período do Comparativo" />
      </div>
      {mode === "artists" ? (
        <ArtistsCompare period={period} now={now} />
      ) : mode === "campaigns" ? (
        <CampaignsCompare period={period} now={now} />
      ) : (
        <PeriodsCompare period={period} now={now} />
      )}
    </>
  );
}

function groupLabels(groups: Group[], range: DayRange, now: Date): CompareGroup[] {
  const grouping = groupingFor(range);
  return groups.map((group) => ({
    key: group.key,
    label: formatDay(group.days[0], now),
    longLabel: grouping === "day" ? formatDay(group.days[0], now) : `semana de ${formatDayRange(group.days[0], group.days[group.days.length - 1], now).replace(/^de /, "")}`,
  }));
}

/** Escolha de 2 a 3 itens por caixas de marcar: com 3 marcados, as outras ficam desligadas. */
function ChoiceList({
  legend,
  options,
  chosen,
  onChange,
}: {
  legend: string;
  options: { value: string; label: string }[];
  chosen: string[];
  onChange: (chosen: string[]) => void;
}) {
  const hintId = useId();
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby={hintId}>
      <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/85">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => {
          const checked = chosen.includes(option.value);
          return (
            <Checkbox
              key={option.value}
              label={option.label}
              checked={checked}
              disabled={!checked && chosen.length >= COMPARE_MAX}
              onChange={(event) =>
                onChange(event.target.checked ? [...chosen, option.value] : chosen.filter((value) => value !== option.value))
              }
            />
          );
        })}
      </div>
      <p id={hintId} className="mt-2 mb-0 text-[12.5px] text-fg/55">
        Escolha de {COMPARE_MIN} a {COMPARE_MAX}. {chosen.length} {chosen.length === 1 ? "escolhido" : "escolhidos"}.
      </p>
    </fieldset>
  );
}

/** Tabela de comparação: uma linha por número, uma coluna por item. */
function CompareTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: { key: string; label: string; points?: boolean; cells: React.ReactNode[] }[];
}) {
  return (
    <div className="overflow-x-auto px-5 pt-3 pb-5">
      <table className="w-full min-w-[520px] border-collapse text-[13px] tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="py-2 pr-3 text-left group-label font-bold text-fg/50">
              Número
            </th>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 text-right text-[13px] font-semibold text-fg">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal text-fg/75">
                {row.label}
              </th>
              {row.cells.map((cell, index) => (
                <td key={index} className={cx("px-3 py-2.5 text-right font-semibold", row.points ? "text-lime" : "text-fg")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function metricValue(value: number | null, points: boolean): string {
  if (value === null) return "sem retrato";
  return points ? `${formatNumber(value)} pts` : formatNumber(value);
}

// ---------------------------------------------------------------------------
// Artistas
// ---------------------------------------------------------------------------

function ArtistsCompare({ period, now }: { period: PeriodDays; now: number }) {
  const member = useStaffMember();
  const load = useCallback(async () => {
    const range = rangeEndingYesterday(period, now);
    const [read, names] = await Promise.all([getStatsDays(range, now), getArtistNames(member)]);
    return { range, read, names };
  }, [period, now, member]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [metric, setMetric] = useState<ArtistMetric>("joined");
  const nowDate = new Date(now);

  if (state.status === "error") {
    return (
      <SectionCard id="titulo-comparativo" title="Artistas lado a lado">
        <LoadError message={state.message} headingId="titulo-comparativo" onRetry={reload} />
      </SectionCard>
    );
  }
  const data = state.status === "ready" ? state.data : null;
  const toolbar = (
    <StatsToolbar
      now={now}
      read={data?.read ?? null}
      reload={reload}
      reloading={reloading}
      loadedAt={loadedAt}
      refreshError={refreshError}
    />
  );
  if (!data) {
    return (
      <>
        {toolbar}
        <SectionCard id="titulo-comparativo" title="Artistas lado a lado">
          <LoadingRow label="Carregando as centrais..." />
        </SectionCard>
      </>
    );
  }

  const { range, read, names } = data;
  const candidates = [...names.keys(), ...artistsInDays(read.days).filter((id) => !names.has(id))];
  const selected = (chosen ?? topArtistsByJoined(read.days, range, candidates)).filter((id) => candidates.includes(id));
  const summaries = selected.map((id) => artistSummary(read.days, range, id));
  const columns = selected.map((id) => artistNameOf(names, id));
  const info = ARTIST_METRICS.find((item) => item.key === metric) ?? ARTIST_METRICS[0];
  const groups = groupsOf(range, groupingFor(range));
  const byDay = new Map(read.days.map((day) => [day.day, day]));
  const series: CompareSeries[] = selected.map((id, index) => ({
    key: id,
    label: columns[index],
    values: groups.map((group) => groupValue(byDay, group, id, metric)),
  }));
  const noSnapshot = summaries.some((summary) => summary.membersChange === null);

  function row(key: keyof ArtistSummary, label: string, points = false) {
    return {
      key,
      label,
      points,
      cells: summaries.map((summary) => metricValue(summary[key] as number | null, points)),
    };
  }

  return (
    <>
      {toolbar}
      <SectionCard id="titulo-comparativo" title="Artistas lado a lado" meta={formatDayRange(range.from, range.to, nowDate)}>
        <div className="flex flex-col gap-4 px-5 pt-4">
          {candidates.length < COMPARE_MIN ? (
            <Notice tone="info">É preciso ter pelo menos duas centrais para comparar.</Notice>
          ) : (
            <ChoiceList
              legend="Centrais"
              options={candidates.map((id) => ({ value: id, label: artistNameOf(names, id) }))}
              chosen={selected}
              onChange={setChosen}
            />
          )}
        </div>
        {selected.length < COMPARE_MIN ? (
          <EmptyState>Escolha pelo menos duas centrais.</EmptyState>
        ) : (
          <>
            <CompareTable
              caption={`Centrais lado a lado, ${formatDayRange(range.from, range.to, nowDate)}`}
              columns={columns}
              rows={[
                {
                  key: "members",
                  label: "Membros no fim do período",
                  cells: summaries.map((summary) => (
                    <span key={summary.artistId} className="inline-flex flex-col items-end">
                      {metricValue(summary.members, false)}
                      <span className="text-[12px] font-normal text-fg/60">
                        {summary.membersChange !== null
                          ? `${formatSigned(summary.membersChange)} no período`
                          : `${formatSigned(summary.joinedMinusLeft)} em entradas menos saídas`}
                      </span>
                    </span>
                  )),
                },
                row("joined", "Entradas"),
                row("left", "Saídas"),
                row("earned", "Pontos ganhos na central", true),
                row("likes", "Curtidas"),
                row("comments", "Comentários"),
                row("rsvps", "Presenças"),
                row("missions", "Missões concluídas"),
                row("reports", "Denúncias"),
                row("totalPoints", "PTS DA CENTRAL", true),
              ]}
            />
            {noSnapshot ? (
              <p className="m-0 px-5 pb-4 text-[12.5px] text-fg/60">
                Sem dois retratos da noite no período, a variação mostra entradas menos saídas, que não é o número de membros: a
                exclusão de conta não desconta.
              </p>
            ) : null}
          </>
        )}
      </SectionCard>

      {selected.length >= COMPARE_MIN ? (
        <SectionCard id="titulo-grafico-centrais" title="Por período" meta={groupingFor(range) === "day" ? "Por dia." : "Por semana."}>
          <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
            <FilterSelect
              label="Número do gráfico"
              value={metric}
              onChange={(value) => setMetric(value as ArtistMetric)}
              options={ARTIST_METRICS.map((item) => ({ value: item.key, label: item.label }))}
              className="max-w-xs"
            />
            <CompareBars
              title={`${info.label} por central`}
              groups={groupLabels(groups, range, nowDate)}
              series={series}
              tone={info.points ? "points" : "default"}
              formatValue={(value) => metricValue(value, info.points)}
            />
            {info.stock ? <p className="m-0 text-[12.5px] text-fg/60">Estoque pelo retrato da noite: o último de cada {groupingFor(range) === "day" ? "dia" : "semana"}.</p> : null}
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Campanhas e tipos de link
// ---------------------------------------------------------------------------

const CAMPAIGN_METRICS: { value: CampaignMetric; label: string }[] = [
  { value: "signups", label: "Cadastros" },
  { value: "visits", label: "Visitas" },
  { value: "links", label: "Links" },
];

function CampaignsCompare({ period, now }: { period: PeriodDays; now: number }) {
  const load = useCallback(async () => {
    const range = rangeEndingYesterday(period, now);
    return { range, read: await getStatsDays(range, now) };
  }, [period, now]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);
  const [mode, setMode] = useState<CampaignMode>("campaign");
  const [chosen, setChosen] = useState<Record<CampaignMode, string[] | null>>({ campaign: null, kind: null });
  const [metric, setMetric] = useState<CampaignMetric>("signups");
  const nowDate = new Date(now);

  if (state.status === "error") {
    return (
      <SectionCard id="titulo-campanhas-lado" title="Campanhas lado a lado">
        <LoadError message={state.message} headingId="titulo-campanhas-lado" onRetry={reload} />
      </SectionCard>
    );
  }
  const data = state.status === "ready" ? state.data : null;
  const toolbar = (
    <StatsToolbar now={now} read={data?.read ?? null} reload={reload} reloading={reloading} loadedAt={loadedAt} refreshError={refreshError} />
  );
  if (!data) {
    return (
      <>
        {toolbar}
        <SectionCard id="titulo-campanhas-lado" title="Campanhas lado a lado">
          <LoadingRow label="Carregando as campanhas..." />
        </SectionCard>
      </>
    );
  }

  const { range, read } = data;
  const keys = campaignKeys(read.days, range, mode);
  const selected = (chosen[mode] ?? keys.slice(0, COMPARE_MAX)).filter((key) => keys.includes(key));
  const label = (key: string) => (mode === "campaign" ? utmLabel(key) : originKindLabel(key));
  const shownMetric: CampaignMetric = mode === "campaign" ? "signups" : metric;
  const groups = groupsOf(range, groupingFor(range));
  const byDay = new Map(read.days.map((day) => [day.day, day]));
  const total = (key: string, which: CampaignMetric) =>
    read.days.reduce((sum, day) => (day.day >= range.from && day.day <= range.to ? sum + campaignValue(day, mode, key, which) : sum), 0);
  const metricLabel = CAMPAIGN_METRICS.find((item) => item.value === shownMetric)?.label ?? "Cadastros";

  return (
    <>
      {toolbar}
      <SectionCard id="titulo-campanhas-lado" title="Campanhas lado a lado" meta={formatDayRange(range.from, range.to, nowDate)}>
        <div className="flex flex-col gap-4 px-5 pt-4">
          <FilterChips
            label="Comparar por"
            options={[
              { value: "campaign", label: "Campanhas" },
              { value: "kind", label: "Tipos de link" },
            ]}
            value={mode}
            onChange={(value) => setMode(value as CampaignMode)}
          />
          <p className="m-0 text-[12.5px] text-fg/60">
            {mode === "campaign"
              ? "A campanha é o utm_campaign do link e só é contada nos cadastros por convite: visitas e engajamento por campanha não existem."
              : "O tipo de link conta cadastros, visitas e links criados. Engajamento por tipo de link não existe."}
          </p>
          {keys.length < COMPARE_MIN ? (
            <Notice tone="info">{mode === "campaign" ? "Menos de duas campanhas com cadastro neste período." : "Menos de dois tipos de link usados neste período."}</Notice>
          ) : (
            <ChoiceList legend={mode === "campaign" ? "Campanhas" : "Tipos de link"} options={keys.map((key) => ({ value: key, label: label(key) }))} chosen={selected} onChange={(next) => setChosen((current) => ({ ...current, [mode]: next }))} />
          )}
        </div>
        {selected.length < COMPARE_MIN ? (
          <EmptyState>Escolha pelo menos duas.</EmptyState>
        ) : (
          <CompareTable
            caption={`${mode === "campaign" ? "Campanhas" : "Tipos de link"} lado a lado`}
            columns={selected.map(label)}
            rows={(mode === "campaign" ? CAMPAIGN_METRICS.slice(0, 1) : CAMPAIGN_METRICS).map((item) => ({
              key: item.value,
              label: item.label,
              cells: selected.map((key) => formatNumber(total(key, item.value))),
            }))}
          />
        )}
      </SectionCard>

      {selected.length >= COMPARE_MIN ? (
        <SectionCard id="titulo-grafico-campanhas" title="Por período" meta={groupingFor(range) === "day" ? "Por dia." : "Por semana."}>
          <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
            {mode === "kind" ? (
              <FilterSelect
                label="Número do gráfico"
                value={metric}
                onChange={(value) => setMetric(value as CampaignMetric)}
                options={CAMPAIGN_METRICS}
                className="max-w-xs"
              />
            ) : null}
            <CompareBars
              title={`${metricLabel} por ${mode === "campaign" ? "campanha" : "tipo de link"}`}
              groups={groupLabels(groups, range, nowDate)}
              series={selected.map((key) => ({
                key,
                label: label(key),
                values: groups.map((group) => campaignGroupValue(byDay, group, mode, key, shownMetric)),
              }))}
              formatValue={(value) => `${formatNumber(value ?? 0)} ${metricLabel.toLowerCase()}`}
            />
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

function periodLabel(metric: PeriodMetric, value: number): string {
  if (metric === "actives") return formatDecimal(value);
  if (metric === "earned") return `${formatNumber(value)} pts`;
  return formatNumber(value);
}

function PeriodsCompare({ period, now }: { period: PeriodDays; now: number }) {
  const [against, setAgainst] = useState<"previous" | "custom">("previous");
  const [customStart, setCustomStart] = useState<string>("");
  const [metric, setMetric] = useState<PeriodMetric>("signups");
  const nowDate = new Date(now);
  const rangeA = useMemo(() => rangeEndingYesterday(period, now), [period, now]);
  const length = daysBetween(rangeA.from, rangeA.to);
  const latestStart = shiftDay(rangeA.to, -(length - 1));
  const startValid = /^\d{4}-\d{2}-\d{2}$/.test(customStart) && customStart <= latestStart;
  const rangeB = useMemo(
    () => (against === "custom" && startValid ? rangeStartingAt(customStart, length) : previousRange(rangeA)),
    [against, startValid, customStart, length, rangeA],
  );

  const load = useCallback(async () => {
    const [readA, readB] = await Promise.all([getStatsDays(rangeA, now), getStatsDays(rangeB, now)]);
    return { readA, readB, days: [...readA.days, ...readB.days] as StatsDay[] };
  }, [rangeA, rangeB, now]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);
  const radioName = useId();

  const data = state.status === "ready" ? state.data : null;
  const info = PERIOD_METRICS.find((item) => item.key === metric) ?? PERIOD_METRICS[0];
  const labelA = `Este período (${formatDayRange(rangeA.from, rangeA.to, nowDate)})`;
  const labelB = `Comparado (${formatDayRange(rangeB.from, rangeB.to, nowDate)})`;

  return (
    <>
      <StatsToolbar now={now} read={data?.readA ?? null} reload={reload} reloading={reloading} loadedAt={loadedAt} refreshError={refreshError} />
      <SectionCard id="titulo-periodos" title="Períodos lado a lado">
        <div className="flex flex-col gap-4 px-5 pt-4">
          <fieldset className="m-0 flex min-w-0 flex-wrap items-end gap-x-5 gap-y-3 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/85">Comparar com</legend>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg/85">
              <input type="radio" name={radioName} checked={against === "previous"} onChange={() => setAgainst("previous")} className="size-4 accent-pink-strong" />
              Os {length} dias anteriores
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg/85">
              <input type="radio" name={radioName} checked={against === "custom"} onChange={() => setAgainst("custom")} className="size-4 accent-pink-strong" />
              Outro período, do mesmo tamanho
            </label>
            {against === "custom" ? (
              <Field
                label="Começando em"
                error={customStart && !startValid ? "Escolha um dia que deixe o período inteiro antes de hoje." : null}
                className="w-48"
              >
                {({ id, describedBy, invalid }) => (
                  <TextInput
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    type="date"
                    value={customStart}
                    max={latestStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    className="h-10"
                  />
                )}
              </Field>
            ) : null}
          </fieldset>
        </div>
        {state.status === "error" ? (
          <LoadError message={state.message} headingId="titulo-periodos" onRetry={reload} />
        ) : !data ? (
          <LoadingRow label="Carregando os dois períodos..." />
        ) : (
          <CompareTable
            caption="Dois períodos lado a lado, com a variação"
            columns={[labelA, labelB, "Variação"]}
            rows={PERIOD_METRICS.map((item) => {
              const a = periodTotal(data.days, rangeA, item.key);
              const b = periodTotal(data.days, rangeB, item.key);
              return {
                key: item.key,
                label: item.label,
                points: item.points,
                cells: [periodLabel(item.key, a), periodLabel(item.key, b), <DeltaBadge key="delta" delta={formatDelta(a, b, "o período comparado")} />],
              };
            })}
          />
        )}
      </SectionCard>

      {data ? (
        <SectionCard id="titulo-grafico-periodos" title="Dia a dia" meta="Alinhados pelo dia do período: o 1º com o 1º, o 2º com o 2º.">
          <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
            <FilterSelect
              label="Número do gráfico"
              value={metric}
              onChange={(value) => setMetric(value as PeriodMetric)}
              options={PERIOD_METRICS.map((item) => ({ value: item.key, label: item.label }))}
              className="max-w-xs"
            />
            {(() => {
              const aligned = alignedSeries(data.days, rangeA, rangeB, metric);
              return (
                <CompareBars
                  title={`${info.label}, dia a dia nos dois períodos`}
                  tone={info.points ? "points" : "default"}
                  groups={aligned.map((point) => ({
                    key: String(point.index),
                    label: `dia ${point.index + 1}`,
                    longLabel: `Dia ${point.index + 1} (${formatDay(point.dayA, nowDate)} e ${formatDay(point.dayB, nowDate)})`,
                  }))}
                  series={[
                    { key: "a", label: "Este período", values: aligned.map((point) => point.a) },
                    { key: "b", label: "Comparado", values: aligned.map((point) => point.b) },
                  ]}
                  formatValue={(value) => periodLabel(metric, value ?? 0)}
                />
              );
            })()}
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}
