"use client";

import { ArrowLeft, AtSign, Eraser, EyeOff, ImageOff, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { ProfileReportCard, profileDecisionRequest, type ProfileDecision } from "@/components/moderacao/profile-report-card";
import { QueueCard, shortWhen } from "@/components/moderacao/queue-card";
import { FanAvatar } from "@/components/painel/fan-avatar";
import { FanBio, FanSocialLinks } from "@/components/painel/fan-socials";
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
import { Checkbox, Field, Radio, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useLoad } from "@/components/ui/use-load";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { usePagedList } from "@/components/ui/use-paged-list";
import { artistNameOf, getArtistNames } from "@/lib/artist-names-data";
import { UNCERTAIN_RETRY_TEXT, actionErrorMessage, callableErrorMessage, mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import { getFanCommentsPage, type CommentRow } from "@/lib/fan-data";
import { SUSPENSION_REASONS, SUSPENSION_REASON_LABELS, fanDisplayName, suspensionReasonLabel, type FanProfile, type SuspensionReason } from "@/lib/fan-profile";
import { getFanProfile } from "@/lib/fan-profile-data";
import type { PageCursor } from "@/lib/firestore-page";
import { clearFanPhoto, clearFanProfileText, hideFanComments, moderateComment, resetFanUsername, setFanSuspended } from "@/lib/moderation-api";
import {
  CLEAR_BIO_SOCIALS_TEXT,
  CLEAR_PHOTO_TEXT,
  FAN_NOT_FOUND_TEXT,
  HIDE_CONFIRM_TEXT,
  PROFILE_TEXT_FIELDS,
  PROFILE_TEXT_FIELD_LABELS,
  SUSPENSION_NOTE_MAX,
  SUSPEND_TEXT,
  USERNAME_RESET_REASONS,
  USERNAME_RESET_REASON_HINTS,
  USERNAME_RESET_REASON_LABELS,
  clearableProfileFields,
  clearedBeforeText,
  clearedProfileText,
  hiddenSummary,
  hideAlsoLabel,
  resetUsernameDoneText,
  resetUsernameText,
  usernameChangedAfterUncertainText,
  usernameLockText,
  validateSuspensionNote,
  type ProfileQueueItem,
  type ProfileTextField,
  type QueueItem,
  type UsernameResetReason,
} from "@/lib/moderation";
import { countVisibleComments, createContentReader, getFanQueuePage, getProfileQueueItem, type ContentReader } from "@/lib/moderation-data";
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
  // Uma instância do ConfirmDialog por pedido: o pedido seguinte nunca herda o erro, o bloqueio ou o "Tentar de novo" do anterior.
  const [confirmKey, setConfirmKey] = useState(0);
  const [suspending, setSuspending] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [clearingText, setClearingText] = useState(false);
  const [resettingUsername, setResettingUsername] = useState(false);
  // Um pedido que foi ao servidor pede a releitura do fã, que só sai com nenhum
  // diálogo aberto: ler antes poria a página em "Carregando", e o diálogo
  // sairia da tela perdendo o que a pessoa escolheu (ao voltar limpo, o pedido
  // dele poderia sair duas vezes). Ela é marcada antes da resposta, para a
  // perda da permissão no meio do pedido também ler de novo. É estado, e não
  // ref, porque a releitura (abaixo) olha para ela na renderização.
  const [pendingRefresh, setPendingRefresh] = useState(false);
  // A permissão de editar caiu com um diálogo aberto (o acesso chega em tempo
  // real): os diálogos fecham. A confirmação ganha uma instância nova, para a
  // resposta de um pedido que já tinha saído chegar como órfã (só marca a
  // releitura), sem fechar nem mudar outra confirmação. O ajuste é feito na
  // renderização, comparando com a permissão de antes (o padrão do React para
  // reagir a uma mudança de prop sem efeito).
  const [editSeen, setEditSeen] = useState(canEdit);
  if (editSeen !== canEdit) {
    setEditSeen(canEdit);
    if (!canEdit) {
      setConfirm(null);
      setConfirmKey((value) => value + 1);
      setResettingUsername(false);
      setClearingText(false);
      setSuspending(false);
      setHiding(false);
    }
  }
  // A releitura pendente sai quando nenhum diálogo está aberto: no fechamento
  // de um diálogo, na perda da permissão ou na resposta que chegou com o
  // diálogo já fora da tela.
  const dialogOpen = confirm !== null || resettingUsername || clearingText || suspending || hiding;
  if (pendingRefresh && !dialogOpen) {
    setPendingRefresh(false);
    setReader(createContentReader());
    setRound((value) => value + 1);
  }

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
  // A denúncia de perfil do fã, pelo id (29.7); sem item, nada sobre perfil.
  const profileReport = useLoad(
    useCallback(() => {
      void round;
      return getProfileQueueItem(uid);
    }, [uid, round]),
  );
  const fan = profile.state.status === "ready" ? profile.state.data : null;
  const visibleCount = visible.state.status === "ready" ? visible.state.data : null;
  const date = new Date(now);

  const show: Notify = (tone, text) => setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone, text }));

  function refresh() {
    setPendingRefresh(false);
    setNow(Date.now());
    setReader(createContentReader());
    setRound((value) => value + 1);
  }

  /**
   * Um pedido saiu para o servidor (ou o item mudou por fora, ou a resposta
   * chegou com o diálogo fora da tela): a releitura sai quando nenhum diálogo
   * estiver aberto.
   */
  function markStale() {
    setPendingRefresh(true);
  }

  /** O pedido do ConfirmDialog marca a releitura antes de ir ao servidor. */
  function sent(action: () => Promise<unknown>): () => Promise<unknown> {
    return () => {
      markStale();
      return action();
    };
  }

  /** Abre um pedido novo no ConfirmDialog, numa instância nova; a resposta que chegar com ela fora da tela só marca a releitura. */
  function ask(request: ConfirmRequest) {
    setConfirm({ ...request, onOrphan: markStale });
    setConfirmKey((value) => value + 1);
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
  const clearable = clearableProfileFields(fan);
  const usernameLock = usernameLockText(fan, date);

  function askUnsuspend(target: FanProfile) {
    ask({
      title: `Tirar a suspensão de ${name}?`,
      body: "O fã volta a comentar, curtir, ganhar pontos e mudar o perfil.",
      confirmLabel: "Tirar suspensão",
      busyLabel: "Tirando...",
      cancelLabel: "Voltar",
      tone: "default",
      action: sent(() => setFanSuspended({ uid: target.uid, suspended: false })),
      successMessage: `Suspensão de ${name} tirada.`,
      onUncertain: markStale,
      uncertainText: UNCERTAIN_RETRY_TEXT,
    });
  }

  function decideProfile(item: ProfileQueueItem, decision: ProfileDecision, label: string) {
    const request = profileDecisionRequest(item, decision, label, markStale);
    ask({ ...request, action: sent(request.action), onUncertain: markStale, uncertainText: UNCERTAIN_RETRY_TEXT });
  }

  function askClearPhoto(target: FanProfile) {
    ask({
      title: `Tirar a foto de ${name}?`,
      body: CLEAR_PHOTO_TEXT,
      confirmLabel: "Tirar a foto",
      busyLabel: "Tirando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: sent(() => clearFanPhoto(target.uid)),
      successMessage: `A foto de ${name} foi tirada.`,
      onUncertain: markStale,
      uncertainText: UNCERTAIN_RETRY_TEXT,
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
            {usernameLock ? <Detail term="Troca do @">{usernameLock}</Detail> : null}
            <Detail term="Identificador">
              <span className="font-mono text-[13px]">{fan.uid}</span>
            </Detail>
            <Detail term="Bio" wide>
              <FanBio bio={fan.bio} />
            </Detail>
            <Detail term="Redes" wide>
              <FanSocialLinks socials={fan.socials} />
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
                  <Button size="sm" variant="secondary" onClick={() => setResettingUsername(true)} aria-haspopup="dialog">
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
                {clearable.length > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => setClearingText(true)} aria-haspopup="dialog">
                    <Eraser aria-hidden="true" className="size-4" />
                    Apagar bio e redes
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </SectionCard>

      {profileReport.state.status === "error" ? (
        <SectionCard id="titulo-denuncia-perfil" title="Denúncia de perfil">
          <LoadError message={profileReport.state.message} headingId="titulo-denuncia-perfil" onRetry={profileReport.reload} />
        </SectionCard>
      ) : profileReport.state.status === "ready" && profileReport.state.data ? (
        <SectionCard id="titulo-denuncia-perfil" title="Denúncia de perfil">
          <ProfileReportCard item={profileReport.state.data} now={date} canEdit={canEdit} linkToFan={false} profile={fan} refreshKey={round} onDecide={decideProfile} />
        </SectionCard>
      ) : null}

      <FanQueue member={member} uid={uid} reader={reader} now={date} round={round} />
      <FanComments
        member={member}
        uid={uid}
        canEdit={canEdit}
        now={date}
        round={round}
        onNotice={show}
        onAsk={(request) => ask({ ...request, action: sent(request.action) })}
      />

      <ConfirmDialog
        key={confirmKey}
        request={canEdit ? confirm : null}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          changed(message);
        }}
      />
      {canEdit && resettingUsername ? (
        <ResetUsernameDialog
          fan={fan}
          onClose={() => setResettingUsername(false)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(message) => {
            setResettingUsername(false);
            changed(message);
          }}
        />
      ) : null}
      {canEdit && clearingText ? (
        <ClearProfileTextDialog
          fan={fan}
          onClose={() => setClearingText(false)}
          onSend={markStale}
          onOrphan={markStale}
          onDone={(cleared, message) => {
            setClearingText(false);
            if (cleared.length === 0) {
              show("info", message);
              refresh();
            } else {
              changed(message);
            }
          }}
        />
      ) : null}
      <HideCommentsDialog
        open={canEdit && (suspending || hiding)}
        mode={suspending ? "suspend" : "hide"}
        fan={fan}
        visible={visibleCount ?? 0}
        onSend={markStale}
        onOrphan={markStale}
        onClose={(message, reread) => {
          setSuspending(false);
          setHiding(false);
          if (message) changed(message);
          else if (reread) refresh();
        }}
      />
    </>
  );
}

/**
 * "Trocar o @" (32.1, decisões 1 a 5): o motivo decide o prazo. Com
 * `moderation` (a marcada), o fã só escolhe outro @ daqui a 30 dias; com
 * `central`, na hora. O texto acompanha a escolha, e o aviso de depois vem do
 * `changeableAt` da resposta.
 *
 * Resposta incerta: o motivo trava e "Tentar de novo" repete a mesma troca,
 * com o @ que o diálogo abriu. Se a primeira já tinha passado, o servidor
 * recusa o @ velho (`username-changed`), e o diálogo diz isso. A página lê o
 * fã de novo quando ele fecha (`onSend` marca a releitura antes do pedido).
 */
function ResetUsernameDialog({
  fan,
  onClose,
  onDone,
  onSend,
  onOrphan,
}: {
  fan: FanProfile;
  onClose: () => void;
  onDone: (message: string) => void;
  onSend: () => void;
  /** A resposta chegou com o diálogo fora da tela (a permissão caiu no meio): a página marca a releitura. */
  onOrphan: () => void;
}) {
  const mounted = useMountedRef();
  const name = fanDisplayName(fan);
  const [username] = useState(fan.username);
  const [reason, setReason] = useState<UsernameResetReason>("moderation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  // A nova tentativa achou o @ já trocado: o aviso fica, e o botão de trocar sai.
  const [doneText, setDoneText] = useState<string | null>(null);
  const done = doneText !== null;
  const doneId = useId();
  const footer = useRef<HTMLDivElement>(null);

  // O botão de trocar saiu com o foco nele: o foco vai para o de fechar.
  useEffect(() => {
    if (done) footer.current?.querySelector<HTMLElement>("button")?.focus();
  }, [done]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setError(null);
    onSend();
    try {
      const result = await resetFanUsername({ uid: fan.uid, username, reason });
      if (!mounted.current) return onOrphan();
      onDone(resetUsernameDoneText(username, name, result.changeableAt));
    } catch (failure) {
      if (!mounted.current) return onOrphan();
      if (mayHaveRunOnServer(failure)) {
        setUncertain(true);
        setError(UNCERTAIN_RETRY_TEXT);
      } else if (uncertain && reasonOf(failure) === "username-changed") {
        setDoneText(usernameChangedAfterUncertainText(username));
      } else {
        setError(callableErrorMessage(failure));
      }
      setBusy(false);
    }
  }

  return (
    <Dialog open size="sm" tone="danger" busy={busy} onClose={() => !busy && onClose()} title={`Trocar o @ de ${name}?`} description={resetUsernameText(username, reason)}>
      <form onSubmit={run} noValidate className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/75">Motivo</legend>
          {USERNAME_RESET_REASONS.map((item) => (
            <Radio
              key={item}
              name="motivo-troca-do-arroba"
              value={item}
              label={USERNAME_RESET_REASON_LABELS[item]}
              hint={USERNAME_RESET_REASON_HINTS[item]}
              checked={reason === item}
              disabled={busy || uncertain}
              onChange={() => setReason(item)}
            />
          ))}
        </fieldset>
        {/* O aviso final não se anuncia sozinho (já nasce preenchido): ele vai ligado ao "Fechar", que recebe o foco. */}
        {doneText ? (
          <Notice id={doneId} tone="info" announce={false}>
            {doneText}
          </Notice>
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : null}
        <div ref={footer} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus aria-describedby={done ? doneId : undefined}>
            {done ? "Fechar" : "Voltar"}
          </Button>
          {done ? null : (
            <Button type="submit" variant="danger" busy={busy}>
              {busy ? "Trocando..." : uncertain ? "Tentar de novo" : "Trocar o @"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * "Apagar bio e redes" (28.6): a escolha dos campos que têm o que apagar,
 * todos marcados de início. O texto apagado não fica guardado; a auditoria
 * leva só os campos.
 *
 * Resposta incerta: a escolha trava e "Tentar de novo" repete o mesmo pedido.
 * Se a primeira já tinha passado, nada sai de novo (`cleared` vazio), e o
 * aviso diz isso. A página lê o fã de novo quando o diálogo fecha (`onSend`
 * marca a releitura antes do pedido).
 */
function ClearProfileTextDialog({
  fan,
  onClose,
  onDone,
  onSend,
  onOrphan,
}: {
  fan: FanProfile;
  onClose: () => void;
  onDone: (cleared: ProfileTextField[], message: string) => void;
  onSend: () => void;
  onOrphan: () => void;
}) {
  const mounted = useMountedRef();
  const name = fanDisplayName(fan);
  const [options] = useState(() => clearableProfileFields(fan));
  const [fields, setFields] = useState<ProfileTextField[]>(options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const bio = options.includes("bio");
  const socials = options.includes("socials");

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (busy || fields.length === 0) return;
    setBusy(true);
    setError(null);
    const requested = PROFILE_TEXT_FIELDS.filter((field) => fields.includes(field));
    onSend();
    try {
      const result = await clearFanProfileText({ uid: fan.uid, fields: requested });
      if (!mounted.current) return onOrphan();
      const before = uncertain && result.cleared.length === 0;
      onDone(result.cleared, before ? clearedBeforeText(requested) : clearedProfileText(name, result.cleared));
    } catch (failure) {
      if (!mounted.current) return onOrphan();
      if (mayHaveRunOnServer(failure)) {
        setUncertain(true);
        setError(UNCERTAIN_RETRY_TEXT);
      } else {
        setError(callableErrorMessage(failure));
      }
      setBusy(false);
    }
  }

  function toggle(field: ProfileTextField, checked: boolean) {
    setFields((current) => (checked ? [...current, field] : current.filter((item) => item !== field)));
  }

  return (
    <Dialog
      open
      size="sm"
      tone="danger"
      busy={busy}
      onClose={() => !busy && onClose()}
      title={bio && socials ? `Apagar a bio e as redes de ${name}?` : bio ? `Apagar a bio de ${name}?` : `Apagar as redes de ${name}?`}
      description={CLEAR_BIO_SOCIALS_TEXT}
    >
      <form onSubmit={run} noValidate className="flex flex-col gap-4">
        {options.length > 1 ? (
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/75">O que apagar</legend>
            {options.map((field) => (
              <Checkbox
                key={field}
                label={PROFILE_TEXT_FIELD_LABELS[field]}
                checked={fields.includes(field)}
                disabled={busy || uncertain}
                onChange={(event) => toggle(field, event.target.checked)}
              />
            ))}
          </fieldset>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>
            Voltar
          </Button>
          <Button type="submit" variant="danger" busy={busy} disabled={fields.length === 0}>
            {busy ? "Apagando..." : uncertain ? "Tentar de novo" : "Apagar"}
          </Button>
        </div>
      </form>
    </Dialog>
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
  onSend,
  onOrphan,
  onClose,
}: {
  open: boolean;
  mode: "suspend" | "hide";
  fan: FanProfile;
  visible: number;
  onSend: () => void;
  onOrphan: () => void;
  onClose: (message: string | null, reread: boolean) => void;
}) {
  return open ? <HideCommentsBody key={mode} mode={mode} fan={fan} visible={visible} onSend={onSend} onOrphan={onOrphan} onClose={onClose} /> : null;
}

/**
 * Fechar depois de rodar lê o fã de novo; a frase de sucesso só sai com algo
 * confirmado (a suspensão ou os comentários contados). A falha incerta sem
 * nada confirmado fecha só com a releitura.
 */
function HideCommentsBody({
  mode,
  fan,
  visible,
  onSend,
  onOrphan,
  onClose,
}: {
  mode: "suspend" | "hide";
  fan: FanProfile;
  visible: number;
  onSend: () => void;
  /** O diálogo saiu da tela no meio (a permissão caiu): quando o laço para, a página marca a releitura. */
  onOrphan: () => void;
  onClose: (message: string | null, reread: boolean) => void;
}) {
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
  const resultId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  // No fim, o botão que tinha o foco (o de ocultar ou o de parar) sai da tela: o foco vai para o "Fechar".
  useEffect(() => {
    if (phase === "done") closeButton.current?.focus();
  }, [phase]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (running) return;
    const checked = suspend ? validateSuspensionNote(note) : { error: null, value: null };
    setNoteError(checked.error);
    if (checked.error) return;
    setRunning(true);
    setError(null);
    const parts: string[] = [];
    // Fora do try: com a falha no meio, o que já saiu entra no resumo, e o fechamento relê a página.
    let total = 0;
    let summarized = false;
    onSend();
    try {
      if (suspend) {
        setPhase("suspending");
        await setFanSuspended({ uid: fan.uid, suspended: true, reason, ...(checked.value ? { note: checked.value } : {}) });
        parts.push(`${name} suspenso.`);
      }
      if (!suspend || alsoHide) {
        setPhase("hiding");
        for (;;) {
          // Fora da tela (a permissão caiu, por exemplo), o laço para de chamar o servidor.
          if (stop.current || !mounted.current) break;
          const page = await hideFanComments(fan.uid);
          total += page.hidden;
          if (mounted.current) setHidden(total);
          if (!page.more) break;
        }
        parts.push(hiddenSummary(total));
        summarized = true;
      }
      if (!mounted.current) return onOrphan();
      setPhase("done");
      setResult(parts.join(" "));
    } catch (failure) {
      if (!mounted.current) return onOrphan();
      if (total > 0 && !summarized) parts.push(hiddenSummary(total));
      // O que já saiu vai no aviso verde (o resultado); o vermelho diz só o erro.
      setError(actionErrorMessage(failure));
      setResult(parts.length > 0 ? parts.join(" ") : null);
      setPhase(mayHaveRunOnServer(failure) || parts.length > 0 ? "done" : "form");
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  function close() {
    if (running) return;
    onClose(phase === "done" ? result : null, phase === "done");
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
        {/* O resumo não se anuncia sozinho (nasce com a troca de fase): ele vai ligado ao "Fechar", que recebe o foco. */}
        {phase === "done" && result ? (
          <Notice id={resultId} tone="success" announce={false}>
            {result}
          </Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {running && phase === "hiding" ? (
            <Button variant="secondary" onClick={() => (stop.current = true)}>
              Parar depois desta página
            </Button>
          ) : null}
          <Button
            ref={closeButton}
            variant="ghost"
            onClick={close}
            disabled={running}
            data-autofocus
            aria-describedby={phase === "done" && result ? resultId : undefined}
          >
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
  const seesArtists = canSeeSection(member, "artists");
  const names = useLoad(useCallback(() => getArtistNames(seesArtists), [seesArtists]));
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
  onAsk,
}: {
  member: StaffMember;
  uid: string;
  canEdit: boolean;
  now: Date;
  round: number;
  onNotice: Notify;
  /**
   * A confirmação abre na página, como as outras: ela marca a releitura antes
   * do pedido, fecha na perda da permissão e cuida da resposta que chega com o
   * diálogo já fora da tela.
   */
  onAsk: (request: ConfirmRequest) => void;
}) {
  const seesArtists = canSeeSection(member, "artists");
  const names = useLoad(useCallback(() => getArtistNames(seesArtists), [seesArtists]));
  const load = useCallback(
    (after: PageCursor | null) => {
      void round;
      return getFanCommentsPage(uid, after);
    },
    [uid, round],
  );
  const list = usePagedList(load, (item: CommentRow) => `${item.postId}/${item.commentId}`, { one: "comentário carregado", many: "comentários carregados" });
  function moderate(item: CommentRow, action: "hide" | "restore") {
    const hide = action === "hide";
    onAsk({
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
    </SectionCard>
  );
}

