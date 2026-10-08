"use client";

import { ArrowLeft, AtSign, EyeOff, ImageOff, UserCheck, UserX } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { QueueCard, shortWhen } from "@/components/moderacao/queue-card";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ui/confirm-dialog";
import { LoadMore } from "@/components/ui/data-table";
import { Detail, DetailList, Missing } from "@/components/ui/detail-list";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useLoad } from "@/components/ui/use-load";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { usePagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, getArtistNames } from "@/lib/artist-names-data";
import { actionErrorMessage, mayHaveRunOnServer } from "@/lib/errors";
import { getFanCommentsPage, type CommentRow } from "@/lib/fan-data";
import { SUSPENSION_REASONS, SUSPENSION_REASON_LABELS, fanDisplayName, suspensionReasonLabel, type FanProfile, type SuspensionReason } from "@/lib/fan-profile";
import { getFanProfile } from "@/lib/fan-profile-data";
import type { PageCursor } from "@/lib/firestore-page";
import { clearFanPhoto, hideFanComments, moderateComment, resetFanUsername, setFanSuspended } from "@/lib/moderation-api";
import {
  CLEAR_PHOTO_TEXT,
  FAN_NOT_FOUND_TEXT,
  HIDE_CONFIRM_TEXT,
  SUSPENSION_NOTE_MAX,
  SUSPEND_TEXT,
  hiddenSummary,
  hideAlsoLabel,
  resetUsernameText,
  validateSuspensionNote,
  type QueueItem,
} from "@/lib/moderation";
import { countVisibleComments, createContentReader, getFanQueuePage, type ContentReader } from "@/lib/moderation-data";
import { canEditSection, canSeeSection, type StaffMember } from "@/lib/staff";

type Notify = (tone: "success" | "error" | "info", text: string) => void;

/** A página de um fã na Moderação (`/moderacao/fas/[uid]`): o perfil, as ferramentas e as listas dele. */
export function FanModerationPage({ uid }: { uid: string }) {
  return <SectionGate section="moderation">{(member) => <FanModerationContent member={member} uid={uid} />}</SectionGate>;
}

function FanModerationContent({ member, uid }: { member: StaffMember; uid: string }) {
  const canEdit = canEditSection(member, "moderation");
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [reader, setReader] = useState<ContentReader>(createContentReader);
  const [notice, setNotice] = useState<{ key: number; tone: "success" | "error" | "info"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [hiding, setHiding] = useState(false);

  const profile = useLoad(
    useCallback(() => {
      void round;
      return getFanProfile(uid);
    }, [uid, round]),
  );
  const visible = useLoad(
    useCallback(() => {
      void round;
      return countVisibleComments(uid);
    }, [uid, round]),
  );
  const fan = profile.state.status === "ready" ? profile.state.data : null;
  const visibleCount = visible.state.status === "ready" ? visible.state.data : null;
  const date = new Date(now);

  const show: Notify = (tone, text) => setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone, text }));

  function refresh() {
    setNow(Date.now());
    setReader(createContentReader());
    setRound((value) => value + 1);
  }

  function changed(message: string) {
    show("success", message);
    refresh();
  }

  if (profile.state.status === "error") {
    return (
      <>
        <PageHeader title="Fã" />
        <SectionCard id="titulo-fa-moderacao" title="Fã">
          <LoadError message={profile.state.message} headingId="titulo-fa-moderacao" onRetry={profile.reload} />
        </SectionCard>
      </>
    );
  }
  if (profile.state.status === "loading") {
    return (
      <>
        <PageHeader title="Fã" />
        <SectionCard id="titulo-fa-moderacao" title="Fã">
          <LoadingRow label="Carregando o fã..." />
        </SectionCard>
      </>
    );
  }
  if (!fan) {
    return (
      <>
        <PageHeader title="Fã" />
        <SectionCard id="titulo-fa-moderacao" title="Fã">
          <EmptyState action={<ButtonLink href="/moderacao" size="sm" variant="secondary">Voltar para a Moderação</ButtonLink>}>{FAN_NOT_FOUND_TEXT}</EmptyState>
        </SectionCard>
      </>
    );
  }

  const name = fanDisplayName(fan);
  const suspended = Boolean(fan.suspendedAt);

  function askUnsuspend(target: FanProfile) {
    setConfirm({
      title: `Tirar a suspensão de ${name}?`,
      body: "O fã volta a comentar, curtir, ganhar pontos e mudar o perfil.",
      confirmLabel: "Tirar suspensão",
      busyLabel: "Tirando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: () => setFanSuspended({ uid: target.uid, suspended: false }),
      successMessage: `Suspensão de ${name} tirada.`,
      onUncertain: refresh,
    });
  }

  function askResetUsername(target: FanProfile) {
    setConfirm({
      title: `Trocar o @ de ${name}?`,
      body: resetUsernameText(target.username),
      confirmLabel: "Trocar o @",
      busyLabel: "Trocando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => resetFanUsername({ uid: target.uid, username: target.username }),
      successMessage: `O @${target.username} foi trocado por um automático.`,
      onUncertain: refresh,
    });
  }

  function askClearPhoto(target: FanProfile) {
    setConfirm({
      title: `Tirar a foto de ${name}?`,
      body: CLEAR_PHOTO_TEXT,
      confirmLabel: "Tirar a foto",
      busyLabel: "Tirando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => clearFanPhoto(target.uid),
      successMessage: `A foto de ${name} foi tirada.`,
      onUncertain: refresh,
    });
  }

  return (
    <>
      <PageHeader
        title={name}
        subtitle={fan.username ? `@${fan.username}` : undefined}
        actions={
          <>
            <ButtonLink href="/moderacao" size="sm" variant="ghost">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Moderação
            </ButtonLink>
            <RefreshButton onClick={refresh} busy={profile.reloading} loadedAt={profile.loadedAt} />
          </>
        }
      />

      <div aria-live="polite" className="sr-only">
        {notice && notice.tone !== "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone={notice.tone} announce={notice.tone === "error"}>
          {notice.text}
        </Notice>
      ) : null}

      <SectionCard id="titulo-perfil-fa" title="Perfil">
        <div className="flex flex-col gap-5 px-5 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <FanAvatar name={name} photoURL={fan.photoURL} size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 flex flex-wrap items-center gap-2 font-display text-lg font-semibold">
                {name}
                {suspended ? <Badge tone="danger">Suspenso</Badge> : null}
              </p>
              <p className="m-0 text-[13.5px] text-fg/70">{[fan.username ? `@${fan.username}` : null, fan.city].filter(Boolean).join(" · ") || "Sem @ e sem cidade"}</p>
            </div>
          </div>
          <DetailList>
            <Detail term="No app desde">{fan.createdAt ? shortWhen(fan.createdAt, date) : <Missing>Sem data</Missing>}</Detail>
            <Detail term="Suspensão">{suspended ? `${suspensionReasonLabel(fan.suspensionReason)}, desde ${shortWhen(fan.suspendedAt, date)}` : "Não está suspenso"}</Detail>
            <Detail term="Comentários visíveis">{visibleCount === null ? "..." : visibleCount}</Detail>
            <Detail term="Identificador">
              <span className="font-mono text-[13px]">{fan.uid}</span>
            </Detail>
          </DetailList>
          <div className="flex flex-wrap gap-2">
            {canSeeSection(member, "fans") ? (
              <ButtonLink href={`/fas/${fan.uid}`} size="sm" variant="secondary">
                Abrir a ficha
              </ButtonLink>
            ) : null}
            {canEdit ? (
              <>
                {suspended ? (
                  <Button size="sm" variant="secondary" onClick={() => askUnsuspend(fan)}>
                    <UserCheck aria-hidden="true" className="size-4" />
                    Tirar suspensão
                  </Button>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => setSuspending(true)}>
                    <UserX aria-hidden="true" className="size-4" />
                    Suspender conta
                  </Button>
                )}
                <Button size="sm" variant="secondary" disabled={visibleCount === 0} onClick={() => setHiding(true)}>
                  <EyeOff aria-hidden="true" className="size-4" />
                  Ocultar todos os comentários
                </Button>
                {fan.username ? (
                  <Button size="sm" variant="secondary" onClick={() => askResetUsername(fan)}>
                    <AtSign aria-hidden="true" className="size-4" />
                    Trocar o @
                  </Button>
                ) : null}
                {fan.photoURL ? (
                  <Button size="sm" variant="secondary" onClick={() => askClearPhoto(fan)}>
                    <ImageOff aria-hidden="true" className="size-4" />
                    Tirar a foto
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <FanQueue member={member} uid={uid} reader={reader} now={date} round={round} />
      <FanComments member={member} uid={uid} canEdit={canEdit} now={date} round={round} onNotice={show} onChanged={changed} />

      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      <HideCommentsDialog
        open={canEdit && (suspending || hiding)}
        mode={suspending ? "suspend" : "hide"}
        fan={fan}
        visible={visibleCount ?? 0}
        onClose={(message) => {
          setSuspending(false);
          setHiding(false);
          if (message) changed(message);
        }}
      />
    </>
  );
}

/**
 * "Suspender conta" (com o motivo, a nota e o "Ocultar também") e "Ocultar
 * todos os comentários": a suspensão e depois o `hideFanComments` chamado de
 * novo até `more: false`, com o progresso e o resumo.
 */
function HideCommentsDialog({
  open,
  mode,
  fan,
  visible,
  onClose,
}: {
  open: boolean;
  mode: "suspend" | "hide";
  fan: FanProfile;
  visible: number;
  onClose: (message: string | null) => void;
}) {
  return open ? <HideCommentsBody key={mode} mode={mode} fan={fan} visible={visible} onClose={onClose} /> : null;
}

function HideCommentsBody({ mode, fan, visible, onClose }: { mode: "suspend" | "hide"; fan: FanProfile; visible: number; onClose: (message: string | null) => void }) {
  const mounted = useMountedRef();
  const name = fanDisplayName(fan);
  const [reason, setReason] = useState<SuspensionReason>("spam");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [alsoHide, setAlsoHide] = useState(visible > 0);
  const [running, setRunning] = useState(false);
  const [hidden, setHidden] = useState(0);
  const [phase, setPhase] = useState<"form" | "suspending" | "hiding" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const stop = useRef(false);
  const suspend = mode === "suspend";

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (running) return;
    const checked = suspend ? validateSuspensionNote(note) : { error: null, value: null };
    setNoteError(checked.error);
    if (checked.error) return;
    setRunning(true);
    setError(null);
    const parts: string[] = [];
    try {
      if (suspend) {
        setPhase("suspending");
        await setFanSuspended({ uid: fan.uid, suspended: true, reason, ...(checked.value ? { note: checked.value } : {}) });
        parts.push(`${name} suspenso.`);
      }
      if (!suspend || alsoHide) {
        setPhase("hiding");
        let total = 0;
        for (;;) {
          if (stop.current) break;
          const page = await hideFanComments(fan.uid);
          total += page.hidden;
          if (mounted.current) setHidden(total);
          if (!page.more) break;
        }
        parts.push(hiddenSummary(total));
      }
      if (!mounted.current) return;
      setPhase("done");
      setResult(parts.join(" "));
    } catch (failure) {
      if (!mounted.current) return;
      setError(`${parts.length > 0 ? `${parts.join(" ")} ` : ""}${actionErrorMessage(failure)}`);
      setResult(parts.length > 0 ? parts.join(" ") : null);
      setPhase(mayHaveRunOnServer(failure) || parts.length > 0 ? "done" : "form");
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  function close() {
    if (running) return;
    onClose(phase === "done" ? (result ?? "Feito.") : null);
  }

  return (
    <Dialog
      open
      size="md"
      tone="danger"
      busy={running}
      onClose={close}
      title={suspend ? `Suspender ${name}?` : `Ocultar todos os comentários de ${name}?`}
      description={suspend ? SUSPEND_TEXT : `${HIDE_CONFIRM_TEXT} Os ${visible} comentários visíveis saem do app, 24 por vez.`}
    >
      <form onSubmit={run} noValidate className="flex flex-col gap-4">
        {suspend ? (
          <>
            <Field label="Motivo">
              {({ id, describedBy }) => (
                <SelectInput id={id} describedBy={describedBy} value={reason} disabled={running || phase === "done"} onChange={(event) => setReason(event.target.value as SuspensionReason)}>
                  {SUSPENSION_REASONS.map((item) => (
                    <option key={item} value={item}>
                      {SUSPENSION_REASON_LABELS[item]}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Nota" optional error={noteError ?? undefined} hint="Só a equipe vê, em Logs e auditoria.">
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={note}
                  maxLength={SUSPENSION_NOTE_MAX}
                  disabled={running || phase === "done"}
                  onChange={(event) => {
                    setNote(event.target.value);
                    setNoteError(null);
                  }}
                />
              )}
            </Field>
            {visible > 0 ? (
              <Checkbox label={hideAlsoLabel(visible)} checked={alsoHide} disabled={running || phase === "done"} onChange={(event) => setAlsoHide(event.target.checked)} />
            ) : (
              <p className="m-0 text-[13px] text-fg/65">O fã não tem comentário visível agora.</p>
            )}
          </>
        ) : null}
        <p role="status" className="m-0 text-[13.5px] text-fg/80 empty:hidden">
          {phase === "suspending" ? "Suspendendo..." : phase === "hiding" ? `Ocultando os comentários... ${hidden} até agora` : ""}
        </p>
        {phase === "done" && result ? <Notice tone="success">{result}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {running && phase === "hiding" ? (
            <Button variant="secondary" onClick={() => (stop.current = true)}>
              Parar depois desta página
            </Button>
          ) : null}
          <Button variant="ghost" onClick={close} disabled={running} data-autofocus>
            {phase === "done" ? "Fechar" : "Voltar"}
          </Button>
          {phase !== "done" ? (
            <Button type="submit" variant="danger" busy={running}>
              {running ? (suspend ? "Suspendendo..." : "Ocultando...") : suspend ? "Suspender" : "Ocultar todos"}
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

/** Os itens do fã na fila, abertos e resolvidos. */
function FanQueue({ member, uid, reader, now, round }: { member: StaffMember; uid: string; reader: ContentReader; now: Date; round: number }) {
  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getFanQueuePage(uid, after);
    },
    [uid, round],
  );
  const list = usePagedList(load, (item: QueueItem) => item.commentId, { one: "item carregado", many: "itens carregados" });
  return (
    <SectionCard id="titulo-fila-fa" title="Na fila">
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-fila-fa" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os itens da fila..." />
      ) : list.state.data.length === 0 ? (
        <EmptyState>Nenhum comentário deste fã foi denunciado.</EmptyState>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {list.state.data.map((item) => (
              <li key={item.commentId}>
                <QueueCard item={item} reader={reader} names={names.state.status === "ready" ? names.state.data : null} now={now} linkToFan={false} />
              </li>
            ))}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
    </SectionCard>
  );
}

/** Os comentários do fã, do mais novo, com Ocultar e Reexibir por linha. */
function FanComments({
  member,
  uid,
  canEdit,
  now,
  round,
  onNotice,
  onChanged,
}: {
  member: StaffMember;
  uid: string;
  canEdit: boolean;
  now: Date;
  round: number;
  onNotice: Notify;
  onChanged: (message: string) => void;
}) {
  const names = useLoad(useCallback(() => getArtistNames(member), [member]));
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getFanCommentsPage(uid, after);
    },
    [uid, round],
  );
  const list = usePagedList(load, (item: CommentRow) => `${item.postId}/${item.commentId}`, { one: "comentário carregado", many: "comentários carregados" });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  function moderate(item: CommentRow, action: "hide" | "restore") {
    const hide = action === "hide";
    setConfirm({
      title: hide ? "Ocultar o comentário?" : "Reexibir o comentário?",
      body: hide ? HIDE_CONFIRM_TEXT : "O comentário volta ao app para todos.",
      confirmLabel: hide ? "Ocultar" : "Reexibir",
      busyLabel: hide ? "Ocultando..." : "Reexibindo...",
      cancelLabel: "Voltar",
      tone: hide ? "danger" : "default",
      action: () => moderateComment({ postId: item.postId, commentId: item.commentId, action }),
      successMessage: hide ? "Comentário ocultado." : "Comentário de volta no app.",
      onUncertain: () => onNotice("info", "Confira a lista: a mudança pode ter sido gravada."),
    });
  }

  const artistNames = names.state.status === "ready" ? names.state.data : null;
  return (
    <SectionCard id="titulo-comentarios-fa" title="Comentários">
      {list.state.status === "error" ? (
        <LoadError message={list.state.message} headingId="titulo-comentarios-fa" onRetry={list.reload} />
      ) : list.state.status === "loading" ? (
        <LoadingRow label="Carregando os comentários..." />
      ) : list.state.data.length === 0 ? (
        <EmptyState>Nenhum comentário.</EmptyState>
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {list.state.data.map((item) => {
              const key = `${item.postId}/${item.commentId}`;
              return (
                <li key={key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="m-0 text-[14px] leading-relaxed whitespace-pre-line text-fg/90">{item.text}</p>
                    <p className="m-0 text-[12.5px] text-fg/60">
                      {shortWhen(item.createdAt, now)} · {artistNameOf(artistNames, item.artistId ?? "")}
                      {item.postText ? ` · no post "${item.postText}"` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.status === "hidden" ? <Badge tone="danger">Oculto</Badge> : null}
                    {canEdit ? (
                      item.status === "hidden" ? (
                        <Button size="sm" variant="secondary" onClick={() => moderate(item, "restore")}>
                          Reexibir
                        </Button>
                      ) : (
                        <Button size="sm" variant="danger" onClick={() => moderate(item, "hide")}>
                          Ocultar
                        </Button>
                      )
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <LoadMore onClick={list.loadMore} busy={list.loadingMore} hasMore={list.hasMore} announcement={list.announcement} error={list.loadMoreError} />
        </>
      )}
      <ConfirmDialog
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
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
    </SectionCard>
  );
}

