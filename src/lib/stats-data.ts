import { collection, doc, documentId, getDoc, getDocs, query, where } from "firebase/firestore";

import { dayKey, daysBetween, daysOf, shiftDay, type DayRange } from "@/lib/day";
import { db } from "@/lib/firebase";
import { closeState, parseStatsDay, statsDayFromShards, type CloseState, type StatsDay } from "@/lib/stats";

/**
 * Leituras dos números do dia, sempre únicas (nunca `onSnapshot`): os dias
 * fechados mudam uma vez por noite, e os shards de hoje mudam o tempo todo.
 * As regras liberam `statsDaily` (o dia fechado e os shards) e o
 * `statsMeta/close` para quem vê `overview`, `growth`, `missions` ou `rewards`
 * (26.10).
 *
 * Como lê (26.3): uma consulta por faixa de até 90 dias (`documentId()` entre
 * dois dias), que só devolve os fechados, porque o pai do dia aberto não
 * existe; e o `statsMeta/close`, para saber até onde o fechamento chegou. Só o
 * dia de ontem, antes do fechamento dele, tem os shards somados aqui.
 */

/** Maior faixa de uma consulta (a seção 7 fixa 90 dias). */
export const MAX_DAYS_PER_QUERY = 90;

export interface StatsRead {
  state: CloseState;
  /** Os dias da faixa que vieram (fechados, e ontem somado no navegador quando é o caso), em ordem. */
  days: StatsDay[];
  /** Os dias da faixa sem documento (não fechados, ou de antes do primeiro fechamento). */
  missing: string[];
}

/** A faixa em pedaços de até 90 dias. */
export function chunkRange(range: DayRange, size: number = MAX_DAYS_PER_QUERY): DayRange[] {
  const chunks: DayRange[] = [];
  for (let from = range.from; from <= range.to; from = shiftDay(from, size)) {
    const to = shiftDay(from, size - 1);
    chunks.push({ from, to: to < range.to ? to : range.to });
  }
  return chunks;
}

async function readClosedDays(range: DayRange): Promise<StatsDay[]> {
  const snapshot = await getDocs(
    query(collection(db(), "statsDaily"), where(documentId(), ">=", range.from), where(documentId(), "<=", range.to)),
  );
  return snapshot.docs.map((item) => parseStatsDay(item.id, item.data()));
}

async function readOpenDay(day: string): Promise<StatsDay> {
  const snapshot = await getDocs(collection(db(), "statsDaily", day, "statsShards"));
  return statsDayFromShards(
    day,
    snapshot.docs.map((item) => item.data()),
  );
}

/**
 * Os dias da faixa e o estado do fechamento. Ontem só é somado no navegador
 * quando o fechamento parou em anteontem (até 65 leituras); fechamento mais
 * atrasado, ou que nunca começou, não soma nada.
 */
export async function getStatsDays(range: DayRange, now: number): Promise<StatsRead> {
  if (daysBetween(range.from, range.to) < 1) return { state: { kind: "not-started" }, days: [], missing: [] };
  const [meta, ...chunks] = await Promise.all([
    getDoc(doc(db(), "statsMeta", "close")),
    ...chunkRange(range).map(readClosedDays),
  ]);
  const state = closeState(meta.exists() ? meta.data() : null, dayKey(now));
  const days = chunks.flat();
  const yesterday = shiftDay(dayKey(now), -1);
  if (
    state.kind === "yesterday-open" &&
    yesterday >= range.from &&
    yesterday <= range.to &&
    !days.some((day) => day.day === yesterday)
  ) {
    days.push(await readOpenDay(yesterday));
  }
  days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const present = new Set(days.map((day) => day.day));
  return { state, days, missing: daysOf(range).filter((day) => !present.has(day)) };
}

/** Os shards de hoje, somados (até 65 leituras). Só pelo botão "Ver hoje até agora". */
export function getTodayStats(now: number): Promise<StatsDay> {
  return readOpenDay(dayKey(now));
}
