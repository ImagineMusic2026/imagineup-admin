/**
 * Modelo da equipe do painel, espelho do contrato combinado com o backend
 * (`imagineup-app/functions`). Tudo aqui é puro: sem Firebase, sem React, para
 * os testes em `tests/` importarem direto pelo Node.
 *
 * Isto só decide o que a tela mostra. Quem protege os dados são as regras do
 * Firestore e as Cloud Functions, que leem `staff/{uid}` a cada pedido.
 */

export const SECTION_IDS = [
  "overview",
  "growth",
  "ranking",
  "fans",
  "artists",
  "missions",
  "rewards",
  "moderation",
  "audit",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type Role = "admin" | "editor" | "viewer";

export type StaffStatus = "pending" | "active" | "disabled";

export type SectionGroup = "monitor" | "community" | "operation" | "system";

export interface SectionInfo {
  id: SectionId;
  route: string;
  label: string;
  group: SectionGroup;
  /** Subtítulo do cabeçalho da página. */
  description: string;
}

export const SECTIONS: readonly SectionInfo[] = [
  { id: "overview", route: "/", label: "Visão geral", group: "monitor", description: "Retrato do app: ativos, cadastros, pontos e missões." },
  { id: "growth", route: "/crescimento", label: "Crescimento", group: "monitor", description: "Cadastros, ativos e retenção ao longo do tempo." },
  { id: "ranking", route: "/ranking", label: "Ranking e temporadas", group: "monitor", description: "Ranking dos fãs e temporadas de pontos." },
  { id: "fans", route: "/fas", label: "Fãs", group: "community", description: "Busca, ficha, pontos e origem dos fãs." },
  { id: "artists", route: "/artistas", label: "Artistas e centrais", group: "community", description: "As centrais dos artistas no app: foto, selo e ordem de destaque." },
  { id: "missions", route: "/missoes", label: "Missões", group: "operation", description: "Missões, conquistas e a régua de pontos." },
  { id: "rewards", route: "/recompensas", label: "Recompensas e resgates", group: "operation", description: "Catálogo de recompensas e pedidos de resgate." },
  { id: "moderation", route: "/moderacao", label: "Moderação", group: "operation", description: "Denúncias, comentários e as ferramentas de cada fã." },
  { id: "audit", route: "/logs", label: "Logs e auditoria", group: "system", description: "Quem fez o quê no painel, e quando." },
];

/** A página Equipe não é uma seção liberável: só admin vê. */
export const TEAM_PAGE = {
  route: "/equipe",
  label: "Equipe",
  group: "system" as SectionGroup,
  description: "Quem entra no painel, com qual nível e em quais seções.",
};

export const SECTION_GROUPS: readonly { id: SectionGroup; label: string }[] = [
  { id: "monitor", label: "Monitorar" },
  { id: "community", label: "Comunidade" },
  { id: "operation", label: "Operação" },
  { id: "system", label: "Sistema" },
];

export const ROLE_IDS: readonly Role[] = ["admin", "editor", "viewer"];

export const ROLES: Record<Role, { label: string; description: string }> = {
  admin: { label: "Admin", description: "Acesso total e gerencia a equipe" },
  editor: { label: "Editor", description: "Vê e altera as seções liberadas" },
  viewer: { label: "Leitor", description: "Só vê as seções liberadas" },
};

export const STATUS_LABELS: Record<StaffStatus, string> = {
  active: "Ativo",
  disabled: "Desativado",
  pending: "Pendente",
};

export interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  sections: SectionId[];
  status: StaffStatus;
  accountCreatedByInvite: boolean;
  inviteId: string | null;
  invitedBy: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type InviteStatus = "pending" | "accepted" | "canceled";
export type EmailStatus = "sent" | "failed" | "skipped";

export interface StaffInvite {
  id: string;
  email: string;
  suggestedName: string | null;
  role: Role;
  sections: SectionId[];
  status: InviteStatus;
  expiresAt: Date | null;
  invitedByName: string;
  createdAt: Date | null;
  lastSentAt: Date | null;
  sendCount: number;
  emailStatus: EmailStatus;
}

// ---------------------------------------------------------------------------
// Leitura defensiva dos documentos
// ---------------------------------------------------------------------------

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && (SECTION_IDS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "editor" || value === "viewer";
}

function isStaffStatus(value: unknown): value is StaffStatus {
  return value === "pending" || value === "active" || value === "disabled";
}

/** Converte Timestamp do Firestore (ou Date, ou ISO) em Date. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Seções na ordem da lateral, sem repetição e sem ids desconhecidos. */
export function orderSections(sections: readonly unknown[]): SectionId[] {
  const wanted = new Set(sections.filter(isSectionId));
  return SECTION_IDS.filter((id) => wanted.has(id));
}

/**
 * Documento `staff/{uid}` como a tela usa. Campo estranho vira o valor mais
 * restrito: papel desconhecido vira Leitor e status desconhecido vira
 * desativado, para um documento torto nunca abrir mais do que devia.
 */
export function parseStaffMember(uid: string, data: Record<string, unknown>): StaffMember {
  return {
    uid,
    email: text(data.email),
    displayName: text(data.displayName),
    role: isRole(data.role) ? data.role : "viewer",
    sections: orderSections(Array.isArray(data.sections) ? data.sections : []),
    status: isStaffStatus(data.status) ? data.status : "disabled",
    accountCreatedByInvite: data.accountCreatedByInvite === true,
    inviteId: textOrNull(data.inviteId),
    invitedBy: textOrNull(data.invitedBy),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function parseStaffInvite(id: string, data: Record<string, unknown>): StaffInvite {
  const status = data.status;
  const emailStatus = data.emailStatus;
  return {
    id,
    email: text(data.email),
    suggestedName: textOrNull(data.suggestedName),
    role: isRole(data.role) ? data.role : "viewer",
    sections: orderSections(Array.isArray(data.sections) ? data.sections : []),
    status: status === "accepted" || status === "canceled" ? status : "pending",
    expiresAt: toDate(data.expiresAt),
    invitedByName: text(data.invitedByName),
    createdAt: toDate(data.createdAt),
    lastSentAt: toDate(data.lastSentAt),
    sendCount: typeof data.sendCount === "number" ? data.sendCount : 1,
    emailStatus: emailStatus === "sent" || emailStatus === "skipped" ? emailStatus : "failed",
  };
}

// ---------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------

export type AccessState = "active" | "disabled" | "none";

/**
 * O que o guard faz com o documento da própria pessoa: só `active` entra.
 * `pending` é a marca que o servidor grava antes de criar a conta, então conta
 * como sem acesso (o aceite termina com `active`).
 */
export function accessStateOf(member: Pick<StaffMember, "status"> | null): AccessState {
  if (!member) return "none";
  if (member.status === "active") return "active";
  if (member.status === "disabled") return "disabled";
  return "none";
}

type Permissions = Pick<StaffMember, "role" | "sections" | "status">;

export function isActiveStaff(member: Permissions | null): boolean {
  return member?.status === "active";
}

export function isAdmin(member: Permissions | null): boolean {
  return isActiveStaff(member) && member?.role === "admin";
}

export function allowedSections(member: Permissions | null): SectionId[] {
  if (!member || !isActiveStaff(member)) return [];
  if (member.role === "admin") return [...SECTION_IDS];
  return orderSections(member.sections);
}

export function canSeeSection(member: Permissions | null, section: SectionId): boolean {
  return allowedSections(member).includes(section);
}

export function canEditSection(member: Permissions | null, section: SectionId): boolean {
  if (!member || !isActiveStaff(member)) return false;
  if (member.role === "admin") return true;
  return member.role === "editor" && member.sections.includes(section);
}

export function canManageTeam(member: Permissions | null): boolean {
  return isAdmin(member);
}

export function sectionInfo(id: SectionId): SectionInfo {
  const info = SECTIONS.find((section) => section.id === id);
  if (!info) throw new Error(`Seção desconhecida: ${id}`);
  return info;
}

/** Primeira rota liberada, na ordem da lateral. `null` quando não há nenhuma. */
export function firstAllowedRoute(member: Permissions | null): string | null {
  const [first] = allowedSections(member);
  if (first) return sectionInfo(first).route;
  return isAdmin(member) ? TEAM_PAGE.route : null;
}

/** Qual página da lateral corresponde ao endereço. */
export function pageForPathname(pathname: string): SectionId | "team" | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (clean === TEAM_PAGE.route || clean.startsWith(`${TEAM_PAGE.route}/`)) return "team";
  if (clean === "/") return "overview";
  const match = SECTIONS.find((section) => section.route !== "/" && (clean === section.route || clean.startsWith(`${section.route}/`)));
  return match ? match.id : null;
}

export interface NavItem {
  key: SectionId | "team";
  route: string;
  label: string;
}

export interface NavGroup {
  id: SectionGroup;
  label: string;
  items: NavItem[];
}

/** Grupos da lateral com só o que a pessoa pode ver; grupo vazio some. */
export function navGroupsFor(member: Permissions | null): NavGroup[] {
  const allowed = new Set(allowedSections(member));
  const admin = isAdmin(member);
  return SECTION_GROUPS.map((group) => {
    const items: NavItem[] = SECTIONS.filter((section) => section.group === group.id && allowed.has(section.id)).map(
      (section) => ({ key: section.id, route: section.route, label: section.label }),
    );
    if (admin && group.id === TEAM_PAGE.group) {
      items.push({ key: "team", route: TEAM_PAGE.route, label: TEAM_PAGE.label });
    }
    return { id: group.id, label: group.label, items };
  }).filter((group) => group.items.length > 0);
}

// ---------------------------------------------------------------------------
// Textos derivados
// ---------------------------------------------------------------------------

export function roleLabel(role: Role): string {
  return ROLES[role].label;
}

/** Legenda curta do cartão da pessoa na lateral. */
export function accessSummary(member: Permissions): string {
  if (member.role === "admin") return "Admin · acesso total";
  const count = allowedSections({ ...member, status: "active" }).length;
  return `${roleLabel(member.role)} · ${count} ${count === 1 ? "seção" : "seções"}`;
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Resumo das seções para a lista da equipe e dos convites. */
export function sectionsSummary(role: Role, sections: readonly SectionId[]): string {
  const ordered = role === "admin" ? [...SECTION_IDS] : orderSections(sections);
  if (ordered.length === SECTION_IDS.length) return "Todas as seções";
  if (ordered.length === 0) return "Nenhuma seção";
  const labels = ordered.map((id) => sectionInfo(id).label);
  if (labels.length <= 2) return joinPt(labels);
  return `${labels.slice(0, 2).join(", ")} e mais ${labels.length - 2}`;
}

/** Iniciais para o avatar: primeira letra do primeiro e do último nome. */
export function initialsOf(name: string, fallbackEmail = ""): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const source = words.length > 0 ? words : [fallbackEmail.split("@")[0] ?? ""];
  const first = Array.from(source[0] ?? "")[0] ?? "";
  const last = source.length > 1 ? (Array.from(source[source.length - 1])[0] ?? "") : "";
  const initials = `${first}${last}`.toLocaleUpperCase("pt-BR");
  return initials || "?";
}

/** Ordem da lista da equipe: ativos, pendentes e desativados; admin antes; nome. */
export function sortMembers<T extends Pick<StaffMember, "status" | "role" | "displayName" | "email">>(members: readonly T[]): T[] {
  const statusOrder: Record<StaffStatus, number> = { active: 0, pending: 1, disabled: 2 };
  const roleOrder: Record<Role, number> = { admin: 0, editor: 1, viewer: 2 };
  return [...members].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      roleOrder[a.role] - roleOrder[b.role] ||
      (a.displayName || a.email).localeCompare(b.displayName || b.email, "pt-BR", { sensitivity: "base" }),
  );
}

/** Convites pendentes do mais novo para o mais velho (a consulta não ordena). */
export function sortInvites<T extends Pick<StaffInvite, "createdAt">>(invites: readonly T[]): T[] {
  return [...invites].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/** Título do diálogo de reenvio: "reenviado" só quando o e-mail saiu de fato. */
export function resendResultTitle(emailStatus: EmailStatus): string {
  return emailStatus === "sent" ? "Convite reenviado" : "Link novo gerado";
}

/**
 * Texto da confirmação de desativar. Desativar não mexe no login, mas só quem
 * ligou o painel a uma conta que já existia no app tem, com certeza, uma conta
 * de fã que continua funcionando; quem ganhou a conta no convite não tem perfil de fã.
 */
export function deactivateMemberText(name: string, accountCreatedByInvite: boolean): string {
  const lead = `${name} sai do painel na hora e não entra até você reativar.`;
  return accountCreatedByInvite
    ? `${lead} O login não é apagado: se a pessoa também usa o app ImagineUP como fã, essa conta continua funcionando.`
    : `${lead} A conta de fã no app ImagineUP continua funcionando.`;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function isInviteExpired(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() <= now.getTime();
}

/** "Vence em 3 dias", "Vence em 5 horas", "Vencido". */
export function inviteExpiryLabel(expiresAt: Date | null, now: Date): string {
  if (isInviteExpired(expiresAt, now) || !expiresAt) return "Vencido";
  const diff = expiresAt.getTime() - now.getTime();
  if (diff < HOUR) return "Vence em menos de 1 hora";
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `Vence em ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  const days = Math.max(1, Math.round(diff / DAY));
  return `Vence em ${days} ${days === 1 ? "dia" : "dias"}`;
}

/** Mora em `format.ts`; daqui segue saindo para os imports de antes. */
export { formatDateTime } from "@/lib/format";
