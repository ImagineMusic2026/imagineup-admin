import { Timestamp, collection, doc, getDoc, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import { dayKey, dayStartMs } from "@/lib/day";
import { parseEvent, type AgendaEvent } from "@/lib/events";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { parseComment, type CommentInfo } from "@/lib/moderation";
import { COMMENTS_PAGE_SIZE, POSTS_PAGE_SIZE, parsePost, type Post, type PostStatus } from "@/lib/posts";

/**
 * Leituras do Mural, todas únicas (21.9 e decisão 19): os posts por
 * `createdAt` decrescente (com a central e a situação pelos índices de
 * 26.11), a contagem dos no ar, os comentários de um post e os shows da
 * central para o post de show. Nada aqui grava.
 */

type Page<T> = { items: T[]; cursor: PageCursor | null; hasMore: boolean };

export interface PostFilters {
  artistId: string | null;
  status: PostStatus | null;
}

/** O id de um post novo, gerado no painel: a nova tentativa do `createPost` não cria outro rascunho. */
export function newPostId(): string {
  return doc(collection(db(), "posts")).id;
}

function postFilters(filters: PostFilters): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (filters.artistId) constraints.push(where("artistId", "==", filters.artistId));
  if (filters.status) constraints.push(where("status", "==", filters.status));
  return constraints;
}

export async function getPostsPage(filters: PostFilters, after: PageCursor | null): Promise<Page<Post>> {
  const page = await getPage(query(collection(db(), "posts"), ...postFilters(filters), orderBy("createdAt", "desc")), { size: POSTS_PAGE_SIZE, after });
  return { items: page.docs.map((item) => parsePost(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

export async function getPost(postId: string): Promise<Post | null> {
  const snapshot = await getDoc(doc(db(), "posts", postId));
  const data = snapshot.data();
  return data ? parsePost(snapshot.id, data) : null;
}

/** "N posts no ar" (da central, com o filtro). */
export function countPublishedPosts(artistId: string | null): Promise<number> {
  return countOf(query(collection(db(), "posts"), ...postFilters({ artistId, status: "published" })));
}

/** Os comentários de um post, do mais novo, 20 por vez. */
export async function getPostCommentsPage(postId: string, after: PageCursor | null): Promise<Page<CommentInfo>> {
  const page = await getPage(query(collection(db(), "posts", postId, "postComments"), orderBy("createdAt", "desc")), { size: COMMENTS_PAGE_SIZE, after });
  return { items: page.docs.map((item) => parseComment(postId, item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Os shows da central de hoje em diante (rascunhos inclusive), para o post de show. */
export async function getArtistEventChoices(artistId: string, now: number): Promise<AgendaEvent[]> {
  const page = await getPage(
    query(
      collection(db(), "events"),
      where("artistIds", "array-contains", artistId),
      where("startsAt", ">=", Timestamp.fromMillis(dayStartMs(dayKey(now)))),
      orderBy("startsAt"),
    ),
    { size: 50 },
  );
  return page.docs.map((item) => parseEvent(item.id, item.data()));
}

/** Os shows citados pelos posts de show da página (um `getDoc` de cada). */
export async function getEventsById(ids: readonly string[]): Promise<Map<string, AgendaEvent | null>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map((id) => getDoc(doc(db(), "events", id))));
  return new Map(unique.map((id, index) => [id, found[index].exists() ? parseEvent(id, found[index].data() ?? {}) : null]));
}
