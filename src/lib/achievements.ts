import { countLabel, formatNumber } from "@/lib/format";
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
/** Sequência de check-in: de 2 a 1.000 dias seguidos, como o servidor (`ACHIEVEMENT_STREAK_MIN` e `ACHIEVEMENT_STREAK_MAX`). */
export const ACHIEVEMENT_STREAK_MIN = 2;
export const ACHIEVEMENT_STREAK_MAX = 1_000;

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

export type AchievementRule = { type: "level"; level: number } | { type: "first"; action: FirstAction } | { type: "rank"; top: number } | { type: "streak"; days: number };
export type RuleType = AchievementRule["type"];

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  level: "Chegar a um nível",
  first: "Fazer algo pela primeira vez",
  rank: "Ficar no top do ranking",
  streak: "Sequência de check-in",
};

const STREAK_RANGE_TEXT = `De ${ACHIEVEMENT_STREAK_MIN} a ${formatNumber(ACHIEVEMENT_STREAK_MAX)}.`;
/** A dica do campo "Dias seguidos": a conquista sai pela melhor sequência do fã, a que nunca volta atrás. */
export const STREAK_DAYS_HINT = `${STREAK_RANGE_TEXT} Sai quando a melhor sequência do fã chega a esse número de dias.`;
/**
 * A conquista de sequência com a chave do check-in desligada: o servidor a
 * deixa fora do que o fã vê e ganha até a chave ligar. O painel continua
 * listando, editando e ordenando.
 */
export const STREAK_KEY_OFF_TEXT = "O check-in diário está desligado: a conquista só aparece para os fãs com ele ligado.";
/** O servidor de antes do check-in não conhece a regra de sequência e recusa a regra inteira, sem gravar nada. */
export const STREAK_RULE_UNKNOWN_TEXT = "O servidor ainda não conhece a regra de sequência de check-in. Publique as funções antes de salvar.";

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
  if (data.type === "streak" && intOf(data.days) !== null) return { type: "streak", days: data.days as number };
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

/** A regra por extenso: "Chegar ao nível 7 · Purainha", "Primeira curtida", "Top 20 do ranking", "Sequência de 30 dias de check-in". */
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
    case "streak":
      return `Sequência de ${countLabel(rule.days, "dia", "dias")} de check-in`;
  }
}

/** "10 de 100". */
export function achievementsUsage(achievements: readonly unknown[]): string {
  return `${achievements.length} de ${ACHIEVEMENTS_MAX}`;
}

// ---------------------------------------------------------------------------
// Situação
// ---------------------------------------------------------------------------

/** A situação mostrada: as gravadas e a da conquista de sequência publicada que aguarda o check-in. */
export type AchievementState = AchievementStatus | "waiting";

export const ACHIEVEMENT_STATE_LABELS: Record<AchievementState, string> = { ...ACHIEVEMENT_STATUS_LABELS, waiting: "Em espera" };

/** A conquista de sequência com a chave do check-in desligada: o servidor a deixa fora do que o fã vê e ganha. */
function waitsForCheckin(rule: AchievementRule, checkinEnabled: boolean): boolean {
  return rule.type === "streak" && !checkinEnabled;
}

/**
 * A situação mostrada, como a "Agendada" das missões: "No ar" é o que o fã vê
 * agora, e a conquista de sequência publicada com a chave do check-in
 * desligada aguarda o check-in. É só o que a tela mostra: as ações continuam
 * decidindo pela situação gravada.
 */
export function achievementState(achievement: Pick<Achievement, "status" | "rule">, checkinEnabled: boolean): AchievementState {
  return achievement.status === "active" && waitsForCheckin(achievement.rule, checkinEnabled) ? "waiting" : achievement.status;
}

/**
 * O corpo da confirmação do "Publicar". A conquista de sequência com a chave
 * do check-in desligada fica publicada sem entrar no app, e a frase diz isso
 * em vez de "entra no app"; nas outras, as frases de sempre.
 */
export function publishConfirmText(achievement: Pick<Achievement, "rule" | "activatedAt">, checkinEnabled: boolean): string {
  if (waitsForCheckin(achievement.rule, checkinEnabled)) {
    return achievement.activatedAt
      ? "A conquista volta a ficar publicada, com a mesma regra, e entra no app quando o check-in diário for ligado."
      : "A conquista fica publicada e entra no app quando o check-in diário for ligado. Depois de publicada, a regra não muda; nome, ícone e cor continuam editáveis.";
  }
  return achievement.activatedAt ? "A conquista volta para o app com a mesma regra." : "A conquista entra no app. Depois de publicada, a regra não muda; nome, ícone e cor continuam editáveis.";
}

/** O aviso depois do "Publicar": "no ar" só quando a conquista chega mesmo aos fãs. */
export function publishedText(achievement: Pick<Achievement, "title" | "rule">, checkinEnabled: boolean): string {
  return waitsForCheckin(achievement.rule, checkinEnabled)
    ? `Conquista ${achievement.title} publicada. Ela aparece para os fãs quando o check-in diário for ligado.`
    : `Conquista ${achievement.title} no ar.`;
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
  /** Os dias seguidos da regra de sequência de check-in. */
  days: string;
}

export const EMPTY_ACHIEVEMENT_FORM: AchievementForm = { title: "", icon: "star", tone: "points", ruleType: "level", level: "", action: "like", top: "20", days: "7" };

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
    days: rule.type === "streak" ? String(rule.days) : "7",
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
  } else if (form.ruleType === "streak") {
    // Ramo próprio: sem ele, a sequência cairia no `else` e seria salva como regra de primeira vez.
    const days = Number(form.days);
    if (!Number.isInteger(days) || days < ACHIEVEMENT_STREAK_MIN || days > ACHIEVEMENT_STREAK_MAX) errors.days = STREAK_RANGE_TEXT;
    else rule = { type: "streak", days };
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

/** O campo do `invalid-request` (`achievement.rule.level`, `achievement.rule.days`) no formulário. */
export function achievementFieldOf(field: unknown): keyof AchievementForm | null {
  if (typeof field !== "string") return null;
  const last = field.split(".").pop() ?? "";
  const map: Record<string, keyof AchievementForm> = { title: "title", icon: "icon", tone: "tone", level: "level", top: "top", action: "action", days: "days", rule: "ruleType" };
  return map[last] ?? null;
}

/**
 * A recusa da regra de sequência pelo servidor de antes do check-in: ele não
 * conhece o tipo e aponta a regra inteira (`achievement.rule`). O servidor
 * novo, com os dias fora da faixa, aponta `achievement.rule.days`.
 */
export function isStreakRuleUnknown(field: unknown, rule: AchievementRule | undefined): boolean {
  return rule?.type === "streak" && field === "achievement.rule";
}
