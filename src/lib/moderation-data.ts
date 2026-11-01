import { collection, collectionGroup, doc, getDoc, orderBy, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { parseFanProfile, type FanProfile } from "@/lib/fan-profile";
import {
  QUEUE_PAGE_SIZE,
  parseComment,
  parseProfileQueueItem,
  parseQueueItem,
  postSnippet,
  type CommentInfo,
  type ProfileQueueItem,
  type QueueItem,
} from "@/lib/moderation";

/**
 * Leituras da Moderação, todas únicas (decisão 19): a fila e os resolvidos,
 * os comentários ocultos, os fãs suspensos e, na página do fã, os itens dele
 * na fila. O comentário e o post de cada item por `getDoc`, guardados
 * enquanto a tela está aberta (`createContentReader`). A tela nunca lê
 * `commentReports` (quem denunciou), que a regra fecha (26.10).
 */

type Page<T> = { items: T[]; cursor: PageCursor | null; hasMore: boolean };

/** A fila (`open`, da denúncia mais nova) ou os resolvidos (do mais novo). */
export async function getQueuePage(status: "open" | "resolved", after: PageCursor | null): Promise<Page<QueueItem>> {
  const page = await getPage(
    query(collection(db(), "moderationQueue"), where("status", "==", status), orderBy(status === "open" ? "lastReportedAt" : "resolvedAt", "desc")),
    { size: QUEUE_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => parseQueueItem(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantos comentários na fila agora. */
export function countOpenQueue(): Promise<number> {
  return countOf(query(collection(db(), "moderationQueue"), where("status", "==", "open")));
}

/** Os itens de um fã na fila, abertos e resolvidos, da denúncia mais nova. */
export async function getFanQueuePage(uid: string, after: PageCursor | null): Promise<Page<QueueItem>> {
  const page = await getPage(query(collection(db(), "moderationQueue"), where("authorUid", "==", uid), orderBy("lastReportedAt", "desc")), {
    size: QUEUE_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseQueueItem(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/**
 * As denúncias de perfil (29.7): os abertos, da denúncia mais nova, ou os
 * resolvidos, do mais novo. São as duas formas dos índices de 29.8; outra
 * consulta pediria índice novo (o emulador não cobra). A tela nunca lê
 * `profileReports` (quem denunciou) nem `blockLists`.
 */
export async function getProfileQueuePage(status: "open" | "resolved", after: PageCursor | null): Promise<Page<ProfileQueueItem>> {
  const page = await getPage(
    query(collection(db(), "profileReportQueue"), where("status", "==", status), orderBy(status === "open" ? "lastReportedAt" : "resolvedAt", "desc")),
    { size: QUEUE_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => parseProfileQueueItem(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantos perfis denunciados esperando agora. */
export function countOpenProfileQueue(): Promise<number> {
  return countOf(query(collection(db(), "profileReportQueue"), where("status", "==", "open")));
}

/** O item de perfil de um fã, pelo id (o uid), ou `null` sem denúncia. */
export async function getProfileQueueItem(uid: string): Promise<ProfileQueueItem | null> {
  const snapshot = await getDoc(doc(db(), "profileReportQueue", uid));
  const data = snapshot.data();
  return data ? parseProfileQueueItem(snapshot.id, data) : null;
}

/** Os comentários ocultos de todos os posts, do mais recente. */
export async function getHiddenCommentsPage(after: PageCursor | null): Promise<Page<CommentInfo>> {
  const page = await getPage(query(collectionGroup(db(), "postComments"), where("status", "==", "hidden"), orderBy("hiddenAt", "desc")), {
    size: QUEUE_PAGE_SIZE,
    after,
  });
  return {
    items: page.docs.map((item) => {
      const data = item.data();
      return parseComment(typeof data.postId === "string" ? data.postId : (item.ref?.parent.parent?.id ?? ""), item.id, data);
    }),
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
}

/** Os fãs suspensos, da suspensão mais nova (a única lista de perfis da Moderação, 26.6). */
export async function getSuspendedPage(after: PageCursor | null): Promise<Page<FanProfile>> {
  const page = await getPage(query(collection(db(), "users"), where("suspendedAt", "!=", null), orderBy("suspendedAt", "desc")), {
    size: QUEUE_PAGE_SIZE,
    after,
  });
  return { items: page.docs.map((item) => parseFanProfile(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/**
 * Quantos comentários visíveis o fã tem (o "Ocultar também os N"): os do
 * Mural e, num segundo `count()`, os dos fã-clubes que o `hideFanComments`
 * também oculta (37.6), os visíveis e os ocultos pelo gestor, que o autor
 * ainda vê (o mesmo `in`, pela junção dos índices de um campo).
 */
export async function countVisibleComments(uid: string): Promise<number> {
  const [mural, fanClubs] = await Promise.all([
    countOf(query(collectionGroup(db(), "postComments"), where("authorUid", "==", uid), where("status", "==", "visible"))),
    countOf(query(collection(db(), "fanClubComments"), where("authorUid", "==", uid), where("status", "in", ["visible", "manager_hidden"]))),
  ]);
  return mural + fanClubs;
}

export interface PostInfo {
  postId: string;
  artistId: string | null;
  snippet: string | null;
}

export interface ContentReader {
  comment(postId: string, commentId: string): Promise<CommentInfo | null>;
  post(postId: string): Promise<PostInfo | null>;
  /** Esquece um comentário (depois de ocultar ou reexibir). */
  forget(postId: string, commentId: string): void;
}

/** Comentários e posts por `getDoc`, guardados enquanto a tela está aberta. */
export function createContentReader(): ContentReader {
  const comments = new Map<string, Promise<CommentInfo | null>>();
  const posts = new Map<string, Promise<PostInfo | null>>();
  return {
    comment(postId, commentId) {
      const key = `${postId}/${commentId}`;
      let pending = comments.get(key);
      if (!pending) {
        pending = getDoc(doc(db(), "posts", postId, "postComments", commentId)).then((snapshot) => {
          const data = snapshot.data();
          return data ? parseComment(postId, commentId, data) : null;
        });
        comments.set(key, pending);
        pending.catch(() => comments.delete(key));
      }
      return pending;
    },
    post(postId) {
      let pending = posts.get(postId);
      if (!pending) {
        pending = getDoc(doc(db(), "posts", postId)).then((snapshot) => {
          const data = snapshot.data();
          return data ? { postId, artistId: typeof data.artistId === "string" ? data.artistId : null, snippet: postSnippet(data.text) } : null;
        });
        posts.set(postId, pending);
        pending.catch(() => posts.delete(postId));
      }
      return pending;
    },
    forget(postId, commentId) {
      comments.delete(`${postId}/${commentId}`);
    },
  };
}
