import { collection, getDocs, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { canSeeSection, type StaffMember } from "@/lib/staff";

/**
 * Nomes das centrais, em leitura única, para as telas que mostram ids de
 * central (os números por central, os filtros, os alvos das missões). Com a
 * seção Artistas, todas as centrais; sem ela, só as publicadas, que qualquer
 * conta logada lê (a consulta precisa do `where`, senão as regras recusam).
 * Quem mostra um id sem nome mostra o @. A escuta da página das centrais
 * fica só nela.
 */

export interface ArtistName {
  id: string;
  name: string;
  status: "draft" | "published" | "unpublished";
}

function statusOf(value: unknown): ArtistName["status"] {
  return value === "published" || value === "unpublished" ? value : "draft";
}

/** As centrais na ordem de destaque (`order`), com o nome e a situação, num mapa pelo id (o @). */
export async function getArtistNames(member: Pick<StaffMember, "role" | "sections" | "status"> | null): Promise<Map<string, ArtistName>> {
  const base = collection(db(), "artists");
  const snapshot = await getDocs(canSeeSection(member, "artists") ? base : query(base, where("status", "==", "published")));
  const rows = snapshot.docs.map((item) => {
    const data = item.data();
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : `@${item.id}`;
    const order = typeof data.order === "number" ? data.order : Number.MAX_SAFE_INTEGER;
    return { id: item.id, name, status: statusOf(data.status), order };
  });
  rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  return new Map(rows.map(({ id, name, status }) => [id, { id, name, status }]));
}

/** O nome de uma central pelo mapa, ou o @ quando ela não está nele. */
export function artistNameOf(names: ReadonlyMap<string, ArtistName> | null, id: string): string {
  return names?.get(id)?.name ?? `@${id}`;
}
