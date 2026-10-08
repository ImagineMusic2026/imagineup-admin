import { dayKey, dayStartMs } from "@/lib/day";
import { formatNumber } from "@/lib/format";
import { toDate } from "@/lib/staff";
import { REWARD_KEYS, type RewardDay, type StatsDay } from "@/lib/stats";
import { cleanMultiline, isVisibleLine, isVisibleMultiline } from "@/lib/visible-line";

/**
 * Recompensas e resgates (25 e 26.16), puro: a recompensa e o pedido lidos,
 * as situações, o estoque, o show aberto (espelho do `isEventOpen`), o
 * formulário com a validação do servidor e os números por recompensa.
 */

export const REWARD_KINDS = ["ticket", "videocall", "merch", "screen", "meet"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const KIND_LABELS: Record<RewardKind, string> = {
  ticket: "Ingresso",
  videocall: "Videochamada",
  merch: "Produto",
  screen: "Telão",
  meet: "Encontro",
};

export type RewardStatus = "draft" | "published" | "closed";
export const REWARD_STATUS_LABELS: Record<RewardStatus, string> = { draft: "Rascunho", published: "No ar", closed: "Encerrada" };

export const REDEMPTION_STATUSES = ["requested", "approved", "delivered", "refused", "canceled"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];
export type StatusFilter = RedemptionStatus | "all";

export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  requested: "Solicitado",
  approved: "Aprovado",
  delivered: "Entregue",
  refused: "Recusado",
  canceled: "Cancelado",
};

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  requested: "Solicitados",
  approved: "Aprovados",
  delivered: "Entregues",
  refused: "Recusados",
  canceled: "Cancelados",
  all: "Todos",
};

export const TITLE_MAX = 60;
export const SUBTITLE_MAX = 60;
export const DESCRIPTION_MAX = 1_000;
export const INSTRUCTIONS_MAX = 1_000;
export const COST_MAX = 1_000_000;
export const STOCK_MAX = 100_000;
export const PER_FAN_LIMIT_MAX = 100;
export const DEFAULT_PER_FAN_LIMIT = 1;
export const REFUSAL_REASON_MAX = 200;
export const CONTACTS_MAX = 50;
export const REDEMPTIONS_PAGE_SIZE = 25;
/** A foto da recompensa (paisagem 366 por 196 no app). */
export const REWARD_PHOTO = { width: 1200, height: 643 } as const;

/** Frases da loja que a tela mostra antes de chamar o servidor (as mesmas dele). */
export const WAS_PUBLISHED_TEXT = "Essa recompensa já esteve no ar. Encerre em vez de apagar.";
export const CLOSED_EVENT_WARNING = "Com este show, a recompensa fica esgotada para todos.";
export const CLOSE_FIRST_TEXT = "Encerre a recompensa antes.";
export const CONTACTS_AUDIT_TEXT = "Fica registrado em Logs e auditoria que você viu estes contatos.";
export const RESTOCK_HINT = "Desmarque quando o show foi cancelado ou a recompensa não deve voltar a vender.";

export interface RewardPhoto {
  url: string;
  path: string;
  width: number;
  height: number;
}

export interface Reward {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string | null;
  cost: number;
  photo: RewardPhoto | null;
  featured: boolean;
  scarcity: boolean;
  stockTotal: number | null;
  redeemedCount: number;
  perFanLimit: number | null;
  eventId: string | null;
  instructions: string;
  status: RewardStatus;
  order: number;
  publishedAt: Date | null;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const intOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

function isKind(value: unknown): value is RewardKind {
  return (REWARD_KINDS as readonly unknown[]).includes(value);
}

export function parseReward(id: string, data: Record<string, unknown>): Reward {
  const photo = data.photo && typeof data.photo === "object" ? (data.photo as Record<string, unknown>) : null;
  return {
    id,
    kind: isKind(data.kind) ? data.kind : "merch",
    title: text(data.title) ?? "",
    subtitle: text(data.subtitle) ?? "",
    description: text(data.description),
    cost: count(data.cost),
    photo:
      photo && typeof photo.url === "string" && typeof photo.path === "string"
        ? { url: photo.url, path: photo.path, width: count(photo.width) || REWARD_PHOTO.width, height: count(photo.height) || REWARD_PHOTO.height }
        : null,
    featured: data.featured === true,
    scarcity: data.scarcity === true,
    stockTotal: intOrNull(data.stockTotal),
    redeemedCount: count(data.redeemedCount),
    perFanLimit: intOrNull(data.perFanLimit) || null,
    eventId: text(data.eventId) || null,
    instructions: text(data.instructions) ?? "",
    status: data.status === "published" || data.status === "closed" ? data.status : "draft",
    order: typeof data.order === "number" && Number.isFinite(data.order) ? data.order : 0,
    publishedAt: toDate(data.publishedAt),
  };
}

export interface Redemption {
  code: string;
  rewardId: string;
  rewardTitle: string;
  points: number;
  uid: string | null;
  fanName: string | null;
  fanUsername: string | null;
  status: RedemptionStatus;
  refusalReason: string | null;
  refundedPoints: number;
  restocked: boolean | null;
  requestedAt: Date | null;
  statusAt: Date | null;
  /** Quem mudou por último, da equipe; `null` sem mudança ou pelo sistema. */
  updatedBy: string | null;
  accountDeleted: boolean;
}

export function parseRedemption(code: string, data: Record<string, unknown>): Redemption {
  const by = data.updatedBy && typeof data.updatedBy === "object" ? (data.updatedBy as { name?: unknown }) : null;
  const status = (REDEMPTION_STATUSES as readonly unknown[]).includes(data.status) ? (data.status as RedemptionStatus) : "requested";
  return {
    code,
    rewardId: text(data.rewardId) ?? "",
    rewardTitle: text(data.rewardTitle) ?? "",
    points: count(data.points),
    uid: text(data.uid),
    fanName: text(data.fanName),
    fanUsername: text(data.fanUsername),
    status,
    refusalReason: text(data.refusalReason),
    refundedPoints: count(data.refundedPoints),
    restocked: typeof data.restocked === "boolean" ? data.restocked : null,
    requestedAt: toDate(data.requestedAt),
    statusAt: toDate(data.statusAt),
    updatedBy: typeof by?.name === "string" && by.name ? by.name : null,
    accountDeleted: data.accountDeleted === true,
  };
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export function isOpenRedemption(status: RedemptionStatus): boolean {
  return status === "requested" || status === "approved";
}

/** Abertos do mais antigo (a fila de entrega); fechados e todos, do mais novo (histórico). */
export function redemptionOrder(filter: StatusFilter): "asc" | "desc" {
  return filter === "requested" || filter === "approved" ? "asc" : "desc";
}

/** As ações que o status de agora aceita (as transições do servidor). */
export function redemptionActions(status: RedemptionStatus): ("approve" | "deliver" | "refuse")[] {
  if (status === "requested") return ["approve", "deliver", "refuse"];
  if (status === "approved") return ["deliver", "refuse"];
  return [];
}

/** O código como o servidor guarda: `up4kd9tm` vira `UP-4KD9TM`; vazio, nada. */
export function normalizeCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = clean.startsWith("UP") ? clean.slice(2) : clean;
  return body ? `UP-${body}` : "";
}

export const CODE_PATTERN = /^UP-[A-Z0-9]{6}$/;

/** "Camila Ribeiro · @camilarib"; o pedido anonimizado é "Conta excluída". */
export function fanLine(redemption: Pick<Redemption, "fanName" | "fanUsername" | "accountDeleted">): string {
  if (redemption.accountDeleted) return "Conta excluída";
  const name = redemption.fanName ?? "Fã sem nome";
  return redemption.fanUsername ? `${name} · @${redemption.fanUsername}` : name;
}

/** O motivo da recusa: uma linha visível, até 200; vazio é sem motivo. */
export function validateRefusal(reason: string): { error: string | null; value: string | null } {
  const trimmed = reason.trim();
  if (!trimmed) return { error: null, value: null };
  if (trimmed.length > REFUSAL_REASON_MAX || !isVisibleLine(trimmed)) return { error: `Até ${REFUSAL_REASON_MAX} caracteres, numa linha.`, value: null };
  return { error: null, value: trimmed };
}

/** "Os 6.000 pontos voltam para o saldo do fã." */
export function refundText(points: number): string {
  return points === 1 ? "O 1 ponto volta para o saldo do fã." : `Os ${formatNumber(points)} pontos voltam para o saldo do fã.`;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export interface EventInfo {
  id: string;
  title: string;
  startsAt: Date | null;
  status: string;
}

/** Espelho do `isEventOpen` do servidor: no ar e começando de hoje (São Paulo) em diante. */
export function isEventOpen(event: Pick<EventInfo, "status" | "startsAt"> | null | undefined, now: number): boolean {
  return Boolean(event && event.status === "published" && event.startsAt && event.startsAt.getTime() >= dayStartMs(dayKey(now)));
}

export function remainingOf(reward: Pick<Reward, "stockTotal" | "redeemedCount">): number | null {
  return reward.stockTotal === null ? null : Math.max(0, reward.stockTotal - reward.redeemedCount);
}

/** "3 de 20 restantes" ou "Sem limite". */
export function stockText(reward: Pick<Reward, "stockTotal" | "redeemedCount">): string {
  const remaining = remainingOf(reward);
  if (remaining === null || reward.stockTotal === null) return "Sem limite";
  return `${formatNumber(remaining)} de ${formatNumber(reward.stockTotal)} ${remaining === 1 ? "restante" : "restantes"}`;
}

/** A no ar com o show fechado fica esgotada para todos (o servidor recusa o resgate). */
export function hasClosedEvent(reward: Pick<Reward, "status" | "eventId">, event: EventInfo | null | undefined, now: number): boolean {
  return reward.status === "published" && reward.eventId !== null && !isEventOpen(event, now);
}

/** Esgotada: sem vaga, ou no ar com o show fechado. */
export function isSoldOut(reward: Pick<Reward, "status" | "eventId" | "stockTotal" | "redeemedCount">, event: EventInfo | null | undefined, now: number): boolean {
  return remainingOf(reward) === 0 || hasClosedEvent(reward, event, now);
}

/** Apagar só a que nunca foi ao ar (e então não tem pedido): o motivo da recusa, ou `null`. */
export function deleteBlocked(reward: Pick<Reward, "publishedAt">): string | null {
  return reward.publishedAt ? WAS_PUBLISHED_TEXT : null;
}

/** Os ids que o `reorderRewards` pede: rascunhos e no ar, na ordem de agora (as encerradas ficam fora). */
export function reorderableIds(rewards: readonly Pick<Reward, "id" | "status">[]): string[] {
  return rewards.filter((reward) => reward.status !== "closed").map((reward) => reward.id);
}

/** A ordem nova aplicada à lista inteira: as encerradas ficam onde estavam. */
export function applyRewardOrder<T extends Pick<Reward, "id" | "status">>(rewards: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(rewards.map((reward) => [reward.id, reward]));
  const queue = ids.map((id) => byId.get(id)).filter((reward): reward is T => Boolean(reward));
  let next = 0;
  return rewards.map((reward) => (reward.status === "closed" ? reward : (queue[next++] ?? reward)));
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface RewardForm {
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string;
  cost: string;
  featured: boolean;
  scarcity: boolean;
  stockLimited: boolean;
  stockTotal: string;
  perFanLimited: boolean;
  perFanLimit: string;
  eventId: string;
  instructions: string;
}

export const EMPTY_REWARD_FORM: RewardForm = {
  kind: "ticket",
  title: "",
  subtitle: "",
  description: "",
  cost: "",
  featured: false,
  scarcity: false,
  stockLimited: false,
  stockTotal: "",
  perFanLimited: true,
  perFanLimit: String(DEFAULT_PER_FAN_LIMIT),
  eventId: "",
  instructions: "",
};

export function rewardFormOf(reward: Reward): RewardForm {
  return {
    kind: reward.kind,
    title: reward.title,
    subtitle: reward.subtitle,
    description: reward.description ?? "",
    cost: String(reward.cost),
    featured: reward.featured,
    scarcity: reward.scarcity,
    stockLimited: reward.stockTotal !== null,
    stockTotal: reward.stockTotal === null ? "" : String(reward.stockTotal),
    perFanLimited: reward.perFanLimit !== null,
    perFanLimit: reward.perFanLimit === null ? "" : String(reward.perFanLimit),
    eventId: reward.eventId ?? "",
    instructions: reward.instructions,
  };
}

export interface RewardInput {
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string | null;
  cost: number;
  featured: boolean;
  scarcity: boolean;
  stockTotal: number | null;
  perFanLimit: number | null;
  eventId: string | null;
  instructions: string;
}

export type RewardErrors = Partial<Record<keyof RewardForm | "photo", string>>;

function intIn(value: string, min: number, max: number): number | null {
  const number = Number(value);
  return value.trim() !== "" && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function multiline(value: string, max: number): string | null {
  const cleaned = cleanMultiline(value);
  return cleaned && cleaned.length <= max && isVisibleMultiline(cleaned) ? cleaned : null;
}

/** Confere como o servidor (25.3); o estoque só vale na criação (depois, pelo `setRewardStock`). */
export function validateReward(form: RewardForm): { errors: RewardErrors; input: RewardInput | null } {
  const errors: RewardErrors = {};
  const title = form.title.trim();
  if (!title || title.length > TITLE_MAX || !isVisibleLine(title)) errors.title = `Escreva o título, até ${TITLE_MAX} caracteres, numa linha.`;
  const subtitle = form.subtitle.trim();
  if (!subtitle || subtitle.length > SUBTITLE_MAX || !isVisibleLine(subtitle)) errors.subtitle = `Escreva o subtítulo, até ${SUBTITLE_MAX} caracteres, numa linha.`;
  let description: string | null = null;
  if (cleanMultiline(form.description)) {
    description = multiline(form.description, DESCRIPTION_MAX);
    if (!description) errors.description = `Até ${formatNumber(DESCRIPTION_MAX)} caracteres.`;
  }
  const instructions = multiline(form.instructions, INSTRUCTIONS_MAX);
  if (!instructions) errors.instructions = `Escreva como retirar, até ${formatNumber(INSTRUCTIONS_MAX)} caracteres.`;
  const cost = intIn(form.cost, 1, COST_MAX);
  if (cost === null) errors.cost = `De 1 a ${formatNumber(COST_MAX)} pontos.`;
  const stockTotal = form.stockLimited ? intIn(form.stockTotal, 0, STOCK_MAX) : null;
  if (form.stockLimited && stockTotal === null) errors.stockTotal = `De 0 a ${formatNumber(STOCK_MAX)}, ou sem limite.`;
  const perFanLimit = form.perFanLimited ? intIn(form.perFanLimit, 1, PER_FAN_LIMIT_MAX) : null;
  if (form.perFanLimited && perFanLimit === null) errors.perFanLimit = `De 1 a ${PER_FAN_LIMIT_MAX}, ou sem limite.`;
  if (Object.keys(errors).length > 0 || cost === null || !instructions) return { errors, input: null };
  return {
    errors,
    input: {
      kind: form.kind,
      title,
      subtitle,
      description,
      cost,
      featured: form.featured,
      scarcity: form.scarcity,
      stockTotal,
      perFanLimit,
      eventId: form.eventId || null,
      instructions,
    },
  };
}

export type RewardPatch = Partial<Omit<RewardInput, "stockTotal">>;

/** Só o que mudou, para o `updateReward` (o estoque fica de fora). */
export function rewardChanges(reward: Reward, input: RewardInput): RewardPatch {
  const before: Omit<RewardInput, "stockTotal"> = {
    kind: reward.kind,
    title: reward.title,
    subtitle: reward.subtitle,
    description: reward.description,
    cost: reward.cost,
    featured: reward.featured,
    scarcity: reward.scarcity,
    perFanLimit: reward.perFanLimit,
    eventId: reward.eventId,
    instructions: reward.instructions,
  };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    if (input[key] !== before[key]) patch[key] = input[key];
  }
  return patch as RewardPatch;
}

/** O campo do `invalid-request` no formulário. */
export function rewardFieldOf(field: unknown): keyof RewardForm | null {
  if (typeof field !== "string") return null;
  const keys: (keyof RewardForm)[] = ["kind", "title", "subtitle", "description", "cost", "stockTotal", "perFanLimit", "eventId", "instructions"];
  return (keys as string[]).includes(field) ? (field as keyof RewardForm) : null;
}

/** O estoque do diálogo "Estoque": de 0 a 100.000 e nunca abaixo do resgatado, ou sem limite. */
export function validateStock(limited: boolean, value: string, redeemed: number): { error: string | null; stockTotal: number | null } {
  if (!limited) return { error: null, stockTotal: null };
  const stock = intIn(value, 0, STOCK_MAX);
  if (stock === null) return { error: `De 0 a ${formatNumber(STOCK_MAX)}, ou sem limite.`, stockTotal: null };
  if (stock < redeemed) return { error: `Já foram resgatados ${formatNumber(redeemed)}: o estoque não fica abaixo disso.`, stockTotal: null };
  return { error: null, stockTotal: stock };
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

export interface RewardNumbers {
  requested: number;
  spent: number;
  refunded: number;
  delivered: number;
}

/** Os cartões da aba Números: pedidos, pontos gastos no resgate, devolvidos e entregues. */
export function rewardNumbers(days: readonly StatsDay[]): RewardNumbers {
  return days.reduce(
    (total, day) => ({
      requested: total.requested + day.totals.redeemRequested,
      spent: total.spent + (day.bySource.redeem?.points ?? 0),
      refunded: total.refunded + day.totals.refunded,
      delivered: total.delivered + day.totals.redeemDelivered,
    }),
    { requested: 0, spent: 0, refunded: 0, delivered: 0 },
  );
}

/** A soma por recompensa (`byReward`), da que teve mais pedidos. */
export function rewardTable(days: readonly StatsDay[]): { rewardId: string; numbers: RewardDay }[] {
  const totals = new Map<string, RewardDay>();
  for (const day of days) {
    for (const [rewardId, numbers] of Object.entries(day.byReward)) {
      const current = totals.get(rewardId) ?? (Object.fromEntries(REWARD_KEYS.map((key) => [key, 0])) as RewardDay);
      for (const key of REWARD_KEYS) current[key] += numbers[key];
      totals.set(rewardId, current);
    }
  }
  return [...totals.entries()]
    .map(([rewardId, numbers]) => ({ rewardId, numbers }))
    .sort((a, b) => b.numbers.requested - a.numbers.requested || a.rewardId.localeCompare(b.rewardId));
}
