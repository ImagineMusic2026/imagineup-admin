"use client";

import { ChevronDown, Eye, EyeOff, Pencil, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ArtistsNav } from "@/components/artistas/artists-nav";
import { useCentralParam } from "@/components/artistas/central-param";
import { EventDialog, type EventDialogRequest } from "@/components/artistas/event-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { DataTable, LoadMore, type Column } from "@/components/ui/data-table";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterSelect } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { StatusChip, type StatusStyle } from "@/components/ui/status-chip";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, getArtistNames, type ArtistName } from "@/lib/artist-names-data";
import { errorDetails, errorMessage, reasonOf } from "@/lib/errors";
import { deleteEvent, setEventStatus } from "@/lib/event-api";
import { countEventPosts, countUpcomingEvents, getEventDetail, getEventsPage, type EventFilters } from "@/lib/event-data";
import { EVENT_STATUS_LABELS, RSVPS_HIDDEN_TEXT, eventDeleteBlocked, eventWhenText, unpublishWarning, type AgendaEvent, type EventStatus } from "@/lib/events";
import type { PageCursor } from "@/lib/firestore-page";
import { countLabel } from "@/lib/format";
import { canEditSection, canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("artists");

const STATUS_STYLES: Record<EventStatus, StatusStyle> = {
  draft: { label: EVENT_STATUS_LABELS.draft, tone: "muted", dot: true },
  published: { label: EVENT_STATUS_LABELS.published, tone: "cyan", dot: true },
  unpublished: { label: EVENT_STATUS_LABELS.unpublished, tone: "danger", dot: true },
};

const GRID = "xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_104px_120px] xl:items-center xl:gap-4";

/** A Agenda (`/artistas/agenda`): os shows das centrais, com o filtro da central no endereço. */
export function AgendaPage() {
  return <SectionGate section="artists">{(member) => <AgendaContent member={member} />}</SectionGate>;
}

function ArtistList({ ids, names }: { ids: string[]; names: ReadonlyMap<string, ArtistName> | null }) {
  return (
    <span className="flex min-w-0 flex-col">
      {ids.map((id, index) => (
        <span key={id} className="truncate text-fg/85">
          {artistNameOf(names, id)}
          {index === 0 && ids.length > 1 ? <span className="text-[12px] text-fg/55"> (principal)</span> : null}
        </span>
      ))}
    </span>
  );
}

/** O detalhe da linha: posts ligados, confirmados (só com Fãs) e recompensas (só com Recompensas). */
function EventDetailPanel({ event, member }: { event: AgendaEvent; member: StaffMember }) {
  const fans = canSeeSection(member, "fans");
  const rewards = canSeeSection(member, "rewards");
  const detail = useLoad(useCallback(() => getEventDetail(event.id, { fans, rewards }), [event.id, fans, rewards]));
  if (detail.state.status === "loading") return <p className="m-0 text-[13px] text-fg/65">Carregando o detalhe...</p>;
  if (detail.state.status === "error") return <p className="m-0 text-[13px] text-danger">{detail.state.message}</p>;
  const data = detail.state.data;
  return (
    <DetailList>
      <Detail term="Posts ligados">
        {data.posts > 0 ? (
          <Link href={`/artistas/mural?central=${encodeURIComponent(event.artistIds[0] ?? "")}`} className="underline underline-offset-2">
            {countLabel(data.posts, "post", "posts")}
          </Link>
        ) : (
          "Nenhum"
        )}
      </Detail>
      <Detail term="Confirmados">{data.going === null ? <Missing>{RSVPS_HIDDEN_TEXT}</Missing> : countLabel(data.going, "fã vai", "fãs vão")}</Detail>
      {data.rewards ? (
        <Detail term="Recompensas ligadas" wide>
          {data.rewards.length === 0 ? (
            "Nenhuma"
          ) : (
            <Link href="/recompensas" className="underline underline-offset-2">
              {data.rewards.map((reward) => reward.title).join(", ")}
            </Link>
          )}
        </Detail>
      ) : null}
    </DetailList>
  );
}

function AgendaContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "artists");
  const [central, setCentral] = useCentralParam();
  const [when, setWhen] = useState<EventFilters["when"]>("upcoming");
  const [status, setStatus] = useState<EventStatus | "">("");
  const [round, setRound] = useState(0);
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<string[]>([]);
  const [dialog, setDialog] = useState<EventDialogRequest | null>(null);
  const [viewing, setViewing] = useState<AgendaEvent | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [rowNotice, setRowNotice] = useState<{ id: string; node: React.ReactNode; key: number } | null>(null);

  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const artists = names.state.status === "ready" ? names.state.data : null;
  const count = useLoad(
    useCallback(() => {
      void round;
      return countUpcomingEvents(now, central || null);
    }, [now, central, round]),
  );
  const loadPage = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getEventsPage({ when, artistId: central || null, status: when === "upcoming" ? status || null : null }, now, after);
    },
    [when, central, status, now, round],
  );
  const list = usePagedList(loadPage, (event: AgendaEvent) => event.id, { one: "show carregado", many: "shows carregados" });
  const events = list.state.status === "ready" ? list.state.data : [];
  const date = new Date(now);

  function changed(message: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
    setRound((value) => value + 1);
  }

  function showRow(id: string, node: React.ReactNode) {
    setRowNotice((current) => ({ id, node, key: (current?.key ?? 0) + 1 }));
  }

  async function askUnpublish(event: AgendaEvent) {
    let posts: number | null = null;
    try {
      posts = await countEventPosts(event.id);
    } catch {
      posts = null;
    }
    setConfirm({
      title: `Tirar ${event.title} do ar?`,
      body: `O show some da agenda do app. As presenças ficam guardadas. ${posts === null ? "Os posts de show perdem a linha do show." : unpublishWarning(posts)}`,
      confirmLabel: "Tirar do ar",
      busyLabel: "Tirando do ar...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => setEventStatus(event.id, "unpublished"),
      successMessage: `Show ${event.title} fora do ar.`,
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function askPublish(event: AgendaEvent) {
    setConfirm({
      title: `Publicar ${event.title}?`,
      body: "O show entra na agenda do app.",
      confirmLabel: "Publicar",
      busyLabel: "Publicando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => setEventStatus(event.id, "published"),
      successMessage: `Show ${event.title} no ar.`,
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function askDelete(event: AgendaEvent) {
    const blocked = eventDeleteBlocked(event);
    if (blocked) {
      showRow(event.id, blocked);
      return;
    }
    setConfirm({
      title: `Apagar ${event.title}?`,
      body: "O rascunho e a foto saem de vez. Isso não se desfaz.",
      confirmLabel: "Apagar",
      busyLabel: "Apagando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () =>
        deleteEvent(event.id).catch((failure: unknown) => {
          // Com post ou recompensa ligados, a linha mostra a lista com os links.
          const reason = reasonOf(failure);
          const details = errorDetails(failure);
          if (reason === "event-has-posts" || reason === "event-has-rewards") {
            const ids = (Array.isArray(details.postIds) ? details.postIds : Array.isArray(details.rewardIds) ? details.rewardIds : []).filter((id): id is string => typeof id === "string");
            showRow(
              event.id,
              <span>
                {errorMessage(failure)}{" "}
                {reason === "event-has-posts" ? (
                  <Link href={`/artistas/mural?central=${encodeURIComponent(event.artistIds[0] ?? "")}`} className="underline underline-offset-2">
                    Ver no mural ({countLabel(ids.length, "post", "posts")})
                  </Link>
                ) : (
                  <Link href="/recompensas" className="underline underline-offset-2">
                    Ver em Recompensas ({countLabel(ids.length, "recompensa", "recompensas")})
                  </Link>
                )}
              </span>,
            );
          }
          throw failure;
        }),
      successMessage: `Show ${event.title} apagado.`,
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function actionsOf(event: AgendaEvent): MenuAction[] {
    const items: MenuAction[] = [{ label: "Editar", icon: Pencil, onSelect: () => setDialog({ event, artistId: central }) }];
    if (event.status === "published") items.push({ label: "Tirar do ar", icon: EyeOff, onSelect: () => void askUnpublish(event), tone: "danger" });
    else items.push({ label: "Publicar", icon: Send, onSelect: () => askPublish(event) });
    items.push({ label: "Apagar", icon: Trash2, onSelect: () => askDelete(event), tone: "danger" });
    return items;
  }

  const columns: Column<AgendaEvent>[] = [
    { key: "when", header: "Quando", cell: (event) => <span className="text-fg/90">{eventWhenText(event, date)}</span> },
    {
      key: "title",
      header: "Show",
      cell: (event) => (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">{event.title}</span>
          {event.featured ? <Badge tone="neutral">Destaque</Badge> : null}
        </span>
      ),
    },
    { key: "artists", header: "Centrais", cell: (event) => <ArtistList ids={event.artistIds} names={artists} /> },
    { key: "city", header: "Cidade", cell: (event) => `${event.city}${event.state ? `, ${event.state}` : ""}` },
    { key: "venue", header: "Local", cell: (event) => event.venue ?? <Missing>Sem local</Missing> },
    { key: "status", header: "Situação", cell: (event) => <StatusChip status={event.status} map={STATUS_STYLES} /> },
    {
      key: "actions",
      header: "",
      label: "",
      align: "end",
      cell: (event) => {
        const expanded = open.includes(event.id);
        return (
          <span className="relative z-10 inline-flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              aria-label={`Detalhes de ${event.title}`}
              onClick={() => setOpen((current) => (expanded ? current.filter((id) => id !== event.id) : [...current, event.id]))}
            >
              <ChevronDown aria-hidden="true" className={expanded ? "size-4 rotate-180" : "size-4"} />
            </Button>
            {canEdit ? (
              <ActionsMenu label={`Ações de ${event.title}`} actions={actionsOf(event)} />
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setViewing(event)} aria-label={`Ver ${event.title}`}>
                <Eye aria-hidden="true" className="size-4" />
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  const artistOptions = artists ? [...artists.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) : [];
  const subtitle = count.state.status === "ready" ? `${countLabel(count.state.data, "show por vir", "shows por vir")}${central ? ` de ${artistNameOf(artists, central)}` : ""}.` : INFO.description;

  return (
    <>
      <PageHeader title={INFO.label} subtitle={subtitle} />
      <ArtistsNav current="agenda" central={central || null} />

      <div aria-live="polite" className="sr-only">
        {notice ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone="success" announce={false}>
          {notice.text}
        </Notice>
      ) : null}

      <SectionCard id="titulo-agenda" title="Agenda" meta={when === "upcoming" ? "Do mais perto" : "Do mais novo"}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          {canEdit ? (
            <div>
              <Button size="sm" variant="primary" onClick={() => setDialog({ event: null, artistId: central })}>
                <Plus aria-hidden="true" className="size-4" />
                Novo show
              </Button>
            </div>
          ) : null}
          <FilterBar
            label="Filtros da agenda"
            active={Boolean(central || status || when === "past")}
            onClear={() => {
              setCentral("");
              setStatus("");
              setWhen("upcoming");
            }}
          >
            <FilterSelect
              label="Quando"
              value={when}
              onChange={(value) => setWhen(value as EventFilters["when"])}
              options={[
                { value: "upcoming", label: "Próximos" },
                { value: "past", label: "Passados" },
              ]}
            />
            <FilterSelect label="Central" value={central} onChange={setCentral} options={[{ value: "", label: "Todas" }, ...artistOptions.map((artist) => ({ value: artist.id, label: artist.name }))]} />
            <FilterSelect
              label="Situação"
              value={when === "past" ? "" : status}
              disabled={when === "past"}
              hint={when === "past" ? "Nos passados, só o filtro da central." : null}
              onChange={(value) => setStatus(value as EventStatus | "")}
              options={[
                { value: "", label: "Todas" },
                { value: "published", label: "No ar" },
                { value: "draft", label: "Rascunhos" },
                { value: "unpublished", label: "Fora do ar" },
              ]}
            />
          </FilterBar>
        </div>
        {list.state.status === "error" ? (
          <LoadError message={list.state.message} headingId="titulo-agenda" onRetry={list.reload} />
        ) : list.state.status === "loading" ? (
          <LoadingRow label="Carregando os shows..." />
        ) : (
          <>
            <DataTable
              caption={when === "upcoming" ? "Shows por vir, do mais perto" : "Shows passados, do mais novo"}
              columns={columns}
              rows={events}
              rowKey={(event) => event.id}
              grid={GRID}
              focusRequest={list.focusRequest}
              rowNotice={(event) => (
                <>
                  {open.includes(event.id) ? (
                    <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                      <EventDetailPanel event={event} member={member} />
                    </div>
                  ) : null}
                  {rowNotice?.id === event.id ? (
                    <Notice key={rowNotice.key} tone="info" className="mt-2">
                      {rowNotice.node}
                    </Notice>
                  ) : null}
                </>
              )}
              empty={<EmptyState className="p-0">{when === "upcoming" ? "Nenhum show por vir." : "Nenhum show passado."}</EmptyState>}
            />
            <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
          </>
        )}
      </SectionCard>

      <EventDialog
        request={canEdit ? dialog : null}
        artists={artistOptions}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setDialog(null);
          changed(message);
        }}
      />
      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      <Dialog open={Boolean(viewing)} size="md" onClose={() => setViewing(null)} title={viewing?.title ?? ""} description={viewing ? eventWhenText(viewing, date) : undefined}>
        {viewing ? (
          <div className="flex flex-col gap-5">
            <DetailList>
              <Detail term="Centrais" wide>
                <ArtistList ids={viewing.artistIds} names={artists} />
              </Detail>
              <Detail term="Cidade">{`${viewing.city}, ${viewing.state}`}</Detail>
              <Detail term="Local">{viewing.venue ?? <Missing>Sem local</Missing>}</Detail>
              <Detail term="Situação">{EVENT_STATUS_LABELS[viewing.status]}</Detail>
              <Detail term="Destaque">{viewing.featured ? "Sim" : "Não"}</Detail>
            </DetailList>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setViewing(null)} data-autofocus>
                Fechar
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
