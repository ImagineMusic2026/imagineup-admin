import { collection, doc, endAt, getDoc, getDocs, limit, orderBy, query, startAt, where } from "firebase/firestore";

import { findFanByEmail } from "@/lib/fan-api";
import { fanDisplayName, parseFanProfile, type FanProfile } from "@/lib/fan-profile";
import { SEARCH_LIMIT, matchesAllWords, type FanSearchKind } from "@/lib/fans";
import { db } from "@/lib/firebase";

/**
 * A busca da seção Fãs (26.7): nome e @ pelo `searchKeys` e pelo @ por
 * começo, o código de convite pelo `fanInvites`, o uid colado pelo perfil, e
 * o e-mail pela callable `findFanByEmail` (só quem edita a seção, com teto
 * e auditoria). Leitura única.
 */

export type FanSearchResult =
  | { kind: "profiles"; profiles: FanProfile[]; limited: boolean }
  /** O e-mail achou um fã: a tela abre a ficha. */
  | { kind: "open"; uid: string }
  | { kind: "none"; message: string };

async function byUid(uid: string): Promise<FanProfile | null> {
  const snapshot = await getDoc(doc(db(), "users", uid));
  return snapshot.exists() ? parseFanProfile(snapshot.id, snapshot.data()) : null;
}

async function byCode(code: string): Promise<FanProfile | null> {
  const snapshot = await getDocs(query(collection(db(), "fanInvites"), where("code", "==", code), limit(1)));
  const owner = snapshot.docs[0];
  if (!owner) return null;
  const uid = typeof owner.data().uid === "string" ? (owner.data().uid as string) : owner.id;
  return byUid(uid);
}

async function byText(words: string[], longest: string, handle: string | null): Promise<{ profiles: FanProfile[]; limited: boolean }> {
  const [keys, handles] = await Promise.all([
    longest
      ? getDocs(query(collection(db(), "users"), where("searchKeys", "array-contains", longest), limit(SEARCH_LIMIT)))
      : Promise.resolve(null),
    handle
      ? getDocs(query(collection(db(), "users"), orderBy("username"), startAt(handle), endAt(`${handle}`), limit(SEARCH_LIMIT)))
      : Promise.resolve(null),
  ]);
  const found = new Map<string, FanProfile>();
  for (const snapshot of [keys, handles]) {
    for (const item of snapshot?.docs ?? []) found.set(item.id, parseFanProfile(item.id, item.data()));
  }
  const fromHandle = new Set(handles?.docs.map((item) => item.id) ?? []);
  const profiles = [...found.values()]
    .filter((profile) => fromHandle.has(profile.uid) || matchesAllWords(profile, words))
    .sort((a, b) => fanDisplayName(a).localeCompare(fanDisplayName(b), "pt-BR", { sensitivity: "base" }));
  return { profiles, limited: (keys?.docs.length ?? 0) >= SEARCH_LIMIT || (handles?.docs.length ?? 0) >= SEARCH_LIMIT };
}

export async function searchFans(search: FanSearchKind, options: { canEdit: boolean }): Promise<FanSearchResult> {
  if (search.kind === "email") {
    if (!options.canEdit) return { kind: "none", message: "A busca por e-mail é só para quem edita a seção Fãs." };
    const { uid } = await findFanByEmail(search.email);
    return uid ? { kind: "open", uid } : { kind: "none", message: "Nenhum fã com esse e-mail." };
  }
  if (search.kind === "uid") {
    const profile = await byUid(search.uid);
    if (profile) return { kind: "profiles", profiles: [profile], limited: false };
    return { kind: "none", message: "Nenhum fã com esse identificador." };
  }
  const [code, text] = await Promise.all([
    search.code ? byCode(search.code) : Promise.resolve(null),
    byText(search.words, search.longest, search.handle),
  ]);
  const profiles = code ? [code, ...text.profiles.filter((profile) => profile.uid !== code.uid)] : text.profiles;
  if (profiles.length === 0) return { kind: "none", message: "Nenhum fã encontrado." };
  return { kind: "profiles", profiles, limited: text.limited };
}
