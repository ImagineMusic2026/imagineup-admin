"use client";

import { useCallback, useState } from "react";

import { AuthorLine, shortWhen } from "@/components/moderacao/queue-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadMore } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { usePagedList } from "@/components/ui/use-paged-list";
import { actionErrorMessage } from "@/lib/errors";
import type { PageCursor } from "@/lib/firestore-page";
import { moderateComment } from "@/lib/moderation-api";
import type { CommentInfo } from "@/lib/moderation";
import { getPostCommentsPage } from "@/lib/post-data";
import { COUNTS_HINT, postExcerpt, type Post } from "@/lib/posts";

/**
 * Os comentários de um post (do mais novo, 20 por vez), com ocultar e
 * reexibir para quem edita a Moderação. O link do autor vai para a página
 * dele na Moderação só para quem vê a seção.
 */
export function PostCommentsDialog({ post, canModerate, seesModeration, onClose }: { post: Post | null; canModerate: boolean; seesModeration: boolean; onClose: () => void }) {
  return (
    <Dialog open={Boolean(post)} size="lg" onClose={onClose} title="Comentários do post" description={post ? `${postExcerpt(post.text, 90) || "Post sem texto"} ${COUNTS_HINT}` : undefined}>
      {post ? <CommentsList key={post.id} post={post} canModerate={canModerate} seesModeration={seesModeration} onClose={onClose} /> : null}
    </Dialog>
  );
}

function CommentsList({ post, canModerate, seesModeration, onClose }: { post: Post; canModerate: boolean; seesModeration: boolean; onClose: () => void }) {
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getPostCommentsPage(post.id, after);
    },
    [post.id, round],
  );
  const list = usePagedList(load, (item: CommentInfo) => item.commentId, { one: "comentário carregado", many: "comentários carregados" });
  const now = new Date();

  async function act(comment: CommentInfo, action: "hide" | "restore") {
    setBusy(comment.commentId);
    setMessage(null);
    try {
      await moderateComment({ postId: post.id, commentId: comment.commentId, action });
      setMessage({ tone: "success", text: action === "hide" ? "Comentário ocultado." : "Comentário de volta no app." });
      setRound((value) => value + 1);
    } catch (failure) {
      setMessage({ tone: "error", text: actionErrorMessage(failure) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {list.state.status === "error" ? (
        <Notice tone="error">{list.state.message}</Notice>
      ) : list.state.status === "loading" ? (
        <p role="status" className="m-0 text-sm text-fg/70">
          Carregando os comentários...
        </p>
      ) : list.state.data.length === 0 ? (
        <p className="m-0 text-sm text-fg/70">Nenhum comentário neste post.</p>
      ) : (
        <ul className="m-0 flex max-h-[55vh] list-none flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line p-0">
          {list.state.data.map((comment) => (
            <li key={comment.commentId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AuthorLine uid={comment.authorUid} name={comment.authorName} photoURL={comment.authorPhotoURL} linkToFan={seesModeration} />
                <span className="flex items-center gap-2">
                  {comment.status === "hidden" ? <Badge tone="danger">Oculto</Badge> : null}
                  <span className="text-[12.5px] text-fg/60">{shortWhen(comment.createdAt, now)}</span>
                </span>
              </div>
              <p className="m-0 text-[14px] leading-relaxed whitespace-pre-line text-fg/90">{comment.text}</p>
              {canModerate ? (
                <div>
                  {comment.status === "hidden" ? (
                    <Button size="sm" variant="secondary" busy={busy === comment.commentId} onClick={() => void act(comment, "restore")}>
                      Reexibir<span className="sr-only"> o comentário de {comment.authorName}</span>
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger" busy={busy === comment.commentId} onClick={() => void act(comment, "hide")}>
                      Ocultar<span className="sr-only"> o comentário de {comment.authorName}</span>
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {list.state.status === "ready" ? (
        <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
      ) : null}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose} data-autofocus>
          Fechar
        </Button>
      </div>
    </div>
  );
}
