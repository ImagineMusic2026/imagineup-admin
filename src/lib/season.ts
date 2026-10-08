import { localToMs, msToLocal } from "@/lib/day";
import { formatDay } from "@/lib/format";
import { toDate } from "@/lib/staff";

/**
 * Ranking e temporadas (23.10 e 26.16), puro: o `config/season` lido, a
 * situação da temporada pelo relógio e pelo arquivo da virada, o resumo do
 * cabeçalho, e o formulário da temporada com a validação espelhada do
 * `validateSeasonInput` do servidor.
 */

export const SEASON_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
export const SEASON_NAME_MAX = 40;
export const SEASON_MAX_DAYS = 366;
export const TOP_TARGET_DEFAULT = 10;
export const TOP_TARGET_MAX = 50;
/** A virada roda a cada 10 min; passou disto do fim sem arquivo, ela está atrasada. */
export const CLOSE_LATE_MS = 30 * 60_000;
/** A folga do `closeDue` do servidor: antes dela, o `closeSeasonNow` recusa com `season-not-due`. */
export const CLOSE_GRACE_MS = 60_000;

export interface SeasonDef {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  leaderTitle: string | null;
  topTarget: number;
  endedEarly: { plannedEndsAt: Date | null; at: Date | null; by: string | null } | null;
}

export interface SeasonConfig {
  version: number;
  season: SeasonDef | null;
  next: SeasonDef | null;
  lastClosed: (SeasonDef & { closedAt: Date | null }) | null;
}

function parseDef(value: unknown): SeasonDef | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const startsAt = toDate(data.startsAt);
  const endsAt = toDate(data.endsAt);
  if (typeof data.id !== "string" || !startsAt || !endsAt) return null;
  const early = data.endedEarly && typeof data.endedEarly === "object" ? (data.endedEarly as Record<string, unknown>) : null;
  const by = early?.by && typeof early.by === "object" ? (early.by as { name?: unknown }) : null;
  return {
    id: data.id,
    name: typeof data.name === "string" ? data.name : data.id,
    startsAt,
    endsAt,
    leaderTitle: typeof data.leaderTitle === "string" && data.leaderTitle ? data.leaderTitle : null,
    topTarget: typeof data.topTarget === "number" ? data.topTarget : TOP_TARGET_DEFAULT,
    endedEarly: early ? { plannedEndsAt: toDate(early.plannedEndsAt), at: toDate(early.at), by: typeof by?.name === "string" ? by.name : null } : null,
  };
}

export function parseSeasonConfig(data: Record<string, unknown> | undefined): SeasonConfig {
  const last = parseDef(data?.lastClosed);
  return {
    version: typeof data?.version === "number" ? data.version : 0,
    season: parseDef(data?.season),
    next: parseDef(data?.next),
    lastClosed: last ? { ...last, closedAt: toDate((data?.lastClosed as Record<string, unknown>).closedAt) } : null,
  };
}

export type SeasonPhase = "scheduled" | "active" | "awaiting-close" | "closing" | "late";

export const PHASE_LABELS: Record<SeasonPhase, string> = {
  scheduled: "Agendada",
  active: "Em andamento",
  "awaiting-close": "Esperando a virada",
  closing: "Virada em andamento",
  late: "Virada atrasada",
};

/** A situação pelo relógio e pelo arquivo (`seasons/{id}.status`, ou `null` sem arquivo). */
export function seasonPhase(season: Pick<SeasonDef, "startsAt" | "endsAt">, archiveStatus: string | null, now: number): SeasonPhase {
  if (season.startsAt.getTime() > now) return "scheduled";
  if (season.endsAt.getTime() > now) return "active";
  const late = now - season.endsAt.getTime() > CLOSE_LATE_MS;
  if (late && (archiveStatus === null || archiveStatus === "closing")) return "late";
  if (archiveStatus === "closing") return "closing";
  return "awaiting-close";
}

/** O "Rodar a virada agora" aparece só esperando a virada ou com ela atrasada, e passada a folga do servidor. */
export function canRunClose(phase: SeasonPhase | null, season: Pick<SeasonDef, "endsAt"> | null, now: number): boolean {
  if (!season || (phase !== "awaiting-close" && phase !== "late")) return false;
  return now >= season.endsAt.getTime() + CLOSE_GRACE_MS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "termina em 12 dias", "termina hoje", "começa em 3 dias". */
function inDays(target: Date, now: number, verb: string): string {
  const days = Math.ceil((target.getTime() - now) / DAY_MS);
  if (days <= 0) return `${verb} hoje`;
  return `${verb} em ${days} ${days === 1 ? "dia" : "dias"}`;
}

/** O resumo vivo do cabeçalho: "São João em andamento, termina em 12 dias." */
export function seasonSummary(config: SeasonConfig, phase: SeasonPhase | null, now: number): string {
  const season = config.season;
  if (!season || !phase) return config.lastClosed ? `Nenhuma temporada agora. A última foi ${config.lastClosed.name}.` : "Nenhuma temporada cadastrada.";
  switch (phase) {
    case "scheduled":
      return `${season.name} agendada, ${inDays(season.startsAt, now, "começa")}.`;
    case "active":
      return `${season.name} em andamento, ${inDays(season.endsAt, now, "termina")}.`;
    case "awaiting-close":
      return `${season.name} terminou e espera a virada.`;
    case "closing":
      return `${season.name}: a virada está fechando o ranking.`;
    case "late":
      return `${season.name}: a virada está atrasada.`;
  }
}

/** "de 1 jun, 00:00 a 30 jun, 23:59", em São Paulo. */
export function seasonDates(season: Pick<SeasonDef, "startsAt" | "endsAt">, now: Date): string {
  const time = (date: Date) => msToLocal(date.getTime()).slice(11);
  return `de ${formatDay(season.startsAt, now)}, ${time(season.startsAt)} a ${formatDay(season.endsAt, now)}, ${time(season.endsAt)}`;
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface SeasonForm {
  name: string;
  id: string;
  /** O id foi escrito à mão (não segue mais o nome). */
  idEdited: boolean;
  /** `datetime-local` em São Paulo. */
  startsAt: string;
  endsAt: string;
  leaderTitle: string;
  topTarget: string;
}

export const EMPTY_SEASON_FORM: SeasonForm = { name: "", id: "", idEdited: false, startsAt: "", endsAt: "", leaderTitle: "", topTarget: String(TOP_TARGET_DEFAULT) };

export function seasonFormOf(season: SeasonDef): SeasonForm {
  return {
    name: season.name,
    id: season.id,
    idEdited: true,
    startsAt: msToLocal(season.startsAt.getTime()),
    endsAt: msToLocal(season.endsAt.getTime()),
    leaderTitle: season.leaderTitle ?? "",
    topTarget: String(season.topTarget),
  };
}

/** O id sugerido pelo nome: sem acento, minúsculas, o resto vira "-", até 40. */
export function suggestSeasonId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export interface SeasonInput {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  leaderTitle: string | null;
  topTarget: number;
}

export type SeasonErrors = Partial<Record<"name" | "id" | "startsAt" | "endsAt" | "leaderTitle" | "topTarget", string>>;

function visibleLabel(text: string): boolean {
  const clean = text.trim();
  return clean.length > 0 && clean.length <= SEASON_NAME_MAX && !/[\r\n]/.test(text);
}

/** Confere como o servidor (`validateSeasonInput`): id, nome, início antes do fim (até 366 dias), título e top. */
export function validateSeason(form: SeasonForm): { errors: SeasonErrors; input: SeasonInput | null } {
  const errors: SeasonErrors = {};
  if (!visibleLabel(form.name)) errors.name = `Escreva o nome, até ${SEASON_NAME_MAX} caracteres.`;
  if (!SEASON_ID_PATTERN.test(form.id)) errors.id = "Use de 3 a 40 letras minúsculas, números ou -.";
  const startsAt = localToMs(form.startsAt);
  const endsAt = localToMs(form.endsAt);
  if (startsAt === null) errors.startsAt = "Escolha o dia e a hora do início.";
  if (endsAt === null) errors.endsAt = "Escolha o dia e a hora do fim.";
  if (startsAt !== null && endsAt !== null) {
    if (endsAt <= startsAt) errors.endsAt = "O fim precisa vir depois do início.";
    else if (endsAt - startsAt > SEASON_MAX_DAYS * DAY_MS) errors.endsAt = `No máximo ${SEASON_MAX_DAYS} dias de temporada.`;
  }
  const title = form.leaderTitle.trim();
  if (title && !visibleLabel(title)) errors.leaderTitle = `Até ${SEASON_NAME_MAX} caracteres, numa linha.`;
  const top = Number(form.topTarget);
  if (!Number.isInteger(top) || top < 1 || top > TOP_TARGET_MAX) errors.topTarget = `De 1 a ${TOP_TARGET_MAX}.`;
  if (Object.keys(errors).length > 0 || startsAt === null || endsAt === null) return { errors, input: null };
  return { errors, input: { id: form.id, name: form.name.trim(), startsAt, endsAt, leaderTitle: title || null, topTarget: top } };
}

/** O campo do `invalid-request` (`details.field`, como `season.endsAt`) no formulário. */
export function fieldOfDetail(field: unknown): keyof SeasonErrors | null {
  if (typeof field !== "string") return null;
  const last = field.split(".").pop() ?? "";
  return (["name", "id", "startsAt", "endsAt", "leaderTitle", "topTarget"] as const).find((key) => key === last) ?? null;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankingRow {
  position: number;
  userId: string;
  displayName: string | null;
  photoURL: string | null;
  city: string | null;
  points: number;
  change: number;
}

/** A seta da semana por extenso: "subiu 3", "caiu 2", "igual". */
export function changeText(change: number): string {
  if (change > 0) return `subiu ${change} ${change === 1 ? "posição" : "posições"}`;
  if (change < 0) return `caiu ${-change} ${change === -1 ? "posição" : "posições"}`;
  return "sem mudança na semana";
}

export interface PastSeason extends SeasonDef {
  status: string;
  rankedFans: number;
  centrals: string[];
  closedAt: Date | null;
}

export function parsePastSeason(id: string, data: Record<string, unknown>): PastSeason | null {
  const def = parseDef({ ...data, id: typeof data.id === "string" ? data.id : id });
  if (!def) return null;
  return {
    ...def,
    status: typeof data.status === "string" ? data.status : "closed",
    rankedFans: typeof data.rankedFans === "number" ? data.rankedFans : 0,
    centrals: data.centrals && typeof data.centrals === "object" ? Object.keys(data.centrals as object) : [],
    closedAt: toDate(data.closedAt),
  };
}

export interface StandingRow {
  uid: string;
  position: number;
  points: number;
  displayName: string | null;
  photoURL: string | null;
  city: string | null;
}

/** Uma linha do pódio, no geral ou numa central. */
export function parseStanding(uid: string, data: Record<string, unknown>, artistId: string | null): StandingRow | null {
  const centrals = data.centrals && typeof data.centrals === "object" ? (data.centrals as Record<string, { position?: unknown; points?: unknown }>) : {};
  const source = artistId ? centrals[artistId] : (data as { position?: unknown; points?: unknown });
  if (!source || typeof source.position !== "number") return null;
  return {
    uid,
    position: source.position,
    points: typeof source.points === "number" ? source.points : 0,
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
    city: typeof data.city === "string" ? data.city : null,
  };
}
