import { formatDateTime, formatNumber, joinPt } from "@/lib/format";
import { LEVEL_NAME_MAX, LEVELS_MAX, LEVELS_MIN, parseLevels, type Level } from "@/lib/levels";
import { toDate } from "@/lib/staff";

/**
 * A régua de pontos (`config/points`, cláusula 2.4 e 26.16), pura: os
 * valores por ação com o limite do dia, os tetos antiabuso e os níveis. Cada
 * bloco tem o próprio "Salvar" e manda ao `updatePointsConfig` só o que
 * mudou. Sem o documento (versão 0), nada aparece como valor: a tela diz que
 * a régua ainda não foi gravada (decisão 15).
 */

export const VALUE_SOURCES = ["like", "comment", "rsvp", "central_join", "invite_visit", "invite_signup"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

export const VALUE_LABELS: Record<ValueSource, string> = {
  like: "Curtida",
  comment: "Comentário",
  rsvp: "Presença em show",
  central_join: "Entrada na central",
  invite_visit: "Visita pelo link",
  invite_signup: "Cadastro pelo link",
};

export const ACTION_CAP_KEYS = [
  "central_entry",
  "invite_visit_sent",
  "invite_link",
  "like_set",
  "comment_sent",
  "rsvp_set",
  "comment_report",
  "fan_block",
  "photo_set",
  "reward_redeem",
] as const;
export type ActionCapKey = (typeof ACTION_CAP_KEYS)[number];

export const ACTION_CAP_LABELS: Record<ActionCapKey, string> = {
  central_entry: "Entradas em central",
  invite_visit_sent: "Visitas enviadas",
  invite_link: "Links criados",
  like_set: "Curtidas",
  comment_sent: "Comentários",
  rsvp_set: "Presenças",
  comment_report: "Denúncias",
  fan_block: "Bloqueios",
  photo_set: "Trocas de foto",
  reward_redeem: "Resgates",
};

export const VALUE_MAX = 10_000;
export const LIMIT_MAX = 1_000;
export const CAP_MAX = 10_000;

export const NO_POINTS_CONFIG_TEXT = "A régua ainda não foi gravada no servidor.";
export const POINTS_RULE_TEXT = "Valor novo vale para as próximas ações; o que já foi lançado não muda.";
export const LEVELS_CONFIRM_TEXT = "Mudar o XP mínimo muda o nível mostrado de todos os fãs na hora. Nenhum ponto muda.";

export interface PointsConfig {
  version: number;
  values: Record<ValueSource, number>;
  /** `null` é sem limite. */
  dailyLimits: Record<ValueSource, number | null>;
  actionCaps: Record<ActionCapKey, number>;
  levels: Level[];
  updatedAt: Date | null;
  updatedBy: string | null;
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

/** O documento gravado, ou `null` sem documento ou na versão 0 (as ações ficam desligadas). */
export function parsePointsConfig(data: Record<string, unknown> | undefined): PointsConfig | null {
  if (!data || intOr(data.version, 0) < 1) return null;
  const levels = parseLevels(data);
  if (!levels) return null;
  const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
  const values = record(data.values);
  const limits = record(data.dailyLimits);
  const caps = record(data.actionCaps);
  const by = record(data.updatedBy);
  return {
    version: data.version as number,
    values: Object.fromEntries(VALUE_SOURCES.map((source) => [source, intOr(values[source], 0)])) as Record<ValueSource, number>,
    dailyLimits: Object.fromEntries(
      VALUE_SOURCES.map((source) => [source, typeof limits[source] === "number" ? (limits[source] as number) : null]),
    ) as Record<ValueSource, number | null>,
    actionCaps: Object.fromEntries(ACTION_CAP_KEYS.map((key) => [key, intOr(caps[key], 0)])) as Record<ActionCapKey, number>,
    levels,
    updatedAt: toDate(data.updatedAt),
    updatedBy: typeof by.name === "string" ? by.name : null,
  };
}

/** "Versão 4, alterada por Ana em 6 de outubro, 14:30." */
export function versionText(config: Pick<PointsConfig, "version" | "updatedAt" | "updatedBy">): string {
  const when = config.updatedAt ? ` em ${formatDateTime(config.updatedAt)}` : "";
  return config.updatedBy ? `Versão ${config.version}, alterada por ${config.updatedBy}${when}.` : `Versão ${config.version}, gravada${when}.`;
}

/** "Sem limite" ou "50 por dia". */
export function limitText(limit: number | null): string {
  return limit === null ? "Sem limite" : `${formatNumber(limit)} por dia`;
}

// ---------------------------------------------------------------------------
// Valores e limites
// ---------------------------------------------------------------------------

export interface ValueRow {
  points: string;
  limited: boolean;
  limit: string;
}

export type ValuesForm = Record<ValueSource, ValueRow>;

export function valuesFormOf(config: PointsConfig): ValuesForm {
  return Object.fromEntries(
    VALUE_SOURCES.map((source) => {
      const limit = config.dailyLimits[source];
      return [source, { points: String(config.values[source]), limited: limit !== null, limit: limit === null ? "" : String(limit) }];
    }),
  ) as ValuesForm;
}

export type RowErrors = Partial<Record<"points" | "limit", string>>;

export interface ValuesChanges {
  values?: Partial<Record<ValueSource, number>>;
  dailyLimits?: Partial<Record<ValueSource, number | null>>;
}

function isIntIn(text: string, min: number, max: number): boolean {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
}

/** Confere os valores (0 a 10.000) e os limites (1 a 1.000, ou sem limite) e devolve só o que mudou. */
export function validateValues(form: ValuesForm, config: PointsConfig): { errors: Partial<Record<ValueSource, RowErrors>>; changes: ValuesChanges | null } {
  const errors: Partial<Record<ValueSource, RowErrors>> = {};
  const values: Partial<Record<ValueSource, number>> = {};
  const dailyLimits: Partial<Record<ValueSource, number | null>> = {};
  for (const source of VALUE_SOURCES) {
    const row = form[source];
    const rowErrors: RowErrors = {};
    if (!isIntIn(row.points, 0, VALUE_MAX)) rowErrors.points = `De 0 a ${formatNumber(VALUE_MAX)}.`;
    if (row.limited && !isIntIn(row.limit, 1, LIMIT_MAX)) rowErrors.limit = `De 1 a ${formatNumber(LIMIT_MAX)}, ou sem limite.`;
    if (rowErrors.points || rowErrors.limit) {
      errors[source] = rowErrors;
      continue;
    }
    const points = Number(row.points);
    const limit = row.limited ? Number(row.limit) : null;
    if (points !== config.values[source]) values[source] = points;
    if (limit !== config.dailyLimits[source]) dailyLimits[source] = limit;
  }
  if (Object.keys(errors).length > 0) return { errors, changes: null };
  const changes: ValuesChanges = {};
  if (Object.keys(values).length > 0) changes.values = values;
  if (Object.keys(dailyLimits).length > 0) changes.dailyLimits = dailyLimits;
  return { errors, changes };
}

// ---------------------------------------------------------------------------
// Tetos do dia
// ---------------------------------------------------------------------------

export type CapsForm = Record<ActionCapKey, string>;

export function capsFormOf(config: PointsConfig): CapsForm {
  return Object.fromEntries(ACTION_CAP_KEYS.map((key) => [key, String(config.actionCaps[key])])) as CapsForm;
}

export function validateCaps(form: CapsForm, config: PointsConfig): { errors: Partial<Record<ActionCapKey, string>>; changes: Partial<Record<ActionCapKey, number>> | null } {
  const errors: Partial<Record<ActionCapKey, string>> = {};
  const changes: Partial<Record<ActionCapKey, number>> = {};
  for (const key of ACTION_CAP_KEYS) {
    if (!isIntIn(form[key], 1, CAP_MAX)) {
      errors[key] = `De 1 a ${formatNumber(CAP_MAX)}.`;
      continue;
    }
    const value = Number(form[key]);
    if (value !== config.actionCaps[key]) changes[key] = value;
  }
  return Object.keys(errors).length > 0 ? { errors, changes: null } : { errors, changes };
}

// ---------------------------------------------------------------------------
// Níveis
// ---------------------------------------------------------------------------

export interface LevelRow {
  /** Chave estável da linha na tela (o número muda quando se tira o último). */
  key: string;
  name: string;
  minXp: string;
}

export function levelsFormOf(levels: readonly Level[]): LevelRow[] {
  return levels.map((level) => ({ key: `n${level.number}`, name: level.name, minXp: String(level.minXp) }));
}

export type LevelErrors = Record<string, Partial<Record<"name" | "minXp", string>>>;

/**
 * A régua do formulário, conferida como o servidor: de 2 a 50 degraus, nome
 * até 40, o primeiro em 0 XP e cada um acima do anterior.
 */
export function validateLevelsForm(rows: readonly LevelRow[]): { errors: LevelErrors; message: string | null; levels: Level[] | null } {
  const errors: LevelErrors = {};
  if (rows.length < LEVELS_MIN || rows.length > LEVELS_MAX) {
    return { errors, message: `A régua tem de ${LEVELS_MIN} a ${LEVELS_MAX} níveis.`, levels: null };
  }
  let previous: number | null = null;
  rows.forEach((row, index) => {
    const rowErrors: Partial<Record<"name" | "minXp", string>> = {};
    const name = row.name.trim();
    if (!name || name.length > LEVEL_NAME_MAX || /[\r\n]/.test(row.name)) rowErrors.name = `Escreva o nome, até ${LEVEL_NAME_MAX} caracteres.`;
    const minXp = Number(row.minXp);
    if (index === 0) {
      if (row.minXp.trim() !== "0") rowErrors.minXp = "O nível 1 começa em 0 XP.";
    } else if (row.minXp.trim() === "" || !Number.isInteger(minXp) || minXp < 0) {
      rowErrors.minXp = "Escreva o XP mínimo, um número inteiro.";
    } else if (previous !== null && minXp <= previous) {
      rowErrors.minXp = `Precisa ser maior que ${formatNumber(previous)}, o do nível ${index}.`;
    }
    if (rowErrors.name || rowErrors.minXp) errors[row.key] = rowErrors;
    if (row.minXp.trim() !== "" && Number.isInteger(minXp)) previous = minXp;
  });
  if (Object.keys(errors).length > 0) return { errors, message: null, levels: null };
  return { errors, message: null, levels: rows.map((row, index) => ({ number: index + 1, name: row.name.trim(), minXp: Number(row.minXp) })) };
}

export function sameLevels(a: readonly Level[], b: readonly Level[]): boolean {
  return a.length === b.length && a.every((level, index) => level.number === b[index].number && level.name === b[index].name && level.minXp === b[index].minXp);
}

/** Algum XP mínimo mudou, ou degraus entraram ou saíram (o que muda o nível mostrado dos fãs). */
export function levelsChangeXp(before: readonly Level[], after: readonly Level[]): boolean {
  return before.length !== after.length || before.some((level, index) => level.minXp !== after[index].minXp);
}

/** "Acrescentar nível": um degrau novo no fim, com o XP sugerido acima do último. */
export function addLevelRow(rows: readonly LevelRow[], key: string): LevelRow[] {
  const last = Number(rows.at(-1)?.minXp);
  const suggestion = Number.isInteger(last) ? String(last + 1000) : "";
  return [...rows, { key, name: "", minXp: suggestion }];
}

/** O `level-in-use`, depois da frase do servidor: "Conquistas que pedem um nível que sai: Backstage (nível 8) e Lenda (nível 10)." */
export function levelInUseList(achievementIds: readonly string[], achievements: readonly { id: string; title: string; rule: { type: string; level?: number } }[]): string {
  const listed = achievementIds.map((id) => {
    const found = achievements.find((item) => item.id === id);
    if (!found) return id;
    return found.rule.type === "level" && found.rule.level ? `${found.title} (nível ${found.rule.level})` : found.title;
  });
  return `${listed.length === 1 ? "Conquista que pede" : "Conquistas que pedem"} um nível que sai: ${joinPt(listed)}.`;
}
