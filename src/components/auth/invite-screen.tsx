"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { RoleBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, PasswordInput, TextInput } from "@/components/ui/field";
import { NotConfigured } from "@/components/ui/not-configured";
import { Notice } from "@/components/ui/notice";
import { authErrorMessage, callableErrorMessage, errorMessage, readError } from "@/lib/errors";
import { isFirebaseConfigured } from "@/lib/firebase";
import {
  INVITE_PROBLEM_COPY,
  inviteProblemOf,
  inviteSubtitle,
  isAccountExistsError,
  isWrongPasswordError,
  readInviteToken,
  type InviteProblem,
} from "@/lib/invite";
import { requestPasswordReset, signInForInvite, signOutUser } from "@/lib/session";
import { ROLES, formatDateTime, sectionInfo, toDate } from "@/lib/staff";
import { acceptStaffInvite, getStaffInvite, linkStaffInvite, type StaffInvitePreview } from "@/lib/staff-api";
import {
  cleanName,
  hasErrors,
  validateExistingAccountForm,
  validateNewAccountForm,
  type AcceptFormErrors,
} from "@/lib/validation";

type Phase =
  | { kind: "loading" }
  | { kind: "problem"; problem: InviteProblem }
  | { kind: "error"; message: string }
  | { kind: "ready"; invite: StaffInvitePreview; token: string; mode: "new" | "existing"; switched: boolean }
  | { kind: "created"; email: string };

/** Tira o token do endereço depois do aceite (ele não serve mais para nada). */
function clearTokenFromAddress() {
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}

export function InviteScreen({ inviteId }: { inviteId: string }) {
  if (!isFirebaseConfigured()) return <NotConfigured />;
  return <InviteFlow inviteId={inviteId} />;
}

function InviteFlow({ inviteId }: { inviteId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = readInviteToken(window.location.hash);
      if (!token) {
        await Promise.resolve();
        if (!cancelled) setPhase({ kind: "problem", problem: "invalid" });
        return;
      }
      try {
        const invite = await getStaffInvite(inviteId, token);
        if (cancelled) return;
        setPhase({ kind: "ready", invite, token, mode: invite.accountExists ? "existing" : "new", switched: false });
      } catch (failure) {
        if (cancelled) return;
        const problem = inviteProblemOf(failure);
        setPhase(problem ? { kind: "problem", problem } : { kind: "error", message: callableErrorMessage(failure) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteId, attempt]);

  if (phase.kind === "loading") {
    return (
      <AuthFrame>
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-fg/70">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Abrindo o convite...
        </p>
      </AuthFrame>
    );
  }

  if (phase.kind === "problem") {
    const copy = INVITE_PROBLEM_COPY[phase.problem];
    return (
      <AuthFrame>
        <AuthHeading title={copy.title} subtitle={copy.text} />
        {copy.loginLink ? (
          <ButtonLink href="/entrar" variant="primary" size="lg" className="w-full">
            Ir para o login
            <ArrowRight aria-hidden="true" className="size-4" />
          </ButtonLink>
        ) : null}
      </AuthFrame>
    );
  }

  if (phase.kind === "error") {
    return (
      <AuthFrame>
        <AuthHeading title="Não foi possível abrir o convite" />
        <Notice tone="error" className="mb-5">
          {phase.message}
        </Notice>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => {
            setPhase({ kind: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Tentar de novo
        </Button>
      </AuthFrame>
    );
  }

  if (phase.kind === "created") {
    return (
      <AuthFrame>
        <AuthHeading
          title="Acesso criado"
          subtitle={`Seu acesso ao painel foi criado para ${phase.email}. Entre com esse e-mail e a senha que você acabou de criar.`}
        />
        <ButtonLink href="/entrar" variant="primary" size="lg" className="w-full">
          Ir para o login
          <ArrowRight aria-hidden="true" className="size-4" />
        </ButtonLink>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame wide>
      <AcceptForm
        inviteId={inviteId}
        token={phase.token}
        invite={phase.invite}
        mode={phase.mode}
        switched={phase.switched}
        onProblem={(problem) => setPhase({ kind: "problem", problem })}
        onSwitchToExisting={() => setPhase({ ...phase, mode: "existing", switched: true })}
        onCreatedWithoutSignIn={(email) => setPhase({ kind: "created", email })}
      />
    </AuthFrame>
  );
}

function InviteSummary({ invite }: { invite: StaffInvitePreview }) {
  const expiresAt = toDate(invite.expiresAt);
  const role = ROLES[invite.role];
  const sections = invite.role === "admin" ? null : invite.sections;
  return (
    <dl className="m-0 mb-6 grid gap-3 rounded-xl border border-line bg-raised p-4 text-sm">
      {/* Um termo com duas definições: o selo do nível e o que ele permite. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2">
        <dt className="text-fg/60">Nível de acesso</dt>
        <dd className="m-0 flex items-center gap-2">
          <RoleBadge role={invite.role} />
        </dd>
        <dd className="col-span-2 m-0 text-[13px] text-fg/65">{role.description}.</dd>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <dt className="text-fg/60">Seções</dt>
        <dd className="m-0">
          {sections ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {sections.map((id) => (
                <li key={id} className="rounded-full border border-line-strong bg-fg/[0.04] px-2.5 py-1 text-[12.5px] font-medium text-fg/85">
                  {sectionInfo(id).label}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-fg/85">Todas as seções e a Equipe</span>
          )}
        </dd>
      </div>
      {expiresAt ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <dt className="text-fg/60">Vale até</dt>
          <dd className="m-0 text-fg/85">{formatDateTime(expiresAt)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function AcceptForm({
  inviteId,
  token,
  invite,
  mode,
  switched,
  onProblem,
  onSwitchToExisting,
  onCreatedWithoutSignIn,
}: {
  inviteId: string;
  token: string;
  invite: StaffInvitePreview;
  mode: "new" | "existing";
  switched: boolean;
  onProblem: (problem: InviteProblem) => void;
  onSwitchToExisting: () => void;
  onCreatedWithoutSignIn: (email: string) => void;
}) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(invite.suggestedName ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<AcceptFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  const existing = mode === "existing";
  const switchedNoticeId = useId();

  function focusFirstError(found: AcceptFormErrors) {
    if (found.name) nameRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
    else if (found.confirmation) confirmationRef.current?.focus();
  }

  function goToPanel() {
    clearTokenFromAddress();
    router.replace("/");
  }

  async function submitNew() {
    let email = invite.email;
    try {
      const result = await acceptStaffInvite({ inviteId, token, displayName: cleanName(name), password });
      email = result.email || invite.email;
    } catch (failure) {
      if (isAccountExistsError(failure)) {
        // Mesmo formulário, agora pedindo a senha da conta que já existe.
        setPassword("");
        setConfirmation("");
        setErrors({});
        setBusy(false);
        onSwitchToExisting();
        requestAnimationFrame(() => passwordRef.current?.focus());
        return;
      }
      const problem = inviteProblemOf(failure);
      if (problem) {
        onProblem(problem);
        return;
      }
      setFormError(callableErrorMessage(failure));
      setBusy(false);
      return;
    }
    try {
      await signInForInvite(email, password);
    } catch {
      // A conta existe e o convite foi aceito; só o login automático falhou.
      clearTokenFromAddress();
      onCreatedWithoutSignIn(email);
      return;
    }
    goToPanel();
  }

  async function submitExisting() {
    try {
      await signInForInvite(invite.email, password);
    } catch (failure) {
      setFormError(
        isWrongPasswordError(failure)
          ? "Senha incorreta. Confira ou use \"Esqueci minha senha\"."
          : authErrorMessage(readError(failure).code),
      );
      setBusy(false);
      passwordRef.current?.focus();
      return;
    }
    try {
      await linkStaffInvite({ inviteId, token, displayName: cleanName(name) });
    } catch (failure) {
      // Sem o acesso ligado, a sessão de fã não tem o que fazer aqui.
      await signOutUser().catch(() => undefined);
      const problem = inviteProblemOf(failure);
      if (problem) {
        onProblem(problem);
        return;
      }
      setFormError(callableErrorMessage(failure));
      setBusy(false);
      return;
    }
    goToPanel();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const found = existing
      ? validateExistingAccountForm({ name, password })
      : validateNewAccountForm({ name, password, confirmation });
    setErrors(found);
    if (hasErrors(found)) {
      focusFirstError(found);
      return;
    }
    setBusy(true);
    if (existing) await submitExisting();
    else await submitNew();
  }

  async function sendReset() {
    if (resetState === "sending") return;
    setFormError(null);
    setResetState("sending");
    try {
      await requestPasswordReset(invite.email);
      setResetState("sent");
    } catch (failure) {
      setResetState("idle");
      setFormError(errorMessage(failure));
    }
  }

  return (
    <>
      <AuthHeading
        id="titulo-convite"
        title={existing ? "Libere o painel na sua conta" : "Crie seu acesso ao painel"}
        subtitle={inviteSubtitle(invite.invitedByName)}
      />

      {/* Sem região viva: ao trocar de fluxo, o foco vai para a senha, que lê este aviso como descrição. */}
      {existing ? (
        <Notice id={switchedNoticeId} tone="info" className="mb-5" announce={false}>
          {switched ? "Encontramos uma conta com esse e-mail. " : null}
          Esse e-mail já tem uma conta no app ImagineUP. Entre com a senha dessa conta para liberar o painel.
        </Notice>
      ) : null}

      <InviteSummary invite={invite} />

      <form onSubmit={submit} noValidate aria-labelledby="titulo-convite" aria-busy={busy} className="flex flex-col gap-4">
        <Field label="E-mail" hint="O convite vale só para este e-mail.">
          {({ id, describedBy }) => (
            <TextInput id={id} type="email" name="email" autoComplete="username" readOnly value={invite.email} describedBy={describedBy} />
          )}
        </Field>

        <Field label="Nome" hint="Como você aparece para a equipe no painel." error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              ref={nameRef}
              id={id}
              name="name"
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              invalid={invalid}
              describedBy={describedBy}
            />
          )}
        </Field>

        <Field
          label={existing ? "Senha da sua conta" : "Senha"}
          hint={existing ? undefined : "Pelo menos 8 caracteres."}
          error={errors.password}
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              ref={passwordRef}
              id={id}
              name="password"
              autoComplete={existing ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={invalid}
              describedBy={[describedBy, switched ? switchedNoticeId : null].filter(Boolean).join(" ") || undefined}
            />
          )}
        </Field>

        {!existing ? (
          <Field label="Confirmar senha" error={errors.confirmation}>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                ref={confirmationRef}
                id={id}
                name="password-confirmation"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                invalid={invalid}
                describedBy={describedBy}
              />
            )}
          </Field>
        ) : null}

        {existing ? (
          <div className="-mt-1 flex flex-col items-start gap-2">
            {/* Enviando usa aria-disabled: um botão desabilitado com foco solta o foco para o body. */}
            <button
              type="button"
              onClick={sendReset}
              disabled={busy}
              aria-disabled={resetState === "sending" || undefined}
              aria-busy={resetState === "sending" || undefined}
              className="rounded-md text-sm font-semibold text-pink underline-offset-4 hover:underline disabled:opacity-60 aria-disabled:cursor-progress aria-disabled:opacity-60"
            >
              {resetState === "sending" ? "Enviando link..." : "Esqueci minha senha"}
            </button>
            {/* Região viva que já existe antes do aviso, para ele ser lido ao aparecer. */}
            <div aria-live="polite" className="w-full empty:-mt-2">
              {resetState === "sent" ? (
                <Notice tone="success" announce={false}>
                  Se houver uma conta com esse e-mail, enviamos um link para criar uma senha nova. Depois de trocar a senha, volte a
                  este convite pelo mesmo link.
                </Notice>
              ) : null}
            </div>
          </div>
        ) : null}

        {formError ? <Notice tone="error">{formError}</Notice> : null}

        <Button type="submit" variant="primary" size="lg" busy={busy} className="mt-1 w-full">
          {busy
            ? existing
              ? "Liberando acesso..."
              : "Criando acesso..."
            : existing
              ? "Entrar e liberar o painel"
              : "Criar acesso e entrar"}
        </Button>
      </form>
    </>
  );
}
