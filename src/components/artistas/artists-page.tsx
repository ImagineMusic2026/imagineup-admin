"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtistDialog, type ArtistDialogRequest, type ArtistSaved, type DraftCreated } from "@/components/artistas/artist-dialog";
import {
  AllArtistsSection,
  DRAFTS_HEADING_ID,
  DraftsSection,
  type ListNotice,
  type MoveDirection,
} from "@/components/artistas/artist-tables";
import { PageHeader } from "@/components/painel/page-header";
import { NoAccess } from "@/components/painel/placeholders";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { Notice } from "@/components/ui/notice";
import { useLiveList } from "@/components/ui/use-live-list";
import { deleteArtist, reorderArtists, setArtistStatus } from "@/lib/artist-api";
import { subscribeToArtists } from "@/lib/artist-data";
import {
  applyOrder,
  artistsSummary,
  countArtists,
  moveId,
  positionAnnouncement,
  sameIds,
  type ArtistEntry,
} from "@/lib/artists";
import { callableErrorMessage } from "@/lib/errors";
import { createLatestSender } from "@/lib/latest-sender";
import { canEditSection, canSeeSection, isAdmin, sectionInfo, type StaffMember } from "@/lib/staff";
import { useStaffMember } from "@/lib/staff-context";

const INFO = sectionInfo("artists");

/** /artistas: quem vê a seção. Editar é de admin e de editor com a seção. */
export function ArtistsPage() {
  const member = useStaffMember();
  if (!canSeeSection(member, "artists")) {
    return (
      <>
        <PageHeader title={INFO.label} />
        <NoAccess />
      </>
    );
  }
  return <ArtistsManager member={member} />;
}

/** Espera depois do último Subir/Descer antes de salvar: uma chamada (e uma auditoria) por sequência. */
const SAVE_ORDER_DELAY = 600;
/** Depois de salvar, a ordem local some quando a lista do servidor já chegou igual (ou depois disto). */
const SETTLE_ORDER_DELAY = 3000;

interface PendingOrder {
  ids: string[];
  saving: boolean;
}

interface OrderMove {
  id: string;
  direction: MoveDirection;
}

/**
 * Ordem de destaque com resposta na hora: Subir e Descer mudam a lista local,
 * anunciam a nova posição e salvam a lista completa (`reorderArtists`) um
 * pouco depois. Se o servidor recusar, volta a ordem dele e mostra o erro.
 *
 * Os envios vão um de cada vez e só o mais novo espera (`createLatestSender`):
 * um pedido antigo atrasado nunca chega ao servidor depois de um novo. Sair da
 * página durante a espera manda a ordem na hora, sem mexer mais na tela.
 */
function useArtistOrder(server: ArtistEntry[] | null, onStart: () => void, onError: (message: string, artistId: string) => void) {
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [focusTarget, setFocusTarget] = useState<(OrderMove & { key: number; onlyIfLost: boolean }) | null>(null);
  const [sender] = useState(() => createLatestSender<string[]>((ids) => reorderArtists(ids)));
  const version = useRef(0);
  const alive = useRef(true);
  const saveTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  /** Ordem esperando o fim do atraso. */
  const waiting = useRef<string[] | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        // Saiu da página no meio da espera: a ordem que a pessoa viu e ouviu ainda vai.
        if (waiting.current) void sender.send(waiting.current);
        waiting.current = null;
      }
    };
  }, [sender]);

  const artists = useMemo(() => {
    if (!server || !pending) return server;
    if (!pending.saving && sameIds(server.map((artist) => artist.id), pending.ids)) return server;
    return applyOrder(server, pending.ids);
  }, [server, pending]);

  // A linha muda de lugar no DOM e o botão pode perder o foco: ele volta para o
  // mesmo botão (ou para o outro, se este ficou desabilitado na ponta da lista).
  // Quando a ordem volta atrás por erro, só se o foco se perdeu ou ainda está
  // na linha (a pessoa pode já estar em outro lugar da página).
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget.onlyIfLost) {
      const active = document.activeElement;
      const inRow = active instanceof HTMLElement && Boolean(active.dataset.orderButton?.startsWith(`${focusTarget.id}:`));
      if (active && active !== document.body && !inRow) return;
    }
    const find = (direction: MoveDirection) =>
      document.querySelector<HTMLButtonElement>(`[data-order-button="${CSS.escape(`${focusTarget.id}:${direction}`)}"]`);
    const same = find(focusTarget.direction);
    const target = same && !same.disabled ? same : find(focusTarget.direction === "up" ? "down" : "up");
    if (target && document.activeElement !== target) target.focus();
  }, [focusTarget]);

  async function save(ids: string[], mine: number, moved: OrderMove) {
    const outcome = await sender.send(ids);
    if (!alive.current || mine !== version.current || outcome.status === "skipped") return;
    if (outcome.status === "failed") {
      setPending(null);
      setFocusTarget({ ...moved, key: -mine, onlyIfLost: true });
      onError(`A nova ordem não foi salva e voltou ao que era. ${callableErrorMessage(outcome.error)}`, moved.id);
      return;
    }
    setPending({ ids, saving: false });
    settleTimer.current = window.setTimeout(() => {
      setPending((current) => (current && !current.saving && sameIds(current.ids, ids) ? null : current));
    }, SETTLE_ORDER_DELAY);
  }

  function move(artist: ArtistEntry, direction: MoveDirection) {
    if (!artists) return;
    const next = moveId(
      artists.map((item) => item.id),
      artist.id,
      direction === "up" ? -1 : 1,
    );
    if (!next) return;
    version.current += 1;
    const mine = version.current;
    onStart();
    setPending({ ids: next, saving: true });
    setAnnouncement({ key: mine, text: positionAnnouncement(artist.name, next.indexOf(artist.id) + 1, next.length) });
    setFocusTarget({ id: artist.id, direction, key: mine, onlyIfLost: false });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    waiting.current = next;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      waiting.current = null;
      void save(next, mine, { id: artist.id, direction });
    }, SAVE_ORDER_DELAY);
  }

  return { artists, move, announcement };
}

type ListName = "drafts" | "all";

/** Onde o aviso de uma ação aparece: no topo da página, no topo de uma lista ou na linha da central. */
type NoticePlace = { list: "top" } | { list: ListName; artistId: string | null };

interface PageNotice {
  key: number;
  tone: ListNotice["tone"];
  text: string;
  place: NoticePlace;
}

function ArtistsManager({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "artists");
  const admin = isAdmin(member);
  const [state, retry] = useLiveList(subscribeToArtists);
  const [now] = useState(() => new Date());

  const [dialog, setDialog] = useState<{ request: ArtistDialogRequest; origin: "top" | ListName } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: string; key: number } | null>(null);
  const noticeKey = useRef(0);
  const draftCreated = useRef<DraftCreated | null>(null);
  const afterConfirm = useRef<{ focus: string | null; place: NoticePlace } | null>(null);

  const showNotice = useCallback((tone: PageNotice["tone"], text: string, place: NoticePlace) => {
    noticeKey.current += 1;
    setNotice({ key: noticeKey.current, tone, text, place });
  }, []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const onOrderError = useCallback(
    (message: string, artistId: string) => showNotice("error", message, { list: "all", artistId }),
    [showNotice],
  );

  const order = useArtistOrder(state.status === "ready" ? state.data : null, clearNotice, onOrderError);
  const artists = order.artists;
  const counts = artists ? countArtists(artists) : null;
  const drafts = useMemo(() => (artists ?? []).filter((artist) => artist.status === "draft"), [artists]);
  const listsShown = state.status === "ready" && Boolean(artists && counts);

  // O aviso aparece onde a ação aconteceu (quem clicou lá embaixo na lista vê
  // ali). Se a linha não está mais na lista, vai para o topo dela; sem as
  // listas na tela, para o topo da página.
  function listNotice(list: ListName): ListNotice | null {
    if (!notice || !listsShown) return null;
    const place = notice.place;
    if (place.list === "top" || place.list !== list) return null;
    const rows = list === "drafts" ? drafts : (artists ?? []);
    const artistId = place.artistId && rows.some((artist) => artist.id === place.artistId) ? place.artistId : null;
    return { key: notice.key, tone: notice.tone, text: notice.text, artistId };
  }
  const topNotice = notice && (notice.place.list === "top" || !listsShown) ? notice : null;

  // Foco para um título depois que a linha de onde a ação saiu deixa a lista
  // (roda depois de o diálogo devolver o foco a quem o abriu).
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.target)?.focus();
  }, [focusRequest]);

  function focusSoon(target: string) {
    setFocusRequest((current) => ({ target, key: (current?.key ?? 0) + 1 }));
  }

  function openCreate() {
    clearNotice();
    draftCreated.current = null;
    setDialog({ request: { mode: "create" }, origin: "top" });
  }

  function openEdit(artist: ArtistEntry, origin: ListName) {
    clearNotice();
    draftCreated.current = null;
    setDialog({ request: { mode: "edit", artist }, origin });
  }

  function openView(artist: ArtistEntry, origin: ListName) {
    clearNotice();
    setDialog({ request: { mode: "view", artist }, origin });
  }

  function closeDialog() {
    setDialog(null);
    const draft = draftCreated.current;
    draftCreated.current = null;
    if (!draft) return;
    // Criou o rascunho e um passo seguinte falhou: nada se perdeu, e a pessoa fica sabendo.
    // Se a resposta da criação se perdeu, a lista em tempo real diz se ela existe.
    if (draft.certain || (artists ?? []).some((artist) => artist.id === draft.handle)) {
      showNotice("success", `A central ${draft.name} ficou salva como rascunho.`, { list: "top" });
    } else {
      showNotice(
        "info",
        `Não deu para confirmar se a central ${draft.name} foi criada. Se ela aparecer na lista, ficou salva como rascunho.`,
        { list: "top" },
      );
    }
  }

  function dialogSaved(saved: ArtistSaved) {
    const opened = dialog;
    draftCreated.current = null;
    setDialog(null);
    if (!opened || opened.request.mode === "create" || opened.origin === "top") {
      showNotice("success", saved.message, { list: "top" });
      return;
    }
    if (saved.published && opened.origin === "drafts") {
      // A linha saiu dos rascunhos: o aviso fica no topo da lista e o foco vai para o título dela.
      showNotice("success", saved.message, { list: "drafts", artistId: null });
      focusSoon(DRAFTS_HEADING_ID);
      return;
    }
    // Continua na lista de onde o diálogo abriu (o foco volta para o Editar dela).
    showNotice("success", saved.message, { list: opened.origin, artistId: opened.request.artist.id });
  }

  async function publish(artist: ArtistEntry, list: ListName) {
    if (publishingId) return;
    clearNotice();
    setPublishingId(artist.id);
    try {
      await setArtistStatus(artist.id, "published");
      if (list === "drafts") {
        // A linha sai dos rascunhos: o foco vai para o título da lista.
        showNotice("success", `Central ${artist.name} publicada.`, { list: "drafts", artistId: null });
        focusSoon(DRAFTS_HEADING_ID);
      } else {
        showNotice("success", `Central ${artist.name} publicada.`, { list: "all", artistId: artist.id });
      }
    } catch (failure) {
      showNotice("error", `${artist.name} não foi publicada. ${callableErrorMessage(failure)}`, { list, artistId: artist.id });
    } finally {
      setPublishingId(null);
    }
  }

  function publishBlocked(artist: ArtistEntry, reason: string, list: ListName) {
    showNotice("info", `${reason} Complete em Editar.`, { list, artistId: artist.id });
  }

  function askUnpublish(artist: ArtistEntry) {
    clearNotice();
    afterConfirm.current = { focus: null, place: { list: "all", artistId: artist.id } };
    setConfirm({
      title: "Tirar do ar?",
      body: `${artist.name} some do app para os fãs na hora. Nada é apagado: a central continua aqui e volta ao ar quando você publicar de novo.`,
      confirmLabel: "Tirar do ar",
      busyLabel: "Tirando do ar...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => setArtistStatus(artist.id, "unpublished"),
      successMessage: `${artist.name} saiu do ar.`,
    });
  }

  function askDelete(artist: ArtistEntry) {
    clearNotice();
    afterConfirm.current = { focus: DRAFTS_HEADING_ID, place: { list: "drafts", artistId: null } };
    setConfirm({
      title: "Apagar rascunho?",
      body: `O rascunho de ${artist.name} é apagado com a foto e o contato, e o @${artist.handle} fica livre de novo. Não dá para desfazer.`,
      confirmLabel: "Apagar rascunho",
      busyLabel: "Apagando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => deleteArtist(artist.id),
      successMessage: `Rascunho de ${artist.name} apagado.`,
    });
  }

  // Quem só vê a seção só abre os detalhes; criar e editar somem se a permissão cair.
  const dialogRequest = dialog && (canEdit || dialog.request.mode === "view") ? dialog.request : null;

  return (
    <>
      <PageHeader title={INFO.label} subtitle={counts ? artistsSummary(counts) : INFO.description} />

      {/* Anúncios para leitor de tela em regiões que já existem; os avisos visíveis ficam onde a ação aconteceu. */}
      <div aria-live="polite" className="sr-only">
        {notice && notice.tone !== "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      <div role="alert" className="sr-only">
        {notice?.tone === "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>

      {topNotice ? (
        <Notice tone={topNotice.tone} announce={false}>
          {topNotice.text}
        </Notice>
      ) : null}

      {canEdit ? <CreateBanner onCreate={openCreate} /> : null}

      {state.status !== "ready" || !artists || !counts ? (
        <SectionCard id="titulo-centrais" title="Centrais">
          {state.status === "error" ? (
            <LoadError message={state.message} headingId="titulo-centrais" onRetry={retry} />
          ) : (
            <LoadingRow label="Carregando as centrais..." />
          )}
        </SectionCard>
      ) : (
        <>
          <dl className="m-0 grid gap-3 sm:grid-cols-2">
            <Kpi label="Centrais no ar" value={counts.published} />
            <Kpi label="Aguardando publicação" value={counts.drafts} accent />
          </dl>

          <DraftsSection
            drafts={drafts}
            now={now}
            canEdit={canEdit}
            canDelete={admin}
            publishingId={publishingId}
            notice={listNotice("drafts")}
            onEdit={(artist) => openEdit(artist, "drafts")}
            onView={(artist) => openView(artist, "drafts")}
            onPublish={(artist) => void publish(artist, "drafts")}
            onBlocked={(artist, reason) => publishBlocked(artist, reason, "drafts")}
            onDelete={askDelete}
          />

          <AllArtistsSection
            artists={artists}
            canEdit={canEdit}
            canCreate={canEdit}
            publishingId={publishingId}
            announcement={order.announcement}
            notice={listNotice("all")}
            onMove={order.move}
            onEdit={(artist) => openEdit(artist, "all")}
            onView={(artist) => openView(artist, "all")}
            onPublish={(artist) => void publish(artist, "all")}
            onBlocked={(artist, reason) => publishBlocked(artist, reason, "all")}
            onUnpublish={askUnpublish}
          />
        </>
      )}

      <ArtistDialog
        request={dialogRequest}
        member={member}
        onClose={closeDialog}
        onSaved={dialogSaved}
        onDraftCreated={(draft) => {
          draftCreated.current = draft;
        }}
      />

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          const after = afterConfirm.current;
          afterConfirm.current = null;
          showNotice("success", message, after?.place ?? { list: "top" });
          if (after?.focus) focusSoon(after.focus);
        }}
      />
    </>
  );
}

function Kpi({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
      <dt className="group-label text-fg/55">{label}</dt>
      <dd className={`m-0 mt-2.5 font-display text-[28px] leading-none font-semibold tabular-nums ${accent ? "text-cyan" : "text-fg"}`}>
        {value}
      </dd>
    </div>
  );
}

/** Faixa do topo, só para quem pode criar. */
function CreateBanner({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-labelledby="titulo-faixa-centrais"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-pink/30 bg-[linear-gradient(90deg,rgb(255_45_111/0.16),rgb(255_45_111/0.05)_55%,rgb(255_45_111/0.02))] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {/* As três barras inclinadas do design, só enfeite. */}
        <span aria-hidden="true" className="mt-1 flex shrink-0 gap-[3px]">
          <span className="h-5 w-[5px] -skew-x-[20deg] rounded-[1px] bg-pink" />
          <span className="h-5 w-[5px] -skew-x-[20deg] rounded-[1px] bg-pink/75" />
          <span className="h-5 w-[5px] -skew-x-[20deg] rounded-[1px] bg-pink/50" />
        </span>
        <div className="min-w-0">
          <h2 id="titulo-faixa-centrais" className="m-0 font-display text-base font-semibold">
            Centrais dos artistas
          </h2>
          <p className="mt-1 mb-0 text-[13.5px] leading-relaxed text-fg/70">
            Cada artista tem uma central no app, com selo, página e ranking de fãs. Só a equipe da Imagine cria.
          </p>
        </div>
      </div>
      <Button variant="primary" onClick={onCreate} aria-haspopup="dialog">
        <Plus aria-hidden="true" className="size-4" />
        Criar central
      </Button>
    </section>
  );
}
