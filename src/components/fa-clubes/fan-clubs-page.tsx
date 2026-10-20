"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { APPLICATION_STYLES, FAN_CLUB_STYLES, PersonCell, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { PostsTab, ReportsTab } from "@/components/fa-clubes/fan-club-queues";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox } from "@/components/ui/field";
import { FilterBar, FilterChips, FilterSelect } from "@/components/ui/filter-bar";
import { RefreshButton } from "@/components/ui/refresh-button";
import { StatusChip } from "@/components/ui/status-chip";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList, type PagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, getArtistNames, type ArtistName } from "@/lib/artist-names-data";
import {
  ARTIST_FILTER_MAX,
  countFanClubs,
  countPendingApplications,
  countWaiting,
  getFanClubsPage,
  getManagedArtistIds,
  getPendingApplicationsPage,
  getResolvedApplicationsPage,
  type ArtistFilter,
  type FanClubFilter,
} from "@/lib/fan-club-data";
import {
  FAN_CLUB_FILTER_LABELS,
  FAN_CLUB_ORDERS,
  FAN_CLUB_ORDER_LABELS,
  FAN_CLUB_STATUSES,
  FAN_CLUB_STATUS_LABELS,
  REJECT_REASON_LABELS,
  RESOLVED_APPLICATION_STATUSES,
  RESOLVED_FILTER_LABELS,
  STATUS_REASON_LABELS,
  applicantLabel,
  countsAtText,
  fanClubCountText,
  fanClubLabel,
  featuredText,
  lastRewardText,
  openReportsCountText,
  ownerLabel,
  pendingCountText,
  pendingPostsCountText,
  roundText,
  waitingText,
  type FanClub,
  type FanClubApplication,
  type FanClubOrder,
  type FanClubStatus,
  type ResolvedApplicationStatus,
} from "@/lib/fan-clubs";
import type { PageCursor } from "@/lib/firestore-page";
import { countLabel, formatNumber, joinPt } from "@/lib/format";
import { canEditSection, canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("fanClubs");

const PENDING_GRID = "xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_110px_140px] xl:items-center xl:gap-4";
const RESOLVED_GRID = "xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)] xl:items-center xl:gap-4";
/** As colunas da decisão 36: o nome, o gestor, a central, a situação e os números que dá para ordenar. */
const CLUBS_GRID =
  "xl:grid xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_96px_76px_76px_88px_48px_minmax(0,0.75fr)_minmax(0,0.85fr)] xl:items-center xl:gap-3";

/** O valor do filtro "Centrais que eu cuido" (pelo `artistPrivate.managerUid`, só com a seção Artistas). */
const MINE = "__minhas__";

type FanClubsTab = "applications" | "clubs" | "posts" | "reports";

type Names = ReadonlyMap<string, ArtistName> | null;

/** As abas pelo endereço (`/fa-clubes?aba=publicacoes`): o atalho "Revisar na fila" da ficha abre a fila. */
const TAB_BY_PARAM: Record<string, FanClubsTab> = {
  candidaturas: "applications",
  "fa-clubes": "clubs",
  publicacoes: "posts",
  denuncias: "reports",
};

/**
 * Fã-clubes (`/fa-clubes`, seção 34, 34.10): as candidaturas (a aba padrão),
 * com as pendentes da mais antiga e as resolvidas; os fã-clubes, com as
 * colunas da decisão 36; as publicações para revisar; e as denúncias, em
 * leitura única (25 por vez, "Carregar mais" e o "Atualizar", que lê de novo
 * com a lista na tela). A linha da lista abre a ficha, onde ficam as decisões
 * do fã-clube; as das publicações e das denúncias ficam nas abas delas.
 */
export function FanClubsPage() {
  // A troca só do `?aba=` (a lateral de volta para `/fa-clubes`) não remonta a página: a `key` recomeça pela aba do endereço.
  const aba = useSearchParams().get("aba");
  return <SectionGate section="fanClubs">{(member) => <FanClubsContent key={aba ?? ""} member={member} initialTab={TAB_BY_PARAM[aba ?? ""] ?? "applications"} />}</SectionGate>;
}

/** "2 candidaturas em análise, 1 publicação em análise e nenhuma denúncia aberta." */
function waitingSubtitle(counts: { applications: number; posts: number; reports: number }): string {
  return `${joinPt([pendingCountText(counts.applications), pendingPostsCountText(counts.posts), counts.reports > 0 ? openReportsCountText(counts.reports) : "nenhuma denúncia aberta"])}.`;
}

function FanClubsContent({ member, initialTab }: { member: StaffMember; initialTab: FanClubsTab }) {
  const canEdit = canEditSection(member, "fanClubs");
  const [tab, setTab] = useState<FanClubsTab>(initialTab);
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const seesArtists = canSeeSection(member, "artists");
  const names = useLoad(useCallback(() => getArtistNames(seesArtists), [seesArtists]));
  const artistNames = names.state.status === "ready" ? names.state.data : null;
  const waiting = useLoad(useCallback(() => countWaiting(), []), round);
  const counts = waiting.state.status === "ready" ? waiting.state.data : null;
  const date = new Date(now);

  function refresh() {
    setNow(Date.now());
    setRound((value) => value + 1);
    names.reload();
  }

  return (
    <>
      <PageHeader
        title={INFO.label}
        subtitle={counts ? waitingSubtitle(counts) : INFO.description}
        actions={<RefreshButton onClick={refresh} busy={waiting.reloading} loadedAt={waiting.loadedAt} />}
      />
      {waiting.refreshError ? <p className="m-0 text-[13px] text-danger">As contagens não atualizaram: {waiting.refreshError}</p> : null}

      <Tabs
        label="Partes de Fã-clubes"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "applications", label: "Candidaturas", render: () => <ApplicationsTab member={member} names={artistNames} now={date} round={round} allPending={counts?.applications ?? null} /> },
          { id: "clubs", label: "Fã-clubes", render: () => <ClubsTab names={artistNames} now={date} round={round} /> },
          {
            id: "posts",
            label: "Publicações para revisar",
            render: () => <PostsTab member={member} canEdit={canEdit} names={artistNames} now={date} round={round} total={counts?.posts ?? null} onChanged={waiting.reload} />,
          },
          { id: "reports", label: "Denúncias", render: () => <ReportsTab member={member} canEdit={canEdit} names={artistNames} now={date} round={round} total={counts?.reports ?? null} onChanged={waiting.reload} /> },
        ]}
      />
    </>
  );
}

function artistOptions(names: Names) {
  return names ? [...names.values()].map((artist) => ({ value: artist.id, label: artist.name })) : [];
}

/** O nome da central: a cópia gravada no documento; sem ela, o mapa dos nomes, ou o @. */
function artistOf(names: Names, id: string, copy: string): string {
  return copy || artistNameOf(names, id);
}

// ---------------------------------------------------------------------------
// Candidaturas
// ---------------------------------------------------------------------------

function ApplicationsTab({
  member,
  names,
  now,
  round,
  allPending,
}: {
  member: StaffMember;
  names: Names;
  now: Date;
  round: number;
  /** A contagem do cabeçalho, que serve ao filtro "Todas" sem ler de novo. */
  allPending: number | null;
}) {
  const seesArtists = canSeeSection(member, "artists");
  const [artist, setArtist] = useState("");
  const [resolvedStatus, setResolvedStatus] = useState<ResolvedApplicationStatus>("approved");
  const mineChosen = artist === MINE && seesArtists;
  const mine = useLoad(
    useCallback(() => (mineChosen ? getManagedArtistIds(member.uid) : Promise.resolve(null)), [mineChosen, member.uid]),
    round,
  );
  const mineIds = mine.state.status === "ready" ? mine.state.data : null;
  // As centrais vão como texto: a releitura do "Atualizar" devolve uma lista nova com o mesmo conteúdo, e o filtro só muda quando ela muda.
  const mineKey = mineIds ? JSON.stringify(mineIds) : null;
  // Sem "Centrais que eu cuido", o filtro é uma central ou todas; com ele, só depois de ler as centrais da pessoa.
  const artists = useMemo<ArtistFilter | undefined>(() => {
    if (artist === "" || (artist === MINE && !seesArtists)) return null;
    if (artist === MINE) return mineKey === null ? undefined : (JSON.parse(mineKey) as string[]);
    return [artist];
  }, [artist, mineKey, seesArtists]);

  // Com "Todas" (`null`), a contagem é a do cabeçalho; carregando as centrais (`undefined`), ainda nenhuma.
  const count = useLoad(
    useCallback(() => (!artists ? Promise.resolve(null) : countPendingApplications(artists)), [artists]),
    round,
  );
  const total = artists === null ? allPending : count.state.status === "ready" ? count.state.data : null;

  const options = [
    { value: "", label: "Todas" },
    ...(seesArtists ? [{ value: MINE, label: "Centrais que eu cuido" }] : []),
    ...artistOptions(names),
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        id="titulo-candidaturas"
        title="Em análise"
        meta={total !== null ? `${pendingCountText(total)}, da mais antiga para a mais nova` : "Da mais antiga para a mais nova."}
      >
        <div className="flex flex-col gap-2 border-b border-line px-5 py-4">
          <FilterBar label="Filtros das candidaturas" active={Boolean(artist)} onClear={() => setArtist("")}>
            <FilterSelect label="Central" value={artist} onChange={setArtist} options={options} className="min-w-[220px]" />
          </FilterBar>
          {mineChosen && mineIds && mineIds.length > ARTIST_FILTER_MAX ? (
            <p className="m-0 text-[12.5px] text-fg/60">Você cuida de mais de {ARTIST_FILTER_MAX} centrais: o filtro usa as {ARTIST_FILTER_MAX} primeiras pelo @.</p>
          ) : null}
        </div>
        {mineChosen && mine.state.status === "error" ? (
          <LoadError message={mine.state.message} headingId="titulo-candidaturas" onRetry={mine.reload} />
        ) : artists === undefined ? (
          <LoadingRow label="Carregando as centrais que você cuida..." />
        ) : (
          <PendingList key={artist} artists={artists} names={names} now={now} round={round} empty={mineChosen ? "Nenhuma candidatura em análise nas centrais que você cuida." : artist ? "Nenhuma candidatura em análise para esta central." : "Nenhuma candidatura em análise."} />
        )}
      </SectionCard>

      <ResolvedList status={resolvedStatus} onStatus={setResolvedStatus} names={names} now={now} round={round} />
    </div>
  );
}

function PendingList({ artists, names, now, round, empty }: { artists: ArtistFilter; names: Names; now: Date; round: number; empty: string }) {
  const load = useCallback((after: PageCursor | null) => getPendingApplicationsPage(artists, after), [artists]);
  const list = usePagedList(load, (item: FanClubApplication) => item.uid, { one: "candidatura carregada", many: "candidaturas carregadas" }, round);

  const columns: Column<FanClubApplication>[] = [
    { key: "fan", header: "Fã", cell: (item) => <PersonCell name={applicantLabel(item)} username={item.fanUsername} photoURL={item.fanPhotoURL} /> },
    { key: "artist", header: "Central", cell: (item) => artistOf(names, item.artistId, item.artistName) },
    { key: "name", header: "Nome proposto", cell: (item) => <span className="font-semibold text-fg">{item.proposedName || "Sem nome"}</span> },
    { key: "round", header: "Rodada", cell: (item) => roundText(item.round) ?? "Sem rodada" },
    { key: "waiting", header: "Espera", align: "end", cell: (item) => waitingText(item, now) ?? "Sem data" },
  ];

  return (
    <ApplicationTable
      list={list}
      columns={columns}
      grid={PENDING_GRID}
      caption="Candidaturas em análise, da mais antiga"
      empty={empty}
      headingId="titulo-candidaturas"
    />
  );
}

function ResolvedList({
  status,
  onStatus,
  names,
  now,
  round,
}: {
  status: ResolvedApplicationStatus;
  onStatus: (status: ResolvedApplicationStatus) => void;
  names: Names;
  now: Date;
  round: number;
}) {
  const load = useCallback((after: PageCursor | null) => getResolvedApplicationsPage(status, after), [status]);
  const list = usePagedList(load, (item: FanClubApplication) => item.uid, { one: "candidatura carregada", many: "candidaturas carregadas" }, round);

  const columns: Column<FanClubApplication>[] = [
    { key: "fan", header: "Fã", cell: (item) => <PersonCell name={applicantLabel(item)} username={item.fanUsername} photoURL={item.fanPhotoURL} /> },
    { key: "artist", header: "Central", cell: (item) => artistOf(names, item.artistId, item.artistName) },
    { key: "name", header: "Nome proposto", cell: (item) => <span className="font-semibold text-fg">{item.proposedName || "Sem nome"}</span> },
    {
      key: "status",
      header: "Situação",
      cell: (item) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={item.status} map={APPLICATION_STYLES} />
          {item.status === "rejected" && item.rejectReason ? <span className="text-fg/70">{REJECT_REASON_LABELS[item.rejectReason]}</span> : null}
        </span>
      ),
    },
    {
      key: "decided",
      header: "Quando",
      cell: (item) => (
        <span className="flex flex-col">
          <span>{shortWhen(item.decidedAt, now)}</span>
          {item.decidedBy?.name ? <span className="text-[12px] text-fg/55">por {item.decidedBy.name}</span> : item.status === "withdrawn" ? <span className="text-[12px] text-fg/55">pelo fã</span> : null}
        </span>
      ),
    },
  ];

  return (
    <SectionCard id="titulo-resolvidas" title="Resolvidas" meta="Da decisão mais nova.">
      <div className="border-b border-line px-5 py-4">
        <FilterChips
          label="Situação das resolvidas"
          value={status}
          onChange={(value) => onStatus(value as ResolvedApplicationStatus)}
          options={RESOLVED_APPLICATION_STATUSES.map((item) => ({ value: item, label: RESOLVED_FILTER_LABELS[item] }))}
        />
      </div>
      <ApplicationTable
        list={list}
        columns={columns}
        grid={RESOLVED_GRID}
        caption={`Candidaturas ${RESOLVED_FILTER_LABELS[status].toLowerCase()}, da decisão mais nova`}
        empty={`Nenhuma candidatura ${RESOLVED_FILTER_LABELS[status].toLowerCase().replace(/s$/, "")}.`}
        headingId="titulo-resolvidas"
      />
    </SectionCard>
  );
}

function ApplicationTable({
  list,
  columns,
  grid,
  caption,
  empty,
  headingId,
}: {
  list: PagedList<FanClubApplication>;
  columns: Column<FanClubApplication>[];
  grid: string;
  caption: string;
  empty: string;
  headingId: string;
}) {
  if (list.state.status === "error") return <LoadError message={list.state.message} headingId={headingId} onRetry={list.reload} />;
  if (list.state.status === "loading") return <LoadingRow label="Carregando as candidaturas..." />;
  return (
    <>
      {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
      <DataTable
        caption={caption}
        columns={columns}
        rows={list.state.data}
        rowKey={(item) => item.uid}
        rowHref={(item) => `/fa-clubes/candidaturas/${item.uid}`}
        grid={grid}
        focusRequest={list.focusRequest}
        empty={<EmptyState className="p-0">{empty}</EmptyState>}
      />
      <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fã-clubes
// ---------------------------------------------------------------------------

/** Um número da cópia da noite; antes da primeira cópia (`counts.at` nulo), os zeros não são de verdade. */
function CopyNumber({ club, value }: { club: FanClub; value: number | undefined }) {
  if (!club.counts?.at) return <span className="text-[12px] text-fg/55">Sem cópia</span>;
  return <span className="tabular-nums">{formatNumber(value ?? 0)}</span>;
}

/**
 * Os fã-clubes (34.10, item 4): o status, a central e a ordem (pelos
 * seguidores, pelos novos em 30 dias ou pela aprovação), ou só os destacados,
 * pelo fim do Destaque (o índice dele não combina com os outros filtros). Os
 * números são da cópia da noite, com a data dela em cada linha.
 */
function ClubsTab({ names, now, round }: { names: Names; now: Date; round: number }) {
  const [status, setStatus] = useState<FanClubStatus>("active");
  const [artistId, setArtistId] = useState("");
  const [order, setOrder] = useState<FanClubOrder>("followers");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const filter = useMemo<FanClubFilter>(() => (featuredOnly ? { featured: true } : { featured: false, status, artistId, order }), [featuredOnly, status, artistId, order]);
  const load = useCallback((after: PageCursor | null) => getFanClubsPage(filter, after), [filter]);
  const list = usePagedList(load, (club: FanClub) => club.id, { one: "fã-clube carregado", many: "fã-clubes carregados" }, round);
  const count = useLoad(useCallback(() => countFanClubs(filter), [filter]), round);
  const nowMs = now.getTime();

  const columns: Column<FanClub>[] = [
    { key: "club", header: "Fã-clube", cell: (club) => <span className="font-semibold text-fg">{fanClubLabel(club)}</span> },
    { key: "owner", header: "Gestor", cell: (club) => <PersonCell name={ownerLabel(club)} username={club.ownerUsername} photoURL={club.ownerPhotoURL} /> },
    { key: "artist", header: "Central", cell: (club) => artistOf(names, club.artistId, club.artistName) },
    {
      key: "status",
      header: "Situação",
      cell: (club) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={club.status} map={FAN_CLUB_STYLES} />
          {club.status !== "active" && club.statusReason ? <span className="text-[12.5px] text-fg/70">{STATUS_REASON_LABELS[club.statusReason]}</span> : null}
        </span>
      ),
    },
    {
      key: "followers",
      header: "Seguidores",
      align: "end",
      headerWrap: true,
      cell: (club) => (
        <span className="flex flex-col items-end">
          <CopyNumber club={club} value={club.counts?.followers} />
          {club.counts?.at ? <span className="text-[11.5px] text-fg/55">{countsAtText(club.counts, now)}</span> : null}
        </span>
      ),
    },
    { key: "followers30d", header: "Novos em 30 dias", align: "end", headerWrap: true, cell: (club) => <CopyNumber club={club} value={club.counts?.followers30d} /> },
    { key: "joins", header: "Entradas trazidas", align: "end", headerWrap: true, cell: (club) => <CopyNumber club={club} value={club.counts?.joins} /> },
    { key: "signups", header: "Cadastros", align: "end", headerWrap: true, cell: (club) => <CopyNumber club={club} value={club.counts?.signups} /> },
    { key: "posts", header: "No ar", label: "Publicações no ar", align: "end", cell: (club) => <span className="tabular-nums">{formatNumber(club.postCount)}</span> },
    { key: "featured", header: "Destaque", cell: (club) => featuredText(club, nowMs)?.replace(/^Destaque /, "") ?? <span className="text-fg/55">Não</span> },
    { key: "reward", header: "Último prêmio", headerWrap: true, cell: (club) => lastRewardText(club.lastReward, now) ?? <span className="text-fg/55">Nenhum</span> },
  ];

  const statusLabel = FAN_CLUB_STATUS_LABELS[status].toLowerCase();
  const orderText = featuredOnly ? "do fim do Destaque mais perto" : FAN_CLUB_ORDER_LABELS[order].toLowerCase();
  const total = count.state.status === "ready" ? count.state.data : null;
  const meta =
    total === null
      ? "Os números são da cópia da noite."
      : `${featuredOnly ? countLabel(total, "fã-clube em destaque", "fã-clubes em destaque") : fanClubCountText(total, status)}, ${orderText}. Os números são da cópia da noite.`;

  return (
    <SectionCard id="titulo-fa-clubes" title="Fã-clubes" meta={meta}>
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
        <FilterBar
          label="Filtros dos fã-clubes"
          active={featuredOnly || status !== "active" || Boolean(artistId) || order !== "followers"}
          onClear={() => {
            setFeaturedOnly(false);
            setStatus("active");
            setArtistId("");
            setOrder("followers");
          }}
        >
          {featuredOnly ? null : (
            <>
              <FilterChips
                label="Situação"
                value={status}
                onChange={(value) => setStatus(value as FanClubStatus)}
                options={FAN_CLUB_STATUSES.map((item) => ({ value: item, label: FAN_CLUB_FILTER_LABELS[item] }))}
              />
              <FilterSelect label="Central" value={artistId} onChange={setArtistId} options={[{ value: "", label: "Todas" }, ...artistOptions(names)]} className="min-w-[200px]" />
              <FilterSelect label="Ordem" value={order} onChange={(value) => setOrder(value as FanClubOrder)} options={FAN_CLUB_ORDERS.map((item) => ({ value: item, label: FAN_CLUB_ORDER_LABELS[item] }))} className="min-w-[200px]" />
            </>
          )}
        </FilterBar>
        <div className="flex flex-col gap-1">
          <Checkbox label="Só os destacados" checked={featuredOnly} onChange={(event) => setFeaturedOnly(event.target.checked)} />
          {featuredOnly ? <p className="m-0 pl-7 text-[12.5px] text-fg/60">Todos os destacados, do fim mais perto. Este filtro não combina com a situação, a central e a ordem.</p> : null}
        </div>
      </div>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-fa-clubes" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os fã-clubes..." />
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <DataTable
            caption={featuredOnly ? "Fã-clubes em destaque, do fim mais perto" : `Fã-clubes ${FAN_CLUB_FILTER_LABELS[status].toLowerCase()}, ${orderText}`}
            columns={columns}
            rows={list.state.data}
            rowKey={(club) => club.id}
            rowHref={(club) => `/fa-clubes/${club.id}`}
            grid={CLUBS_GRID}
            focusRequest={list.focusRequest}
            empty={<EmptyState className="p-0">{featuredOnly ? "Nenhum fã-clube em destaque." : artistId ? `Nenhum fã-clube ${statusLabel} nesta central.` : `Nenhum fã-clube ${statusLabel}.`}</EmptyState>}
          />
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}
