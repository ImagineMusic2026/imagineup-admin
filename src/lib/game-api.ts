import type { AchievementInput } from "@/lib/achievements";
import { call } from "@/lib/callable";
import type { MissionInput } from "@/lib/missions";
import type { ActionCapKey, ValueSource } from "@/lib/points-config";
import type { Level } from "@/lib/levels";

/**
 * Callables da seção Missões e régua (22.8), para admin e editor com
 * `missions`. Todas levam o `version` lido do documento como
 * `expectedVersion` e devolvem a versão nova; `config-changed` diz que alguém
 * mudou antes (a tela lê de novo). As datas vão em ms.
 */

type Versioned = { version: number };

export interface PointsConfigChanges {
  values?: Partial<Record<ValueSource, number>>;
  dailyLimits?: Partial<Record<ValueSource, number | null>>;
  actionCaps?: Partial<Record<ActionCapKey, number>>;
  levels?: Level[];
}

export function updatePointsConfig(input: { expectedVersion: number } & PointsConfigChanges): Promise<Versioned> {
  return call("updatePointsConfig", input);
}

export function createMission(input: { expectedVersion: number; mission: MissionInput }): Promise<Versioned & { missionId: string }> {
  return call("createMission", input);
}

export function updateMission(input: { expectedVersion: number; missionId: string; changes: Partial<MissionInput> }): Promise<Versioned> {
  return call("updateMission", input);
}

/** `active` publica (ou traz do arquivo); `archived` arquiva. */
export function setMissionStatus(input: { expectedVersion: number; missionId: string; status: "active" | "archived" }): Promise<Versioned> {
  return call("setMissionStatus", input);
}

export function reorderMissions(input: { expectedVersion: number; missionIds: string[] }): Promise<Versioned> {
  return call("reorderMissions", input);
}

export interface SeasonGoalInput {
  title: string;
  description: string;
  reachedDescription: string | null;
  metric: "missions" | "points";
  target: number;
}

/** A meta da temporada atual; `null` tira. */
export function updateSeasonGoal(input: { expectedVersion: number; goal: SeasonGoalInput | null }): Promise<Versioned> {
  return call("updateSeasonGoal", input);
}

export function createAchievement(input: { expectedVersion: number; achievement: AchievementInput }): Promise<Versioned & { achievementId: string }> {
  return call("createAchievement", input);
}

export function updateAchievement(input: { expectedVersion: number; achievementId: string; changes: Partial<AchievementInput> }): Promise<Versioned> {
  return call("updateAchievement", input);
}

export function setAchievementStatus(input: { expectedVersion: number; achievementId: string; status: "active" | "archived" }): Promise<Versioned> {
  return call("setAchievementStatus", input);
}

export function reorderAchievements(input: { expectedVersion: number; achievementIds: string[] }): Promise<Versioned> {
  return call("reorderAchievements", input);
}
