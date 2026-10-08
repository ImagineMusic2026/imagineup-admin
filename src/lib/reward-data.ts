import { Timestamp, collection, doc, getDoc, getDocs, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import { dayKey, dayStartMs, type DayRange } from "@/lib/day";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import {
  REDEMPTIONS_PAGE_SIZE,
  REDEMPTION_STATUSES,
  parseRedemption,
  parseReward,
  redemptionOrder,
  type EventInfo,
  type Redemption,
  type RedemptionStatus,
  type Reward,
  type StatusFilter,
} from "@/lib/rewards";
import { toDate } from "@/lib/staff";
import { getStatsDays, type StatsRead } from "@/lib/stats-data";

/**
 * Leituras de Recompensas e resgates, todas únicas (25.8 e decisão 19): o
 * catálogo por `order`, os pedidos por status (e por recompensa) com as
 * contagens, o pedido pelo código, os shows citados e os números do dia. As
 * regras (25.10) liberam `rewards`, `redemptions` e `events` para a seção
 * `rewards`. Nada aqui grava.
 */

/** Teto de shows na escolha do show da recompensa (de hoje em diante). */
export const EVENT_CHOICES_MAX = 50;

/** O id de uma recompensa nova, gerado no painel: o mesmo id na nova tentativa não cria outra. */
export function newRewardId(): string {
  return doc(collection(db(), "rewards")).id;
}

/** O catálogo inteiro, na ordem do app. */
export async function getRewards(): Promise<Reward[]> {
  const snapshot = await getDocs(query(collection(db(), "rewards"), orderBy("order")));
  return snapshot.docs.map((item) => parseReward(item.id, item.data()));
}

export async function getReward(rewardId: string): Promise<Reward | null> {
  const snapshot = await getDoc(doc(db(), "rewards", rewardId));
  const data = snapshot.data();
  return data ? parseReward(snapshot.id, data) : null;
}

function eventOf(id: string, data: Record<string, unknown>): EventInfo {
  return {
    id,
    title: typeof data.title === "string" ? data.title : id,
    startsAt: toDate(data.startsAt),
    status: typeof data.status === "string" ? data.status : "draft",
  };
}

/** Os shows citados pelo catálogo (um `getDoc` de cada); o apagado fica `null`. */
export async function getEvents(ids: readonly string[]): Promise<Map<string, EventInfo | null>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map((id) => getDoc(doc(db(), "events", id))));
  return new Map(unique.map((id, index) => [id, found[index].exists() ? eventOf(id, found[index].data() ?? {}) : null]));
}

/** Os shows para escolher, de hoje em diante (rascunhos inclusive), do mais perto. */
export async function getEventChoices(now: number): Promise<EventInfo[]> {
  const snapshot = await getDocs(
    query(collection(db(), "events"), where("startsAt", ">=", Timestamp.fromMillis(dayStartMs(dayKey(now)))), orderBy("startsAt"), limit(EVENT_CHOICES_MAX)),
  );
  return snapshot.docs.map((item) => eventOf(item.id, item.data()));
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

function redemptionFilters(status: StatusFilter, rewardId: string | null): QueryConstraint[] {
  const filters: QueryConstraint[] = [];
  if (rewardId) filters.push(where("rewardId", "==", rewardId));
  if (status !== "all") filters.push(where("status", "==", status));
  return filters;
}

/** Uma página de pedidos: abertos do mais antigo, fechados e todos do mais novo (os índices de 25.10). */
export async function getRedemptionsPage(
  status: StatusFilter,
  rewardId: string | null,
  after: PageCursor | null,
): Promise<{ items: Redemption[]; cursor: PageCursor | null; hasMore: boolean }> {
  const page = await getPage(
    query(collection(db(), "redemptions"), ...redemptionFilters(status, rewardId), orderBy("requestedAt", redemptionOrder(status))),
    { size: REDEMPTIONS_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => parseRedemption(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantos em cada status (os abertos de agora só saem daqui, 25.8), com o filtro de recompensa. */
export async function getRedemptionCounts(rewardId: string | null): Promise<Record<RedemptionStatus, number>> {
  const counts = await Promise.all(
    REDEMPTION_STATUSES.map((status) => countOf(query(collection(db(), "redemptions"), ...redemptionFilters(status, rewardId)))),
  );
  return Object.fromEntries(REDEMPTION_STATUSES.map((status, index) => [status, counts[index]])) as Record<RedemptionStatus, number>;
}

/** O pedido pelo código já normalizado, ou `null`. */
export async function getRedemption(code: string): Promise<Redemption | null> {
  const snapshot = await getDoc(doc(db(), "redemptions", code));
  const data = snapshot.data();
  return data ? parseRedemption(snapshot.id, data) : null;
}

/** Os pedidos abertos de uma recompensa (solicitados e aprovados), do mais antigo, para a recusa em lote. */
export async function getOpenRedemptionsOf(rewardId: string): Promise<Redemption[]> {
  const [requested, approved] = await Promise.all(
    (["requested", "approved"] as const).map((status) =>
      getDocs(query(collection(db(), "redemptions"), where("rewardId", "==", rewardId), where("status", "==", status), orderBy("requestedAt", "asc"))),
    ),
  );
  return [...requested.docs, ...approved.docs]
    .map((item) => parseRedemption(item.id, item.data()))
    .sort((a, b) => (a.requestedAt?.getTime() ?? 0) - (b.requestedAt?.getTime() ?? 0));
}

/** Os dias do período, para a aba Números. */
export function getRewardStats(range: DayRange, now: number): Promise<StatsRead> {
  return getStatsDays(range, now);
}
