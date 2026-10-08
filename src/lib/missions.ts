import { dayKey, localToMs, msToLocal, shiftDay, type DayRange } from "@/lib/day";
import { formatDay, formatTime } from "@/lib/format";
import { toDate } from "@/lib/staff";

/**
 * Missões e meta da temporada (22.8 e 26.16), puro: o catálogo
 * (`config/missions`) e o arquivo (`missionArchive`) lidos, a situação como o
 * app mostra (22.9), os alvos aceitos por tipo, a trava depois do começo e o
 * formulário com a validação espelhada do servidor.
 */

export const MISSION_ACTIONS = ["like", "comment", "rsvp", "join", "share", "invite"] as const;
export type MissionAction = (typeof MISSION_ACTIONS)[number];
export const MISSION_PERIODS = ["daily", "weekly"] as const;
export type MissionPeriod = (typeof MISSION_PERIODS)[number];

export const MISSION_TITLE_MAX = 80;
export const MISSION_GOAL_MAX = 50;
export const MISSION_REWARD_MAX = 10_000;
export const MISSIONS_MAX = 60;
export const ACTIVE_MISSIONS_MAX = 30;
export const MISSION_WINDOW_MAX_DAYS = 366;
/** O cache do catálogo na `api` (60 s): a trava vale também perto do começo. */
export const CONFIG_TTL_MS = 60_000;

export const ACTION_LABELS: Record<MissionAction, string> = {
  like: "Curtir",
  comment: "Comentar",
  rsvp: "Presença em show",
  join: "Entrar na central",
  share: "Compartilhar",
  invite: "Convidar",
};

export const PERIOD_LABELS: Record<MissionPeriod, string> = { daily: "Diária", weekly: "Semanal" };

export type TargetKind = "none" | "post" | "artist" | "event";

/** Alvos aceitos por tipo (22.1, decisão 4); o `join` exige a central. */
export const ACCEPTED_TARGETS: Record<MissionAction, readonly TargetKind[]> = {
  like: ["none", "artist", "post"],
  comment: ["none", "artist", "post"],
  rsvp: ["none", "artist", "event"],
  join: ["artist"],
  share: ["none", "post", "artist"],
  invite: ["none"],
};

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  none: "Qualquer um",
  post: "Um post",
  artist: "Uma central",
  event: "Um show",
};

export interface MissionTarget {
  postId: string | null;
  artistId: string | null;
  eventId: string | null;
}

export function targetKindOf(target: MissionTarget | null): TargetKind {
  if (!target) return "none";
  if (target.postId) return "post";
  if (target.eventId) return "event";
  if (target.artistId) return "artist";
  return "none";
}

/** Alvo único: a meta é sempre 1 (o post em curtir e comentar, o show em presença, a central em entrar). */
export function isSingleTarget(action: MissionAction, kind: TargetKind): boolean {
  return ((action === "like" || action === "comment") && kind === "post") || (action === "rsvp" && kind === "event") || (action === "join" && kind === "artist");
}

export interface Mission {
  id: string;
  title: string;
  action: MissionAction;
  target: MissionTarget | null;
  goal: number;
  period: MissionPeriod;
  rewardPoints: number;
  featured: boolean;
  startsAt: Date;
  endsAt: Date | null;
  status: "draft" | "active" | "archived";
  activatedAt: Date | null;
  archivedAt: Date | null;
}

function isAction(value: unknown): value is MissionAction {
  return typeof value === "string" && (MISSION_ACTIONS as readonly string[]).includes(value);
}

function readTarget(value: unknown): MissionTarget | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const text = (item: unknown) => (typeof item === "string" && item ? item : null);
  return { postId: text(data.postId), artistId: text(data.artistId), eventId: text(data.eventId) };
}

export function parseMission(value: unknown): Mission | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const startsAt = toDate(data.startsAt);
  if (typeof data.id !== "string" || typeof data.title !== "string" || !isAction(data.action) || !startsAt) return null;
  return {
    id: data.id,
    title: data.title,
    action: data.action,
    target: readTarget(data.target),
    goal: typeof data.goal === "number" ? data.goal : 1,
    period: data.period === "weekly" ? "weekly" : "daily",
    rewardPoints: typeof data.rewardPoints === "number" ? data.rewardPoints : 0,
    featured: data.featured === true,
    startsAt,
    endsAt: toDate(data.endsAt),
    status: data.status === "active" ? "active" : data.status === "archived" ? "archived" : "draft",
    activatedAt: toDate(data.activatedAt),
    archivedAt: toDate(data.archivedAt),
  };
}

export interface SeasonGoal {
  seasonId: string;
  title: string;
  description: string;
  reachedDescription: string | null;
  metric: "missions" | "points";
  target: number;
}

export interface MissionsCatalog {
  version: number;
  missions: Mission[];
  seasonGoal: SeasonGoal | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export function parseMissionsCatalog(data: Record<string, unknown> | undefined): MissionsCatalog {
  const goal = data?.seasonGoal && typeof data.seasonGoal === "object" ? (data.seasonGoal as Record<string, unknown>) : null;
  const by = data?.updatedBy && typeof data.updatedBy === "object" ? (data.updatedBy as { name?: unknown }) : null;
  return {
    version: typeof data?.version === "number" ? data.version : 0,
    missions: Array.isArray(data?.missions) ? data.missions.map(parseMission).filter((item): item is Mission => item !== null) : [],
    seasonGoal:
      goal && typeof goal.seasonId === "string"
        ? {
            seasonId: goal.seasonId,
            title: typeof goal.title === "string" ? goal.title : "",
            description: typeof goal.description === "string" ? goal.description : "",
            reachedDescription: typeof goal.reachedDescription === "string" ? goal.reachedDescription : null,
            metric: goal.metric === "points" ? "points" : "missions",
            target: typeof goal.target === "number" ? goal.target : 0,
          }
        : null,
    updatedAt: toDate(data?.updatedAt),
    updatedBy: typeof by?.name === "string" ? by.name : null,
  };
}

// ---------------------------------------------------------------------------
// Situação
// ---------------------------------------------------------------------------

export type MissionState = "draft" | "active" | "scheduled" | "ended" | "archived";

export const MISSION_STATE_LABELS: Record<MissionState, string> = {
  draft: "Rascunho",
  active: "No ar",
  scheduled: "Agendada",
  ended: "Encerrada",
  archived: "Arquivada",
};

/** Como o app (22.9): arquivada, rascunho, encerrada (fim no passado), agendada (começa no futuro) ou no ar. */
export function missionState(mission: Pick<Mission, "status" | "startsAt" | "endsAt">, now: number): MissionState {
  if (mission.status === "archived") return "archived";
  if (mission.status === "draft") return "draft";
  if (mission.endsAt && mission.endsAt.getTime() <= now) return "ended";
  if (mission.startsAt.getTime() > now) return "scheduled";
  return "active";
}

/** Já publicada e o começo passou (ou chega no cache de 60 s): tipo, alvo, meta, período e início não mudam. */
export function isMissionLocked(mission: Pick<Mission, "activatedAt" | "startsAt">, now: number): boolean {
  return mission.activatedAt !== null && mission.startsAt.getTime() <= now + CONFIG_TTL_MS;
}

/** No ar para o limite do servidor: as `active` do catálogo (agendadas e encerradas inclusive). */
export function activeCount(missions: readonly Pick<Mission, "status">[]): number {
  return missions.filter((mission) => mission.status === "active").length;
}

/** "18 de 30 no ar. 26 de 60 no catálogo." */
export function catalogUsage(missions: readonly Pick<Mission, "status">[]): string {
  return `${activeCount(missions)} de ${ACTIVE_MISSIONS_MAX} no ar. ${missions.length} de ${MISSIONS_MAX} no catálogo.`;
}

/** A missão cruza a janela da temporada (a temporada de uma missão sai das datas, decisão 16). */
export function crossesWindow(mission: Pick<Mission, "startsAt" | "endsAt">, window: { startsAt: Date; endsAt: Date }): boolean {
  const end = mission.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return mission.startsAt.getTime() < window.endsAt.getTime() && end > window.startsAt.getTime();
}

/** O artista da missão para o filtro: a central do alvo, ou "" (sem central). */
export function missionArtist(mission: Pick<Mission, "target">): string {
  return mission.target?.artistId ?? "";
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface MissionForm {
  title: string;
  action: MissionAction;
  targetKind: TargetKind;
  artistId: string;
  postId: string;
  eventId: string;
  goal: string;
  period: MissionPeriod;
  rewardPoints: string;
  featured: boolean;
  startsAt: string;
  endsAt: string;
}

export function emptyMissionForm(now: number): MissionForm {
  return {
    title: "",
    action: "like",
    targetKind: "none",
    artistId: "",
    postId: "",
    eventId: "",
    goal: "1",
    period: "daily",
    rewardPoints: "",
    featured: false,
    startsAt: msToLocal(now).slice(0, 11) + "00:00",
    endsAt: "",
  };
}

export function missionFormOf(mission: Mission): MissionForm {
  return {
    title: mission.title,
    action: mission.action,
    targetKind: targetKindOf(mission.target),
    artistId: mission.target?.artistId ?? "",
    postId: mission.target?.postId ?? "",
    eventId: mission.target?.eventId ?? "",
    goal: String(mission.goal),
    period: mission.period,
    rewardPoints: String(mission.rewardPoints),
    featured: mission.featured,
    startsAt: msToLocal(mission.startsAt.getTime()),
    endsAt: mission.endsAt ? msToLocal(mission.endsAt.getTime()) : "",
  };
}

export interface MissionInput {
  title: string;
  action: MissionAction;
  target: MissionTarget | null;
  goal: number;
  period: MissionPeriod;
  rewardPoints: number;
  featured: boolean;
  startsAt: number;
  endsAt: number | null;
}

export type MissionErrors = Partial<Record<keyof MissionForm, string>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** O alvo do formulário no formato do servidor (as três chaves, `null` as que não valem). */
export function targetOf(form: Pick<MissionForm, "targetKind" | "artistId" | "postId" | "eventId">): MissionTarget | null {
  switch (form.targetKind) {
    case "none":
      return null;
    case "artist":
      return { postId: null, artistId: form.artistId || null, eventId: null };
    case "post":
      return { postId: form.postId || null, artistId: form.artistId || null, eventId: null };
    case "event":
      return { postId: null, artistId: null, eventId: form.eventId || null };
  }
}

/** Confere como o servidor: título, alvo aceito pelo tipo, meta (1 no alvo único), pontos, janela. */
export function validateMission(form: MissionForm): { errors: MissionErrors; input: MissionInput | null } {
  const errors: MissionErrors = {};
  const title = form.title.trim();
  if (!title || title.length > MISSION_TITLE_MAX || /[\r\n]/.test(form.title)) errors.title = `Escreva o título, até ${MISSION_TITLE_MAX} caracteres.`;
  if (!ACCEPTED_TARGETS[form.action].includes(form.targetKind)) errors.targetKind = "Esse alvo não vale para esse tipo de missão.";
  if (form.targetKind === "artist" && !form.artistId) errors.artistId = "Escolha a central.";
  if (form.targetKind === "post" && !form.postId) errors.postId = "Escolha o post.";
  if (form.targetKind === "event" && !form.eventId) errors.eventId = "Escolha o show.";
  const single = isSingleTarget(form.action, form.targetKind);
  const goal = single ? 1 : Number(form.goal);
  if (!Number.isInteger(goal) || goal < 1 || goal > MISSION_GOAL_MAX) errors.goal = `De 1 a ${MISSION_GOAL_MAX}.`;
  const reward = Number(form.rewardPoints);
  if (!Number.isInteger(reward) || reward < 1 || reward > MISSION_REWARD_MAX) errors.rewardPoints = `De 1 a ${MISSION_REWARD_MAX.toLocaleString("pt-BR")} pontos.`;
  const startsAt = localToMs(form.startsAt);
  if (startsAt === null) errors.startsAt = "Escolha o dia e a hora do início.";
  let endsAt: number | null = null;
  if (form.endsAt) {
    endsAt = localToMs(form.endsAt);
    if (endsAt === null) errors.endsAt = "Escolha o dia e a hora do fim, ou deixe sem fim.";
    else if (startsAt !== null && endsAt <= startsAt) errors.endsAt = "O fim precisa vir depois do início.";
    else if (startsAt !== null && endsAt - startsAt > MISSION_WINDOW_MAX_DAYS * DAY_MS) errors.endsAt = `No máximo ${MISSION_WINDOW_MAX_DAYS} dias.`;
  }
  if (Object.keys(errors).length > 0 || startsAt === null) return { errors, input: null };
  return {
    errors,
    input: { title, action: form.action, target: targetOf(form), goal, period: form.period, rewardPoints: reward, featured: form.featured, startsAt, endsAt },
  };
}

function sameTarget(a: MissionTarget | null, b: MissionTarget | null): boolean {
  return (a?.postId ?? null) === (b?.postId ?? null) && (a?.artistId ?? null) === (b?.artistId ?? null) && (a?.eventId ?? null) === (b?.eventId ?? null);
}

/** Só o que mudou, para o `updateMission`; com a missão travada, os campos travados ficam de fora. */
export function missionChanges(mission: Mission, input: MissionInput, locked: boolean): Partial<MissionInput> {
  const changes: Partial<MissionInput> = {};
  if (input.title !== mission.title) changes.title = input.title;
  if (input.rewardPoints !== mission.rewardPoints) changes.rewardPoints = input.rewardPoints;
  if (input.featured !== mission.featured) changes.featured = input.featured;
  if ((input.endsAt ?? null) !== (mission.endsAt?.getTime() ?? null)) changes.endsAt = input.endsAt;
  if (locked) return changes;
  if (input.action !== mission.action) changes.action = input.action;
  if (!sameTarget(input.target, mission.target)) changes.target = input.target;
  if (input.goal !== mission.goal) changes.goal = input.goal;
  if (input.period !== mission.period) changes.period = input.period;
  if (input.startsAt !== mission.startsAt.getTime()) changes.startsAt = input.startsAt;
  return changes;
}

/** O campo do `invalid-request` (`mission.goal`) no formulário. */
export function missionFieldOf(field: unknown): keyof MissionForm | null {
  if (typeof field !== "string") return null;
  const last = field.split(".").pop() ?? "";
  const map: Record<string, keyof MissionForm> = {
    title: "title",
    action: "action",
    target: "targetKind",
    postId: "postId",
    eventId: "eventId",
    artistId: "artistId",
    goal: "goal",
    period: "period",
    rewardPoints: "rewardPoints",
    startsAt: "startsAt",
    endsAt: "endsAt",
  };
  return map[last] ?? null;
}

// ---------------------------------------------------------------------------
// Meta da temporada
// ---------------------------------------------------------------------------

export const GOAL_TITLE_MAX = 40;
export const GOAL_TEXT_MAX = 140;
export const GOAL_MISSIONS_MAX = 1_000;
export const GOAL_POINTS_MAX = 1_000_000;

export interface GoalForm {
  title: string;
  description: string;
  reachedDescription: string;
  metric: "missions" | "points";
  target: string;
}

export function goalFormOf(goal: SeasonGoal | null): GoalForm {
  return goal
    ? { title: goal.title, description: goal.description, reachedDescription: goal.reachedDescription ?? "", metric: goal.metric, target: String(goal.target) }
    : { title: "", description: "", reachedDescription: "", metric: "missions", target: "" };
}

export function validateGoal(form: GoalForm): {
  errors: Partial<Record<keyof GoalForm, string>>;
  input: { title: string; description: string; reachedDescription: string | null; metric: "missions" | "points"; target: number } | null;
} {
  const errors: Partial<Record<keyof GoalForm, string>> = {};
  const line = (text: string, max: number) => text.trim().length > 0 && text.trim().length <= max && !/[\r\n]/.test(text);
  if (!line(form.title, GOAL_TITLE_MAX)) errors.title = `Escreva o título, até ${GOAL_TITLE_MAX} caracteres.`;
  if (!line(form.description, GOAL_TEXT_MAX)) errors.description = `Escreva o texto, até ${GOAL_TEXT_MAX} caracteres.`;
  if (form.reachedDescription.trim() && !line(form.reachedDescription, GOAL_TEXT_MAX)) errors.reachedDescription = `Até ${GOAL_TEXT_MAX} caracteres, numa linha.`;
  const max = form.metric === "points" ? GOAL_POINTS_MAX : GOAL_MISSIONS_MAX;
  const target = Number(form.target);
  if (!Number.isInteger(target) || target < 1 || target > max) errors.target = `De 1 a ${max.toLocaleString("pt-BR")}.`;
  if (Object.keys(errors).length > 0) return { errors, input: null };
  return {
    errors,
    input: { title: form.title.trim(), description: form.description.trim(), reachedDescription: form.reachedDescription.trim() || null, metric: form.metric, target },
  };
}

// ---------------------------------------------------------------------------
// Filtros e conclusões
// ---------------------------------------------------------------------------

export const ANY = "all";
/** O filtro de central para show, sem alvo e convite (como o `missionsOfArtist` do app). */
export const NO_ARTIST = "none";

export type SeasonSlot = "current" | "next" | "last";

export interface SeasonWindow {
  slot: SeasonSlot;
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
}

export const SEASON_SLOT_LABELS: Record<SeasonSlot, string> = { current: "atual", next: "próxima", last: "última fechada" };

/** As temporadas do filtro: a atual, a próxima e a última fechada, as que existirem. */
export function seasonWindows(config: {
  season: { id: string; name: string; startsAt: Date; endsAt: Date } | null;
  next: { id: string; name: string; startsAt: Date; endsAt: Date } | null;
  lastClosed: { id: string; name: string; startsAt: Date; endsAt: Date } | null;
}): SeasonWindow[] {
  const slots: [SeasonSlot, typeof config.season][] = [
    ["current", config.season],
    ["next", config.next],
    ["last", config.lastClosed],
  ];
  return slots.flatMap(([slot, def]) => (def ? [{ slot, id: def.id, name: def.name, startsAt: def.startsAt, endsAt: def.endsAt }] : []));
}

export interface MissionFilters {
  /** Situação; "archived" troca a lista pelo arquivo. */
  state: MissionState | typeof ANY;
  /** O id da central, `NO_ARTIST` ou `ANY`. */
  artist: string;
  /** A temporada (`SeasonSlot`) ou `ANY`. */
  season: SeasonSlot | typeof ANY;
  period: MissionPeriod | typeof ANY;
}

export const EMPTY_MISSION_FILTERS: MissionFilters = { state: ANY, artist: ANY, season: ANY, period: ANY };

export function hasMissionFilter(filters: MissionFilters): boolean {
  return filters.state !== ANY || filters.artist !== ANY || filters.season !== ANY || filters.period !== ANY;
}

/** As missões que passam nos filtros (a situação pelo relógio, a central pelo alvo, a temporada pela janela). */
export function filterMissions(missions: readonly Mission[], filters: MissionFilters, windows: readonly SeasonWindow[], now: number): Mission[] {
  const window = filters.season === ANY ? null : (windows.find((item) => item.slot === filters.season) ?? null);
  return missions.filter((mission) => {
    if (filters.state !== ANY && missionState(mission, now) !== filters.state) return false;
    if (filters.artist === NO_ARTIST && missionArtist(mission) !== "") return false;
    if (filters.artist !== ANY && filters.artist !== NO_ARTIST && missionArtist(mission) !== filters.artist) return false;
    if (filters.period !== ANY && mission.period !== filters.period) return false;
    if (filters.season !== ANY && (!window || !crossesWindow(mission, window))) return false;
    return true;
  });
}

/** Os dias de conclusões de uma temporada: do primeiro dia até o fim, no máximo até ontem; `null` se ainda não começou. */
export function seasonDaysRange(window: Pick<SeasonWindow, "startsAt" | "endsAt">, now: number): DayRange | null {
  const from = dayKey(window.startsAt.getTime());
  const last = dayKey(window.endsAt.getTime() - 1);
  const yesterday = shiftDay(dayKey(now), -1);
  const to = last < yesterday ? last : yesterday;
  return from <= to ? { from, to } : null;
}

/** A missão encerrada que o "Arquivar encerradas" leva. */
export function endedMissions(missions: readonly Mission[], now: number): Mission[] {
  return missions.filter((mission) => missionState(mission, now) === "ended");
}

/** "7 out, 22:46", em São Paulo (o ano só quando é outro). */
export function shortDateTime(date: Date, now: Date): string {
  return `${formatDay(date, now)}, ${formatTime(date)}`;
}

/** A janela: "7 out, 22:46 até 31 out, 23:59" ou "Desde 7 out, 22:46, sem fim". */
export function missionWindowText(mission: Pick<Mission, "startsAt" | "endsAt">, now: Date): string {
  return mission.endsAt
    ? `${shortDateTime(mission.startsAt, now)} até ${shortDateTime(mission.endsAt, now)}`
    : `Desde ${shortDateTime(mission.startsAt, now)}, sem fim`;
}

/** A missão nova na versão gravada (a resposta perdida do `createMission`): mesmo título, quem gravou foi você. */
export function createdMissionIn(
  version: { updatedByUid: string | null; missions: readonly Pick<Mission, "id" | "title">[] } | null,
  uid: string,
  title: string,
  before: readonly string[],
): string | null {
  if (!version || version.updatedByUid !== uid) return null;
  const known = new Set(before);
  return version.missions.find((mission) => mission.title === title && !known.has(mission.id))?.id ?? null;
}
