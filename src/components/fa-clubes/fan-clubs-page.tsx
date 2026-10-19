"use client";

import { useCallback, useMemo, useState } from "react";

import { APPLICATION_STYLES, FAN_CLUB_STYLES, PersonCell, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
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
  getFanClubsPage,
  getManagedArtistIds,
  getPendingApplicationsPage,
  getResolvedApplicationsPage,
  type ArtistFilter,
  type FanClubFilter,
} from "@/lib/fan-club-data";
import {
  FAN_CLUB_FILTER_LABELS,
  FAN_CLUB_STATUSES,
  FAN_CLUB_STATUS_LABELS,
  REJECT_REASON_LABELS,
  RESOLVED_APPLICATION_STATUSES,
  RESOLVED_FILTER_LABELS,
  STATUS_REASON_LABELS,
  applicantLabel,
  fanClubCountText,
  fanClubLabel,
  ownerLabel,
  pendingCountText,
  roundText,
  waitingText,
  type FanClub,
  type FanClubApplication,
  type FanClubStatus,
  type ResolvedApplicationStatus,
} from "@/lib/fan-clubs";
import type { PageCursor } from "@/lib/firestore-page";
import { formatDay } from "@/lib/format";
import { canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("fanClubs");

const PENDING_GRID = "xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_110px_140px] xl:items-center xl:gap-4";
const RESOLVED_GRID = "xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)] xl:items-center xl:gap-4";
const CLUBS_GRID = "xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)_110px] xl:items-center xl:gap-4";

/** O valor do filtro "Centrais que eu cuido" (pelo `artistPrivate.managerUid`, só com a seção Artistas). */
const MINE = "__minhas__";

type FanClubsTab = "applications" | "clubs";

type Names = ReadonlyMap<string, ArtistName> | null;

/**
 * Fã-clubes (`/fa-clubes`, seção 34, 34.10): as candidaturas (a aba padrão),
 * com as pendentes da mais antiga e as resolvidas, e os fã-clubes, em leitura
 * única (25 por vez, "Carregar mais" e o "Atualizar", que lê de novo com a
 * lista na tela). A linha abre a ficha, onde ficam as decisões.
 */
export function FanClubsPage() {
  return <SectionGate section="fanClubs">{(member) => <FanClubsContent member={member} />}</SectionGate>;
}

function FanClubsContent({ member }: { member: StaffMember }) {
  const [tab, setTab] = useState<FanClubsTab>("applications");
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const seesArtists = canSeeSection(member, "artists");
  const names = useLoad(useCallback(() => getArtistNames(seesArtists), [seesArtists]));
  const artistNames = names.state.status === "ready" ? names.state.data : null;
  const pending = useLoad(useCallback(() => countPendingApplications(), []), round);
  const allPending = pending.state.status === "ready" ? pending.state.data : null;
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
        subtitle={pending.state.status === "ready" ? `${pendingCountText(pending.state.data)}.` : INFO.description}
        actions={<RefreshButton onClick={refresh} busy={pending.reloading} loadedAt={pending.loadedAt} />}
      />

      <Tabs
        label="Partes de Fã-clubes"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "applications", label: "Candidaturas", render: () => <ApplicationsTab member={member} names={artistNames} now={date} round={round} allPending={allPending} /> },
          { id: "clubs", label: "Fã-clubes", render: () => <ClubsTab names={artistNames} now={date} round={round} /> },
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

function ClubsTab({ names, now, round }: { names: Names; now: Date; round: number }) {
  const [status, setStatus] = useState<FanClubStatus>("active");
  const [artistId, setArtistId] = useState("");
  const filter = useMemo<FanClubFilter>(() => ({ status, artistId }), [status, artistId]);
  const load = useCallback((after: PageCursor | null) => getFanClubsPage(filter, after), [filter]);
  const list = usePagedList(load, (club: FanClub) => club.id, { one: "fã-clube carregado", many: "fã-clubes carregados" }, round);
  const count = useLoad(useCallback(() => countFanClubs(filter), [filter]), round);

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
          {club.status !== "active" && club.statusReason ? <span className="text-fg/70">{STATUS_REASON_LABELS[club.statusReason]}</span> : null}
        </span>
      ),
    },
    {
      key: "approved",
      header: "Aprovado em",
      align: "end",
      cell: (club) => (club.approvedAt ? <time dateTime={club.approvedAt.toISOString()}>{formatDay(club.approvedAt, now)}</time> : "Sem data"),
    },
  ];

  const statusLabel = FAN_CLUB_STATUS_LABELS[status].toLowerCase();

  return (
    <SectionCard
      id="titulo-fa-clubes"
      title="Fã-clubes"
      meta={count.state.status === "ready" ? `${fanClubCountText(count.state.data, status)}, da aprovação mais nova` : "Da aprovação mais nova."}
    >
      <div className="border-b border-line px-5 py-4">
        <FilterBar label="Filtros dos fã-clubes" active={status !== "active" || Boolean(artistId)} onClear={() => { setStatus("active"); setArtistId(""); }}>
          <FilterChips
            label="Situação"
            value={status}
            onChange={(value) => setStatus(value as FanClubStatus)}
            options={FAN_CLUB_STATUSES.map((item) => ({ value: item, label: FAN_CLUB_FILTER_LABELS[item] }))}
          />
          <FilterSelect label="Central" value={artistId} onChange={setArtistId} options={[{ value: "", label: "Todas" }, ...artistOptions(names)]} className="min-w-[200px]" />
        </FilterBar>
      </div>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-fa-clubes" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os fã-clubes..." />
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <DataTable
            caption={`Fã-clubes ${FAN_CLUB_FILTER_LABELS[status].toLowerCase()}, da aprovação mais nova`}
            columns={columns}
            rows={list.state.data}
            rowKey={(club) => club.id}
            rowHref={(club) => `/fa-clubes/${club.id}`}
            grid={CLUBS_GRID}
            focusRequest={list.focusRequest}
            empty={<EmptyState className="p-0">{artistId ? `Nenhum fã-clube ${statusLabel} nesta central.` : `Nenhum fã-clube ${statusLabel}.`}</EmptyState>}
          />
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}
