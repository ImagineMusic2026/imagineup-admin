"use client";

import { Ban, Pause, Play, ShieldCheck, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CloseDialog } from "@/components/fa-clubes/fan-club-dialogs";
import { FAN_CLUB_STYLES, FanClubName, FanClubsBackLink, PersonCell, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { HideLogSection, PostCommentsDialog } from "@/components/fa-clubes/fan-club-comments";
import { FeatureDialog, RewardDialog, type RewardAttempt } from "@/components/fa-clubes/fan-club-reward-dialogs";
import { FollowersSection, MonthsSection, NumbersSection, PostsSection, QualitySection, RewardsSection } from "@/components/fa-clubes/fan-club-sections";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { StatusChip } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { logsHref } from "@/lib/audit";
import { UNCERTAIN_RETRY_TEXT } from "@/lib/errors";
import { decideFanClubComment, decidePost, officializeFanClub, setFanClubPaused, unfeatureFanClub, unofficializeFanClub } from "@/lib/fan-club-api";
import { getApplication, getFanClub, getShardNumbers } from "@/lib/fan-club-data";
import {
  FAN_CLUB_AUDIT_TEXT,
  HIDE_POST_TEXT,
  OFFICIALIZE_TEXT,
  PAUSE_TEXT,
  RESTORE_POST_TEXT,
  RESUME_TEXT,
  UNFEATURE_TEXT,
  authorLabel,
  blocksCommentRetry,
  blocksDecisionRetry,
  clubDecisions,
  commentDecisionText,
  commentDoneText,
  fanClubLabel,
  fanClubStatusText,
  fanClubTarget,
  featuredText,
  lastRewardText,
  officialText,
  ownerLabel,
  unofficializeText,
  type FanClub,
  type FanClubComment,
  type FanClubPost,
} from "@/lib/fan-clubs";
import { formatNumber } from "@/lib/format";
import { canEditSection, canSeeSection, isAdmin, type StaffMember } from "@/lib/staff";

/**
 * A ficha do fã-clube (`/fa-clubes/[id]`, 34.10, item 5): o status com
 * Pausar, Reativar e Encerrar e o selo de oficial com Oficializar e Tirar a
 * oficialização (34.23; Encerrar e o selo só para admin); os números (os 16
 * shards e a cópia da noite), o mês e o mês passado e a qualidade dos
 * seguidores; os seguidores recentes (só com a seção Fãs); o Destaque e as
 * recompensas, com o histórico; as publicações com Ocultar e Reexibir, os
 * totais de reações e de comentários e o diálogo dos comentários; o registro
 * do ocultar do gestor e a taxa de engajamento (a Fase 2, 37.10); a
 * candidatura de origem e o "Abrir nos Logs".
 */

/**
 * A candidatura do gestor diante deste fã-clube: a de origem (o `clubId` dela é
 * este); uma nova, que substituiu a de origem (o encerramento a pedido deixa
 * o fã voltar, e a candidatura é um documento só por fã); nenhuma, sem gestor
 * ou sem documento; ou desconhecida, quando a leitura falhou.
 */
type Origin = "same" | "replaced" | "gone" | "unknown";

/**
 * O fã-clube, a candidatura do gestor e a versão do regulamento que ele
 * aceitou (o checklist do Recompensar). A falha da candidatura não derruba a ficha.
 */
async function readFanClub(clubId: string): Promise<{ club: FanClub | null; origin: Origin; rulesVersion: string | null }> {
  const club = await getFanClub(clubId);
  if (!club?.ownerUid) return { club, origin: "gone", rulesVersion: null };
  try {
    const application = await getApplication(club.ownerUid);
    if (!application) return { club, origin: "gone", rulesVersion: null };
    const same = application.clubId === club.id;
    return { club, origin: same ? "same" : "replaced", rulesVersion: same ? application.rulesVersion || null : null };
  } catch {
    return { club, origin: "unknown", rulesVersion: null };
  }
}

export function FanClubPage({ clubId }: { clubId: string }) {
  return <SectionGate section="fanClubs">{(member) => <FanClubContent clubId={clubId} member={member} />}</SectionGate>;
}

type Dialogs = "close" | "feature" | "reward" | null;

function FanClubContent({ clubId, member }: { clubId: string; member: StaffMember }) {
  const canEdit = canEditSection(member, "fanClubs");
  const [round, setRound] = useState(0);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // Uma instância do ConfirmDialog por pedido: o seguinte nunca herda o erro ou o "Tentar de novo" do anterior.
  const [confirmKey, setConfirmKey] = useState(0);
  const [dialog, setDialog] = useState<Dialogs>(null);
  // A publicação com o diálogo dos comentários aberto (que tem a confirmação dele).
  const [commentsPost, setCommentsPost] = useState<FanClubPost | null>(null);
  const [rewardAttempt, setRewardAttempt] = useState<RewardAttempt | null>(null);
  // O pedido que foi ao servidor pede a releitura, que só sai com nenhum
  // diálogo aberto (no molde da página do fã na Moderação).
  const [pendingRefresh, setPendingRefresh] = useState(false);
  // A permissão de editar caiu com um diálogo aberto: eles fecham, e a
  // resposta que chegar depois só marca a releitura.
  const [editSeen, setEditSeen] = useState(canEdit);
  if (editSeen !== canEdit) {
    setEditSeen(canEdit);
    if (!canEdit) {
      setConfirm(null);
      setConfirmKey((value) => value + 1);
      setDialog(null);
    }
  }
  if (pendingRefresh && confirm === null && dialog === null && commentsPost === null) {
    setPendingRefresh(false);
    setRound((value) => value + 1);
  }

  // O aviso da decisão recebe o foco: o diálogo devolve o foco ao botão que o
  // abriu, e a releitura tira esse botão da tela (no molde da ficha do fã).
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const read = useLoad(
    useCallback(() => readFanClub(clubId), [clubId]),
    round,
  );
  const shards = useLoad(
    useCallback(() => getShardNumbers(clubId), [clubId]),
    round,
  );
  const date = read.loadedAt ?? new Date(now);
  const refreshError = read.refreshError ?? shards.refreshError;

  function markStale() {
    setPendingRefresh(true);
  }

  /** O Atualizar lê de novo a ficha inteira: o fã-clube, os números e as seções. */
  function refresh() {
    setPendingRefresh(false);
    setRound((value) => value + 1);
  }

  /** A decisão deu certo: o aviso aparece e a ficha lê de novo uma vez. */
  function changed(message: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
    refresh();
  }

  /** A confirmação de uma decisão sem campo, no molde da `decideFanClub`: o estado da tela vai como `expected`. */
  function ask(
    request: Pick<ConfirmRequest, "title" | "body" | "confirmLabel" | "busyLabel" | "tone" | "successMessage"> & { send: () => Promise<unknown>; blocksRetry?: (failure: unknown) => boolean },
  ) {
    const { send, blocksRetry, ...rest } = request;
    setConfirm({
      ...rest,
      body: `${request.body} ${FAN_CLUB_AUDIT_TEXT}`,
      cancelLabel: "Voltar",
      action: () => {
        markStale();
        return send();
      },
      onUncertain: markStale,
      uncertainText: UNCERTAIN_RETRY_TEXT,
      onError: markStale,
      blocksRetry: blocksRetry ?? blocksDecisionRetry,
      onOrphan: markStale,
    });
    setConfirmKey((value) => value + 1);
  }

  /** O Reexibir do registro do ocultar: sem a rodada, só o item aberto da fila é resolvido. */
  function askRestoreComment(comment: FanClubComment) {
    const { title, body } = commentDecisionText("restore", comment);
    ask({
      title,
      body,
      confirmLabel: "Reexibir",
      busyLabel: "Reexibindo...",
      tone: "default",
      send: () => decideFanClubComment(comment.id, comment.status, "restore", null),
      successMessage: commentDoneText("restore", comment.status),
      blocksRetry: blocksCommentRetry,
    });
  }

  function askPause(club: FanClub, paused: boolean) {
    const name = fanClubLabel(club);
    ask({
      title: paused ? `Pausar o fã-clube ${name}?` : `Reativar o fã-clube ${name}?`,
      body: paused ? PAUSE_TEXT : RESUME_TEXT,
      confirmLabel: paused ? "Pausar" : "Reativar",
      busyLabel: paused ? "Pausando..." : "Reativando...",
      tone: "default",
      send: () => setFanClubPaused(club.id, club.status, paused),
      successMessage: paused ? `Fã-clube ${name} pausado.` : `Fã-clube ${name} reativado.`,
    });
  }

  function askUnfeature(club: FanClub) {
    const name = fanClubLabel(club);
    ask({
      title: `Tirar o Destaque de ${name}?`,
      body: UNFEATURE_TEXT,
      confirmLabel: "Tirar destaque",
      busyLabel: "Tirando...",
      tone: "default",
      send: () => unfeatureFanClub(club.id, club.status),
      successMessage: `O Destaque de ${name} saiu.`,
    });
  }

  function askOfficial(club: FanClub, official: boolean) {
    const name = fanClubLabel(club);
    ask({
      title: official ? `Oficializar o fã-clube ${name}?` : `Tirar a oficialização do fã-clube ${name}?`,
      body: official ? OFFICIALIZE_TEXT : unofficializeText(club.status),
      confirmLabel: official ? "Oficializar" : "Tirar a oficialização",
      busyLabel: official ? "Oficializando..." : "Tirando...",
      tone: "default",
      send: () => (official ? officializeFanClub(club.id, club.status) : unofficializeFanClub(club.id, club.status)),
      successMessage: official ? `Fã-clube ${name} oficializado.` : `Oficialização de ${name} tirada.`,
    });
  }

  function askPost(post: FanClubPost, decision: "hide" | "restore") {
    const author = authorLabel(post);
    ask({
      title: decision === "hide" ? `Ocultar a publicação de ${author}?` : `Reexibir a publicação de ${author}?`,
      body: decision === "hide" ? HIDE_POST_TEXT : RESTORE_POST_TEXT,
      confirmLabel: decision === "hide" ? "Ocultar" : "Reexibir",
      busyLabel: decision === "hide" ? "Ocultando..." : "Reexibindo...",
      tone: decision === "hide" ? "danger" : "default",
      send: () => decidePost(post.id, post.status, decision),
      successMessage: decision === "hide" ? `Publicação de ${author} oculta.` : `Publicação de ${author} de volta ao ar.`,
    });
  }

  if (read.state.status === "error") {
    return (
      <>
        <FanClubsBackLink />
        <SectionCard id="titulo-fa-clube" title="Fã-clube">
          <LoadError message={read.state.message} headingId="titulo-fa-clube" onRetry={read.reload} />
        </SectionCard>
      </>
    );
  }
  if (read.state.status === "loading") {
    return (
      <>
        <FanClubsBackLink />
        <SectionCard id="titulo-fa-clube" title="Fã-clube">
          <LoadingRow label="Carregando o fã-clube..." />
        </SectionCard>
      </>
    );
  }

  const { club, origin, rulesVersion } = read.state.data;
  if (!club) {
    return (
      <>
        <FanClubsBackLink />
        <SectionCard id="titulo-fa-clube" title="Fã-clube">
          <EmptyState action={<ButtonLink href="/fa-clubes" size="sm" variant="secondary">Voltar para Fã-clubes</ButtonLink>}>Esse fã-clube não existe.</EmptyState>
        </SectionCard>
      </>
    );
  }

  const name = fanClubLabel(club);
  const owner = ownerLabel(club);
  const decisions = clubDecisions(club, { uid: member.uid, canEdit, admin: isAdmin(member) });
  const self = club.ownerUid !== null && club.ownerUid === member.uid;
  const decides = canEdit && !self;
  const seesFans = canSeeSection(member, "fans");
  const seesModeration = canSeeSection(member, "moderation");
  const seesAudit = canSeeSection(member, "audit");
  const seesRewards = canSeeSection(member, "rewards");
  const artist = club.artistName || `@${club.artistId}`;
  const featuring = featuredText(club, date.getTime());
  const lastReward = lastRewardText(club.lastReward, date);
  // O Destaque e o Recompensar pedem o fã-clube ativo (34.5); tirar o destaque vale em qualquer status.
  const rewardActions = decides
    ? {
        feature: club.status === "active" ? () => setDialog("feature") : undefined,
        unfeature: club.featured ? () => askUnfeature(club) : undefined,
        reward: club.status === "active" && club.ownerUid ? () => setDialog("reward") : undefined,
      }
    : null;

  return (
    <>
      <FanClubsBackLink />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 id="titulo-da-pagina" tabIndex={-1} className="m-0 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] break-words outline-none">
            <FanClubName name={name} official={club.official} size="lg" />
          </h1>
          <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/65">
            <span>
              Fã-clube de {artist}
              {club.ownerUsername ? `, feito por @${club.ownerUsername}` : ""}
            </span>
            <StatusChip status={club.status} map={FAN_CLUB_STYLES} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onClick={refresh} busy={read.reloading} loadedAt={read.loadedAt} />
          {decisions.includes("pause") ? (
            <Button size="sm" variant="secondary" onClick={() => askPause(club, true)} aria-haspopup="dialog">
              <Pause aria-hidden="true" className="size-3.5" />
              Pausar
            </Button>
          ) : null}
          {decisions.includes("resume") ? (
            <Button size="sm" variant="primary" onClick={() => askPause(club, false)} aria-haspopup="dialog">
              <Play aria-hidden="true" className="size-3.5" />
              Reativar
            </Button>
          ) : null}
          {decisions.includes("officialize") ? (
            <Button size="sm" variant="secondary" onClick={() => askOfficial(club, true)} aria-haspopup="dialog">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Oficializar
            </Button>
          ) : null}
          {decisions.includes("unofficialize") ? (
            <Button size="sm" variant="secondary" onClick={() => askOfficial(club, false)} aria-haspopup="dialog">
              <ShieldOff aria-hidden="true" className="size-3.5" />
              Tirar a oficialização
            </Button>
          ) : null}
          {decisions.includes("close") ? (
            <Button size="sm" variant="danger" onClick={() => setDialog("close")} aria-haspopup="dialog">
              <Ban aria-hidden="true" className="size-3.5" />
              Encerrar
            </Button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <Notice key={`aviso-${notice.key}`} tone="success" focusable ref={noticeRef}>
          {notice.text}
        </Notice>
      ) : null}
      {refreshError ? <Notice tone="error">Não deu para atualizar: {refreshError}</Notice> : null}
      {canEdit && self && club.status !== "closed" ? <Notice tone="info">Este fã-clube é seu. Outra pessoa da equipe pausa, reativa, encerra, oficializa, destaca, recompensa e decide as publicações e os comentários dele.</Notice> : null}

      <SectionCard id="titulo-fa-clube" title="Fã-clube">
        <div className="flex flex-col gap-4 px-5 py-4">
          <DetailList>
            <Detail term="Situação">{fanClubStatusText(club)}</Detail>
            <Detail term="Central">{artist}</Detail>
            <Detail term="Gestor">
              {club.ownerUid ? (
                <span className="flex flex-col gap-1.5">
                  <PersonCell name={owner} username={club.ownerUsername} photoURL={club.ownerPhotoURL} />
                  {seesFans || seesModeration ? (
                    <span className="flex flex-wrap gap-x-3 text-[12.5px]">
                      {seesFans ? (
                        <Link href={`/fas/${club.ownerUid}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                          Ficha<span className="sr-only"> de {owner}</span>
                        </Link>
                      ) : null}
                      {seesModeration ? (
                        <Link href={`/moderacao/fas/${club.ownerUid}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                          Moderação<span className="sr-only"> de {owner}</span>
                        </Link>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              ) : (
                <Missing>O gestor excluiu a conta.</Missing>
              )}
            </Detail>
            <Detail term="Aprovado">
              {shortWhen(club.approvedAt, date)}
              {club.approvedBy?.name ? `, por ${club.approvedBy.name}` : ""}
              {club.applicationRound >= 1 ? `, na rodada ${club.applicationRound}` : ""}
            </Detail>
            {club.status === "paused" ? <Detail term="Pausado">{shortWhen(club.pausedAt, date)}</Detail> : null}
            {club.status === "closed" ? (
              <Detail term="Encerrado">
                {shortWhen(club.closedAt, date)}
                {club.closedBy?.name ? `, por ${club.closedBy.name}` : ""}
              </Detail>
            ) : null}
            <Detail term="Publicações">
              {formatNumber(club.postCount)} no ar, {formatNumber(club.pendingPosts)} em análise
              {club.lastPostAt ? `; a última aprovada em ${shortWhen(club.lastPostAt, date)}` : ""}
            </Detail>
            <Detail term="Oficialização">{officialText(club, date) ?? <Missing>Não oficializado</Missing>}</Detail>
            <Detail term="Destaque">{featuring ?? <Missing>Sem Destaque</Missing>}</Detail>
            <Detail term="Último reconhecimento">{lastReward ?? <Missing>Nenhum ainda</Missing>}</Detail>
            <Detail term="Identificador">
              <span className="font-mono text-[13px]">{club.id}</span>
            </Detail>
            {origin === "replaced" ? (
              <Detail term="Candidatura" wide>
                A candidatura de origem foi substituída por uma nova do gestor, depois do encerramento a pedido.
              </Detail>
            ) : null}
          </DetailList>
          <div className="flex flex-wrap gap-2">
            {club.ownerUid && origin !== "gone" ? (
              <ButtonLink href={`/fa-clubes/candidaturas/${club.ownerUid}`} size="sm" variant="secondary">
                {origin === "same" ? "Candidatura de origem" : "Candidatura atual do gestor"}
              </ButtonLink>
            ) : null}
            {seesAudit ? (
              <ButtonLink href={logsHref(fanClubTarget(club.id))} size="sm" variant="ghost">
                Abrir nos Logs
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <NumbersSection club={club} shards={shards} now={date} />
      <MonthsSection club={club} />
      <QualitySection club={club} />
      {seesFans ? <FollowersSection clubId={club.id} now={date} round={round} seesModeration={seesModeration} /> : null}
      <RewardsSection club={club} now={date} round={round} seesRewards={seesRewards} actions={rewardActions} />
      <PostsSection club={club} artist={artist} viewer={{ uid: member.uid, canEdit }} seesFans={seesFans} now={date} round={round} onDecide={askPost} onComments={setCommentsPost} />
      <HideLogSection club={club} member={member} now={date} round={round} onRestore={askRestoreComment} />

      <PostCommentsDialog
        post={commentsPost}
        club={club}
        member={member}
        onClose={(changed) => {
          setCommentsPost(null);
          if (changed) markStale();
        }}
      />

      <ConfirmDialog
        key={`confirmar-${confirmKey}`}
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      {canEdit && dialog === "close" ? (
        <CloseDialog
          club={club}
          onClose={() => setDialog(null)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(message) => {
            setDialog(null);
            changed(message);
          }}
        />
      ) : null}
      {canEdit && dialog === "feature" ? (
        <FeatureDialog
          club={club}
          now={date.getTime()}
          onClose={() => setDialog(null)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(message) => {
            setDialog(null);
            changed(message);
          }}
        />
      ) : null}
      {canEdit && dialog === "reward" ? (
        <RewardDialog
          club={club}
          now={date.getTime()}
          role={member.role}
          canPoints={canEditSection(member, "fans")}
          canPrize={canEditSection(member, "rewards")}
          readsFans={seesFans}
          readsModeration={seesModeration}
          rulesVersion={rulesVersion}
          attempt={rewardAttempt}
          onAttempt={setRewardAttempt}
          onClose={() => setDialog(null)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(message) => {
            setDialog(null);
            changed(message);
          }}
        />
      ) : null}
    </>
  );
}
