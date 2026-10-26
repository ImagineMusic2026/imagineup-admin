import { call } from "@/lib/callable";
import type { CloseReason, FanClubStatus, PostRejectReason, PostStatus, RejectReason } from "@/lib/fan-clubs";

/**
 * A callable da seção Fã-clubes (34.3): `decideFanClub`, uma só para todos os
 * assuntos (a candidatura, o fã-clube, a publicação e a denúncia), com a
 * seção `fanClubs` e edição (o Leitor não decide), e a auditoria na mesma
 * transação. Cada decisão manda o estado que a tela mostrou (`expected`):
 * diferente do de agora, `stale-decision`, e a tela lê de novo. A mesma
 * decisão já tomada responde `ok` sem gravar, então repetir depois de uma
 * falha incerta é seguro.
 *
 * Os motivos da recusa (`details.reason`) que a seção trata, com a frase do
 * servidor (`REASON_MESSAGES` de `errors.ts`, de reserva): `self`,
 * `admin-only` (o Encerrar e o selo de oficial, só do admin), `not-staff`,
 * `no-section`, `invalid-request` (com o `field`),
 * `stale-decision`, `application-not-found`, `fan-club-not-found`,
 * `fan-club-post-not-found`, `fan-club-report-not-found`, `artist-not-open`,
 * `owner-suspended`, `feature-limit`; e, no Recompensar, `prize-not-allowed`
 * (com a trava em `details.problem`), `grant-id-reused`, `reward-not-prize`,
 * `reward-not-found`, `sold-out`, `fan-not-found`, `adjust-above-limit` e
 * `adjust-daily-limit`.
 */

export interface DecisionResult {
  ok: true;
  subject: "application" | "club" | "post" | "report";
  id: string;
  /** O status do assunto depois da decisão (da candidatura, do fã-clube, da publicação ou do item da fila). */
  status: string;
}

/** A saída do Recompensar: o código do pedido de prêmio (sem prêmio, `null`) e os pontos (sem pontos, `null`). */
export interface RewardResult extends DecisionResult {
  grantId: string;
  code: string | null;
  points: number | null;
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

/**
 * Destaca o fã-clube ativo até `featuredUntil` (`AAAA-MM-DD`, de amanhã a 31
 * dias). O mesmo fim de novo responde `ok` sem gravar; o quarto destaque do
 * artista recusa `feature-limit`.
 */
export function featureFanClub(clubId: string, expected: FanClubStatus, featuredUntil: string): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "club", id: clubId, decision: "feature", expected, featuredUntil });
}

/** Tira o Destaque; sem destaque, `ok` sem gravar. */
export function unfeatureFanClub(clubId: string, expected: FanClubStatus): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "club", id: clubId, decision: "unfeature", expected });
}

/**
 * Oficializa o fã-clube ativo (só admin, 34.23): o selo ao lado do nome em
 * todas as telas do app. Já oficial, `ok` sem gravar; o pausado e o
 * encerrado recusam `invalid-request` com `field: 'decision'`.
 */
export function officializeFanClub(clubId: string, expected: FanClubStatus): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "club", id: clubId, decision: "officialize", expected });
}

/** Tira o selo de oficial (só admin), em qualquer status; sem o selo, `ok` sem gravar. */
export function unofficializeFanClub(clubId: string, expected: FanClubStatus): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "club", id: clubId, decision: "unofficialize", expected });
}

export interface RewardGrant {
  /** Sorteado ao abrir o diálogo (`newGrantId`): a repetição com os mesmos campos não dá de novo. */
  grantId: string;
  /** Só ao saldo do gestor, com a seção Fãs (decisão 45). */
  points: number | null;
  /** O pedido da loja, com a seção Recompensas (decisões 40 a 43). */
  prize: { rewardId: string; delivered: boolean; coupon: string | null; message: string | null } | null;
  /** A nota interna, de 1 a 200. */
  note: string;
}

/**
 * O Recompensar: os pontos, o prêmio ou os dois, numa transação com a
 * auditoria. O mesmo `grantId` com os mesmos campos responde o que já foi
 * feito; com outros, `grant-id-reused`.
 */
export function rewardFanClub(clubId: string, expected: FanClubStatus, grant: RewardGrant): Promise<RewardResult> {
  return call("decideFanClub", {
    subject: "club",
    id: clubId,
    decision: "reward",
    expected,
    grantId: grant.grantId,
    points: grant.points,
    prize: grant.prize,
    note: grant.note,
  });
}

/** Aprova, oculta ou reexibe a publicação, com o status que a tela mostrou. */
export function decidePost(postId: string, expected: PostStatus, decision: "approve" | "hide" | "restore"): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "post", id: postId, decision, expected });
}

/** Recusa a publicação em análise com o motivo da lista: os arquivos saem. */
export function rejectPost(postId: string, expected: PostStatus, reason: PostRejectReason): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "post", id: postId, decision: "reject", expected, reason });
}

/** Mantém (`keep`) ou oculta (`action`) a publicação denunciada, com a rodada que a tela mostrou. */
export function decideReport(postId: string, round: number, decision: "keep" | "action"): Promise<DecisionResult> {
  return call("decideFanClub", { subject: "report", id: postId, decision, expected: round });
}
