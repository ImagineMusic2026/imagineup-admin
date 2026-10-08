import { daysOf, isoWeekDays, monthKey, shiftDay, shiftWeek, weekKey, type DayRange } from "@/lib/day";

/**
 * Os números do dia (`statsDaily`), puro. O fechamento das 00:20
 * (`closeStatsDays`, 26.3) soma os 64 shards de cada dia passado num documento
 * `statsDaily/{dia}` fechado, na mesma forma dos shards (seções 7, 20.7, 21.10
 * e 25.3), e guarda no dia de ontem o retrato do estoque da noite. O painel lê
 * um documento por dia; só o dia de ontem, antes do fechamento dele, e o de
 * hoje (pelo botão) são somados aqui, com a mesma soma do servidor.
 *
 * Campo ausente vale 0 em qualquer nível. O retrato nunca se soma entre dias,
 * e os ativos únicos da semana e do mês são `newInWeek` e `newInMonth`
 * somados no calendário (somar `actives.day` contaria o mesmo fã várias vezes).
 */

/** Folhas numéricas em qualquer profundidade, como os shards. */
export type StatsTree = { [key: string]: number | StatsTree };

/** Campos do shard que não são contagem: o dia, o carimbo e a marca da carga. */
const TOP_LEVEL_SKIP = new Set(["day", "updatedAt", "backfill"]);

/** Só os mapas do Firestore (objetos simples): um Timestamp não entra na soma. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function addInto(target: StatsTree, source: Record<string, unknown>, top: boolean): void {
  for (const [key, value] of Object.entries(source)) {
    if (top && TOP_LEVEL_SKIP.has(key)) continue;
    const current = target[key];
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      if (current === undefined) target[key] = value;
      else if (typeof current === "number") target[key] = current + value;
    } else if (isPlainObject(value)) {
      if (typeof current === "number") continue;
      const child = current ?? {};
      addInto(child, value, false);
      target[key] = child;
    }
  }
}

/**
 * A soma dos shards de um dia: toda folha numérica, em qualquer profundidade,
 * menos `day`, `updatedAt` e `backfill` do topo (o `actives.day` entra). O
 * mesmo algoritmo do `sumStatsDocs` do servidor (`points/close.ts`), com o
 * mesmo teste.
 */
export function sumStatsDocs(docs: readonly unknown[]): StatsTree {
  const sum: StatsTree = {};
  for (const doc of docs) if (isPlainObject(doc)) addInto(sum, doc, true);
  return sum;
}

// ---------------------------------------------------------------------------
// O dia, lido
// ---------------------------------------------------------------------------

export const TOTAL_KEYS = [
  "earned",
  "earnedEvents",
  "spent",
  "spentEvents",
  "adjusted",
  "adjustedEvents",
  "joined",
  "left",
  "likes",
  "unlikes",
  "comments",
  "rsvps",
  "rsvpsUndone",
  "reports",
  "blocks",
  "refunded",
  "refundedEvents",
  "redeemRequested",
  "redeemApproved",
  "redeemDelivered",
  "redeemRefused",
  "redeemCanceled",
] as const;
export type TotalKey = (typeof TOTAL_KEYS)[number];
export type Totals = Record<TotalKey, number>;

export const ARTIST_KEYS = [
  "earned",
  "earnedEvents",
  "spent",
  "spentEvents",
  "joined",
  "left",
  "likes",
  "unlikes",
  "comments",
  "rsvps",
  "rsvpsUndone",
  "reports",
] as const;
export type ArtistKey = (typeof ARTIST_KEYS)[number];

export interface SourceCount {
  points: number;
  events: number;
}

export type ArtistDay = Record<ArtistKey, number> & { bySource: Record<string, SourceCount> };

export const REWARD_KEYS = ["requested", "spent", "approved", "delivered", "refused", "canceled", "refunded"] as const;
export type RewardKey = (typeof REWARD_KEYS)[number];
export type RewardDay = Record<RewardKey, number>;

export interface OriginCount {
  signups: number;
  visits: number;
  links: number;
}

/** O retrato do estoque da noite, no dia de ontem de cada rodada (26.3). */
export interface StatsSnapshot {
  at: Date | null;
  /** `count()` de `users`. */
  fans: number;
  /** A temporada do dia e os fãs com pontos nela. */
  season: { id: string; rankedFans: number } | null;
  /** Membros e "PTS DA CENTRAL" de cada central, em qualquer status. */
  artists: Record<string, { members: number; totalPoints: number }>;
}

export interface StatsDay {
  day: string;
  /** Fechado pelo servidor; `false` no dia somado no navegador (ontem antes do fechamento, ou hoje). */
  closed: boolean;
  closedAt: Date | null;
  shardCount: number;
  totals: Totals;
  bySource: Record<string, SourceCount>;
  byArtist: Record<string, ArtistDay>;
  actives: { day: number; newInWeek: number; newInMonth: number };
  /** Ativos da semana por semana de cadastro (`cohorts[C].active`). */
  cohorts: Record<string, number>;
  signups: { total: number; invited: number };
  invites: { visits: number; links: number };
  byOrigin: {
    kind: Record<string, OriginCount>;
    utmSource: Record<string, number>;
    utmCampaign: Record<string, number>;
  };
  /** Missões concluídas e pagas no dia (`byMission[id].completed`). */
  byMission: Record<string, number>;
  /** Conquistas desbloqueadas no dia (`byAchievement[id].unlocked`). */
  byAchievement: Record<string, number>;
  byReward: Record<string, RewardDay>;
  snapshot: StatsSnapshot | null;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mapOf(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function pick<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> {
  const source = mapOf(value);
  return Object.fromEntries(keys.map((key) => [key, numberOf(source[key])])) as Record<K, number>;
}

function mapEntries<T>(value: unknown, read: (item: unknown) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(mapOf(value)).map(([key, item]) => [key, read(item)]));
}

function sourceCounts(value: unknown): Record<string, SourceCount> {
  return mapEntries(value, (item) => pick(item, ["points", "events"]));
}

/** Date de um Timestamp do Firestore (ou de algo com `toDate`), ou `null`. */
function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = (value as { toDate: () => unknown }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  return null;
}

function parseSnapshot(value: unknown): StatsSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const season = data.season && typeof data.season === "object" ? (data.season as Record<string, unknown>) : null;
  return {
    at: dateOf(data.at),
    fans: numberOf(data.fans),
    season:
      season && typeof season.id === "string" ? { id: season.id, rankedFans: numberOf(season.rankedFans) } : null,
    artists: mapEntries(data.artists, (item) => pick(item, ["members", "totalPoints"])),
  };
}

/**
 * Um dia como as telas usam, de um documento fechado de `statsDaily` ou da
 * soma dos shards (com `closed: false`). Campo ausente vale 0.
 */
export function parseStatsDay(day: string, data: Record<string, unknown>): StatsDay {
  const origin = mapOf(data.byOrigin);
  return {
    day,
    closed: data.closed === true,
    closedAt: dateOf(data.closedAt),
    shardCount: numberOf(data.shardCount),
    totals: pick(data.totals, TOTAL_KEYS),
    bySource: sourceCounts(data.bySource),
    byArtist: mapEntries(data.byArtist, (item) => ({
      ...pick(item, ARTIST_KEYS),
      bySource: sourceCounts(mapOf(item).bySource),
    })),
    actives: pick(data.actives, ["day", "newInWeek", "newInMonth"]),
    cohorts: mapEntries(data.cohorts, (item) => numberOf(mapOf(item).active)),
    signups: pick(data.signups, ["total", "invited"]),
    invites: pick(data.invites, ["visits", "links"]),
    byOrigin: {
      kind: mapEntries(origin.kind, (item) => pick(item, ["signups", "visits", "links"])),
      utmSource: mapEntries(origin.utmSource, (item) => numberOf(mapOf(item).signups)),
      utmCampaign: mapEntries(origin.utmCampaign, (item) => numberOf(mapOf(item).signups)),
    },
    byMission: mapEntries(data.byMission, (item) => numberOf(mapOf(item).completed)),
    byAchievement: mapEntries(data.byAchievement, (item) => numberOf(mapOf(item).unlocked)),
    byReward: mapEntries(data.byReward, (item) => pick(item, REWARD_KEYS)),
    snapshot: data.snapshot ? parseSnapshot(data.snapshot) : null,
  };
}

/** Um dia aberto, somado no navegador a partir dos shards (sem retrato). */
export function statsDayFromShards(day: string, shards: readonly unknown[]): StatsDay {
  return { ...parseStatsDay(day, sumStatsDocs(shards)), closed: false, shardCount: shards.length, snapshot: null };
}

// ---------------------------------------------------------------------------
// O fechamento
// ---------------------------------------------------------------------------

export type CloseState =
  /** Sem `statsMeta/close`: a carga dos cadastros não rodou, nada é somado. */
  | { kind: "not-started" }
  /** Ontem já fechou. */
  | { kind: "ok"; lastClosedDay: string }
  /** Ontem ainda não fechou (entre a meia-noite e a rodada): só ontem é somado no navegador. */
  | { kind: "yesterday-open"; lastClosedDay: string }
  /** Mais atrasado: nada é somado, os dias depois de `lastClosedDay` ficam como não fechados. */
  | { kind: "late"; lastClosedDay: string; firstOpenDay: string };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** O estado do fechamento pelo `statsMeta/close` (ou a falta dele) e o dia de hoje em São Paulo. */
export function closeState(meta: { lastClosedDay?: unknown } | null, today: string): CloseState {
  const last = meta?.lastClosedDay;
  if (typeof last !== "string" || !DAY_PATTERN.test(last)) return { kind: "not-started" };
  const yesterday = shiftDay(today, -1);
  if (last >= yesterday) return { kind: "ok", lastClosedDay: last };
  if (last === shiftDay(yesterday, -1)) return { kind: "yesterday-open", lastClosedDay: last };
  return { kind: "late", lastClosedDay: last, firstOpenDay: shiftDay(last, 1) };
}

// ---------------------------------------------------------------------------
// Somas e séries
// ---------------------------------------------------------------------------

export type DayPick = (day: StatsDay) => number;

/** Soma de um número nos dias que existem (o dia sem documento conta 0). */
export function sumRange(days: readonly StatsDay[], pickValue: DayPick, range?: DayRange): number {
  return days.reduce((total, day) => (!range || (day.day >= range.from && day.day <= range.to) ? total + pickValue(day) : total), 0);
}

export interface SeriesPoint {
  day: string;
  value: number;
  /** Dia sem documento: não fechado (ou não lido). O valor é 0. */
  missing: boolean;
  /** Dia somado no navegador (ontem antes do fechamento, ou hoje). */
  partial: boolean;
}

/** Um ponto por dia da faixa, na ordem. */
export function seriesByDay(range: DayRange, days: readonly StatsDay[], pickValue: DayPick): SeriesPoint[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  return daysOf(range).map((key) => {
    const day = byDay.get(key);
    return { day: key, value: day ? pickValue(day) : 0, missing: !day, partial: Boolean(day && !day.closed) };
  });
}

export interface WeekPoint {
  week: string;
  /** Primeiro e último dia da semana dentro da faixa. */
  from: string;
  to: string;
  value: number;
  /** Algum dia da semana dentro da faixa sem documento. */
  missing: boolean;
}

/** Um ponto por semana ISO tocada pela faixa (só os dias dela entram na soma). */
export function seriesByWeek(range: DayRange, days: readonly StatsDay[], pickValue: DayPick): WeekPoint[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const weeks: WeekPoint[] = [];
  for (const key of daysOf(range)) {
    const week = weekKey(key);
    let point = weeks[weeks.length - 1];
    if (!point || point.week !== week) {
      point = { week, from: key, to: key, value: 0, missing: false };
      weeks.push(point);
    }
    point.to = key;
    const day = byDay.get(key);
    if (day) point.value += pickValue(day);
    else point.missing = true;
  }
  return weeks;
}

/** Ativos únicos da semana ISO (`2026-W41`) ou do mês (`2026-10`): a soma de `newInWeek` ou `newInMonth` nos dias dela. */
export function activesOf(days: readonly StatsDay[], period: { week: string } | { month: string }): number {
  if ("week" in period) {
    return days.reduce((total, day) => (weekKey(day.day) === period.week ? total + day.actives.newInWeek : total), 0);
  }
  return days.reduce((total, day) => (monthKey(day.day) === period.month ? total + day.actives.newInMonth : total), 0);
}

/** O primeiro dia da semana ou do mês de `yesterday`: até onde a leitura precisa ir para os ativos "até ontem". */
export function periodStart(period: "week" | "month", yesterday: string): string {
  return period === "week" ? isoWeekDays(weekKey(yesterday))[0] : `${monthKey(yesterday)}-01`;
}

/** Ativos únicos desta semana (ou deste mês) até ontem. */
export function activesToDate(days: readonly StatsDay[], period: "week" | "month", yesterday: string): number {
  const first = periodStart(period, yesterday);
  const inRange = days.filter((day) => day.day >= first && day.day <= yesterday);
  return period === "week"
    ? activesOf(inRange, { week: weekKey(yesterday) })
    : activesOf(inRange, { month: monthKey(yesterday) });
}

export interface RetentionCell {
  /** Semanas depois da do cadastro (0 é a própria). */
  offset: number;
  week: string;
  active: number;
  /** `active / signups`, ou `null` quando a coorte não tem cadastro. */
  rate: number | null;
  /** A semana ainda não terminou (vai até ontem) ou tem dia não fechado. */
  partial: boolean;
}

export interface RetentionRow {
  week: string;
  signups: number;
  cells: RetentionCell[];
}

/**
 * Retenção por coorte (seção 7): para cada semana de cadastro C, os ativos da
 * coorte na semana C + n (a soma de `cohorts[C].active` nos dias dela),
 * divididos pelos cadastros dos dias da semana C. As colunas vão até a semana
 * de `lastDay` (ontem), que conta como parcial.
 */
export function retentionTable(days: readonly StatsDay[], cohortWeeks: readonly string[], lastDay: string): RetentionRow[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const lastWeek = weekKey(lastDay);
  return cohortWeeks.map((cohort) => {
    const signups = isoWeekDays(cohort).reduce((total, key) => total + (byDay.get(key)?.signups.total ?? 0), 0);
    const cells: RetentionCell[] = [];
    for (let offset = 0; ; offset += 1) {
      const week = shiftWeek(cohort, offset);
      if (week > lastWeek) break;
      const weekDays = isoWeekDays(week);
      let active = 0;
      let partial = week === lastWeek && lastDay < weekDays[6];
      for (const key of weekDays) {
        if (key > lastDay) continue;
        const day = byDay.get(key);
        if (!day) partial = true;
        else active += day.cohorts[cohort] ?? 0;
      }
      cells.push({ offset, week, active, rate: signups > 0 ? active / signups : null, partial });
    }
    return { week: cohort, signups, cells };
  });
}

/** O retrato do último dia (por data) que tem um, ou `null`. Nunca soma retratos. */
export function lastSnapshot(days: readonly StatsDay[]): { day: string; snapshot: StatsSnapshot } | null {
  let found: { day: string; snapshot: StatsSnapshot } | null = null;
  for (const day of days) {
    if (day.snapshot && (!found || day.day > found.day)) found = { day: day.day, snapshot: day.snapshot };
  }
  return found;
}

/** O `closedAt` mais novo entre os dias fechados. */
export function lastClosedAt(days: readonly StatsDay[]): Date | null {
  let found: Date | null = null;
  for (const day of days) if (day.closed && day.closedAt && (!found || day.closedAt > found)) found = day.closedAt;
  return found;
}

/** Soma os mapas de um campo nos dias (para tabelas por origem, campanha, missão...). */
export function sumMaps(days: readonly StatsDay[], pickMap: (day: StatsDay) => Record<string, number>): Record<string, number> {
  const total: Record<string, number> = {};
  for (const day of days) for (const [key, value] of Object.entries(pickMap(day))) total[key] = (total[key] ?? 0) + value;
  return total;
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

/** As origens dos pontos, com os nomes do extrato do app. */
export const SOURCE_LABELS: Record<string, string> = {
  like: "Curtida",
  comment: "Comentário",
  rsvp: "Presença em show",
  central_join: "Entrada na central",
  mission: "Missão concluída",
  invite_visit: "Visita pelo link",
  invite_signup: "Cadastro pelo link",
  redeem: "Resgate",
  redeem_refund: "Resgate devolvido",
  adjustment: "Ajuste da equipe",
  seed: "Ajuste",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Os tipos de link de convite (`byOrigin.kind`). */
export const ORIGIN_KIND_LABELS: Record<string, string> = {
  invite: "Convite",
  post: "Post",
  artist: "Central",
  agenda: "Agenda",
  other: "Outro",
  code: "Código digitado",
};

/** O `_none` dos recortes de `utm_source` e `utm_campaign`. */
export const ORIGIN_NONE_LABEL = "Sem campanha";
/** O `_other` do corte dos recortes (mais de 500 valores num dia). */
export const ORIGIN_OTHER_LABEL = "Outras";

export function originKindLabel(kind: string): string {
  return ORIGIN_KIND_LABELS[kind] ?? kind;
}

/** Rótulo de uma chave de `utm_source` ou `utm_campaign` (o `_none` da origem diz "Sem origem"). */
export function utmLabel(key: string, noneLabel: string = ORIGIN_NONE_LABEL): string {
  if (key === "_none") return noneLabel;
  if (key === "_other") return ORIGIN_OTHER_LABEL;
  return key;
}
