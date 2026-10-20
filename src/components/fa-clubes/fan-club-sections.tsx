"use client";

import { Award, Eye, EyeOff, Sparkles, StarOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { PostCard, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { REDEMPTION_STYLES } from "@/components/recompensas/reward-bits";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { Missing } from "@/components/ui/detail-list";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/notice";
import { StatusChip } from "@/components/ui/status-chip";
import { useLoad, type LoadResult } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { getClubPostsPage, getPrizeOrders, getPrizesPage, getRecentFollowersPage, type ShardNumbers } from "@/lib/fan-club-data";
import { createFanProfileReader, type FanProfileReader } from "@/lib/fan-profile-data";
import { fanDisplayName, type FanProfile } from "@/lib/fan-profile";
import {
  MONTH_FIELDS,
  MONTH_FIELD_LABELS,
  QUALITY_LABELS,
  QUALITY_SIGNALS,
  countsAtText,
  featuredText,
  followerQuality,
  followerSignals,
  monthLabel,
  postDecisions,
  retainedText,
  thisMonthNumbers,
  type FanClub,
  type FanClubFollower,
  type FanClubPost,
  type FanClubPrize,
  type MonthField,
} from "@/lib/fan-clubs";
import type { PageCursor } from "@/lib/firestore-page";
import { formatNumber, formatPercent, formatSigned } from "@/lib/format";
import { KIND_LABELS, type RewardKind } from "@/lib/rewards";

// ---------------------------------------------------------------------------
// Os números (decisões 24 e 37)
// ---------------------------------------------------------------------------

/**
 * Os números da ficha (34.10, item 5): a soma dos 16 shards, que conta na
 * hora (links, visitas, cadastros e entradas trazidas), e a cópia da noite
 * (os seguidores, os novos em 30 dias e os trazidos que ficaram). A seção
 * Fã-clubes não conta os seguidores ao vivo: o `count()` do grupo pede a
 * seção Fãs (34.6).
 */
export function NumbersSection({ club, shards, now }: { club: FanClub; shards: LoadResult<ShardNumbers>; now: Date }) {
  const counts = club.counts;
  const at = countsAtText(counts, now);
  // Antes da primeira cópia, o `counts` é o zero da aprovação, e não um número de verdade.
  const copied = counts?.at ? counts : null;
  const notCopied = "A primeira cópia da noite ainda não rodou.";
  const live = shards.state.status === "ready" ? shards.state.data : null;
  return (
    <SectionCard id="titulo-numeros" title="Números" meta={`Seguidores e trazidos pela cópia da noite, ${at}. O resto conta na hora.`}>
      <div className="flex flex-col gap-4 px-5 py-4">
        <MetricGrid>
          <MetricCard label="Seguidores" value={copied ? formatNumber(copied.followers) : "Sem cópia"} hint={copied ? at : notCopied} />
          <MetricCard label="Novos em 30 dias" value={copied ? formatNumber(copied.followers30d) : "Sem cópia"} hint={copied ? at : notCopied} />
          <MetricCard label="Trazidos que ficaram" value={copied ? retainedText(copied) : "Sem cópia"} hint="Na central do artista, sobre as entradas trazidas da cópia." />
          <MetricCard label="Entradas trazidas" value={live ? formatNumber(live.joins) : ""} loading={!live && shards.state.status !== "error"} hint="Primeira entrada na central, pelo seguir ou pelo código do gestor." />
        </MetricGrid>
        <MetricGrid columns={3}>
          <MetricCard label="Links compartilhados" value={live ? formatNumber(live.links) : ""} loading={!live && shards.state.status !== "error"} />
          <MetricCard label="Visitas pelo link" value={live ? formatNumber(live.visits) : ""} loading={!live && shards.state.status !== "error"} />
          <MetricCard label="Cadastros pelo link" value={live ? formatNumber(live.signups) : ""} loading={!live && shards.state.status !== "error"} />
        </MetricGrid>
        {shards.state.status === "error" ? <p className="m-0 text-[13px] text-danger">Os números de agora não carregaram: {shards.state.message}</p> : null}
      </div>
    </SectionCard>
  );
}

type MonthRow = { field: MonthField; current: number | null; last: number | null };

/** "Neste mês" e "Mês passado" (os retratos `monthStart` e `lastMonth` da cópia da noite, decisão 37). */
export function MonthsSection({ club }: { club: FanClub }) {
  const current = thisMonthNumbers(club);
  const last = club.lastMonth;
  const rows: MonthRow[] = MONTH_FIELDS.map((field) => ({ field, current: current ? current.numbers[field] : null, last: last ? last.numbers[field] : null }));
  const currentLabel = current ? `Neste mês (${monthLabel(current.month)})` : "Neste mês";
  const lastLabel = last ? `Mês passado (${monthLabel(last.month)})` : "Mês passado";
  const columns: Column<MonthRow>[] = [
    { key: "field", header: "Número", cell: (row) => <span className="font-semibold text-fg">{MONTH_FIELD_LABELS[row.field]}</span> },
    { key: "current", header: currentLabel, align: "end", cell: (row) => (row.current === null ? <Missing>Sem cópia</Missing> : <span className="tabular-nums">{formatSigned(row.current)}</span>) },
    { key: "last", header: lastLabel, align: "end", cell: (row) => (row.last === null ? <Missing>Sem retrato</Missing> : <span className="tabular-nums">{formatSigned(row.last)}</span>) },
  ];
  return (
    <SectionCard id="titulo-meses" title="Neste mês e no mês passado" meta="O que mudou desde a primeira cópia de cada mês. Os seguidores são o saldo, e podem sair negativos.">
      {!current && !last ? (
        <EmptyState>Os retratos do mês começam com a primeira cópia da noite.</EmptyState>
      ) : (
        <DataTable caption="Números do mês e do mês passado" columns={columns} rows={rows} rowKey={(row) => row.field} grid="xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] xl:items-center xl:gap-4" empty="" />
      )}
    </SectionCard>
  );
}

/** A "Qualidade dos seguidores" (decisão 39): as três proporções da cópia e o aviso acima da metade. */
export function QualitySection({ club }: { club: FanClub }) {
  const counts = club.counts;
  if (!counts || counts.followers === 0) {
    return (
      <SectionCard id="titulo-qualidade" title="Qualidade dos seguidores">
        <EmptyState>{counts?.at ? "Sem seguidores na última cópia." : "A qualidade aparece com a primeira cópia da noite."}</EmptyState>
      </SectionCard>
    );
  }
  const quality = followerQuality(counts);
  return (
    <SectionCard id="titulo-qualidade" title="Qualidade dos seguidores" meta={`Sobre ${formatNumber(counts.followers)} seguidores, ${countsAtText(counts, new Date())}.`}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {quality.warnings.length > 0 ? (
          <Notice tone="info">
            Mais da metade dos seguidores {quality.warnings.length === 1 ? "tem este sinal" : "tem estes sinais"}: {quality.warnings.map((signal) => QUALITY_LABELS[signal].toLowerCase()).join(", ")}. Muitos seguidores novos, de @ automático e trazidos pelo próprio gestor podem ser uma fazenda de seguidores.
          </Notice>
        ) : null}
        <dl className="m-0 grid gap-3 sm:grid-cols-3">
          {QUALITY_SIGNALS.map((signal) => (
            <div key={signal} className="flex flex-col gap-1 rounded-xl border border-line px-4 py-3">
              <dt className="text-[12.5px] text-fg/65">{QUALITY_LABELS[signal]}</dt>
              <dd className="m-0 flex flex-wrap items-baseline gap-2">
                <span className="font-display text-[22px] font-semibold tabular-nums text-fg">{formatPercent(quality.shares[signal])}</span>
                <span className="text-[12.5px] text-fg/60">{formatNumber(counts[signal])}</span>
                {quality.warnings.includes(signal) ? <Badge tone="danger">Acima da metade</Badge> : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Os seguidores recentes (decisão 29: só com a seção Fãs)
// ---------------------------------------------------------------------------

type FollowerRow = FanClubFollower & { profile: FanProfile | null };

const FOLLOWERS_GRID = "xl:grid xl:grid-cols-[minmax(0,1.4fr)_150px_minmax(0,1.4fr)_minmax(0,0.9fr)] xl:items-center xl:gap-4";

/**
 * Os "Seguidores recentes", pela consulta de grupo (só a seção Fãs lê quem
 * segue): o fã, a data e os três sinais, com os atalhos para a ficha e a
 * Moderação. O nome vem do perfil, que a seção Fãs também lê.
 */
export function FollowersSection({ clubId, now, round, seesModeration }: { clubId: string; now: Date; round: number; seesModeration: boolean }) {
  const [reader] = useState<FanProfileReader>(() => createFanProfileReader());
  const load = useCallback(
    async (after: PageCursor | null) => {
      const page = await getRecentFollowersPage(clubId, after);
      const items = await Promise.all(page.items.map(async (item): Promise<FollowerRow> => ({ ...item, profile: await reader.get(item.uid).catch(() => null) })));
      return { ...page, items };
    },
    [clubId, reader],
  );
  const list = usePagedList(load, (row: FollowerRow) => row.uid, { one: "seguidor carregado", many: "seguidores carregados" }, round);
  const columns: Column<FollowerRow>[] = [
    {
      key: "fan",
      header: "Fã",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-fg">{row.profile ? fanDisplayName(row.profile) : <Missing>Perfil não encontrado</Missing>}</span>
          <span className="truncate font-mono text-[12px] text-fg/55">{row.uid}</span>
        </span>
      ),
    },
    { key: "when", header: "Seguiu em", cell: (row) => shortWhen(row.followedAt, now) },
    {
      key: "signals",
      header: "Sinais",
      cell: (row) => {
        const signals = followerSignals(row);
        return signals.length === 0 ? (
          <span className="text-fg/60">Nenhum</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <Badge key={signal} tone="neutral">
                {signal}
              </Badge>
            ))}
          </span>
        );
      },
    },
    {
      key: "links",
      header: "Atalhos",
      label: "",
      cell: (row) => (
        <span className="relative z-10 flex flex-wrap gap-x-3 text-[12.5px]">
          <Link href={`/fas/${row.uid}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
            Ficha<span className="sr-only"> do fã {row.uid}</span>
          </Link>
          {seesModeration ? (
            <Link href={`/moderacao/fas/${row.uid}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
              Moderação<span className="sr-only"> do fã {row.uid}</span>
            </Link>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <SectionCard id="titulo-seguidores" title="Seguidores recentes" meta="Do mais novo. Só quem tem a seção Fãs vê quem segue.">
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-seguidores" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os seguidores..." />
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <DataTable caption="Seguidores recentes do fã-clube" columns={columns} rows={list.state.data} rowKey={(row) => row.uid} grid={FOLLOWERS_GRID} focusRequest={list.focusRequest} empty={<EmptyState className="p-0">Ninguém segue este fã-clube agora.</EmptyState>} />
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Destaque e recompensas (decisões 35, 38 e 44 a 50)
// ---------------------------------------------------------------------------

const PRIZES_GRID = "xl:grid xl:grid-cols-[130px_minmax(0,0.9fr)_90px_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)] xl:items-center xl:gap-4";

function kindLabel(kind: string): string {
  return KIND_LABELS[kind as RewardKind] ?? kind;
}

/**
 * O bloco "Destaque e recompensas": o Destaque de agora, os botões e o
 * histórico do registro `prizes` (lido por toda a seção, sem o código nem o
 * cupom, decisão 50). Quem tem a seção Recompensas vê o código e o status do
 * pedido, achado pelo `grantId`.
 */
export function RewardsSection({
  club,
  now,
  round,
  seesRewards,
  actions,
}: {
  club: FanClub;
  now: Date;
  round: number;
  seesRewards: boolean;
  /** Destacar, Tirar destaque e Recompensar, só para quem decide. */
  actions: { feature?: () => void; unfeature?: () => void; reward?: () => void } | null;
}) {
  const load = useCallback((after: PageCursor | null) => getPrizesPage(club.id, after), [club.id]);
  const list = usePagedList(load, (row: FanClubPrize) => row.grantId, { one: "reconhecimento carregado", many: "reconhecimentos carregados" }, round);
  const grantKey = seesRewards && list.state.status === "ready" ? list.state.data.filter((row) => row.prize).map((row) => row.grantId).join("|") : "";
  const orders = useLoad(
    useCallback(() => (grantKey ? getPrizeOrders(grantKey.split("|")) : Promise.resolve(new Map())), [grantKey]),
    round,
  );
  const featuring = featuredText(club, now.getTime());

  const columns: Column<FanClubPrize>[] = [
    { key: "when", header: "Quando", cell: (row) => shortWhen(row.at, now) },
    { key: "by", header: "Por", cell: (row) => row.by?.name ?? <Missing>Sem nome</Missing> },
    { key: "points", header: "Pontos", align: "end", cell: (row) => (row.points ? <span className="font-semibold text-lime tabular-nums">{formatNumber(row.points)} pts</span> : <span className="text-fg/55">Sem pontos</span>) },
    {
      key: "prize",
      header: "Prêmio",
      cell: (row) =>
        row.prize ? (
          <span className="flex flex-col">
            <span className="text-fg/90">{row.prize.rewardTitle || row.prize.rewardId}</span>
            <span className="text-[12px] text-fg/60">
              {kindLabel(row.prize.rewardKind)}
              {row.prize.delivered ? ", o cupom já era o prêmio" : ""}
            </span>
          </span>
        ) : (
          <span className="text-fg/55">Sem prêmio</span>
        ),
    },
    { key: "note", header: "Nota interna", cell: (row) => <span className="break-words text-fg/85">{row.note}</span> },
    {
      key: "order",
      header: "Pedido",
      cell: (row) => {
        if (!row.prize) return <span className="text-fg/55">Sem pedido</span>;
        if (!seesRewards) return <Missing>Só com a seção Recompensas</Missing>;
        if (orders.state.status === "loading") return <span className="text-fg/60">Carregando...</span>;
        if (orders.state.status === "error") return <span className="text-danger">Não carregou</span>;
        const order = orders.state.data.get(row.grantId);
        if (!order) return <Missing>Pedido não encontrado</Missing>;
        return (
          <span className="flex flex-col items-start gap-1">
            <span className="font-mono text-[13px] text-fg">{order.code}</span>
            <StatusChip status={order.status} map={REDEMPTION_STYLES} />
          </span>
        );
      },
    },
  ];

  return (
    <SectionCard id="titulo-recompensas" title="Destaque e recompensas" meta="O reconhecimento é decisão da equipe, sem ciclo nem prazo.">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
        <p className="m-0 text-sm text-fg/85">{featuring ?? "Sem Destaque agora."}</p>
        {actions ? (
          <div className="flex flex-wrap gap-2">
            {actions.feature ? (
              <Button size="sm" variant="secondary" onClick={actions.feature} aria-haspopup="dialog">
                <Sparkles aria-hidden="true" className="size-3.5" />
                {featuring ? "Mudar o fim do Destaque" : "Destacar"}
              </Button>
            ) : null}
            {actions.unfeature ? (
              <Button size="sm" variant="ghost" onClick={actions.unfeature} aria-haspopup="dialog">
                <StarOff aria-hidden="true" className="size-3.5" />
                Tirar destaque
              </Button>
            ) : null}
            {actions.reward ? (
              <Button size="sm" variant="primary" onClick={actions.reward} aria-haspopup="dialog">
                <Award aria-hidden="true" className="size-3.5" />
                Recompensar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-recompensas" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os reconhecimentos..." />
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <DataTable caption="Reconhecimentos dados ao fã-clube, do mais novo" columns={columns} rows={list.state.data} rowKey={(row) => row.grantId} grid={PRIZES_GRID} focusRequest={list.focusRequest} empty={<EmptyState className="p-0">Nenhum reconhecimento ainda.</EmptyState>} />
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// As publicações do fã-clube, em todos os status
// ---------------------------------------------------------------------------

/**
 * As publicações em todos os status, da enviada mais nova, com Ocultar (a no
 * ar) e Reexibir (a oculta pela equipe). A em análise se decide na aba
 * "Publicações para revisar".
 */
export function PostsSection({
  club,
  artist,
  viewer,
  now,
  round,
  onDecide,
}: {
  club: FanClub;
  artist: string;
  viewer: { uid: string; canEdit: boolean };
  now: Date;
  round: number;
  onDecide: (post: FanClubPost, decision: "hide" | "restore") => void;
}) {
  const load = useCallback((after: PageCursor | null) => getClubPostsPage(club.id, after), [club.id]);
  const list = usePagedList(load, (post: FanClubPost) => post.id, { one: "publicação carregada", many: "publicações carregadas" }, round);
  return (
    <SectionCard id="titulo-publicacoes" title="Publicações" meta="Em todos os status, da enviada mais nova.">
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-publicacoes" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando as publicações..." />
      ) : list.state.data.length === 0 ? (
        <EmptyState>O gestor ainda não publicou.</EmptyState>
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {list.state.data.map((post) => {
              const decisions = postDecisions(post, viewer);
              return (
                <li key={post.id}>
                  <PostCard
                    post={post}
                    artist={artist}
                    now={now}
                    showClub={false}
                    actions={
                      decisions.includes("hide") ? (
                        <Button size="sm" variant="danger" onClick={() => onDecide(post, "hide")} aria-haspopup="dialog">
                          <EyeOff aria-hidden="true" className="size-4" />
                          Ocultar<span className="sr-only"> a publicação</span>
                        </Button>
                      ) : decisions.includes("restore") ? (
                        <Button size="sm" variant="secondary" onClick={() => onDecide(post, "restore")} aria-haspopup="dialog">
                          <Eye aria-hidden="true" className="size-4" />
                          Reexibir<span className="sr-only"> a publicação</span>
                        </Button>
                      ) : post.status === "pending" && viewer.canEdit ? (
                        <ButtonLink href="/fa-clubes?aba=publicacoes" size="sm" variant="ghost">
                          Revisar na fila
                        </ButtonLink>
                      ) : null
                    }
                  />
                </li>
              );
            })}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}

