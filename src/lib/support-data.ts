import { collection, doc, orderBy, query, where } from "firebase/firestore";

import { parseFanProfile, type FanProfile } from "@/lib/fan-profile";
import { createFanProfileReader, type FanProfileReader } from "@/lib/fan-profile-data";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { readDoc } from "@/lib/firestore-read";
import { SUPPORT_PAGE_SIZE, parseSupportMessage, supportQueryPlan, type KindFilter, type SupportMessage, type SupportStatus } from "@/lib/support";

/**
 * Leituras do Suporte (seção 38), todas únicas (decisão 19): as mensagens de
 * cada aba e o perfil de quem mandou. A regra libera `supportMessages` para
 * quem vê a seção, e o `users/{uid}` só por `get` (nunca a lista), então o
 * perfil é lido um a um. Nada aqui grava: resolver e reabrir passam pela
 * `resolveSupportMessage` (`support-api.ts`).
 */

type Page<T> = { items: T[]; cursor: PageCursor | null; hasMore: boolean };

/** Uma página de uma aba, do mais novo, com o filtro de tipo (os quatro índices da seção 38). */
export async function getSupportPage(status: SupportStatus, kind: KindFilter, after: PageCursor | null): Promise<Page<SupportMessage>> {
  const plan = supportQueryPlan(status, kind);
  const page = await getPage(
    query(collection(db(), "supportMessages"), ...plan.where.map(([field, op, value]) => where(field, op, value)), orderBy(plan.orderBy, "desc")),
    { size: SUPPORT_PAGE_SIZE, after },
  );
  return { items: page.docs.map((item) => parseSupportMessage(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantas mensagens abertas agora, de todos os tipos (o cabeçalho; só o `==` do status, sem índice composto). */
export function countOpenSupport(): Promise<number> {
  return countOf(query(collection(db(), "supportMessages"), where("status", "==", "open")));
}

/** O perfil de quem mandou, do servidor, ou `null` quando a conta não existe mais. */
export async function getSupportFan(uid: string): Promise<FanProfile | null> {
  const snapshot = await readDoc(doc(db(), "users", uid));
  return snapshot.exists() ? parseFanProfile(snapshot.id, snapshot.data()) : null;
}

/**
 * Os perfis de quem mandou, com cache por abertura de tela: o mesmo fã em
 * várias mensagens custa uma leitura. O "Atualizar" esquece o cache
 * (`clear`) e os cards leem de novo.
 */
export function createSupportFanReader(): FanProfileReader {
  return createFanProfileReader(getSupportFan);
}
