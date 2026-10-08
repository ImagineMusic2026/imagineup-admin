"use client";

import { useCallback, useState } from "react";

import { LoadError, LoadingRow } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip, type StatusStyle } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList, type PagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, type ArtistName } from "@/lib/artist-names-data";
import { fanDisplayName } from "@/lib/fan-profile";
import { createFanProfileReader } from "@/lib/fan-profile-data";
import {
  getBroughtPage,
  getFanCentrals,
  getFanCommentsPage,
  getFanRedemptionsPage,
  getInviteSummary,
  getLedgerPage,
  getLikesPage,
  getRsvpsPage,
  type BroughtRow,
  type CommentRow,
  type FanRedemptionRow,
  type LikeRow,
  type RsvpRow,
} from "@/lib/fan-data";
import { VIA_LABELS, ledgerContext, referralPath, seasonsPlayed, type FanCentral, type LedgerEntry, type Wallet } from "@/lib/fans";
import type { PageCursor } from "@/lib/firestore-page";
import { countLabel, formatDateTime, formatDay, formatNumber, formatSigned } from "@/lib/format";
import { createGameNamesReader } from "@/lib/game-names-data";
import { sourceLabel } from "@/lib/stats";

/** Um cartão interno de aba: lista paginada com "Carregar mais", erro e carregando. */
function PagedTable<T>({
  id,
  list,
  columns,
  grid,
  rowKey,
  caption,
  empty,
  rowHref,
}: {
  id: string;
  list: PagedList<T>;
  columns: Column<T>[];
  grid: string;
  rowKey: (row: T) => string;
  caption: string;
  empty: string;
  rowHref?: (row: T) => string | null;
}) {
  if (list.state.status === "error") return <LoadError message={list.state.message} headingId={id} onRetry={list.reload} />;
  if (list.state.status === "loading") return <LoadingRow label="Carregando..." />;
  return (
    <>
      <DataTable
        caption={caption}
        columns={columns}
        rows={list.state.data}
        rowKey={rowKey}
        grid={grid}
        rowHref={rowHref}
        focusRequest={list.focusRequest}
        empty={<EmptyState className="p-0">{empty}</EmptyState>}
      />
      <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
    </>
  );
}

function TabCard({ id, title, meta, children }: { id: string; title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
        <h3 id={id} tabIndex={-1} className="m-0 font-display text-[15px] font-semibold outline-none">
          {title}
        </h3>
        {meta ? <p className="m-0 text-[13px] text-fg/60">{meta}</p> : null}
      </div>
      {children}
    </section>
  );
}

function When({ date, now }: { date: Date | null; now: Date }) {
  if (!date) return <Missing>Sem data</Missing>;
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)}>
      {formatDay(date, now)}
    </time>
  );
}

// ---------------------------------------------------------------------------
// Extrato
// ---------------------------------------------------------------------------

const LEDGER_GRID = "xl:grid xl:grid-cols-[150px_minmax(0,0.8fr)_minmax(0,1.4fr)_110px_110px] xl:items-center xl:gap-4";

/** O extrato; a ficha monta de novo (uma `key` nova) depois de um ajuste, e ele lê outra vez. */
export function LedgerTab({ uid }: { uid: string }) {
  const loadPage = useCallback((after: PageCursor | null) => getLedgerPage(uid, after), [uid]);
  const list = usePagedList(loadPage, (entry) => entry.id, { one: "lançamento carregado", many: "lançamentos carregados" });
  const columns: Column<LedgerEntry>[] = [
    {
      key: "when",
      header: "Quando",
      cell: (entry) => (entry.createdAt ? <span className="text-fg">{formatDateTime(entry.createdAt)}</span> : <Missing>Sem data</Missing>),
    },
    { key: "source", header: "Origem", cell: (entry) => <span className="font-semibold text-fg">{sourceLabel(entry.source)}</span> },
    {
      key: "context",
      header: "Contexto",
      cell: (entry) => (
        <span className="flex flex-col">
          {ledgerContext(entry) ? <span>{ledgerContext(entry)}</span> : entry.actor.type === "staff" ? null : <Missing>Sem contexto</Missing>}
          {entry.actor.type === "staff" ? (
            <span className="text-[12.5px] text-fg/60">
              Ajuste de {entry.actor.name ?? "alguém da equipe"}
              {entry.note ? `: ${entry.note}` : ""}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "points",
      header: "Pontos",
      align: "end",
      cell: (entry) => (
        <span className={cx("font-semibold tabular-nums", entry.points > 0 ? "text-lime" : "text-fg")}>{formatSigned(entry.points)}</span>
      ),
    },
    { key: "after", header: "Saldo depois", align: "end", cell: (entry) => <span className="tabular-nums">{formatNumber(entry.balanceAfter)}</span> },
  ];
  return (
    <TabCard id="titulo-extrato" title="Extrato">
      <PagedTable
        id="titulo-extrato"
        list={list}
        columns={columns}
        grid={LEDGER_GRID}
        rowKey={(entry) => entry.id}
        caption="Extrato do fã, do mais novo"
        empty="Nenhum lançamento ainda."
      />
    </TabCard>
  );
}

// ---------------------------------------------------------------------------
// Centrais
// ---------------------------------------------------------------------------

const CENTRALS_GRID = "xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_110px_110px_130px_130px] xl:items-center xl:gap-4";

export function CentralsTab({
  uid,
  artists,
  currentSeasonId,
}: {
  uid: string;
  artists: ReadonlyMap<string, ArtistName> | null;
  currentSeasonId: string | null;
}) {
  const load = useCallback(() => getFanCentrals(uid), [uid]);
  const { state, reload } = useLoad(load);
  const now = new Date();
  const columns: Column<FanCentral>[] = [
    { key: "central", header: "Central", cell: (row) => <span className="font-semibold text-fg">{artistNameOf(artists, row.artistId)}</span> },
    { key: "via", header: "Como entrou", cell: (row) => (row.via ? (VIA_LABELS[row.via] ?? row.via) : <Missing>Não é membro</Missing>) },
    { key: "since", header: "Desde", cell: (row) => <When date={row.joinedAt} now={now} /> },
    { key: "member", header: "Membro", cell: (row) => (row.member ? <Badge tone="cyan">Membro</Badge> : <Badge tone="muted">Saiu</Badge>) },
    {
      key: "season",
      header: "Temporada",
      align: "end",
      cell: (row) => (
        <span className="font-semibold text-lime tabular-nums">
          {formatNumber(currentSeasonId && row.seasonId === currentSeasonId ? row.seasonPoints : 0)} pts
        </span>
      ),
    },
    { key: "total", header: "De sempre", align: "end", cell: (row) => <span className="font-semibold text-lime tabular-nums">{formatNumber(row.totalPoints)} pts</span> },
  ];
  return (
    <TabCard id="titulo-centrais-fa" title="Centrais">
      {state.status === "error" ? (
        <LoadError message={state.message} headingId="titulo-centrais-fa" onRetry={reload} />
      ) : state.status === "loading" ? (
        <LoadingRow label="Carregando as centrais..." />
      ) : (
        <DataTable
          caption="Centrais do fã"
          columns={columns}
          rows={state.data}
          rowKey={(row) => row.artistId}
          grid={CENTRALS_GRID}
          empty={<EmptyState className="p-0">Ainda não entrou em nenhuma central.</EmptyState>}
        />
      )}
    </TabCard>
  );
}

// ---------------------------------------------------------------------------
// Curtidas e presenças
// ---------------------------------------------------------------------------

const LIKES_GRID = "xl:grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_120px] xl:items-center xl:gap-4";
const RSVPS_GRID = "xl:grid xl:grid-cols-[minmax(0,1.6fr)_160px_120px] xl:items-center xl:gap-4";

export function EngagementTab({ uid, artists }: { uid: string; artists: ReadonlyMap<string, ArtistName> | null }) {
  const now = new Date();
  const likesLoad = useCallback((after: PageCursor | null) => getLikesPage(uid, after), [uid]);
  const likes = usePagedList(likesLoad, (row) => row.postId, { one: "curtida carregada", many: "curtidas carregadas" });
  const rsvpsLoad = useCallback((after: PageCursor | null) => getRsvpsPage(uid, after), [uid]);
  const rsvps = usePagedList(rsvpsLoad, (row) => row.eventId, { one: "presença carregada", many: "presenças carregadas" });
  const likeColumns: Column<LikeRow>[] = [
    { key: "post", header: "Post", cell: (row) => <span className="text-fg">{row.postText ?? `Post ${row.postId}`}</span> },
    { key: "central", header: "Central", cell: (row) => (row.artistId ? artistNameOf(artists, row.artistId) : <Missing>Sem central</Missing>) },
    { key: "when", header: "Curtiu em", cell: (row) => <When date={row.at} now={now} /> },
  ];
  const rsvpColumns: Column<RsvpRow>[] = [
    { key: "event", header: "Show", cell: (row) => <span className="text-fg">{row.title ?? `Show ${row.eventId}`}</span> },
    { key: "date", header: "Data do show", cell: (row) => (row.startsAt ? formatDateTime(row.startsAt) : <Missing>Sem data</Missing>) },
    { key: "when", header: "Confirmou em", cell: (row) => <When date={row.at} now={now} /> },
  ];
  return (
    <div className="flex flex-col gap-5">
      <TabCard id="titulo-curtidas" title="Curtidas">
        <PagedTable id="titulo-curtidas" list={likes} columns={likeColumns} grid={LIKES_GRID} rowKey={(row) => row.postId} caption="Curtidas do fã" empty="Nenhuma curtida." />
      </TabCard>
      <TabCard id="titulo-presencas" title="Presenças">
        <PagedTable id="titulo-presencas" list={rsvps} columns={rsvpColumns} grid={RSVPS_GRID} rowKey={(row) => row.eventId} caption="Presenças confirmadas do fã" empty="Nenhuma presença confirmada." />
      </TabCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comentários
// ---------------------------------------------------------------------------

const COMMENTS_GRID = "xl:grid xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,0.7fr)_100px_100px] xl:items-center xl:gap-4";

const COMMENT_STATUS: Record<CommentRow["status"], StatusStyle> = {
  visible: { label: "Visível", tone: "cyan", dot: true },
  hidden: { label: "Oculto", tone: "danger", dot: true },
};

export function CommentsTab({ uid, artists }: { uid: string; artists: ReadonlyMap<string, ArtistName> | null }) {
  const now = new Date();
  const load = useCallback((after: PageCursor | null) => getFanCommentsPage(uid, after), [uid]);
  const list = usePagedList(load, (row) => row.commentId, { one: "comentário carregado", many: "comentários carregados" });
  const columns: Column<CommentRow>[] = [
    { key: "text", header: "Comentário", cell: (row) => <span className="break-words text-fg">{row.text}</span> },
    { key: "post", header: "Post", cell: (row) => row.postText ?? `Post ${row.postId}` },
    { key: "central", header: "Central", cell: (row) => (row.artistId ? artistNameOf(artists, row.artistId) : <Missing>Sem central</Missing>) },
    { key: "when", header: "Quando", cell: (row) => <When date={row.createdAt} now={now} /> },
    { key: "status", header: "Situação", align: "end", cell: (row) => <StatusChip status={row.status} map={COMMENT_STATUS} /> },
  ];
  return (
    <TabCard id="titulo-comentarios-fa" title="Comentários">
      <PagedTable id="titulo-comentarios-fa" list={list} columns={columns} grid={COMMENTS_GRID} rowKey={(row) => row.commentId} caption="Comentários do fã, do mais novo" empty="Nenhum comentário." />
    </TabCard>
  );
}

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

const BROUGHT_GRID = "xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_120px] xl:items-center xl:gap-4";

const LINK_KIND_LABELS: Record<string, string> = { invite: "Convite", agenda: "Agenda", post: "Post", artist: "Central" };

export function InvitesTab({ uid, artists }: { uid: string; artists: ReadonlyMap<string, ArtistName> | null }) {
  const now = new Date();
  const summaryLoad = useCallback(() => getInviteSummary(uid), [uid]);
  const summary = useLoad(summaryLoad);
  const [reader] = useState(() => createFanProfileReader());
  const broughtLoad = useCallback((after: PageCursor | null) => getBroughtPage(uid, after, reader), [uid, reader]);
  const brought = usePagedList(broughtLoad, (row) => row.uid, { one: "pessoa carregada", many: "pessoas carregadas" });
  const columns: Column<BroughtRow>[] = [
    { key: "person", header: "Pessoa", cell: (row) => <span className="font-semibold text-fg">{row.profile ? fanDisplayName(row.profile) : "Conta excluída"}</span> },
    {
      key: "path",
      header: "Como chegou",
      cell: (row) =>
        referralPath(row.referral, {
          artist: row.referral.link?.kind === "artist" && row.referral.link.targetId ? artistNameOf(artists, row.referral.link.targetId) : null,
        }),
    },
    { key: "when", header: "Quando", cell: (row) => <When date={row.referral.claimedAt} now={now} /> },
  ];
  return (
    <div className="flex flex-col gap-5">
      <TabCard id="titulo-convite" title="Convite">
        {summary.state.status === "error" ? (
          <LoadError message={summary.state.message} headingId="titulo-convite" onRetry={summary.reload} />
        ) : summary.state.status === "loading" ? (
          <LoadingRow label="Carregando o convite..." />
        ) : (
          <div className="px-5 py-4">
            <DetailList>
              <Detail term="Código">{summary.state.data.code ? <span className="font-mono">{summary.state.data.code}</span> : <Missing>Ainda não gerou código</Missing>}</Detail>
              <Detail term="Pessoas trazidas">{formatNumber(summary.state.data.broughtCount)}</Detail>
              <Detail term="Links criados" wide>
                {summary.state.data.links.length === 0 ? (
                  <Missing>Nenhum link compartilhado</Missing>
                ) : (
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {summary.state.data.links.map((link) => (
                      <li key={link.id}>
                        <Badge tone="neutral">
                          {LINK_KIND_LABELS[link.kind] ?? link.kind}
                          {link.targetId ? ` ${link.kind === "artist" ? artistNameOf(artists, link.targetId) : link.targetId}` : ""}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Detail>
            </DetailList>
          </div>
        )}
      </TabCard>
      <TabCard
        id="titulo-trazidos"
        title="Pessoas trazidas"
        meta={summary.state.status === "ready" ? countLabel(summary.state.data.broughtCount, "pessoa", "pessoas") : undefined}
      >
        <PagedTable
          id="titulo-trazidos"
          list={brought}
          columns={columns}
          grid={BROUGHT_GRID}
          rowKey={(row) => row.uid}
          rowHref={(row) => (row.profile ? `/fas/${row.uid}` : null)}
          caption="Pessoas que o fã trouxe"
          empty="Ainda não trouxe ninguém."
        />
      </TabCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Missões e conquistas
// ---------------------------------------------------------------------------

export function MissionsTab({ wallet, currentSeasonId }: { wallet: Wallet; currentSeasonId: string | null }) {
  const now = new Date();
  // Os ids vão como texto: a lista de agora muda só quando a carteira muda.
  const idsKey = [...(wallet.missions.daily?.items ?? []), ...(wallet.missions.weekly?.items ?? [])].map((item) => item.id).join(",");
  const load = useCallback(async () => {
    const reader = createGameNamesReader();
    const [missions, achievements] = await Promise.all([reader.missionTitles(idsKey ? idsKey.split(",") : []), reader.achievementNames()]);
    return { missions, achievements };
  }, [idsKey]);
  const names = useLoad(load);
  const missionName = (id: string) => (names.state.status === "ready" ? (names.state.data.missions.get(id) ?? id) : id);
  const achievementName = (id: string) => (names.state.status === "ready" ? (names.state.data.achievements.get(id) ?? id) : id);
  const goalNow = wallet.goalReached && wallet.goalReached.seasonId === currentSeasonId;

  function period(title: string, state: Wallet["missions"]["daily"]) {
    return (
      <Detail term={title}>
        {!state || state.items.length === 0 ? (
          <Missing>Nenhuma missão em andamento</Missing>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {state.items.map((item) => (
              <li key={item.id}>
                {missionName(item.id)}: {item.completedAt ? <span className="text-cyan">concluída</span> : `${countLabel(item.current, "feito", "feitos")}`}
              </li>
            ))}
          </ul>
        )}
      </Detail>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <TabCard id="titulo-missoes-fa" title="Missões">
        <div className="px-5 py-4">
          <DetailList>
            {period("Do dia", wallet.missions.daily)}
            {period("Da semana", wallet.missions.weekly)}
            <Detail term="Missões na temporada">{formatNumber(wallet.seasonMissions)}</Detail>
            <Detail term="Meta da temporada">
              {goalNow ? (
                <span className="text-cyan">Bateu a meta{wallet.goalReached?.at ? ` em ${formatDay(wallet.goalReached.at, now)}` : ""}</span>
              ) : (
                <Missing>Ainda não bateu</Missing>
              )}
            </Detail>
            <Detail term="Temporadas jogadas">{formatNumber(seasonsPlayed(wallet))}</Detail>
          </DetailList>
        </div>
      </TabCard>
      <TabCard id="titulo-conquistas-fa" title="Conquistas" meta={countLabel(wallet.achievements.length, "conquista", "conquistas")}>
        {wallet.achievements.length === 0 ? (
          <EmptyState>Nenhuma conquista ainda.</EmptyState>
        ) : (
          <ul className="m-0 list-none p-0">
            {wallet.achievements.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 border-t border-line px-5 py-3 first:border-t-0 text-[13.5px]">
                <span className="text-fg">{achievementName(item.id)}</span>
                <When date={item.at} now={now} />
              </li>
            ))}
          </ul>
        )}
      </TabCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resgates
// ---------------------------------------------------------------------------

const REDEMPTION_STATUS: Record<string, StatusStyle> = {
  requested: { label: "Solicitado", tone: "neutral", dot: true },
  approved: { label: "Aprovado", tone: "cyan", dot: true },
  delivered: { label: "Entregue", tone: "cyan", dot: true },
  refused: { label: "Recusado", tone: "danger", dot: true },
  canceled: { label: "Cancelado", tone: "muted", dot: true },
};

const REDEMPTIONS_GRID = "xl:grid xl:grid-cols-[130px_minmax(0,1.4fr)_120px_130px_120px] xl:items-center xl:gap-4";

export function RedemptionsTab({ uid }: { uid: string }) {
  const now = new Date();
  const load = useCallback((after: PageCursor | null) => getFanRedemptionsPage(uid, after), [uid]);
  const list = usePagedList(load, (row) => row.code, { one: "pedido carregado", many: "pedidos carregados" });
  const columns: Column<FanRedemptionRow>[] = [
    { key: "code", header: "Código", cell: (row) => <span className="font-mono text-fg">{row.code}</span> },
    { key: "reward", header: "Recompensa", cell: (row) => row.rewardTitle },
    { key: "points", header: "Pontos", align: "end", cell: (row) => <span className="font-semibold text-lime tabular-nums">{formatNumber(row.points)} pts</span> },
    { key: "status", header: "Situação", cell: (row) => <StatusChip status={row.status} map={REDEMPTION_STATUS} /> },
    { key: "when", header: "Pedido em", cell: (row) => <When date={row.requestedAt} now={now} /> },
  ];
  return (
    <TabCard id="titulo-resgates-fa" title="Resgates">
      <PagedTable id="titulo-resgates-fa" list={list} columns={columns} grid={REDEMPTIONS_GRID} rowKey={(row) => row.code} caption="Pedidos da loja do fã" empty="Nenhum resgate." />
    </TabCard>
  );
}
