import { daysOf, previousRange, shiftDay, spanOf, type DayRange } from "@/lib/day";
import { activesToDate, lastSnapshot, periodStart, sumMaps, sumRange, type StatsDay } from "@/lib/stats";

/**
 * As contas da Visão geral (26.16), puras: os cartões do período contra o
 * período anterior de mesmo tamanho, o retrato de fãs, os ativos da semana e
 * do mês, as origens dos pontos e as missões e conquistas do período.
 *
 * "Pontos distribuídos" é o ganho pelas ações e missões (`totals.earned`); os
 * ajustes da equipe aparecem à parte, de `bySource.adjustment` (decisão 23).
 */

export interface Comparison {
  value: number;
  previous: number;
}

export interface OverviewNumbers {
  /** Fãs no retrato do último dia do período que tem um, e a variação contra o do dia antes do período. */
  fans: { value: number; day: string; change: number | null } | null;
  signups: Comparison & { invited: number };
  earned: Comparison;
  adjustments: { points: number; events: number };
  /** Média de `actives.day` nos dias do período que têm número. */
  activesAverage: Comparison;
  /** Únicos desta semana e deste mês até o fim do período (ontem). */
  activesWeek: number;
  activesMonth: number;
  engagement: { likes: Comparison; comments: Comparison; rsvps: Comparison; reports: Comparison };
  store: { requested: number; spent: number; refunded: number; delivered: number };
  bySource: { source: string; points: number; events: number }[];
  topMissions: { id: string; completed: number }[];
  achievements: { id: string; unlocked: number }[];
  /** Dias do período com número (fechados, e ontem somado quando é o caso). */
  daysWithData: number;
}

export const TOP_MISSIONS = 5;

/** A faixa que a Visão geral lê: o período, o anterior e o começo do mês e da semana de ontem. */
export function overviewSpan(range: DayRange): DayRange {
  const span = spanOf(range, previousRange(range));
  const monthStart = periodStart("month", range.to);
  const weekStart = periodStart("week", range.to);
  const from = [span.from, monthStart, weekStart].sort()[0];
  return { from, to: span.to };
}

function inRange(days: readonly StatsDay[], range: DayRange): StatsDay[] {
  return days.filter((day) => day.day >= range.from && day.day <= range.to);
}

function average(days: readonly StatsDay[]): number {
  return days.length === 0 ? 0 : sumRange(days, (day) => day.actives.day) / days.length;
}

function compare(current: readonly StatsDay[], previous: readonly StatsDay[], pick: (day: StatsDay) => number): Comparison {
  return { value: sumRange(current, pick), previous: sumRange(previous, pick) };
}

export function overviewNumbers(days: readonly StatsDay[], range: DayRange): OverviewNumbers {
  const previousDays = inRange(days, previousRange(range));
  const current = inRange(days, range);

  const snapshot = lastSnapshot(current);
  const before = days.find((day) => day.day === shiftDay(range.from, -1))?.snapshot ?? null;

  const bySourceTotals = new Map<string, { points: number; events: number }>();
  for (const day of current) {
    for (const [source, count] of Object.entries(day.bySource)) {
      const total = bySourceTotals.get(source) ?? { points: 0, events: 0 };
      total.points += count.points;
      total.events += count.events;
      bySourceTotals.set(source, total);
    }
  }
  const bySource = [...bySourceTotals]
    .map(([source, count]) => ({ source, ...count }))
    .filter((row) => row.points !== 0 || row.events !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points) || b.events - a.events || a.source.localeCompare(b.source));

  const missions = sumMaps(current, (day) => day.byMission);
  const achievements = sumMaps(current, (day) => day.byAchievement);
  const adjustment = bySourceTotals.get("adjustment") ?? { points: 0, events: 0 };

  return {
    fans: snapshot
      ? { value: snapshot.snapshot.fans, day: snapshot.day, change: before ? snapshot.snapshot.fans - before.fans : null }
      : null,
    signups: { ...compare(current, previousDays, (day) => day.signups.total), invited: sumRange(current, (day) => day.signups.invited) },
    earned: compare(current, previousDays, (day) => day.totals.earned),
    adjustments: adjustment,
    activesAverage: { value: average(current), previous: average(previousDays) },
    activesWeek: activesToDate(days, "week", range.to),
    activesMonth: activesToDate(days, "month", range.to),
    engagement: {
      likes: compare(current, previousDays, (day) => day.totals.likes),
      comments: compare(current, previousDays, (day) => day.totals.comments),
      rsvps: compare(current, previousDays, (day) => day.totals.rsvps),
      reports: compare(current, previousDays, (day) => day.totals.reports),
    },
    store: {
      requested: sumRange(current, (day) => day.totals.redeemRequested),
      spent: sumRange(current, (day) => day.bySource.redeem?.points ?? 0),
      refunded: sumRange(current, (day) => day.totals.refunded),
      delivered: sumRange(current, (day) => day.totals.redeemDelivered),
    },
    bySource,
    topMissions: Object.entries(missions)
      .filter(([, completed]) => completed > 0)
      .map(([id, completed]) => ({ id, completed }))
      .sort((a, b) => b.completed - a.completed || a.id.localeCompare(b.id))
      .slice(0, TOP_MISSIONS),
    achievements: Object.entries(achievements)
      .filter(([, unlocked]) => unlocked > 0)
      .map(([id, unlocked]) => ({ id, unlocked }))
      .sort((a, b) => b.unlocked - a.unlocked || a.id.localeCompare(b.id)),
    daysWithData: current.length,
  };
}

/** Quantos dias do período ainda não fecharam (sem documento), para o aviso. */
export function missingDays(range: DayRange, days: readonly StatsDay[]): string[] {
  const present = new Set(days.map((day) => day.day));
  return daysOf(range).filter((day) => !present.has(day));
}

/** Interações do dia no gráfico de engajamento: curtidas, comentários e presenças. */
export function engagementOf(day: StatsDay): number {
  return day.totals.likes + day.totals.comments + day.totals.rsvps;
}

/** "os 30 dias anteriores", para a frase da variação. */
export function previousLabel(days: number): string {
  return `os ${days} dias anteriores`;
}
