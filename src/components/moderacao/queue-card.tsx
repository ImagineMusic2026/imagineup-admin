"use client";

import Link from "next/link";
import { useCallback } from "react";

import { FanAvatar } from "@/components/painel/fan-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLoad } from "@/components/ui/use-load";
import { artistNameOf, type ArtistName } from "@/lib/artist-names-data";
import { formatDay, formatRelative, formatTime } from "@/lib/format";
import { AUTHOR_DELETED_TEXT, RESOLUTION_LABELS, reasonsSpoken, reasonsText, type CommentInfo, type QueueItem } from "@/lib/moderation";
import type { ContentReader } from "@/lib/moderation-data";

export function shortWhen(date: Date | null, now: Date): string {
  return date ? `${formatDay(date, now)}, ${formatTime(date)}` : "sem data";
}

/** O autor: avatar, nome e o link para a página dele na Moderação. */
export function AuthorLine({ uid, name, photoURL, linkToFan = true }: { uid: string | null; name: string; photoURL: string | null; linkToFan?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <FanAvatar name={name} photoURL={photoURL} size="sm" />
      <span className="min-w-0 truncate text-sm font-semibold text-fg">{name}</span>
      {uid && linkToFan ? (
        <Link href={`/moderacao/fas/${uid}`} className="shrink-0 text-[13px] text-fg/75 underline underline-offset-2 hover:text-fg">
          Ver fã<span className="sr-only">: {name}</span>
        </Link>
      ) : null}
    </span>
  );
}

/**
 * Um item da fila: o comentário (ou que o autor excluiu a conta), o autor, o
 * post, as denúncias por motivo e as datas; na fila, as ações; nos
 * resolvidos, a decisão. O comentário e o post vêm do leitor da tela.
 */
export function QueueCard({
  item,
  reader,
  names,
  now,
  headingLevel = 3,
  linkToFan = true,
  refreshKey = 0,
  actions,
}: {
  item: QueueItem;
  reader: ContentReader;
  names: ReadonlyMap<string, ArtistName> | null;
  now: Date;
  headingLevel?: 3 | 4;
  linkToFan?: boolean;
  /** Muda depois de uma ação: o comentário é lido de novo. */
  refreshKey?: number;
  /** As ações do item, com o comentário lido (`null` quando ele não existe mais). */
  actions?: (comment: CommentInfo | null) => React.ReactNode;
}) {
  const content = useLoad(
    useCallback(() => {
      void refreshKey;
      return Promise.all([reader.comment(item.postId, item.commentId), reader.post(item.postId)]);
    }, [reader, item.postId, item.commentId, refreshKey]),
  );
  const [comment, post] = content.state.status === "ready" ? content.state.data : [null, null];
  const loading = content.state.status === "loading";
  const deleted = item.commentText === null || (content.state.status === "ready" && !comment);
  const author = comment?.authorName ?? (deleted ? "Conta excluída" : "Carregando...");
  const Heading = headingLevel === 3 ? "h3" : "h4";

  return (
    <article className="flex flex-col gap-3 px-5 py-4">
      <Heading className="sr-only">Comentário de {author}</Heading>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AuthorLine uid={deleted ? null : item.authorUid} name={author} photoURL={comment?.authorPhotoURL ?? null} linkToFan={linkToFan} />
        <span className="flex flex-wrap items-center gap-1.5">
          {comment?.status === "hidden" ? <Badge tone="danger">Oculto</Badge> : null}
          {item.status === "resolved" && item.resolution ? <Badge tone="neutral">{RESOLUTION_LABELS[item.resolution]}</Badge> : null}
        </span>
      </div>
      <blockquote className="m-0 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px] leading-relaxed text-fg/90">
        {deleted ? <span className="text-fg/60">{AUTHOR_DELETED_TEXT}</span> : <span className="whitespace-pre-line">{comment?.text ?? item.commentText}</span>}
      </blockquote>
      <dl className="m-0 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Post:</dt>
          <dd className="m-0 min-w-0 truncate text-fg/85">
            {loading ? "Carregando..." : post ? `${post.snippet ?? "Post sem texto"} · ${artistNameOf(names, post.artistId ?? item.artistId ?? "")}` : "Post apagado"}
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Denúncias:</dt>
          <dd className="m-0 text-fg/85">
            <span aria-hidden="true">{reasonsText(item.reasons)}</span>
            <span className="sr-only">{reasonsSpoken(item.reasons)}</span>
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Primeira:</dt>
          <dd className="m-0 text-fg/85">{shortWhen(item.firstReportedAt, now)}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-fg/55">Última:</dt>
          <dd className="m-0 text-fg/85">{item.lastReportedAt ? formatRelative(item.lastReportedAt, now) : "sem data"}</dd>
        </div>
        {item.status === "resolved" ? (
          <div className="flex min-w-0 gap-1.5 sm:col-span-2">
            <dt className="shrink-0 text-fg/55">Decisão:</dt>
            <dd className="m-0 text-fg/85">
              {item.resolution ? RESOLUTION_LABELS[item.resolution] : "Resolvido"}, {item.resolvedBy ? `por ${item.resolvedBy}` : "automático"}, {shortWhen(item.resolvedAt, now)}
            </dd>
          </div>
        ) : null}
      </dl>
      {content.state.status === "error" ? (
        <p className="m-0 text-[13px] text-danger">
          O comentário não carregou: {content.state.message}{" "}
          <Button size="sm" variant="ghost" onClick={content.reload}>
            Tentar de novo
          </Button>
        </p>
      ) : null}
      {actions && content.state.status === "ready" ? <div className="flex flex-wrap gap-2">{actions(comment)}</div> : null}
    </article>
  );
}
