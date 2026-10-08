import { formatNumber, formatRelative, joinPt } from "@/lib/format";
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
  "O fã continua lendo o app, mas não comenta, não curte, não ganha pontos (nem pelo convite) e não muda o perfil até você tirar a suspensão. Ele ainda consegue desfazer curtidas e presenças, sair de centrais e bloquear quem o incomoda.";
export const CLEAR_PHOTO_TEXT = "A foto some do perfil e dos comentários em alguns minutos.";

export function resetUsernameText(username: string): string {
  return `O fã fica com um @ automático novo e pode escolher outro na hora. O @${username} fica livre para qualquer pessoa.`;
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

/** "Ocultar também os 3 comentários visíveis". */
export function hideAlsoLabel(visible: number): string {
  return visible === 1 ? "Ocultar também o comentário visível" : `Ocultar também os ${formatNumber(visible)} comentários visíveis`;
}

/** O resumo do laço do `hideFanComments`. */
export function hiddenSummary(hidden: number): string {
  if (hidden === 0) return "Nenhum comentário visível para ocultar.";
  return hidden === 1 ? "1 comentário ocultado." : `${formatNumber(hidden)} comentários ocultados.`;
}
