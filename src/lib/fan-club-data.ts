import { collection, doc, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import {
  FAN_CLUBS_PAGE_SIZE,
  parseApplication,
  parseApplicationPrivate,
  parseContactWhatsapp,
  parseFanClub,
  type ApplicationPrivate,
  type FanClub,
  type FanClubApplication,
  type FanClubStatus,
  type ResolvedApplicationStatus,
} from "@/lib/fan-clubs";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { readDoc, readQuery } from "@/lib/firestore-read";

/**
 * Leituras da seção Fã-clubes (34.6 e 34.10), todas únicas (decisão 19): as
 * candidaturas pendentes e as resolvidas, a candidatura com o privado e o
 * contato do fã, e os fã-clubes. As regras liberam as candidaturas e os
 * fã-clubes para quem vê a seção; o privado e o contato, só para quem edita
 * (o contato, só de quem tem candidatura). Cada consulta tem a forma de um
 * índice de 34.6, porque o emulador não cobra índice. Nada aqui grava: toda
 * mudança passa pela `decideFanClub` (`fan-club-api.ts`).
 */

type Page<T> = { items: T[]; cursor: PageCursor | null; hasMore: boolean };

/** O `in` do Firestore aceita até 30 valores. */
export const ARTIST_FILTER_MAX = 30;

/**
 * O filtro de artista das pendentes: uma central, as que a pessoa cuida
 * (`in`, até 30) ou todas (`null`). Lista vazia é "nenhuma central": a tela
 * não consulta.
 */
export type ArtistFilter = readonly string[] | null;

function artistConstraint(artists: ArtistFilter): QueryConstraint[] {
  if (!artists) return [];
  return artists.length === 1 ? [where("artistId", "==", artists[0])] : [where("artistId", "in", artists.slice(0, ARTIST_FILTER_MAX))];
}

/** As pendentes, da mais antiga para a mais nova (os índices `status, submittedAt` e `artistId, status, submittedAt`). */
export async function getPendingApplicationsPage(artists: ArtistFilter, after: PageCursor | null): Promise<Page<FanClubApplication>> {
  if (artists && artists.length === 0) return { items: [], cursor: null, hasMore: false };
  const page = await getPage(
    query(collection(db(), "fanClubApplications"), ...artistConstraint(artists), where("status", "==", "pending"), orderBy("submittedAt", "asc")),
    { size: FAN_CLUBS_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => parseApplication(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantas pendentes, com o mesmo filtro de artista (o `count()`). */
export async function countPendingApplications(artists: ArtistFilter = null): Promise<number> {
  if (artists && artists.length === 0) return 0;
  return countOf(query(collection(db(), "fanClubApplications"), ...artistConstraint(artists), where("status", "==", "pending")));
}

/** As resolvidas de um status, da decisão mais nova (o índice `status, decidedAt` decrescente). */
export async function getResolvedApplicationsPage(status: ResolvedApplicationStatus, after: PageCursor | null): Promise<Page<FanClubApplication>> {
  const page = await getPage(query(collection(db(), "fanClubApplications"), where("status", "==", status), orderBy("decidedAt", "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseApplication(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** A candidatura de um fã, ou `null`. */
export async function getApplication(uid: string): Promise<FanClubApplication | null> {
  const snapshot = await readDoc(doc(db(), "fanClubApplications", uid));
  const data = snapshot.data();
  return data ? parseApplication(snapshot.id, data) : null;
}

/** As redes e o texto de divulgação (só quem edita a seção lê), ou `null` sem o documento. */
export async function getApplicationPrivate(uid: string): Promise<ApplicationPrivate | null> {
  const snapshot = await readDoc(doc(db(), "fanClubApplicationPrivate", uid));
  const data = snapshot.data();
  return data ? parseApplicationPrivate(data) : null;
}

/**
 * O WhatsApp do contato do fã (`users/{uid}/contact/main`, decisão 14), só
 * para quem edita a seção e só de quem tem candidatura (34.22). Sem número, ou
 * fora do formato, `null`.
 */
export async function getContactWhatsapp(uid: string): Promise<string | null> {
  const snapshot = await readDoc(doc(db(), "users", uid, "contact", "main"));
  return parseContactWhatsapp(snapshot.data());
}

/** As centrais que a pessoa cuida (`artistPrivate.managerUid`), para o filtro: só com a seção Artistas. */
export async function getManagedArtistIds(uid: string): Promise<string[]> {
  const snapshot = await readQuery(query(collection(db(), "artistPrivate"), where("managerUid", "==", uid)));
  return snapshot.docs.map((item) => item.id).sort();
}

// ---------------------------------------------------------------------------
// Fã-clubes
// ---------------------------------------------------------------------------

export interface FanClubFilter {
  status: FanClubStatus;
  /** Uma central, ou "" para todas. */
  artistId: string;
}

function clubConstraints(filter: FanClubFilter): QueryConstraint[] {
  return [...(filter.artistId ? [where("artistId", "==", filter.artistId)] : []), where("status", "==", filter.status)];
}

/**
 * Os fã-clubes de um status, da aprovação mais nova (os índices `status,
 * approvedAt` e `artistId, status, approvedAt`, decrescentes). Ordenar pelos
 * seguidores chega com a cópia da noite (34.14, etapa 4).
 */
export async function getFanClubsPage(filter: FanClubFilter, after: PageCursor | null): Promise<Page<FanClub>> {
  const page = await getPage(query(collection(db(), "fanClubs"), ...clubConstraints(filter), orderBy("approvedAt", "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseFanClub(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantos fã-clubes com o filtro (o `count()`). */
export function countFanClubs(filter: FanClubFilter): Promise<number> {
  return countOf(query(collection(db(), "fanClubs"), ...clubConstraints(filter)));
}

/** Um fã-clube, ou `null`. */
export async function getFanClub(clubId: string): Promise<FanClub | null> {
  const snapshot = await readDoc(doc(db(), "fanClubs", clubId));
  const data = snapshot.data();
  return data ? parseFanClub(snapshot.id, data) : null;
}
