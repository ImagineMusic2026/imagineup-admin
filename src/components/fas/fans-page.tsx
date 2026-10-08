"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { FanAvatar } from "@/components/painel/fan-avatar";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterChips, FilterSelect } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SearchField } from "@/components/ui/search-field";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { getArtistNames } from "@/lib/artist-names-data";
import { errorMessage } from "@/lib/errors";
import { fanDisplayName, suspensionReasonLabel } from "@/lib/fan-profile";
import { createFanProfileReader } from "@/lib/fan-profile-data";
import { getCurrentSeason, getFanListPage, getFansCount, getLevels, rowsOfProfiles, type FanListMode, type FanRow } from "@/lib/fan-data";
import { searchFans } from "@/lib/fan-search";
import { classifyFanSearch } from "@/lib/fans";
import type { PageCursor } from "@/lib/firestore-page";
import { countLabel, formatDay, formatNumber } from "@/lib/format";
import { NO_LEVELS_TEXT, levelOf, type Level } from "@/lib/levels";
import { canEditSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("fans");
const GRID = "xl:grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_110px_minmax(0,1fr)_120px_110px] xl:items-center xl:gap-4";

type ListChoice = "newest" | "xp" | "goal" | "suspended";

/** Fãs (`/fas`): a lista, os filtros e a busca. A linha abre a ficha. */
export function FansPage() {
  return <SectionGate section="fans">{(member) => <FansContent member={member} />}</SectionGate>;
}

interface SearchState {
  status: "idle" | "busy" | "done";
  rows: FanRow[];
  result: string;
  limited: boolean;
}

function FansContent({ member }: { member: StaffMember }) {
  const router = useRouter();
  const canEdit = canEditSection(member, "fans");
  const [now] = useState(() => new Date());
  const [choice, setChoice] = useState<ListChoice>("newest");
  const [artistId, setArtistId] = useState("");
  const [reader] = useState(() => createFanProfileReader());
  const [search, setSearch] = useState<SearchState>({ status: "idle", rows: [], result: "", limited: false });

  const context = useLoad(
    useCallback(async () => {
      const [count, season, levels, artists] = await Promise.all([getFansCount(), getCurrentSeason(), getLevels(), getArtistNames(member)]);
      return { count, season, levels, artists };
    }, [member]),
  );
  const season = context.state.status === "ready" ? context.state.data.season : null;
  const levels = context.state.status === "ready" ? context.state.data.levels : null;

  const seasonId = season?.id ?? null;
  const mode = useMemo<FanListMode | null>(() => {
    if (artistId) return { kind: "central", artistId };
    if (choice === "goal") return seasonId ? { kind: "goal", seasonId } : null;
    return { kind: choice };
  }, [artistId, choice, seasonId]);
  const loadPage = useCallback(
    (after: PageCursor | null) =>
      mode ? getFanListPage(mode, after, reader) : Promise.resolve({ items: [] as FanRow[], cursor: null, hasMore: false }),
    [mode, reader],
  );
  const list = usePagedList(loadPage, (row) => row.uid, { one: "fã carregado", many: "fãs carregados" });

  async function runSearch(text: string) {
    const kind = classifyFanSearch(text);
    if (!kind) {
      setSearch({ status: "done", rows: [], result: "Escreva pelo menos duas letras.", limited: false });
      return;
    }
    setSearch((current) => ({ ...current, status: "busy" }));
    try {
      const found = await searchFans(kind, { canEdit });
      if (found.kind === "open") {
        setSearch({ status: "done", rows: [], result: "Fã encontrado pelo e-mail. Abrindo a ficha...", limited: false });
        router.push(`/fas/${found.uid}`);
        return;
      }
      if (found.kind === "none") {
        setSearch({ status: "done", rows: [], result: found.message, limited: false });
        return;
      }
      const rows = await rowsOfProfiles(found.profiles);
      setSearch({
        status: "done",
        rows,
        result: `${countLabel(rows.length, "fã encontrado", "fãs encontrados")}.${found.limited ? " Mostrando os 20 primeiros. Refine a busca." : ""}`,
        limited: found.limited,
      });
    } catch (error) {
      setSearch({ status: "done", rows: [], result: errorMessage(error), limited: false });
    }
  }

  function refresh() {
    reader.clear();
    context.reload();
    list.reload();
  }

  const columns = fanColumns(levels, now, Boolean(artistId));
  const searching = search.status !== "idle";
  const artistOptions =
    context.state.status === "ready" ? [...context.state.data.artists.values()].map((artist) => ({ value: artist.id, label: artist.name })) : [];

  return (
    <>
      <PageHeader
        title={INFO.label}
        subtitle={context.state.status === "ready" ? `${countLabel(context.state.data.count, "fã", "fãs")} no app` : INFO.description}
        actions={<RefreshButton onClick={refresh} busy={list.reloading} loadedAt={list.loadedAt} />}
      />

      <SectionCard id="titulo-lista-fas" title={searching ? "Resultado da busca" : "Fãs"}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          <SearchField
            label="Buscar fã"
            placeholder="Nome, @, código de convite ou e-mail"
            hint={canEdit ? undefined : "A busca por e-mail é só para quem edita a seção Fãs."}
            busy={search.status === "busy"}
            result={search.result}
            active={searching}
            onSearch={(text) => void runSearch(text)}
            onClear={() => setSearch({ status: "idle", rows: [], result: "", limited: false })}
          />
          {!searching ? (
            <FilterBar label="Filtros da lista" active={choice !== "newest" || Boolean(artistId)} onClear={() => { setChoice("newest"); setArtistId(""); }}>
              <FilterChips
                label="Mostrar"
                value={artistId ? "" : choice}
                onChange={(value) => {
                  setArtistId("");
                  setChoice(value as ListChoice);
                }}
                options={[
                  { value: "newest", label: "Mais novos" },
                  { value: "xp", label: "Mais XP" },
                  { value: "goal", label: "Bateram a meta" },
                  { value: "suspended", label: "Suspensos" },
                ]}
              />
              <FilterSelect
                label="Central"
                value={artistId}
                onChange={setArtistId}
                options={[{ value: "", label: "Todas" }, ...artistOptions]}
              />
            </FilterBar>
          ) : null}
          {!searching && choice === "goal" && !artistId && context.state.status === "ready" && !season ? (
            <Notice tone="info">Não há temporada em andamento: ninguém bateu a meta dela.</Notice>
          ) : null}
          {!searching && choice === "goal" && season ? (
            <p className="m-0 text-[12.5px] text-fg/60">Quem bateu a meta de {season.name}.</p>
          ) : null}
          {levels === null && context.state.status === "ready" ? <p className="m-0 text-[12.5px] text-fg/60">{NO_LEVELS_TEXT}</p> : null}
        </div>

        {searching ? (
          search.status === "busy" ? (
            <LoadingRow label="Buscando..." />
          ) : (
            <DataTable
              caption="Fãs encontrados"
              columns={columns}
              rows={search.rows}
              rowKey={(row) => row.uid}
              rowHref={(row) => `/fas/${row.uid}`}
              grid={GRID}
              empty={<EmptyState className="p-0">{search.result || "Nenhum fã encontrado."}</EmptyState>}
            />
          )
        ) : list.state.status === "error" ? (
          <LoadError message={list.state.message} headingId="titulo-lista-fas" onRetry={refresh} />
        ) : list.state.status === "loading" ? (
          <LoadingRow label="Carregando os fãs..." />
        ) : (
          <>
            {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
            <DataTable
              caption="Fãs"
              columns={columns}
              rows={list.state.data}
              rowKey={(row) => row.uid}
              rowHref={(row) => `/fas/${row.uid}`}
              grid={GRID}
              focusRequest={list.focusRequest}
              empty={
                <EmptyState className="p-0">
                  {artistId ? "Ninguém nesta central ainda." : choice === "suspended" ? "Nenhum fã suspenso." : choice === "goal" ? "Ninguém bateu a meta ainda." : "Nenhum fã ainda."}
                </EmptyState>
              }
            />
            <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
          </>
        )}
      </SectionCard>
    </>
  );
}

function fanColumns(levels: Level[] | null, now: Date, inCentral: boolean): Column<FanRow>[] {
  return [
    {
      key: "fan",
      header: "Fã",
      cell: (row) => {
        const name = row.profile ? fanDisplayName(row.profile) : "Conta excluída";
        return (
          <span className="flex min-w-0 items-center gap-3">
            <FanAvatar name={name} photoURL={row.profile?.photoURL ?? null} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">{name}</span>
              {row.profile?.username ? <span className="block truncate text-[12.5px] text-fg/60">@{row.profile.username}</span> : null}
            </span>
          </span>
        );
      },
    },
    { key: "city", header: "Cidade", cell: (row) => row.profile?.city ?? <span className="text-fg/50">Sem cidade</span> },
    {
      key: "since",
      header: inCentral ? "Na central desde" : "No app desde",
      cell: (row) => {
        const date = inCentral ? row.joinedAt : (row.profile?.createdAt ?? null);
        return date ? <time dateTime={date.toISOString()}>{formatDay(date, now)}</time> : "Sem data";
      },
    },
    {
      key: "level",
      header: "Nível e XP",
      cell: (row) => (
        <span className="flex flex-col">
          {levels ? <span className="text-fg">{`Nível ${levelOf(row.wallet.xp, levels).number} · ${levelOf(row.wallet.xp, levels).name}`}</span> : null}
          <span className="font-semibold text-lime tabular-nums">{formatNumber(row.wallet.xp)} XP</span>
        </span>
      ),
    },
    {
      key: "balance",
      header: "Saldo",
      align: "end",
      cell: (row) => <span className="font-semibold text-lime tabular-nums">{formatNumber(row.wallet.balance)} pts</span>,
    },
    {
      key: "status",
      header: "Situação",
      align: "end",
      cell: (row) =>
        row.profile?.suspendedAt ? (
          <Badge tone="danger">Suspenso · {suspensionReasonLabel(row.profile.suspensionReason)}</Badge>
        ) : (
          <span className="text-fg/50">Ativo</span>
        ),
    },
  ];
}
