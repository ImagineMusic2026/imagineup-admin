import { doc, getDoc } from "firebase/firestore";

import { parseFanProfile, type FanProfile } from "@/lib/fan-profile";
import { db } from "@/lib/firebase";

/**
 * Perfis dos fãs, em leitura única. As regras liberam `users/{uid}` para a
 * seção Fãs (ler e listar) e para a Moderação (ler qualquer um e listar só os
 * suspensos), 26.10. Nada aqui grava.
 */

/** Um perfil, ou `null` quando a conta não existe mais. */
export async function getFanProfile(uid: string): Promise<FanProfile | null> {
  const snapshot = await getDoc(doc(db(), "users", uid));
  return snapshot.exists() ? parseFanProfile(snapshot.id, snapshot.data()) : null;
}

export interface FanProfileReader {
  /** Um perfil, lido uma vez por abertura de tela. */
  get(uid: string): Promise<FanProfile | null>;
  /** Vários, em paralelo; os que não existem ficam de fora do mapa. */
  getMany(uids: readonly string[]): Promise<Map<string, FanProfile>>;
  /** Esquece o que foi lido (o "Atualizar" da tela). */
  clear(): void;
}

/**
 * Leitor com cache por abertura de tela: a mesma pessoa em várias linhas (o
 * autor de vários comentários) custa uma leitura. Uma falha não fica no cache.
 */
export function createFanProfileReader(read: (uid: string) => Promise<FanProfile | null> = getFanProfile): FanProfileReader {
  const cache = new Map<string, Promise<FanProfile | null>>();
  function get(uid: string): Promise<FanProfile | null> {
    let pending = cache.get(uid);
    if (!pending) {
      pending = read(uid);
      cache.set(uid, pending);
      pending.catch(() => cache.delete(uid));
    }
    return pending;
  }
  return {
    get,
    async getMany(uids) {
      const unique = [...new Set(uids)];
      const profiles = await Promise.all(unique.map((uid) => get(uid)));
      const found = new Map<string, FanProfile>();
      profiles.forEach((profile, index) => {
        if (profile) found.set(unique[index], profile);
      });
      return found;
    },
    clear() {
      cache.clear();
    },
  };
}

/** Atalho para quem lê uma vez só: os perfis de vários uids, em paralelo. */
export function getFanProfiles(uids: readonly string[]): Promise<Map<string, FanProfile>> {
  return createFanProfileReader().getMany(uids);
}
