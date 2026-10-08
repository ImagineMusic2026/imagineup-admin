import { daysBetween, daysOf, weekKey, type DayRange } from "@/lib/day";
import type { StatsDay } from "@/lib/stats";

/**
 * O Comparativo da Crescimento (UP-39, 26.16), puro: centrais, campanhas e
 * períodos lado a lado, dos mesmos números do dia da Visão geral, com o
 * retrato da noite para o estoque (membros e "PTS DA CENTRAL").
 *
 * Fluxo (entradas, curtidas...) soma os dias do grupo; estoque (membros) vale
 * o último retrato do grupo, nunca uma soma. Sem retrato, o estoque fica sem
 * número, e a variação de membros cai para "entradas menos saídas", que não é
 * o número de membros (a exclusão de conta não desconta).
 */

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 3;

/** Agrupa por dia até 7 dias; acima disso, por semana ISO. */
export type Grouping = "day" | "week";

export function groupingFor(range: DayRange): Grouping {
  return daysBetween(range.from, range.to) <= 7 ? "day" : "week";
}

export interface Group {
  key: string;
  /** Os dias do grupo dentro da faixa. */
  days: string[];
}

export function groupsOf(range: DayRange, grouping: Grouping): Group[] {
  const groups: Group[] = [];
  for (const day of daysOf(range)) {
    const key = grouping === "day" ? day : weekKey(day);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(day);
    else groups.push({ key, days: [day] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Centrais
// ---------------------------------------------------------------------------

export type ArtistMetric =
  | "members"
  | "joined"
  | "left"
  | "earned"
  | "likes"
  | "comments"
  | "rsvps"
  | "missions"
  | "reports"
  | "totalPoints";

export interface MetricInfo<K extends string> {
  key: K;
  label: string;
  /** Estoque (retrato) ou fluxo (soma dos dias). */
  stock: boolean;
  /** Número de pontos (lima). */
  points: boolean;
}

export const ARTIST_METRICS: MetricInfo<ArtistMetric>[] = [
  { key: "members", label: "Membros", stock: true, points: false },
  { key: "joined", label: "Entradas", stock: false, points: false },
  { key: "left", label: "Saídas", stock: false, points: false },
  { key: "earned", label: "Pontos ganhos na central", stock: false, points: true },
  { key: "likes", label: "Curtidas", stock: false, points: false },
  { key: "comments", label: "Comentários", stock: false, points: false },
  { key: "rsvps", label: "Presenças", stock: false, points: false },
  { key: "missions", label: "Missões concluídas", stock: false, points: false },
  { key: "reports", label: "Denúncias", stock: false, points: false },
  { key: "totalPoints", label: "PTS DA CENTRAL", stock: true, points: true },
];

/** O número de um dia para uma central; `null` no estoque sem retrato. */
export function artistValue(day: StatsDay, artistId: string, metric: ArtistMetric): number | null {
  if (metric === "members" || metric === "totalPoints") {
    const entry = day.snapshot?.artists[artistId];
    if (!entry) return null;
    return metric === "members" ? entry.members : entry.totalPoints;
  }
  const artist = day.byArtist[artistId];
  if (!artist) return 0;
  if (metric === "missions") return artist.bySource.mission?.events ?? 0;
  return artist[metric];
}

/** O valor de um grupo: a soma no fluxo, o último retrato no estoque (`null` sem nenhum). */
export function groupValue(byDay: ReadonlyMap<string, StatsDay>, group: Group, artistId: string, metric: ArtistMetric): number | null {
  const info = ARTIST_METRICS.find((item) => item.key === metric);
  if (info?.stock) {
    for (let index = group.days.length - 1; index >= 0; index -= 1) {
      const day = byDay.get(group.days[index]);
      const value = day ? artistValue(day, artistId, metric) : null;
      if (value !== null) return value;
    }
    return null;
  }
  return group.days.reduce((total, key) => {
    const day = byDay.get(key);
    return total + (day ? (artistValue(day, artistId, metric) ?? 0) : 0);
  }, 0);
}

export interface ArtistSummary {
  artistId: string;
  /** Membros no último retrato do período, ou `null` sem retrato. */
  members: number | null;
  /** Último menos primeiro retrato; sem os dois, `null` (vale o `joinedMinusLeft`). */
  membersChange: number | null;
  joinedMinusLeft: number;
  joined: number;
  left: number;
  earned: number;
  likes: number;
  comments: number;
  rsvps: number;
  missions: number;
  reports: number;
  totalPoints: number | null;
}

export function artistSummary(days: readonly StatsDay[], range: DayRange, artistId: string): ArtistSummary {
  const current = days.filter((day) => day.day >= range.from && day.day <= range.to).sort((a, b) => (a.day < b.day ? -1 : 1));
  const sum = (metric: ArtistMetric) => current.reduce((total, day) => total + (artistValue(day, artistId, metric) ?? 0), 0);
  const snapshots = current.filter((day) => day.snapshot?.artists[artistId]);
  const first = snapshots[0]?.snapshot?.artists[artistId] ?? null;
  const last = snapshots[snapshots.length - 1]?.snapshot?.artists[artistId] ?? null;
  const joined = sum("joined");
  const left = sum("left");
  return {
    artistId,
    members: last ? last.members : null,
    membersChange: first && last && snapshots.length >= 2 ? last.members - first.members : null,
    joinedMinusLeft: joined - left,
    joined,
    left,
    earned: sum("earned"),
    likes: sum("likes"),
    comments: sum("comments"),
    rsvps: sum("rsvps"),
    missions: sum("missions"),
    reports: sum("reports"),
    totalPoints: last ? last.totalPoints : null,
  };
}

/** As centrais com mais entradas no período (as que vêm marcadas), no máximo 3. */
export function topArtistsByJoined(days: readonly StatsDay[], range: DayRange, candidates: readonly string[], count = COMPARE_MAX): string[] {
  const totals = candidates.map((id) => ({ id, joined: artistSummary(days, range, id).joined }));
  return totals
    .sort((a, b) => b.joined - a.joined || candidates.indexOf(a.id) - candidates.indexOf(b.id))
    .slice(0, count)
    .map((item) => item.id);
}

/** Os @ das centrais que aparecem nos números do período (inclusive as que só a seção Artistas vê, ou apagadas). */
export function artistsInDays(days: readonly StatsDay[]): string[] {
  const ids = new Set<string>();
  for (const day of days) {
    for (const id of Object.keys(day.byArtist)) ids.add(id);
    for (const id of Object.keys(day.snapshot?.artists ?? {})) ids.add(id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Campanhas e tipos de link
// ---------------------------------------------------------------------------

export type CampaignMode = "campaign" | "kind";
export type CampaignMetric = "signups" | "visits" | "links";

/** O número de um dia para uma campanha (só cadastros) ou um tipo de link. */
export function campaignValue(day: StatsDay, mode: CampaignMode, key: string, metric: CampaignMetric): number {
  if (mode === "campaign") return metric === "signups" ? (day.byOrigin.utmCampaign[key] ?? 0) : 0;
  return day.byOrigin.kind[key]?.[metric] ?? 0;
}

/** As campanhas (ou tipos de link) presentes no período, das com mais cadastros. */
export function campaignKeys(days: readonly StatsDay[], range: DayRange, mode: CampaignMode): string[] {
  const totals = new Map<string, number>();
  for (const day of days) {
    if (day.day < range.from || day.day > range.to) continue;
    const source = mode === "campaign" ? Object.entries(day.byOrigin.utmCampaign) : Object.entries(day.byOrigin.kind).map(([key, count]) => [key, count.signups + count.visits + count.links] as const);
    for (const [key, value] of source) totals.set(key, (totals.get(key) ?? 0) + value);
  }
  return [...totals]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

export function campaignGroupValue(byDay: ReadonlyMap<string, StatsDay>, group: Group, mode: CampaignMode, key: string, metric: CampaignMetric): number {
  return group.days.reduce((total, dayKey) => {
    const day = byDay.get(dayKey);
    return total + (day ? campaignValue(day, mode, key, metric) : 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

export type PeriodMetric =
  | "signups"
  | "invited"
  | "visits"
  | "links"
  | "earned"
  | "actives"
  | "likes"
  | "comments"
  | "rsvps"
  | "reports"
  | "joined"
  | "redeemRequested";

export const PERIOD_METRICS: MetricInfo<PeriodMetric>[] = [
  { key: "signups", label: "Cadastros", stock: false, points: false },
  { key: "invited", label: "Cadastros por convite", stock: false, points: false },
  { key: "visits", label: "Visitas pelos links", stock: false, points: false },
  { key: "links", label: "Links criados", stock: false, points: false },
  { key: "earned", label: "Pontos distribuídos", stock: false, points: true },
  { key: "actives", label: "Ativos por dia (média)", stock: true, points: false },
  { key: "likes", label: "Curtidas", stock: false, points: false },
  { key: "comments", label: "Comentários", stock: false, points: false },
  { key: "rsvps", label: "Presenças", stock: false, points: false },
  { key: "reports", label: "Denúncias", stock: false, points: false },
  { key: "joined", label: "Entradas nas centrais", stock: false, points: false },
  { key: "redeemRequested", label: "Pedidos na loja", stock: false, points: false },
];

export function periodValue(day: StatsDay, metric: PeriodMetric): number {
  switch (metric) {
    case "signups":
      return day.signups.total;
    case "invited":
      return day.signups.invited;
    case "visits":
      return day.invites.visits;
    case "links":
      return day.invites.links;
    case "actives":
      return day.actives.day;
    default:
      return day.totals[metric];
  }
}

/** O número de um período: a soma, ou a média por dia nos ativos (dos dias com número). */
export function periodTotal(days: readonly StatsDay[], range: DayRange, metric: PeriodMetric): number {
  const current = days.filter((day) => day.day >= range.from && day.day <= range.to);
  const total = current.reduce((sum, day) => sum + periodValue(day, metric), 0);
  if (metric !== "actives") return total;
  return current.length === 0 ? 0 : total / current.length;
}

/** As duas séries dia a dia, alinhadas pelo dia do período (o dia 1 de cada uma, o dia 2...). */
export function alignedSeries(
  days: readonly StatsDay[],
  a: DayRange,
  b: DayRange,
  metric: PeriodMetric,
): { index: number; dayA: string; dayB: string; a: number; b: number }[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const daysA = daysOf(a);
  const daysB = daysOf(b);
  return daysA.map((dayA, index) => {
    const dayB = daysB[index];
    const docA = byDay.get(dayA);
    const docB = dayB ? byDay.get(dayB) : undefined;
    return {
      index,
      dayA,
      dayB: dayB ?? "",
      a: docA ? periodValue(docA, metric) : 0,
      b: docB ? periodValue(docB, metric) : 0,
    };
  });
}
