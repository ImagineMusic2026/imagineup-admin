import { shiftDay } from "@/lib/day";
import { formatDay, formatNumber, formatTime, joinPt } from "@/lib/format";
import { toDate, type Role } from "@/lib/staff";

/**
 * A seção Fãs (26.16), puro: a carteira e o extrato como a ficha mostra, a
 * origem do cadastro, os vínculos com as centrais, a busca e o ajuste de
 * pontos. Leituras em `fan-data.ts` e `fan-search.ts`; callables em
 * `fan-api.ts`.
 */

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function mapOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Carteira
// ---------------------------------------------------------------------------

export interface MissionProgress {
  id: string;
  current: number;
  completedAt: Date | null;
}

export interface Wallet {
  exists: boolean;
  balance: number;
  xp: number;
  seasonId: string | null;
  seasonPoints: number;
  /** Ganhos por dia de São Paulo (a carteira só corta os dias velhos quando é gravada). */
  days: Record<string, number>;
  /** O retrato semanal do ranking: a posição, com a temporada e a semana. */
  rankWeek: { seasonId: string; week: string; position: number } | null;
  seasonMissions: number;
  goalReached: { seasonId: string; at: Date | null } | null;
  missions: { daily: { key: string; items: MissionProgress[] } | null; weekly: { key: string; items: MissionProgress[] } | null };
  /** Conquistas com a data do desbloqueio. */
  achievements: { id: string; at: Date | null }[];
  pastSeasons: number;
  closedSeasonId: string | null;
}

export const EMPTY_WALLET: Wallet = {
  exists: false,
  balance: 0,
  xp: 0,
  seasonId: null,
  seasonPoints: 0,
  days: {},
  rankWeek: null,
  seasonMissions: 0,
  goalReached: null,
  missions: { daily: null, weekly: null },
  achievements: [],
  pastSeasons: 0,
  closedSeasonId: null,
};

function parsePeriod(value: unknown): { key: string; items: MissionProgress[] } | null {
  const raw = mapOf(value);
  if (typeof raw.key !== "string") return null;
  const items = Object.entries(mapOf(raw.items)).map(([id, item]) => {
    const data = mapOf(item);
    return { id, current: numberOf(data.current), completedAt: toDate(data.completedAt) };
  });
  return { key: raw.key, items };
}

/** `wallets/{uid}` como a ficha usa; sem documento, tudo zerado. */
export function parseWallet(data: Record<string, unknown> | undefined): Wallet {
  if (!data) return EMPTY_WALLET;
  const days: Record<string, number> = {};
  for (const [day, value] of Object.entries(mapOf(data.days))) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days[day] = numberOf(mapOf(value).earned);
  }
  const rank = mapOf(data.rankWeek);
  const goal = mapOf(data.goalReached);
  const stats = mapOf(data.stats);
  const missions = mapOf(data.missions);
  return {
    exists: true,
    balance: numberOf(data.balance),
    xp: numberOf(data.xp),
    seasonId: textOrNull(data.seasonId),
    seasonPoints: numberOf(data.seasonPoints),
    days,
    rankWeek:
      typeof rank.seasonId === "string" && typeof rank.position === "number"
        ? { seasonId: rank.seasonId, week: typeof rank.week === "string" ? rank.week : "", position: rank.position }
        : null,
    seasonMissions: numberOf(data.seasonMissions),
    goalReached: typeof goal.seasonId === "string" ? { seasonId: goal.seasonId, at: toDate(goal.at) } : null,
    missions: { daily: parsePeriod(missions.daily), weekly: parsePeriod(missions.weekly) },
    achievements: Object.entries(mapOf(data.achievements))
      .map(([id, at]) => ({ id, at: toDate(at) }))
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
    pastSeasons: numberOf(stats.pastSeasons),
    closedSeasonId: textOrNull(stats.closedSeasonId),
  };
}

/** Os pontos da temporada só valem quando a carteira está na temporada de agora (ela só troca quando o fã age). */
export function seasonPointsNow(wallet: Pick<Wallet, "seasonId" | "seasonPoints">, currentSeasonId: string | null): number {
  return currentSeasonId && wallet.seasonId === currentSeasonId ? wallet.seasonPoints : 0;
}

/** A posição do retrato semanal, só quando é da temporada de agora. */
export function rankPositionNow(wallet: Pick<Wallet, "rankWeek">, currentSeasonId: string | null): number | null {
  return currentSeasonId && wallet.rankWeek?.seasonId === currentSeasonId ? wallet.rankWeek.position : null;
}

/** Ganhos de hoje e dos 6 dias anteriores (os dias velhos da carteira ficam de fora). */
export function earnedLast7Days(wallet: Pick<Wallet, "days">, today: string): number {
  const first = shiftDay(today, -6);
  return Object.entries(wallet.days).reduce((sum, [day, earned]) => (day >= first && day <= today ? sum + earned : sum), 0);
}

/** Temporadas jogadas: as que a virada contou e a de agora, se pontuou nela e a virada ainda não a contou. */
export function seasonsPlayed(wallet: Pick<Wallet, "pastSeasons" | "seasonPoints" | "seasonId" | "closedSeasonId">): number {
  const current = wallet.seasonPoints > 0 && wallet.seasonId !== wallet.closedSeasonId ? 1 : 0;
  return wallet.pastSeasons + current;
}

// ---------------------------------------------------------------------------
// Extrato
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  id: string;
  kind: string;
  source: string;
  points: number;
  xpDelta: number;
  seasonDelta: number;
  artistId: string | null;
  centralSeasonDelta: number;
  centralTotalDelta: number;
  subject: { type: string; id: string } | null;
  subjectTitle: string | null;
  balanceAfter: number;
  actor: { type: string; uid: string | null; name: string | null };
  note: string | null;
  createdAt: Date | null;
}

export function parseLedgerEntry(id: string, data: Record<string, unknown>): LedgerEntry {
  const subject = mapOf(data.subject);
  const actor = mapOf(data.actor);
  return {
    id,
    kind: typeof data.kind === "string" ? data.kind : "",
    source: typeof data.source === "string" ? data.source : "",
    points: numberOf(data.points),
    xpDelta: numberOf(data.xpDelta),
    seasonDelta: numberOf(data.seasonDelta),
    artistId: textOrNull(data.artistId),
    centralSeasonDelta: numberOf(data.centralSeasonDelta),
    centralTotalDelta: numberOf(data.centralTotalDelta),
    subject: typeof subject.type === "string" && typeof subject.id === "string" ? { type: subject.type, id: subject.id } : null,
    subjectTitle: textOrNull(data.subjectTitle),
    balanceAfter: numberOf(data.balanceAfter),
    actor: { type: typeof actor.type === "string" ? actor.type : "fan", uid: textOrNull(actor.uid), name: textOrNull(actor.name) },
    note: textOrNull(data.note),
    createdAt: toDate(data.createdAt),
  };
}

const SUBJECT_LABELS: Record<string, string> = {
  post: "Post",
  comment: "Comentário",
  event: "Show",
  artist: "Central",
  mission: "Missão",
  reward: "Recompensa",
  invite: "Convite",
};

/** O contexto do lançamento: o título guardado (missão, recompensa) ou o tipo e o id do assunto. */
export function ledgerContext(entry: Pick<LedgerEntry, "subject" | "subjectTitle" | "artistId">): string {
  if (entry.subjectTitle) return entry.subjectTitle;
  if (entry.subject) {
    if (entry.subject.type === "artist") return `Central @${entry.subject.id}`;
    return `${SUBJECT_LABELS[entry.subject.type] ?? entry.subject.type} ${entry.subject.id}`;
  }
  return entry.artistId ? `Central @${entry.artistId}` : "";
}

// ---------------------------------------------------------------------------
// Origem do cadastro
// ---------------------------------------------------------------------------

/** O `AwardStatus` do servidor, mais o `self` do autoconvite pela mesma pessoa noutra conta. */
export type AwardStatus = "applied" | "duplicate" | "capped" | "zero" | "skipped" | "self" | string;

export interface Referral {
  inviterUid: string | null;
  code: string;
  via: "link" | "code";
  link: { kind: string; targetId: string | null } | null;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  claimedAt: Date | null;
  signupAt: Date | null;
  award: { visit: AwardStatus; signup: AwardStatus };
  inviterRemovedAt: Date | null;
}

export function parseReferral(data: Record<string, unknown>): Referral {
  const link = mapOf(data.link);
  const utm = mapOf(data.utm);
  const award = mapOf(data.award);
  return {
    inviterUid: textOrNull(data.inviterUid),
    code: typeof data.code === "string" ? data.code : "",
    via: data.via === "code" ? "code" : "link",
    link: typeof link.kind === "string" ? { kind: link.kind, targetId: textOrNull(link.targetId) } : null,
    utm: { source: textOrNull(utm.source), medium: textOrNull(utm.medium), campaign: textOrNull(utm.campaign) },
    claimedAt: toDate(data.claimedAt),
    signupAt: toDate(data.signupAt),
    award: { visit: typeof award.visit === "string" ? award.visit : "skipped", signup: typeof award.signup === "string" ? award.signup : "skipped" },
    inviterRemovedAt: toDate(data.inviterRemovedAt),
  };
}

/** Pelo que o fã entrou: "pelo link do post Clipe novo", "da central Netto Brito", "pelo código digitado". */
export function referralPath(referral: Pick<Referral, "via" | "link">, names: { post?: string | null; artist?: string | null }): string {
  if (referral.via === "code" || !referral.link) return "pelo código digitado";
  switch (referral.link.kind) {
    case "post":
      return names.post ? `pelo link do post ${names.post}` : `pelo link de um post (${referral.link.targetId ?? "sem id"})`;
    case "artist":
      return `pelo link da central ${names.artist ?? (referral.link.targetId ? `@${referral.link.targetId}` : "")}`.trim();
    case "agenda":
      return "pelo link da agenda";
    case "invite":
      return "pelo link de convite";
    default:
      return "por um link do app";
  }
}

/**
 * O que quem convidou ganhou com este cadastro: os pontos que entraram no
 * extrato dele no claim, ou o motivo de não ter rendido.
 */
export function referralAwardText(referral: Pick<Referral, "inviterUid" | "award" | "inviterRemovedAt">, points: { visit: number | null; signup: number | null }): string {
  if (referral.award.visit === "self" || referral.award.signup === "self") return "Não rendeu: a mesma pessoa em outra conta.";
  if (!referral.inviterUid) return referral.inviterRemovedAt ? "Quem convidou excluiu a conta." : "Quem convidou não tem mais conta.";
  const part = (status: AwardStatus, value: number | null, what: string) => {
    if (status === "applied") return value !== null ? `${formatNumber(value)} ${value === 1 ? "ponto" : "pontos"} ${what}` : `pontos ${what}`;
    if (status === "duplicate") return `nada novo ${what} (já tinha rendido antes)`;
    if (status === "capped") return `nada ${what} (limite do dia)`;
    if (status === "zero") return `nada ${what} (a régua dava 0 ponto)`;
    if (status === "skipped") return `nada ${what} (conta suspensa ou sem perfil na hora)`;
    return `nada ${what}`;
  };
  const visit = part(referral.award.visit, points.visit, "pela visita");
  const signup = part(referral.award.signup, points.signup, "pelo cadastro");
  const paid = referral.award.visit === "applied" || referral.award.signup === "applied";
  return `${paid ? "Rendeu" : "Não rendeu"}: ${visit} e ${signup}.`;
}

/** A campanha, a origem e o meio do link, quando vieram. */
export function utmText(utm: Referral["utm"]): string | null {
  const parts = [
    utm.campaign ? `campanha ${utm.campaign}` : null,
    utm.source ? `origem ${utm.source}` : null,
    utm.medium ? `meio ${utm.medium}` : null,
  ].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? joinPt(parts) : null;
}

// ---------------------------------------------------------------------------
// Centrais do fã
// ---------------------------------------------------------------------------

export const VIA_LABELS: Record<string, string> = {
  onboarding: "Escolha inicial",
  page: "Página da central",
  seed: "Carga de teste",
};

export interface FanCentral {
  artistId: string;
  via: string;
  joinedAt: Date | null;
  member: boolean;
  seasonId: string | null;
  seasonPoints: number;
  totalPoints: number;
}

/** Junta os vínculos (`users/{uid}/centrals`) e os pontos (`wallets/{uid}/centralPoints`) pelo @. */
export function joinFanCentrals(
  links: { id: string; data: Record<string, unknown> }[],
  points: { id: string; data: Record<string, unknown> }[],
): FanCentral[] {
  const byId = new Map<string, FanCentral>();
  for (const link of links) {
    byId.set(link.id, {
      artistId: link.id,
      via: typeof link.data.via === "string" ? link.data.via : "",
      joinedAt: toDate(link.data.joinedAt),
      member: true,
      seasonId: null,
      seasonPoints: 0,
      totalPoints: 0,
    });
  }
  for (const point of points) {
    const current = byId.get(point.id) ?? {
      artistId: point.id,
      via: "",
      joinedAt: null,
      member: false,
      seasonId: null,
      seasonPoints: 0,
      totalPoints: 0,
    };
    byId.set(point.id, {
      ...current,
      // Membro é quem tem o vínculo agora (sair apaga o vínculo; os pontos ficam).
      member: current.member,
      seasonId: textOrNull(point.data.seasonId),
      seasonPoints: numberOf(point.data.seasonPoints),
      totalPoints: numberOf(point.data.totalPoints),
    });
  }
  return [...byId.values()].sort((a, b) => Number(b.member) - Number(a.member) || b.totalPoints - a.totalPoints || a.artistId.localeCompare(b.artistId));
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/** Sem acento, minúsculas, e o que não é letra ou número vira espaço (o `normalizeSearch` do servidor). */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type FanSearchKind =
  | { kind: "email"; email: string }
  | { kind: "uid"; uid: string; alsoText: string[] }
  | { kind: "text"; words: string[]; longest: string; handle: string | null; code: string | null };

export const SEARCH_WORD_MAX = 15;

/**
 * O que a busca procura: texto com `@` no meio é e-mail; 28 letras e números
 * é o uid (e também texto); de 6 a 12 letras e números também é código de
 * convite; o resto, nome e @ (a palavra mais longa no `searchKeys`, o @ por
 * começo, e as outras palavras filtram no navegador).
 */
export function classifyFanSearch(input: string): FanSearchKind | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[^@\s]+@[^@\s]+$/.test(text) && !text.startsWith("@")) return { kind: "email", email: text.toLowerCase() };
  const words = normalizeSearch(text)
    .split(" ")
    .filter((word) => word.length >= 2)
    .map((word) => word.slice(0, SEARCH_WORD_MAX));
  if (/^[A-Za-z0-9]{28}$/.test(text)) return { kind: "uid", uid: text, alsoText: words };
  const compact = text.replace(/[\s-]/g, "");
  const code = /^[A-Za-z0-9]{6,12}$/.test(compact) ? compact.toUpperCase() : null;
  const handleRaw = text.replace(/^@/, "").toLowerCase();
  const handle = /^[a-z0-9_.]{2,30}$/.test(handleRaw) ? handleRaw : null;
  const longest = words.reduce((best, word) => (word.length > best.length ? word : best), "");
  if (!longest && !handle && !code) return null;
  return { kind: "text", words, longest, handle, code };
}

/** O perfil achado pelo `searchKeys` ou pelo @ também precisa ter cada outra palavra no começo de uma palavra do nome ou do @. */
export function matchesAllWords(profile: { name: string; username: string }, words: readonly string[]): boolean {
  const own = normalizeSearch(`${profile.name} ${profile.username.replace(/_/g, " ")}`).split(" ");
  return words.every((word) => own.some((item) => item.startsWith(word)));
}

export const SEARCH_LIMIT = 20;

// ---------------------------------------------------------------------------
// Ajuste de pontos
// ---------------------------------------------------------------------------

export const ADJUST_EDITOR_MAX = 50_000;
export const ADJUST_EDITOR_DAILY_MAX = 100_000;
export const ADJUST_ADMIN_MAX = 1_000_000;
export const ADJUST_NOTE_MAX = 200;

export type AdjustCounter = "balance" | "xp" | "season" | "centralSeason" | "centralTotal";

export const COUNTER_LABELS: Record<AdjustCounter, string> = {
  balance: "Saldo",
  xp: "XP",
  season: "Pontos da temporada",
  centralSeason: "Pontos da temporada na central",
  centralTotal: "Pontos de sempre na central",
};

export function adjustLimitText(role: Role): string {
  return role === "admin"
    ? `Até ${formatNumber(ADJUST_ADMIN_MAX)} por contador.`
    : `Até ${formatNumber(ADJUST_EDITOR_MAX)} por contador em cada ajuste e ${formatNumber(ADJUST_EDITOR_DAILY_MAX)} por dia.`;
}

export interface AdjustForm {
  balance: string;
  xp: string;
  season: string;
  artistId: string;
  centralSeason: string;
  centralTotal: string;
  note: string;
}

export const EMPTY_ADJUST_FORM: AdjustForm = { balance: "", xp: "", season: "", artistId: "", centralSeason: "", centralTotal: "", note: "" };

export interface AdjustInput {
  uid: string;
  adjustmentId: string;
  balance?: number;
  xp?: number;
  season?: number;
  central?: { artistId: string; season?: number; total?: number };
  note: string;
}

export type AdjustErrors = Partial<Record<keyof AdjustForm | "form", string>>;

/** Um número inteiro com sinal ("+100", "-50", "1.000"); vazio é 0; `null` quando não é número. */
export function parseDelta(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(/\./g, "");
  if (!clean) return 0;
  if (!/^[+-]?\d+$/.test(clean)) return null;
  return Number(clean);
}

/** Uma linha visível, sem quebras: o que o servidor aceita no motivo. */
function visibleLine(text: string): boolean {
  return text.trim().length > 0 && !/[\r\n]/.test(text);
}

/**
 * O formulário do ajuste conferido como o servidor confere (`parseAdjustInput`):
 * deltas inteiros, pelo menos um diferente de zero, o teto por contador do
 * papel, a temporada só com temporada em andamento, a central com algum
 * delta, e o motivo de 1 a 200, numa linha.
 */
export function validateAdjust(
  form: AdjustForm,
  options: { role: Role; hasSeason: boolean },
): { errors: AdjustErrors; deltas: Record<AdjustCounter, number> | null } {
  const errors: AdjustErrors = {};
  const max = options.role === "admin" ? ADJUST_ADMIN_MAX : ADJUST_EDITOR_MAX;
  const deltas = {} as Record<AdjustCounter, number>;
  const fields: [AdjustCounter, keyof AdjustForm][] = [
    ["balance", "balance"],
    ["xp", "xp"],
    ["season", "season"],
    ["centralSeason", "centralSeason"],
    ["centralTotal", "centralTotal"],
  ];
  for (const [counter, field] of fields) {
    const value = parseDelta(form[field]);
    if (value === null) errors[field] = "Use um número inteiro, com + ou - na frente.";
    else if (Math.abs(value) > max) errors[field] = `No máximo ${formatNumber(max)} por contador.`;
    deltas[counter] = value ?? 0;
  }
  if (!options.hasSeason && deltas.season !== 0) errors.season = "Não há temporada em andamento.";
  if ((deltas.centralSeason !== 0 || deltas.centralTotal !== 0) && !form.artistId) errors.artistId = "Escolha a central.";
  if (form.artistId && deltas.centralSeason === 0 && deltas.centralTotal === 0) errors.centralTotal = "Escreva quanto muda na central, ou tire a central.";
  if (Object.values(deltas).every((value) => value === 0) && !errors.balance) errors.form = "Escreva pelo menos um valor diferente de zero.";
  const note = form.note.trim();
  if (!note) errors.note = "Escreva o motivo.";
  else if (note.length > ADJUST_NOTE_MAX) errors.note = `No máximo ${ADJUST_NOTE_MAX} caracteres.`;
  else if (!visibleLine(form.note)) errors.note = "O motivo vai numa linha só.";
  return { errors, deltas: Object.keys(errors).length === 0 ? deltas : null };
}

/** O corpo da callable, com os zeros de fora. */
export function adjustInputOf(uid: string, adjustmentId: string, form: AdjustForm, deltas: Record<AdjustCounter, number>): AdjustInput {
  const input: AdjustInput = { uid, adjustmentId, note: form.note.trim() };
  if (deltas.balance) input.balance = deltas.balance;
  if (deltas.xp) input.xp = deltas.xp;
  if (deltas.season) input.season = deltas.season;
  if (form.artistId && (deltas.centralSeason || deltas.centralTotal)) {
    input.central = { artistId: form.artistId };
    if (deltas.centralSeason) input.central.season = deltas.centralSeason;
    if (deltas.centralTotal) input.central.total = deltas.centralTotal;
  }
  return input;
}

/** O antes e o depois de um contador: "Saldo: 12.480 para 12.580". */
export function beforeAfter(label: string, before: number, delta: number): string {
  return `${label}: ${formatNumber(before)} para ${formatNumber(before + delta)}`;
}

/** O que já entrou, do `details.entry` do `adjustment-id-reused`: "Já entrou: saldo +100, em 7 out às 14:32." */
export function enteredText(entry: Record<string, unknown>, now: Date): string {
  const parts: string[] = [];
  const sign = (value: number) => (value > 0 ? `+${formatNumber(value)}` : formatNumber(value));
  for (const [key, label] of [
    ["balance", "saldo"],
    ["xp", "XP"],
    ["season", "temporada"],
  ] as const) {
    const value = entry[key];
    if (typeof value === "number" && value !== 0) parts.push(`${label} ${sign(value)}`);
  }
  const central = mapOf(entry.central);
  if (typeof central.artistId === "string") {
    if (typeof central.season === "number" && central.season !== 0) parts.push(`temporada na central ${sign(central.season)}`);
    if (typeof central.total === "number" && central.total !== 0) parts.push(`central ${sign(central.total)}`);
  }
  const at = toDate(entry.createdAt);
  return `Já entrou: ${parts.length > 0 ? joinPt(parts) : "o ajuste"}${at ? `, em ${formatDay(at, now)} às ${formatTime(at)}` : ""}.`;
}

/** Depois de 30 s do envio (o prazo do ajuste no servidor), nada mais grava: a tentativa pode fechar. */
export const ADJUST_SETTLE_MS = 30_000;

/** Um id novo de tentativa no formato do servidor (`^[A-Za-z0-9_-]{8,64}$`). */
export function newAdjustmentId(random: () => string = () => crypto.randomUUID()): string {
  return random().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}
