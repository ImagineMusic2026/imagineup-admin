import { Timestamp, collection, collectionGroup, doc, getDoc, getDocs, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import { dayKey, dayStartMs } from "@/lib/day";
import { EVENTS_PAGE_SIZE, parseEvent, type AgendaEvent, type EventStatus } from "@/lib/events";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";

/**
 * Leituras da Agenda, todas únicas (21.9 e decisão 19): os próximos (de hoje
 * em diante, do mais perto) e os passados (do mais novo, só com a central),
 * a contagem dos por vir e o detalhe de um show (posts ligados, confirmados
 * e recompensas). Nada aqui grava.
 */

type Page<T> = { items: T[]; cursor: PageCursor | null; hasMore: boolean };

export interface EventFilters {
  when: "upcoming" | "past";
  artistId: string | null;
  /** Só nos próximos (os passados só filtram pela central, 26.16). */
  status: EventStatus | null;
}

/** O id de um show novo, gerado no painel. */
export function newEventId(): string {
  return doc(collection(db(), "events")).id;
}

function todayStart(now: number): Timestamp {
  return Timestamp.fromMillis(dayStartMs(dayKey(now)));
}

export async function getEventsPage(filters: EventFilters, now: number, after: PageCursor | null): Promise<Page<AgendaEvent>> {
  const constraints: QueryConstraint[] = [];
  if (filters.artistId) constraints.push(where("artistIds", "array-contains", filters.artistId));
  if (filters.when === "upcoming") {
    if (filters.status) constraints.push(where("status", "==", filters.status));
    constraints.push(where("startsAt", ">=", todayStart(now)), orderBy("startsAt", "asc"));
  } else {
    constraints.push(where("startsAt", "<", todayStart(now)), orderBy("startsAt", "desc"));
  }
  const page = await getPage(query(collection(db(), "events"), ...constraints), { size: EVENTS_PAGE_SIZE, after });
  return { items: page.docs.map((item) => parseEvent(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** "N shows por vir" (da central, com o filtro). */
export function countUpcomingEvents(now: number, artistId: string | null): Promise<number> {
  const constraints: QueryConstraint[] = [];
  if (artistId) constraints.push(where("artistIds", "array-contains", artistId));
  return countOf(query(collection(db(), "events"), ...constraints, where("startsAt", ">=", todayStart(now))));
}

export async function getEvent(eventId: string): Promise<AgendaEvent | null> {
  const snapshot = await getDoc(doc(db(), "events", eventId));
  const data = snapshot.data();
  return data ? parseEvent(snapshot.id, data) : null;
}

/** Quantos posts apontam para o show (o aviso de tirar do ar e o detalhe). */
export function countEventPosts(eventId: string): Promise<number> {
  return countOf(query(collection(db(), "posts"), where("eventId", "==", eventId)));
}

export interface EventDetail {
  posts: number;
  /** `null` para quem não vê Fãs. */
  going: number | null;
  /** `null` para quem não vê Recompensas. */
  rewards: { id: string; title: string }[] | null;
}

/** O detalhe da linha: de 1 a 3 leituras, conforme as seções de quem olha. */
export async function getEventDetail(eventId: string, sees: { fans: boolean; rewards: boolean }): Promise<EventDetail> {
  const [posts, going, rewards] = await Promise.all([
    countEventPosts(eventId),
    sees.fans ? countOf(query(collectionGroup(db(), "eventRsvps"), where("eventId", "==", eventId), where("going", "==", true))) : Promise.resolve(null),
    sees.rewards
      ? getDocs(query(collection(db(), "rewards"), where("eventId", "==", eventId), limit(20))).then((snapshot) =>
          snapshot.docs.map((item) => ({ id: item.id, title: typeof item.data().title === "string" ? (item.data().title as string) : item.id })),
        )
      : Promise.resolve(null),
  ]);
  return { posts, going, rewards };
}
