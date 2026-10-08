import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

/**
 * Nomes das missões e das conquistas, para dar nome aos ids dos números do
 * dia (`byMission`, `byAchievement`) e da carteira do fã. Leitura única com
 * cache por abertura de tela: um `getDoc` de cada catálogo e um de
 * `missionArchive/{id}` por missão que já saiu do catálogo. Quando não há
 * nome, a tela mostra o id.
 *
 * As regras (26.10) liberam `config/missions`, `missionArchive` e
 * `config/achievements` para quem vê `missions`, `overview` ou `fans`.
 */

/** id para título dos itens de um catálogo (`missions` ou `achievements`). */
export function titlesOf(data: Record<string, unknown> | undefined, field: "missions" | "achievements"): Map<string, string> {
  const titles = new Map<string, string>();
  const list = data?.[field];
  if (!Array.isArray(list)) return titles;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { id, title } = item as { id?: unknown; title?: unknown };
    if (typeof id === "string" && typeof title === "string" && title.trim() && !titles.has(id)) titles.set(id, title.trim());
  }
  return titles;
}

export interface GameNamesReader {
  /** Títulos das missões pedidas: do catálogo e, para as arquivadas, do `missionArchive`. */
  missionTitles(ids: readonly string[]): Promise<Map<string, string>>;
  /** Nomes de todas as conquistas do catálogo. */
  achievementNames(): Promise<Map<string, string>>;
}

/** Leitor com cache: crie um por abertura de tela (o "Atualizar" cria outro). */
export function createGameNamesReader(): GameNamesReader {
  let catalog: Promise<Map<string, string>> | null = null;
  let achievements: Promise<Map<string, string>> | null = null;
  const archived = new Map<string, Promise<string | null>>();

  function missionCatalog(): Promise<Map<string, string>> {
    if (!catalog) {
      catalog = getDoc(doc(db(), "config", "missions")).then((snapshot) => titlesOf(snapshot.data(), "missions"));
      catalog.catch(() => {
        catalog = null;
      });
    }
    return catalog;
  }

  function archivedTitle(id: string): Promise<string | null> {
    let pending = archived.get(id);
    if (!pending) {
      pending = getDoc(doc(db(), "missionArchive", id)).then((snapshot) => {
        const title = snapshot.data()?.title;
        return typeof title === "string" && title.trim() ? title.trim() : null;
      });
      archived.set(id, pending);
      pending.catch(() => archived.delete(id));
    }
    return pending;
  }

  return {
    async missionTitles(ids) {
      const titles = await missionCatalog();
      const result = new Map<string, string>();
      const outside: string[] = [];
      for (const id of new Set(ids)) {
        const title = titles.get(id);
        if (title) result.set(id, title);
        else outside.push(id);
      }
      const found = await Promise.all(outside.map((id) => archivedTitle(id)));
      found.forEach((title, index) => {
        if (title) result.set(outside[index], title);
      });
      return result;
    },
    achievementNames() {
      if (!achievements) {
        achievements = getDoc(doc(db(), "config", "achievements")).then((snapshot) =>
          titlesOf(snapshot.data(), "achievements"),
        );
        achievements.catch(() => {
          achievements = null;
        });
      }
      return achievements;
    },
  };
}
