import { Timestamp, collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";

import { parseAchievementsCatalog, type AchievementsCatalog } from "@/lib/achievements";
import { dayKey, dayStartMs, type DayRange } from "@/lib/day";
import { db } from "@/lib/firebase";
import { getPage, type PageCursor } from "@/lib/firestore-page";
import { parseMission, parseMissionsCatalog, type Mission, type MissionsCatalog } from "@/lib/missions";
import { parsePointsConfig, type PointsConfig } from "@/lib/points-config";
import { parseSeasonConfig, type SeasonConfig } from "@/lib/season";
import { toDate } from "@/lib/staff";
import { lastClosedAt, sumMaps, type CloseState } from "@/lib/stats";
import { getStatsDays } from "@/lib/stats-data";

/**
 * Leituras da seção Missões e régua, todas únicas (decisão 19): os quatro
 * documentos de configuração (um `getDoc` de cada, ao abrir e no
 * "Atualizar"), o arquivo das missões (só no filtro "Arquivadas"), os alvos
 * citados e as conclusões por dia. O `version` lido de cada documento é o
 * `expectedVersion` das mudanças. As regras (26.10) liberam tudo isso para a
 * seção `missions`; `posts` e `events` também, para escolher o alvo.
 */

export const ARCHIVE_LIMIT = 50;
export const TARGET_PAGE_SIZE = 20;

export async function getMissionsCatalog(): Promise<MissionsCatalog> {
  return parseMissionsCatalog((await getDoc(doc(db(), "config", "missions"))).data());
}

export async function getAchievementsCatalog(): Promise<AchievementsCatalog> {
  return parseAchievementsCatalog((await getDoc(doc(db(), "config", "achievements"))).data());
}

/** A régua gravada, ou `null` sem documento (versão 0). */
export async function getPointsConfig(): Promise<{ version: number; config: PointsConfig | null }> {
  const data = (await getDoc(doc(db(), "config", "points"))).data();
  const config = parsePointsConfig(data);
  return { version: config?.version ?? (typeof data?.version === "number" ? data.version : 0), config };
}

export interface GameConfigs {
  missions: MissionsCatalog;
  achievements: AchievementsCatalog;
  points: { version: number; config: PointsConfig | null };
  season: SeasonConfig;
}

/** Os quatro documentos de uma vez. */
export async function getGameConfigs(): Promise<GameConfigs> {
  const [missions, achievements, points, season] = await Promise.all([
    getMissionsCatalog(),
    getAchievementsCatalog(),
    getPointsConfig(),
    getDoc(doc(db(), "config", "season")).then((snapshot) => parseSeasonConfig(snapshot.data())),
  ]);
  return { missions, achievements, points, season };
}

/** As arquivadas, da mais nova (até 50). */
export async function getArchivedMissions(): Promise<Mission[]> {
  const snapshot = await getDocs(query(collection(db(), "missionArchive"), orderBy("archivedAt", "desc"), limit(ARCHIVE_LIMIT)));
  return snapshot.docs.map((item) => parseMission({ ...item.data(), id: item.id })).filter((item): item is Mission => item !== null);
}

// ---------------------------------------------------------------------------
// Alvos
// ---------------------------------------------------------------------------

export interface TargetPost {
  kind: "post";
  id: string;
  artistId: string | null;
  text: string;
  status: string;
  publishedAt: Date | null;
}

export interface TargetEvent {
  kind: "event";
  id: string;
  title: string;
  city: string | null;
  status: string;
  startsAt: Date | null;
}

export type TargetDoc = TargetPost | TargetEvent;

function postOf(id: string, data: Record<string, unknown>): TargetPost {
  return {
    kind: "post",
    id,
    artistId: typeof data.artistId === "string" ? data.artistId : null,
    text: typeof data.text === "string" ? data.text : "",
    status: typeof data.status === "string" ? data.status : "draft",
    publishedAt: toDate(data.publishedAt),
  };
}

function eventOf(id: string, data: Record<string, unknown>): TargetEvent {
  return {
    kind: "event",
    id,
    title: typeof data.title === "string" ? data.title : id,
    city: typeof data.city === "string" && data.city ? data.city : null,
    status: typeof data.status === "string" ? data.status : "draft",
    startsAt: toDate(data.startsAt),
  };
}

/** A chave de um alvo no mapa de `getMissionTargets`. */
export function targetKey(kind: "post" | "event", id: string): string {
  return `${kind}:${id}`;
}

/** As chaves dos posts e shows citados pelas missões, em ordem (a mesma lista lê uma vez só). */
export function targetKeysOf(missions: readonly Pick<Mission, "target">[]): string[] {
  const keys = new Set<string>();
  for (const mission of missions) {
    if (mission.target?.postId) keys.add(targetKey("post", mission.target.postId));
    if (mission.target?.eventId) keys.add(targetKey("event", mission.target.eventId));
  }
  return [...keys].sort();
}

/** Os alvos pelas chaves (um `getDoc` de cada); o que não existe mais fica `null`. */
export async function getTargetDocs(keys: readonly string[]): Promise<Map<string, TargetDoc | null>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      const [kind, id] = key.split(":") as ["post" | "event", string];
      const snapshot = await getDoc(doc(db(), kind === "post" ? "posts" : "events", id));
      const data = snapshot.data();
      return [key, data ? (kind === "post" ? postOf(id, data) : eventOf(id, data)) : null] as const;
    }),
  );
  return new Map(entries);
}

/** Os posts no ar de uma central, do mais novo, 20 por vez (o índice da grade da 1d). */
export async function getTargetPosts(artistId: string, after: PageCursor | null): Promise<{ items: TargetPost[]; cursor: PageCursor | null; hasMore: boolean }> {
  const page = await getPage(
    query(collection(db(), "posts"), where("artistId", "==", artistId), where("status", "==", "published"), orderBy("publishedAt", "desc")),
    { size: TARGET_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => postOf(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Os shows de uma central de hoje em diante (o começo de hoje em São Paulo), 20 por vez, rascunhos inclusive. */
export async function getTargetEvents(
  artistId: string,
  now: number,
  after: PageCursor | null,
): Promise<{ items: TargetEvent[]; cursor: PageCursor | null; hasMore: boolean }> {
  const page = await getPage(
    query(
      collection(db(), "events"),
      where("artistIds", "array-contains", artistId),
      where("startsAt", ">=", Timestamp.fromMillis(dayStartMs(dayKey(now)))),
      orderBy("startsAt"),
    ),
    { size: TARGET_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => eventOf(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

// ---------------------------------------------------------------------------
// Resposta perdida e números
// ---------------------------------------------------------------------------

/** Uma versão gravada do catálogo (`config/missions/versions/{n}`), para conferir um `createMission` sem resposta. */
export async function getMissionsVersion(version: number): Promise<{ updatedByUid: string | null; missions: Mission[] } | null> {
  const data = (await getDoc(doc(db(), "config", "missions", "versions", String(version)))).data();
  if (!data) return null;
  const by = data.updatedBy && typeof data.updatedBy === "object" ? (data.updatedBy as { uid?: unknown }) : null;
  return { updatedByUid: typeof by?.uid === "string" ? by.uid : null, missions: parseMissionsCatalog(data).missions };
}

export interface CountsRead {
  state: CloseState;
  closedAt: Date | null;
  /** Por id: conclusões (`byMission`) ou desbloqueios (`byAchievement`) somados nos dias da faixa. */
  byId: Record<string, number>;
}

/** As conclusões por missão nos dias fechados da faixa. */
export async function getMissionConclusions(range: DayRange, now: number): Promise<CountsRead> {
  const read = await getStatsDays(range, now);
  return { state: read.state, closedAt: lastClosedAt(read.days), byId: sumMaps(read.days, (day) => day.byMission) };
}

/** Os desbloqueios por conquista nos dias fechados da faixa. */
export async function getAchievementUnlocks(range: DayRange, now: number): Promise<CountsRead> {
  const read = await getStatsDays(range, now);
  return { state: read.state, closedAt: lastClosedAt(read.days), byId: sumMaps(read.days, (day) => day.byAchievement) };
}
