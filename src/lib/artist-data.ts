import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";

import {
  createArtistsJoin,
  parseArtist,
  parseArtistPrivate,
  type Artist,
  type ArtistEntry,
  type ArtistPrivate,
} from "@/lib/artists";
import { db } from "@/lib/firebase";

/**
 * Leituras dos artistas. As regras do Firestore liberam `artists` e
 * `artistPrivate` inteiras para quem vê a seção `artists` (os fãs só leem
 * `artists` publicados, e nunca o privado). Nada aqui grava: toda mudança
 * passa pelas Cloud Functions (`artist-api.ts`).
 */

/**
 * Todas as centrais em tempo real, na ordem de destaque (ordenada aqui, sem
 * índice), com o privado de cada uma junto pelo id. A lista sai assim que as
 * centrais chegam; até o privado de uma central chegar, `internal` é `null`.
 *
 * Se uma das duas escutas falhar, as duas param e o erro sobe uma vez só: a
 * tela mostra o erro e "Tentar de novo" abre as duas outra vez.
 */
export function subscribeToArtists(onChange: (artists: ArtistEntry[]) => void, onError: (error: unknown) => void): Unsubscribe {
  let stopped = false;
  const unsubscribes: Unsubscribe[] = [];
  const stop = () => {
    stopped = true;
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    onError(error);
  };
  const join = createArtistsJoin((entries) => {
    if (!stopped) onChange(entries);
  });
  unsubscribes.push(
    onSnapshot(
      collection(db(), "artists"),
      (snapshot) => join.setArtists(snapshot.docs.map((item) => parseArtist(item.id, item.data()))),
      fail,
    ),
    onSnapshot(
      collection(db(), "artistPrivate"),
      (snapshot) => join.setPrivates(snapshot.docs.map((item) => [item.id, parseArtistPrivate(item.data())] as const)),
      fail,
    ),
  );
  // Uma falha antes de as duas escutas existirem também fecha as duas.
  if (stopped) stop();
  return stop;
}

/** Uma central, lida uma vez (para conferir se um `createArtist` sem resposta criou o rascunho). */
export async function getArtist(artistId: string): Promise<Artist | null> {
  const snapshot = await getDoc(doc(db(), "artists", artistId));
  return snapshot.exists() ? parseArtist(snapshot.id, snapshot.data()) : null;
}

/** Privado da central (gestor, autorização, contato e autoria), lido uma vez. Sem documento, `null`. */
export async function getArtistPrivate(artistId: string): Promise<ArtistPrivate | null> {
  const snapshot = await getDoc(doc(db(), "artistPrivate", artistId));
  return snapshot.exists() ? parseArtistPrivate(snapshot.data()) : null;
}

/**
 * A central tem post ou show (rascunho inclusive)? O `deleteArtist` recusa
 * com `has-content`; a lixeira avisa antes, como no `has-fans`. Duas leituras.
 */
export async function artistHasContent(artistId: string): Promise<boolean> {
  const [posts, events] = await Promise.all([
    getDocs(query(collection(db(), "posts"), where("artistId", "==", artistId), limit(1))),
    getDocs(query(collection(db(), "events"), where("artistIds", "array-contains", artistId), limit(1))),
  ]);
  return !posts.empty || !events.empty;
}
