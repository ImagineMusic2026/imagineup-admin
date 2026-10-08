import { Timestamp, collection, getDocs, limit, orderBy, query, where, type QueryConstraint } from "firebase/firestore";

import { auditPlan, parseAuditEntry, periodStartDay, type AuditEntry, type AuditFilters } from "@/lib/audit";
import { dayKey, dayStartMs, shiftDay } from "@/lib/day";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { parseStaffMember, sortMembers } from "@/lib/staff";

/**
 * Leituras dos Logs, em leitura única. As regras liberam `staffAudit` e a
 * lista da equipe (`staff`, para o filtro por pessoa) a quem vê `audit`
 * (26.10). As formas de consulta são as dos cinco índices de `staffAudit`
 * (26.11): pessoa, seção, pessoa com seção, ação e alvo, com o `createdAt`
 * decrescente e o período como faixa.
 */

export const AUDIT_PAGE_SIZE = 50;

/** A consulta dos filtros, sem limite nem cursor. */
export function auditQuery(filters: AuditFilters, now: number) {
  const plan = auditPlan(filters);
  const constraints: QueryConstraint[] = [];
  switch (plan.kind) {
    case "target":
      constraints.push(where("targets", "array-contains", plan.target));
      break;
    case "action":
      constraints.push(where("action", "==", plan.action));
      break;
    case "person":
      constraints.push(where("actorUid", "==", plan.actorUid));
      break;
    case "section":
      constraints.push(where("section", "==", plan.section));
      break;
    case "person-section":
      constraints.push(where("actorUid", "==", plan.actorUid), where("section", "==", plan.section));
      break;
    case "all":
      break;
  }
  const startDay = periodStartDay(filters.period, dayKey(now), shiftDay);
  if (startDay) constraints.push(where("createdAt", ">=", Timestamp.fromMillis(dayStartMs(startDay))));
  constraints.push(orderBy("createdAt", "desc"));
  return query(collection(db(), "staffAudit"), ...constraints);
}

export async function getAuditPage(
  filters: AuditFilters,
  now: number,
  after: PageCursor | null,
): Promise<{ items: AuditEntry[]; cursor: PageCursor | null; hasMore: boolean }> {
  const page = await getPage(auditQuery(filters, now), { size: AUDIT_PAGE_SIZE, after });
  return { items: page.docs.map((item) => parseAuditEntry(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Quantas entradas a consulta tem (1 leitura a cada mil). */
export function countAudit(filters: AuditFilters, now: number): Promise<number> {
  return countOf(auditQuery(filters, now));
}

/** A equipe para o filtro por pessoa, na ordem da lista da Equipe. */
export async function getAuditPeople(): Promise<{ uid: string; name: string }[]> {
  const snapshot = await getDocs(collection(db(), "staff"));
  return sortMembers(snapshot.docs.map((item) => parseStaffMember(item.id, item.data()))).map((member) => ({
    uid: member.uid,
    name: member.displayName || member.email || member.uid,
  }));
}

/**
 * O uid do fã pelo @, para o filtro de alvo. Lista `users` pelo @, o que as
 * regras só deixam para quem vê Fãs (a Moderação lista só os suspensos).
 */
export async function findFanUidByHandle(handle: string): Promise<string | null> {
  const username = handle.trim().replace(/^@/, "").toLowerCase();
  if (!username) return null;
  const snapshot = await getDocs(query(collection(db(), "users"), where("username", "==", username), limit(1)));
  return snapshot.docs[0]?.id ?? null;
}
