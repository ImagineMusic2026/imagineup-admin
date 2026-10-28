import { dayKey, shiftDay } from "@/lib/day";
import { errorDetails, readError } from "@/lib/errors";
import { socialHref, type FanSocial } from "@/lib/fan-profile";
import { ADJUST_ADMIN_MAX, ADJUST_EDITOR_DAILY_MAX, ADJUST_EDITOR_MAX, newAdjustmentId } from "@/lib/fans";
import { countLabel, formatDay, formatNumber, formatRelative, formatTime, joinPt } from "@/lib/format";
import { REPORT_REASONS as COMMENT_REPORT_REASONS, REPORT_REASON_LABELS as COMMENT_REPORT_REASON_LABELS, type ReportReason as CommentReportReason } from "@/lib/moderation";
import { toDate, type Role } from "@/lib/staff";
import { cleanLine, cleanMultiline, isVisibleLine, isVisibleMultiline } from "@/lib/visible-line";
import { isWhatsapp } from "@/lib/whatsapp";

/**
 * O fã-clube gerido pelo fã (seção 34 da nota do app, `docs/arquitetura-api.md`),
 * puro: as candidaturas, o fã-clube, as publicações, as denúncias, os números,
 * os seguidores e o Recompensar como a seção Fã-clubes lê, os rótulos e as
 * frases das decisões. Toda decisão passa pela `decideFanClub`
 * (`fan-club-api.ts`), com os assuntos do servidor das etapas 1 a 5 (34.14 e
 * 34.22): a candidatura, o fã-clube (com o Destaque e o Recompensar), a
 * publicação e a denúncia. Desde a Fase 2 (seção 37), também o comentário:
 * as reações e os comentários das publicações, os marcados, a fila dos
 * comentários, o registro do ocultar do gestor e a taxa de engajamento.
 */

/** Tamanho das páginas das listas da seção (o "Carregar mais"). */
export const FAN_CLUBS_PAGE_SIZE = 25;

/** O nome do fã-clube: de 3 a 40, numa linha visível, como o `checkClubName` do servidor. */
export const FAN_CLUB_NAME_MIN = 3;
export const FAN_CLUB_NAME_MAX = 40;

/** A frase das confirmações (34.10). */
export const FAN_CLUB_AUDIT_TEXT = "A alteração fica registrada em Logs e auditoria com o seu nome.";

// ---------------------------------------------------------------------------
// Candidatura
// ---------------------------------------------------------------------------

export const APPLICATION_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** As resolvidas, na ordem do filtro da segunda lista. */
export const RESOLVED_APPLICATION_STATUSES = ["approved", "rejected", "withdrawn"] as const;
export type ResolvedApplicationStatus = (typeof RESOLVED_APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: "Em análise",
  approved: "Aprovada",
  rejected: "Recusada",
  withdrawn: "Retirada",
};

/** O filtro da lista das resolvidas. */
export const RESOLVED_FILTER_LABELS: Record<ResolvedApplicationStatus, string> = {
  approved: "Aprovadas",
  rejected: "Recusadas",
  withdrawn: "Retiradas",
};

/** Os motivos da recusa (34.3), na ordem do servidor. O fã vê uma frase fixa por motivo no app. */
export const REJECT_REASONS = ["incomplete", "not_fit", "artist_limit", "image_rights", "rules", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  incomplete: "Faltam informações",
  not_fit: "Não combina com o programa",
  artist_limit: "O artista já tem fã-clubes demais",
  image_rights: "Uso de imagem",
  rules: "Contra as regras",
  other: "Outro motivo",
};

export interface ApplicationHistoryItem {
  round: number;
  decision: "approved" | "rejected";
  reason: RejectReason | null;
  at: Date | null;
}

/** `fanClubApplications/{uid}`: a candidatura, uma por fã (decisão 12). */
export interface FanClubApplication {
  uid: string;
  artistId: string;
  artistName: string;
  status: ApplicationStatus;
  /** 1 a 3; 0 depois do encerramento a pedido (a próxima volta à 1). */
  round: number;
  proposedName: string;
  rulesVersion: string;
  rulesAcceptedAt: Date | null;
  adultDeclared: boolean;
  submittedAt: Date | null;
  /** O `submittedAt` em ms inteiros, como a `decideFanClub` confere a candidatura que a tela mostrou. */
  submittedAtMs: number | null;
  decidedAt: Date | null;
  decidedBy: { uid: string; name: string } | null;
  rejectReason: RejectReason | null;
  canReapplyAt: Date | null;
  clubId: string | null;
  closedByStaff: boolean;
  /** As decisões da equipe, da mais antiga para a mais nova. */
  history: ApplicationHistoryItem[];
  /** As cópias do perfil, para a seção não ler `users/{uid}`. */
  fanName: string | null;
  fanUsername: string | null;
  fanPhotoURL: string | null;
}

/** `fanClubApplicationPrivate/{uid}`: as redes e o texto de divulgação, só para quem edita a seção. */
export interface ApplicationPrivate {
  /** As redes que passam no padrão, prontas para virar link (28.3). */
  socials: FanSocial[];
  /** Sai na aprovação (decisão 14). */
  pitch: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return (list as readonly unknown[]).includes(value) ? (value as T) : null;
}

/** A rodada guardada: inteiro de 0 em diante; estranha vale 0, como o servidor lê. */
function roundOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function personOf(value: unknown): { uid: string; name: string } | null {
  if (!isRecord(value) || typeof value.uid !== "string" || !value.uid) return null;
  return { uid: value.uid, name: text(value.name) };
}

/**
 * Um `Timestamp` em ms inteiros, ou `null`: o `toDate` do SDK do navegador já
 * trunca a fração de ms, que o `toMillis` dele mantém, e o resultado bate com o
 * `toMillis` do Admin SDK, que arredonda para baixo. Nunca o `toMillis` daqui.
 */
function millisOf(value: unknown): number | null {
  const date = toDate(value);
  return date ? Math.floor(date.getTime()) : null;
}

function historyOf(value: unknown): ApplicationHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ApplicationHistoryItem[] => {
    if (!isRecord(item)) return [];
    const decision = item.decision === "approved" || item.decision === "rejected" ? item.decision : null;
    if (!decision) return [];
    return [{ round: roundOf(item.round), decision, reason: oneOf(REJECT_REASONS, item.reason), at: toDate(item.at) }];
  });
}

/** A candidatura lida. O status estranho vale `withdrawn` (nada a decidir), como no servidor. */
export function parseApplication(uid: string, data: Record<string, unknown>): FanClubApplication {
  return {
    uid,
    artistId: text(data.artistId),
    artistName: text(data.artistName),
    status: oneOf(APPLICATION_STATUSES, data.status) ?? "withdrawn",
    round: roundOf(data.round),
    proposedName: text(data.proposedName),
    rulesVersion: text(data.rulesVersion),
    rulesAcceptedAt: toDate(data.rulesAcceptedAt),
    adultDeclared: data.adultDeclared === true,
    submittedAt: toDate(data.submittedAt),
    submittedAtMs: millisOf(data.submittedAt),
    decidedAt: toDate(data.decidedAt),
    decidedBy: personOf(data.decidedBy),
    rejectReason: oneOf(REJECT_REASONS, data.rejectReason),
    canReapplyAt: toDate(data.canReapplyAt),
    clubId: textOrNull(data.clubId),
    closedByStaff: data.closedByStaff === true,
    history: historyOf(data.history),
    fanName: textOrNull(data.fanName),
    fanUsername: textOrNull(data.fanUsername),
    fanPhotoURL: textOrNull(data.fanPhotoURL),
  };
}

/** O privado lido: as redes conferidas de novo antes de virar link (domínio fixo, fora do padrão não aparece). */
export function parseApplicationPrivate(data: Record<string, unknown>): ApplicationPrivate {
  const socials: FanSocial[] = [];
  for (const network of ["instagram", "tiktok"] as const) {
    const handle = data[network];
    const href = socialHref(network, handle);
    if (href && typeof handle === "string") socials.push({ network, handle, href });
  }
  return { socials, pitch: textOrNull(data.pitch) };
}

/** O WhatsApp do contato do fã (`users/{uid}/contact/main`), conferido de novo; fora do formato, `null`. */
export function parseContactWhatsapp(data: Record<string, unknown> | undefined): string | null {
  return isWhatsapp(data?.whatsapp) ? data.whatsapp : null;
}

/** O nome do candidato como a tela mostra: o nome copiado, o @ ou "Fã sem nome". */
export function applicantLabel(application: Pick<FanClubApplication, "fanName" | "fanUsername">): string {
  return application.fanName ?? (application.fanUsername ? `@${application.fanUsername}` : "Fã sem nome");
}

/** "2 de 3", embaixo do rótulo "Rodada". A rodada 0 (depois do encerramento a pedido) não aparece. */
export function roundText(round: number): string | null {
  return round >= 1 ? `${round} de 3` : null;
}

/**
 * Por que o privado não existe mais (34.5): a recusa, a desistência e o
 * encerramento apagam as redes e o texto de divulgação.
 */
export function privateGoneText(application: Pick<FanClubApplication, "status">): string {
  if (application.status === "rejected") return "Saíram na recusa: as redes e o texto não ficam guardados.";
  if (application.status === "withdrawn") return "Saíram quando o fã desistiu da candidatura.";
  if (application.status === "approved") return "Saíram no encerramento do fã-clube.";
  return "Sem redes nem texto.";
}

/** "espera há 3 dias", da candidatura pendente ("chegou agora", "espera desde 2 ago"); sem data, `null`. */
export function waitingText(application: Pick<FanClubApplication, "submittedAt">, now: Date): string | null {
  if (!application.submittedAt) return null;
  const relative = formatRelative(application.submittedAt, now);
  if (relative === "agora") return "chegou agora";
  return relative.startsWith("há ") ? `espera ${relative}` : `espera desde ${relative}`;
}

/** "3 candidaturas em análise". */
export function pendingCountText(total: number): string {
  return countLabel(total, "candidatura em análise", "candidaturas em análise");
}

/** A frase de uma decisão do histórico: "Rodada 1: recusada (Faltam informações)". */
export function historyItemText(item: ApplicationHistoryItem): string {
  const what = item.decision === "approved" ? "aprovada" : `recusada${item.reason ? ` (${REJECT_REASON_LABELS[item.reason]})` : ""}`;
  return item.round >= 1 ? `Rodada ${item.round}: ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
}

/**
 * O que a candidatura diz sobre a próxima, para a ficha: encerrada pela
 * equipe (nunca mais), o prazo da recusa, a 3ª rodada usada. Com a pendente,
 * `null`.
 */
export function reapplyText(application: Pick<FanClubApplication, "status" | "closedByStaff" | "canReapplyAt" | "round">, now: Date): string | null {
  if (application.closedByStaff) return "O fã-clube foi encerrado pela equipe: o fã não se candidata de novo.";
  if (application.status === "pending") return null;
  if (application.canReapplyAt && application.canReapplyAt.getTime() > now.getTime()) {
    return `O fã pode se candidatar de novo a partir de ${formatDay(application.canReapplyAt, now)}.`;
  }
  if (application.status === "rejected" && application.round >= 3) return "As 3 rodadas foram usadas: o fã não se candidata de novo.";
  return null;
}

/**
 * O nome que a equipe confirma ou ajusta na aprovação: limpo e de 3 a 40 numa
 * linha visível, como o servidor confere. A palavra "oficial" e o filtro de
 * termos ficam com o servidor, que recusa com o motivo (`approveErrorMessage`).
 */
export function checkApprovalName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = cleanLine(raw);
  if (!name) return { ok: false, message: "Escreva o nome do fã-clube." };
  if (name.length < FAN_CLUB_NAME_MIN || name.length > FAN_CLUB_NAME_MAX) {
    return { ok: false, message: `Use de ${FAN_CLUB_NAME_MIN} a ${FAN_CLUB_NAME_MAX} caracteres.` };
  }
  if (!isVisibleLine(name)) return { ok: false, message: "Use só letras, números e símbolos visíveis, numa linha." };
  return { ok: true, name };
}

const NAME_PROBLEMS: Record<string, string> = {
  format: `O nome precisa ter de ${FAN_CLUB_NAME_MIN} a ${FAN_CLUB_NAME_MAX} caracteres visíveis, numa linha.`,
  official: "O nome não pode ter a palavra oficial. Ajuste o nome.",
  not_allowed: "O nome tem um termo que o app não aceita. Ajuste o nome.",
};

/**
 * A recusa da aprovação com o fã suspenso (`owner-suspended`): a frase do
 * servidor fala em reativar o fã-clube, que é o outro caso do mesmo motivo, e
 * aqui o fã-clube ainda não existe.
 */
export const APPROVE_SUSPENDED_TEXT = "O fã está suspenso. Tire a suspensão na Moderação antes de aprovar.";

/**
 * O nome recusado pelo servidor na aprovação (34.22): `invalid-request` com
 * `field: 'name'` e o motivo em `details.problem`. Também o proposto pelo fã,
 * quando a lista do filtro mudou desde a candidatura: aí a equipe ajusta.
 * Fora desse caso, `null` (a frase de sempre).
 */
export function approveNameProblem(failure: unknown): string | null {
  if (readError(failure).reason !== "invalid-request") return null;
  const details = errorDetails(failure);
  if (details.field !== "name") return null;
  return NAME_PROBLEMS[typeof details.problem === "string" ? details.problem : "format"] ?? NAME_PROBLEMS.format;
}

// ---------------------------------------------------------------------------
// Fã-clube
// ---------------------------------------------------------------------------

export const FAN_CLUB_STATUSES = ["active", "paused", "closed"] as const;
export type FanClubStatus = (typeof FAN_CLUB_STATUSES)[number];

export const FAN_CLUB_STATUS_LABELS: Record<FanClubStatus, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
};

/** O filtro da lista dos fã-clubes. */
export const FAN_CLUB_FILTER_LABELS: Record<FanClubStatus, string> = {
  active: "Ativos",
  paused: "Pausados",
  closed: "Encerrados",
};

/** "1 fã-clube ativo", "3 fã-clubes pausados". */
export function fanClubCountText(total: number, status: FanClubStatus): string {
  const one = FAN_CLUB_STATUS_LABELS[status].toLowerCase();
  return countLabel(total, `fã-clube ${one}`, `fã-clubes ${FAN_CLUB_FILTER_LABELS[status].toLowerCase()}`);
}

export const STATUS_REASONS = ["staff", "owner_request", "suspended", "account_deleted"] as const;
export type FanClubStatusReason = (typeof STATUS_REASONS)[number];

/** Por que o fã-clube está pausado ou encerrado. */
export const STATUS_REASON_LABELS: Record<FanClubStatusReason, string> = {
  staff: "pela equipe",
  owner_request: "a pedido do gestor",
  suspended: "porque o gestor foi suspenso",
  account_deleted: "porque o gestor excluiu a conta",
};

/** Quem pediu o encerramento (decisão 13): a equipe (o padrão) ou o gestor. */
export const CLOSE_REASONS = ["staff", "owner_request"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  staff: "Decisão da equipe",
  owner_request: "A pedido do gestor",
};

export const CLOSE_REASON_HINTS: Record<CloseReason, string> = {
  staff: "O fã nunca mais se candidata a um fã-clube.",
  owner_request: "O fã pode se candidatar de novo depois de 30 dias, numa rodada 1 nova, para o mesmo ou outro artista.",
};

/**
 * A cópia da noite (`counts`, decisão 37): os seguidores e os sinais pelo
 * `count()`, os trazidos que ficaram e a soma dos shards, com a hora da cópia.
 * O fã-clube aprovado nasce com tudo em 0 e `at: null`, até a primeira cópia.
 */
export interface FanClubCounts {
  followers: number;
  followers30d: number;
  newAccounts: number;
  automaticUsername: number;
  byOwnerCode: number;
  joins: number;
  retained: number;
  signups: number;
  visits: number;
  links: number;
  /** A hora da cópia; `null` até a primeira. */
  at: Date | null;
}

const COUNT_FIELDS = ["followers", "followers30d", "newAccounts", "automaticUsername", "byOwnerCode", "joins", "retained", "signups", "visits", "links"] as const;

/** Os números do retrato de um mês (`monthStart` e `lastMonth`, 34.4). */
export const MONTH_FIELDS = ["followers", "joins", "signups", "visits", "links"] as const;
export type MonthField = (typeof MONTH_FIELDS)[number];

/** O retrato de um mês: o `AAAA-MM` e os números. Os seguidores do mês passado são o saldo e podem sair negativos. */
export interface FanClubMonth {
  month: string;
  numbers: Record<MonthField, number>;
}

/** O último reconhecimento (`lastReward`): a data, os pontos e se teve prêmio. */
export interface LastReward {
  at: Date | null;
  points: number | null;
  prize: boolean;
}

/** `fanClubs/{clubId}`, o que a seção mostra. */
export interface FanClub {
  id: string;
  artistId: string;
  artistName: string;
  /** `null` na lápide (o gestor excluiu a conta, decisão 21). */
  ownerUid: string | null;
  ownerName: string | null;
  ownerUsername: string | null;
  ownerPhotoURL: string | null;
  /** `null` na lápide. */
  name: string | null;
  status: FanClubStatus;
  statusReason: FanClubStatusReason | null;
  accountDeleted: boolean;
  applicationRound: number;
  approvedAt: Date | null;
  approvedBy: { uid: string; name: string } | null;
  pausedAt: Date | null;
  closedAt: Date | null;
  closedBy: { uid: string; name: string } | null;
  /** As publicações no ar e em análise (o teto de 3), e a data da última aprovada. */
  postCount: number;
  pendingPosts: number;
  lastPostAt: Date | null;
  /** A cópia da noite; `null` sem o campo (o documento mexido à mão). */
  counts: FanClubCounts | null;
  monthStart: FanClubMonth | null;
  lastMonth: FanClubMonth | null;
  /** O Destaque marcado e o fim (`AAAA-MM-DD`); vale só com o fim de hoje em diante (`isFeaturedNow`). */
  featured: boolean;
  featuredAt: Date | null;
  featuredUntil: string | null;
  featuredBy: { uid: string; name: string } | null;
  lastReward: LastReward | null;
  /** O selo do fã-clube oficial (34.23), que só o admin dá e tira; a pausa mantém, e o encerramento tira. */
  official: boolean;
  officialAt: Date | null;
  officialBy: { uid: string; name: string } | null;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Um número da cópia: o inteiro guardado (o saldo do mês pode ser negativo); estranho vale 0. */
function integerOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function countsOf(value: unknown): FanClubCounts | null {
  if (!isRecord(value)) return null;
  const counts = { at: toDate(value.at) } as FanClubCounts;
  for (const field of COUNT_FIELDS) counts[field] = countOf(value[field]);
  return counts;
}

function monthOf(value: unknown): FanClubMonth | null {
  if (!isRecord(value) || typeof value.month !== "string" || !MONTH_PATTERN.test(value.month)) return null;
  const numbers = {} as Record<MonthField, number>;
  for (const field of MONTH_FIELDS) numbers[field] = integerOf(value[field]);
  return { month: value.month, numbers };
}

function lastRewardOf(value: unknown): LastReward | null {
  if (!isRecord(value)) return null;
  return { at: toDate(value.at), points: typeof value.points === "number" && value.points > 0 ? countOf(value.points) : null, prize: value.prize === true };
}

/**
 * O fã-clube lido. O status estranho vale `closed` (nada a pausar nem
 * reativar), e o documento sem o `official` vale sem o selo, como no servidor.
 */
export function parseFanClub(id: string, data: Record<string, unknown>): FanClub {
  return {
    id,
    artistId: text(data.artistId),
    artistName: text(data.artistName),
    ownerUid: textOrNull(data.ownerUid),
    ownerName: textOrNull(data.ownerName),
    ownerUsername: textOrNull(data.ownerUsername),
    ownerPhotoURL: textOrNull(data.ownerPhotoURL),
    name: textOrNull(data.name),
    status: oneOf(FAN_CLUB_STATUSES, data.status) ?? "closed",
    statusReason: oneOf(STATUS_REASONS, data.statusReason),
    accountDeleted: data.accountDeleted === true,
    applicationRound: countOf(data.applicationRound),
    approvedAt: toDate(data.approvedAt),
    approvedBy: personOf(data.approvedBy),
    pausedAt: toDate(data.pausedAt),
    closedAt: toDate(data.closedAt),
    closedBy: personOf(data.closedBy),
    postCount: countOf(data.postCount),
    pendingPosts: countOf(data.pendingPosts),
    lastPostAt: toDate(data.lastPostAt),
    counts: countsOf(data.counts),
    monthStart: monthOf(data.monthStart),
    lastMonth: monthOf(data.lastMonth),
    featured: data.featured === true,
    featuredAt: toDate(data.featuredAt),
    featuredUntil: typeof data.featuredUntil === "string" && DAY_PATTERN.test(data.featuredUntil) ? data.featuredUntil : null,
    featuredBy: personOf(data.featuredBy),
    lastReward: lastRewardOf(data.lastReward),
    official: data.official === true,
    officialAt: toDate(data.officialAt),
    officialBy: personOf(data.officialBy),
  };
}

/** O nome do fã-clube como a tela mostra; a lápide fica sem nome. */
export function fanClubLabel(club: Pick<FanClub, "name" | "accountDeleted">): string {
  return club.name ?? (club.accountDeleted ? "Fã-clube de conta excluída" : "Fã-clube sem nome");
}

/** O gestor como a tela mostra: o nome copiado, o @ ou a conta que saiu. */
export function ownerLabel(club: Pick<FanClub, "ownerName" | "ownerUsername" | "ownerUid">): string {
  if (club.ownerName) return club.ownerName;
  if (club.ownerUsername) return `@${club.ownerUsername}`;
  return club.ownerUid ? "Fã sem nome" : "Conta excluída";
}

/** "Pausado pela equipe", "Encerrado a pedido do gestor"; o ativo, só "Ativo". */
export function fanClubStatusText(club: Pick<FanClub, "status" | "statusReason">): string {
  const label = FAN_CLUB_STATUS_LABELS[club.status];
  if (club.status === "active" || !club.statusReason) return label;
  return `${label} ${STATUS_REASON_LABELS[club.statusReason]}`;
}

export type ClubDecision = "pause" | "resume" | "close" | "officialize" | "unofficialize";

/**
 * As decisões que cabem no fã-clube agora (34.5 e 34.23): pausar o ativo,
 * reativar o pausado (o servidor recusa o gestor suspenso e o artista
 * fechado), encerrar o ativo ou o pausado, oficializar o ativo sem o selo e
 * tirar o selo em qualquer status; as três últimas, só o admin
 * (`admin-only`). O gestor da equipe não decide o próprio fã-clube (`self`),
 * nem o Leitor.
 */
export function clubDecisions(club: Pick<FanClub, "status" | "ownerUid" | "official">, viewer: { uid: string; canEdit: boolean; admin: boolean }): ClubDecision[] {
  if (!viewer.canEdit || (club.ownerUid !== null && club.ownerUid === viewer.uid)) return [];
  const decisions: ClubDecision[] = [];
  if (club.status === "active") decisions.push("pause");
  if (club.status === "paused" && club.ownerUid !== null) decisions.push("resume");
  if (club.status !== "closed" && viewer.admin) decisions.push("close");
  if (club.status === "active" && !club.official && viewer.admin) decisions.push("officialize");
  if (club.official && viewer.admin) decisions.push("unofficialize");
  return decisions;
}

export const PAUSE_TEXT = "O fã-clube sai do app para os fãs, e o gestor não publica até a equipe reativar.";
export const RESUME_TEXT = "O fã-clube volta ao app para os fãs. O servidor recusa se o gestor estiver suspenso ou o artista não aceitar fã-clubes.";

export const OFFICIALIZE_TEXT = "O fã-clube ganha o selo de oficial ao lado do nome em todas as telas do app. Combine com o artista antes: o selo fala em nome dele e da Imagine.";

/** O texto da confirmação de tirar o selo, pelo status: só o ativo está no ar para os fãs. */
export function unofficializeText(status: FanClubStatus): string {
  if (status === "active") return "O selo sai do app na hora. O fã-clube continua no ar.";
  if (status === "paused") return "O fã-clube fica sem o selo e, quando for reativado, volta ao app sem ele.";
  return "O fã-clube fica sem o selo.";
}

const GRAPHEMES = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("pt-BR", { granularity: "grapheme" }) : null;

/**
 * Onde começa o último caractere visível do nome (o emoji com ZWJ, a bandeira
 * e a letra com acento contam como um): o selo de oficial fica preso a ele
 * sem tirar as quebras do resto do nome, nos espaços e nos hífens. Sem o
 * `Intl.Segmenter` (o Firefox antes do 125), o último code point.
 */
export function lastCharStart(text: string): number {
  if (!GRAPHEMES) return text.length - (Array.from(text).at(-1)?.length ?? 0);
  let start = 0;
  for (const { index } of GRAPHEMES.segment(text)) start = index;
  return start;
}

/** "Oficial desde 26 out, por Iara" (34.23); sem o selo, `null`. */
export function officialText(club: Pick<FanClub, "official" | "officialAt" | "officialBy">, now: Date): string | null {
  if (!club.official) return null;
  const since = club.officialAt ? ` desde ${formatDay(club.officialAt, now)}` : "";
  return `Oficial${since}${club.officialBy?.name ? `, por ${club.officialBy.name}` : ""}`;
}

/** O texto da confirmação de encerrar, pelo motivo escolhido. */
export function closeText(reason: CloseReason): string {
  return `O fã-clube sai do app de vez e não volta. ${CLOSE_REASON_HINTS[reason]}`;
}

/** A recusa que outra tentativa repetiria: o estado mudou desde que a tela abriu. */
export function isStaleDecision(failure: unknown): boolean {
  return readError(failure).reason === "stale-decision";
}

/**
 * As recusas da ficha que tiram o botão de confirmar: o `stale-decision` e o
 * `admin-only`, quando a pessoa deixa de ser admin com o Encerrar ou o selo
 * aberto (o papel chega em tempo real, e só essas três decisões recebem essa
 * recusa). Outra tentativa repetiria a mesma frase.
 */
export function blocksDecisionRetry(failure: unknown): boolean {
  const reason = readError(failure).reason;
  return reason === "stale-decision" || reason === "admin-only";
}

// ---------------------------------------------------------------------------
// A lista dos fã-clubes (decisão 36: só colunas que dá para ordenar)
// ---------------------------------------------------------------------------

/** A ordem da lista, cada uma com um índice de 34.6. */
export const FAN_CLUB_ORDERS = ["followers", "followers30d", "approved"] as const;
export type FanClubOrder = (typeof FAN_CLUB_ORDERS)[number];

export const FAN_CLUB_ORDER_LABELS: Record<FanClubOrder, string> = {
  followers: "Mais seguidores",
  followers30d: "Mais novos em 30 dias",
  approved: "Aprovação mais nova",
};

/** O campo de cada ordem, sempre decrescente. */
export const FAN_CLUB_ORDER_FIELDS: Record<FanClubOrder, string> = {
  followers: "counts.followers",
  followers30d: "counts.followers30d",
  approved: "approvedAt",
};

/** "atualizado em 20 out", a hora da cópia da noite; sem ela, "sem cópia ainda". */
export function countsAtText(counts: Pick<FanClubCounts, "at"> | null, now: Date): string {
  return counts?.at ? `atualizado em ${formatDay(counts.at, now)}` : "sem cópia ainda";
}

/** "3 de 5": os trazidos que ficaram na central sobre as entradas trazidas (a cópia da noite). */
export function retainedText(counts: Pick<FanClubCounts, "retained" | "joins">): string {
  return `${formatNumber(counts.retained)} de ${formatNumber(counts.joins)}`;
}

/** "+200 pts e prêmio, 20 out"; sem reconhecimento, `null`. */
export function lastRewardText(reward: LastReward | null, now: Date): string | null {
  if (!reward) return null;
  const parts = [reward.points !== null ? `+${formatNumber(reward.points)} pts` : null, reward.prize ? "prêmio" : null].filter(Boolean);
  const what = parts.length > 0 ? joinPt(parts as string[]) : "Reconhecimento";
  const head = what.charAt(0).toUpperCase() + what.slice(1);
  return reward.at ? `${head}, ${formatDay(reward.at, now)}` : head;
}

// ---------------------------------------------------------------------------
// O Destaque (decisão 35)
// ---------------------------------------------------------------------------

/** O fim do Destaque vai de amanhã a 31 dias, no dia de São Paulo, e cada artista tem até 3 ao mesmo tempo. */
export const FEATURE_DAYS_MAX = 31;
export const FEATURED_PER_ARTIST_MAX = 3;
/** O fim que o diálogo sugere: daqui a 30 dias. */
export const FEATURE_DEFAULT_DAYS = 30;

/** O Destaque vale hoje: marcado e com o fim de hoje em diante (o `isFeaturedNow` do servidor). */
export function isFeaturedNow(club: Pick<FanClub, "featured" | "featuredUntil">, now: number): boolean {
  return club.featured && club.featuredUntil !== null && club.featuredUntil >= dayKey(now);
}

/** "Destaque até 12 nov"; vencido (a cópia da noite ainda não desligou), "Destaque vencido em 2 out"; sem, `null`. */
export function featuredText(club: Pick<FanClub, "featured" | "featuredUntil">, now: number): string | null {
  if (!club.featured || !club.featuredUntil) return null;
  const until = formatDay(club.featuredUntil, new Date(now));
  return isFeaturedNow(club, now) ? `Destaque até ${until}` : `Destaque vencido em ${until}`;
}

/** O primeiro e o último fim que o servidor aceita (`AAAA-MM-DD`), de amanhã a 31 dias. */
export function featureRange(now: number): { min: string; max: string } {
  const today = dayKey(now);
  return { min: shiftDay(today, 1), max: shiftDay(today, FEATURE_DAYS_MAX) };
}

/** O fim sugerido: o de agora, se ainda cabe no prazo; senão, daqui a 30 dias. */
export function defaultFeaturedUntil(club: Pick<FanClub, "featured" | "featuredUntil">, now: number): string {
  const range = featureRange(now);
  if (club.featured && club.featuredUntil && club.featuredUntil >= range.min && club.featuredUntil <= range.max) return club.featuredUntil;
  return shiftDay(dayKey(now), FEATURE_DEFAULT_DAYS);
}

/** O fim escolhido, como o `parseFeaturedUntil` do servidor confere. */
export function checkFeaturedUntil(value: string, now: number): { ok: true; day: string } | { ok: false; message: string } {
  const range = featureRange(now);
  const message = `Escolha um dia de ${formatDay(range.min, new Date(now))} a ${formatDay(range.max, new Date(now))}.`;
  if (!DAY_PATTERN.test(value) || shiftDay(value, 0) !== value) return { ok: false, message };
  if (value < range.min || value > range.max) return { ok: false, message };
  return { ok: true, day: value };
}

export const UNFEATURE_TEXT = "O selo Destaque sai da página do fã-clube e da lista do artista. Dá para destacar de novo depois.";

// ---------------------------------------------------------------------------
// Publicações (decisões 15 a 20)
// ---------------------------------------------------------------------------

export const POST_STATUSES = ["pending", "published", "rejected", "withdrawn", "hidden", "removed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Os nomes de cada status, os mesmos do "Minhas publicações" do app. */
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  pending: "Em análise",
  published: "No ar",
  rejected: "Recusada",
  withdrawn: "Retirada pelo gestor",
  hidden: "Oculta pela equipe",
  removed: "Tirada do ar pelo gestor",
};

/** Os motivos da recusa (34.3), na ordem do servidor. O gestor vê uma frase fixa por motivo no app. */
export const POST_REJECT_REASONS = ["image_rights", "off_topic", "quality", "rules", "other"] as const;
export type PostRejectReason = (typeof POST_REJECT_REASONS)[number];

export const POST_REJECT_REASON_LABELS: Record<PostRejectReason, string> = {
  image_rights: "Uso de imagem sem autorização",
  off_topic: "Fora do assunto do artista",
  quality: "A foto ou o texto não estão bons para ir ao ar",
  rules: "Contra as regras do fã-clube",
  other: "Outro motivo",
};

export interface PostImage {
  url: string;
  path: string;
  width: number;
  height: number;
}

/** `fanClubPosts/{postId}`: a publicação do gestor, fora do Mural oficial (decisão 17). */
export interface FanClubPost {
  id: string;
  clubId: string;
  artistId: string;
  authorUid: string;
  authorName: string | null;
  authorUsername: string | null;
  authorPhotoURL: string | null;
  kind: "text" | "photo";
  text: string;
  /** A foto (1080 por 1350) e a miniatura (480 por 600), que vão ao ar as duas. */
  media: { photo: PostImage; thumb: PostImage } | null;
  status: PostStatus;
  rejectReason: PostRejectReason | null;
  submittedAt: Date | null;
  publishedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: { uid: string; name: string } | null;
  /** As reações e os comentários que aparecem aos fãs (37.2); a publicação de antes da Fase 2 e a em análise não têm, e valem 0. */
  reactionCount: number;
  reactionCounts: Record<Reaction, number>;
  commentCount: number;
  /** Os marcados no texto do gestor, sem repetir o mesmo `id` (37.7). */
  mentions: Mention[];
}

/** As cinco reações (37.1, R2), na ordem do app. */
export const REACTIONS = ["heart", "fire", "laugh", "wow", "clap"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const REACTION_EMOJIS: Record<Reaction, string> = { heart: "❤️", fire: "🔥", laugh: "😂", wow: "😮", clap: "👏" };

/** O nome de cada emoji, escrito ao lado dele: o leitor de tela não ouve o emoji (a tela o esconde). */
export const REACTION_LABELS: Record<Reaction, string> = { heart: "coração", fire: "fogo", laugh: "risada", wow: "espanto", clap: "aplauso" };

/** Um marcado (`mentions`): o @ como foi escrito, um fã ou uma central, e o id resolvido no envio. */
export interface Mention {
  handle: string;
  kind: "fan" | "artist";
  id: string;
}

export const MENTION_KIND_LABELS: Record<Mention["kind"], string> = { fan: "fã", artist: "central" };

function mentionsOf(value: unknown): Mention[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.handle !== "string" || !item.handle || typeof item.id !== "string" || !item.id) continue;
    const kind = item.kind === "fan" || item.kind === "artist" ? item.kind : null;
    if (!kind || seen.has(`${kind}:${item.id}`)) continue;
    seen.add(`${kind}:${item.id}`);
    mentions.push({ handle: item.handle.replace(/^@/, ""), kind, id: item.id });
  }
  return mentions;
}

function reactionCountsOf(value: unknown): Record<Reaction, number> {
  const raw = isRecord(value) ? value : {};
  const counts = {} as Record<Reaction, number>;
  for (const reaction of REACTIONS) counts[reaction] = countOf(raw[reaction]);
  return counts;
}

function imageOf(value: unknown): PostImage | null {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.path !== "string" || !value.path) return null;
  return { url: value.url, path: value.path, width: countOf(value.width), height: countOf(value.height) };
}

/** A publicação lida. O status estranho vale `removed` (nada a decidir), como no servidor. */
export function parsePost(id: string, data: Record<string, unknown>): FanClubPost {
  const raw = isRecord(data.media) ? data.media : null;
  const photo = raw ? imageOf(raw.photo) : null;
  const thumb = raw ? imageOf(raw.thumb) : null;
  const media = photo && thumb ? { photo, thumb } : null;
  return {
    id,
    clubId: text(data.clubId),
    artistId: text(data.artistId),
    authorUid: text(data.authorUid),
    authorName: textOrNull(data.authorName),
    authorUsername: textOrNull(data.authorUsername),
    authorPhotoURL: textOrNull(data.authorPhotoURL),
    kind: media ? "photo" : "text",
    text: text(data.text),
    media,
    status: oneOf(POST_STATUSES, data.status) ?? "removed",
    rejectReason: oneOf(POST_REJECT_REASONS, data.rejectReason),
    submittedAt: toDate(data.submittedAt),
    publishedAt: toDate(data.publishedAt),
    reviewedAt: toDate(data.reviewedAt),
    reviewedBy: personOf(data.reviewedBy),
    reactionCount: countOf(data.reactionCount),
    reactionCounts: reactionCountsOf(data.reactionCounts),
    commentCount: countOf(data.commentCount),
    mentions: mentionsOf(data.mentions),
  };
}

/**
 * A publicação que já foi ao ar, e por isso tem reações e comentários: a no
 * ar, a oculta pela equipe e a tirada do ar. A em análise, a recusada e a
 * retirada nunca foram vistas pelos fãs, e não mostram totais.
 */
export function postWasPublished(post: Pick<FanClubPost, "status">): boolean {
  return post.status === "published" || post.status === "hidden" || post.status === "removed";
}

/** Cada emoji com o número, só os maiores que 0, na ordem do app. */
export function reactionBreakdown(counts: Record<Reaction, number>): { reaction: Reaction; count: number; emoji: string; label: string }[] {
  return REACTIONS.filter((reaction) => counts[reaction] > 0).map((reaction) => ({ reaction, count: counts[reaction], emoji: REACTION_EMOJIS[reaction], label: REACTION_LABELS[reaction] }));
}

/** "3 reações", "1 reação". */
export function reactionCountText(total: number): string {
  return countLabel(total, "reação", "reações");
}

/** "4 comentários", "1 comentário". */
export function commentCountText(total: number): string {
  return countLabel(total, "comentário", "comentários");
}

/** O autor como a tela mostra: o nome copiado, o @ ou a conta que saiu. */
export function authorLabel(post: Pick<FanClubPost, "authorName" | "authorUsername">): string {
  return post.authorName ?? (post.authorUsername ? `@${post.authorUsername}` : "Gestor sem nome");
}

export type PostDecision = "approve" | "reject" | "hide" | "restore";

/**
 * As decisões que cabem na publicação agora (34.5): aprovar e recusar a em
 * análise (a fila de revisão), ocultar a no ar e reexibir a oculta. O autor
 * não decide a própria (`self`), nem o Leitor.
 */
export function postDecisions(post: Pick<FanClubPost, "status" | "authorUid">, viewer: { uid: string; canEdit: boolean }): PostDecision[] {
  if (!viewer.canEdit || post.authorUid === viewer.uid) return [];
  if (post.status === "pending") return ["approve", "reject"];
  if (post.status === "published") return ["hide"];
  if (post.status === "hidden") return ["restore"];
  return [];
}

/**
 * De onde vêm as fotos agora: a URL guardada vale na em análise e na no ar; a
 * oculta e a tirada do ar trocaram o token (a URL guardada não abre mais), e o
 * painel lê pelo caminho, com o SDK do Storage (a regra dá a leitura à seção,
 * 34.22); a recusada e a retirada perderam os arquivos.
 */
export function postMediaSource(post: Pick<FanClubPost, "status" | "media">): "stored" | "path" | "gone" | "none" {
  if (!post.media) return "none";
  if (post.status === "pending" || post.status === "published") return "stored";
  if (post.status === "hidden" || post.status === "removed") return "path";
  return "gone";
}

/** Por que a publicação ficou sem as fotos (a recusa e a retirada apagam os arquivos). */
export function mediaGoneText(post: Pick<FanClubPost, "status">): string {
  return post.status === "rejected" ? "As fotos saíram na recusa." : "As fotos saíram quando o gestor retirou a publicação.";
}

/** "3 publicações em análise". */
export function pendingPostsCountText(total: number): string {
  return countLabel(total, "publicação em análise", "publicações em análise");
}

export const APPROVE_POST_TEXT = "A publicação vai ao ar na página do fã-clube e na Início de quem segue.";
export const HIDE_POST_TEXT = "A publicação sai do app para todos, e as fotos deixam de abrir pelo endereço antigo. A equipe continua vendo as fotos aqui. Dá para reexibir depois.";
export const RESTORE_POST_TEXT = "A publicação volta ao app, no lugar dela na lista do fã-clube.";

// ---------------------------------------------------------------------------
// Denúncias (decisão 18)
// ---------------------------------------------------------------------------

/** Os motivos da denúncia de publicação de fã-clube: os 4 de sempre, o de imagem e a denúncia sem motivo. */
export const REPORT_REASONS = ["spam", "offensive", "harassment", "image_misuse", "other", "none"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  offensive: "Ofensivo",
  harassment: "Assédio",
  image_misuse: "Uso indevido de imagem",
  other: "Outro",
  none: "Sem motivo",
};

export const REPORT_STATUSES = ["open", "resolved"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_FILTER_LABELS: Record<ReportStatus, string> = { open: "Abertas", resolved: "Resolvidas" };

export const REPORT_RESOLUTIONS = ["kept", "actioned", "withdrawn", "author_deleted"] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

export const REPORT_RESOLUTION_LABELS: Record<ReportResolution, string> = {
  kept: "Mantida",
  actioned: "Ocultada",
  // Também quando todas as denúncias da rodada saem com a conta de quem denunciou.
  withdrawn: "Encerrada sem decisão da equipe",
  author_deleted: "O gestor excluiu a conta",
};

/** `fanClubReportQueue/{postId}`: o item da fila, um por publicação, com a rodada (no molde da `profileReportQueue`). */
export interface FanClubReport {
  postId: string;
  clubId: string;
  artistId: string;
  authorUid: string;
  reportCount: number;
  reasons: Record<ReportReason, number>;
  status: ReportStatus;
  resolution: ReportResolution | null;
  /** A rodada que a decisão manda como `expected`. */
  round: number;
  openedAt: Date | null;
  firstReportedAt: Date | null;
  lastReportedAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: { uid: string; name: string } | null;
}

/** O item da fila lido. O status estranho vale `resolved` (nada a decidir). */
export function parseReport(id: string, data: Record<string, unknown>): FanClubReport {
  const raw = isRecord(data.reasons) ? data.reasons : {};
  const reasons = {} as Record<ReportReason, number>;
  for (const reason of REPORT_REASONS) reasons[reason] = countOf(raw[reason]);
  return {
    postId: id,
    clubId: text(data.clubId),
    artistId: text(data.artistId),
    authorUid: text(data.authorUid),
    reportCount: countOf(data.reportCount),
    reasons,
    status: data.status === "open" ? "open" : "resolved",
    resolution: oneOf(REPORT_RESOLUTIONS, data.resolution),
    round: countOf(data.round),
    openedAt: toDate(data.openedAt),
    firstReportedAt: toDate(data.firstReportedAt),
    lastReportedAt: toDate(data.lastReportedAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: personOf(data.resolvedBy),
  };
}

/** A contagem por motivo, dos mais citados: "2 Uso indevido de imagem, 1 Spam". */
export function reportReasonsText(reasons: Record<ReportReason, number>): string {
  const parts = REPORT_REASONS.filter((reason) => reasons[reason] > 0)
    .sort((a, b) => reasons[b] - reasons[a])
    .map((reason) => `${formatNumber(reasons[reason])} ${REPORT_REASON_LABELS[reason]}`);
  return parts.length > 0 ? parts.join(", ") : "Sem contagem por motivo";
}

export type ReportDecision = "keep" | "action";

/**
 * Manter e Ocultar na denúncia aberta; na resolvida pela equipe, a decisão
 * contrária da mesma rodada, que o servidor aceita (no molde do
 * `profileDecisions`). A encerrada sem decisão da equipe fica sem botões. O
 * autor não decide a da própria publicação (`self`), nem o Leitor.
 */
export function reportDecisions(item: Pick<FanClubReport, "status" | "resolution" | "authorUid">, viewer: { uid: string; canEdit: boolean }): ReportDecision[] {
  if (!viewer.canEdit || item.authorUid === viewer.uid) return [];
  if (item.status === "open") return ["keep", "action"];
  if (item.resolution === "kept") return ["action"];
  if (item.resolution === "actioned") return ["keep"];
  return [];
}

/** "3 denúncias abertas". */
export function openReportsCountText(total: number): string {
  return countLabel(total, "denúncia aberta", "denúncias abertas");
}

export const KEEP_REPORT_TEXT = "A publicação continua no ar e sai da fila. Uma denúncia nova abre a rodada seguinte.";
export const ACTION_REPORT_TEXT = "A publicação sai do app para todos, e as fotos deixam de abrir pelo endereço antigo. A denúncia sai da fila. Dá para reexibir na ficha do fã-clube.";

/** A publicação da denúncia como a tela a leu: `null` quando não existe mais; `"unknown"` quando a leitura falhou. */
export type ReportPostState = Pick<FanClubPost, "status"> | null | "unknown";

function reportPostStatus(post: ReportPostState): PostStatus | "unknown" | null {
  return post === "unknown" ? "unknown" : (post?.status ?? null);
}

/**
 * O texto da confirmação pelo que o servidor vai fazer: Ocultar só tira do
 * ar a publicação que está no ar, e Manter nunca reexibe (34.22). Sem a
 * publicação lida, o texto não promete nada sobre ela.
 */
export function reportDecisionText(item: Pick<FanClubReport, "status">, post: ReportPostState, decision: ReportDecision): string {
  const open = item.status === "open";
  const status = reportPostStatus(post);
  if (decision === "action") {
    if (status === "published") return open ? ACTION_REPORT_TEXT : "A publicação sai do app para todos, e as fotos deixam de abrir pelo endereço antigo. A decisão passa de Mantida para Ocultada. Dá para reexibir na ficha do fã-clube.";
    if (status === "unknown") return open ? "A publicação não carregou: se ainda estiver no ar, ela sai do app para todos. A denúncia sai da fila." : "A publicação não carregou: se ainda estiver no ar, ela sai do app para todos. A decisão passa de Mantida para Ocultada.";
    return open ? "A publicação já não está no ar: a denúncia só sai da fila." : "A publicação já não está no ar: só a decisão passa de Mantida para Ocultada.";
  }
  if (!open) return status === "published" ? "A publicação segue no ar, e a decisão passa de Ocultada para Mantida." : "A decisão passa de Ocultada para Mantida, mas a publicação não volta ao ar. Para reexibir, use a ficha do fã-clube.";
  if (status === "published") return KEEP_REPORT_TEXT;
  if (status === "hidden") return "A publicação continua oculta, porque Manter não reexibe, e a denúncia sai da fila. Para reexibir, use a ficha do fã-clube.";
  if (status === "unknown") return "A publicação não carregou: ela fica como está, e a denúncia sai da fila. Manter não reexibe uma publicação oculta.";
  return "A publicação já não está no ar: a denúncia só sai da fila.";
}

/** O aviso depois da decisão, pelo mesmo estado da publicação que a confirmação mostrou. */
export function reportDoneText(item: Pick<FanClubReport, "status">, post: ReportPostState, decision: ReportDecision, author: string): string {
  const status = reportPostStatus(post);
  const head = item.status === "open" ? "Denúncia resolvida" : "Decisão trocada";
  if (decision === "action") {
    if (status === "published") return `${head}: a publicação de ${author} saiu do ar.`;
    if (status === "unknown") return `${head}: a denúncia ficou como Ocultada.`;
    return `${head}: a publicação já não estava no ar.`;
  }
  return status === "published" ? `${head}: a publicação de ${author} segue no ar.` : `${head}: a denúncia ficou como Mantida, e a publicação segue como está.`;
}

// ---------------------------------------------------------------------------
// Comentários (seção 37: 37.2, 37.6 e 37.10)
// ---------------------------------------------------------------------------

export const COMMENT_STATUSES = ["visible", "manager_hidden", "staff_hidden"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = {
  visible: "Visível",
  manager_hidden: "Oculto pelo gestor",
  staff_hidden: "Oculto pela equipe",
};

/**
 * `fanClubComments/{commentId}`: o comentário, que vai ao ar na hora pelo
 * filtro de texto. O gestor oculta (`manager_hidden`, que o autor ainda vê),
 * e a equipe oculta para todos (`staff_hidden`) ou reexibe. A marca "Gestor"
 * não está gravada: é o `authorUid` igual ao `ownerUid` do fã-clube.
 */
export interface FanClubComment {
  id: string;
  clubId: string;
  postId: string;
  artistId: string;
  authorUid: string;
  authorName: string | null;
  authorUsername: string | null;
  authorPhotoURL: string | null;
  text: string;
  /** O comentário de cima, na resposta; `null` no de cima. */
  replyToId: string | null;
  /** No de cima: as respostas visíveis. */
  replyCount: number;
  status: CommentStatus;
  hiddenAt: Date | null;
  restoredByStaffAt: Date | null;
  reviewRequestedAt: Date | null;
  reviewOutcome: "kept" | null;
  createdAt: Date | null;
}

/** O comentário lido. O status estranho vale `staff_hidden` (não aparece para ninguém), como no servidor. */
export function parseComment(id: string, data: Record<string, unknown>): FanClubComment {
  return {
    id,
    clubId: text(data.clubId),
    postId: text(data.postId),
    artistId: text(data.artistId),
    authorUid: text(data.authorUid),
    authorName: textOrNull(data.authorName),
    authorUsername: textOrNull(data.authorUsername),
    authorPhotoURL: textOrNull(data.authorPhotoURL),
    text: text(data.text),
    replyToId: textOrNull(data.replyToId),
    replyCount: countOf(data.replyCount),
    status: oneOf(COMMENT_STATUSES, data.status) ?? "staff_hidden",
    hiddenAt: toDate(data.hiddenAt),
    restoredByStaffAt: toDate(data.restoredByStaffAt),
    reviewRequestedAt: toDate(data.reviewRequestedAt),
    reviewOutcome: data.reviewOutcome === "kept" ? "kept" : null,
    createdAt: toDate(data.createdAt),
  };
}

/** O autor do comentário como a tela mostra: o nome copiado, o @ ou "Fã sem nome". */
export function commentAuthorLabel(comment: Pick<FanClubComment, "authorName" | "authorUsername">): string {
  return comment.authorName ?? (comment.authorUsername ? `@${comment.authorUsername}` : "Fã sem nome");
}

/** O autor é o gestor do fã-clube (decisão 19 de 37.1): a marca é calculada na leitura. */
export function isManagerComment(comment: Pick<FanClubComment, "authorUid">, ownerUid: string | null | undefined): boolean {
  return Boolean(ownerUid) && comment.authorUid === ownerUid;
}

function dayTime(date: Date, now: Date): string {
  return `${formatDay(date, now)}, ${formatTime(date)}`;
}

/** "Visível", "Oculto pelo gestor em 27 out, 10:00", "Oculto pela equipe em 27 out, 11:00". */
export function commentStatusText(comment: Pick<FanClubComment, "status" | "hiddenAt">, now: Date): string {
  const label = COMMENT_STATUS_LABELS[comment.status];
  return comment.status !== "visible" && comment.hiddenAt ? `${label} em ${dayTime(comment.hiddenAt, now)}` : label;
}

/**
 * As marcas que vêm junto com o status: o Reexibir da equipe (desde então o
 * gestor não oculta mais) e o "Manter oculto" da equipe num ocultar do
 * gestor (o autor não pede revisão de novo deste ocultar).
 */
export function commentMarks(comment: Pick<FanClubComment, "status" | "restoredByStaffAt" | "reviewOutcome">, now: Date): string[] {
  const marks: string[] = [];
  if (comment.restoredByStaffAt) marks.push(`Reexibido pela equipe em ${dayTime(comment.restoredByStaffAt, now)}`);
  if (comment.status === "manager_hidden" && comment.reviewOutcome === "kept") marks.push("A equipe manteve oculto");
  return marks;
}

export const COMMENT_QUEUE_KINDS = ["report", "review"] as const;
export type CommentQueueKind = (typeof COMMENT_QUEUE_KINDS)[number];

export const COMMENT_RESOLUTIONS = ["kept", "hidden", "restored", "withdrawn", "author_deleted", "removed"] as const;
export type CommentResolution = (typeof COMMENT_RESOLUTIONS)[number];

/** As resoluções da equipe; as outras três fecham sem ela (37.6). */
export const TEAM_COMMENT_RESOLUTIONS = ["kept", "hidden", "restored"] as const;

export const COMMENT_RESOLUTION_LABELS: Record<CommentResolution, string> = {
  kept: "Mantido",
  hidden: "Ocultado pela equipe",
  restored: "Reexibido",
  withdrawn: "Encerrado sem decisão da equipe",
  author_deleted: "Encerrado sem decisão da equipe",
  removed: "Encerrado sem decisão da equipe",
};

/** Por que o item fechou sem a equipe. */
export const COMMENT_CLOSED_REASONS: Record<"withdrawn" | "author_deleted" | "removed", string> = {
  withdrawn: "As denúncias saíram ou o gestor reexibiu.",
  author_deleted: "A conta do autor foi excluída.",
  removed: "Saiu com a publicação ou com o comentário de cima.",
};

export { COMMENT_REPORT_REASONS, COMMENT_REPORT_REASON_LABELS, type CommentReportReason };

/**
 * `fanClubCommentQueue/{commentId}`: o item da fila, um por comentário, com a
 * rodada (37.2). A denúncia abre com o `kind: 'report'`; o pedido de revisão
 * do autor abre com o `kind: 'review'`, ou marca o `reviewRequested` no item
 * aberto por denúncia. Sem cópia do texto, e nunca quem denunciou.
 */
export interface FanClubCommentItem {
  commentId: string;
  postId: string;
  clubId: string;
  artistId: string;
  authorUid: string;
  kind: CommentQueueKind;
  reportCount: number;
  reasons: Record<CommentReportReason, number>;
  reviewRequested: boolean;
  status: ReportStatus;
  resolution: CommentResolution | null;
  /** A rodada que a decisão manda (`round`). */
  round: number;
  openedAt: Date | null;
  firstReportedAt: Date | null;
  lastReportedAt: Date | null;
  reviewRequestedAt: Date | null;
  lastActivityAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: { uid: string; name: string } | null;
}

/** O item da fila lido. O status estranho vale `resolved` (nada a decidir), e o tipo estranho vale denúncia. */
export function parseCommentItem(id: string, data: Record<string, unknown>): FanClubCommentItem {
  const raw = isRecord(data.reasons) ? data.reasons : {};
  const reasons = {} as Record<CommentReportReason, number>;
  for (const reason of COMMENT_REPORT_REASONS) reasons[reason] = countOf(raw[reason]);
  return {
    commentId: id,
    postId: text(data.postId),
    clubId: text(data.clubId),
    artistId: text(data.artistId),
    authorUid: text(data.authorUid),
    kind: data.kind === "review" ? "review" : "report",
    reportCount: countOf(data.reportCount),
    reasons,
    reviewRequested: data.reviewRequested === true,
    status: data.status === "open" ? "open" : "resolved",
    resolution: oneOf(COMMENT_RESOLUTIONS, data.resolution),
    round: countOf(data.round),
    openedAt: toDate(data.openedAt),
    firstReportedAt: toDate(data.firstReportedAt),
    lastReportedAt: toDate(data.lastReportedAt),
    reviewRequestedAt: toDate(data.reviewRequestedAt),
    lastActivityAt: toDate(data.lastActivityAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: personOf(data.resolvedBy),
  };
}

/** A marca do tipo: "1 denúncia", "3 denúncias" (com denúncia na rodada) e "Revisão pedida". As duas podem vir juntas. */
export function commentItemMarks(item: Pick<FanClubCommentItem, "kind" | "reportCount" | "reviewRequested">): string[] {
  const marks: string[] = [];
  if (item.reportCount > 0) marks.push(countLabel(item.reportCount, "denúncia", "denúncias"));
  if (item.kind === "review" || item.reviewRequested) marks.push("Revisão pedida");
  return marks;
}

/** A contagem por motivo, com os rótulos do Mural: "Spam: 1 · Ofensivo: 2"; sem denúncia, `null`. */
export function commentReasonsText(reasons: Record<CommentReportReason, number>): string | null {
  const parts = COMMENT_REPORT_REASONS.filter((reason) => reasons[reason] > 0).map((reason) => `${COMMENT_REPORT_REASON_LABELS[reason]}: ${formatNumber(reasons[reason])}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** O item fechou por decisão da equipe (Manter, Ocultar ou Reexibir). */
export function decidedByTeam(item: Pick<FanClubCommentItem, "resolution">): boolean {
  return (TEAM_COMMENT_RESOLUTIONS as readonly string[]).includes(item.resolution ?? "");
}

/** "2 comentários denunciados". */
export function commentReportsCountText(total: number): string {
  return countLabel(total, "comentário denunciado", "comentários denunciados");
}

/** "1 pedido de revisão". */
export function reviewRequestsCountText(total: number): string {
  return countLabel(total, "pedido de revisão", "pedidos de revisão");
}

export type CommentDecision = "keep" | "hide" | "restore";

/** Quem vê a decisão: o uid e se edita a seção. */
export interface CommentViewer {
  uid: string;
  canEdit: boolean;
}

/**
 * Quem chama e é o autor do comentário ou o gestor do fã-clube recebe `self`
 * do servidor (37.3): o gestor é parte do ocultar. Sem o fã-clube lido, só o
 * autor se confere aqui, e o servidor recusa o resto.
 */
export function isCommentSelf(authorUid: string, ownerUid: string | null, viewer: Pick<CommentViewer, "uid">): boolean {
  return authorUid === viewer.uid || (ownerUid !== null && ownerUid === viewer.uid);
}

/**
 * As decisões que cabem no comentário fora da fila (o diálogo da ficha e o
 * registro do ocultar), sem a rodada: Ocultar no visível e no oculto pelo
 * gestor, Reexibir no oculto pelo gestor e no oculto pela equipe.
 */
export function commentDecisions(comment: Pick<FanClubComment, "status" | "authorUid">, ownerUid: string | null, viewer: CommentViewer): CommentDecision[] {
  if (!viewer.canEdit || isCommentSelf(comment.authorUid, ownerUid, viewer)) return [];
  if (comment.status === "visible") return ["hide"];
  if (comment.status === "manager_hidden") return ["restore", "hide"];
  return ["restore"];
}

/** O comentário do item como a tela o leu: `null` quando não existe mais; `"unknown"` quando a leitura falhou. */
export type ItemCommentState = Pick<FanClubComment, "status"> | null | "unknown";

/**
 * As decisões do card da aba Comentários (37.10, item 1), com a rodada:
 * no aberto, Manter e Ocultar no visível, Manter oculto, Reexibir e Ocultar
 * no oculto pelo gestor, e Reexibir no oculto pela equipe; no resolvido pela
 * equipe, só o que ainda cabe no status de agora (a rodada troca a resolução
 * dela), sem Manter, que num item resolvido não faz nada. O encerrado sem a
 * equipe, o comentário apagado e o que não carregou ficam sem botões. O
 * autor e o gestor não decidem (`self`), nem o Leitor.
 */
export function commentItemDecisions(
  item: Pick<FanClubCommentItem, "status" | "resolution" | "authorUid">,
  comment: ItemCommentState,
  ownerUid: string | null,
  viewer: CommentViewer,
): CommentDecision[] {
  if (!viewer.canEdit || isCommentSelf(item.authorUid, ownerUid, viewer)) return [];
  if (comment === null || comment === "unknown") return [];
  if (item.status === "open") {
    if (comment.status === "visible") return ["keep", "hide"];
    if (comment.status === "manager_hidden") return ["keep", "restore", "hide"];
    return ["restore"];
  }
  if (!decidedByTeam(item)) return [];
  if (comment.status === "visible") return ["hide"];
  if (comment.status === "manager_hidden") return ["restore", "hide"];
  return ["restore"];
}

/** Os rótulos dos botões: o Manter do oculto pelo gestor é o "Manter oculto". */
export function commentDecisionLabel(decision: CommentDecision, status: CommentStatus): string {
  if (decision === "keep") return status === "manager_hidden" ? "Manter oculto" : "Manter";
  return decision === "hide" ? "Ocultar" : "Reexibir";
}

const RESOLUTION_OF_DECISION: Record<CommentDecision, CommentResolution> = { keep: "kept", hide: "hidden", restore: "restored" };

/**
 * A confirmação de uma decisão de comentário (os textos são de comentário, e
 * não de publicação): o título e o corpo pelo status mostrado. O comentário
 * de cima leva as respostas visíveis junto, e o resolvido diz que a decisão
 * da rodada muda.
 */
export function commentDecisionText(
  decision: CommentDecision,
  comment: Pick<FanClubComment, "status"> & Partial<Pick<FanClubComment, "replyToId" | "replyCount">>,
  item?: Pick<FanClubCommentItem, "status" | "resolution" | "round"> | null,
): { title: string; body: string } {
  const replies = comment.replyToId === null && (comment.replyCount ?? 0) > 0 ? (comment.replyCount ?? 0) : 0;
  let title: string;
  let body: string;
  if (decision === "keep") {
    if (comment.status === "manager_hidden") {
      title = "Manter o comentário oculto?";
      body = "O autor vê que a equipe manteve oculto e não pode pedir revisão de novo deste ocultar.";
    } else {
      title = "Manter o comentário?";
      body = comment.status === "visible" ? "A denúncia sai da fila, e o comentário continua visível." : "O item sai da fila, e o comentário continua como está.";
    }
  } else if (decision === "hide") {
    title = "Ocultar o comentário?";
    body = "O comentário some para todos, também para o autor. O gestor não pode reexibir.";
    if (replies > 0) body += ` ${replies === 1 ? "A resposta visível embaixo dele também deixa" : `As ${formatNumber(replies)} respostas visíveis embaixo dele também deixam`} de aparecer.`;
  } else {
    title = "Reexibir o comentário?";
    body = "O comentário volta a aparecer para todos, e o gestor não pode ocultá-lo de novo.";
  }
  if (item && item.status === "resolved" && item.resolution && decision !== "keep") {
    body += ` A decisão da rodada ${formatNumber(item.round)} passa de ${COMMENT_RESOLUTION_LABELS[item.resolution]} para ${COMMENT_RESOLUTION_LABELS[RESOLUTION_OF_DECISION[decision]]}.`;
  }
  return { title, body };
}

/** O aviso depois da decisão. */
export function commentDoneText(decision: CommentDecision, status: CommentStatus): string {
  if (decision === "keep") return status === "manager_hidden" ? "Comentário mantido oculto." : "Comentário mantido.";
  return decision === "hide" ? "Comentário ocultado." : "Comentário reexibido.";
}

/** O aviso de quem não decide porque é o autor ou o gestor. */
export const COMMENT_SELF_TEXT = "O comentário é seu ou do seu fã-clube: outra pessoa da equipe decide.";

/**
 * As recusas do comentário que tiram o botão de confirmar: a decisão velha e
 * o comentário que saiu no meio (`fan-club-comment-not-found`). Outra
 * tentativa repetiria a mesma frase.
 */
export function blocksCommentRetry(failure: unknown): boolean {
  const reason = readError(failure).reason;
  return reason === "stale-decision" || reason === "fan-club-comment-not-found";
}

/** "3 comentários abertos" (denúncias e pedidos de revisão). */
export function openCommentItemsText(total: number): string {
  return countLabel(total, "comentário na fila", "comentários na fila");
}

// ---------------------------------------------------------------------------
// O registro do ocultar do gestor (decisão 11 de 36.1, 37.2)
// ---------------------------------------------------------------------------

/**
 * `fanClubHideLog/{id}`: uma linha por ocultar e por reexibir do gestor, sem
 * o texto. O Ocultar e o Reexibir da equipe vão à auditoria, não aqui. Na
 * exclusão da conta do autor, a linha fica com o `authorUid` em `null`.
 */
export interface HideLogEntry {
  id: string;
  clubId: string;
  postId: string;
  commentId: string;
  authorUid: string | null;
  managerUid: string;
  action: "hidden" | "restored";
  at: Date | null;
}

export function parseHideLogEntry(id: string, data: Record<string, unknown>): HideLogEntry {
  return {
    id,
    clubId: text(data.clubId),
    postId: text(data.postId),
    commentId: text(data.commentId),
    authorUid: textOrNull(data.authorUid),
    managerUid: text(data.managerUid),
    action: data.action === "restored" ? "restored" : "hidden",
    at: toDate(data.at),
  };
}

export const HIDE_LOG_ACTION_LABELS: Record<HideLogEntry["action"], string> = { hidden: "Ocultou", restored: "Reexibiu" };

/** "O gestor ocultou 3 vezes"; nenhuma, "O gestor ainda não ocultou nenhum comentário". */
export function managerHidesText(total: number): string {
  if (total === 0) return "O gestor ainda não ocultou nenhum comentário.";
  return `O gestor ocultou ${total === 1 ? "1 vez" : `${formatNumber(total)} vezes`}.`;
}

/**
 * As linhas que oferecem o Reexibir: a mais nova de cada comentário que
 * ainda está oculto pelo gestor (o mesmo comentário pode ter várias linhas).
 */
export function hideLogRestorable(entries: readonly Pick<HideLogEntry, "id" | "commentId">[], statuses: ReadonlyMap<string, CommentStatus>): Set<string> {
  const seen = new Set<string>();
  const rows = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.commentId)) continue;
    seen.add(entry.commentId);
    if (statuses.get(entry.commentId) === "manager_hidden") rows.add(entry.id);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// O registro dos reconhecimentos (decisão 50)
// ---------------------------------------------------------------------------

/** `fanClubs/{clubId}/prizes/{grantId}`: uma concessão, sem o código do pedido nem o cupom. */
export interface FanClubPrize {
  grantId: string;
  points: number | null;
  prize: { rewardId: string; rewardTitle: string; rewardKind: string; delivered: boolean } | null;
  /** A nota interna da equipe. */
  note: string;
  by: { uid: string; name: string } | null;
  at: Date | null;
}

export function parsePrize(id: string, data: Record<string, unknown>): FanClubPrize {
  const prize = isRecord(data.prize) ? data.prize : null;
  return {
    grantId: id,
    points: typeof data.points === "number" && data.points > 0 ? countOf(data.points) : null,
    prize: prize
      ? { rewardId: text(prize.rewardId), rewardTitle: text(prize.rewardTitle), rewardKind: text(prize.rewardKind), delivered: prize.delivered === true }
      : null,
    note: text(data.note),
    by: personOf(data.by),
    at: toDate(data.at),
  };
}

// ---------------------------------------------------------------------------
// O Recompensar (decisões 38 e 43 a 46)
// ---------------------------------------------------------------------------

/** O cupom do parceiro, numa linha, e a mensagem da equipe ao gestor (decisão 43); a nota interna (34.3). */
export const PRIZE_COUPON_MAX = 60;
export const PRIZE_MESSAGE_MAX = 140;
export const REWARD_NOTE_MAX = 200;

/**
 * O `grantId` do Recompensar, sorteado ao abrir o diálogo, no formato do
 * `adjustmentId` do Ajuste (`^[A-Za-z0-9_-]{8,64}$`): a repetição com os
 * mesmos campos responde o que já foi feito, sem dar de novo.
 */
export function newGrantId(random?: () => string): string {
  return newAdjustmentId(random);
}

/** O teto dos pontos por reconhecimento, o mesmo do Ajuste por lançamento (decisão 45). */
export function rewardPointsMax(role: Role): number {
  return role === "admin" ? ADJUST_ADMIN_MAX : ADJUST_EDITOR_MAX;
}

export function rewardPointsHint(role: Role): string {
  return role === "admin"
    ? `De 1 a ${formatNumber(ADJUST_ADMIN_MAX)}. Vão só ao saldo do gestor, como "Prêmio do fã-clube" no extrato.`
    : `De 1 a ${formatNumber(ADJUST_EDITOR_MAX)}. Vão só ao saldo do gestor, como "Prêmio do fã-clube" no extrato, e somam no seu limite de ${formatNumber(ADJUST_EDITOR_DAILY_MAX)} pontos por dia do Ajuste.`;
}

/** O formulário do Recompensar: cada parte vale só com a seção dela (decisão 7). */
export interface RewardForm {
  feature: boolean;
  featuredUntil: string;
  points: string;
  /** A recompensa "Só para prêmios de fã-clube", ou "" sem prêmio. */
  rewardId: string;
  coupon: string;
  message: string;
  /** "O cupom já é o prêmio": o pedido nasce Entregue, e não se cancela. */
  delivered: boolean;
  note: string;
}

export type RewardFormErrors = Partial<Record<keyof RewardForm | "form", string>>;

/** O que o Confirmar manda: o `feature` (o fim) e o `reward` (os pontos, o prêmio e a nota), cada um numa chamada. */
export interface RewardPlan {
  featuredUntil: string | null;
  grant: {
    points: number | null;
    prize: { rewardId: string; delivered: boolean; coupon: string | null; message: string | null } | null;
    note: string;
  } | null;
}

/**
 * Confere o formulário como o servidor (o `parseFeaturedUntil` e o
 * `parseRewardGrant`): pelo menos uma parte; o fim de amanhã a 31 dias; os
 * pontos inteiros até o teto do papel; o cupom numa linha até 60 e a mensagem
 * até 140; e a nota de 1 a 200, numa linha, quando vão pontos ou prêmio. A
 * parte sem a seção de quem confirma fica de fora.
 */
export function checkRewardForm(
  form: RewardForm,
  options: { now: number; role: Role; canFeature: boolean; canPoints: boolean; canPrize: boolean },
): { errors: RewardFormErrors; plan: RewardPlan | null } {
  const errors: RewardFormErrors = {};
  let featuredUntil: string | null = null;
  if (options.canFeature && form.feature) {
    const checked = checkFeaturedUntil(form.featuredUntil, options.now);
    if (checked.ok) featuredUntil = checked.day;
    else errors.featuredUntil = checked.message;
  }
  let points: number | null = null;
  if (options.canPoints && form.points.trim() !== "") {
    const max = rewardPointsMax(options.role);
    const value = Number(form.points);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) errors.points = `Use um número inteiro de 1 a ${formatNumber(max)}.`;
    else points = value;
  }
  let prize: NonNullable<RewardPlan["grant"]>["prize"] = null;
  if (options.canPrize && form.rewardId) {
    const coupon = cleanLine(form.coupon);
    if (coupon.length > PRIZE_COUPON_MAX || (coupon && !isVisibleLine(coupon))) errors.coupon = `Até ${PRIZE_COUPON_MAX} caracteres, numa linha.`;
    const message = cleanMultiline(form.message);
    if (message.length > PRIZE_MESSAGE_MAX || (message && !isVisibleMultiline(message))) errors.message = `Até ${PRIZE_MESSAGE_MAX} caracteres.`;
    if (form.delivered && !coupon) errors.coupon = "Escreva o cupom: com \"O cupom já é o prêmio\", o pedido nasce entregue.";
    prize = { rewardId: form.rewardId, delivered: form.delivered, coupon: coupon || null, message: message || null };
  }
  const grants = points !== null || prize !== null || Boolean(errors.points);
  let note = "";
  if (grants) {
    note = cleanLine(form.note);
    if (!note) errors.note = "Escreva a nota interna: por que o fã-clube recebe.";
    else if (note.length > REWARD_NOTE_MAX || !isVisibleLine(note)) errors.note = `Até ${REWARD_NOTE_MAX} caracteres, numa linha.`;
  }
  if (featuredUntil === null && !grants && !errors.featuredUntil) errors.form = "Escolha o Destaque, os pontos ou o prêmio.";
  if (Object.keys(errors).length > 0) return { errors, plan: null };
  return { errors, plan: { featuredUntil, grant: points !== null || prize !== null ? { points, prize, note } : null } };
}

/** A versão do regulamento de agora (`FAN_CLUB_RULES_VERSION` do servidor): até o regulamento, a dos Termos de Uso. */
export const FAN_CLUB_RULES_VERSION = "termos-2026-10";

/** O fã-clube ativo há 30 dias, no checklist. */
export const REWARD_ACTIVE_DAYS = 30;

export type CheckState = "ok" | "no" | "unknown";

export interface ChecklistItem {
  key: "active" | "suspension" | "member" | "rules" | "reports" | "posts";
  label: string;
  state: CheckState;
  /** Por que não deu para conferir, ou o detalhe do que falhou. */
  detail: string | null;
}

/**
 * O checklist do Recompensar (decisão 38): só avisa, sem impedir. O que a
 * pessoa não pode ler fica "não conferido" com o motivo: o perfil e a central
 * do gestor pedem a seção Fãs. As travas de verdade (o fã-clube ativo, o 18+
 * declarado e o gestor sem suspensão) são do servidor (decisão 46).
 */
export function rewardChecklist(input: {
  club: Pick<FanClub, "status" | "approvedAt" | "postCount" | "lastPostAt" | "ownerUid">;
  now: number;
  /** `null`: não deu para ler (sem a seção Fãs, ou a leitura falhou). */
  ownerSuspended: boolean | null;
  ownerMember: boolean | null;
  rulesVersion: string | null;
  /** As denúncias aceitas (Ocultar) nos últimos 30 dias; `null` sem a leitura. */
  actionedReports: number | null;
  readsFans: boolean;
  /** A suspensão também se lê com a Moderação; o vínculo com a central, só com Fãs. */
  readsModeration?: boolean;
}): ChecklistItem[] {
  const { club, now } = input;
  const since = now - REWARD_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const failed = "Não deu para conferir agora.";
  const suspensionUnread = input.readsFans || input.readsModeration ? failed : "Só com a seção Fãs ou a Moderação.";
  const memberUnread = input.readsFans ? failed : "Só com a seção Fãs.";
  const state = (value: boolean | null): CheckState => (value === null ? "unknown" : value ? "ok" : "no");
  return [
    {
      key: "active",
      label: "Fã-clube ativo há 30 dias",
      state: club.status === "active" && club.approvedAt !== null && club.approvedAt.getTime() <= since ? "ok" : "no",
      detail: club.status !== "active" ? "O fã-clube não está ativo." : null,
    },
    { key: "suspension", label: "Gestor sem suspensão", state: state(input.ownerSuspended === null ? null : !input.ownerSuspended), detail: input.ownerSuspended === null ? suspensionUnread : null },
    { key: "member", label: "Gestor na central do artista", state: state(input.ownerMember), detail: input.ownerMember === null ? memberUnread : null },
    {
      key: "rules",
      label: "Regulamento aceito na versão de agora",
      state: input.rulesVersion === null ? "unknown" : input.rulesVersion === FAN_CLUB_RULES_VERSION ? "ok" : "no",
      detail: input.rulesVersion === null ? "Sem a candidatura do gestor." : null,
    },
    {
      key: "reports",
      label: "Nenhuma denúncia aceita nos últimos 30 dias",
      state: input.actionedReports === null ? "unknown" : input.actionedReports === 0 ? "ok" : "no",
      detail: input.actionedReports === null ? "Não deu para conferir agora." : input.actionedReports > 0 ? countLabel(input.actionedReports, "denúncia aceita", "denúncias aceitas") : null,
    },
    { key: "posts", label: "Pelo menos uma publicação aprovada", state: club.lastPostAt !== null || club.postCount > 0 ? "ok" : "no", detail: null },
  ];
}

/** As travas do servidor (decisão 46), pelo `details.problem` do `prize-not-allowed`. */
const PRIZE_PROBLEMS: Record<string, string> = {
  club_not_active: "O fã-clube precisa estar ativo para receber.",
  not_adult: "O gestor não declarou ter 18 anos ou mais na candidatura.",
  owner_suspended: "O gestor está suspenso. Tire a suspensão antes de recompensar.",
};

/** A frase da recusa do Recompensar pela trava que falhou; fora do `prize-not-allowed`, `null` (a frase do servidor). */
export function rewardRefusalText(failure: unknown): string | null {
  if (readError(failure).reason !== "prize-not-allowed") return null;
  const problem = errorDetails(failure).problem;
  return typeof problem === "string" && PRIZE_PROBLEMS[problem] ? PRIZE_PROBLEMS[problem] : null;
}

// ---------------------------------------------------------------------------
// Os números (decisões 24, 37 e 39)
// ---------------------------------------------------------------------------

/** A proporção acima da qual a ficha avisa (decisão 39): passou da metade. O limite é proposta, fácil de trocar. */
export const QUALITY_WARNING_SHARE = 0.5;

export const QUALITY_SIGNALS = ["newAccounts", "automaticUsername", "byOwnerCode"] as const;
export type QualitySignal = (typeof QUALITY_SIGNALS)[number];

export const QUALITY_LABELS: Record<QualitySignal, string> = {
  newAccounts: "Contas com menos de 7 dias",
  automaticUsername: "Com o @ automático",
  byOwnerCode: "Trazidos pelo código do gestor",
};

/**
 * A qualidade dos seguidores pela cópia (o `followerQuality` do servidor):
 * cada sinal sobre os seguidores (0 sem seguidores) e os que passam da metade.
 */
export function followerQuality(counts: Pick<FanClubCounts, "followers" | QualitySignal>): { shares: Record<QualitySignal, number>; warnings: QualitySignal[] } {
  const share = (value: number) => (counts.followers > 0 ? value / counts.followers : 0);
  const shares = { newAccounts: share(counts.newAccounts), automaticUsername: share(counts.automaticUsername), byOwnerCode: share(counts.byOwnerCode) };
  return { shares, warnings: QUALITY_SIGNALS.filter((signal) => shares[signal] > QUALITY_WARNING_SHARE) };
}

export const MONTH_FIELD_LABELS: Record<MonthField, string> = {
  followers: "Seguidores",
  joins: "Entradas trazidas",
  signups: "Cadastros",
  visits: "Visitas",
  links: "Links",
};

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ---------------------------------------------------------------------------
// A taxa de engajamento de 30 dias (37.11)
// ---------------------------------------------------------------------------

/** O período da taxa: hoje e os 29 dias antes, no dia de São Paulo. */
export const ENGAGEMENT_DAYS = 30;

/** Um dia do mapa `days` dos shards, já somado entre os 16. */
export interface EngagementDay {
  reactions: number;
  comments: number;
}

export interface Engagement {
  reactions: number;
  comments: number;
  /** Em porcentagem, com uma casa; sem seguidor, `null`. */
  rate: number | null;
}

/**
 * A taxa, como a `fanClubEngagement` do servidor: as reações novas e os
 * comentários dos dias do período (só as chaves `AAAA-MM-DD` de hoje e dos 29
 * antes; o dia velho que a cópia da noite ainda não cortou e um dia depois de
 * hoje ficam de fora), sobre os seguidores, com uma casa decimal arredondada a
 * meia casa para cima. As somas nunca saem negativas.
 */
export function fanClubEngagement(days: Readonly<Record<string, EngagementDay>>, followers: number, now: number): Engagement {
  const today = dayKey(now);
  const first = shiftDay(today, -(ENGAGEMENT_DAYS - 1));
  let reactions = 0;
  let comments = 0;
  for (const [day, value] of Object.entries(days)) {
    if (!DAY_PATTERN.test(day) || day < first || day > today) continue;
    reactions += value.reactions;
    comments += value.comments;
  }
  reactions = Math.max(0, reactions);
  comments = Math.max(0, comments);
  return { reactions, comments, rate: followers > 0 ? Math.round(((reactions + comments) * 1000) / followers) / 10 : null };
}

const RATE = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "450,0%". */
export function formatRate(rate: number): string {
  return `${RATE.format(rate)}%`;
}

/**
 * A taxa da ficha: os seguidores são os da cópia da noite (a seção não conta
 * quem segue sem a seção Fãs, decisão 29 de 34.1), com a data dela. O gestor
 * vê no app a taxa sobre os seguidores de agora, e os números podem diferir.
 */
export function engagementView(days: Readonly<Record<string, EngagementDay>>, counts: Pick<FanClubCounts, "followers" | "at"> | null, now: Date): { value: string; detail: string } {
  if (!counts?.at) return { value: "Sem cópia", detail: "Os seguidores ainda não foram copiados: a taxa aparece com a primeira cópia da noite." };
  const engagement = fanClubEngagement(days, counts.followers, now.getTime());
  const sums = `${reactionCountText(engagement.reactions)} e ${commentCountText(engagement.comments)}`;
  if (engagement.rate === null) return { value: "Sem seguidores na cópia", detail: `${sums} em 30 dias.` };
  return { value: formatRate(engagement.rate), detail: `${sums}, ${countLabel(counts.followers, "seguidor", "seguidores")} na cópia de ${formatDay(counts.at, now)}.` };
}

export const ENGAGEMENT_NOTE = "A taxa é só para acompanhar. Ela não decide prêmio. No app, o gestor vê a taxa sobre os seguidores de agora, e o número pode ser outro.";

/** "outubro de 2026", de um `AAAA-MM`. */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[(number ?? 1) - 1] ?? month} de ${year}`;
}

/**
 * Este mês: os números da cópia menos os do `monthStart`, quando a cópia é do
 * mesmo mês do retrato (a primeira cópia de um mês grava o `monthStart` novo).
 * Antes dela, `null`.
 */
export function thisMonthNumbers(club: Pick<FanClub, "counts" | "monthStart">): FanClubMonth | null {
  const { counts, monthStart } = club;
  if (!counts?.at || !monthStart || dayKey(counts.at.getTime()).slice(0, 7) !== monthStart.month) return null;
  const numbers = {} as Record<MonthField, number>;
  for (const field of MONTH_FIELDS) numbers[field] = counts[field] - monthStart.numbers[field];
  return { month: monthStart.month, numbers };
}

// ---------------------------------------------------------------------------
// Seguidores (decisões 29 e 39)
// ---------------------------------------------------------------------------

/** `users/{uid}/fanClubFollows/{clubId}`, lido pela consulta de grupo, só com a seção Fãs. */
export interface FanClubFollower {
  uid: string;
  followedAt: Date | null;
  newAccount: boolean;
  chosenUsername: boolean;
  byOwnerCode: boolean;
}

export function parseFollower(data: Record<string, unknown>): FanClubFollower {
  return {
    uid: text(data.uid),
    followedAt: toDate(data.followedAt),
    newAccount: data.newAccount === true,
    chosenUsername: data.chosenUsername === true,
    byOwnerCode: data.byOwnerCode === true,
  };
}

/** Os sinais que a linha do seguidor mostra (decisão 39). */
export function followerSignals(follower: Pick<FanClubFollower, "newAccount" | "chosenUsername" | "byOwnerCode">): string[] {
  return [
    follower.newAccount ? "Conta nova" : null,
    follower.chosenUsername ? null : "@ automático",
    follower.byOwnerCode ? "Trazido pelo gestor" : null,
  ].filter((item): item is string => item !== null);
}

// ---------------------------------------------------------------------------
// O "Aguardando a equipe" (34.10, item 9)
// ---------------------------------------------------------------------------

/**
 * O que espera a equipe: as candidaturas e as publicações em análise, as
 * denúncias abertas e, desde a Fase 2, os itens abertos da fila dos
 * comentários pelo tipo (o aberto por denúncia que recebeu o pedido depois
 * continua denúncia).
 */
export interface WaitingCounts {
  applications: number;
  posts: number;
  reports: number;
  commentReports: number;
  commentReviews: number;
}

/** Os zeros de quem não vê a seção. */
export const NO_WAITING: WaitingCounts = { applications: 0, posts: 0, reports: 0, commentReports: 0, commentReviews: 0 };

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/** O alvo do fã-clube nos Logs (34.8): `fanClub:<id>`. */
export function fanClubTarget(clubId: string): string {
  return `fanClub:${clubId}`;
}
