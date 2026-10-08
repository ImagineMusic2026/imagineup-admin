"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SeasonDialog, type SeasonDialogRequest } from "@/components/ranking/season-dialog";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { StatusChip, type StatusStyle } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, getArtistNames, type ArtistName } from "@/lib/artist-names-data";
import { actionErrorMessage } from "@/lib/errors";
import { countLabel, formatDateTime, formatNumber } from "@/lib/format";
import {
  PHASE_LABELS,
  canRunClose,
  changeText,
  seasonDates,
  seasonPhase,
  seasonSummary,
  type PastSeason,
  type RankingRow,
  type SeasonPhase,
  type StandingRow,
} from "@/lib/season";
import { closeSeasonNow, endSeason, getPanelRanking, scheduleNextSeason } from "@/lib/season-api";
import { getPastSeasons, getPodium, getSeasonState } from "@/lib/season-data";
import { canEditSection, canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("ranking");

const PHASE_STYLES: Record<SeasonPhase, StatusStyle> = {
  scheduled: { label: PHASE_LABELS.scheduled, tone: "muted", dot: true },
  active: { label: PHASE_LABELS.active, tone: "cyan", dot: true },
  "awaiting-close": { label: PHASE_LABELS["awaiting-close"], tone: "neutral", dot: true },
  closing: { label: PHASE_LABELS.closing, tone: "neutral", dot: true },
  late: { label: PHASE_LABELS.late, tone: "danger", dot: true },
};

/** Ranking e temporadas (`/ranking`): a temporada atual e a próxima, o ranking ao vivo e as temporadas passadas. */
export function RankingPage() {
  return <SectionGate section="ranking">{(member) => <RankingContent member={member} />}</SectionGate>;
}

function RankingContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "ranking");
  const [now, setNow] = useState(() => Date.now());
  const state = useLoad(getSeasonState);
  const [dialog, setDialog] = useState<SeasonDialogRequest | null>(null);
  const [confirm, setConfirm] = useState<(ConfirmRequest & { focusId: string }) | null>(null);
  const [notice, setNotice] = useState<{ key: number; tone: "success" | "error" | "info"; text: string } | null>(null);
  const [closing, setClosing] = useState<{ seasonId: string; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ id: string; key: number } | null>(null);
  // Num efeito: roda depois de o diálogo que fechou devolver o foco ao botão, que pode ter sumido com a ação.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const data = state.state.status === "ready" ? state.state.data : null;
  const config = data?.config ?? null;
  const phase = config?.season ? seasonPhase(config.season, data?.archiveStatus ?? null, now) : null;

  function show(tone: "success" | "error" | "info", text: string, focusId?: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone, text }));
    if (focusId) setFocusTarget((current) => ({ id: focusId, key: (current?.key ?? 0) + 1 }));
  }

  function refresh() {
    setNow(Date.now());
    state.reload();
    setReloadKey((value) => value + 1);
  }

  function askEnd() {
    if (!config?.season) return;
    const season = config.season;
    setConfirm({
      title: `Encerrar ${season.name} agora?`,
      body: "A temporada termina agora para todos os fãs, e o ranking fecha na virada, em até 11 minutos. Isso não se desfaz.",
      confirmLabel: "Encerrar temporada",
      busyLabel: "Encerrando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => endSeason({ expectedVersion: config.version, seasonId: season.id }),
      successMessage: `${season.name} encerrada. A virada fecha o ranking em alguns minutos.`,
      onUncertain: refresh,
      focusId: "titulo-temporada",
    });
  }

  function askCancelNext() {
    if (!config?.next) return;
    const next = config.next;
    setConfirm({
      title: `Cancelar ${next.name}?`,
      body: "A próxima temporada sai da agenda. A temporada de agora não muda.",
      confirmLabel: "Cancelar próxima",
      busyLabel: "Cancelando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => scheduleNextSeason({ expectedVersion: config.version, next: null }),
      successMessage: `${next.name} saiu da agenda.`,
      onUncertain: refresh,
      focusId: "titulo-proxima",
    });
  }

  return (
    <>
      <PageHeader
        title={INFO.label}
        subtitle={config ? seasonSummary(config, phase, now) : INFO.description}
        actions={<RefreshButton onClick={refresh} busy={state.reloading} loadedAt={state.loadedAt} />}
      />

      <div aria-live="polite" className="sr-only">
        {notice && notice.tone !== "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone={notice.tone} announce={notice.tone === "error"}>
          {notice.text}
        </Notice>
      ) : null}
      {state.refreshError ? <Notice tone="error">Não deu para atualizar: {state.refreshError}</Notice> : null}

      {state.state.status === "error" ? (
        <SectionCard id="titulo-temporada" title="Temporada">
          <LoadError message={state.state.message} headingId="titulo-temporada" onRetry={refresh} />
        </SectionCard>
      ) : !config ? (
        <SectionCard id="titulo-temporada" title="Temporada">
          <LoadingRow label="Carregando a temporada..." />
        </SectionCard>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <SectionCard id="titulo-temporada" title="Temporada atual">
            <div className="flex flex-col gap-4 px-5 py-4">
              {!config.season || !phase ? (
                <EmptyState className="p-0" action={canEdit ? <Button variant="primary" size="sm" onClick={() => setDialog({ target: "current", season: null, version: config.version, idLocked: false })}>Cadastrar temporada</Button> : null}>
                  Nenhuma temporada cadastrada.
                </EmptyState>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="m-0 font-display text-xl font-semibold">{config.season.name}</h3>
                    <StatusChip status={phase} map={PHASE_STYLES} />
                  </div>
                  <DetailList>
                    <Detail term="Identificador">
                      <span className="font-mono text-[13px]">{config.season.id}</span>
                    </Detail>
                    <Detail term="Quando">{seasonDates(config.season, new Date(now))}</Detail>
                    <Detail term="Título do 1º lugar">{config.season.leaderTitle ?? <Missing>Sem título</Missing>}</Detail>
                    <Detail term="Tamanho do top">Top {config.season.topTarget}</Detail>
                    {config.season.endedEarly ? (
                      <Detail term="Encerrada antes da hora" wide>
                        {config.season.endedEarly.by ? `Por ${config.season.endedEarly.by}. ` : ""}
                        {config.season.endedEarly.plannedEndsAt ? `O fim era ${formatDateTime(config.season.endedEarly.plannedEndsAt)}.` : ""}
                      </Detail>
                    ) : null}
                  </DetailList>
                  {canRunClose(phase, config.season, now) ? (
                    <p className="m-0 text-[13px] text-fg/70">A virada roda sozinha a cada 10 minutos. Se ainda não rodou, isto faz o mesmo agora.</p>
                  ) : null}
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ target: "current", season: config.season, version: config.version, idLocked: phase !== "scheduled" })}>
                        Editar
                      </Button>
                      {phase === "active" ? (
                        <Button size="sm" variant="danger" onClick={askEnd}>
                          Encerrar temporada
                        </Button>
                      ) : null}
                      {canRunClose(phase, config.season, now) ? (
                        <Button size="sm" variant="primary" onClick={() => setClosing({ seasonId: config.season!.id, name: config.season!.name })}>
                          Rodar a virada agora
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </SectionCard>

          <SectionCard id="titulo-proxima" title="Próxima temporada">
            <div className="flex flex-col gap-4 px-5 py-4">
              {config.next ? (
                <>
                  <h3 className="m-0 font-display text-xl font-semibold">{config.next.name}</h3>
                  <DetailList>
                    <Detail term="Identificador">
                      <span className="font-mono text-[13px]">{config.next.id}</span>
                    </Detail>
                    <Detail term="Quando">{seasonDates(config.next, new Date(now))}</Detail>
                    <Detail term="Título do 1º lugar">{config.next.leaderTitle ?? <Missing>Sem título</Missing>}</Detail>
                    <Detail term="Tamanho do top">Top {config.next.topTarget}</Detail>
                  </DetailList>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ target: "next", season: config.next, version: config.version, idLocked: false })}>
                        Editar próxima
                      </Button>
                      <Button size="sm" variant="danger" onClick={askCancelNext}>
                        Cancelar próxima
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  className="p-0"
                  action={
                    canEdit && config.season ? (
                      <Button size="sm" variant="primary" onClick={() => setDialog({ target: "next", season: null, version: config.version, idLocked: false })}>
                        Agendar próxima
                      </Button>
                    ) : null
                  }
                >
                  {config.season ? "Nenhuma próxima temporada agendada. A virada promove a próxima na hora em que a atual fecha." : "Cadastre a temporada atual antes de agendar a próxima."}
                </EmptyState>
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Chaves diferentes: vizinhos com a mesma chave deixam o cartão antigo preso na página. */}
      <LiveRanking key={`ao-vivo-${reloadKey}`} member={member} />
      <PastSeasons key={`passadas-${reloadKey}`} member={member} now={now} />

      <SeasonDialog
        request={canEdit ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          show("success", message, dialog?.target === "next" ? "titulo-proxima" : "titulo-temporada");
          setDialog(null);
          refresh();
        }}
      />
      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          show("success", message, confirm?.focusId);
          setConfirm(null);
          refresh();
        }}
      />
      <CloseSeasonDialog
        target={canEdit ? closing : null}
        onClose={() => setClosing(null)}
        onDone={(message) => {
          setClosing(null);
          show("success", message, "titulo-temporada");
          refresh();
        }}
      />
    </>
  );
}

/** "Rodar a virada agora": chama o `closeSeasonNow` de novo enquanto ele responder `running`. */
function CloseSeasonDialog({
  target,
  onClose,
  onDone,
}: {
  target: { seasonId: string; name: string } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!target || running) return;
    setRunning(true);
    setError(null);
    try {
      for (;;) {
        const result = await closeSeasonNow(target.seasonId);
        setPage(result.pages);
        if (result.status === "closed") break;
      }
      setRunning(false);
      setPage(0);
      onDone("Temporada fechada.");
    } catch (failure) {
      setError(actionErrorMessage(failure));
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={Boolean(target)}
      onClose={() => !running && (setError(null), onClose())}
      busy={running}
      size="sm"
      title={target ? `Rodar a virada de ${target.name}?` : ""}
      description="A virada fecha o ranking, guarda o pódio e promove a próxima temporada, se houver. Pode levar alguns minutos."
    >
      <div className="flex flex-col gap-4">
        <p role="status" className="m-0 text-[13.5px] text-fg/80">
          {running ? `Fechando o ranking... página ${Math.max(1, page)}` : ""}
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={running} data-autofocus>
            Voltar
          </Button>
          <Button variant="primary" busy={running} onClick={() => void run()}>
            {running ? "Rodando a virada..." : "Rodar a virada agora"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const RANKING_GRID = "xl:grid xl:grid-cols-[64px_minmax(0,1.6fr)_minmax(0,1fr)_140px_170px] xl:items-center xl:gap-4";

function ChangeCell({ change }: { change: number }) {
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus;
  return (
    <span className={change > 0 ? "inline-flex items-center gap-1 text-cyan" : change < 0 ? "inline-flex items-center gap-1 text-danger" : "inline-flex items-center gap-1 text-fg/55"}>
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{changeText(change)}</span>
      <span aria-hidden="true" className="tabular-nums">
        {change === 0 ? "igual" : Math.abs(change)}
      </span>
    </span>
  );
}

function FanName({ uid, name, photoURL, linked }: { uid: string; name: string; photoURL: string | null; linked: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <FanAvatar name={name} photoURL={photoURL} size="sm" />
      {linked ? (
        <Link href={`/fas/${uid}`} className="relative z-10 truncate text-sm font-semibold text-fg underline-offset-2 hover:underline">
          {name}
        </Link>
      ) : (
        <span className="truncate text-sm font-semibold text-fg">{name}</span>
      )}
    </span>
  );
}

/** O ranking ao vivo (`getPanelRanking`), no geral ou de uma central, 20 por página. */
function LiveRanking({ member }: { member: StaffMember }) {
  const seesFans = canSeeSection(member, "fans");
  const [artistId, setArtistId] = useState("");
  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const [seasonLabel, setSeasonLabel] = useState<string | null>(null);
  const loadPage = useCallback(
    async (cursor: string | null) => {
      const page = await getPanelRanking({ artistId: artistId || null, cursor });
      setSeasonLabel(page.season ? `${page.season.name}${page.season.status === "ended" ? " (encerrada)" : ""}` : null);
      return { items: page.items, cursor: page.nextCursor, hasMore: Boolean(page.nextCursor) };
    },
    [artistId],
  );
  const list = usePagedList<RankingRow, string>(loadPage, (row) => row.userId, { one: "fã carregado", many: "fãs carregados" });
  const artists = names.state.status === "ready" ? names.state.data : null;
  const columns = useMemo<Column<RankingRow>[]>(
    () => [
      { key: "position", header: "Posição", cell: (row) => <span className="font-display text-[15px] font-semibold tabular-nums">{row.position}º</span> },
      { key: "fan", header: "Fã", cell: (row) => <FanName uid={row.userId} name={row.displayName ?? "Fã sem nome"} photoURL={row.photoURL} linked={seesFans} /> },
      { key: "city", header: "Cidade", cell: (row) => row.city ?? <Missing>Sem cidade</Missing> },
      { key: "points", header: "Pontos", align: "end", cell: (row) => <span className="font-semibold text-lime tabular-nums">{formatNumber(row.points)} pts</span> },
      { key: "change", header: "Na semana", align: "end", cell: (row) => <ChangeCell change={row.change} /> },
    ],
    [seesFans],
  );

  return (
    <SectionCard id="titulo-ranking-vivo" title="Ranking ao vivo" meta={seasonLabel ?? undefined}>
      <div className="border-b border-line px-5 py-4">
        <FilterSelect
          label="Recorte"
          value={artistId}
          onChange={setArtistId}
          options={[{ value: "", label: "Geral" }, ...(artists ? [...artists.values()].map((artist) => ({ value: artist.id, label: artist.name })) : [])]}
          className="max-w-xs"
        />
      </div>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-ranking-vivo" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando o ranking..." />
      ) : (
        <>
          <DataTable
            caption={artistId ? `Ranking de ${artistNameOf(artists, artistId)}` : "Ranking geral"}
            columns={columns}
            rows={list.state.data}
            rowKey={(row) => row.userId}
            grid={RANKING_GRID}
            focusRequest={list.focusRequest}
            empty={<EmptyState className="p-0">Ninguém pontuou nesta temporada.</EmptyState>}
          />
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}

const PAST_GRID = "xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_120px_130px] xl:items-center xl:gap-4";

/** As temporadas fechadas, com o pódio de cada uma no geral ou numa central. */
function PastSeasons({ member, now }: { member: StaffMember; now: number }) {
  const past = useLoad(getPastSeasons);
  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const [open, setOpen] = useState<string | null>(null);
  const artists = names.state.status === "ready" ? names.state.data : null;
  const columns: Column<PastSeason>[] = [
    {
      key: "name",
      header: "Temporada",
      cell: (season) => (
        <span className="flex flex-col">
          <span className="font-semibold text-fg">{season.name}</span>
          {season.endedEarly ? <span className="text-[12.5px] text-fg/60">Encerrada antes da hora</span> : null}
        </span>
      ),
    },
    { key: "when", header: "Quando", cell: (season) => seasonDates(season, new Date(now)) },
    { key: "fans", header: "No ranking", align: "end", cell: (season) => countLabel(season.rankedFans, "fã", "fãs") },
    {
      key: "podium",
      header: "",
      label: "",
      align: "end",
      cell: (season) => (
        <Button size="sm" variant="ghost" aria-expanded={open === season.id} aria-controls={`podio-${season.id}`} onClick={() => setOpen(open === season.id ? null : season.id)}>
          {open === season.id ? "Fechar pódio" : "Ver pódio"}
        </Button>
      ),
    },
  ];
  return (
    <SectionCard id="titulo-passadas" title="Temporadas passadas">
      {past.state.status === "error" ? (
        <LoadError message={past.state.message} headingId="titulo-passadas" onRetry={past.reload} />
      ) : past.state.status === "loading" ? (
        <LoadingRow label="Carregando as temporadas..." />
      ) : (
        <DataTable
          caption="Temporadas fechadas, da mais nova"
          columns={columns}
          rows={past.state.data}
          rowKey={(season) => season.id}
          grid={PAST_GRID}
          empty={<EmptyState className="p-0">Nenhuma temporada fechada ainda.</EmptyState>}
          rowNotice={(season) => (open === season.id ? <Podium season={season} artists={artists} linked={canSeeSection(member, "fans")} /> : null)}
        />
      )}
    </SectionCard>
  );
}

function Podium({ season, artists, linked }: { season: PastSeason; artists: ReadonlyMap<string, ArtistName> | null; linked: boolean }) {
  const [artistId, setArtistId] = useState("");
  const load = useCallback(() => getPodium(season.id, artistId || null), [season.id, artistId]);
  const podium = useLoad(load);
  return (
    <div id={`podio-${season.id}`} className="flex flex-col gap-3 rounded-[10px] border border-line bg-raised px-4 py-3">
      <FilterSelect
        label="Pódio de"
        value={artistId}
        onChange={setArtistId}
        options={[{ value: "", label: "Geral" }, ...season.centrals.map((id) => ({ value: id, label: artistNameOf(artists, id) }))]}
        className="max-w-xs"
      />
      {podium.state.status === "error" ? (
        <p className="m-0 text-[13px] text-danger">{podium.state.message}</p>
      ) : podium.state.status === "loading" ? (
        <p className="m-0 text-[13px] text-fg/60">Carregando o pódio...</p>
      ) : podium.state.data.length === 0 ? (
        <p className="m-0 text-[13px] text-fg/60">Ninguém pontuou neste recorte.</p>
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {podium.state.data.map((row: StandingRow) => (
            <li key={row.uid} className="flex items-center gap-3 text-[13.5px]">
              <span className="w-7 shrink-0 font-display font-semibold tabular-nums">{row.position}º</span>
              <FanName uid={row.uid} name={row.displayName ?? "Fã sem nome"} photoURL={row.photoURL} linked={linked} />
              <span className="ml-auto shrink-0 font-semibold text-lime tabular-nums">{formatNumber(row.points)} pts</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
