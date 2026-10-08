"use client";

import { CalendarDays, Eye, EyeOff, Heart, ImageOff, MessageCircle, MessagesSquare, Pencil, Plus, Send, Trash2, Type } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

import { ArtistsNav } from "@/components/artistas/artists-nav";
import { useCentralParam } from "@/components/artistas/central-param";
import { PostCommentsDialog } from "@/components/artistas/post-comments-dialog";
import { PostDialog, type PostDialogRequest } from "@/components/artistas/post-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
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
import { artistNameOf, getArtistNames } from "@/lib/artist-names-data";
import { eventWhenText } from "@/lib/events";
import type { PageCursor } from "@/lib/firestore-page";
import { countLabel, formatDay, formatNumber } from "@/lib/format";
import { deletePost, setPostStatus } from "@/lib/post-api";
import { countPublishedPosts, getEventsById, getPostsPage } from "@/lib/post-data";
import { COUNTS_HINT, POST_KIND_LABELS, POST_STATUS_LABELS, postDeleteBlocked, postExcerpt, type Post, type PostStatus } from "@/lib/posts";
import { canEditSection, canSeeSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("artists");

const STATUS_STYLES: Record<PostStatus, StatusStyle> = {
  draft: { label: POST_STATUS_LABELS.draft, tone: "muted", dot: true },
  published: { label: POST_STATUS_LABELS.published, tone: "cyan", dot: true },
  unpublished: { label: POST_STATUS_LABELS.unpublished, tone: "danger", dot: true },
};

const GRID = "xl:grid xl:grid-cols-[64px_minmax(0,2fr)_minmax(0,0.9fr)_70px_104px_92px_120px_44px] xl:items-center xl:gap-4";

function MediaThumb({ post }: { post: Post }) {
  const thumb = post.media?.thumb?.url || post.media?.photo?.url;
  const Icon = post.kind === "event" ? CalendarDays : post.kind === "text" ? Type : ImageOff;
  return (
    <span className="relative block size-14 shrink-0 overflow-hidden rounded-md border border-line bg-sunken">
      {thumb ? (
        <Image src={thumb} alt="" fill sizes="56px" unoptimized className="object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-fg/45">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
    </span>
  );
}

/** O Mural (`/artistas/mural`): os posts das centrais, com o filtro da central no endereço. */
export function MuralPage() {
  return <SectionGate section="artists">{(member) => <MuralContent member={member} />}</SectionGate>;
}

function MuralContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "artists");
  const canModerate = canEditSection(member, "moderation");
  const seesModeration = canSeeSection(member, "moderation");
  const [central, setCentral] = useCentralParam();
  const [status, setStatus] = useState<PostStatus | "">("");
  const [round, setRound] = useState(0);
  const [now] = useState(() => Date.now());
  const [dialog, setDialog] = useState<PostDialogRequest | null>(null);
  const [comments, setComments] = useState<Post | null>(null);
  const [viewing, setViewing] = useState<Post | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [notice, setNotice] = useState<{ key: number; tone: "success" | "error" | "info"; text: string } | null>(null);
  const [rowNotice, setRowNotice] = useState<{ id: string; text: string; key: number } | null>(null);

  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const artists = names.state.status === "ready" ? names.state.data : null;
  const count = useLoad(
    useCallback(() => {
      void round;
      return countPublishedPosts(central || null);
    }, [central, round]),
  );
  const loadPage = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getPostsPage({ artistId: central || null, status: status || null }, after);
    },
    [central, status, round],
  );
  const list = usePagedList(loadPage, (post: Post) => post.id, { one: "post carregado", many: "posts carregados" });
  const posts = list.state.status === "ready" ? list.state.data : [];
  const eventKey = [...new Set(posts.map((post) => post.eventId).filter((id): id is string => Boolean(id)))].sort().join("|");
  const events = useLoad(useCallback(() => getEventsById(eventKey ? eventKey.split("|") : []), [eventKey]));
  const eventMap = events.state.status === "ready" ? events.state.data : null;
  const date = new Date(now);

  function changed(message: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone: "success", text: message }));
    setRound((value) => value + 1);
  }

  function askStatus(post: Post, next: "published" | "unpublished") {
    setConfirm({
      title: next === "published" ? "Publicar o post?" : "Tirar o post do ar?",
      body: next === "published" ? "O post entra no mural da central no app." : "O post some do app na hora. Curtidas e comentários ficam guardados.",
      confirmLabel: next === "published" ? "Publicar" : "Tirar do ar",
      busyLabel: next === "published" ? "Publicando..." : "Tirando do ar...",
      cancelLabel: "Voltar",
      tone: next === "published" ? "default" : "danger",
      action: () => setPostStatus(post.id, next),
      successMessage: next === "published" ? "Post publicado." : "Post fora do ar.",
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function askDelete(post: Post) {
    const blocked = postDeleteBlocked(post);
    if (blocked) {
      setRowNotice((current) => ({ id: post.id, text: blocked, key: (current?.key ?? 0) + 1 }));
      return;
    }
    setConfirm({
      title: "Apagar o rascunho?",
      body: "O post e a mídia saem de vez. Isso não se desfaz.",
      confirmLabel: "Apagar",
      busyLabel: "Apagando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => deletePost(post.id),
      successMessage: "Rascunho apagado.",
      onUncertain: () => setRound((value) => value + 1),
    });
  }

  function actionsOf(post: Post): MenuAction[] {
    const items: MenuAction[] = [
      { label: "Editar", icon: Pencil, onSelect: () => setDialog({ post, artistId: post.artistId }) },
      { label: "Comentários", icon: MessagesSquare, onSelect: () => setComments(post) },
    ];
    if (post.status !== "published") items.push({ label: "Publicar", icon: Send, onSelect: () => askStatus(post, "published") });
    else items.push({ label: "Tirar do ar", icon: EyeOff, onSelect: () => askStatus(post, "unpublished"), tone: "danger" });
    items.push({ label: "Apagar", icon: Trash2, onSelect: () => askDelete(post), tone: "danger" });
    return items;
  }

  const columns: Column<Post>[] = [
    { key: "media", header: "Mídia", label: "", cell: (post) => <MediaThumb post={post} /> },
    {
      key: "text",
      header: "Texto",
      cell: (post) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="line-clamp-2 text-[13.5px] text-fg/90">{postExcerpt(post.text) || <Missing>Sem texto</Missing>}</span>
          {post.kind === "event" && post.eventId ? (
            <span className="text-[12px] text-fg/60">
              Show: {eventMap ? (eventMap.get(post.eventId) ? `${eventMap.get(post.eventId)!.title}, ${eventWhenText(eventMap.get(post.eventId)!, date)}` : "show apagado") : "..."}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "central", header: "Central", cell: (post) => artistNameOf(artists, post.artistId) },
    { key: "kind", header: "Tipo", cell: (post) => POST_KIND_LABELS[post.kind] },
    { key: "status", header: "Situação", cell: (post) => <StatusChip status={post.status} map={STATUS_STYLES} /> },
    { key: "published", header: "Publicado", cell: (post) => (post.publishedAt ? formatDay(post.publishedAt, date) : <Missing>Nunca</Missing>) },
    {
      key: "counts",
      header: "Curtidas e coment.",
      label: "Curtidas e comentários",
      cell: (post) => (
        <span className="inline-flex items-center gap-3 tabular-nums" title={COUNTS_HINT}>
          <span className="inline-flex items-center gap-1">
            <Heart aria-hidden="true" className="size-3.5 text-fg/55" />
            <span className="sr-only">Curtidas: </span>
            {formatNumber(post.likeCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle aria-hidden="true" className="size-3.5 text-fg/55" />
            <span className="sr-only">Comentários: </span>
            {formatNumber(post.commentCount)}
          </span>
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      label: "",
      align: "end",
      cell: (post) =>
        canEdit ? (
          <ActionsMenu label={`Ações do post ${postExcerpt(post.text, 40) || POST_KIND_LABELS[post.kind]}`} actions={actionsOf(post)} />
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setViewing(post)} aria-label={`Ver o post ${postExcerpt(post.text, 40)}`}>
            <Eye aria-hidden="true" className="size-4" />
          </Button>
        ),
    },
  ];

  const artistOptions = artists ? [...artists.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) : [];
  const subtitle = count.state.status === "ready" ? `${countLabel(count.state.data, "post no ar", "posts no ar")}${central ? ` de ${artistNameOf(artists, central)}` : ""}.` : INFO.description;

  return (
    <>
      <PageHeader title={INFO.label} subtitle={subtitle} />
      <ArtistsNav current="mural" central={central || null} />

      <div aria-live="polite" className="sr-only">
        {notice ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone={notice.tone} announce={false}>
          {notice.text}
        </Notice>
      ) : null}

      <SectionCard id="titulo-mural" title="Mural" meta={COUNTS_HINT}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          {canEdit ? (
            <div>
              <Button size="sm" variant="primary" onClick={() => setDialog({ post: null, artistId: central })}>
                <Plus aria-hidden="true" className="size-4" />
                Novo post
              </Button>
            </div>
          ) : null}
          <FilterBar
            label="Filtros do mural"
            active={Boolean(central || status)}
            onClear={() => {
              setCentral("");
              setStatus("");
            }}
          >
            <FilterSelect label="Central" value={central} onChange={setCentral} options={[{ value: "", label: "Todas" }, ...artistOptions.map((artist) => ({ value: artist.id, label: artist.name }))]} />
            <FilterSelect
              label="Situação"
              value={status}
              onChange={(value) => setStatus(value as PostStatus | "")}
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
          <LoadError message={list.state.message} headingId="titulo-mural" onRetry={list.reload} />
        ) : list.state.status === "loading" ? (
          <LoadingRow label="Carregando os posts..." />
        ) : (
          <>
            <DataTable
              caption="Posts do mural, do mais novo"
              columns={columns}
              rows={posts}
              rowKey={(post) => post.id}
              grid={GRID}
              focusRequest={list.focusRequest}
              rowNotice={(post) =>
                rowNotice?.id === post.id ? (
                  <Notice key={rowNotice.key} tone="info">
                    {rowNotice.text}
                  </Notice>
                ) : null
              }
              empty={<EmptyState className="p-0">{central ? "Nenhum post desta central ainda." : "Nenhum post ainda."}</EmptyState>}
            />
            <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
          </>
        )}
      </SectionCard>

      <PostDialog
        request={canEdit ? dialog : null}
        artists={artistOptions}
        events={eventMap}
        now={now}
        onClose={() => setDialog(null)}
        onSaved={(message) => {
          setDialog(null);
          changed(message);
        }}
      />
      <PostCommentsDialog post={comments} canModerate={canModerate} seesModeration={seesModeration} onClose={() => setComments(null)} />
      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      <Dialog open={Boolean(viewing)} size="md" onClose={() => setViewing(null)} title="Post" description={viewing ? `${POST_KIND_LABELS[viewing.kind]} de ${artistNameOf(artists, viewing.artistId)}` : undefined}>
        {viewing ? (
          <div className="flex flex-col gap-5">
            <DetailList>
              <Detail term="Texto" wide>
                {viewing.text ? <span className="whitespace-pre-line">{viewing.text}</span> : <Missing>Sem texto</Missing>}
              </Detail>
              <Detail term="Situação">{POST_STATUS_LABELS[viewing.status]}</Detail>
              <Detail term="Publicado">{viewing.publishedAt ? formatDay(viewing.publishedAt, date) : <Missing>Nunca</Missing>}</Detail>
              <Detail term="Curtidas">{formatNumber(viewing.likeCount)}</Detail>
              <Detail term="Comentários">{formatNumber(viewing.commentCount)}</Detail>
            </DetailList>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setComments(viewing);
                  setViewing(null);
                }}
              >
                Ver comentários
              </Button>
              <Button variant="ghost" onClick={() => setViewing(null)} data-autofocus>
                Fechar
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
