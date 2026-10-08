import { LONG_CALL_TIMEOUT_MS, call } from "@/lib/callable";
import type { RankingRow, SeasonInput } from "@/lib/season";

/**
 * Callables da temporada (23.10) e o ranking ao vivo (26.4). As três que mudam
 * a configuração levam o `version` lido como `expectedVersion`; a resposta
 * `config-changed` diz que alguém mudou antes (a tela lê de novo).
 */

export function updateSeason(input: { expectedVersion: number; season: SeasonInput | null }): Promise<{ version: number }> {
  return call("updateSeason", input);
}

export function scheduleNextSeason(input: { expectedVersion: number; next: SeasonInput | null }): Promise<{ version: number }> {
  return call("scheduleNextSeason", input);
}

export function endSeason(input: { expectedVersion: number; seasonId: string }): Promise<{ version: number; endsAt: string | number }> {
  return call("endSeason", input);
}

/** Roda a virada; chame de novo enquanto vier `running` (cada chamada tem até 90 s no servidor). */
export function closeSeasonNow(seasonId: string): Promise<{ status: "running" | "closed"; pages: number }> {
  return call("closeSeasonNow", { seasonId }, { timeout: LONG_CALL_TIMEOUT_MS });
}

export interface PanelRankingPage {
  season: { id: string; name: string; startsAt: string; endsAt: string; status: "active" | "ended"; leaderTitle: string | null } | null;
  items: (RankingRow & { isMe?: boolean })[];
  nextCursor: string | null;
}

/** O ranking ao vivo, no geral ou de uma central, 20 por página (o cursor opaco do app). */
export function getPanelRanking(input: { artistId: string | null; cursor: string | null }): Promise<PanelRankingPage> {
  return call("getPanelRanking", input);
}
