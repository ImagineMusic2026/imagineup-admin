"use client";

import { Check, EyeOff, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { RejectPostDialog } from "@/components/fa-clubes/fan-club-dialogs";
import { PostCard, shortWhen } from "@/components/fa-clubes/fan-club-bits";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { LoadMore } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChips } from "@/components/ui/filter-bar";
import { Notice } from "@/components/ui/notice";
import { useLoad } from "@/components/ui/use-load";
import { usePagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, type ArtistName } from "@/lib/artist-names-data";
import { UNCERTAIN_RETRY_TEXT } from "@/lib/errors";
import { decidePost, decideReport } from "@/lib/fan-club-api";
import { getFanClubsByIds, getPendingPostsPage, getPhotoBoxes, getPostsByIds, getReportsPage } from "@/lib/fan-club-data";
import {
  APPROVE_POST_TEXT,
  FAN_CLUB_AUDIT_TEXT,
  REPORT_FILTER_LABELS,
  REPORT_RESOLUTION_LABELS,
  REPORT_STATUSES,
  authorLabel,
  fanClubLabel,
  isStaleDecision,
  openReportsCountText,
  pendingPostsCountText,
  postDecisions,
  reportDecisionText,
  reportDecisions,
  reportDoneText,
  reportReasonsText,
  type FanClub,
  type FanClubPost,
  type FanClubReport,
  type ReportDecision,
  type ReportPostState,
  type ReportStatus,
} from "@/lib/fan-clubs";
import type { PageCursor } from "@/lib/firestore-page";
import { formatNumber } from "@/lib/format";
import { canSeeSection, type StaffMember } from "@/lib/staff";

type Names = ReadonlyMap<string, ArtistName> | null;

/**
 * As decisões das filas, no molde da ficha: a confirmação com o estado da
 * tela (`expected`), a releitura que só sai com o diálogo fechado, e o aviso
 * com o foco depois da decisão. A aba Comentários usa o mesmo.
 */
export function useQueueDecisions(canEdit: boolean, onChanged: () => void) {
  const [round, setRound] = useState(0);
  // Cada releitura depois de uma decisão também conta de novo o cabeçalho (o `onChanged` é estável, o `reload` do `useLoad`).
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (changes > 0) onChanged();
  }, [changes, onChanged]);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmKey, setConfirmKey] = useState(0);
  const [rejecting, setRejecting] = useState<FanClubPost | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const [editSeen, setEditSeen] = useState(canEdit);
  if (editSeen !== canEdit) {
    setEditSeen(canEdit);
    if (!canEdit) {
      setConfirm(null);
      setConfirmKey((value) => value + 1);
      setRejecting(null);
    }
  }
  if (pendingRefresh && confirm === null && rejecting === null) {
    setPendingRefresh(false);
    setRound((value) => value + 1);
    setChanges((value) => value + 1);
  }
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function markStale() {
    setPendingRefresh(true);
  }

  function changed(message: string) {
    setPendingRefresh(false);
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, text: message }));
    setRound((value) => value + 1);
    setChanges((value) => value + 1);
  }

  function ask(
    request: Pick<ConfirmRequest, "title" | "body" | "confirmLabel" | "busyLabel" | "tone" | "successMessage"> & { send: () => Promise<unknown>; blocksRetry?: (failure: unknown) => boolean },
  ) {
    const { send, blocksRetry, ...rest } = request;
    setConfirm({
      ...rest,
      body: `${request.body} ${FAN_CLUB_AUDIT_TEXT}`,
      cancelLabel: "Voltar",
      action: () => {
        markStale();
        return send();
      },
      onUncertain: markStale,
      uncertainText: UNCERTAIN_RETRY_TEXT,
      onError: markStale,
      blocksRetry: blocksRetry ?? isStaleDecision,
      onOrphan: markStale,
    });
    setConfirmKey((value) => value + 1);
  }

  const dialogs = (
    <>
      <ConfirmDialog
        key={`confirmar-${confirmKey}`}
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      {canEdit && rejecting ? (
        <RejectPostDialog
          post={rejecting}
          onClose={() => setRejecting(null)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(message) => {
            setRejecting(null);
            changed(message);
          }}
        />
      ) : null}
    </>
  );

  const noticeView = notice ? (
    <div className="px-5 pt-4">
      <Notice key={`aviso-${notice.key}`} tone="success" focusable ref={noticeRef}>
        {notice.text}
      </Notice>
    </div>
  ) : null;

  return { round, ask, reject: setRejecting, dialogs, noticeView };
}

/**
 * Os fã-clubes citados pela página na tela (as publicações e as denúncias
 * guardam só o id), relidos com a lista: o mapa; `null` carregando;
 * `"failed"` quando a leitura falhou, e a tela mostra o id.
 */
export function useClubs(ids: string[], refreshKey: string): Map<string, FanClub | null> | "failed" | null {
  const key = [...new Set(ids)].sort().join("|");
  const clubs = useLoad(
    useCallback(() => getFanClubsByIds(key ? key.split("|") : []), [key]),
    refreshKey,
  );
  if (clubs.state.status === "ready") return clubs.state.data;
  return clubs.state.status === "error" ? "failed" : null;
}

/**
 * A caixa "Fãs podem postar fotos" das centrais das publicações com foto,
 * só para quem vê a seção Artistas (a regra do `artistPrivate`). O servidor
 * confere a caixa só no envio; a aprovação não confere de novo. Sem a seção,
 * ou com a leitura falhada, nada é marcado.
 */
function usePhotoBoxes(member: StaffMember, posts: readonly FanClubPost[], refreshKey: string): Map<string, boolean> | null {
  const seesArtists = canSeeSection(member, "artists");
  const key = seesArtists ? [...new Set(posts.filter((post) => post.kind === "photo").map((post) => post.artistId))].sort().join("|") : "";
  const boxes = useLoad(
    useCallback(() => (key ? getPhotoBoxes(key.split("|")) : Promise.resolve(new Map<string, boolean>())), [key]),
    refreshKey,
  );
  return boxes.state.status === "ready" ? boxes.state.data : null;
}

// ---------------------------------------------------------------------------
// Publicações para revisar (34.10, item 7)
// ---------------------------------------------------------------------------

/**
 * A fila de revisão, da mais antiga para a mais nova: a foto e a miniatura
 * lado a lado (as duas vão ao ar), o texto, o fã-clube, o autor e a central,
 * com Aprovar e Recusar (o motivo da lista). Toda publicação nasce em análise
 * e só vai ao ar com Aprovar (decisão 16).
 */
export function PostsTab({ member, canEdit, names, now, round, total, onChanged }: { member: StaffMember; canEdit: boolean; names: Names; now: Date; round: number; total: number | null; onChanged: () => void }) {
  const decisions = useQueueDecisions(canEdit, onChanged);
  const load = useCallback((after: PageCursor | null) => getPendingPostsPage(after), []);
  const refreshKey = `${round}-${decisions.round}`;
  const list = usePagedList(load, (post: FanClubPost) => post.id, { one: "publicação carregada", many: "publicações carregadas" }, refreshKey);
  const posts = list.state.status === "ready" ? list.state.data : [];
  const clubs = useClubs(
    posts.map((post) => post.clubId),
    refreshKey,
  );
  const photoBoxes = usePhotoBoxes(member, posts, refreshKey);

  function askApprove(post: FanClubPost) {
    const author = authorLabel(post);
    decisions.ask({
      title: `Aprovar a publicação de ${author}?`,
      body: APPROVE_POST_TEXT,
      confirmLabel: "Aprovar",
      busyLabel: "Aprovando...",
      tone: "default",
      send: () => decidePost(post.id, post.status, "approve"),
      successMessage: `Publicação de ${author} aprovada e no ar.`,
    });
  }

  return (
    <SectionCard id="titulo-revisar" title="Publicações para revisar" meta={total !== null ? `${pendingPostsCountText(total)}, da mais antiga para a mais nova` : "Da mais antiga para a mais nova."}>
      {decisions.noticeView}
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-revisar" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando as publicações..." />
      ) : posts.length === 0 ? (
        <EmptyState>Nenhuma publicação esperando revisão.</EmptyState>
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {posts.map((post) => {
              const allowed = postDecisions(post, { uid: member.uid, canEdit });
              const author = authorLabel(post);
              return (
                <li key={post.id}>
                  <PostCard
                    post={post}
                    club={clubs === "failed" ? null : clubs ? (clubs.get(post.clubId) ?? null) : undefined}
                    artist={artistNameOf(names, post.artistId)}
                    now={now}
                    photosOff={post.kind === "photo" && photoBoxes?.get(post.artistId) === false}
                    seesFans={canSeeSection(member, "fans")}
                    actions={
                      allowed.includes("approve") ? (
                        <>
                          <Button size="sm" variant="primary" onClick={() => askApprove(post)} aria-haspopup="dialog">
                            <Check aria-hidden="true" className="size-4" />
                            Aprovar<span className="sr-only"> a publicação de {author}</span>
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => decisions.reject(post)} aria-haspopup="dialog">
                            <X aria-hidden="true" className="size-4" />
                            Recusar<span className="sr-only"> a publicação de {author}</span>
                          </Button>
                        </>
                      ) : canEdit && post.authorUid === member.uid ? (
                        <span className="text-[12.5px] text-fg/60">A publicação é sua: outra pessoa da equipe decide.</span>
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
// Denúncias (34.10, item 8)
// ---------------------------------------------------------------------------

/** Uma denúncia: a contagem por motivo, a rodada e as datas, e a publicação com as fotos. */
function ReportCard({
  item,
  post,
  clubName,
  artist,
  now,
  actions,
}: {
  item: FanClubReport;
  /** `undefined` carregando; `null` quando a publicação não existe mais; `"unknown"` quando a leitura falhou. */
  post: FanClubPost | null | undefined | "unknown";
  clubName: React.ReactNode;
  artist: string;
  now: Date;
  actions: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2 py-1">
      <h3 className="sr-only">Denúncia da publicação {item.postId}</h3>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3">
        <p className="m-0 text-sm font-semibold text-fg">{reportReasonsText(item.reasons)}</p>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">Rodada {formatNumber(item.round)}</Badge>
          {item.status === "resolved" && item.resolution ? <Badge tone={item.resolution === "actioned" ? "danger" : "neutral"}>{REPORT_RESOLUTION_LABELS[item.resolution]}</Badge> : null}
        </span>
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 px-5 text-[12.5px] text-fg/60">
        <span>{formatNumber(item.reportCount)} na rodada</span>
        <span>Primeira {shortWhen(item.firstReportedAt, now)}</span>
        <span>Última {shortWhen(item.lastReportedAt, now)}</span>
        {item.resolvedAt ? (
          <span>
            Resolvida {shortWhen(item.resolvedAt, now)}
            {item.resolvedBy?.name ? ` por ${item.resolvedBy.name}` : ""}
          </span>
        ) : null}
      </p>
      {post === undefined ? (
        <p className="m-0 px-5 text-[13px] text-fg/60">Carregando a publicação...</p>
      ) : post === null ? (
        <p className="m-0 px-5 text-[13px] text-fg/60">A publicação não existe mais.</p>
      ) : post === "unknown" ? (
        <p className="m-0 px-5 text-[13px] text-fg/60">A publicação não carregou.</p>
      ) : (
        <PostCard post={post} artist={artist} now={now} showClub={false} headingLevel={4} />
      )}
      <p className="m-0 px-5 text-[12.5px] text-fg/60">Fã-clube {clubName}</p>
      {actions ? <div className="flex flex-wrap gap-2 px-5 pb-3">{actions}</div> : null}
    </article>
  );
}

/**
 * A fila das denúncias de publicação de fã-clube (`fanClubReportQueue`): as
 * abertas, da denúncia mais nova, e as resolvidas, com a contagem por motivo e
 * a publicação. Manter e Ocultar mandam a rodada que a tela mostrou. Quem
 * denunciou nunca aparece.
 */
export function ReportsTab({ member, canEdit, names, now, round, total, onChanged }: { member: StaffMember; canEdit: boolean; names: Names; now: Date; round: number; total: number | null; onChanged: () => void }) {
  const decisions = useQueueDecisions(canEdit, onChanged);
  const [status, setStatus] = useState<ReportStatus>("open");
  const load = useCallback((after: PageCursor | null) => getReportsPage(status, after), [status]);
  const refreshKey = `${round}-${decisions.round}`;
  const list = usePagedList(load, (item: FanClubReport) => item.postId, { one: "denúncia carregada", many: "denúncias carregadas" }, refreshKey);
  const items = list.state.status === "ready" ? list.state.data : [];
  const postKey = items.map((item) => item.postId).join("|");
  const postsLoad = useLoad(
    useCallback(() => getPostsByIds(postKey ? postKey.split("|") : []), [postKey]),
    refreshKey,
  );
  const posts = postsLoad.state.status === "ready" ? postsLoad.state.data : null;
  // Com a releitura falhada, a publicação na tela pode estar velha: a confirmação não promete nada sobre ela.
  const postsKnown = posts !== null && postsLoad.refreshError === null;
  const clubs = useClubs(
    items.map((item) => item.clubId),
    refreshKey,
  );

  function ask(item: FanClubReport, post: FanClubPost | null | "unknown", state: ReportPostState, decision: ReportDecision) {
    const author = post && post !== "unknown" ? authorLabel(post) : "um gestor";
    decisions.ask({
      title: decision === "keep" ? `Manter a publicação de ${author}?` : `Ocultar a publicação de ${author}?`,
      body: reportDecisionText(item, state, decision),
      confirmLabel: decision === "keep" ? "Manter" : "Ocultar",
      busyLabel: decision === "keep" ? "Mantendo..." : "Ocultando...",
      tone: decision === "keep" ? "default" : "danger",
      send: () => decideReport(item.postId, item.round, decision),
      successMessage: reportDoneText(item, state, decision, author),
    });
  }

  const meta = status === "open" ? (total !== null ? `${openReportsCountText(total)}, da denúncia mais nova` : "Da denúncia mais nova.") : "Da decisão mais nova.";

  return (
    <SectionCard id="titulo-denuncias" title="Denúncias" meta={meta}>
      <div className="border-b border-line px-5 py-4">
        <FilterChips label="Situação das denúncias" value={status} onChange={(value) => setStatus(value as ReportStatus)} options={REPORT_STATUSES.map((item) => ({ value: item, label: REPORT_FILTER_LABELS[item] }))} />
      </div>
      {decisions.noticeView}
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-denuncias" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando as denúncias..." />
      ) : items.length === 0 ? (
        <EmptyState>{status === "open" ? "Nenhuma denúncia aberta. Bom trabalho." : "Nenhuma denúncia resolvida ainda."}</EmptyState>
      ) : (
        <>
          {list.refreshError ? <p className="m-0 px-5 pt-4 text-[13px] text-danger">Não deu para atualizar: {list.refreshError}</p> : null}
          {postsLoad.state.status === "error" ? (
            <p className="m-0 px-5 pt-4 text-[13px] text-danger">As publicações não carregaram: {postsLoad.state.message}</p>
          ) : postsLoad.refreshError ? (
            <p className="m-0 px-5 pt-4 text-[13px] text-danger">As publicações não atualizaram: {postsLoad.refreshError}</p>
          ) : null}
          <ul className="m-0 list-none divide-y divide-line p-0">
            {items.map((item) => {
              const post = posts ? (posts.get(item.postId) ?? null) : postsLoad.state.status === "error" ? "unknown" : undefined;
              const state: ReportPostState = postsKnown ? (posts.get(item.postId) ?? null) : "unknown";
              const club = clubs instanceof Map ? clubs.get(item.clubId) : undefined;
              const allowed = reportDecisions(item, { uid: member.uid, canEdit });
              const teamDecides = item.status === "open" || item.resolution === "kept" || item.resolution === "actioned";
              return (
                <li key={item.postId}>
                  <ReportCard
                    item={item}
                    post={post}
                    clubName={
                      club ? (
                        <Link href={`/fa-clubes/${club.id}`} className="font-semibold text-cyan underline-offset-2 hover:underline">
                          {fanClubLabel(club)}
                        </Link>
                      ) : (
                        <span className="font-mono">{item.clubId}</span>
                      )
                    }
                    artist={artistNameOf(names, item.artistId)}
                    now={now}
                    actions={
                      allowed.length > 0 && post !== undefined ? (
                        <>
                          {allowed.includes("action") ? (
                            <Button size="sm" variant="danger" onClick={() => ask(item, post, state, "action")} aria-haspopup="dialog">
                              <EyeOff aria-hidden="true" className="size-4" />
                              Ocultar<span className="sr-only"> a publicação denunciada</span>
                            </Button>
                          ) : null}
                          {allowed.includes("keep") ? (
                            <Button size="sm" variant="secondary" onClick={() => ask(item, post, state, "keep")} aria-haspopup="dialog">
                              <ShieldCheck aria-hidden="true" className="size-4" />
                              Manter<span className="sr-only"> a publicação denunciada</span>
                            </Button>
                          ) : null}
                        </>
                      ) : canEdit && teamDecides && item.authorUid === member.uid ? (
                        <span className="text-[12.5px] text-fg/60">A publicação é sua: outra pessoa da equipe decide.</span>
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
