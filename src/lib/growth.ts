import {
  isoWeekDays,
  monthKey,
  previousRange,
  shiftDay,
  shiftWeek,
  spanOf,
  weekKey,
  type DayRange,
} from "@/lib/day";
import type { Comparison } from "@/lib/overview";
import { activesOf, sumMaps, sumRange, type OriginCount, type StatsDay } from "@/lib/stats";

/**
 * As contas da Crescimento (26.16), puras: cadastros e origem (tipo de link,
 * campanha e origem dos links) e ativos e retenção. O Comparativo mora em
 * `compare.ts`.
 *
 * A parte dos cadastros que veio de convite (`signups.invited`) cai no dia do
 * convite, até 7 dias depois do cadastro (20.7): ela é lida no período, nunca
 * dia a dia, e pode passar do total num dia só.
 */

function inRange(days: readonly StatsDay[], range: DayRange): StatsDay[] {
  return days.filter((day) => day.day >= range.from && day.day <= range.to);
}

function compare(current: readonly StatsDay[], previous: readonly StatsDay[], pick: (day: StatsDay) => number): Comparison {
  return { value: sumRange(current, pick), previous: sumRange(previous, pick) };
}

export interface KindRow extends OriginCount {
  kind: string;
}

export interface ShareRow {
  key: string;
  signups: number;
  /** A parte do total dos cadastros por convite com recorte (0 a 1). */
  share: number;
}

export interface SignupNumbers {
  signups: Comparison;
  invited: Comparison;
  visits: Comparison;
  links: Comparison;
  /** `invited / signups` no período, ou `null` sem cadastro. */
  invitedShare: number | null;
  byKind: KindRow[];
  campaigns: ShareRow[];
  sources: ShareRow[];
}

function shareRows(totals: Record<string, number>): ShareRow[] {
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return Object.entries(totals)
    .filter(([, signups]) => signups > 0)
    .map(([key, signups]) => ({ key, signups, share: total > 0 ? signups / total : 0 }))
    .sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key));
}

export function signupNumbers(days: readonly StatsDay[], range: DayRange): SignupNumbers {
  const current = inRange(days, range);
  const previous = inRange(days, previousRange(range));
  const signups = compare(current, previous, (day) => day.signups.total);
  const invited = compare(current, previous, (day) => day.signups.invited);

  const kinds = new Map<string, OriginCount>();
  for (const day of current) {
    for (const [kind, count] of Object.entries(day.byOrigin.kind)) {
      const total = kinds.get(kind) ?? { signups: 0, visits: 0, links: 0 };
      total.signups += count.signups;
      total.visits += count.visits;
      total.links += count.links;
      kinds.set(kind, total);
    }
  }

  return {
    signups,
    invited,
    visits: compare(current, previous, (day) => day.invites.visits),
    links: compare(current, previous, (day) => day.invites.links),
    invitedShare: signups.value > 0 ? invited.value / signups.value : null,
    byKind: [...kinds]
      .map(([kind, count]) => ({ kind, ...count }))
      .filter((row) => row.signups + row.visits + row.links > 0)
      .sort((a, b) => b.signups - a.signups || b.visits - a.visits || a.kind.localeCompare(b.kind)),
    campaigns: shareRows(sumMaps(current, (day) => day.byOrigin.utmCampaign)),
    sources: shareRows(sumMaps(current, (day) => day.byOrigin.utmSource)),
  };
}

/** A faixa que a aba de ativos lê: o período, o anterior e o mês passado inteiro (o do mês de ontem menos um). */
export function activesSpan(range: DayRange): DayRange {
  const span = spanOf(range, previousRange(range));
  const previousMonthStart = `${monthKey(shiftDay(`${monthKey(range.to)}-01`, -1))}-01`;
  const previousWeekStart = isoWeekDays(shiftWeek(weekKey(range.to), -1))[0];
  const from = [span.from, previousMonthStart, previousWeekStart].sort()[0];
  return { from, to: span.to };
}

export interface ActiveNumbers {
  averagePerDay: Comparison;
  /** Únicos desta semana até ontem, e a semana passada inteira. */
  week: { current: number; currentKey: string; previous: number; previousKey: string };
  /** Únicos deste mês até ontem, e o mês passado inteiro. */
  month: { current: number; currentKey: string; previous: number; previousKey: string };
}

function averageOf(days: readonly StatsDay[]): number {
  return days.length === 0 ? 0 : sumRange(days, (day) => day.actives.day) / days.length;
}

export function activeNumbers(days: readonly StatsDay[], range: DayRange): ActiveNumbers {
  const yesterday = range.to;
  const currentWeek = weekKey(yesterday);
  const previousWeek = shiftWeek(currentWeek, -1);
  const currentMonth = monthKey(yesterday);
  const previousMonth = monthKey(shiftDay(`${currentMonth}-01`, -1));
  const upToYesterday = days.filter((day) => day.day <= yesterday);
  return {
    averagePerDay: { value: averageOf(inRange(days, range)), previous: averageOf(inRange(days, previousRange(range))) },
    week: {
      current: activesOf(upToYesterday, { week: currentWeek }),
      currentKey: currentWeek,
      previous: activesOf(days, { week: previousWeek }),
      previousKey: previousWeek,
    },
    month: {
      current: activesOf(upToYesterday, { month: currentMonth }),
      currentKey: currentMonth,
      previous: activesOf(days, { month: previousMonth }),
      previousKey: previousMonth,
    },
  };
}

export const RETENTION_WEEKS = 8;

/**
 * As semanas da retenção: as 8 semanas inteiras antes da de ontem (as linhas)
 * e a faixa que a tabela lê, da segunda-feira da primeira até ontem (até 63 dias).
 */
export function retentionPlan(yesterday: string): { cohorts: string[]; range: DayRange } {
  const current = weekKey(yesterday);
  const cohorts = Array.from({ length: RETENTION_WEEKS }, (_, index) => shiftWeek(current, index - RETENTION_WEEKS));
  return { cohorts, range: { from: isoWeekDays(cohorts[0])[0], to: yesterday } };
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/** "outubro de 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[number - 1]} de ${year}`;
}

/** "semana de 28 set" pela segunda-feira, com o formatador de dia de quem chama. */
export function weekLabel(week: string, formatDay: (day: string) => string): string {
  return `semana de ${formatDay(isoWeekDays(week)[0])}`;
}
