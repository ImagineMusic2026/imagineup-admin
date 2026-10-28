import { collection, collectionGroup, doc, documentId, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import { fanClubBoxOpen, parseArtistPrivate } from "@/lib/artists";
import {
  FAN_CLUB_ORDER_FIELDS,
  FAN_CLUBS_PAGE_SIZE,
  parseApplication,
  parseApplicationPrivate,
  parseComment,
  parseCommentItem,
  parseContactWhatsapp,
  parseFanClub,
  parseFollower,
  parseHideLogEntry,
  parsePost,
  parsePrize,
  parseReport,
  type ApplicationPrivate,
  type CommentQueueKind,
  type EngagementDay,
  type FanClub,
  type FanClubApplication,
  type FanClubComment,
  type FanClubCommentItem,
  type FanClubFollower,
  type FanClubOrder,
  type FanClubPost,
  type FanClubPrize,
  type FanClubReport,
  type FanClubStatus,
  type HideLogEntry,
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
 * Fãs; as recompensas e os pedidos, só com a seção Recompensas. Desde a Fase 2
 * (37.4), a fila dos comentários, os comentários e o registro do ocultar do
 * gestor; quem reagiu (`fanClubReactions`) e quem denunciou
 * (`fanClubCommentReports`) ficam fechados até para o admin. Cada consulta
 * tem a forma de um índice de 34.6 ou de 37.4, porque o emulador não cobra
 * índice. Nada aqui grava: toda mudança passa pela `decideFanClub`
 * (`fan-club-api.ts`).
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

/**
 * A caixa "Fãs podem postar fotos" de cada central (34.10, item 7), com a
 * autorização de imagem na falta, como o servidor lê. Ela só existe no
 * `artistPrivate`, que a regra deixa ler com a seção Artistas. Sem o
 * documento, a caixa vale fechada, como no servidor.
 */
export async function getPhotoBoxes(artistIds: readonly string[]): Promise<Map<string, boolean>> {
  const unique = [...new Set(artistIds.filter(Boolean))];
  const found = await Promise.all(unique.map((id) => readDoc(doc(db(), "artistPrivate", id))));
  return new Map(
    unique.map((id, index) => {
      const data = found[index]?.data();
      const row = data ? parseArtistPrivate(data) : null;
      return [id, row ? fanClubBoxOpen(row.fanClubs.photosAllowed, row.imageRightsConfirmed) : false];
    }),
  );
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
  /** As reações e os comentários por dia (o mapa `days` da Fase 2, 37.2), somados entre os shards; a taxa escolhe os dias. */
  days: Record<string, EngagementDay>;
}

const SHARD_FIELDS = ["links", "visits", "signups", "joins"] as const;

/** Um número dos shards: o que não é número conta 0, e a parte quebrada sai (o `shardNumber` do servidor). */
function shardNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * A soma dos 16 shards de `fanClubStats/{clubId}/fanClubShards` (uma
 * consulta), campo a campo e nunca negativa, como o `sumFanClubShards` do
 * servidor: os números de agora, sem esperar a cópia da noite. O mapa `days`
 * vem junto, dia a dia; o dia que não é um mapa fica de fora.
 */
export async function getShardNumbers(clubId: string): Promise<ShardNumbers> {
  const snapshot = await readQuery(collection(db(), "fanClubStats", clubId, "fanClubShards"));
  const sums: ShardNumbers = { links: 0, visits: 0, signups: 0, joins: 0, days: {} };
  for (const item of snapshot.docs) {
    const data = item.data();
    for (const field of SHARD_FIELDS) sums[field] += shardNumber(data[field]);
    const days = data.days;
    if (!days || typeof days !== "object" || Array.isArray(days)) continue;
    for (const [day, value] of Object.entries(days as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const sum = (sums.days[day] ??= { reactions: 0, comments: 0 });
      sum.reactions += shardNumber(row.reactions);
      sum.comments += shardNumber(row.comments);
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
// Comentários (37.4 e 37.10)
// ---------------------------------------------------------------------------

/**
 * A fila dos comentários: os abertos, da última atividade (a última denúncia
 * ou o pedido de revisão; o índice `status, lastActivityAt` decrescente), ou
 * os resolvidos, da decisão mais nova (`status, resolvedAt` decrescente).
 */
export async function getCommentQueuePage(status: ReportStatus, after: PageCursor | null): Promise<Page<FanClubCommentItem>> {
  const field = status === "open" ? "lastActivityAt" : "resolvedAt";
  const page = await getPage(query(collection(db(), "fanClubCommentQueue"), where("status", "==", status), orderBy(field, "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseCommentItem(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantos itens abertos de um tipo (o `count()` com as duas igualdades, pela junção dos índices de um campo). */
export function countOpenCommentItems(kind: CommentQueueKind): Promise<number> {
  return countOf(query(collection(db(), "fanClubCommentQueue"), where("status", "==", "open"), where("kind", "==", kind)));
}

/**
 * Os comentários citados pela página na tela (a fila e o registro do ocultar
 * guardam só o id), um `in` pelo `documentId()` a cada 30 (o teto do
 * Firestore). O comentário apagado (a conta do autor saiu, ou ele saiu com a
 * publicação ou com o de cima) volta `null`.
 */
export async function getCommentsByIds(ids: readonly string[]): Promise<Map<string, FanClubComment | null>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += ARTIST_FILTER_MAX) chunks.push(unique.slice(start, start + ARTIST_FILTER_MAX));
  const snapshots = await Promise.all(chunks.map((chunk) => readQuery(query(collection(db(), "fanClubComments"), where(documentId(), "in", chunk)))));
  const found = new Map<string, FanClubComment | null>(unique.map((id) => [id, null]));
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) found.set(item.id, parseComment(item.id, item.data()));
  }
  return found;
}

/** Os comentários de uma publicação em todos os status, do mais novo (o índice `postId, createdAt` decrescente). */
export async function getPostCommentsPage(postId: string, after: PageCursor | null): Promise<Page<FanClubComment>> {
  const page = await getPage(query(collection(db(), "fanClubComments"), where("postId", "==", postId), orderBy("createdAt", "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseComment(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** O registro do ocultar do gestor de um fã-clube, da linha mais nova (o índice `clubId, at` decrescente). */
export async function getHideLogPage(clubId: string, after: PageCursor | null): Promise<Page<HideLogEntry>> {
  const page = await getPage(query(collection(db(), "fanClubHideLog"), where("clubId", "==", clubId), orderBy("at", "desc")), {
    size: FAN_CLUBS_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseHideLogEntry(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantas vezes o gestor ocultou (o `count()` com as duas igualdades, pela junção). */
export function countManagerHides(clubId: string): Promise<number> {
  return countOf(query(collection(db(), "fanClubHideLog"), where("clubId", "==", clubId), where("action", "==", "hidden")));
}

// ---------------------------------------------------------------------------
// O "Aguardando a equipe"
// ---------------------------------------------------------------------------

/** As cinco contagens do cartão da Visão geral (cinco `count()`). */
export async function countWaiting(): Promise<WaitingCounts> {
  const [applications, posts, reports, commentReports, commentReviews] = await Promise.all([
    countPendingApplications(),
    countPendingPosts(),
    countOpenReports(),
    countOpenCommentItems("report"),
    countOpenCommentItems("review"),
  ]);
  return { applications, posts, reports, commentReports, commentReviews };
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

