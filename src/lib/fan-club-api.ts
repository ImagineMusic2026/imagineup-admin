import { call } from "@/lib/callable";
import type { CloseReason, FanClubStatus, RejectReason } from "@/lib/fan-clubs";

/**
 * A callable da seção Fã-clubes (34.3): `decideFanClub`, uma só para todos os
 * assuntos, com a seção `fanClubs` e edição (o Leitor não decide), e a
 * auditoria na mesma transação. Cada decisão manda o estado que a tela
 * mostrou (`expected`): diferente do de agora, `stale-decision`, e a tela lê
 * de novo. A mesma decisão já tomada responde `ok` sem gravar, então repetir
 * depois de uma falha incerta é seguro.
 *
 * O servidor da etapa 1 decide a candidatura e o fã-clube, o Destaque
 * inclusive (`feature` e `unfeature`, que este painel deixou para o Painel B);
 * as publicações, as denúncias e o Recompensar chegam com as etapas 2 a 5.
 */

export interface DecisionResult {
  ok: true;
  subject: "application" | "club";
  id: string;
  /** O status do assunto depois da decisão (da candidatura ou do fã-clube). */
  status: string;
}

/** O que a tela mostrou da candidatura: a rodada e o `submittedAt` em ms (a rodada não muda quando o fã desiste e manda de novo). */
export interface ApplicationShown {
  round: number;
  submittedAtMs: number | null;
}

/** Aprova a candidatura; sem `name`, fica o nome proposto. */
export function approveApplication(uid: string, shown: ApplicationShown, name: string | null): Promise<DecisionResult> {
  return call("decideFanClub", {
    subject: "application",
    id: uid,
    decision: "approve",
    expected: shown.round,
    submittedAt: shown.submittedAtMs,
    name,
  });
}

/** Recusa a candidatura com o motivo da lista; o fã pode mandar de novo em 30 dias (na 3ª rodada, não). */
export function rejectApplication(uid: string, shown: ApplicationShown, reason: RejectReason): Promise<DecisionResult> {
  return call("decideFanClub", {
    subject: "application",
    id: uid,
    decision: "reject",
    expected: shown.round,
    submittedAt: shown.submittedAtMs,
    reason,
  });
}

/** Pausa ou reativa o fã-clube, com o status que a tela mostrou. */
export function setFanClubPaused(clubId: string, expected: FanClubStatus, paused: boolean): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "club", id: clubId, decision: paused ? "pause" : "resume", expected });
}

/** Encerra o fã-clube (só admin): `staff` (nunca mais) ou `owner_request` (pode voltar em 30 dias). */
export function closeFanClub(clubId: string, expected: FanClubStatus, reason: CloseReason): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "club", id: clubId, decision: "close", expected, reason });
}
