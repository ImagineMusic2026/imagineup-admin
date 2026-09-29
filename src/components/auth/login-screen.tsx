"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, PasswordInput, TextInput } from "@/components/ui/field";
import { NotConfigured } from "@/components/ui/not-configured";
import { Notice } from "@/components/ui/notice";
import { errorMessage } from "@/lib/errors";
import { isFirebaseConfigured } from "@/lib/firebase";
import { EXIT_REASON_MESSAGES, parseExitReason } from "@/lib/login-reasons";
import { requestPasswordReset, signInWithPassword } from "@/lib/session";
import { emailError } from "@/lib/validation";

type Mode = "sign-in" | "reset";

/**
 * Login do painel e "Esqueci minha senha". Entrar só abre a sessão: quem
 * decide se a conta é da equipe é o guard do painel, que devolve para cá com
 * `?motivo=` quando não é.
 */
export function LoginScreen() {
  if (!isFirebaseConfigured()) return <NotConfigured />;
  return <LoginForm />;
}

function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const resetNoticeRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // O aviso de "sem acesso" some assim que a pessoa tenta de novo.
  const [reasonDismissed, setReasonDismissed] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setEmailInvalid(false);
    setResetSent(false);
    setReasonDismissed(true);
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setReasonDismissed(true);
    setError(null);
    setEmailInvalid(false);

    const invalidEmail = emailError(email);
    if (invalidEmail) {
      setError(invalidEmail);
      setEmailInvalid(true);
      emailRef.current?.focus();
      return;
    }

    if (mode === "reset") {
      setBusy(true);
      try {
        await requestPasswordReset(email);
        setResetSent(true);
        // O formulário some: o foco vai para o próprio aviso, que é lido inteiro.
        requestAnimationFrame(() => resetNoticeRef.current?.focus());
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!password) {
      setError("Digite a senha.");
      passwordRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      await signInWithPassword(email, password, remember);
      // Fica "Entrando..." até a troca de página; o guard confere o acesso.
      router.replace("/");
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
      passwordRef.current?.focus();
      passwordRef.current?.select();
    }
  }

  const resetting = mode === "reset";

  return (
    <AuthFrame>
      <AuthHeading
        id="titulo-login"
        title={resetting ? "Esqueceu a senha?" : "Entrar no painel"}
        subtitle={
          resetting
            ? "Digite o e-mail da sua conta. Enviamos um link para você criar uma senha nova."
            : "Use o e-mail e a senha da sua conta da equipe."
        }
      />

      {!resetting && !reasonDismissed ? (
        <Suspense fallback={null}>
          <ExitReasonNotice />
        </Suspense>
      ) : null}

      {resetting && resetSent ? (
        <div className="flex flex-col gap-5">
          <Notice ref={resetNoticeRef} tone="success" title="Confira seu e-mail" announce={false} focusable>
            Se houver uma conta com esse e-mail, enviamos um link para criar uma senha nova. Confira também a caixa de spam.
          </Notice>
          <Button variant="secondary" size="lg" onClick={() => switchMode("sign-in")}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Voltar para o login
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate aria-labelledby="titulo-login" aria-busy={busy} className="flex flex-col gap-4">
          <Field label="E-mail">
            {({ id }) => (
              <TextInput
                ref={emailRef}
                id={id}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                invalid={emailInvalid}
                describedBy={error ? "erro-login" : undefined}
              />
            )}
          </Field>

          {!resetting ? (
            <Field label="Senha">
              {({ id }) => (
                <PasswordInput
                  ref={passwordRef}
                  id={id}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  describedBy={error ? "erro-login" : undefined}
                />
              )}
            </Field>
          ) : null}

          {!resetting ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Checkbox
                label="Lembrar de mim"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => switchMode("reset")}
                disabled={busy}
                className="rounded-md text-sm font-semibold text-pink underline-offset-4 hover:underline disabled:opacity-60"
              >
                Esqueci minha senha
              </button>
            </div>
          ) : null}

          {error ? (
            <Notice id="erro-login" tone="error">
              {error}
            </Notice>
          ) : null}

          <Button type="submit" variant="primary" size="lg" busy={busy} className="mt-1 w-full">
            {busy ? (resetting ? "Enviando..." : "Entrando...") : resetting ? "Enviar link" : "Entrar"}
          </Button>

          {resetting ? (
            <Button variant="ghost" onClick={() => switchMode("sign-in")} disabled={busy} className="self-center">
              <ArrowLeft aria-hidden="true" className="size-4" />
              Voltar para o login
            </Button>
          ) : null}
        </form>
      )}
    </AuthFrame>
  );
}

/** Motivo de ter voltado ao login, vindo do guard pelo endereço. */
function ExitReasonNotice() {
  const params = useSearchParams();
  const reason = parseExitReason(params.get("motivo"));
  if (!reason) return null;
  return (
    <Notice tone="error" className="mb-5">
      {EXIT_REASON_MESSAGES[reason]}
    </Notice>
  );
}
