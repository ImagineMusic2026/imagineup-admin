import { collection, collectionGroup, doc, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import {
  FAN_CLUB_ORDER_FIELDS,
  FAN_CLUBS_PAGE_SIZE,
  parseApplication,
  parseApplicationPrivate,
  parseContactWhatsapp,
  parseFanClub,
  parseFollower,
  parsePost,
  parsePrize,
  parseReport,
  type ApplicationPrivate,
  type FanClub,
  type FanClubApplication,
  type FanClubFollower,
  type FanClubOrder,
  type FanClubPost,
  type FanClubPrize,
  type FanClubReport,
  type FanClubStatus,
  type ReportStatus,
  type ResolvedApplicationStatus,
  type WaitingCounts,
} from "@/lib/fan-clubs";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { readDoc, readQuery } from "@/lib/firestore-read";
import { parseRedemption, type Redemption } from "@/lib/rewards";

/**
 * Leituras da seção Fã-clubes (34.6 e 34.10), todas únicas (decisão 19): as
 * candidaturas, os fã-clubes, as publicações, as denúncias, os números (os 16
 * shards e a cópia da noite), os seguidores recentes e o registro dos
 * reconhecimentos. As regras liberam o que é da seção para quem a vê; o
 * privado e o contato, só para quem edita (o contato, só de quem tem
 * candidatura); os seguidores, o perfil e a central do gestor, só com a seção
 * Fãs; as recompensas e os pedidos, só com a seção Recompensas. Cada consulta
 * tem a forma de um índice de 34.6, porque o emulador não cobra índice. Nada
 * aqui grava: toda mudança passa pela `decideFanClub` (`fan-club-api.ts`).
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

/**
 * O filtro da lista (34.6): o status, sempre escolhido, com a central
 * opcional e a ordem; ou só os destacados, pelo fim do Destaque, sem combinar
 * com os outros (o índice `featured, featuredUntil`).
 */
export type FanClubFilter =
  | {
      featured: false;
      status: FanClubStatus;
      /** Uma central, ou "" para todas. */
      artistId: string;
      order: FanClubOrder;
    }
  | { featured: true };

function clubConstraints(filter: FanClubFilter): QueryConstraint[] {
  if (filter.featured) return [where("featured", "==", true)];
  return [...(filter.artistId ? [where("artistId", "==", filter.artistId)] : []), where("status", "==", filter.status)];
}

/**
 * Uma página dos fã-clubes (os índices de 34.6, decrescentes): de um status,
 * com a central opcional, pelos seguidores, pelos novos em 30 dias ou pela
 * aprovação (a cópia da noite dá os números das duas primeiras); ou os
 * destacados, do fim mais perto.
 */
export async function getFanClubsPage(filter: FanClubFilter, after: PageCursor | null): Promise<Page<FanClub>> {
  const order = filter.featured ? orderBy("featuredUntil", "asc") : orderBy(FAN_CLUB_ORDER_FIELDS[filter.order], "desc");
  const page = await getPage(query(collection(db(), "fanClubs"), ...clubConstraints(filter), order), {
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

/** Os fã-clubes citados por uma página (as publicações e as denúncias guardam só o id), um `readDoc` de cada. */
export async function getFanClubsByIds(ids: readonly string[]): Promise<Map<string, FanClub | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const found = await Promise.all(unique.map((id) => getFanClub(id)));
  return new Map(unique.map((id, index) => [id, found[index] ?? null]));
}

// ---------------------------------------------------------------------------
// Os números da ficha (decisões 24 e 37)
// ---------------------------------------------------------------------------

/** Os números que somam nos shards, na transação da ação. */
export interface ShardNumbers {
  links: number;
  visits: number;
  signups: number;
  joins: number;
}

const SHARD_FIELDS = ["links", "visits", "signups", "joins"] as const;

/**
 * A soma dos 16 shards de `fanClubStats/{clubId}/fanClubShards` (uma
 * consulta), campo a campo e nunca negativa, como o `sumFanClubShards` do
 * servidor: os números de agora, sem esperar a cópia da noite.
 */
export async function getShardNumbers(clubId: string): Promise<ShardNumbers> {
  const snapshot = await readQuery(collection(db(), "fanClubStats", clubId, "fanClubShards"));
  const sums: ShardNumbers = { links: 0, visits: 0, signups: 0, joins: 0 };
  for (const item of snapshot.docs) {
    const data = item.data();
    for (const field of SHARD_FIELDS) {
      const value = data[field];
      if (typeof value === "number" && Number.isFinite(value)) sums[field] += Math.trunc(value);
    }
  }
  for (const field of SHARD_FIELDS) sums[field] = Math.max(0, sums[field]);
  return sums;
}

/**
 * Os seguidores mais recentes, pelo grupo `fanClubFollows` (o índice de grupo
 * `clubId, followedAt` decrescente). A regra do grupo pede a seção Fãs
 * (decisão 29): a tela só chama com ela.
 */
export async function getRecentFollowersPage(clubId: string, after: PageCursor | null): Promise<Page<FanClubFollower>> {
  const page = await getPage(query(collectionGroup(db(), "fanClubFollows"), where("clubId", "==", clubId), orderBy("followedAt", "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseFollower(item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

// ---------------------------------------------------------------------------
// Publicações
// ---------------------------------------------------------------------------

/** As publicações de um fã-clube em todos os status, da enviada mais nova (o índice `clubId, submittedAt` decrescente). */
export async function getClubPostsPage(clubId: string, after: PageCursor | null): Promise<Page<FanClubPost>> {
  const page = await getPage(query(collection(db(), "fanClubPosts"), where("clubId", "==", clubId), orderBy("submittedAt", "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parsePost(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** A fila de revisão, da mais antiga para a mais nova (o índice `status, submittedAt`). */
export async function getPendingPostsPage(after: PageCursor | null): Promise<Page<FanClubPost>> {
  const page = await getPage(query(collection(db(), "fanClubPosts"), where("status", "==", "pending"), orderBy("submittedAt", "asc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parsePost(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantas publicações em análise (o `count()`). */
export function countPendingPosts(): Promise<number> {
  return countOf(query(collection(db(), "fanClubPosts"), where("status", "==", "pending")));
}

/** As publicações citadas pela fila de denúncias (o id do item é o da publicação), um `readDoc` de cada. */
export async function getPostsByIds(ids: readonly string[]): Promise<Map<string, FanClubPost | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const found = await Promise.all(
    unique.map(async (id) => {
      const snapshot = await readDoc(doc(db(), "fanClubPosts", id));
      const data = snapshot.data();
      return data ? parsePost(snapshot.id, data) : null;
    }),
  );
  return new Map(unique.map((id, index) => [id, found[index] ?? null]));
}

// ---------------------------------------------------------------------------
// Denúncias
// ---------------------------------------------------------------------------

/**
 * A fila das denúncias: as abertas, da denúncia mais nova (o índice `status,
 * lastReportedAt` decrescente), ou as resolvidas, da decisão mais nova
 * (`status, resolvedAt` decrescente).
 */
export async function getReportsPage(status: ReportStatus, after: PageCursor | null): Promise<Page<FanClubReport>> {
  const field = status === "open" ? "lastReportedAt" : "resolvedAt";
  const page = await getPage(query(collection(db(), "fanClubReportQueue"), where("status", "==", status), orderBy(field, "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseReport(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantas denúncias abertas (o `count()`). */
export function countOpenReports(): Promise<number> {
  return countOf(query(collection(db(), "fanClubReportQueue"), where("status", "==", "open")));
}

/**
 * As denúncias aceitas (Ocultar) de um fã-clube desde `since`, para o
 * checklist do Recompensar. Só igualdades (os índices de um campo), e a data
 * conferida aqui: as denúncias de um fã-clube são poucas.
 */
export async function countActionedReports(clubId: string, since: number): Promise<number> {
  const snapshot = await readQuery(query(collection(db(), "fanClubReportQueue"), where("clubId", "==", clubId), where("resolution", "==", "actioned")));
  return snapshot.docs.map((item) => parseReport(item.id, item.data())).filter((item) => (item.resolvedAt?.getTime() ?? 0) >= since).length;
}

// ---------------------------------------------------------------------------
// O "Aguardando a equipe"
// ---------------------------------------------------------------------------

/** As três contagens do cartão da Visão geral (três `count()`). */
export async function countWaiting(): Promise<WaitingCounts> {
  const [applications, posts, reports] = await Promise.all([countPendingApplications(), countPendingPosts(), countOpenReports()]);
  return { applications, posts, reports };
}

// ---------------------------------------------------------------------------
// Destaque e recompensas
// ---------------------------------------------------------------------------

/** O registro dos reconhecimentos, do mais novo (o índice automático da subcoleção, pela data). */
export async function getPrizesPage(clubId: string, after: PageCursor | null): Promise<Page<FanClubPrize>> {
  const page = await getPage(query(collection(db(), "fanClubs", clubId, "prizes"), orderBy("at", "desc")), { size: FAN_CLUBS_PAGE_SIZE, after });
  return { items: page.docs.map((item) => parsePrize(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/**
 * Os pedidos de prêmio do registro na tela, pelo `grantId` (único entre os
 * pedidos, 34.22): o código e o status, que só a seção Recompensas lê
 * (decisão 50). Um `in` a cada 30 valores (o teto do Firestore), com o índice
 * de um campo.
 */
export async function getPrizeOrders(grantIds: readonly string[]): Promise<Map<string, Redemption>> {
  const unique = [...new Set(grantIds.filter(Boolean))];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += ARTIST_FILTER_MAX) chunks.push(unique.slice(start, start + ARTIST_FILTER_MAX));
  const snapshots = await Promise.all(chunks.map((chunk) => readQuery(query(collection(db(), "redemptions"), where("grantId", "in", chunk)))));
  const orders = new Map<string, Redemption>();
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) {
      const grantId = item.data().grantId;
      if (typeof grantId === "string") orders.set(grantId, parseRedemption(item.id, item.data()));
    }
  }
  return orders;
}

/**
 * O que o checklist do Recompensar confere no gestor, cada parte com a seção
 * que a regra pede: a suspensão (`users/{uid}.suspendedAt`, com a seção Fãs ou
 * a Moderação) e o vínculo com a central do artista (só com a seção Fãs). O
 * que a pessoa não lê volta `null`.
 */
export async function getOwnerChecks(
  ownerUid: string,
  artistId: string,
  reads: { profile: boolean; central: boolean },
): Promise<{ suspended: boolean | null; member: boolean | null }> {
  const [profile, central] = await Promise.all([
    reads.profile ? readDoc(doc(db(), "users", ownerUid)) : Promise.resolve(null),
    reads.central ? readDoc(doc(db(), "users", ownerUid, "centrals", artistId)) : Promise.resolve(null),
  ]);
  const suspendedAt = profile?.data()?.suspendedAt;
  return {
    suspended: profile ? suspendedAt !== undefined && suspendedAt !== null : null,
    member: central ? central.data() !== undefined : null,
  };
}

