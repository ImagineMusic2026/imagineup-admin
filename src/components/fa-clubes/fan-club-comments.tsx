"use client";

import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { PersonCell, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { useClubs, useQueueDecisions } from "@/components/fa-clubes/fan-club-queues";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { LoadMore } from "@/components/ui/data-table";
import { Missing } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChips } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { UNCERTAIN_RETRY_TEXT } from "@/lib/errors";
import { decideFanClubComment } from "@/lib/fan-club-api";
import { countManagerHides, getCommentQueuePage, getCommentsByIds, getHideLogPage, getPostCommentsPage, getPostsByIds } from "@/lib/fan-club-data";
import {
  COMMENT_CLOSED_REASONS,
  COMMENT_RESOLUTION_LABELS,
  COMMENT_SELF_TEXT,
  FAN_CLUB_AUDIT_TEXT,
  HIDE_LOG_ACTION_LABELS,
  POST_STATUS_LABELS,
  REPORT_FILTER_LABELS,
  REPORT_STATUSES,
  blocksCommentRetry,
  commentAuthorLabel,
  commentCountText,
  commentDecisionLabel,
  commentDecisionText,
  commentDecisions,
  commentDoneText,
  commentItemDecisions,
  commentItemMarks,
  commentMarks,
  commentReasonsText,
  commentStatusText,
  decidedByTeam,
  fanClubLabel,
  hideLogRestorable,
  isCommentSelf,
  isManagerComment,
  managerHidesText,
  openCommentItemsText,
  ownerLabel,
  type CommentDecision,
  type CommentResolution,
  type CommentStatus,
  type FanClub,
  type FanClubComment,
  type FanClubCommentItem,
  type FanClubPost,
  type HideLogEntry,
  type ItemCommentState,
  type ReportStatus,
} from "@/lib/fan-clubs";
import type { PageCursor } from "@/lib/firestore-page";
import { formatNumber } from "@/lib/format";
import { postExcerpt } from "@/lib/posts";
import { canEditSection, canSeeSection, type StaffMember } from "@/lib/staff";

/**
 * A Fase 2 do fã-clube no painel (seção 37, 37.10): a aba Comentários, com a
 * fila das denúncias e dos pedidos de revisão; o diálogo com os comentários
 * de uma publicação, na ficha; e o registro do ocultar do gestor. Toda
 * decisão vai pela `decideFanClub` com o assunto `comment` e o status que a
 * tela mostrou. O texto do comentário é do fã: fica só na tela, nunca nos
 * Logs. Quem reagiu e quem denunciou nunca aparecem.
 */

/** O trecho com o ponto final, sem dobrar a pontuação que ele já tem ("Irará?", "Bora…"). */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

const BUSY_LABELS: Record<CommentDecision, string> = { keep: "Mantendo...", hide: "Ocultando...", restore: "Reexibindo..." };

const RESOLUTION_TONES: Record<CommentResolution, "neutral" | "danger" | "cyan" | "muted"> = {
  kept: "neutral",
  hidden: "danger",
  restored: "cyan",
  withdrawn: "muted",
  author_deleted: "muted",
  removed: "muted",
};

/**
 * O autor do comentário, das cópias do documento (o `syncFanProfile` as
 * mantém em dia), com a marca "Gestor" (o autor é o gestor do fã-clube,
 * calculado na leitura) e "Resposta", e os atalhos para quem tem as seções.
 */
function CommentAuthor({ comment, ownerUid, seesFans, seesModeration }: { comment: FanClubComment; ownerUid: string | null | undefined; seesFans: boolean; seesModeration: boolean }) {
  const name = commentAuthorLabel(comment);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <PersonCell name={name} username={comment.authorUsername} photoURL={comment.authorPhotoURL} />
      {isManagerComment(comment, ownerUid) || comment.replyToId ? (
        <span className="flex flex-wrap gap-1.5">
          {isManagerComment(comment, ownerUid) ? <Badge tone="pink">Gestor</Badge> : null}
          {comment.replyToId ? <Badge tone="muted">Resposta</Badge> : null}
        </span>
      ) : null}
      {comment.authorUid && (seesFans || seesModeration) ? (
        <span className="flex flex-wrap gap-x-3 text-[12.5px]">
          {seesFans ? (
            <Link href={`/fas/${encodeURIComponent(comment.authorUid)}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
              Ficha<span className="sr-only"> de {name}</span>
            </Link>
          ) : null}
          {seesModeration ? (
            <Link href={`/moderacao/fas/${encodeURIComponent(comment.authorUid)}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
              Moderação<span className="sr-only"> de {name}</span>
            </Link>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** O status de agora com as marcas: "Oculto pelo gestor em 27 out, 10:00 · A equipe manteve oculto". */
function CommentStatusLine({ comment, now }: { comment: FanClubComment; now: Date }) {
  return <p className="m-0 text-[13px] font-semibold text-fg/80">{[commentStatusText(comment, now), ...commentMarks(comment, now)].join(" · ")}</p>;
}

function CommentText({ text }: { text: string }) {
  return <p className="m-0 whitespace-pre-line break-words text-[14.5px] leading-relaxed text-fg/90">{text || <Missing>Sem texto</Missing>}</p>;
}

/** Os botões de uma decisão de comentário, com o nome do autor para o leitor de tela. */
function DecisionButtons({ decisions, status, author, onDecide }: { decisions: CommentDecision[]; status: CommentStatus; author: string; onDecide: (decision: CommentDecision) => void }) {
  return (
    <>
      {decisions.map((decision) => (
        <Button key={decision} size="sm" variant={decision === "hide" ? "danger" : decision === "restore" ? "primary" : "secondary"} onClick={() => onDecide(decision)} aria-haspopup="dialog">
          {decision === "hide" ? <EyeOff aria-hidden="true" className="size-4" /> : decision === "restore" ? <Eye aria-hidden="true" className="size-4" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
          {commentDecisionLabel(decision, status)}
          <span className="sr-only"> o comentário de {author}</span>
        </Button>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// A aba Comentários (37.10, item 1)
// ---------------------------------------------------------------------------

/** Um item da fila: o comentário lido pelo id, a marca do tipo, os motivos, a rodada, o status, a publicação e o fã-clube. */
function CommentCard({
  item,
  comment,
  post,
  club,
  now,
  seesFans,
  seesModeration,
  actions,
}: {
  item: FanClubCommentItem;
  /** `undefined` carregando; `null` quando o comentário não existe mais; `"unknown"` quando a leitura falhou. */
  comment: FanClubComment | null | undefined | "unknown";
  /** `undefined` carregando; `null` sem a publicação; `"unknown"` quando a leitura falhou. */
  post: FanClubPost | null | undefined | "unknown";
  club: FanClub | null | undefined;
  now: Date;
  seesFans: boolean;
  seesModeration: boolean;
  actions: React.ReactNode;
}) {
  const author = comment && comment !== "unknown" ? commentAuthorLabel(comment) : null;
  const reasons = commentReasonsText(item.reasons);
  const closedWithout = item.status === "resolved" && item.resolution && !decidedByTeam(item) ? (item.resolution as keyof typeof COMMENT_CLOSED_REASONS) : null;
  return (
    <article className="flex flex-col gap-2.5 px-5 py-4">
      <h3 className="sr-only">{author ? `Comentário de ${author}` : comment === null ? "Comentário apagado" : `Comentário ${item.commentId}`}</h3>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {comment === undefined ? (
          <span className="text-[13px] text-fg/60">Carregando o comentário...</span>
        ) : comment === "unknown" ? (
          <span className="text-[13px] text-fg/60">O comentário não carregou.</span>
        ) : comment === null ? (
          <span className="text-sm font-semibold text-fg/80">Comentário apagado</span>
        ) : (
          <CommentAuthor comment={comment} ownerUid={club?.ownerUid} seesFans={seesFans} seesModeration={seesModeration} />
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          {commentItemMarks(item).map((mark) => (
            <Badge key={mark} tone={mark === "Revisão pedida" ? "cyan" : "neutral"}>
              {mark}
            </Badge>
          ))}
          <Badge tone="neutral">Rodada {formatNumber(item.round)}</Badge>
          {item.status === "resolved" && item.resolution ? <Badge tone={RESOLUTION_TONES[item.resolution]}>{COMMENT_RESOLUTION_LABELS[item.resolution]}</Badge> : null}
        </span>
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg/60">
        {reasons ? <span className="font-semibold text-fg/80">{reasons}</span> : null}
        {item.reviewRequestedAt && (item.kind === "review" || item.reviewRequested) ? <span>Revisão pedida {shortWhen(item.reviewRequestedAt, now)}</span> : null}
        {item.reportCount > 0 && item.lastReportedAt ? <span>Última denúncia {shortWhen(item.lastReportedAt, now)}</span> : null}
        {item.resolvedAt ? (
          <span>
            Resolvido {shortWhen(item.resolvedAt, now)}
            {item.resolvedBy?.name ? ` por ${item.resolvedBy.name}` : ""}
          </span>
        ) : null}
      </p>
      {comment && comment !== "unknown" ? (
        <>
          <CommentText text={comment.text} />
          <CommentStatusLine comment={comment} now={now} />
        </>
      ) : null}
      {closedWithout ? <p className="m-0 text-[13px] text-fg/70">{COMMENT_CLOSED_REASONS[closedWithout]}</p> : null}
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-fg/60">
        <span>
          Publicação{" "}
          {post === undefined ? (
            "carregando..."
          ) : post === "unknown" ? (
            "não carregou"
          ) : post === null ? (
            <Missing>apagada</Missing>
          ) : (
            <>
              <span className="text-fg/85">{postExcerpt(post.text, 80) || "sem texto"}</span> ({POST_STATUS_LABELS[post.status].toLowerCase()})
            </>
          )}
        </span>
        <span>
          Fã-clube{" "}
          {club === undefined ? (
            "carregando..."
          ) : club ? (
            <Link href={`/fa-clubes/${club.id}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
              {fanClubLabel(club)}
            </Link>
          ) : (
            <span className="font-mono">{item.clubId}</span>
          )}
        </span>
      </p>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}

/**
 * A fila dos comentários (`fanClubCommentQueue`): os abertos, da última
 * atividade, e os resolvidos, da decisão mais nova. Manter (ou "Manter
 * oculto"), Ocultar e Reexibir mandam o status mostrado e a rodada do item.
 * A aba Denúncias continua só das publicações.
 */
export function CommentsTab({ member, canEdit, now, round, total, onChanged }: { member: StaffMember; canEdit: boolean; now: Date; round: number; total: number | null; onChanged: () => void }) {
  const decisions = useQueueDecisions(canEdit, onChanged);
  const [status, setStatus] = useState<ReportStatus>("open");
  const load = useCallback((after: PageCursor | null) => getCommentQueuePage(status, after), [status]);
  const refreshKey = `${round}-${decisions.round}`;
  const list = usePagedList(load, (item: FanClubCommentItem) => item.commentId, { one: "comentário carregado", many: "comentários carregados" }, refreshKey);
  const items = list.state.status === "ready" ? list.state.data : [];
  const commentKey = items.map((item) => item.commentId).join("|");
  const commentsLoad = useLoad(
    useCallback(() => getCommentsByIds(commentKey ? commentKey.split("|") : []), [commentKey]),
    refreshKey,
  );
  const comments = commentsLoad.state.status === "ready" ? commentsLoad.state.data : null;
  // Com a releitura falhada, o status na tela pode estar velho: sem ele confirmado, nenhum botão.
  const commentsKnown = comments !== null && commentsLoad.refreshError === null;
  const postKey = items.map((item) => item.postId).join("|");
  const postsLoad = useLoad(
    useCallback(() => getPostsByIds(postKey ? postKey.split("|") : []), [postKey]),
    refreshKey,
  );
  const posts = postsLoad.state.status === "ready" ? postsLoad.state.data : null;
  const clubs = useClubs(
    items.map((item) => item.clubId),
    refreshKey,
  );
  const seesFans = canSeeSection(member, "fans");
  const seesModeration = canSeeSection(member, "moderation");

  function ask(item: FanClubCommentItem, comment: FanClubComment, decision: CommentDecision) {
    const { title, body } = commentDecisionText(decision, comment, item);
    decisions.ask({
      title,
      body,
      confirmLabel: commentDecisionLabel(decision, comment.status),
      busyLabel: BUSY_LABELS[decision],
      tone: decision === "hide" ? "danger" : "default",
      send: () => decideFanClubComment(item.commentId, comment.status, decision, item.round),
      successMessage: commentDoneText(decision, comment.status),
      blocksRetry: blocksCommentRetry,
    });
  }

  const meta = status === "open" ? (total !== null ? `${openCommentItemsText(total)}, da atividade mais nova` : "Da atividade mais nova.") : "Da decisão mais nova.";

  return (
    <SectionCard id="titulo-comentarios" title="Comentários" meta={meta}>
      <div className="border-b border-line px-5 py-4">
        <FilterChips label="Situação dos comentários" value={status} onChange={(value) => setStatus(value as ReportStatus)} options={REPORT_STATUSES.map((item) => ({ value: item, label: REPORT_FILTER_LABELS[item] }))} />
      </div>
      {decisions.noticeView}
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-comentarios" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os comentários..." />
      ) : items.length === 0 ? (
        <EmptyState>{status === "open" ? "Nenhum comentário esperando a equipe. Bom trabalho." : "Nenhum comentário resolvido ainda."}</EmptyState>
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          {commentsLoad.state.status === "error" ? (
            <p className="m-0 px-5 pt-4 text-[13px] text-danger">Os comentários não carregaram: {commentsLoad.state.message}</p>
          ) : commentsLoad.refreshError ? (
            <p className="m-0 px-5 pt-4 text-[13px] text-danger">Os comentários não atualizaram: {commentsLoad.refreshError}</p>
          ) : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {items.map((item) => {
              const comment = comments ? (comments.get(item.commentId) ?? null) : commentsLoad.state.status === "error" ? "unknown" : undefined;
              const state: ItemCommentState = commentsKnown ? (comments.get(item.commentId) ?? null) : "unknown";
              const post = posts ? (posts.get(item.postId) ?? null) : postsLoad.state.status === "error" ? "unknown" : undefined;
              const club = clubs instanceof Map ? (clubs.get(item.clubId) ?? null) : clubs === "failed" ? null : undefined;
              const ownerUid = club ? club.ownerUid : null;
              // Sem o fã-clube lido, o gestor não aparece aqui: os botões esperam a leitura (o servidor recusaria com `self`).
              const allowed = club !== undefined ? commentItemDecisions(item, state, ownerUid, { uid: member.uid, canEdit }) : [];
              const teamDecides = item.status === "open" || decidedByTeam(item);
              const shown = comment && comment !== "unknown" ? comment : null;
              return (
                <li key={item.commentId}>
                  <CommentCard
                    item={item}
                    comment={comment}
                    post={post}
                    club={club}
                    now={now}
                    seesFans={seesFans}
                    seesModeration={seesModeration}
                    actions={
                      allowed.length > 0 && shown ? (
                        <DecisionButtons decisions={allowed} status={shown.status} author={commentAuthorLabel(shown)} onDecide={(decision) => ask(item, shown, decision)} />
                      ) : canEdit && teamDecides && club !== undefined && isCommentSelf(item.authorUid, ownerUid, member) ? (
                        <span className="text-[12.5px] text-fg/60">{COMMENT_SELF_TEXT}</span>
                      ) : null
                    }
                  />
                </li>
              );
            })}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
      {decisions.dialogs}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Os comentários de uma publicação, na ficha (37.10, item 2)
// ---------------------------------------------------------------------------

/**
 * O diálogo "Comentários (N)" de uma publicação (no molde do
 * `PostCommentsDialog` do Mural): os comentários em todos os status, do mais
 * novo, 25 por vez, com Ocultar e Reexibir sem a rodada (só o item aberto da
 * fila é resolvido). A confirmação abre por cima, fora do diálogo, e o
 * fechar diz à ficha se algo mudou, para ela ler os totais de novo.
 */
export function PostCommentsDialog({ post, club, member, onClose }: { post: FanClubPost | null; club: FanClub; member: StaffMember; onClose: (changed: boolean) => void }) {
  const canEdit = canEditSection(member, "fanClubs");
  const [changed, setChanged] = useState(false);
  const [round, setRound] = useState(0);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmKey, setConfirmKey] = useState(0);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  if (pendingRefresh && confirm === null) {
    setPendingRefresh(false);
    setRound((value) => value + 1);
  }

  function markStale() {
    setChanged(true);
    setPendingRefresh(true);
  }

  function close() {
    if (confirm) return;
    onClose(changed);
    setChanged(false);
    setNotice(null);
  }

  function ask(comment: FanClubComment, decision: CommentDecision) {
    const { title, body } = commentDecisionText(decision, comment);
    setConfirm({
      title,
      body: `${body} ${FAN_CLUB_AUDIT_TEXT}`,
      confirmLabel: commentDecisionLabel(decision, comment.status),
      busyLabel: BUSY_LABELS[decision],
      cancelLabel: "Voltar",
      tone: decision === "hide" ? "danger" : "default",
      action: () => {
        markStale();
        return decideFanClubComment(comment.id, comment.status, decision, null);
      },
      successMessage: commentDoneText(decision, comment.status),
      onUncertain: markStale,
      uncertainText: UNCERTAIN_RETRY_TEXT,
      onError: markStale,
      blocksRetry: blocksCommentRetry,
      onOrphan: markStale,
    });
    setConfirmKey((value) => value + 1);
  }

  return (
    <>
      <Dialog
        open={Boolean(post)}
        size="lg"
        onClose={close}
        title="Comentários da publicação"
        description={post ? `${sentence(postExcerpt(post.text, 90) || "Publicação sem texto")} Em todos os status, do mais novo. O número da ficha conta os que aparecem aos fãs.` : undefined}
      >
        {post ? <PostCommentsList key={post.id} post={post} club={club} member={member} canEdit={canEdit} round={round} notice={notice} onAsk={ask} onClose={close} /> : null}
      </Dialog>
      <ConfirmDialog
        key={`confirmar-comentario-${confirmKey}`}
        request={canEdit && post ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          setPendingRefresh(false);
          setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
          setRound((value) => value + 1);
        }}
      />
    </>
  );
}

function PostCommentsList({
  post,
  club,
  member,
  canEdit,
  round,
  notice,
  onAsk,
  onClose,
}: {
  post: FanClubPost;
  club: FanClub;
  member: StaffMember;
  canEdit: boolean;
  round: number;
  notice: { key: number; text: string } | null;
  onAsk: (comment: FanClubComment, decision: CommentDecision) => void;
  onClose: () => void;
}) {
  const load = useCallback((after: PageCursor | null) => getPostCommentsPage(post.id, after), [post.id]);
  const list = usePagedList(load, (comment: FanClubComment) => comment.id, { one: "comentário carregado", many: "comentários carregados" }, round);
  const now = list.loadedAt ?? new Date();
  const seesFans = canSeeSection(member, "fans");
  const seesModeration = canSeeSection(member, "moderation");
  const viewer = { uid: member.uid, canEdit };
  const self = canEdit && club.ownerUid !== null && club.ownerUid === member.uid;
  // O aviso da decisão recebe o foco: a confirmação devolve o foco ao botão, e a releitura pode tirá-lo da tela.
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <Notice key={`aviso-${notice.key}`} tone="success" focusable ref={noticeRef}>
          {notice.text}
        </Notice>
      ) : null}
      {self ? <Notice tone="info">Este fã-clube é seu: outra pessoa da equipe decide os comentários dele.</Notice> : null}
      {list.refreshError ? <Notice tone="error">Não deu para atualizar: {list.refreshError}</Notice> : null}
      {list.state.status === "error" ? (
        <Notice tone="error">{list.state.message}</Notice>
      ) : list.state.status === "loading" ? (
        <p role="status" className="m-0 text-sm text-fg/70">
          Carregando os comentários...
        </p>
      ) : list.state.data.length === 0 ? (
        <p className="m-0 text-sm text-fg/70">Nenhum comentário nesta publicação.</p>
      ) : (
        <ul className="m-0 flex max-h-[55vh] list-none flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line p-0">
          {list.state.data.map((comment) => {
            const allowed = list.refreshError ? [] : commentDecisions(comment, club.ownerUid, viewer);
            return (
              <li key={comment.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CommentAuthor comment={comment} ownerUid={club.ownerUid} seesFans={seesFans} seesModeration={seesModeration} />
                  <span className="text-[12.5px] text-fg/60">{shortWhen(comment.createdAt, now)}</span>
                </div>
                <CommentText text={comment.text} />
                <CommentStatusLine comment={comment} now={now} />
                {allowed.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <DecisionButtons decisions={allowed} status={comment.status} author={commentAuthorLabel(comment)} onDecide={(decision) => onAsk(comment, decision)} />
                  </div>
                ) : canEdit && !self && comment.authorUid === member.uid ? (
                  <span className="text-[12.5px] text-fg/60">{COMMENT_SELF_TEXT}</span>
                ) : null}
              </li>
            );
          })}
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

/** O botão "Comentários (N)" da publicação na ficha, com o N dos que aparecem aos fãs. */
export function CommentsButton({ post, onOpen }: { post: FanClubPost; onOpen: () => void }) {
  return (
    <Button size="sm" variant="secondary" onClick={onOpen} aria-haspopup="dialog">
      Comentários ({formatNumber(post.commentCount)})<span className="sr-only">: {commentCountText(post.commentCount)} que aparecem aos fãs</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// O registro do ocultar do gestor (37.10, item 2)
// ---------------------------------------------------------------------------

/**
 * "Ocultos pelo gestor": o `fanClubHideLog` do fã-clube, da linha mais nova,
 * com o comentário lido pelo id, o autor e o gestor. A linha mais nova de um
 * comentário ainda oculto pelo gestor oferece o Reexibir (sem a rodada). O
 * Reexibir da equipe não entra aqui: ele vai à auditoria, e a linha do
 * gestor fica.
 */
export function HideLogSection({
  club,
  member,
  now,
  round,
  onRestore,
}: {
  club: FanClub;
  member: StaffMember;
  now: Date;
  round: number;
  onRestore: (comment: FanClubComment) => void;
}) {
  const canEdit = canEditSection(member, "fanClubs");
  const load = useCallback((after: PageCursor | null) => getHideLogPage(club.id, after), [club.id]);
  const list = usePagedList(load, (entry: HideLogEntry) => entry.id, { one: "linha carregada", many: "linhas carregadas" }, round);
  const entries = list.state.status === "ready" ? list.state.data : [];
  const commentKey = [...new Set(entries.map((entry) => entry.commentId))].join("|");
  const commentsLoad = useLoad(
    useCallback(() => getCommentsByIds(commentKey ? commentKey.split("|") : []), [commentKey]),
    round,
  );
  const comments = commentsLoad.state.status === "ready" && commentsLoad.refreshError === null ? commentsLoad.state.data : null;
  const hides = useLoad(
    useCallback(() => countManagerHides(club.id), [club.id]),
    round,
  );
  const statuses = new Map<string, CommentStatus>();
  for (const [id, comment] of comments ?? []) if (comment) statuses.set(id, comment.status);
  const restorable = hideLogRestorable(entries, statuses);
  const manager = ownerLabel(club);
  const seesFans = canSeeSection(member, "fans");
  const seesModeration = canSeeSection(member, "moderation");
  const meta = hides.state.status === "ready" ? `${managerHidesText(hides.state.data)} Da linha mais nova.` : "Cada ocultar e cada reexibir do gestor, da linha mais nova.";

  return (
    <SectionCard id="titulo-ocultos-gestor" title="Ocultos pelo gestor" meta={meta}>
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-ocultos-gestor" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando o registro do gestor..." />
      ) : entries.length === 0 ? (
        <EmptyState>O gestor ainda não ocultou nenhum comentário.</EmptyState>
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          {commentsLoad.state.status === "error" ? (
            <p className="m-0 px-5 pt-4 text-[13px] text-danger">Os comentários não carregaram: {commentsLoad.state.message}</p>
          ) : commentsLoad.refreshError ? (
            <p className="m-0 px-5 pt-4 text-[13px] text-danger">Os comentários não atualizaram: {commentsLoad.refreshError}</p>
          ) : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {entries.map((entry) => {
              const comment = commentsLoad.state.status === "ready" ? (commentsLoad.state.data.get(entry.commentId) ?? null) : undefined;
              const restore = comment && restorable.has(entry.id) && commentDecisions(comment, club.ownerUid, { uid: member.uid, canEdit }).includes("restore");
              return (
                <li key={entry.id} className="flex flex-col gap-2 px-5 py-4">
                  <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg/70">
                    <Badge tone={entry.action === "hidden" ? "neutral" : "cyan"}>{HIDE_LOG_ACTION_LABELS[entry.action]}</Badge>
                    <span>{shortWhen(entry.at, now)}</span>
                    <span>Gestor {manager}</span>
                  </p>
                  {comment === undefined ? (
                    <p className="m-0 text-[13px] text-fg/60">{commentsLoad.state.status === "error" ? "O comentário não carregou." : "Carregando o comentário..."}</p>
                  ) : comment === null ? (
                    <p className="m-0 text-sm font-semibold text-fg/80">Comentário apagado</p>
                  ) : (
                    <>
                      <CommentAuthor comment={comment} ownerUid={club.ownerUid} seesFans={seesFans} seesModeration={seesModeration} />
                      <CommentText text={comment.text} />
                      <CommentStatusLine comment={comment} now={now} />
                    </>
                  )}
                  {entry.authorUid === null ? <p className="m-0 text-[12.5px] text-fg/60">Autor: conta excluída</p> : null}
                  {restore ? (
                    <div className="flex flex-wrap gap-2">
                      <DecisionButtons decisions={["restore"]} status={comment.status} author={commentAuthorLabel(comment)} onDecide={() => onRestore(comment)} />
                    </div>
                  ) : null}
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
