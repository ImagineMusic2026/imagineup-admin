import { joinPt } from "@/lib/format";
import { ROLES, SECTION_IDS, isRole, isSectionId, sectionInfo, toDate, type SectionId } from "@/lib/staff";

/**
 * Logs e auditoria (26.8 e 26.16), puro: os rótulos das ações, as seções, os
 * alvos, o `details` por extenso e o plano da consulta. O servidor grava em
 * `staffAudit` a `section` e os `targets` (`'<tipo>:<id>'`) de cada entrada,
 * pelo `auditIndex`; os filtros dos Logs consultam por eles.
 *
 * As consultas aceitas são as dos cinco índices (26.11): pessoa, seção,
 * pessoa com seção, ação e alvo, sempre do mais novo, com o período como faixa
 * no `createdAt`. O filtro que não combina fica desligado, com o motivo.
 */

export type AuditSection = SectionId | "team";

/** A seção "Outros" do filtro: ação que o painel não conhece (`section: null`). */
export const OTHER_SECTION = "other";

export interface AuditActionInfo {
  label: string;
  section: AuditSection;
}

/** As ações conhecidas, na ordem da tabela de 26.8. */
export const AUDIT_ACTIONS: Record<string, AuditActionInfo> = {
  "invite.created": { label: "Convite enviado", section: "team" },
  "invite.resent": { label: "Convite reenviado", section: "team" },
  "invite.canceled": { label: "Convite cancelado", section: "team" },
  "invite.accepted": { label: "Convite aceito", section: "team" },
  "member.updated": { label: "Acesso alterado", section: "team" },
  "member.disabled": { label: "Acesso desativado", section: "team" },
  "member.enabled": { label: "Acesso reativado", section: "team" },
  "member.removed": { label: "Membro removido", section: "team" },
  "artist.created": { label: "Central criada", section: "artists" },
  "artist.updated": { label: "Central editada", section: "artists" },
  "artist.published": { label: "Central publicada", section: "artists" },
  "artist.unpublished": { label: "Central tirada do ar", section: "artists" },
  "artist.deleted": { label: "Central apagada", section: "artists" },
  "artist.reordered": { label: "Centrais reordenadas", section: "artists" },
  "post.created": { label: "Post criado", section: "artists" },
  "post.updated": { label: "Post editado", section: "artists" },
  "post.published": { label: "Post publicado", section: "artists" },
  "post.unpublished": { label: "Post tirado do ar", section: "artists" },
  "post.deleted": { label: "Post apagado", section: "artists" },
  "event.created": { label: "Show criado", section: "artists" },
  "event.updated": { label: "Show editado", section: "artists" },
  "event.published": { label: "Show publicado", section: "artists" },
  "event.unpublished": { label: "Show tirado do ar", section: "artists" },
  "event.deleted": { label: "Show apagado", section: "artists" },
  "comment.hidden": { label: "Comentário ocultado", section: "moderation" },
  "comment.kept": { label: "Comentário mantido", section: "moderation" },
  "comment.restored": { label: "Comentário reexibido", section: "moderation" },
  "fan.username.reset": { label: "@ do fã trocado", section: "moderation" },
  "fan.photo.removed": { label: "Foto do fã removida", section: "moderation" },
  "fan.suspended": { label: "Conta suspensa", section: "moderation" },
  "fan.unsuspended": { label: "Suspensão retirada", section: "moderation" },
  "fan.comments.hidden": { label: "Comentários do fã ocultados", section: "moderation" },
  "points.config.updated": { label: "Régua de pontos alterada", section: "missions" },
  "mission.created": { label: "Missão criada", section: "missions" },
  "mission.updated": { label: "Missão editada", section: "missions" },
  "mission.published": { label: "Missão publicada", section: "missions" },
  "mission.archived": { label: "Missão arquivada", section: "missions" },
  "mission.reordered": { label: "Missões reordenadas", section: "missions" },
  "season.goal.updated": { label: "Meta da temporada alterada", section: "missions" },
  "achievement.created": { label: "Conquista criada", section: "missions" },
  "achievement.updated": { label: "Conquista editada", section: "missions" },
  "achievement.published": { label: "Conquista publicada", section: "missions" },
  "achievement.archived": { label: "Conquista arquivada", section: "missions" },
  "achievement.reordered": { label: "Conquistas reordenadas", section: "missions" },
  "config.seeded": { label: "Configuração inicial gravada", section: "missions" },
  "season.updated": { label: "Temporada alterada", section: "ranking" },
  "season.next.updated": { label: "Próxima temporada alterada", section: "ranking" },
  "season.ended": { label: "Temporada encerrada antes da hora", section: "ranking" },
  "season.close.requested": { label: "Fechamento da temporada pedido", section: "ranking" },
  "season.closed": { label: "Temporada fechada", section: "ranking" },
  "reward.created": { label: "Recompensa criada", section: "rewards" },
  "reward.updated": { label: "Recompensa editada", section: "rewards" },
  "reward.published": { label: "Recompensa publicada", section: "rewards" },
  "reward.closed": { label: "Recompensa encerrada", section: "rewards" },
  "reward.stock.updated": { label: "Estoque alterado", section: "rewards" },
  "reward.reordered": { label: "Recompensas reordenadas", section: "rewards" },
  "reward.deleted": { label: "Recompensa apagada", section: "rewards" },
  "redemption.approved": { label: "Resgate aprovado", section: "rewards" },
  "redemption.delivered": { label: "Resgate entregue", section: "rewards" },
  "redemption.refused": { label: "Resgate recusado", section: "rewards" },
  "redemption.contacts.viewed": { label: "Contatos de resgate vistos", section: "rewards" },
  "wallet.adjusted": { label: "Pontos ajustados", section: "fans" },
  "fan.email.lookup": { label: "Fã buscado por e-mail", section: "fans" },
};

/** As seções do filtro, na ordem: Equipe e as do painel, mais "Outros". */
export const AUDIT_SECTIONS: (AuditSection | typeof OTHER_SECTION)[] = ["team", ...SECTION_IDS, OTHER_SECTION];

export function auditSectionLabel(section: AuditSection | typeof OTHER_SECTION | null): string {
  if (section === "team") return "Equipe";
  if (section === null || section === OTHER_SECTION) return "Outros";
  return sectionInfo(section).label;
}

/** As ações de uma seção, para a lista do filtro. */
export function actionsOfSection(section: AuditSection): string[] {
  return Object.entries(AUDIT_ACTIONS)
    .filter(([, info]) => info.section === section)
    .map(([action]) => action);
}

export interface AuditEntry {
  id: string;
  action: string;
  actorUid: string | null;
  actorName: string;
  targetEmail: string;
  targetUid: string | null;
  section: AuditSection | null;
  targets: string[];
  details: Record<string, unknown>;
  createdAt: Date | null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isAuditSection(value: unknown): value is AuditSection {
  return value === "team" || isSectionId(value);
}

export function parseAuditEntry(id: string, data: Record<string, unknown>): AuditEntry {
  const details = data.details && typeof data.details === "object" && !Array.isArray(data.details) ? (data.details as Record<string, unknown>) : {};
  return {
    id,
    action: textOf(data.action),
    actorUid: typeof data.actorUid === "string" && data.actorUid ? data.actorUid : null,
    actorName: textOf(data.actorName),
    targetEmail: textOf(data.targetEmail),
    targetUid: typeof data.targetUid === "string" && data.targetUid ? data.targetUid : null,
    section: isAuditSection(data.section) ? data.section : null,
    targets: Array.isArray(data.targets) ? data.targets.filter((item): item is string => typeof item === "string") : [],
    details,
    createdAt: toDate(data.createdAt),
  };
}

/** O rótulo da ação, com as variantes de 26.8; ação que o painel não conhece aparece crua. */
export function actionLabel(entry: Pick<AuditEntry, "action" | "details">): string {
  if (entry.action === "mission.published" && entry.details.restored === true) return "Missão trazida de volta";
  if (entry.action === "reward.published" && entry.details.reopened === true) return "Recompensa reaberta";
  if (entry.action === "fan.email.lookup" && entry.details.found === false) return "Busca por e-mail sem resultado";
  return AUDIT_ACTIONS[entry.action]?.label ?? entry.action;
}

/** Quem fez: o nome gravado; sem pessoa, o nome do processo ("Virada automática"), ou "Automático". */
export function actorLabel(entry: Pick<AuditEntry, "actorUid" | "actorName">): string {
  if (entry.actorName) return entry.actorName;
  return entry.actorUid ? entry.actorUid : "Automático";
}

// ---------------------------------------------------------------------------
// Alvos
// ---------------------------------------------------------------------------

export const TARGET_TYPES = [
  "fan",
  "artist",
  "post",
  "event",
  "comment",
  "mission",
  "achievement",
  "season",
  "reward",
  "redemption",
  "staff",
  "invite",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const TARGET_LABELS: Record<TargetType, string> = {
  fan: "Fã",
  artist: "Central",
  post: "Post",
  event: "Show",
  comment: "Comentário",
  mission: "Missão",
  achievement: "Conquista",
  season: "Temporada",
  reward: "Recompensa",
  redemption: "Pedido",
  staff: "Membro",
  invite: "Convite",
};

export function isTargetType(value: unknown): value is TargetType {
  return typeof value === "string" && (TARGET_TYPES as readonly string[]).includes(value);
}

export interface Target {
  type: TargetType | null;
  id: string;
}

export function parseTarget(target: string): Target {
  const at = target.indexOf(":");
  const type = at > 0 ? target.slice(0, at) : "";
  return { type: isTargetType(type) ? type : null, id: at > 0 ? target.slice(at + 1) : target };
}

/** O código do pedido como o servidor guarda: `up4kd9tm` e `UP 4KD9TM` viram `UP-4KD9TM`. */
export function normalizeRedemptionCode(text: string): string {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = clean.startsWith("UP") ? clean.slice(2) : clean;
  return body ? `UP-${body}` : "";
}

/** O id do alvo como vai na consulta: o @ sem a arroba, o pedido normalizado, o resto como veio. */
export function normalizeTargetId(type: TargetType, text: string): string {
  const value = text.trim();
  if (type === "redemption") return normalizeRedemptionCode(value);
  if (type === "artist") return value.replace(/^@/, "").toLowerCase();
  return value;
}

/** O alvo principal de uma entrada, para a coluna "Alvo", e quantos mais há. */
export function primaryTarget(entry: Pick<AuditEntry, "targets" | "targetEmail" | "targetUid">): { target: Target | null; email: string | null; more: number } {
  if (entry.targetEmail) {
    return { target: entry.targetUid ? { type: "staff", id: entry.targetUid } : null, email: entry.targetEmail, more: Math.max(0, entry.targets.length - 1) };
  }
  const order: TargetType[] = ["fan", "redemption", "reward", "comment", "post", "event", "artist", "mission", "achievement", "season", "invite", "staff"];
  const parsed = entry.targets.map(parseTarget);
  for (const type of order) {
    const found = parsed.find((target) => target.type === type);
    if (found) return { target: found, email: null, more: parsed.length - 1 };
  }
  return { target: parsed[0] ?? null, email: null, more: Math.max(0, parsed.length - 1) };
}

// ---------------------------------------------------------------------------
// Filtros e o plano da consulta
// ---------------------------------------------------------------------------

export type AuditPeriod = "7" | "30" | "90" | "all";

export const AUDIT_PERIODS: { value: AuditPeriod; label: string }[] = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "all", label: "Tudo" },
];

/** O valor do filtro de pessoa para as entradas sem pessoa (`actorUid == null`). */
export const AUTOMATIC_ACTOR = "__automatico__";

export interface AuditFilters {
  period: AuditPeriod;
  /** Seção, `OTHER_SECTION` ou "" (todas). */
  section: string;
  /** uid, `AUTOMATIC_ACTOR` ou "" (todas). */
  person: string;
  /** Ação, ou "" (todas). Só com uma seção escolhida. */
  action: string;
  /** Alvo já normalizado (`'fan:<uid>'`), ou "". */
  target: string;
}

export const EMPTY_FILTERS: AuditFilters = { period: "30", section: "", person: "", action: "", target: "" };

export type AuditPlan =
  | { kind: "all" }
  | { kind: "person"; actorUid: string | null }
  | { kind: "section"; section: AuditSection | null }
  | { kind: "person-section"; actorUid: string | null; section: AuditSection | null }
  | { kind: "action"; action: string }
  | { kind: "target"; target: string };

function sectionValue(section: string): AuditSection | null {
  return section === OTHER_SECTION ? null : (section as AuditSection);
}

function actorValue(person: string): string | null {
  return person === AUTOMATIC_ACTOR ? null : person;
}

/**
 * A consulta pelos filtros: o alvo vale sozinho (com o período); a ação vale
 * sozinha (sem a seção, que ela já diz, e sem a pessoa); pessoa e seção valem
 * juntas ou cada uma.
 */
export function auditPlan(filters: AuditFilters): AuditPlan {
  if (filters.target) return { kind: "target", target: filters.target };
  if (filters.action) return { kind: "action", action: filters.action };
  if (filters.person && filters.section) {
    return { kind: "person-section", actorUid: actorValue(filters.person), section: sectionValue(filters.section) };
  }
  if (filters.person) return { kind: "person", actorUid: actorValue(filters.person) };
  if (filters.section) return { kind: "section", section: sectionValue(filters.section) };
  return { kind: "all" };
}

/** Por que um filtro está desligado agora, ou `null` quando ele vale. */
export function filterBlocked(filter: "section" | "person" | "action" | "target", filters: AuditFilters): string | null {
  if (filter !== "target" && filters.target) return "Com o alvo, só o período vale.";
  if (filter === "person" && filters.action) return "A busca por ação não combina com a pessoa.";
  if (filter === "action" && !filters.section) return "Escolha uma seção para ver as ações dela.";
  if (filter === "action" && filters.section === OTHER_SECTION) return "As ações de Outros não têm filtro.";
  return null;
}

/** Os filtros depois de uma mudança, já sem o que deixou de combinar. */
export function changeFilters(filters: AuditFilters, change: Partial<AuditFilters>): AuditFilters {
  const next = { ...filters, ...change };
  if ("section" in change && change.section !== filters.section) next.action = "";
  if (next.action) next.person = "";
  return next;
}

/** O começo do período em ms (o dia de São Paulo `days - 1` dias antes de hoje), ou `null` em "Tudo". */
export function periodStartDay(period: AuditPeriod, today: string, shift: (day: string, delta: number) => string): string | null {
  if (period === "all") return null;
  return shift(today, -(Number(period) - 1));
}

// ---------------------------------------------------------------------------
// O `details` por extenso
// ---------------------------------------------------------------------------

/** Nome dos campos mudados (`changed[]`, `fields[]`), por tipo; o desconhecido aparece cru. */
const FIELD_LABELS: Record<string, string> = {
  name: "nome",
  title: "título",
  subtitle: "subtítulo",
  bio: "bio",
  genre: "gênero",
  city: "cidade",
  state: "UF",
  verified: "selo",
  photo: "foto",
  photoPath: "foto",
  thumbPath: "miniatura",
  manager: "gestor",
  managerUid: "gestor",
  imageRights: "autorização de imagem",
  contactEmail: "e-mail de contato",
  contactPhone: "celular de contato",
  text: "texto",
  media: "mídia",
  videoPath: "vídeo",
  eventId: "show",
  featured: "destaque",
  venue: "local",
  startsAt: "início",
  endsAt: "fim",
  timeZone: "fuso",
  artistIds: "centrais",
  cost: "custo",
  stock: "estoque",
  perFanLimit: "limite por fã",
  kind: "tipo",
  description: "descrição",
  values: "valores por ação",
  dailyLimits: "limites do dia",
  actionCaps: "tetos do dia",
  levels: "níveis",
  goal: "meta",
  period: "período",
  rewardPoints: "pontos",
  target: "alvo",
  action: "tipo",
  icon: "ícone",
  tone: "cor",
  rule: "regra",
  leaderTitle: "título do 1º lugar",
  topTarget: "tamanho do top",
  metric: "métrica",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "rascunho",
  published: "no ar",
  unpublished: "fora do ar",
  active: "no ar",
  archived: "arquivada",
  closed: "encerrada",
  requested: "solicitado",
  approved: "aprovado",
  delivered: "entregue",
  refused: "recusado",
  canceled: "cancelado",
  hidden: "oculto",
  visible: "visível",
  kept: "mantido",
};

const SUSPENSION_LABELS: Record<string, string> = { spam: "Spam", offensive: "Ofensivo", harassment: "Assédio", other: "Outro" };

const COUNTERS: Record<string, string> = {
  balance: "Saldo",
  xp: "XP",
  season: "Pontos da temporada",
};

function fieldList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter((item): item is string => typeof item === "string").map((item) => FIELD_LABELS[item] ?? item);
  return names.length > 0 ? joinPt(names) : null;
}

function signed(value: number): string {
  const text = new Intl.NumberFormat("pt-BR").format(Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : "0";
}

function number(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function accessText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { role, sections } = value as { role?: unknown; sections?: unknown };
  const roleText = isRole(role) ? ROLES[role].label : null;
  const list = Array.isArray(sections) ? sections.filter(isSectionId) : [];
  const sectionText =
    role === "admin" || list.length === SECTION_IDS.length ? "todas as seções" : list.length === 0 ? "nenhuma seção" : joinPt(list.map((id) => sectionInfo(id).label));
  return [roleText, sectionText].filter(Boolean).join(", ");
}

function statusText(value: unknown): string {
  return typeof value === "string" ? (STATUS_LABELS[value] ?? value) : String(value);
}

/** Campos que já viram alvo ou que não dizem nada sozinhos. */
const SKIPPED = new Set([
  "artistId",
  "postId",
  "eventId",
  "commentId",
  "missionId",
  "achievementId",
  "seasonId",
  "rewardId",
  "code",
  "inviteId",
  "uid",
  "authorUid",
  "entryId",
]);

/**
 * O `details` em linhas curtas em pt-BR: os campos mudados pelo nome, "de X
 * para Y" nas mudanças de situação e de acesso, a nota e as contagens; listas
 * longas como contagem. Campo que o painel não conhece aparece cru.
 */
export function detailLines(entry: Pick<AuditEntry, "action" | "details">): string[] {
  const details = entry.details;
  const lines: string[] = [];
  const used = new Set<string>();
  const take = (key: string) => {
    used.add(key);
    return details[key];
  };

  const title = take("title") ?? take("name");
  if (typeof title === "string" && title) lines.push(`Nome: ${title}`);

  const changed = fieldList(take("changed")) ?? fieldList(take("fields"));
  if (changed) lines.push(`Campos mudados: ${changed}`);

  const from = take("from");
  const to = take("to");
  if (from !== undefined && to !== undefined) {
    if (from && typeof from === "object") lines.push(`Acesso: de ${accessText(from)} para ${accessText(to)}`);
    else lines.push(`Situação: de ${statusText(from)} para ${statusText(to)}`);
  } else if (from !== undefined) {
    lines.push(`Antes: ${statusText(from)}`);
  }

  const role = take("role");
  const sections = take("sections");
  if (role !== undefined || sections !== undefined) lines.push(`Acesso: ${accessText({ role, sections })}`);

  const before = take("before");
  const after = take("after");
  if (typeof before === "number" && typeof after === "number") lines.push(`De ${number(before)} para ${number(after)}`);
  const redeemed = take("redeemed");
  if (typeof redeemed === "number") lines.push(`Já resgatados: ${number(redeemed)}`);

  for (const counter of Object.keys(COUNTERS)) {
    const value = take(counter);
    if (typeof value === "number" && value !== 0) lines.push(`${COUNTERS[counter]}: ${signed(value)}`);
  }
  const central = take("central");
  if (central && typeof central === "object") {
    const { artistId, season, total } = central as { artistId?: unknown; season?: unknown; total?: unknown };
    const parts = [
      typeof season === "number" && season !== 0 ? `temporada ${signed(season)}` : null,
      typeof total === "number" && total !== 0 ? `de sempre ${signed(total)}` : null,
    ].filter(Boolean);
    lines.push(`Na central @${String(artistId)}: ${parts.join(", ") || "sem mudança"}`);
  }

  const reason = take("reason");
  if (typeof reason === "string") lines.push(`Motivo: ${SUSPENSION_LABELS[reason] ?? reason}`);
  const note = take("note");
  if (typeof note === "string" && note) lines.push(`Nota: ${note}`);

  const previous = take("previous");
  const username = take("username");
  if (typeof previous === "string" && typeof username === "string") lines.push(`@ antigo: @${previous}. @ novo: @${username}`);

  const refunded = take("refundedPoints");
  if (typeof refunded === "number" && refunded > 0) lines.push(`Pontos devolvidos: ${number(refunded)}`);
  const restocked = take("restocked");
  if (restocked === true) lines.push("A vaga voltou ao estoque");
  if (restocked === false) lines.push("A vaga não voltou ao estoque");
  const hasReason = take("hasReason");
  if (hasReason === true) lines.push("Com motivo para o fã");

  const found = take("found");
  if (found === true) lines.push("Achou o fã");
  if (found === false) lines.push("Nenhum fã com esse e-mail");

  const count = take("count") ?? take("hidden");
  if (typeof count === "number") lines.push(`Quantidade: ${number(count)}`);

  const version = take("version");
  if (typeof version === "number") lines.push(`Versão ${number(version)}`);

  const suggested = take("suggestedName");
  if (typeof suggested === "string" && suggested) lines.push(`Nome sugerido: ${suggested}`);
  const created = take("accountCreatedByInvite");
  if (created === true) lines.push("Conta criada pelo convite");
  if (created === false) lines.push("Conta que já existia no app");

  const metric = take("metric");
  const goal = take("target");
  if (typeof metric === "string" && typeof goal === "number") {
    lines.push(`Meta: ${number(goal)} ${metric === "missions" ? "missões concluídas" : "pontos da temporada"}`);
  }

  for (const [key, value] of Object.entries(details)) {
    if (used.has(key) || SKIPPED.has(key)) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) lines.push(`${FIELD_LABELS[key] ?? key}: ${value.length} ${value.length === 1 ? "item" : "itens"}`);
      continue;
    }
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    lines.push(`${FIELD_LABELS[key] ?? key}: ${typeof value === "boolean" ? (value ? "sim" : "não") : String(value)}`);
  }
  return lines;
}
