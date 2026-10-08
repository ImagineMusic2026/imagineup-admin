"use client";

import { Eye, EyeOff, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AuthorLine, QueueCard, shortWhen } from "@/components/moderacao/queue-card";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { LoadMore } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList, type PagedList } from "@/components/ui/use-paged-list";
import { getArtistNames, artistNameOf, type ArtistName } from "@/lib/artist-names-data";
import { getAuditPeople } from "@/lib/audit-data";
import { fanDisplayName, suspensionReasonLabel, type FanProfile } from "@/lib/fan-profile";
import type { PageCursor } from "@/lib/firestore-page";
import { moderateComment, setFanSuspended } from "@/lib/moderation-api";
import { HIDE_CONFIRM_TEXT, KEEP_CONFIRM_TEXT, QUEUE_EMPTY_TEXT, oldestText, queueCountText, type CommentInfo, type QueueItem } from "@/lib/moderation";
import { countOpenQueue, createContentReader, getHiddenCommentsPage, getQueuePage, getSuspendedPage, type ContentReader } from "@/lib/moderation-data";
import { canEditSection, canSeeSection, isAdmin, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("moderation");

type ModerationTab = "queue" | "resolved" | "hidden" | "suspended";
type Notify = (tone: "success" | "error" | "info", text: string, focusId?: string) => void;

/**
 * Moderação (`/moderacao`): a fila de comentários denunciados, os resolvidos,
 * os comentários ocultos e os fãs suspensos, em leitura única (25 por vez,
 * "Carregar mais" e o "Atualizar" que lê de novo do topo). Quem denunciou
 * nunca aparece.
 */
export function ModerationPage() {
  return <SectionGate section="moderation">{(member) => <ModerationContent member={member} />}</SectionGate>;
}

function ModerationContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "moderation");
  const [reader, setReader] = useState<ContentReader>(createContentReader);
  const [tab, setTab] = useState<ModerationTab>("queue");
  const [round, setRound] = useState(0);
  const [countRound, setCountRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [removed, setRemoved] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ key: number; tone: "success" | "error" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [afterConfirm, setAfterConfirm] = useState<(() => void) | null>(null);

  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const artistNames = names.state.status === "ready" ? names.state.data : null;
  const count = useLoad(
    useCallback(() => {
      void round;
      void countRound;
      return countOpenQueue();
    }, [round, countRound]),
  );
  const loadQueue = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getQueuePage("open", after);
    },
    [round],
  );
  const queue = usePagedList(loadQueue, (item: QueueItem) => item.commentId, { one: "item carregado", many: "itens carregados" });
  const queueItems = queue.state.status === "ready" ? queue.state.data.filter((item) => !removed.includes(item.commentId)) : [];
  const date = new Date(now);
  const oldest = queue.state.status === "ready" && !queue.hasMore ? oldestText(queueItems, date) : null;

  const [focusTarget, setFocusTarget] = useState<{ id: string; key: number } | null>(null);
  // Num efeito: roda depois de o diálogo que fechou devolver o foco, e o título do cartão fica com ele.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const show: Notify = (tone, text, focusId) => {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone, text }));
    if (focusId) setFocusTarget((current) => ({ id: focusId, key: (current?.key ?? 0) + 1 }));
  };

  function refresh() {
    setNow(Date.now());
    setReader(createContentReader());
    setRemoved([]);
    setRound((value) => value + 1);
  }

  function ask(request: ConfirmRequest, after: () => void) {
    setConfirm({ ...request, onUncertain: refresh });
    setAfterConfirm(() => after);
  }

  /** Ocultar ou manter um item da fila: sai da lista na hora, e a contagem é lida de novo. */
  function decide(item: QueueItem, action: "hide" | "keep") {
    ask(
      {
        title: action === "hide" ? "Ocultar o comentário?" : "Manter o comentário?",
        body: action === "hide" ? HIDE_CONFIRM_TEXT : KEEP_CONFIRM_TEXT,
        confirmLabel: action === "hide" ? "Ocultar" : "Manter",
        busyLabel: action === "hide" ? "Ocultando..." : "Mantendo...",
        cancelLabel: "Voltar",
        tone: action === "hide" ? "danger" : "default",
        action: () => moderateComment({ postId: item.postId, commentId: item.commentId, action }),
        successMessage: action === "hide" ? "Comentário ocultado e resolvido." : "Comentário mantido e resolvido.",
      },
      () => {
        reader.forget(item.postId, item.commentId);
        setRemoved((current) => [...current, item.commentId]);
        setCountRound((value) => value + 1);
      },
    );
  }

  const queueActions = (item: QueueItem, comment: CommentInfo | null): React.ReactNode =>
    canEdit && comment ? (
      <>
        <Button size="sm" variant="danger" onClick={() => decide(item, "hide")}>
          <EyeOff aria-hidden="true" className="size-4" />
          Ocultar<span className="sr-only"> o comentário de {comment.authorName}</span>
        </Button>
        {comment.status === "visible" ? (
          <Button size="sm" variant="secondary" onClick={() => decide(item, "keep")}>
            <ShieldCheck aria-hidden="true" className="size-4" />
            Manter<span className="sr-only"> o comentário de {comment.authorName}</span>
          </Button>
        ) : null}
      </>
    ) : null;

  const subtitle = count.state.status === "ready" ? `${queueCountText(count.state.data)}${oldest ? `, ${oldest}` : ""}.` : INFO.description;

  return (
    <>
      <PageHeader title={INFO.label} subtitle={subtitle} actions={<RefreshButton onClick={refresh} busy={queue.reloading} loadedAt={queue.loadedAt} />} />

      <div aria-live="polite" className="sr-only">
        {notice && notice.tone !== "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone={notice.tone} announce={notice.tone === "error"}>
          {notice.text}
        </Notice>
      ) : null}

      <Tabs
        label="Partes da Moderação"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: "queue",
            label: "Fila",
            render: () => (
              <QueueList
                id="titulo-fila"
                title="Fila"
                list={queue}
                items={queueItems}
                reader={reader}
                names={artistNames}
                now={date}
                empty={QUEUE_EMPTY_TEXT}
                actions={queueActions}
              />
            ),
          },
          { id: "resolved", label: "Resolvidos", render: () => <ResolvedTab canEdit={canEdit} reader={reader} names={artistNames} now={date} round={round} onNotice={show} ask={ask} /> },
          { id: "hidden", label: "Comentários ocultos", render: () => <HiddenTab member={member} canEdit={canEdit} names={artistNames} now={date} round={round} onNotice={show} ask={ask} /> },
          { id: "suspended", label: "Fãs suspensos", render: () => <SuspendedTab member={member} canEdit={canEdit} now={date} round={round} ask={ask} /> },
        ]}
      />

      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          afterConfirm?.();
          setAfterConfirm(null);
          show("success", message, { queue: "titulo-fila", resolved: "titulo-resolvidos", hidden: "titulo-ocultos", suspended: "titulo-suspensos" }[tab]);
        }}
      />
    </>
  );
}

function QueueList({
  id,
  title,
  list,
  items,
  reader,
  names,
  now,
  empty,
  actions,
  refreshKey = 0,
}: {
  id: string;
  title: string;
  list: PagedList<QueueItem>;
  items: QueueItem[];
  reader: ContentReader;
  names: ReadonlyMap<string, ArtistName> | null;
  now: Date;
  empty: string;
  actions?: (item: QueueItem, comment: CommentInfo | null) => React.ReactNode;
  refreshKey?: number;
}) {
  return (
    <SectionCard id={id} title={title}>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId={id} onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando..." />
      ) : items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {items.map((item) => (
              <li key={item.commentId}>
                <QueueCard item={item} reader={reader} names={names} now={now} refreshKey={refreshKey} actions={actions ? (comment) => actions(item, comment) : undefined} />
              </li>
            ))}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
      {list.refreshError ? (
        <div className="px-5 pb-4">
          <Notice tone="error">Não deu para atualizar: {list.refreshError}</Notice>
        </div>
      ) : null}
    </SectionCard>
  );
}

type Ask = (request: ConfirmRequest, after: () => void) => void;

function ResolvedTab({
  canEdit,
  reader,
  names,
  now,
  round,
  ask,
}: {
  canEdit: boolean;
  reader: ContentReader;
  names: ReadonlyMap<string, ArtistName> | null;
  now: Date;
  round: number;
  onNotice: Notify;
  ask: Ask;
}) {
  const [version, setVersion] = useState(0);
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getQueuePage("resolved", after);
    },
    [round],
  );
  const list = usePagedList(load, (item: QueueItem) => item.commentId, { one: "item carregado", many: "itens carregados" });
  const items = list.state.status === "ready" ? list.state.data : [];
  const actions = (item: QueueItem, comment: CommentInfo | null): React.ReactNode =>
    canEdit && comment?.status === "hidden" ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          ask(
            {
              title: "Reexibir o comentário?",
              body: "O comentário volta ao app para todos.",
              confirmLabel: "Reexibir",
              busyLabel: "Reexibindo...",
              cancelLabel: "Voltar",
              tone: "default",
              action: () => moderateComment({ postId: item.postId, commentId: item.commentId, action: "restore" }),
              successMessage: "Comentário de volta no app.",
            },
            () => {
              reader.forget(item.postId, item.commentId);
              setVersion((value) => value + 1);
              list.reload();
            },
          )
        }
      >
        <Eye aria-hidden="true" className="size-4" />
        Reexibir<span className="sr-only"> o comentário de {comment.authorName}</span>
      </Button>
    ) : null;
  return <QueueList id="titulo-resolvidos" title="Resolvidos" list={list} items={items} reader={reader} names={names} now={now} empty="Nenhum item resolvido ainda." actions={actions} refreshKey={version} />;
}

function HiddenTab({
  member,
  canEdit,
  names,
  now,
  round,
  ask,
}: {
  member: StaffMember;
  canEdit: boolean;
  names: ReadonlyMap<string, ArtistName> | null;
  now: Date;
  round: number;
  onNotice: Notify;
  ask: Ask;
}) {
  const listsStaff = isAdmin(member) || canSeeSection(member, "audit");
  const people = useLoad(useCallback(() => (listsStaff ? getAuditPeople() : Promise.resolve([])), [listsStaff]));
  const staffNames = new Map((people.state.status === "ready" ? people.state.data : []).map((person) => [person.uid, person.name]));
  const [gone, setGone] = useState<string[]>([]);
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getHiddenCommentsPage(after);
    },
    [round],
  );
  const list = usePagedList(load, (item: CommentInfo) => `${item.postId}/${item.commentId}`, { one: "comentário carregado", many: "comentários carregados" });
  const items = list.state.status === "ready" ? list.state.data.filter((item) => !gone.includes(`${item.postId}/${item.commentId}`)) : [];

  return (
    <SectionCard id="titulo-ocultos" title="Comentários ocultos">
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-ocultos" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os comentários ocultos..." />
      ) : items.length === 0 ? (
        <EmptyState>Nenhum comentário oculto.</EmptyState>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {items.map((item) => (
              <li key={`${item.postId}/${item.commentId}`} className="flex flex-col gap-3 px-5 py-4">
                <AuthorLine uid={item.authorUid} name={item.authorName} photoURL={item.authorPhotoURL} />
                <blockquote className="m-0 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px] leading-relaxed whitespace-pre-line text-fg/90">{item.text}</blockquote>
                <p className="m-0 text-[13px] text-fg/70">
                  Na central {artistNameOf(names, item.artistId ?? "")}. Oculto em {shortWhen(item.hiddenAt, now)}, por {item.hiddenBy ? (listsStaff ? (staffNames.get(item.hiddenBy) ?? "Equipe") : "Equipe") : "Equipe"}.
                </p>
                {canEdit ? (
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        ask(
                          {
                            title: "Reexibir o comentário?",
                            body: "O comentário volta ao app para todos.",
                            confirmLabel: "Reexibir",
                            busyLabel: "Reexibindo...",
                            cancelLabel: "Voltar",
                            tone: "default",
                            action: () => moderateComment({ postId: item.postId, commentId: item.commentId, action: "restore" }),
                            successMessage: "Comentário de volta no app.",
                          },
                          () => setGone((current) => [...current, `${item.postId}/${item.commentId}`]),
                        )
                      }
                    >
                      <Eye aria-hidden="true" className="size-4" />
                      Reexibir<span className="sr-only"> o comentário de {item.authorName}</span>
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}

function SuspendedTab({ member, canEdit, now, round, ask }: { member: StaffMember; canEdit: boolean; now: Date; round: number; ask: Ask }) {
  const [gone, setGone] = useState<string[]>([]);
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getSuspendedPage(after);
    },
    [round],
  );
  const list = usePagedList(load, (fan: FanProfile) => fan.uid, { one: "fã carregado", many: "fãs carregados" });
  const items = list.state.status === "ready" ? list.state.data.filter((fan) => !gone.includes(fan.uid)) : [];
  const seesFans = canSeeSection(member, "fans");

  return (
    <SectionCard id="titulo-suspensos" title="Fãs suspensos">
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-suspensos" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os fãs suspensos..." />
      ) : items.length === 0 ? (
        <EmptyState>Nenhum fã suspenso.</EmptyState>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {items.map((fan) => {
              const name = fanDisplayName(fan);
              return (
                <li key={fan.uid} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="flex min-w-0 items-center gap-3">
                    <FanAvatar name={name} photoURL={fan.photoURL} size="md" />
                    <span className="min-w-0">
                      <Link href={`/moderacao/fas/${fan.uid}`} className="block truncate text-sm font-semibold text-fg underline-offset-2 hover:underline">
                        {name}
                      </Link>
                      <span className="block text-[13px] text-fg/65">
                        {fan.username ? `@${fan.username} · ` : ""}desde {shortWhen(fan.suspendedAt, now)} · {suspensionReasonLabel(fan.suspensionReason)}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {seesFans ? (
                      <Link href={`/fas/${fan.uid}`} className="self-center text-[13px] text-fg/75 underline underline-offset-2 hover:text-fg">
                        Abrir a ficha<span className="sr-only"> de {name}</span>
                      </Link>
                    ) : null}
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          ask(
                            {
                              title: `Tirar a suspensão de ${name}?`,
                              body: "O fã volta a comentar, curtir, ganhar pontos e mudar o perfil.",
                              confirmLabel: "Tirar suspensão",
                              busyLabel: "Tirando...",
                              cancelLabel: "Voltar",
                              tone: "default",
                              action: () => setFanSuspended({ uid: fan.uid, suspended: false }),
                              successMessage: `Suspensão de ${name} tirada.`,
                            },
                            () => setGone((current) => [...current, fan.uid]),
                          )
                        }
                      >
                        <UserCheck aria-hidden="true" className="size-4" />
                        Tirar suspensão
                      </Button>
                    ) : null}
                  </span>
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
