import { errorDetails, readError } from "@/lib/errors";
import { socialHref, type FanSocial } from "@/lib/fan-profile";
import { countLabel, formatDay, formatRelative } from "@/lib/format";
import { toDate } from "@/lib/staff";
import { cleanLine, isVisibleLine } from "@/lib/visible-line";
import { isWhatsapp } from "@/lib/whatsapp";

/**
 * O fã-clube gerido pelo fã (seção 34 da nota do app, `docs/arquitetura-api.md`),
 * puro: as candidaturas, o fã-clube e o contato do fã como a seção Fã-clubes
 * lê, os rótulos e as frases das decisões. O que vem do servidor da etapa 1
 * (34.14 e 34.22): aprovar e recusar a candidatura, pausar, reativar e
 * encerrar o fã-clube, todas pela `decideFanClub` (`fan-club-api.ts`). As
 * publicações, as denúncias, o Destaque, os números e o prêmio chegam com as
 * etapas 2 a 5 do servidor.
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

/** Um `Timestamp` em ms inteiros (o `toMillis` do servidor arredonda para baixo), ou `null`. */
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

/** `fanClubs/{clubId}`, só o que a etapa 1 do servidor grava e a tela usa. */
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
}

/** O fã-clube lido. O status estranho vale `closed` (nada a pausar nem reativar), como no servidor. */
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

export type ClubDecision = "pause" | "resume" | "close";

/**
 * As decisões que cabem no fã-clube agora (34.5): pausar o ativo, reativar o
 * pausado (o servidor recusa o gestor suspenso e o artista fechado) e
 * encerrar o ativo ou o pausado, só o admin. O gestor da equipe não decide o
 * próprio fã-clube (`self`), nem o Leitor.
 */
export function clubDecisions(club: Pick<FanClub, "status" | "ownerUid">, viewer: { uid: string; canEdit: boolean; admin: boolean }): ClubDecision[] {
  if (!viewer.canEdit || (club.ownerUid !== null && club.ownerUid === viewer.uid)) return [];
  const decisions: ClubDecision[] = [];
  if (club.status === "active") decisions.push("pause");
  if (club.status === "paused" && club.ownerUid !== null) decisions.push("resume");
  if (club.status !== "closed" && viewer.admin) decisions.push("close");
  return decisions;
}

export const PAUSE_TEXT = "O fã-clube sai do app para os fãs, e o gestor não publica até a equipe reativar.";
export const RESUME_TEXT = "O fã-clube volta ao app para os fãs. O servidor recusa se o gestor estiver suspenso ou o artista não aceitar fã-clubes.";

/** O texto da confirmação de encerrar, pelo motivo escolhido. */
export function closeText(reason: CloseReason): string {
  return `O fã-clube sai do app de vez e não volta. ${CLOSE_REASON_HINTS[reason]}`;
}

/** A recusa que outra tentativa repetiria: o estado mudou desde que a tela abriu. */
export function isStaleDecision(failure: unknown): boolean {
  return readError(failure).reason === "stale-decision";
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/** O alvo do fã-clube nos Logs (34.8): `fanClub:<id>`. */
export function fanClubTarget(clubId: string): string {
  return `fanClub:${clubId}`;
}
