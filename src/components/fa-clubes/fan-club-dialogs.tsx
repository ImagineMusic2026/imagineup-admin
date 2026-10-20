"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Radio, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { approveApplication, closeFanClub, rejectApplication, rejectPost } from "@/lib/fan-club-api";
import {
  APPROVE_SUSPENDED_TEXT,
  CLOSE_REASONS,
  CLOSE_REASON_HINTS,
  CLOSE_REASON_LABELS,
  FAN_CLUB_AUDIT_TEXT,
  FAN_CLUB_NAME_MAX,
  POST_REJECT_REASONS,
  POST_REJECT_REASON_LABELS,
  REJECT_REASONS,
  REJECT_REASON_LABELS,
  applicantLabel,
  authorLabel,
  approveNameProblem,
  checkApprovalName,
  closeText,
  fanClubLabel,
  isStaleDecision,
  type CloseReason,
  type FanClub,
  type FanClubApplication,
  type FanClubPost,
  type PostRejectReason,
  type RejectReason,
} from "@/lib/fan-clubs";
import { UNCERTAIN_RETRY_TEXT, callableErrorMessage, mayHaveRunOnServer, reasonOf } from "@/lib/errors";

/**
 * Os diálogos das decisões com campo (34.10): aprovar com o nome, recusar com
 * o motivo e encerrar com quem pediu. Pausar e reativar usam o
 * `ConfirmDialog`. Todos mandam o estado que a tela mostrou (`expected`):
 *
 * - a falha incerta trava os campos e "Tentar de novo" repete o mesmo pedido,
 *   que a `decideFanClub` não grava duas vezes (a mesma decisão já tomada
 *   responde `ok`);
 * - o `stale-decision` mostra a frase do servidor e tira o botão de confirmar,
 *   porque a mesma tentativa daria a mesma recusa;
 * - a página lê de novo quando o diálogo fecha (`onSend` marca a releitura
 *   antes do pedido, e `onOrphan`, a resposta que chegou com o diálogo fora da
 *   tela).
 */

export interface DecisionProps {
  onClose: () => void;
  onDone: (message: string) => void;
  /** O pedido vai ao servidor: a página marca a releitura. */
  onSend: () => void;
  /** A resposta chegou com o diálogo fora da tela (a permissão caiu no meio): a página marca a releitura. */
  onOrphan: () => void;
}

/** O pedido de uma decisão, com a falha incerta, a recusa que bloqueia e a resposta órfã. */
export function useDecision({ onDone, onSend, onOrphan }: Omit<DecisionProps, "onClose">) {
  const mounted = useMountedRef();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const footer = useRef<HTMLDivElement>(null);

  // O botão de confirmar saiu com o foco nele: o foco vai para o de voltar.
  useEffect(() => {
    if (blocked) footer.current?.querySelector<HTMLElement>("button")?.focus();
  }, [blocked]);

  async function run(action: () => Promise<unknown>, message: string, explain?: (failure: unknown) => string | null): Promise<void> {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    onSend();
    try {
      await action();
      if (!mounted.current) return onOrphan();
      onDone(message);
    } catch (failure) {
      if (!mounted.current) return onOrphan();
      if (mayHaveRunOnServer(failure)) {
        setUncertain(true);
        setError(UNCERTAIN_RETRY_TEXT);
      } else {
        // A recusa certa não gravou nada, e a tentativa incerta de antes também
        // não (a mesma decisão já gravada responderia ok): os campos destravam.
        setUncertain(false);
        setError(explain?.(failure) ?? callableErrorMessage(failure));
        if (isStaleDecision(failure)) setBlocked(true);
      }
      setBusy(false);
    }
  }

  return { busy, error, uncertain, blocked, footer, run };
}

export function Footer({
  footer,
  busy,
  uncertain,
  blocked,
  onClose,
  confirmLabel,
  busyLabel,
  tone,
}: {
  footer: React.Ref<HTMLDivElement>;
  busy: boolean;
  uncertain: boolean;
  blocked: boolean;
  onClose: () => void;
  confirmLabel: string;
  busyLabel: string;
  tone: "primary" | "danger";
}) {
  return (
    <div ref={footer} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>
        {blocked ? "Fechar" : "Voltar"}
      </Button>
      {blocked ? null : (
        <Button type="submit" variant={tone} busy={busy}>
          {busy ? busyLabel : uncertain ? "Tentar de novo" : confirmLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * Aprovar (34.5): a equipe confirma o nome proposto ou ajusta (3 a 40, as
 * regras da candidatura). Com o nome proposto, o pedido vai sem `name`. O
 * servidor confere o nome de novo (a palavra "oficial" e o filtro de termos):
 * a recusa aparece embaixo do campo, para ajustar.
 */
export function ApproveDialog({ application, ...props }: DecisionProps & { application: FanClubApplication }) {
  const { busy, error, uncertain, blocked, footer, run } = useDecision(props);
  const [name, setName] = useState(application.proposedName);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fan = applicantLabel(application);

  /** O erro do nome leva o foco ao campo, que lê o erro pela descrição (como os outros diálogos do painel). */
  function showNameError(message: string) {
    setNameError(message);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkApprovalName(name);
    if (!checked.ok) {
      showNameError(checked.message);
      return;
    }
    setNameError(null);
    const sent = checked.name === application.proposedName ? null : checked.name;
    await run(
      () => approveApplication(application.uid, application, sent),
      `Candidatura de ${fan} aprovada. O fã-clube ${checked.name} está ativo.`,
      (failure) => {
        if (reasonOf(failure) === "owner-suspended") return APPROVE_SUSPENDED_TEXT;
        const problem = approveNameProblem(failure);
        if (problem) showNameError(problem);
        return problem ? "Ajuste o nome e aprove de novo." : null;
      },
    );
  }

  return (
    <Dialog
      open
      size="sm"
      busy={busy}
      onClose={() => !busy && props.onClose()}
      title={`Aprovar a candidatura de ${fan}?`}
      description={`O fã-clube nasce ativo, ligado à central ${application.artistName || `@${application.artistId}`}, e o nome não muda depois. O texto de divulgação sai; as redes ficam. ${FAN_CLUB_AUDIT_TEXT}`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Nome do fã-clube" error={nameError} hint={`De 3 a ${FAN_CLUB_NAME_MAX} caracteres, sem a palavra oficial. O proposto pelo fã vem preenchido.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              ref={nameRef}
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={name}
              maxLength={FAN_CLUB_NAME_MAX + 10}
              disabled={busy || uncertain || blocked}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
            />
          )}
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Footer footer={footer} busy={busy} uncertain={uncertain} blocked={blocked} onClose={props.onClose} confirmLabel="Aprovar" busyLabel="Aprovando..." tone="primary" />
      </form>
    </Dialog>
  );
}

/**
 * Recusar (34.5): o motivo da lista, que o fã vê no app numa frase fixa. O
 * fã pode mandar de novo depois de 30 dias, menos na 3ª rodada.
 */
export function RejectDialog({ application, ...props }: DecisionProps & { application: FanClubApplication }) {
  const { busy, error, uncertain, blocked, footer, run } = useDecision(props);
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const fan = applicantLabel(application);
  const last = application.round >= 3;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      // O erro vai em cada opção, e o foco na primeira: o leitor de tela não lê a descrição do grupo ao entrar nele.
      setReasonError("Escolha o motivo.");
      requestAnimationFrame(() => firstReasonRef.current?.focus());
      return;
    }
    await run(() => rejectApplication(application.uid, application, reason), `Candidatura de ${fan} recusada.`);
  }

  return (
    <Dialog
      open
      size="sm"
      tone="danger"
      busy={busy}
      onClose={() => !busy && props.onClose()}
      title={`Recusar a candidatura de ${fan}?`}
      description={`${last ? "Esta é a 3ª rodada: o fã não manda outra candidatura." : "O fã vê o motivo no app e pode mandar outra candidatura depois de 30 dias."} As redes e o texto de divulgação saem. ${FAN_CLUB_AUDIT_TEXT}`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/75">Motivo</legend>
          {REJECT_REASONS.map((item, index) => (
            <Radio
              key={item}
              ref={index === 0 ? firstReasonRef : undefined}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? errorId : undefined}
              name="motivo-recusa-candidatura"
              value={item}
              label={REJECT_REASON_LABELS[item]}
              checked={reason === item}
              disabled={busy || uncertain || blocked}
              onChange={() => {
                setReason(item);
                setReasonError(null);
              }}
            />
          ))}
          {reasonError ? (
            <p id={errorId} className="m-0 text-[12.5px] font-medium text-danger">
              {reasonError}
            </p>
          ) : null}
        </fieldset>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Footer footer={footer} busy={busy} uncertain={uncertain} blocked={blocked} onClose={props.onClose} confirmLabel="Recusar" busyLabel="Recusando..." tone="danger" />
      </form>
    </Dialog>
  );
}

/**
 * Encerrar (só admin, decisão 13): pela equipe, o fã nunca mais se candidata;
 * a pedido do gestor, ele pode voltar depois de 30 dias numa rodada 1 nova.
 * Encerrado não volta.
 */
export function CloseDialog({ club, ...props }: DecisionProps & { club: FanClub }) {
  const { busy, error, uncertain, blocked, footer, run } = useDecision(props);
  const [reason, setReason] = useState<CloseReason>("staff");
  const name = fanClubLabel(club);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(() => closeFanClub(club.id, club.status, reason), `Fã-clube ${name} encerrado.`);
  }

  return (
    <Dialog
      open
      size="sm"
      tone="danger"
      busy={busy}
      onClose={() => !busy && props.onClose()}
      title={`Encerrar o fã-clube ${name}?`}
      description={`${closeText(reason)} ${FAN_CLUB_AUDIT_TEXT}`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/75">Quem pediu</legend>
          {CLOSE_REASONS.map((item) => (
            <Radio
              key={item}
              name="motivo-encerramento"
              value={item}
              label={CLOSE_REASON_LABELS[item]}
              hint={CLOSE_REASON_HINTS[item]}
              checked={reason === item}
              disabled={busy || uncertain || blocked}
              onChange={() => setReason(item)}
            />
          ))}
        </fieldset>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Footer footer={footer} busy={busy} uncertain={uncertain} blocked={blocked} onClose={props.onClose} confirmLabel="Encerrar" busyLabel="Encerrando..." tone="danger" />
      </form>
    </Dialog>
  );
}

/**
 * Recusar a publicação em análise (34.5): o motivo da lista, que o gestor vê
 * numa frase fixa no app. Os arquivos saem depois da recusa.
 */
export function RejectPostDialog({ post, ...props }: DecisionProps & { post: FanClubPost }) {
  const { busy, error, uncertain, blocked, footer, run } = useDecision(props);
  const [reason, setReason] = useState<PostRejectReason | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const author = authorLabel(post);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      setReasonError("Escolha o motivo.");
      requestAnimationFrame(() => firstReasonRef.current?.focus());
      return;
    }
    await run(() => rejectPost(post.id, post.status, reason), `Publicação de ${author} recusada.`);
  }

  return (
    <Dialog
      open
      size="sm"
      tone="danger"
      busy={busy}
      onClose={() => !busy && props.onClose()}
      title={`Recusar a publicação de ${author}?`}
      description={`O gestor vê o motivo no app, e ${post.kind === "photo" ? "a foto e a miniatura saem" : "a publicação não vai ao ar"}. ${FAN_CLUB_AUDIT_TEXT}`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/75">Motivo</legend>
          {POST_REJECT_REASONS.map((item, index) => (
            <Radio
              key={item}
              ref={index === 0 ? firstReasonRef : undefined}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? errorId : undefined}
              name="motivo-recusa-publicacao"
              value={item}
              label={POST_REJECT_REASON_LABELS[item]}
              checked={reason === item}
              disabled={busy || uncertain || blocked}
              onChange={() => {
                setReason(item);
                setReasonError(null);
              }}
            />
          ))}
          {reasonError ? (
            <p id={errorId} className="m-0 text-[12.5px] font-medium text-danger">
              {reasonError}
            </p>
          ) : null}
        </fieldset>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Footer footer={footer} busy={busy} uncertain={uncertain} blocked={blocked} onClose={props.onClose} confirmLabel="Recusar" busyLabel="Recusando..." tone="danger" />
      </form>
    </Dialog>
  );
}
