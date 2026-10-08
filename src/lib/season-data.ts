import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { parsePastSeason, parseSeasonConfig, parseStanding, type PastSeason, type SeasonConfig, type StandingRow } from "@/lib/season";

/**
 * Leituras de Ranking e temporadas, todas únicas (decisão 19: nem o
 * `config/season` escuta). As regras: o `config/season` a equipe ativa lê; o
 * arquivo das temporadas (`seasons` e `standings`) a seção `ranking` (23.12).
 * O ranking ao vivo vem pela callable `getPanelRanking` (`season-api.ts`).
 */

export const PAST_SEASONS_LIMIT = 20;
export const PODIUM_SIZE = 10;

/** O `config/season` e o arquivo da temporada atual (a situação da virada). */
export async function getSeasonState(): Promise<{ config: SeasonConfig; archiveStatus: string | null }> {
  const snapshot = await getDoc(doc(db(), "config", "season"));
  const config = parseSeasonConfig(snapshot.data());
  if (!config.season) return { config, archiveStatus: null };
  const archive = await getDoc(doc(db(), "seasons", config.season.id));
  return { config, archiveStatus: archive.exists() ? (typeof archive.data().status === "string" ? (archive.data().status as string) : "closed") : null };
}

/** As temporadas fechadas (o arquivo), da mais nova. */
export async function getPastSeasons(): Promise<PastSeason[]> {
  const snapshot = await getDocs(query(collection(db(), "seasons"), orderBy("startsAt", "desc"), limit(PAST_SEASONS_LIMIT)));
  return snapshot.docs.map((item) => parsePastSeason(item.id, item.data())).filter((item): item is PastSeason => item !== null);
}

/** O pódio de uma temporada fechada: os 10 primeiros no geral ou numa central, com o nome da virada. */
export async function getPodium(seasonId: string, artistId: string | null): Promise<StandingRow[]> {
  const field = artistId ? `centrals.${artistId}.position` : "position";
  const snapshot = await getDocs(query(collection(db(), "seasons", seasonId, "standings"), orderBy(field), limit(PODIUM_SIZE)));
  return snapshot.docs.map((item) => parseStanding(item.id, item.data(), artistId)).filter((item): item is StandingRow => item !== null);
}
