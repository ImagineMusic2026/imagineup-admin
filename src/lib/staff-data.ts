import { collection, doc, getDocs, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { parseStaffInvite, parseStaffMember, sortInvites, sortMembers, type StaffInvite, type StaffMember } from "@/lib/staff";

/**
 * Leituras em tempo real da equipe. As regras do Firestore permitem:
 * - `staff/{uid}` da própria pessoa, em qualquer status;
 * - `staff` inteira e `staffInvites` só para admin ativo.
 * Nada aqui grava: toda mudança passa pelas Cloud Functions (`staff-api.ts`).
 */

export type OwnStaffSnapshot =
  | { kind: "member"; member: StaffMember }
  | { kind: "missing" };

/**
 * Documento da própria pessoa. Um "não existe" vindo só do cache local (sem
 * conexão, logo depois de abrir) não é resposta: o guard esperaria o servidor
 * em vez de expulsar alguém que é da equipe.
 */
export function subscribeToOwnStaff(
  uid: string,
  onChange: (snapshot: OwnStaffSnapshot) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db(), "staff", uid),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.exists()) {
        onChange({ kind: "member", member: parseStaffMember(snapshot.id, snapshot.data()) });
      } else if (!snapshot.metadata.fromCache) {
        onChange({ kind: "missing" });
      }
    },
    onError,
  );
}

/** Coleção `staff` inteira (admin), já ordenada para a lista. */
export function subscribeToTeam(onChange: (members: StaffMember[]) => void, onError: (error: unknown) => void): Unsubscribe {
  return onSnapshot(
    collection(db(), "staff"),
    (snapshot) => {
      onChange(sortMembers(snapshot.docs.map((item) => parseStaffMember(item.id, item.data()))));
    },
    onError,
  );
}

/** Convites pendentes (admin), do mais novo para o mais velho. Sem índice composto. */
export function subscribeToPendingInvites(
  onChange: (invites: StaffInvite[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db(), "staffInvites"), where("status", "==", "pending")),
    (snapshot) => {
      onChange(sortInvites(snapshot.docs.map((item) => parseStaffInvite(item.id, item.data()))));
    },
    onError,
  );
}

/**
 * Equipe ativa, lida uma vez (lista de gestores das centrais). Só admin pode
 * listar `staff`: para os outros, as regras recusam e a tela segue sem a lista.
 */
export async function getActiveTeam(): Promise<StaffMember[]> {
  const snapshot = await getDocs(collection(db(), "staff"));
  return sortMembers(snapshot.docs.map((item) => parseStaffMember(item.id, item.data()))).filter(
    (member) => member.status === "active",
  );
}
