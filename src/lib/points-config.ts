import { errorDetails, isConfigChanged, mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import { formatDateTime, formatNumber, joinPt } from "@/lib/format";
import { LEVEL_NAME_MAX, LEVELS_MAX, LEVELS_MIN, parseLevels, type Level } from "@/lib/levels";
import { toDate } from "@/lib/staff";

/**
 * A régua de pontos (`config/points`, cláusula 2.4 e 26.16), pura: os
 * valores por ação com o limite do dia, o check-in diário (a chave e os
 * pontos do ciclo), os tetos antiabuso e os níveis. Cada bloco tem o próprio
 * "Salvar" e manda ao `updatePointsConfig` só o que mudou; o do check-in manda
 * o bloco dele inteiro. Sem o documento (versão 0), nada aparece como valor:
 * a tela diz que a régua ainda não foi gravada (decisão 15).
 */

export const VALUE_SOURCES = ["like", "comment", "rsvp", "central_join", "invite_visit", "invite_signup", "fanclub_like", "fanclub_comment"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

export const VALUE_LABELS: Record<ValueSource, string> = {
  like: "Curtida",
  comment: "Comentário",
  rsvp: "Presença em show",
  central_join: "Entrada na central",
  invite_visit: "Visita pelo link",
  invite_signup: "Cadastro pelo link",
  fanclub_like: "Reação no fã-clube",
  fanclub_comment: "Comentário no fã-clube",
};

/**
 * A dica embaixo da origem (37.5): as do fã-clube nascem em 0, valem só no
 * fã-clube (o saldo, o XP e a temporada do fã) e não contam nas missões.
 */
export const VALUE_HINTS: Partial<Record<ValueSource, string>> = {
  fanclub_like: "Nasce em 0. Vale só no fã-clube, uma vez por publicação, e não conta nas missões.",
  fanclub_comment: "Nasce em 0. Vale só no fã-clube e não conta nas missões.",
};

/**
 * O limite do dia que o servidor usa quando a chave nunca foi gravada (o
 * `DEFAULT_POINTS_CONFIG.dailyLimits` de 37.5), só das origens que chegaram
 * depois da régua de produção: sem ele, o limite ausente apareceria como "Sem
 * limite", e o servidor usa 50 e 20. O `null` gravado continua sem limite.
 */
export const DEFAULT_DAILY_LIMITS: Partial<Record<ValueSource, number>> = {
  fanclub_like: 50,
  fanclub_comment: 20,
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
  "photo_upload",
  "profile_save",
  "name_change",
  "fanclub_apply",
  "fanclub_post",
  "fanclub_upload",
  "fanclub_follow",
  "fanclub_reaction_set",
  "fanclub_comment_sent",
  "support_message",
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
  photo_upload: "Envios de foto",
  profile_save: "Salvamentos do perfil",
  name_change: "Trocas de nome",
  fanclub_apply: "Candidaturas a fã-clube",
  fanclub_post: "Publicações de fã-clube",
  fanclub_upload: "Fotos de fã-clube",
  fanclub_follow: "Seguir fã-clubes",
  fanclub_reaction_set: "Reações no fã-clube",
  fanclub_comment_sent: "Comentários no fã-clube",
  support_message: "Mensagens de suporte",
};

/**
 * O padrão de cada teto no servidor (`DEFAULT_ACTION_CAPS`, 22.3, 27.4 e
 * 28.3, os do fã-clube da 34.1, decisões 11 e 34, os da Fase 2, 37.5: dar e
 * trocar de reação e comentar no fã-clube, e o do Suporte, seção 38: as
 * mensagens dos Ajustes, somando os três tipos): vale quando o documento
 * gravado não tem a chave, ou tem um valor fora da regra, como o servidor faz
 * ao ler. Sem isso a chave ausente viraria 0, e o bloco inteiro dos tetos
 * deixaria de salvar.
 */
export const DEFAULT_ACTION_CAPS: Record<ActionCapKey, number> = {
  central_entry: 30,
  invite_visit_sent: 20,
  invite_link: 30,
  like_set: 300,
  comment_sent: 100,
  rsvp_set: 50,
  comment_report: 30,
  fan_block: 30,
  photo_set: 10,
  reward_redeem: 10,
  photo_upload: 20,
  profile_save: 20,
  name_change: 5,
  fanclub_apply: 3,
  fanclub_post: 5,
  fanclub_upload: 10,
  fanclub_follow: 30,
  fanclub_reaction_set: 300,
  fanclub_comment_sent: 100,
  support_message: 5,
};

export const VALUE_MAX = 10_000;
export const LIMIT_MAX = 1_000;
export const CAP_MAX = 10_000;

/**
 * O ciclo do check-in diário: sempre 7 dias, cada um de 1 a 999 pontos ao
 * salvar. O teto é do check-in, e não o do `VALUE_MAX`: um valor de quatro
 * dígitos é cortado na trilha do app num celular pequeno, e um check-in por
 * dia não precisa dele. O servidor tem o mesmo teto (o `CHECKIN_VALUE_MAX` de
 * `functions/src/checkin/model.ts`): mudou lá, muda aqui.
 */
export const CHECKIN_CYCLE_DAYS = 7;
export const CHECKIN_VALUE_MIN = 1;
export const CHECKIN_VALUE_MAX = 999;

export interface CheckinConfig {
  /** A chave: desligada, o app não mostra o check-in e o servidor não paga. */
  enabled: boolean;
  /** Os pontos de cada dia do ciclo, do dia 1 ao dia 7. */
  cycle: number[];
}

/**
 * O padrão do check-in diário no servidor (o `DEFAULT_CHECKIN_CONFIG` de
 * `functions/src/checkin/model.ts`), copiado à mão: a chave nasce desligada e
 * o ciclo é 3, 3, 4, 4, 5, 6 e 15. Vale quando o `config/points` gravado não
 * tem o bloco (o de produção, até a primeira gravação da régua pelo servidor
 * novo), como o servidor faz ao ler. Quem lê recebe sempre uma cópia do
 * ciclo, nunca esta lista.
 */
export const DEFAULT_CHECKIN: CheckinConfig = { enabled: false, cycle: [3, 3, 4, 4, 5, 6, 15] };

export const NO_POINTS_CONFIG_TEXT = "A régua ainda não foi gravada no servidor.";
export const POINTS_RULE_TEXT = "Valor novo vale para as próximas ações; o que já foi lançado não muda.";
export const LEVELS_CONFIRM_TEXT = "Mudar o XP mínimo muda o nível mostrado de todos os fãs na hora. Nenhum ponto muda.";

/** O estado gravado da chave do check-in, por extenso no bloco. */
export const CHECKIN_OFF_TEXT = "Desligado: o app não mostra o check-in e o servidor não paga.";
export const CHECKIN_ON_TEXT = "Ligado: o app mostra o check-in e o servidor paga os pontos do dia.";
/** O ciclo e os marcos, embaixo da chave: o marco é conquista, nunca ponto a mais. */
export const CHECKIN_CYCLE_TEXT =
  "Um check-in por dia. O fã ganha os pontos do dia do ciclo em que a sequência dele está: depois do dia 7, o ciclo volta ao dia 1 e a sequência continua contando. Quem pula um dia recomeça do dia 1, sem perder os pontos que já ganhou.";
export const CHECKIN_MILESTONES_TEXT =
  "Os marcos da sequência, como 7 ou 30 dias seguidos, são conquistas, criadas na aba Conquistas com a regra Sequência de check-in, e não dão pontos.";
/**
 * A confirmação antes de salvar a chave, nas duas direções, com o que
 * acontece de verdade: ligada, o app e o servidor levam até 1 minuto para
 * notar (o cache da configuração na `api`); desligada, nada avança, e a
 * sequência só vive enquanto o último check-in é de hoje ou de ontem. Quem
 * ainda não fez o de hoje perde a sequência na virada do dia (a meia-noite de
 * Brasília) se a chave não voltar antes, mesmo desligada por minutos; com um
 * dia inteiro desligada, todas recomeçam do dia 1 (a chave é a do lançamento,
 * não uma pausa).
 */
export const CHECKIN_CONFIRM = {
  on: {
    title: "Ligar o check-in diário?",
    text: "Os fãs passam a ver o check-in no app e a ganhar pontos por ele. A mudança vale em até 1 minuto.",
    action: "Ligar check-in",
  },
  off: {
    title: "Desligar o check-in diário?",
    text: "O check-in some do app e ninguém pontua por ele. Quem ainda não fez o check-in de hoje perde a sequência se ele não voltar antes da meia-noite (horário de Brasília). Com um dia inteiro desligado, todas as sequências recomeçam do dia 1.",
    action: "Desligar check-in",
  },
} as const;
export const CHECKIN_SAVED_TEXT = "Check-in diário salvo.";
/** O servidor de antes do check-in recusa a chave que não conhece, sem gravar nada. */
export const CHECKIN_UNKNOWN_TEXT = "O servidor ainda não conhece o check-in diário. Publique as funções antes de salvar.";
/**
 * A resposta que volta com a versão parada: o servidor só responde assim
 * quando o bloco gravado já é igual ao mandado (o documento mexido à mão no
 * console, sem a versão andar, com a aba aberta). Nada foi gravado agora: o
 * bloco assume esse estado e a tela diz isso, sem dizer "salvo".
 */
export const CHECKIN_UNCHANGED_TEXT = "O check-in diário já estava assim no servidor. A tela foi atualizada.";
/**
 * A falha incerta dentro da confirmação da chave. A frase das outras telas
 * manda conferir a lista, e a régua não tem lista: o que diz se a chave mudou
 * é a linha do estado do bloco, atrás do diálogo, que a página lê de novo.
 */
export const CHECKIN_UNCERTAIN_TEXT = "Não deu para confirmar se a mudança foi gravada. Volte e confira a linha do estado do check-in antes de repetir.";

export interface PointsConfig {
  version: number;
  values: Record<ValueSource, number>;
  /** `null` é sem limite. */
  dailyLimits: Record<ValueSource, number | null>;
  /** O check-in diário: o bloco gravado ou, sem ele, o padrão do servidor (a chave desligada). */
  checkin: CheckinConfig;
  actionCaps: Record<ActionCapKey, number>;
  levels: Level[];
  updatedAt: Date | null;
  updatedBy: string | null;
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

/** O teto gravado, se estiver na regra (inteiro de 1 a 10.000); senão, o padrão do servidor. */
function capOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CAP_MAX ? value : fallback;
}

/** O limite gravado; a chave nunca gravada de uma origem nova vale o padrão do servidor, e o resto ausente, sem limite. */
function limitOf(limits: Record<string, unknown>, source: ValueSource): number | null {
  const value = limits[source];
  if (typeof value === "number") return value;
  if (value === undefined && DEFAULT_DAILY_LIMITS[source] !== undefined) return DEFAULT_DAILY_LIMITS[source];
  return null;
}

function isCheckinCycle(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === CHECKIN_CYCLE_DAYS &&
    value.every((points: unknown) => typeof points === "number" && Number.isInteger(points) && points >= 0 && points <= CHECKIN_VALUE_MAX)
  );
}

/**
 * O bloco do check-in gravado, lido como o servidor lê (`parseCheckinConfig`):
 * sem o bloco ou fora do formato, o padrão; a chave só liga com `true`; o
 * ciclo só vale com 7 inteiros de 0 a 999 (o 0 é tolerado ao ler, não ao
 * salvar; o teto é o do `CHECKIN_VALUE_MAX`), senão o ciclo padrão inteiro. O
 * ciclo devolvido é sempre uma cópia.
 */
function checkinOf(value: unknown): CheckinConfig {
  const data = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const cycle = data?.cycle;
  return { enabled: data?.enabled === true, cycle: isCheckinCycle(cycle) ? [...cycle] : [...DEFAULT_CHECKIN.cycle] };
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
    dailyLimits: Object.fromEntries(VALUE_SOURCES.map((source) => [source, limitOf(limits, source)])) as Record<ValueSource, number | null>,
    checkin: checkinOf(data.checkin),
    actionCaps: Object.fromEntries(ACTION_CAP_KEYS.map((key) => [key, capOr(caps[key], DEFAULT_ACTION_CAPS[key])])) as Record<ActionCapKey, number>,
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
// Check-in diário
// ---------------------------------------------------------------------------

export interface CheckinForm {
  enabled: boolean;
  /** Os pontos do dia 1 ao dia 7, como o texto dos campos. */
  days: string[];
}

export function checkinFormOf(config: PointsConfig): CheckinForm {
  return { enabled: config.checkin.enabled, days: config.checkin.cycle.map(String) };
}

/**
 * O nome do campo de cada dia para o leitor de tela ("Dia 1" é o que a tela
 * mostra). O id do campo sai deste nome, então ele precisa ser único na aba
 * inteira: os sete diferem pelo dia, e nenhum outro rótulo da régua fala de
 * check-in.
 */
export function checkinDayLabel(day: number): string {
  return `Pontos do dia ${day} do check-in`;
}

/** O erro de cada campo, pelo dia do ciclo (de 1 a 7). */
export type CheckinErrors = Partial<Record<number, string>>;

export interface CheckinChanges {
  checkin?: CheckinConfig;
}

/**
 * Confere os sete valores como o servidor ao gravar (inteiros de 1 a 999; o 0
 * não entra: quem desliga é a chave) e devolve o bloco inteiro, a chave e
 * o ciclo juntos, quando algo nele mudou: o que a confirmação mostra é o que
 * vai gravado. Sem mudança, nada vai.
 */
export function validateCheckin(form: CheckinForm, config: PointsConfig): { errors: CheckinErrors; changes: CheckinChanges | null } {
  const errors: CheckinErrors = {};
  form.days.forEach((text, index) => {
    if (!isIntIn(text, CHECKIN_VALUE_MIN, CHECKIN_VALUE_MAX)) errors[index + 1] = `De ${CHECKIN_VALUE_MIN} a ${formatNumber(CHECKIN_VALUE_MAX)}.`;
  });
  if (Object.keys(errors).length > 0) return { errors, changes: null };
  const cycle = form.days.map(Number);
  const saved = config.checkin;
  const same = form.enabled === saved.enabled && cycle.length === saved.cycle.length && cycle.every((points, index) => points === saved.cycle[index]);
  return { errors, changes: same ? {} : { checkin: { enabled: form.enabled, cycle } } };
}

/** O campo do `invalid-request` (`checkin.cycle.3`) como o dia do ciclo (o 4); outro campo, `null`. */
export function checkinFieldOf(field: unknown): number | null {
  if (typeof field !== "string") return null;
  const match = /^checkin\.cycle\.(\d+)$/.exec(field);
  if (!match) return null;
  const index = Number(match[1]);
  return index < CHECKIN_CYCLE_DAYS ? index + 1 : null;
}

/**
 * O servidor de antes do check-in recusa a chave que não conhece: o
 * `invalid-request` vem com o campo `checkin` sozinho. Como o painel manda o
 * bloco inteiro e conferido, o servidor novo só aponta um campo de dentro
 * (`checkin.enabled`, `checkin.cycle` ou `checkin.cycle.<i>`).
 */
export function isCheckinUnknown(field: unknown): boolean {
  return field === "checkin";
}

/**
 * O "Salvar check-in" gravou? Toda mudança gravada devolve a versão seguinte à
 * mandada; a resposta com a versão parada diz que o bloco gravado já era igual
 * ao mandado, e a tela não diz "salvo" numa chave que não mudou agora. Sem a
 * versão na resposta não dá para saber, e vale como nos outros blocos.
 */
export function checkinSaved(result: { version?: unknown }, expectedVersion: number): boolean {
  return typeof result.version !== "number" || result.version > expectedVersion;
}

/** O que um "Salvar check-in" manda: o bloco conferido e a versão da régua de que ele saiu. */
export interface CheckinPending {
  checkin: CheckinConfig;
  version: number;
}

/**
 * O passo do "Salvar check-in" depois da conferência: a chave que muda pede a
 * confirmação antes (`on` ao ligar, `off` ao desligar), e nada vai ao servidor
 * sem ela; só os pontos salvam direto (`null`). O pedido fica preso à versão
 * da régua de que o bloco saiu (`base`), também enquanto espera a confirmação:
 * se a página ler uma versão nova com o diálogo aberto, o bloco de antes vai
 * com a versão de antes e o servidor responde `config-changed`, em vez de
 * gravar por cima da mudança de outra pessoa.
 */
export function checkinSaveStep(checkin: CheckinConfig, base: Pick<PointsConfig, "version" | "checkin">): { confirm: "on" | "off" | null; pending: CheckinPending } {
  const confirm = checkin.enabled === base.checkin.enabled ? null : checkin.enabled ? "on" : "off";
  return { confirm, pending: { checkin, version: base.version } };
}

/** O pedido ao `updatePointsConfig`: a versão presa ao bloco e o bloco inteiro, e nada dos outros blocos. */
export function checkinRequestOf(pending: CheckinPending): { expectedVersion: number; checkin: CheckinConfig } {
  return { expectedVersion: pending.version, checkin: pending.checkin };
}

/** A falha de um "Salvar check-in", já separada; o que a tela faz com cada uma fica no bloco. */
export type CheckinFailure = { kind: "changed" } | { kind: "unknown" } | { kind: "day"; day: number } | { kind: "other"; uncertain: boolean };

/**
 * A triagem da falha, nesta ordem: a régua mudou por fora (`config-changed`,
 * antes de olhar qualquer campo); o servidor de antes do check-in (o campo
 * `checkin` sozinho); um dia recusado (`checkin.cycle.<i>`, o dia i + 1); e o
 * resto, que mostra a frase do servidor e diz se a falha pode ter gravado
 * (`uncertain`: a resposta se perdeu, e a tela lê de novo).
 */
export function checkinFailureOf(failure: unknown): CheckinFailure {
  const field = reasonOf(failure) === "invalid-request" ? errorDetails(failure).field : null;
  const day = checkinFieldOf(field);
  if (isConfigChanged(failure)) return { kind: "changed" };
  if (isCheckinUnknown(field)) return { kind: "unknown" };
  if (day !== null) return { kind: "day", day };
  return { kind: "other", uncertain: mayHaveRunOnServer(failure) };
}

/** "Pontos do dia 1 ao dia 7: 3, 3, 4, 4, 5, 6 e 15.": o ciclo que vai junto, na confirmação de ligar. */
export function cycleSummary(cycle: readonly number[]): string {
  return `Pontos do dia 1 ao dia ${cycle.length}: ${joinPt(cycle.map((points) => formatNumber(points)))}.`;
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
