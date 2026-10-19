"use client";

import { Ban, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { CloseDialog } from "@/components/fa-clubes/fan-club-dialogs";
import { FAN_CLUB_STYLES, FanClubsBackLink, PersonCell, shortWhen } from "@/components/fa-clubes/fan-club-bits";
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
import { setFanClubPaused } from "@/lib/fan-club-api";
import { getFanClub } from "@/lib/fan-club-data";
import {
  FAN_CLUB_AUDIT_TEXT,
  PAUSE_TEXT,
  RESUME_TEXT,
  clubDecisions,
  fanClubLabel,
  fanClubStatusText,
  fanClubTarget,
  isStaleDecision,
  ownerLabel,
  type FanClub,
} from "@/lib/fan-clubs";
import { canEditSection, canSeeSection, isAdmin, type StaffMember } from "@/lib/staff";

/**
 * A ficha do fã-clube (`/fa-clubes/[id]`, 34.10, item 5): o status, o gestor,
 * a central, a aprovação e o encerramento, com Pausar, Reativar e Encerrar
 * (Encerrar só para admin), a candidatura de origem e o "Abrir nos Logs".
 * Os números, os seguidores, as publicações, o Destaque e as recompensas
 * chegam com as etapas 2 a 5 do servidor (o Painel B).
 */
export function FanClubPage({ clubId }: { clubId: string }) {
  return <SectionGate section="fanClubs">{(member) => <FanClubContent clubId={clubId} member={member} />}</SectionGate>;
}

function FanClubContent({ clubId, member }: { clubId: string; member: StaffMember }) {
  const canEdit = canEditSection(member, "fanClubs");
  const [round, setRound] = useState(0);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // Uma instância do ConfirmDialog por pedido: o seguinte nunca herda o erro ou o "Tentar de novo" do anterior.
  const [confirmKey, setConfirmKey] = useState(0);
  const [closing, setClosing] = useState(false);
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
      setClosing(false);
    }
  }
  if (pendingRefresh && confirm === null && !closing) {
    setPendingRefresh(false);
    setRound((value) => value + 1);
  }

  const read = useLoad(
    useCallback(() => getFanClub(clubId), [clubId]),
    round,
  );
  const date = read.loadedAt ?? new Date(now);

  function markStale() {
    setPendingRefresh(true);
  }

  /** A decisão deu certo: o aviso aparece e a ficha lê de novo uma vez. */
  function changed(message: string) {
    setPendingRefresh(false);
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
    setRound((value) => value + 1);
  }

  function askPause(club: FanClub, paused: boolean) {
    const name = fanClubLabel(club);
    setConfirm({
      title: paused ? `Pausar o fã-clube ${name}?` : `Reativar o fã-clube ${name}?`,
      body: `${paused ? PAUSE_TEXT : RESUME_TEXT} ${FAN_CLUB_AUDIT_TEXT}`,
      confirmLabel: paused ? "Pausar" : "Reativar",
      busyLabel: paused ? "Pausando..." : "Reativando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => {
        markStale();
        return setFanClubPaused(club.id, club.status, paused);
      },
      successMessage: paused ? `Fã-clube ${name} pausado.` : `Fã-clube ${name} reativado.`,
      onUncertain: markStale,
      uncertainText: UNCERTAIN_RETRY_TEXT,
      onError: markStale,
      blocksRetry: isStaleDecision,
      onOrphan: markStale,
    });
    setConfirmKey((value) => value + 1);
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

  const club = read.state.data;
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
  const seesFans = canSeeSection(member, "fans");
  const seesModeration = canSeeSection(member, "moderation");
  const seesAudit = canSeeSection(member, "audit");

  return (
    <>
      <FanClubsBackLink />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 id="titulo-da-pagina" tabIndex={-1} className="m-0 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] outline-none">
            {name}
          </h1>
          <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/65">
            <span>
              Fã-clube de {club.artistName || `@${club.artistId}`}
              {club.ownerUsername ? `, feito por @${club.ownerUsername}` : ""}
            </span>
            <StatusChip status={club.status} map={FAN_CLUB_STYLES} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onClick={read.reload} busy={read.reloading} loadedAt={read.loadedAt} />
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
          {decisions.includes("close") ? (
            <Button size="sm" variant="danger" onClick={() => setClosing(true)} aria-haspopup="dialog">
              <Ban aria-hidden="true" className="size-3.5" />
              Encerrar
            </Button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <Notice key={`aviso-${notice.key}`} tone="success">
          {notice.text}
        </Notice>
      ) : null}
      {read.refreshError ? <Notice tone="error">Não deu para atualizar: {read.refreshError}</Notice> : null}
      {canEdit && self && club.status !== "closed" ? <Notice tone="info">Este fã-clube é seu. Outra pessoa da equipe pausa, reativa ou encerra.</Notice> : null}

      <SectionCard id="titulo-fa-clube" title="Fã-clube">
        <div className="flex flex-col gap-4 px-5 py-4">
          <DetailList>
            <Detail term="Situação">{fanClubStatusText(club)}</Detail>
            <Detail term="Central">{club.artistName || `@${club.artistId}`}</Detail>
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
            <Detail term="Identificador">
              <span className="font-mono text-[13px]">{club.id}</span>
            </Detail>
          </DetailList>
          <div className="flex flex-wrap gap-2">
            {club.ownerUid ? (
              <ButtonLink href={`/fa-clubes/candidaturas/${club.ownerUid}`} size="sm" variant="secondary">
                Candidatura do gestor
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

      <ConfirmDialog
        key={`confirmar-${confirmKey}`}
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      {canEdit && closing ? (
        <CloseDialog
          club={club}
          onClose={() => setClosing(false)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(message) => {
            setClosing(false);
            changed(message);
          }}
        />
      ) : null}
    </>
  );
}
