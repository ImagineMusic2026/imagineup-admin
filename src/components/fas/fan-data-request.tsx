"use client";

import { Download, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SectionCard } from "@/components/painel/section-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, PasswordInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import { deleteFanAccount, exportFanDataPage, exportFanDataStart } from "@/lib/fan-api";
import {
  DATA_REQUEST_SELF_TEXT,
  DATA_REQUEST_TEXT,
  DELETED_TEXT,
  DELETE_DESCRIPTION,
  DELETE_GONE_TEXT,
  DELETE_LOSSES,
  DELETE_LOSSES_NOTE,
  DELETE_LOSSES_TITLE,
  DELETE_PENDING_TEXT,
  DELETE_UNCERTAIN_TEXT,
  EXPORT_DESCRIPTION,
  EXPORT_DONE_TEXT,
  EXPORT_PAGE_ERROR_TEXT,
  EXPORT_UNCERTAIN_TEXT,
  EXPORT_UNCONFIRMED_TEXT,
  buildFanDataFile,
  collectFanData,
  dataRequestErrorMessage,
  emailUnconfirmed,
  exportProgressText,
  fanDataFileName,
  fanDataFileText,
  newExportProgress,
  parseFanDataStart,
  type ExportProgress,
  type FanDataStart,
} from "@/lib/fan-data-export";
import { reauthenticate } from "@/lib/session";
import { emailError } from "@/lib/validation";

/**
 * O bloco "Pedido de dados (LGPD)" da ficha do fã (32.6, item 4), só para
 * admin: "Exportar dados" e "Excluir conta", cada um com o diálogo dele. Na
 * ficha da própria conta, sem os botões (o servidor recusaria com `self`).
 *
 * O e-mail digitado, a senha e o arquivo vivem só no estado do diálogo: nada
 * vai ao console, ao armazenamento do navegador, à URL ou ao estado global, e
 * tudo some quando o diálogo fecha.
 */
export function FanDataRequestCard({ uid, name, self }: { uid: string; name: string; self: boolean }) {
  const [open, setOpen] = useState<"export" | "delete" | null>(null);
  return (
    <SectionCard id="titulo-pedido-dados" title="Pedido de dados (LGPD)">
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="m-0 max-w-[68ch] text-sm leading-relaxed text-fg/80">{self ? DATA_REQUEST_SELF_TEXT : DATA_REQUEST_TEXT}</p>
        {self ? null : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen("export")} aria-haspopup="dialog">
              <Download aria-hidden="true" className="size-4" />
              Exportar dados
            </Button>
            <Button size="sm" variant="danger" onClick={() => setOpen("delete")} aria-haspopup="dialog">
              <UserX aria-hidden="true" className="size-4" />
              Excluir conta
            </Button>
          </div>
        )}
      </div>
      {open === "export" ? <ExportDialog uid={uid} name={name} onClose={() => setOpen(null)} /> : null}
      {open === "delete" ? <DeleteDialog uid={uid} name={name} onClose={() => setOpen(null)} /> : null}
    </SectionCard>
  );
}

/**
 * Quando um pedido termina e o foco ficou fora do formulário (o campo da senha
 * saiu da tela, ou o botão que a pessoa usou mudou), ele volta para a senha,
 * se ela ainda é pedida, ou para o e-mail.
 */
function useFocusAfterRequest(
  busy: boolean,
  active: boolean,
  refs: { form: React.RefObject<HTMLFormElement | null>; password: React.RefObject<HTMLInputElement | null>; email: React.RefObject<HTMLInputElement | null> },
) {
  const { form, password, email } = refs;
  useEffect(() => {
    if (busy || !active) return;
    const focused = document.activeElement;
    if (focused && form.current?.contains(focused)) return;
    (password.current ?? email.current)?.focus();
  }, [busy, active, form, password, email]);
}

/** Baixa o texto como arquivo, pelo Blob, e solta o endereço logo depois. */
function downloadJson(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** O e-mail do pedido, travado depois que a chamada saiu (a senha e a nova tentativa repetem o mesmo). */
function RequestEmailField({
  value,
  onChange,
  error,
  locked,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  locked: boolean;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  return (
    <Field label="E-mail do pedido" error={error} hint="O e-mail da conta do fã, que o servidor confere.">
      {({ id, describedBy, invalid }) => (
        <TextInput
          ref={inputRef}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={value}
          readOnly={locked}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * O passo da senha (7.7): a frase do servidor e a senha de quem está logado.
 * Durante o pedido o campo fica só de leitura, e não desabilitado, para o foco
 * não cair fora do diálogo.
 */
function PasswordStep({
  prompt,
  value,
  onChange,
  busy,
  inputRef,
}: {
  prompt: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  inputRef: React.Ref<HTMLInputElement>;
}) {
  return (
    <>
      <Notice tone="info" announce={false}>
        {prompt}
      </Notice>
      <Field label="Sua senha do painel">
        {({ id, describedBy }) => (
          <PasswordInput
            ref={inputRef}
            id={id}
            describedBy={describedBy}
            autoComplete="current-password"
            value={value}
            readOnly={busy}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
    </>
  );
}

type ExportPhase = "form" | "collecting" | "pageError" | "done";

/**
 * "Exportar dados" (7.5): a primeira chamada com o e-mail do pedido, as
 * páginas de cada parte e o arquivo baixado. Uma página que falha continua de
 * onde parou, sem outra primeira chamada (cada uma conta no teto de 20 e entra
 * nos Logs). "Parar" para depois da página da vez e descarta tudo.
 */
function ExportDialog({ uid, name, onClose }: { uid: string; name: string; onClose: () => void }) {
  const mounted = useMountedRef();
  const [email, setEmail] = useState("");
  const [emailInvalid, setEmailInvalid] = useState<string | null>(null);
  const [phase, setPhase] = useState<ExportPhase>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [progressText, setProgressText] = useState("");
  const [stopping, setStopping] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const start = useRef<FanDataStart | null>(null);
  const progress = useRef<ExportProgress>(newExportProgress());
  const stop = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useFocusAfterRequest(busy, phase === "form", { form: formRef, password: passwordRef, email: emailRef });

  // O botão que a pessoa usou some quando o passo muda: o foco vai para o primeiro do rodapé.
  useEffect(() => {
    if (phase === "form") return;
    footerRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }, [phase]);
  useEffect(() => {
    if (passwordPrompt) passwordRef.current?.focus();
  }, [passwordPrompt]);

  function release() {
    start.current = null;
    progress.current = newExportProgress();
  }

  async function collect() {
    const current = start.current;
    if (!current) return;
    setPhase("collecting");
    setError(null);
    try {
      const result = await collectFanData(current, progress.current, exportFanDataPage, {
        onPart: (part) => {
          if (mounted.current) setProgressText(exportProgressText(part));
        },
        stopped: () => stop.current || !mounted.current,
      });
      if (!mounted.current) return;
      // O "Parar" vale até o último instante: nada baixa depois dele.
      if (result === "stopped" || stop.current) {
        release();
        onClose();
        return;
      }
      downloadJson(fanDataFileName(uid, current.geradoEm), fanDataFileText(buildFanDataFile(current, progress.current.items)));
      setUnconfirmed(emailUnconfirmed(current));
      release();
      setPhase("done");
    } catch (failure) {
      if (!mounted.current) return;
      if (stop.current) {
        release();
        onClose();
        return;
      }
      setError(reasonOf(failure) ? dataRequestErrorMessage(failure) : EXPORT_PAGE_ERROR_TEXT);
      setPhase("pageError");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || phase !== "form") return;
    const invalid = emailError(email);
    setEmailInvalid(invalid);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      if (passwordPrompt) {
        const typed = password;
        setPassword("");
        await reauthenticate(typed);
        if (!mounted.current) return;
        setPasswordPrompt(null);
      }
      const answer = parseFanDataStart(await exportFanDataStart({ uid, email: email.trim() }), uid);
      if (!mounted.current) return;
      start.current = answer;
      progress.current = newExportProgress();
      setBusy(false);
      await collect();
    } catch (failure) {
      if (!mounted.current) return;
      if (reasonOf(failure) === "recent-login-required") {
        setPasswordPrompt(dataRequestErrorMessage(failure));
      } else {
        setError(mayHaveRunOnServer(failure) ? EXPORT_UNCERTAIN_TEXT : dataRequestErrorMessage(failure));
      }
      setBusy(false);
    }
  }

  function close() {
    if (busy || phase === "collecting") return;
    release();
    onClose();
  }

  const collecting = phase === "collecting";
  return (
    <Dialog
      open
      size="md"
      busy={busy || collecting}
      onClose={close}
      title={phase === "done" ? `Dados de ${name} exportados` : `Exportar os dados de ${name}?`}
      description={phase === "done" ? undefined : EXPORT_DESCRIPTION}
    >
      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {phase !== "done" ? (
          <RequestEmailField
            value={email}
            onChange={(value) => {
              setEmail(value);
              setEmailInvalid(null);
            }}
            error={emailInvalid}
            locked={busy || phase !== "form" || Boolean(passwordPrompt)}
            inputRef={emailRef}
          />
        ) : null}
        {passwordPrompt && phase === "form" ? (
          <PasswordStep prompt={passwordPrompt} value={password} onChange={setPassword} busy={busy} inputRef={passwordRef} />
        ) : null}
        <div role="status" className="empty:hidden">
          {collecting ? <p className="m-0 text-[13.5px] text-fg/80">{stopping ? "Parando depois desta página..." : progressText}</p> : null}
          {phase === "done" ? (
            <Notice tone="success" announce={false} title="Arquivo baixado.">
              <p className="m-0">{EXPORT_DONE_TEXT}</p>
              {unconfirmed ? <p className="m-0 mt-1.5">{EXPORT_UNCONFIRMED_TEXT}</p> : null}
            </Notice>
          ) : null}
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div ref={footerRef} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {phase === "form" ? (
            <>
              <Button variant="ghost" onClick={close} disabled={busy} data-autofocus>
                Voltar
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                {busy ? "Exportando..." : passwordPrompt ? "Confirmar e continuar" : "Exportar"}
              </Button>
            </>
          ) : null}
          {collecting ? (
            <Button
              variant="secondary"
              disabled={stopping}
              onClick={() => {
                stop.current = true;
                setStopping(true);
              }}
            >
              Parar
            </Button>
          ) : null}
          {phase === "pageError" ? (
            <>
              <Button variant="ghost" onClick={close}>
                Descartar
              </Button>
              <Button variant="primary" onClick={() => void collect()}>
                Tentar de novo
              </Button>
            </>
          ) : null}
          {phase === "done" ? (
            <Button variant="primary" onClick={close}>
              Fechar
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

type DeleteResult = "deleted" | "pending" | "gone";

const DELETE_RESULT_TEXT: Record<DeleteResult, string> = {
  deleted: DELETED_TEXT,
  pending: DELETE_PENDING_TEXT,
  gone: DELETE_GONE_TEXT,
};

/**
 * "Excluir conta" (7.6): o que se perde, o e-mail do pedido e a chamada. Depois
 * de uma resposta incerta, o e-mail fica travado e "Tentar de novo" repete; o
 * `fan-not-found` dessa repetição quer dizer que a conta já saiu.
 */
function DeleteDialog({ uid, name, onClose }: { uid: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const mounted = useMountedRef();
  const [email, setEmail] = useState("");
  const [emailInvalid, setEmailInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<DeleteResult | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useFocusAfterRequest(busy, !result, { form: formRef, password: passwordRef, email: emailRef });

  useEffect(() => {
    if (passwordPrompt) passwordRef.current?.focus();
  }, [passwordPrompt]);
  useEffect(() => {
    if (result) footerRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [result]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || result) return;
    const invalid = emailError(email);
    setEmailInvalid(invalid);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      if (passwordPrompt) {
        const typed = password;
        setPassword("");
        await reauthenticate(typed);
        if (!mounted.current) return;
        setPasswordPrompt(null);
      }
      const answer = await deleteFanAccount({ uid, email: email.trim() });
      if (!mounted.current) return;
      setResult(answer.status === "pending" ? "pending" : "deleted");
    } catch (failure) {
      if (!mounted.current) return;
      const reason = reasonOf(failure);
      if (reason === "recent-login-required") {
        setPasswordPrompt(dataRequestErrorMessage(failure));
      } else if (uncertain && reason === "fan-not-found") {
        setResult("gone");
      } else if (mayHaveRunOnServer(failure)) {
        setUncertain(true);
        setError(DELETE_UNCERTAIN_TEXT);
      } else {
        setError(dataRequestErrorMessage(failure));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    // Depois da exclusão, a ficha não existe mais: a volta é para a lista.
    if (result) router.push("/fas");
    else onClose();
  }

  return (
    <Dialog
      open
      size="md"
      tone="danger"
      busy={busy}
      onClose={close}
      title={result ? `Conta de ${name} excluída` : `Excluir a conta de ${name}?`}
      description={result ? undefined : DELETE_DESCRIPTION}
    >
      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {result ? null : (
          <>
            <div className="rounded-[10px] border border-line bg-raised px-4 py-3">
              <p className="m-0 text-[13px] font-semibold text-fg/80">{DELETE_LOSSES_TITLE}</p>
              <ul className="m-0 mt-1.5 flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-relaxed text-fg/90">
                {DELETE_LOSSES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="m-0 mt-2 text-[12.5px] leading-snug text-fg/65">{DELETE_LOSSES_NOTE}</p>
            </div>
            <RequestEmailField
              value={email}
              onChange={(value) => {
                setEmail(value);
                setEmailInvalid(null);
              }}
              error={emailInvalid}
              locked={busy || uncertain || Boolean(passwordPrompt)}
              inputRef={emailRef}
            />
            {passwordPrompt ? <PasswordStep prompt={passwordPrompt} value={password} onChange={setPassword} busy={busy} inputRef={passwordRef} /> : null}
          </>
        )}
        <div role="status" className="empty:hidden">
          {result ? (
            <Notice tone="success" announce={false}>
              {DELETE_RESULT_TEXT[result]}
            </Notice>
          ) : null}
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div ref={footerRef} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {result ? (
            <Button variant="primary" onClick={() => router.push("/fas")}>
              Voltar para Fãs
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy} data-autofocus>
                Voltar
              </Button>
              <Button type="submit" variant="danger" busy={busy}>
                {busy ? "Excluindo..." : passwordPrompt ? "Confirmar e continuar" : uncertain ? "Tentar de novo" : "Excluir conta"}
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog>
  );
}
