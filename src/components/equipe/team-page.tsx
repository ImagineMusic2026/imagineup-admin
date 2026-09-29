"use client";

import { LoaderCircle, MailCheck, MailWarning, MailX, Pencil, Power, RefreshCw, UserMinus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { InviteDialog } from "@/components/equipe/invite-dialog";
import { InviteResult } from "@/components/equipe/invite-result";
import { ConfirmDialog, EditMemberDialog, type ConfirmRequest } from "@/components/equipe/member-dialogs";
import { PageHeader } from "@/components/painel/page-header";
import { NoAccess } from "@/components/painel/placeholders";
import { ActionsMenu, type MenuAction } from "@/components/ui/actions-menu";
import { Badge, InitialsAvatar, RoleBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { callableErrorMessage, firestoreErrorMessage } from "@/lib/errors";
import {
  TEAM_PAGE,
  canManageTeam,
  deactivateMemberText,
  initialsOf,
  inviteExpiryLabel,
  isInviteExpired,
  resendResultTitle,
  sectionsSummary,
  type EmailStatus,
  type StaffInvite,
  type StaffMember,
} from "@/lib/staff";
import { cancelStaffInvite, removeStaffMember, resendStaffInvite, setStaffMemberActive, type InviteLinkResult } from "@/lib/staff-api";
import { useStaffMember } from "@/lib/staff-context";
import { subscribeToPendingInvites, subscribeToTeam } from "@/lib/staff-data";

/** /equipe: só admin. Lista a equipe e os convites pendentes, em tempo real. */
export function TeamPage() {
  const self = useStaffMember();
  if (!canManageTeam(self)) {
    return (
      <>
        <PageHeader title={TEAM_PAGE.label} />
        <NoAccess />
      </>
    );
  }
  return <TeamManager self={self} />;
}

type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

/**
 * Lista em tempo real. Depois de um erro o Firestore encerra a escuta de vez,
 * então `retry` abre uma escuta nova (ex.: regras ainda sendo publicadas).
 */
function useLiveList<T>(
  subscribe: (onChange: (data: T) => void, onError: (error: unknown) => void) => () => void,
): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(
    () =>
      subscribe(
        (data) => setState({ status: "ready", data }),
        (error) => setState({ status: "error", message: firestoreErrorMessage(error) }),
      ),
    [subscribe, attempt],
  );
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  return [state, retry];
}

/** Relógio de minuto em minuto, para "Vence em..." não envelhecer na tela. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function nameOf(member: Pick<StaffMember, "displayName" | "email">): string {
  return member.displayName || member.email;
}

function TeamManager({ self }: { self: StaffMember }) {
  const [members, retryMembers] = useLiveList(subscribeToTeam);
  const [invites, retryInvites] = useLiveList(subscribeToPendingInvites);
  const now = useMinuteClock();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [resent, setResent] = useState<{ email: string; result: InviteLinkResult } | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function memberActions(member: StaffMember): MenuAction[] {
    const name = nameOf(member);
    const actions: MenuAction[] = [{ label: "Alterar nível e seções", icon: Pencil, onSelect: () => setEditing(member) }];
    if (member.status === "active") {
      actions.push({
        label: "Desativar acesso",
        icon: Power,
        onSelect: () =>
          setConfirm({
            title: "Desativar acesso?",
            body: deactivateMemberText(name, member.accountCreatedByInvite),
            confirmLabel: "Desativar acesso",
            busyLabel: "Desativando...",
            tone: "default",
            action: () => setStaffMemberActive(member.uid, false),
            successMessage: `Acesso de ${name} desativado.`,
          }),
      });
    } else if (member.status === "disabled") {
      actions.push({
        label: "Reativar acesso",
        icon: Power,
        onSelect: () =>
          setConfirm({
            title: "Reativar acesso?",
            body: `${name} volta a entrar no painel, com o mesmo nível e as mesmas seções de antes.`,
            confirmLabel: "Reativar acesso",
            busyLabel: "Reativando...",
            tone: "default",
            action: () => setStaffMemberActive(member.uid, true),
            successMessage: `Acesso de ${name} reativado.`,
          }),
      });
    }
    actions.push({
      label: "Remover da equipe",
      icon: UserMinus,
      tone: "danger",
      onSelect: () =>
        setConfirm({
          title: "Remover da equipe?",
          body: (
            <>
              <p className="m-0">{name} perde o acesso ao painel na hora. Para voltar, só com um novo convite.</p>
              <p className="mt-2 mb-0">
                Se a pessoa também usa o app ImagineUP como fã, a conta de fã continua existindo. Se a conta foi criada só para o painel,
                o login dela é apagado.
              </p>
            </>
          ),
          confirmLabel: "Remover da equipe",
          busyLabel: "Removendo...",
          tone: "danger",
          action: () => removeStaffMember(member.uid),
          successMessage: `${name} saiu da equipe.`,
        }),
    });
    return actions;
  }

  async function resend(invite: StaffInvite) {
    setInviteError(null);
    setFlash(null);
    setResendingId(invite.id);
    try {
      const result = await resendStaffInvite(invite.id);
      setResent({ email: invite.email, result });
    } catch (failure) {
      setInviteError(callableErrorMessage(failure));
    } finally {
      setResendingId(null);
    }
  }

  function askCancel(invite: StaffInvite) {
    setInviteError(null);
    setConfirm({
      title: "Cancelar convite?",
      body: `O link enviado para ${invite.email} para de funcionar. Você pode convidar de novo quando quiser.`,
      confirmLabel: "Cancelar convite",
      busyLabel: "Cancelando...",
      cancelLabel: "Voltar",
      tone: "danger",
      action: () => cancelStaffInvite(invite.id),
      successMessage: `Convite para ${invite.email} cancelado.`,
    });
  }

  return (
    <>
      <PageHeader
        title={TEAM_PAGE.label}
        subtitle={TEAM_PAGE.description}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setFlash(null);
              setInviteOpen(true);
            }}
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Convidar pessoa
          </Button>
        }
      />

      <div aria-live="polite" className="empty:-mt-6">
        {flash ? (
          <Notice tone="success" announce={false}>
            {flash}
          </Notice>
        ) : null}
      </div>

      <MembersSection state={members} onRetry={retryMembers} self={self} actionsFor={memberActions} />

      <InvitesSection
        state={invites}
        onRetry={retryInvites}
        now={now}
        resendingId={resendingId}
        error={inviteError}
        onResend={resend}
        onCancel={askCancel}
      />

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <EditMemberDialog
        member={editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          setFlash(message);
        }}
      />

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        onDone={(message) => {
          setConfirm(null);
          setFlash(message);
        }}
      />

      <Dialog
        open={Boolean(resent)}
        onClose={() => setResent(null)}
        size="lg"
        title={resent ? resendResultTitle(resent.result.emailStatus) : ""}
      >
        {resent ? <InviteResult email={resent.email} result={resent.result} resent onDone={() => setResent(null)} /> : null}
      </Dialog>
    </>
  );
}

function Card({ id, title, meta, children }: { id: string; title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id={id} tabIndex={-1} className="m-0 font-display text-base font-semibold outline-none">
          {title}
        </h2>
        {meta ? <p className="m-0 text-[13px] text-fg/60">{meta}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Erro de leitura com "Tentar de novo". O botão some ao tentar, então o foco
 * vai para o título da seção, e o "Carregando..." é lido em seguida.
 */
function LoadError({ message, headingId, onRetry }: { message: string; headingId: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-5">
      <Notice tone="error" className="self-stretch">
        {message}
      </Notice>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          onRetry();
          requestAnimationFrame(() => document.getElementById(headingId)?.focus());
        }}
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Tentar de novo
      </Button>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <p role="status" className="m-0 flex items-center gap-2 px-5 py-6 text-sm text-fg/65">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </p>
  );
}

const MEMBER_GRID = "lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_44px] lg:items-center lg:gap-4";

function MembersSection({
  state,
  onRetry,
  self,
  actionsFor,
}: {
  state: Loadable<StaffMember[]>;
  onRetry: () => void;
  self: StaffMember;
  actionsFor: (member: StaffMember) => MenuAction[];
}) {
  const count = state.status === "ready" ? state.data.length : null;
  return (
    <Card
      id="titulo-membros"
      title="Membros"
      meta={count === null ? null : `${count} ${count === 1 ? "pessoa" : "pessoas"}`}
    >
      {state.status === "loading" ? <LoadingRow label="Carregando a equipe..." /> : null}
      {state.status === "error" ? <LoadError message={state.message} headingId="titulo-membros" onRetry={onRetry} /> : null}
      {state.status === "ready" ? (
        <>
          <div aria-hidden="true" className={cx("hidden px-5 pt-3 pb-2 group-label text-fg/50", MEMBER_GRID)}>
            <span>Pessoa</span>
            <span>Nível</span>
            <span>Seções</span>
            <span>Status</span>
            <span />
          </div>
          <ul className="m-0 list-none p-0">
            {state.data.map((member) => {
              const isSelf = member.uid === self.uid;
              const name = nameOf(member);
              return (
                <li key={member.uid} className={cx("relative border-t border-line px-5 py-4 first:border-t-0 lg:first:border-t lg:py-3.5", MEMBER_GRID)}>
                  <div className="flex min-w-0 items-center gap-3 pr-10 lg:pr-0">
                    <InitialsAvatar initials={initialsOf(member.displayName, member.email)} />
                    <div className="min-w-0">
                      <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                        <span className="min-w-0 truncate">{name}</span>
                        {isSelf ? <Badge tone="muted">Você</Badge> : null}
                      </p>
                      <p className="m-0 truncate text-[13px] text-fg/60">{member.email}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 lg:mt-0">
                    <span className="sr-only">Nível: </span>
                    <RoleBadge role={member.role} />
                    <span className="lg:hidden">
                      <StatusBadge status={member.status} />
                    </span>
                  </div>
                  <p className="m-0 mt-2 text-[13px] text-fg/70 lg:mt-0">
                    <span className="sr-only">Seções: </span>
                    {sectionsSummary(member.role, member.sections)}
                  </p>
                  <div className="hidden lg:block">
                    <span className="sr-only">Status: </span>
                    <StatusBadge status={member.status} />
                  </div>
                  <div className="absolute top-3.5 right-3 lg:static lg:flex lg:justify-end">
                    {isSelf ? null : <ActionsMenu label={`Ações para ${name}`} actions={actionsFor(member)} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

const EMAIL_STATUS: Record<EmailStatus, { label: string; icon: typeof MailCheck; className: string }> = {
  sent: { label: "E-mail enviado", icon: MailCheck, className: "text-fg/70" },
  failed: { label: "E-mail não saiu", icon: MailX, className: "text-danger" },
  skipped: { label: "E-mail não configurado", icon: MailWarning, className: "text-fg/70" },
};

const INVITE_GRID = "lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4";

function InvitesSection({
  state,
  onRetry,
  now,
  resendingId,
  error,
  onResend,
  onCancel,
}: {
  state: Loadable<StaffInvite[]>;
  onRetry: () => void;
  now: Date;
  resendingId: string | null;
  error: string | null;
  onResend: (invite: StaffInvite) => void;
  onCancel: (invite: StaffInvite) => void;
}) {
  const count = state.status === "ready" ? state.data.length : null;
  return (
    <Card id="titulo-convites" title="Convites pendentes" meta={count === null ? null : `${count} ${count === 1 ? "convite" : "convites"}`}>
      {error ? (
        <div className="px-5 pt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {state.status === "loading" ? <LoadingRow label="Carregando os convites..." /> : null}
      {state.status === "error" ? <LoadError message={state.message} headingId="titulo-convites" onRetry={onRetry} /> : null}
      {state.status === "ready" && state.data.length === 0 ? (
        <p className="m-0 px-5 py-6 text-sm text-fg/65">Nenhum convite pendente.</p>
      ) : null}
      {state.status === "ready" && state.data.length > 0 ? (
        <>
          <div aria-hidden="true" className={cx("hidden px-5 pt-3 pb-2 group-label text-fg/50", INVITE_GRID)}>
            <span>E-mail</span>
            <span>Nível</span>
            <span>Validade</span>
            <span>Envio</span>
            <span className="w-[196px]" />
          </div>
          <ul className="m-0 list-none p-0">
            {state.data.map((invite) => {
              const expired = isInviteExpired(invite.expiresAt, now);
              const mail = EMAIL_STATUS[invite.emailStatus];
              const MailIcon = mail.icon;
              const resending = resendingId === invite.id;
              return (
                <li key={invite.id} className={cx("border-t border-line px-5 py-4 first:border-t-0 lg:first:border-t lg:py-3.5", INVITE_GRID)}>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-fg">{invite.email}</p>
                    <p className="m-0 truncate text-[13px] text-fg/60">
                      {invite.suggestedName ? `${invite.suggestedName} · ` : ""}
                      {invite.invitedByName ? `convite de ${invite.invitedByName}` : "convite"}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 lg:mt-0">
                    <span className="sr-only">Nível: </span>
                    <RoleBadge role={invite.role} />
                  </div>
                  <p className={cx("m-0 mt-2 text-[13px] lg:mt-0", expired ? "font-semibold text-danger" : "text-fg/75")}>
                    <span className="sr-only">Validade: </span>
                    {inviteExpiryLabel(invite.expiresAt, now)}
                  </p>
                  <p className={cx("m-0 mt-1 flex items-center gap-1.5 text-[13px] lg:mt-0", mail.className)}>
                    <MailIcon aria-hidden="true" className="size-4 shrink-0" />
                    {mail.label}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 lg:mt-0 lg:w-[196px] lg:justify-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      busy={resending}
                      disabled={Boolean(resendingId) && !resending}
                      onClick={() => onResend(invite)}
                      aria-label={`Reenviar convite para ${invite.email}`}
                    >
                      {resending ? null : <RefreshCw aria-hidden="true" className="size-3.5" />}
                      {resending ? "Reenviando..." : "Reenviar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resending}
                      onClick={() => onCancel(invite)}
                      aria-label={`Cancelar convite para ${invite.email}`}
                    >
                      Cancelar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
