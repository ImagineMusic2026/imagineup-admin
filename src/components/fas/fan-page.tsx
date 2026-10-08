"use client";

import { ArrowLeft, Coins, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdjustDialog, type AdjustAttempt } from "@/components/fas/adjust-dialog";
import { CentralsTab, CommentsTab, EngagementTab, InvitesTab, LedgerTab, MissionsTab, RedemptionsTab } from "@/components/fas/fan-tabs";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { artistNameOf, getArtistNames } from "@/lib/artist-names-data";
import { dayKey } from "@/lib/day";
import { fanDisplayName, suspensionReasonLabel } from "@/lib/fan-profile";
import { createFanProfileReader } from "@/lib/fan-profile-data";
import { getCurrentSeason, getFanCard, getFanCentrals, getLevels } from "@/lib/fan-data";
import { earnedLast7Days, rankPositionNow, referralAwardText, referralPath, seasonPointsNow, utmText } from "@/lib/fans";
import { formatDateTime, formatDay, formatNumber } from "@/lib/format";
import { NO_LEVELS_TEXT, levelOf } from "@/lib/levels";
import { canEditSection, canSeeSection, type StaffMember } from "@/lib/staff";

type FanTab = "ledger" | "centrals" | "engagement" | "comments" | "invites" | "missions" | "redemptions";

/** A ficha do fã (`/fas/[uid]`): histórico e origem, com o ajuste de pontos para quem edita. */
export function FanPage({ uid }: { uid: string }) {
  return <SectionGate section="fans">{(member) => <FanContent uid={uid} member={member} />}</SectionGate>;
}

function FanContent({ uid, member }: { uid: string; member: StaffMember }) {
  const canEdit = canEditSection(member, "fans");
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<FanTab>("ledger");
  const [version, setVersion] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  // A tentativa de ajuste vive fora do diálogo: fechar e abrir de novo não perde o id dela.
  const [attempt, setAttempt] = useState<AdjustAttempt | null>(null);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const reader = createFanProfileReader();
    const [card, levels, season, artists, centrals] = await Promise.all([
      getFanCard(uid, reader),
      getLevels(),
      getCurrentSeason(),
      getArtistNames(member),
      getFanCentrals(uid),
    ]);
    return { card, levels, season, artists, centrals };
  }, [uid, member]);
  const { state, reload, reloading, loadedAt, refreshError } = useLoad(load);

  // A permissão de editar caiu com o diálogo aberto: ele fecha (o acesso chega em tempo real).
  const dialogShown = dialogOpen && canEdit;

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  if (state.status === "error") {
    return (
      <>
        <BackLink />
        <SectionCard id="titulo-ficha" title="Ficha do fã">
          <LoadError message={state.message} headingId="titulo-ficha" onRetry={reload} />
        </SectionCard>
      </>
    );
  }
  if (state.status === "loading") {
    return (
      <>
        <BackLink />
        <SectionCard id="titulo-ficha" title="Ficha do fã">
          <LoadingRow label="Carregando a ficha..." />
        </SectionCard>
      </>
    );
  }

  const { card, levels, season, artists, centrals } = state.data;
  const profile = card.profile;
  if (!profile) {
    return (
      <>
        <BackLink />
        <Notice tone="info" title="Fã não encontrado.">
          A conta pode ter sido excluída.
        </Notice>
      </>
    );
  }

  const name = fanDisplayName(profile);
  const wallet = card.wallet;
  const seasonId = season?.id ?? null;
  const seasonPoints = seasonPointsNow(wallet, seasonId);
  const position = rankPositionNow(wallet, seasonId);
  const level = levels ? levelOf(wallet.xp, levels) : null;
  const seesModeration = canSeeSection(member, "moderation");
  const seesRewards = canSeeSection(member, "rewards");

  function adjusted(message: string) {
    setDialogOpen(false);
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
    setVersion((value) => value + 1);
    reload();
  }

  return (
    <>
      <BackLink />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <FanAvatar name={name} photoURL={profile.photoURL} size="lg" />
          <div className="min-w-0">
            <h1 id="titulo-da-pagina" tabIndex={-1} className="m-0 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] outline-none">
              {name}
            </h1>
            <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg/65">
              {profile.username ? <span>@{profile.username}</span> : null}
              <span>{profile.city ?? "Sem cidade"}</span>
              {profile.createdAt ? <span>No app desde {formatDay(profile.createdAt, now)}</span> : null}
              {profile.suspendedAt ? (
                <Badge tone="danger">
                  <ShieldAlert aria-hidden="true" className="size-3.5" />
                  Suspenso · {suspensionReasonLabel(profile.suspensionReason)} · desde {formatDay(profile.suspendedAt, now)}
                </Badge>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onClick={reload} busy={reloading} loadedAt={loadedAt} />
          {seesModeration ? (
            <ButtonLink href={`/moderacao/fas/${uid}`} size="sm" variant="secondary">
              Moderação deste fã
            </ButtonLink>
          ) : null}
          {canEdit ? (
            <Button size="sm" variant="primary" onClick={() => setDialogOpen(true)} aria-haspopup="dialog">
              <Coins aria-hidden="true" className="size-3.5" />
              Ajustar pontos
            </Button>
          ) : null}
        </div>
      </header>

      {notice ? (
        <Notice key={notice.key} tone="success" focusable ref={noticeRef}>
          {notice.text}
        </Notice>
      ) : null}
      {refreshError ? <Notice tone="error">Não deu para atualizar: {refreshError}</Notice> : null}

      <MetricGrid>
        <MetricCard label="Saldo" tone="points" value={formatNumber(wallet.balance)} unit="pts" />
        <MetricCard
          label="XP e nível"
          tone="points"
          value={formatNumber(wallet.xp)}
          unit="XP"
          hint={
            level
              ? `Nível ${level.number} · ${level.name}${level.next ? `. Faltam ${formatNumber(level.toNext ?? 0)} para o ${level.next.number}.` : "."}`
              : NO_LEVELS_TEXT
          }
        />
        <MetricCard
          label="Pontos da temporada"
          tone="points"
          value={formatNumber(seasonPoints)}
          unit="pts"
          hint={season ? `${season.name}${position ? `. ${position}º no retrato da semana.` : "."}` : "Sem temporada em andamento."}
        />
        <MetricCard label="Ganhos em 7 dias" tone="points" value={formatNumber(earnedLast7Days(wallet, dayKey(now.getTime())))} unit="pts" hint="Hoje e os 6 dias anteriores." />
      </MetricGrid>

      <SectionCard id="titulo-origem" title="Origem do cadastro">
        <div className="px-5 py-4">
          {card.origin ? (
            <DetailList>
              <Detail term="Veio pelo convite de" wide>
                {card.origin.inviter ? (
                  <Link href={`/fas/${card.origin.referral.inviterUid}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                    {fanDisplayName(card.origin.inviter)}
                  </Link>
                ) : (
                  <Missing>{card.origin.referral.inviterUid ? "Conta sem perfil" : "Quem convidou não tem mais conta"}</Missing>
                )}{" "}
                {referralPath(card.origin.referral, {
                  post: card.origin.postText,
                  artist: card.origin.artistName ?? (card.origin.referral.link?.targetId ? artistNameOf(artists, card.origin.referral.link.targetId) : null),
                })}
                .
              </Detail>
              <Detail term="Campanha, origem e meio">{utmText(card.origin.referral.utm) ?? <Missing>Sem campanha</Missing>}</Detail>
              <Detail term="Quando">{card.origin.referral.claimedAt ? formatDateTime(card.origin.referral.claimedAt) : <Missing>Sem data</Missing>}</Detail>
              <Detail term="Para quem convidou" wide>
                {referralAwardText(card.origin.referral, card.origin.points)}
              </Detail>
            </DetailList>
          ) : (
            <p className="m-0 text-sm text-fg/75">Cadastro direto, sem convite.</p>
          )}
        </div>
      </SectionCard>

      <Tabs
        label="Histórico do fã"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "ledger", label: "Extrato", render: () => <LedgerTab key={version} uid={uid} /> },
          { id: "centrals", label: "Centrais", render: () => <CentralsTab key={version} uid={uid} artists={artists} currentSeasonId={seasonId} /> },
          { id: "engagement", label: "Curtidas e presenças", render: () => <EngagementTab uid={uid} artists={artists} /> },
          { id: "comments", label: "Comentários", render: () => <CommentsTab uid={uid} artists={artists} /> },
          { id: "invites", label: "Convites", render: () => <InvitesTab uid={uid} artists={artists} /> },
          { id: "missions", label: "Missões e conquistas", render: () => <MissionsTab wallet={wallet} currentSeasonId={seasonId} /> },
          ...(seesRewards ? [{ id: "redemptions" as const, label: "Resgates", render: () => <RedemptionsTab uid={uid} /> }] : []),
        ]}
      />

      {canEdit ? (
        <AdjustDialog
          open={dialogShown}
          onClose={() => setDialogOpen(false)}
          uid={uid}
          role={member.role}
          balance={wallet.balance}
          xp={wallet.xp}
          seasonPoints={seasonPoints}
          seasonName={season?.name ?? null}
          centrals={centrals}
          currentSeasonId={seasonId}
          artists={artists}
          attempt={attempt}
          onAttempt={setAttempt}
          onAdjusted={adjusted}
        />
      ) : null}
    </>
  );
}

function BackLink() {
  return (
    <Link href="/fas" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-fg/70 hover:text-fg">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Fãs
    </Link>
  );
}
