import {
  getCountFromServer,
  getDocs,
  limit,
  query,
  startAfter,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

/**
 * Listas com "Carregar mais", em leitura única: cada página pede um documento
 * a mais que o tamanho, para saber se há outra sem uma leitura extra. O
 * cursor é o último documento da página (`startAfter`). Nenhuma lista nova
 * escuta em tempo real (decisão 19).
 */

export type PageCursor = QueryDocumentSnapshot<DocumentData>;

export interface PageResult {
  docs: QueryDocumentSnapshot<DocumentData>[];
  /** Último documento da página: o `after` da próxima. */
  cursor: PageCursor | null;
  hasMore: boolean;
}

export async function getPage(
  base: Query<DocumentData>,
  { size, after = null }: { size: number; after?: PageCursor | null },
): Promise<PageResult> {
  const constraints = after ? [startAfter(after), limit(size + 1)] : [limit(size + 1)];
  const snapshot = await getDocs(query(base, ...constraints));
  const docs = snapshot.docs.slice(0, size);
  return { docs, cursor: docs.at(-1) ?? after, hasMore: snapshot.docs.length > size };
}

/** `count()` no servidor: 1 leitura a cada mil documentos contados. */
export async function countOf(base: Query<DocumentData>): Promise<number> {
  const snapshot = await getCountFromServer(base);
  return snapshot.data().count;
}
