"use client";

import { Archive, ArchiveRestore, Eye, Pencil, Plus, Send, Square, Star } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { OrderButtons, useOrderFocus, type MoveDirection } from "@/components/missoes/game-bits";
import { GoalDialog, type GoalDialogRequest } from "@/components/missoes/goal-dialog";
import { MissionDialog, eventLabel, postLabel, type MissionDialogRequest } from "@/components/missoes/mission-dialog";
import { DataFreshness } from "@/components/painel/data-freshness";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
import { Badge } from "@/components/ui/badge";
import { BatchProgress } from "@/components/ui/batch-progress";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { PeriodPicker, DEFAULT_PERIOD, type PeriodDays } from "@/components/ui/period-picker";
import { StatusChip, type StatusStyle } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { artistNameOf, getArtistNames, type ArtistName } from "@/lib/artist-names-data";
import { applyOrder, moveId, positionAnnouncement } from "@/lib/artists";
import { runSequential, type BatchProgress as Progress, type BatchSummary } from "@/lib/batch";
import { rangeEndingYesterday, type DayRange } from "@/lib/day";
import { actionErrorMessage, callableErrorMessage, isConfigChanged, mayHaveRunOnServer } from "@/lib/errors";
import { formatDateTime, formatDayRange, formatNumber } from "@/lib/format";
import { reorderMissions, setMissionStatus, updateMission, updateSeasonGoal } from "@/lib/game-api";
import {
  getArchivedMissions,
  getMissionConclusions,
  getTargetDocs,
  targetKey,
  targetKeysOf,
  type CountsRead,
  type GameConfigs,
  type TargetDoc,
} from "@/lib/game-data";
import {
  ACTION_LABELS,
  ANY,
  EMPTY_MISSION_FILTERS,
  MISSION_STATE_LABELS,
  NO_ARTIST,
  PERIOD_LABELS,
  SEASON_SLOT_LABELS,
  TARGET_KIND_LABELS,
  catalogUsage,
  endedMissions,
  filterMissions,
  hasMissionFilter,
  missionState,
  missionWindowText,
  seasonDaysRange,
  seasonWindows,
  shortDateTime,
  targetKindOf,
  type Mission,
  type MissionFilters,
  type MissionState,
  type SeasonWindow,
} from "@/lib/missions";
import type { StaffMember } from "@/lib/staff";

const STATE_STYLES: Record<MissionState, StatusStyle> = {
  draft: { label: MISSION_STATE_LABELS.draft, tone: "muted", dot: true },
  active: { label: MISSION_STATE_LABELS.active, tone: "cyan", dot: true },
  scheduled: { label: MISSION_STATE_LABELS.scheduled, tone: "muted", dot: true },
  ended: { label: MISSION_STATE_LABELS.ended, tone: "danger", dot: true },
  archived: { label: MISSION_STATE_LABELS.archived, tone: "neutral", dot: true },
};

const GRID =
  "xl:grid xl:grid-cols-[84px_minmax(0,1.3fr)_minmax(0,1.5fr)_96px_86px_minmax(0,1fr)_112px_92px_44px] xl:items-center xl:gap-4";
const ARCHIVE_GRID = "xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_96px_86px_minmax(0,1fr)_120px_170px] xl:items-center xl:gap-4";

type Notify = (tone: "success" | "error" | "info", text: string) => void;

interface TabProps {
  member: StaffMember;
  canEdit: boolean;
  configs: GameConfigs;
  now: number;
  /** Uma mudança deu certo: a página avisa e lê os documentos de novo. */
  onChanged: (message: string) => void;
  onNotice: Notify;
  /** Lê de novo sem aviso (a ordem salva, a configuração que mudou por fora). */
  onReload: () => void;
}

/** O alvo por extenso, com o selo "fora do ar" quando o post ou o show não está no ar. */
function TargetCell({ mission, names, targets, now }: { mission: Mission; names: ReadonlyMap<string, ArtistName> | null; targets: ReadonlyMap<string, TargetDoc | null> | null; now: Date }) {
  const kind = targetKindOf(mission.target);
  const target = mission.target;
  if (kind === "none" || !target) return <Missing>{TARGET_KIND_LABELS.none}</Missing>;
  const artist = target.artistId ? artistNameOf(names, target.artistId) : null;
  if (kind === "artist") {
    const off = target.artistId && names?.get(target.artistId)?.status !== "published" && names?.has(target.artistId);
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-fg/85">{artist}</span>
        {off ? (
          <Badge tone="muted" className="self-start">
            fora do ar
          </Badge>
        ) : null}
      </span>
    );
  }
  const doc = targets?.get(targetKey(kind === "post" ? "post" : "event", kind === "post" ? target.postId! : target.eventId!));
  if (doc === undefined) return <span className="text-fg/60">{artist ?? "Carregando..."}</span>;
  if (doc === null) return <Missing>{kind === "post" ? "Post apagado" : "Show apagado"}</Missing>;
  const label = doc.kind === "post" ? postLabel({ ...doc, status: "published" }, now) : eventLabel({ ...doc, status: "published" }, now);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {artist && doc.kind === "post" ? <span className="text-[12px] text-fg/55">{artist}</span> : null}
      <span className="line-clamp-2 text-fg/85">{label}</span>
      {doc.status !== "published" ? (
        <Badge tone="muted" className="self-start">
          fora do ar
        </Badge>
      ) : null}
    </span>
  );
}

function MissionTitle({ mission }: { mission: Mission }) {
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      {mission.featured ? (
        <>
          <Star aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 fill-current text-fg/80" />
          <span className="sr-only">Destaque: </span>
        </>
      ) : null}
      <span className="text-sm font-semibold text-fg">{mission.title}</span>
    </span>
  );
}

function PointsCell({ points }: { points: number }) {
  return <span className="font-semibold text-lime tabular-nums">{formatNumber(points)} pts</span>;
}

function GoalCell({ mission }: { mission: Mission }) {
  return (
    <span className="tabular-nums">
      {mission.goal}× · {PERIOD_LABELS[mission.period].toLowerCase()}
    </span>
  );
}

export function MissionsTab({ member, canEdit, configs, now, onChanged, onNotice, onReload }: TabProps) {
  const catalog = configs.missions;
  const [filters, setFilters] = useState<MissionFilters>(EMPTY_MISSION_FILTERS);
  const [days, setDays] = useState<PeriodDays>(DEFAULT_PERIOD);
  const [dialog, setDialog] = useState<MissionDialogRequest | null>(null);
  const [viewing, setViewing] = useState<Mission | null>(null);
  const [goalDialog, setGoalDialog] = useState<GoalDialogRequest | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [order, setOrder] = useState<{ ids: string[]; version: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [hint, setHint] = useState(0);
  const focusOrder = useOrderFocus();

  const version = Math.max(catalog.version, hint, order?.version ?? 0);
  const missions = useMemo(
    () => (order && order.version > catalog.version ? applyOrder(catalog.missions, order.ids) : catalog.missions),
    [catalog, order],
  );
  const windows = useMemo(() => seasonWindows(configs.season), [configs.season]);
  const date = new Date(now);

  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const artistNames = names.state.status === "ready" ? names.state.data : null;
  const keyList = targetKeysOf(catalog.missions).join("|");
  const targets = useLoad(useCallback(() => getTargetDocs(keyList ? keyList.split("|") : []), [keyList]));
  const targetDocs = targets.state.status === "ready" ? targets.state.data : null;

  const seasonWindow = filters.season === ANY ? null : (windows.find((item) => item.slot === filters.season) ?? null);
  const range = useMemo((): DayRange | null => {
    const chosen = filters.season === ANY ? null : (windows.find((item) => item.slot === filters.season) ?? null);
    return chosen ? seasonDaysRange(chosen, now) : rangeEndingYesterday(days, now);
  }, [windows, filters.season, days, now]);
  const conclusions = useLoad(
    useCallback((): Promise<CountsRead | null> => (range ? getMissionConclusions(range, now) : Promise.resolve(null)), [range, now]),
  );
  const counts = conclusions.state.status === "ready" ? conclusions.state.data : null;

  const filtered = filters.state === "archived" ? [] : filterMissions(missions, filters, windows, now);
  const filtering = hasMissionFilter(filters);
  const ended = endedMissions(catalog.missions, now);
  const goal = catalog.seasonGoal;
  const season = configs.season.season;
  const goalSeason = goal ? (windows.find((item) => item.id === goal.seasonId) ?? null) : null;

  function setFilter<K extends keyof MissionFilters>(key: K, value: MissionFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function remember(result: { version: number }) {
    setHint((current) => Math.max(current, result.version));
  }

  /** A versão nova de cada resposta vale para a próxima ação; a configuração mudada por fora faz a página ler de novo. */
  function track(promise: Promise<{ version: number }>): Promise<void> {
    return promise.then(remember, (failure: unknown) => {
      if (isConfigChanged(failure)) onReload();
      throw failure;
    });
  }

  function changedOutside(failure: unknown) {
    if (isConfigChanged(failure) || mayHaveRunOnServer(failure)) onReload();
  }

  function ask(request: Omit<ConfirmRequest, "onUncertain">) {
    setConfirm({ ...request, onUncertain: onReload });
  }

  function askPublish(mission: Mission) {
    const later = mission.startsAt.getTime() > now;
    ask({
      title: `Publicar ${mission.title}?`,
      body: later
        ? `A missão entra no app em ${formatDateTime(mission.startsAt)}. Depois do começo, tipo, alvo, meta, período e início não mudam.`
        : "A missão entra no app agora. Depois do começo, tipo, alvo, meta, período e início não mudam.",
      confirmLabel: "Publicar",
      busyLabel: "Publicando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => track(setMissionStatus({ expectedVersion: version, missionId: mission.id, status: "active" })),
      successMessage: later ? `Missão ${mission.title} agendada.` : `Missão ${mission.title} no ar.`,
    });
  }

  function askArchive(mission: Mission) {
    ask({
      title: `Arquivar ${mission.title}?`,
      body: "A missão sai do catálogo e do app, e libera a vaga. Quem já concluiu não perde nada. Dá para trazer de volta pelo filtro Arquivadas.",
      confirmLabel: "Arquivar",
      busyLabel: "Arquivando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => track(setMissionStatus({ expectedVersion: version, missionId: mission.id, status: "archived" })),
      successMessage: `Missão ${mission.title} arquivada.`,
    });
  }

  function askRestore(mission: Mission) {
    ask({
      title: `Trazer ${mission.title} de volta?`,
      body: "A missão volta para o fim do catálogo, já no ar, com as mesmas regras.",
      confirmLabel: "Trazer de volta",
      busyLabel: "Trazendo...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => track(setMissionStatus({ expectedVersion: version, missionId: mission.id, status: "active" })),
      successMessage: `Missão ${mission.title} de volta ao catálogo, no ar.`,
    });
  }

  function askEnd(mission: Mission) {
    ask({
      title: `Encerrar ${mission.title} agora?`,
      body: "O fim passa a ser agora: a missão sai do app e continua no catálogo, ocupando vaga, até ser arquivada.",
      confirmLabel: "Encerrar agora",
      busyLabel: "Encerrando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => track(updateMission({ expectedVersion: version, missionId: mission.id, changes: { endsAt: Date.now() } })),
      successMessage: `Missão ${mission.title} encerrada.`,
    });
  }

  function askRemoveGoal() {
    if (!goal) return;
    ask({
      title: `Tirar a meta ${goal.title}?`,
      body: "O app deixa de mostrar a meta da temporada. O progresso dos fãs não muda.",
      confirmLabel: "Tirar meta",
      busyLabel: "Tirando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => track(updateSeasonGoal({ expectedVersion: version, goal: null })),
      successMessage: "Meta da temporada tirada.",
    });
  }

  async function move(mission: Mission, direction: MoveDirection) {
    if (moving) return;
    const next = moveId(
      missions.map((item) => item.id),
      mission.id,
      direction === "up" ? -1 : 1,
    );
    if (!next) return;
    const expected = version;
    setOrder({ ids: next, version: expected + 1 });
    setMoving(true);
    focusOrder({ id: mission.id, direction });
    setAnnouncement((current) => ({ key: (current?.key ?? 0) + 1, text: positionAnnouncement(mission.title, next.indexOf(mission.id) + 1, next.length) }));
    try {
      const result = await reorderMissions({ expectedVersion: expected, missionIds: next });
      setOrder({ ids: next, version: result.version });
      remember(result);
      onReload();
    } catch (failure) {
      setOrder(null);
      focusOrder({ id: mission.id, direction });
      onNotice("error", `A nova ordem não foi salva e voltou ao que era. ${callableErrorMessage(failure)}`);
      changedOutside(failure);
    } finally {
      setMoving(false);
    }
  }

  function actionsOf(mission: Mission): MenuAction[] {
    const state = missionState(mission, now);
    const items: MenuAction[] = [{ label: "Editar", icon: Pencil, onSelect: () => setDialog({ mission, version, catalogIds: catalog.missions.map((item) => item.id) }) }];
    if (state === "draft") items.push({ label: "Publicar", icon: Send, onSelect: () => askPublish(mission) });
    if (state === "active") items.push({ label: "Encerrar agora", icon: Square, onSelect: () => askEnd(mission), tone: "danger" });
    items.push({ label: "Arquivar", icon: Archive, onSelect: () => askArchive(mission), tone: "danger" });
    return items;
  }

  const columns: Column<Mission>[] = [
    {
      key: "order",
      header: "Ordem",
      cell: (mission) => {
        const index = missions.indexOf(mission);
        return (
          <span className="flex items-center gap-1.5">
            <span className="w-6 text-right font-display text-sm font-semibold tabular-nums text-fg/80">
              <span className="sr-only">Posição </span>
              {index + 1}
            </span>
            {canEdit && !filtering ? (
              <OrderButtons id={mission.id} name={mission.title} first={index === 0} last={index === missions.length - 1} busy={moving} onMove={(direction) => void move(mission, direction)} />
            ) : null}
          </span>
        );
      },
    },
    { key: "title", header: "Missão", cell: (mission) => <MissionTitle mission={mission} /> },
    {
      key: "target",
      header: "Tipo e alvo",
      cell: (mission) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-fg/90">{ACTION_LABELS[mission.action]}</span>
          <TargetCell mission={mission} names={artistNames} targets={targetDocs} now={date} />
        </span>
      ),
    },
    { key: "goal", header: "Meta", cell: (mission) => <GoalCell mission={mission} /> },
    { key: "points", header: "Pontos", align: "end", cell: (mission) => <PointsCell points={mission.rewardPoints} /> },
    { key: "window", header: "Janela", cell: (mission) => <span className="text-fg/75">{missionWindowText(mission, date)}</span> },
    { key: "state", header: "Situação", cell: (mission) => <StatusChip status={missionState(mission, now)} map={STATE_STYLES} /> },
    {
      key: "done",
      header: "Conclusões",
      align: "end",
      cell: (mission) => <span className="tabular-nums">{counts ? formatNumber(counts.byId[mission.id] ?? 0) : conclusions.state.status === "error" ? "?" : "..."}</span>,
    },
    {
      key: "actions",
      header: "",
      label: "",
      align: "end",
      cell: (mission) =>
        canEdit ? (
          <ActionsMenu label={`Ações de ${mission.title}`} actions={actionsOf(mission)} />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setViewing(mission)} aria-label={`Ver ${mission.title}`}>
            <Eye aria-hidden="true" className="size-4" />
          </Button>
        ),
    },
  ];

  const artistOptions = artistNames ? [...artistNames.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) : [];
  const conclusionsText = range ? `Conclusões ${formatDayRange(range.from, range.to, date)}.` : "A temporada ainda não começou: sem conclusões.";

  return (
    <div className="flex flex-col gap-6">
      <SectionCard id="titulo-meta" title="Meta da temporada" meta={season ? season.name : "Sem temporada atual"}>
        <div className="flex flex-col gap-4 px-5 py-4">
          {goal ? (
            <>
              <div className="flex flex-col gap-1">
                <h3 className="m-0 font-display text-lg font-semibold">{goal.title}</h3>
                <p className="m-0 text-sm text-fg/75">{goal.description}</p>
              </div>
              <DetailList>
                <Detail term="Conta">{goal.metric === "missions" ? "Missões concluídas" : "Pontos da temporada"}</Detail>
                <Detail term="Alvo">{goal.metric === "points" ? <PointsCell points={goal.target} /> : `${formatNumber(goal.target)} missões`}</Detail>
                <Detail term="Temporada">{goalSeason ? `${goalSeason.name} (${SEASON_SLOT_LABELS[goalSeason.slot]})` : goal.seasonId}</Detail>
                <Detail term="Meta cumprida">{goal.reachedDescription ?? <Missing>Sem texto</Missing>}</Detail>
              </DetailList>
              {season && goal.seasonId !== season.id ? (
                <p className="m-0 text-[13px] text-danger">Esta meta é de outra temporada: o app não mostra. Crie a meta de {season.name}.</p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-sm text-fg/65">{season ? "Nenhuma meta para esta temporada." : "Sem temporada atual: a meta fica desligada. Cadastre a temporada em Ranking e temporadas."}</p>
          )}
          {canEdit && season ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={goal ? "secondary" : "primary"} onClick={() => setGoalDialog({ goal: goal && goal.seasonId === season.id ? goal : null, version, seasonName: season.name })}>
                {goal && goal.seasonId === season.id ? "Editar meta" : "Criar meta"}
              </Button>
              {goal ? (
                <Button size="sm" variant="danger" onClick={askRemoveGoal}>
                  Tirar meta
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard id="titulo-missoes" title="Missões" meta={catalogUsage(catalog.missions)}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => setDialog({ mission: null, version, catalogIds: catalog.missions.map((item) => item.id) })}>
                <Plus aria-hidden="true" className="size-4" />
                Nova missão
              </Button>
              {ended.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setBatchOpen(true)}>
                  <Archive aria-hidden="true" className="size-4" />
                  Arquivar encerradas ({ended.length})
                </Button>
              ) : null}
            </div>
          ) : null}
          <FilterBar label="Filtros das missões" active={filtering} onClear={() => setFilters(EMPTY_MISSION_FILTERS)}>
            <FilterSelect
              label="Situação"
              value={filters.state}
              onChange={(value) => setFilter("state", value as MissionFilters["state"])}
              options={[
                { value: ANY, label: "Todas" },
                { value: "active", label: "No ar" },
                { value: "scheduled", label: "Agendadas" },
                { value: "draft", label: "Rascunhos" },
                { value: "ended", label: "Encerradas" },
                { value: "archived", label: "Arquivadas" },
              ]}
            />
            <FilterSelect
              label="Central"
              value={filters.artist}
              onChange={(value) => setFilter("artist", value)}
              options={[{ value: ANY, label: "Todas" }, { value: NO_ARTIST, label: "Sem central" }, ...artistOptions.map((artist) => ({ value: artist.id, label: artist.name }))]}
            />
            <FilterSelect
              label="Temporada"
              value={filters.season}
              onChange={(value) => setFilter("season", value as MissionFilters["season"])}
              options={[{ value: ANY, label: "Todas" }, ...windows.map((item: SeasonWindow) => ({ value: item.slot, label: `${item.name} (${SEASON_SLOT_LABELS[item.slot]})` }))]}
            />
            <FilterSelect
              label="Período"
              value={filters.period}
              onChange={(value) => setFilter("period", value as MissionFilters["period"])}
              options={[
                { value: ANY, label: "Todos" },
                { value: "daily", label: "Diárias" },
                { value: "weekly", label: "Semanais" },
              ]}
            />
          </FilterBar>
          {filters.state !== "archived" ? (
            <div className="flex flex-col gap-2">
              {seasonWindow ? null : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[12px] font-semibold text-fg/65">Conclusões no período</span>
                  <PeriodPicker value={days} onChange={setDays} now={now} label="Período das conclusões" />
                </div>
              )}
              <p className="m-0 text-[13px] text-fg/70">
                {seasonWindow ? `As conclusões somam os dias de ${seasonWindow.name}. ` : ""}
                {conclusionsText}
              </p>
              {counts ? <DataFreshness state={counts.state} closedAt={counts.closedAt} now={date} /> : null}
              {conclusions.state.status === "error" ? <p className="m-0 text-[13px] text-danger">As conclusões não carregaram: {conclusions.state.message}</p> : null}
              {canEdit && filtering ? <p className="m-0 text-[13px] text-fg/60">Tire os filtros para mudar a ordem.</p> : null}
            </div>
          ) : null}
        </div>
        <div aria-live="polite" className="sr-only">
          {announcement ? <p key={announcement.key}>{announcement.text}</p> : null}
        </div>
        {filters.state === "archived" ? (
          <ArchivedMissions key={catalog.version} canEdit={canEdit} names={artistNames} now={now} onRestore={askRestore} onView={setViewing} />
        ) : (
          <DataTable
            caption="Missões do catálogo, na ordem do app"
            columns={columns}
            rows={filtered}
            rowKey={(mission) => mission.id}
            grid={GRID}
            empty={
              catalog.missions.length === 0 ? (
                <EmptyState
                  className="p-0"
                  action={
                    canEdit ? (
                      <Button size="sm" variant="primary" onClick={() => setDialog({ mission: null, version, catalogIds: [] })}>
                        Nova missão
                      </Button>
                    ) : null
                  }
                >
                  Nenhuma missão ainda.
                </EmptyState>
              ) : (
                "Nenhuma missão com esses filtros."
              )
            }
          />
        )}
      </SectionCard>

      <MissionDialog
        request={canEdit ? dialog : null}
        uid={member.uid}
        artists={artistOptions}
        targets={targetDocs}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setDialog(null);
          onChanged(message);
        }}
      />
      <GoalDialog
        request={canEdit ? goalDialog : null}
        onClose={() => setGoalDialog(null)}
        onSaved={(message) => {
          setGoalDialog(null);
          onChanged(message);
        }}
      />
      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          onChanged(message);
        }}
      />
      <MissionView mission={viewing} names={artistNames} targets={targetDocs} now={now} counts={counts} onClose={() => setViewing(null)} />
      {canEdit ? (
        <ArchiveEndedDialog
          open={batchOpen}
          missions={ended}
          version={version}
          onClose={(summary) => {
            setBatchOpen(false);
            if (summary) onChanged(`Arquivar encerradas: ${summary}`);
          }}
          onVersion={remember}
        />
      ) : null}
    </div>
  );
}

/** As arquivadas (`missionArchive`), da mais nova, lidas só quando o filtro é escolhido. */
function ArchivedMissions({
  canEdit,
  names,
  now,
  onRestore,
  onView,
}: {
  canEdit: boolean;
  names: ReadonlyMap<string, ArtistName> | null;
  now: number;
  onRestore: (mission: Mission) => void;
  onView: (mission: Mission) => void;
}) {
  const archived = useLoad(getArchivedMissions);
  const list = archived.state.status === "ready" ? archived.state.data : null;
  const keyList = list ? targetKeysOf(list).join("|") : "";
  const targets = useLoad(useCallback(() => getTargetDocs(keyList ? keyList.split("|") : []), [keyList]));
  const targetDocs = targets.state.status === "ready" ? targets.state.data : null;
  const date = new Date(now);
  const columns: Column<Mission>[] = [
    { key: "title", header: "Missão", cell: (mission) => <MissionTitle mission={mission} /> },
    {
      key: "target",
      header: "Tipo e alvo",
      cell: (mission) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-fg/90">{ACTION_LABELS[mission.action]}</span>
          <TargetCell mission={mission} names={names} targets={targetDocs} now={date} />
        </span>
      ),
    },
    { key: "goal", header: "Meta", cell: (mission) => <GoalCell mission={mission} /> },
    { key: "points", header: "Pontos", align: "end", cell: (mission) => <PointsCell points={mission.rewardPoints} /> },
    { key: "window", header: "Janela", cell: (mission) => <span className="text-fg/75">{missionWindowText(mission, date)}</span> },
    { key: "archived", header: "Arquivada em", cell: (mission) => (mission.archivedAt ? shortDateTime(mission.archivedAt, date) : <Missing>Sem data</Missing>) },
    {
      key: "actions",
      header: "",
      label: "",
      align: "end",
      cell: (mission) =>
        canEdit ? (
          <Button size="sm" variant="secondary" onClick={() => onRestore(mission)}>
            <ArchiveRestore aria-hidden="true" className="size-4" />
            Trazer de volta
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onView(mission)} aria-label={`Ver ${mission.title}`}>
            <Eye aria-hidden="true" className="size-4" />
          </Button>
        ),
    },
  ];
  if (archived.state.status === "error") return <LoadError message={archived.state.message} headingId="titulo-missoes" onRetry={archived.reload} />;
  if (!list) return <LoadingRow label="Carregando as arquivadas..." />;
  return (
    <DataTable
      caption="Missões arquivadas, da mais nova"
      columns={columns}
      rows={list}
      rowKey={(mission) => mission.id}
      grid={ARCHIVE_GRID}
      empty="Nenhuma missão arquivada."
    />
  );
}

/** "Ver" de quem só lê: a missão inteira, sem botões de mudança. */
function MissionView({
  mission,
  names,
  targets,
  now,
  counts,
  onClose,
}: {
  mission: Mission | null;
  names: ReadonlyMap<string, ArtistName> | null;
  targets: ReadonlyMap<string, TargetDoc | null> | null;
  now: number;
  counts: CountsRead | null;
  onClose: () => void;
}) {
  const date = new Date(now);
  return (
    <Dialog open={Boolean(mission)} onClose={onClose} size="md" title={mission?.title ?? ""} description={mission ? MISSION_STATE_LABELS[missionState(mission, now)] : undefined}>
      {mission ? (
        <div className="flex flex-col gap-5">
          <DetailList>
            <Detail term="Tipo">{ACTION_LABELS[mission.action]}</Detail>
            <Detail term="Alvo">
              <TargetCell mission={mission} names={names} targets={targets} now={date} />
            </Detail>
            <Detail term="Meta">
              <GoalCell mission={mission} />
            </Detail>
            <Detail term="Pontos">
              <PointsCell points={mission.rewardPoints} />
            </Detail>
            <Detail term="Destaque">{mission.featured ? "Sim" : "Não"}</Detail>
            <Detail term="Janela" wide>
              {missionWindowText(mission, date)}
            </Detail>
            {mission.status !== "archived" ? <Detail term="Conclusões no período">{counts ? formatNumber(counts.byId[mission.id] ?? 0) : "..."}</Detail> : null}
            <Detail term="Identificador">
              <span className="font-mono text-[13px]">{mission.id}</span>
            </Detail>
          </DetailList>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose} data-autofocus>
              Fechar
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

/** "Arquivar encerradas": uma por vez, encadeando o `version` de cada resposta, com o botão de parar. */
function ArchiveEndedDialog({
  open,
  missions,
  version,
  onClose,
  onVersion,
}: {
  open: boolean;
  missions: Mission[];
  version: number;
  onClose: (summary: string | null) => void;
  onVersion: (result: { version: number }) => void;
}) {
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<BatchSummary<Mission> | null>(null);
  const stopRequested = useRef(false);
  const [items, setItems] = useState<Mission[]>([]);

  async function run() {
    const list = [...missions];
    stopRequested.current = false;
    setItems(list);
    setRunning(true);
    setSummary(null);
    setProgress({ attempted: 0, total: list.length, done: 0, unchanged: 0, failed: 0 });
    let expected = version;
    const result = await runSequential(
      list,
      async (mission) => {
        const response = await setMissionStatus({ expectedVersion: expected, missionId: mission.id, status: "archived" });
        const changed = response.version !== expected;
        expected = response.version;
        onVersion(response);
        return changed ? "done" : "unchanged";
      },
      {
        onProgress: setProgress,
        stopOn: (error) => isConfigChanged(error) || mayHaveRunOnServer(error),
        shouldStop: () => stopRequested.current,
      },
    );
    setSummary(result);
    setRunning(false);
    setStopping(false);
  }

  function close() {
    if (running) return;
    const text = summary ? `${summary.done} ${summary.done === 1 ? "arquivada" : "arquivadas"}${summary.failed > 0 ? `, ${summary.failed} com erro` : ""}.` : null;
    setProgress(null);
    setSummary(null);
    setItems([]);
    onClose(text);
  }

  const shown = running || summary ? items : missions;
  const failure = summary?.failures[0]?.error;
  return (
    <Dialog
      open={open}
      onClose={close}
      busy={running}
      size="md"
      title="Arquivar encerradas"
      description="Cada missão encerrada sai do catálogo e do app, uma por vez, e libera a vaga. Quem já concluiu não perde nada."
    >
      <div className="flex flex-col gap-4">
        <ul className="m-0 flex max-h-56 list-none flex-col gap-1.5 overflow-y-auto p-0 text-[13.5px]">
          {shown.map((mission) => (
            <li key={mission.id} className="text-fg/85">
              {mission.title}
            </li>
          ))}
        </ul>
        <BatchProgress
          progress={progress}
          summary={summary}
          doneLabel="arquivadas"
          doneOne="arquivada"
          running={running}
          stopping={stopping}
          onStop={() => {
            stopRequested.current = true;
            setStopping(true);
          }}
        />
        {failure ? <p className="m-0 text-[13px] text-danger">{actionErrorMessage(failure)}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={running} data-autofocus>
            {summary ? "Fechar" : "Voltar"}
          </Button>
          {!summary ? (
            <Button variant="danger" busy={running} disabled={missions.length === 0} onClick={() => void run()}>
              {running ? "Arquivando..." : `Arquivar ${countWord(missions.length)}`}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function countWord(count: number): string {
  return count === 1 ? "1 encerrada" : `${count} encerradas`;
}
