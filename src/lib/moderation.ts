import { formatDay, formatNumber, formatRelative, joinPt } from "@/lib/format";
import { toDate } from "@/lib/staff";
import { isVisibleLine } from "@/lib/visible-line";

/**
 * Moderação (21 e 26.16), puro: o item da fila (`moderationQueue`), o
 * comentário e o post como a tela mostra, as denúncias por motivo (quem
 * denunciou nunca aparece) e a nota da suspensão.
 */

export const QUEUE_PAGE_SIZE = 25;
export const SUSPENSION_NOTE_MAX = 280;

export const REPORT_REASONS = ["spam", "offensive", "harassment", "other", "none"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  offensive: "Ofensivo",
  harassment: "Assédio",
  other: "Outro",
  none: "Sem motivo",
};

export type Resolution = "hidden" | "kept" | "author_deleted" | "withdrawn";

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  hidden: "Ocultado",
  kept: "Mantido",
  author_deleted: "Autor excluiu a conta",
  withdrawn: "Denúncia retirada",
};

export const AUTHOR_DELETED_TEXT = "O autor excluiu a conta.";
export const QUEUE_EMPTY_TEXT = "Nenhuma denúncia esperando. Bom trabalho.";
export const FAN_NOT_FOUND_TEXT = "Fã não encontrado. A conta pode ter sido excluída.";
export const HIDE_CONFIRM_TEXT = "O comentário some do app para todos. Dá para reexibir depois.";
export const KEEP_CONFIRM_TEXT = "O comentário continua no app e sai da fila. Uma denúncia nova traz de volta.";
export const SUSPEND_TEXT =
  "O fã continua lendo o app, mas não comenta, não curte, não ganha pontos (nem pelo convite) e não muda o perfil até você tirar a suspensão. Ele ainda consegue desfazer curtidas e presenças, sair de centrais e bloquear quem o incomoda. Se ele gere um fã-clube ativo, o fã-clube fica pausado e perde o Destaque. Ele também deixa de seguir os fã-clubes que seguia. Tirar a suspensão não reativa o fã-clube nem devolve os seguimentos.";
export const CLEAR_PHOTO_TEXT = "A foto some do perfil e dos comentários em alguns minutos.";
export const CLEAR_BIO_SOCIALS_TEXT = "A bio e as redes somem do perfil do fã. O texto apagado não fica guardado.";
export const NOTHING_TO_CLEAR_TEXT = "Nada a apagar: a bio e as redes já estavam vazias.";

/** O que a `clearFanProfileText` apaga (28.6), na ordem do servidor. */
export const PROFILE_TEXT_FIELDS = ["bio", "socials"] as const;
export type ProfileTextField = (typeof PROFILE_TEXT_FIELDS)[number];

export const PROFILE_TEXT_FIELD_LABELS: Record<ProfileTextField, string> = { bio: "Bio", socials: "Redes sociais" };

/** Os campos que têm o que apagar: a bio com texto e as redes com algum texto, mesmo fora do padrão. */
export function clearableProfileFields(profile: { bio: string | null; socialsStored: boolean }): ProfileTextField[] {
  return PROFILE_TEXT_FIELDS.filter((field) => (field === "bio" ? profile.bio !== null : profile.socialsStored));
}

/** O aviso depois da `clearFanProfileText`, pelos campos que saíram de fato. */
export function clearedProfileText(name: string, cleared: readonly ProfileTextField[]): string {
  const bio = cleared.includes("bio");
  const socials = cleared.includes("socials");
  if (bio && socials) return `A bio e as redes de ${name} foram apagadas.`;
  if (bio) return `A bio de ${name} foi apagada.`;
  if (socials) return `As redes de ${name} foram apagadas.`;
  return NOTHING_TO_CLEAR_TEXT;
}

/**
 * O motivo da troca do @ (32.1, decisão 1): `moderation`, o @ ofensivo ou
 * impróprio, trava a troca pelo fã por 30 dias; `central`, o @ de um artista,
 * sai sem prazo (e destrava quem foi trocado por engano).
 */
export const USERNAME_RESET_REASONS = ["moderation", "central"] as const;
export type UsernameResetReason = (typeof USERNAME_RESET_REASONS)[number];

export const USERNAME_RESET_REASON_LABELS: Record<UsernameResetReason, string> = {
  moderation: "O @ é ofensivo ou impróprio",
  central: "O @ é de um artista",
};

export const USERNAME_RESET_REASON_HINTS: Record<UsernameResetReason, string> = {
  moderation: "Se o @ em si é ofensivo, peça também o termo na lista do filtro. Sem isso, outra conta pode pegar o @ na hora.",
  central: "Também tira o prazo de quem foi trocado por engano: o fã ganha outro @ automático e escolhe na hora.",
};

export function resetUsernameText(username: string, reason: UsernameResetReason): string {
  const when = reason === "moderation" ? "só escolhe outro daqui a 30 dias" : "pode escolher outro na hora";
  return `O fã fica com um @ automático novo e ${when}. O @${username} fica livre para qualquer pessoa.`;
}

/**
 * Depois de uma resposta incerta, a nova tentativa da troca voltou
 * `username-changed`: o @ que o diálogo guardou já saiu, então a primeira
 * tentativa foi gravada.
 */
export function usernameChangedAfterUncertainText(username: string): string {
  return `O @ já não é @${username}: a tentativa anterior deve ter sido gravada. Feche para ver o @ de agora.`;
}

/** Depois de uma resposta incerta, a nova tentativa de apagar não achou nada: a primeira foi gravada. */
export function clearedBeforeText(fields: readonly ProfileTextField[]): string {
  const bio = fields.includes("bio");
  const socials = fields.includes("socials");
  const gone = bio && socials ? "A bio e as redes já tinham saído" : bio ? "A bio já tinha saído" : "As redes já tinham saído";
  return `${gone}: a tentativa anterior deve ter sido gravada.`;
}

/** O aviso depois da troca, pelo `changeableAt` da resposta: com data, o fã espera até ela. */
export function resetUsernameDoneText(previous: string, name: string, changeableAt: string | null, now: Date = new Date()): string {
  const until = changeableAt ? new Date(changeableAt) : null;
  const wait = until && !Number.isNaN(until.getTime()) ? `escolhe outro a partir de ${formatDay(until, now)}` : "pode escolher outro na hora";
  return `O @${previous} foi trocado por um automático. ${name} ${wait}.`;
}

/** "Liberada a partir de 14 nov, @ trocado pela equipe" (o item "Troca do @"): o prazo que ainda vale, ou `null`. */
export function usernameLockText(profile: { usernameChangeableAt: Date | null; usernameLockReason: "moderation" | null }, now: Date): string | null {
  const until = profile.usernameChangeableAt;
  if (!until || until.getTime() <= now.getTime()) return null;
  return `Liberada a partir de ${formatDay(until, now)}${profile.usernameLockReason === "moderation" ? ", @ trocado pela equipe" : ""}`;
}

export interface QueueItem {
  /** O id do item é o do comentário. */
  commentId: string;
  postId: string;
  artistId: string | null;
  authorUid: string | null;
  /** A cópia do texto; `null` quando o autor excluiu a conta. */
  commentText: string | null;
  reportCount: number;
  reasons: Record<ReportReason, number>;
  status: "open" | "resolved";
  resolution: Resolution | null;
  firstReportedAt: Date | null;
  lastReportedAt: Date | null;
  resolvedAt: Date | null;
  /** Quem resolveu; `null` quando foi o sistema (conta excluída, denúncia retirada). */
  resolvedBy: string | null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const RESOLUTIONS: readonly string[] = ["hidden", "kept", "author_deleted", "withdrawn"];

export function parseQueueItem(id: string, data: Record<string, unknown>): QueueItem {
  const reasons = data.reasons && typeof data.reasons === "object" ? (data.reasons as Record<string, unknown>) : {};
  const by = data.resolvedBy && typeof data.resolvedBy === "object" ? (data.resolvedBy as { name?: unknown }) : null;
  return {
    commentId: typeof data.commentId === "string" ? data.commentId : id,
    postId: typeof data.postId === "string" ? data.postId : "",
    artistId: typeof data.artistId === "string" ? data.artistId : null,
    authorUid: typeof data.authorUid === "string" && data.authorUid ? data.authorUid : null,
    commentText: typeof data.commentText === "string" ? data.commentText : null,
    reportCount: count(data.reportCount),
    reasons: Object.fromEntries(REPORT_REASONS.map((reason) => [reason, count(reasons[reason])])) as Record<ReportReason, number>,
    status: data.status === "resolved" ? "resolved" : "open",
    resolution: typeof data.resolution === "string" && RESOLUTIONS.includes(data.resolution) ? (data.resolution as Resolution) : null,
    firstReportedAt: toDate(data.firstReportedAt),
    lastReportedAt: toDate(data.lastReportedAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: typeof by?.name === "string" && by.name ? by.name : null,
  };
}

/** "Spam 2 · Ofensivo 1": só os motivos com denúncia, na ordem da lista. */
export function reasonsText(reasons: Record<ReportReason, number>): string {
  const parts = REPORT_REASONS.filter((reason) => reasons[reason] > 0).map((reason) => `${REPORT_REASON_LABELS[reason]} ${formatNumber(reasons[reason])}`);
  return parts.length > 0 ? parts.join(" · ") : "Sem contagem";
}

/** O mesmo, por extenso para o leitor de tela: "2 denúncias de spam e 1 de ofensivo". */
export function reasonsSpoken(reasons: Record<ReportReason, number>): string {
  const parts = REPORT_REASONS.filter((reason) => reasons[reason] > 0).map((reason) => `${formatNumber(reasons[reason])} ${REPORT_REASON_LABELS[reason].toLowerCase()}`);
  return parts.length > 0 ? `Denúncias: ${joinPt(parts)}` : "Sem denúncias contadas";
}

/** "o mais antigo há 3 h": a primeira denúncia mais velha dos abertos (só quando a fila inteira está na tela). */
export function oldestText(items: readonly Pick<QueueItem, "firstReportedAt">[], now: Date): string | null {
  const times = items.map((item) => item.firstReportedAt?.getTime()).filter((value): value is number => typeof value === "number");
  if (times.length === 0) return null;
  return `o mais antigo ${formatRelative(new Date(Math.min(...times)), now)}`;
}

/** "3 comentários na fila". */
export function queueCountText(total: number): string {
  return total === 1 ? "1 comentário na fila" : `${formatNumber(total)} comentários na fila`;
}

// ---------------------------------------------------------------------------
// Denúncia de perfil (29.3): a `profileReportQueue`, um item por fã denunciado
// ---------------------------------------------------------------------------

export type ProfileResolution = "kept" | "actioned" | "withdrawn" | "author_deleted";

/** Os rótulos das resoluções do item de perfil (29.7), à parte dos do comentário. */
export const PROFILE_RESOLUTION_LABELS: Record<ProfileResolution, string> = {
  kept: "Mantido",
  actioned: "Resolvido com ação",
  withdrawn: "Denúncias retiradas",
  author_deleted: "Conta excluída",
};

const PROFILE_RESOLUTIONS: readonly string[] = ["kept", "actioned", "withdrawn", "author_deleted"];

export const PROFILE_QUEUE_EMPTY_TEXT = "Nenhum perfil denunciado esperando.";
export const PROFILE_RESOLVED_EMPTY_TEXT = "Nenhuma denúncia de perfil resolvida ainda.";
export const KEEP_PROFILE_TEXT = "O perfil continua como está e sai da lista. Uma denúncia nova de outra pessoa traz de volta.";
export const ACTION_PROFILE_TEXT =
  "Use antes as ferramentas da página do fã: apagar bio e redes, trocar o @, tirar a foto, suspender ou ocultar os comentários. O item fecha com o perfil de agora; se ele mudar depois, quem já denunciou pode abrir de novo.";
export const ACCOUNT_DELETED_TEXT = "Conta excluída";

export interface ProfileQueueItem {
  /** O id do item é o uid do fã denunciado. */
  uid: string;
  /** Denúncias da rodada. */
  reportCount: number;
  reasons: Record<ReportReason, number>;
  status: "open" | "resolved";
  resolution: ProfileResolution | null;
  /** A rodada: 1 ao criar, mais 1 a cada reabertura. A callable confere. */
  round: number;
  /** O começo da rodada. */
  openedAt: Date | null;
  firstReportedAt: Date | null;
  lastReportedAt: Date | null;
  resolvedAt: Date | null;
  /** `null` quando o sistema fechou (denúncias retiradas ou conta excluída). */
  resolvedBy: { uid: string; name: string } | null;
}

export function parseProfileQueueItem(id: string, data: Record<string, unknown>): ProfileQueueItem {
  const reasons = data.reasons && typeof data.reasons === "object" ? (data.reasons as Record<string, unknown>) : {};
  const by = data.resolvedBy && typeof data.resolvedBy === "object" ? (data.resolvedBy as { uid?: unknown; name?: unknown }) : null;
  const round = typeof data.round === "number" && Number.isInteger(data.round) && data.round >= 1 ? data.round : 1;
  return {
    uid: id,
    reportCount: count(data.reportCount),
    reasons: Object.fromEntries(REPORT_REASONS.map((reason) => [reason, count(reasons[reason])])) as Record<ReportReason, number>,
    status: data.status === "resolved" ? "resolved" : "open",
    resolution: typeof data.resolution === "string" && PROFILE_RESOLUTIONS.includes(data.resolution) ? (data.resolution as ProfileResolution) : null,
    round,
    openedAt: toDate(data.openedAt),
    firstReportedAt: toDate(data.firstReportedAt),
    lastReportedAt: toDate(data.lastReportedAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: by && typeof by.uid === "string" && typeof by.name === "string" && by.name ? { uid: by.uid, name: by.name } : null,
  };
}

/** "2 perfis denunciados" (só os abertos). */
export function profileQueueCountText(total: number): string {
  if (total === 0) return "Nenhum perfil denunciado";
  return total === 1 ? "1 perfil denunciado" : `${formatNumber(total)} perfis denunciados`;
}

/** "o mais antigo há 3 h", pelo começo da rodada (`openedAt`), e não pela primeira denúncia de todas. */
export function profileOldestText(items: readonly Pick<ProfileQueueItem, "openedAt">[], now: Date): string | null {
  const times = items.map((item) => item.openedAt?.getTime()).filter((value): value is number => typeof value === "number");
  if (times.length === 0) return null;
  return `o mais antigo ${formatRelative(new Date(Math.min(...times)), now)}`;
}

/** As decisões que a equipe ainda pode tomar no item: no aberto as duas; no resolvido pela equipe, a outra. */
export function profileDecisions(item: Pick<ProfileQueueItem, "status" | "resolution">): ("kept" | "actioned")[] {
  if (item.status === "open") return ["kept", "actioned"];
  if (item.resolution === "kept") return ["actioned"];
  if (item.resolution === "actioned") return ["kept"];
  return [];
}

export interface CommentInfo {
  postId: string;
  commentId: string;
  artistId: string | null;
  authorUid: string | null;
  authorName: string;
  authorPhotoURL: string | null;
  text: string;
  status: "visible" | "hidden";
  createdAt: Date | null;
  hiddenAt: Date | null;
  /** O uid de quem ocultou (a tela dá o nome só a quem lista a equipe). */
  hiddenBy: string | null;
}

export function parseComment(postId: string, commentId: string, data: Record<string, unknown>): CommentInfo {
  const photo = typeof data.authorPhotoURL === "string" && /^https?:\/\//.test(data.authorPhotoURL) ? data.authorPhotoURL : null;
  return {
    postId,
    commentId,
    artistId: typeof data.artistId === "string" ? data.artistId : null,
    authorUid: typeof data.authorUid === "string" ? data.authorUid : null,
    authorName: typeof data.authorName === "string" && data.authorName.trim() ? data.authorName.trim() : "Fã sem nome",
    authorPhotoURL: photo,
    text: typeof data.text === "string" ? data.text : "",
    status: data.status === "hidden" ? "hidden" : "visible",
    createdAt: toDate(data.createdAt),
    hiddenAt: toDate(data.hiddenAt),
    hiddenBy: typeof data.hiddenBy === "string" && data.hiddenBy ? data.hiddenBy : null,
  };
}

/** O trecho do post: a primeira linha, até 80 caracteres. */
export function postSnippet(text: unknown, max = 80): string | null {
  if (typeof text !== "string") return null;
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A nota da suspensão: opcional, uma linha visível, até 280. */
export function validateSuspensionNote(note: string): { error: string | null; value: string | null } {
  const value = note.normalize("NFC").trim();
  if (!value) return { error: null, value: null };
  if (value.length > SUSPENSION_NOTE_MAX || !isVisibleLine(value)) return { error: `Até ${SUSPENSION_NOTE_MAX} caracteres, numa linha.`, value: null };
  return { error: null, value };
}

/**
 * O ocultar em lote também leva os comentários do fã nos fã-clubes (37.6),
 * contados junto no "N comentários visíveis": os visíveis e os ocultos pelo
 * gestor, que o autor ainda vê.
 */
export const FAN_CLUB_COMMENTS_TOO_TEXT = "Entram também os comentários dele nos fã-clubes, inclusive os ocultos pelo gestor, que o autor ainda vê.";

/** "Ocultar também os 3 comentários visíveis". */
export function hideAlsoLabel(visible: number): string {
  return visible === 1 ? "Ocultar também o comentário visível" : `Ocultar também os ${formatNumber(visible)} comentários visíveis`;
}

/** O resumo do laço do `hideFanComments`. */
export function hiddenSummary(hidden: number): string {
  if (hidden === 0) return "Nenhum comentário visível para ocultar.";
  return hidden === 1 ? "1 comentário ocultado." : `${formatNumber(hidden)} comentários ocultados.`;
}
