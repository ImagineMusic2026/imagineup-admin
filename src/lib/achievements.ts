import type { Level } from "@/lib/levels";
import { toDate } from "@/lib/staff";

/**
 * Conquistas (22.6 e 26.16), puro: o catálogo (`config/achievements`), a
 * regra por extenso, a situação e o formulário com a validação espelhada do
 * servidor. A arquivada continua no documento (fica na carteira de quem
 * ganhou) e conta no "N de 100".
 */

export const ACHIEVEMENTS_MAX = 100;
export const ACHIEVEMENT_TITLE_MAX = 40;
export const ACHIEVEMENT_LEVEL_MIN = 2;
export const ACHIEVEMENT_LEVEL_MAX = 50;
/** Posição no ranking: até 200, a primeira página do retrato e da virada. */
export const ACHIEVEMENT_RANK_MAX = 200;

export const FIRST_ACTIONS = ["like", "comment", "rsvp", "join", "share", "invite", "mission"] as const;
export type FirstAction = (typeof FIRST_ACTIONS)[number];

export const FIRST_ACTION_LABELS: Record<FirstAction, string> = {
  like: "Primeira curtida",
  comment: "Primeiro comentário",
  rsvp: "Primeira presença em show",
  join: "Primeira entrada numa central",
  share: "Primeiro compartilhamento",
  invite: "Primeiro convite",
  mission: "Primeira missão concluída",
};

export type AchievementRule = { type: "level"; level: number } | { type: "first"; action: FirstAction } | { type: "rank"; top: number };
export type RuleType = AchievementRule["type"];

export const RULE_TYPE_LABELS: Record<RuleType, string> = { level: "Chegar a um nível", first: "Fazer algo pela primeira vez", rank: "Ficar no top do ranking" };

export const ACHIEVEMENT_TONES = ["action", "points", "events"] as const;
export type AchievementTone = (typeof ACHIEVEMENT_TONES)[number];
export const TONE_LABELS: Record<AchievementTone, string> = { action: "Ação", points: "Pontos", events: "Shows" };

/** As chaves que o app desenha (`ACHIEVEMENT_GLYPHS` e `ACHIEVEMENT_ICONS`); outra cai num ícone genérico lá. */
export const ACHIEVEMENT_ICONS = ["star", "trophy", "flame", "share", "comment", "heart", "ticket", "calendar", "users"] as const;
export type AchievementIcon = (typeof ACHIEVEMENT_ICONS)[number];
export const ICON_LABELS: Record<AchievementIcon, string> = {
  star: "Estrela",
  trophy: "Taça",
  flame: "Chama",
  share: "Compartilhar",
  comment: "Balão de conversa",
  heart: "Coração",
  ticket: "Ingresso",
  calendar: "Calendário",
  users: "Pessoas",
};

export function isKnownIcon(value: string): value is AchievementIcon {
  return (ACHIEVEMENT_ICONS as readonly string[]).includes(value);
}

export type AchievementStatus = "draft" | "active" | "archived";
export const ACHIEVEMENT_STATUS_LABELS: Record<AchievementStatus, string> = { draft: "Rascunho", active: "No ar", archived: "Arquivada" };

export interface Achievement {
  id: string;
  title: string;
  icon: string;
  tone: AchievementTone;
  rule: AchievementRule;
  status: AchievementStatus;
  /** A primeira publicação: depois dela a regra não muda. */
  activatedAt: Date | null;
}

export interface AchievementsCatalog {
  version: number;
  achievements: Achievement[];
  updatedAt: Date | null;
  updatedBy: string | null;
}

function intOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseRule(value: unknown): AchievementRule | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.type === "level" && intOf(data.level) !== null) return { type: "level", level: data.level as number };
  if (data.type === "rank" && intOf(data.top) !== null) return { type: "rank", top: data.top as number };
  if (data.type === "first" && (FIRST_ACTIONS as readonly unknown[]).includes(data.action)) return { type: "first", action: data.action as FirstAction };
  return null;
}

export function parseAchievement(value: unknown): Achievement | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const rule = parseRule(data.rule);
  if (typeof data.id !== "string" || typeof data.title !== "string" || !rule) return null;
  return {
    id: data.id,
    title: data.title,
    icon: typeof data.icon === "string" ? data.icon : "",
    tone: (ACHIEVEMENT_TONES as readonly unknown[]).includes(data.tone) ? (data.tone as AchievementTone) : "points",
    rule,
    status: data.status === "active" ? "active" : data.status === "archived" ? "archived" : "draft",
    activatedAt: toDate(data.activatedAt),
  };
}

export function parseAchievementsCatalog(data: Record<string, unknown> | undefined): AchievementsCatalog {
  const by = data?.updatedBy && typeof data.updatedBy === "object" ? (data.updatedBy as { name?: unknown }) : null;
  return {
    version: typeof data?.version === "number" ? data.version : 0,
    achievements: Array.isArray(data?.achievements) ? data.achievements.map(parseAchievement).filter((item): item is Achievement => item !== null) : [],
    updatedAt: toDate(data?.updatedAt),
    updatedBy: typeof by?.name === "string" ? by.name : null,
  };
}

/** A regra por extenso: "Chegar ao nível 7 · Purainha", "Primeira curtida", "Top 20 do ranking". */
export function ruleText(rule: AchievementRule, levels: readonly Level[] | null = null): string {
  switch (rule.type) {
    case "level": {
      const name = levels?.find((level) => level.number === rule.level)?.name;
      return name ? `Chegar ao nível ${rule.level} · ${name}` : `Chegar ao nível ${rule.level}`;
    }
    case "first":
      return FIRST_ACTION_LABELS[rule.action];
    case "rank":
      return `Top ${rule.top} do ranking`;
  }
}

/** "10 de 100". */
export function achievementsUsage(achievements: readonly unknown[]): string {
  return `${achievements.length} de ${ACHIEVEMENTS_MAX}`;
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface AchievementForm {
  title: string;
  icon: string;
  tone: AchievementTone;
  ruleType: RuleType;
  level: string;
  action: FirstAction;
  top: string;
}

export const EMPTY_ACHIEVEMENT_FORM: AchievementForm = { title: "", icon: "star", tone: "points", ruleType: "level", level: "", action: "like", top: "20" };

export function achievementFormOf(achievement: Achievement): AchievementForm {
  const { rule } = achievement;
  return {
    title: achievement.title,
    icon: achievement.icon,
    tone: achievement.tone,
    ruleType: rule.type,
    level: rule.type === "level" ? String(rule.level) : "",
    action: rule.type === "first" ? rule.action : "like",
    top: rule.type === "rank" ? String(rule.top) : "20",
  };
}

export interface AchievementInput {
  title: string;
  icon: string;
  tone: AchievementTone;
  rule: AchievementRule;
}

export type AchievementErrors = Partial<Record<keyof AchievementForm, string>>;

/** Confere como o servidor; o nível também contra a régua de agora (o servidor recusa degrau que ela não tem). */
export function validateAchievement(form: AchievementForm, levelCount: number | null): { errors: AchievementErrors; input: AchievementInput | null } {
  const errors: AchievementErrors = {};
  const title = form.title.trim();
  if (!title || title.length > ACHIEVEMENT_TITLE_MAX || /[\r\n]/.test(form.title)) errors.title = `Escreva o nome, até ${ACHIEVEMENT_TITLE_MAX} caracteres.`;
  if (!/^[a-z0-9-]{1,30}$/.test(form.icon)) errors.icon = "Escolha o ícone.";
  let rule: AchievementRule | null = null;
  if (form.ruleType === "level") {
    const level = Number(form.level);
    const max = Math.min(ACHIEVEMENT_LEVEL_MAX, levelCount ?? ACHIEVEMENT_LEVEL_MAX);
    if (!form.level || !Number.isInteger(level) || level < ACHIEVEMENT_LEVEL_MIN || level > max) errors.level = `Escolha um nível de ${ACHIEVEMENT_LEVEL_MIN} a ${max}.`;
    else rule = { type: "level", level };
  } else if (form.ruleType === "rank") {
    const top = Number(form.top);
    if (!Number.isInteger(top) || top < 1 || top > ACHIEVEMENT_RANK_MAX) errors.top = `De 1 a ${ACHIEVEMENT_RANK_MAX}.`;
    else rule = { type: "rank", top };
  } else {
    rule = { type: "first", action: form.action };
  }
  if (Object.keys(errors).length > 0 || !rule) return { errors, input: null };
  return { errors, input: { title, icon: form.icon, tone: form.tone, rule } };
}

export function sameRule(a: AchievementRule, b: AchievementRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Só o que mudou; publicada, a regra fica de fora. */
export function achievementChanges(achievement: Achievement, input: AchievementInput): Partial<AchievementInput> {
  const changes: Partial<AchievementInput> = {};
  if (input.title !== achievement.title) changes.title = input.title;
  if (input.icon !== achievement.icon) changes.icon = input.icon;
  if (input.tone !== achievement.tone) changes.tone = input.tone;
  if (achievement.activatedAt === null && !sameRule(input.rule, achievement.rule)) changes.rule = input.rule;
  return changes;
}

/** O campo do `invalid-request` (`achievement.rule.level`) no formulário. */
export function achievementFieldOf(field: unknown): keyof AchievementForm | null {
  if (typeof field !== "string") return null;
  const last = field.split(".").pop() ?? "";
  const map: Record<string, keyof AchievementForm> = { title: "title", icon: "icon", tone: "tone", level: "level", top: "top", action: "action", rule: "ruleType" };
  return map[last] ?? null;
}
