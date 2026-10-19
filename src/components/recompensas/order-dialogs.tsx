"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { actionErrorMessage, mayHaveRunOnServer } from "@/lib/errors";
import { countLabel, formatNumber } from "@/lib/format";
import { isDeletedContact, setRedemptionStatus, type RedemptionContact } from "@/lib/reward-api";
import { CONTACTS_AUDIT_TEXT, REFUSAL_REASON_MAX, RESTOCK_HINT, refundText, validateRefusal, type Redemption } from "@/lib/rewards";
import { formatWhatsapp, whatsappLink } from "@/lib/whatsapp";

/**
 * Recusar um pedido: o motivo opcional, que o fã vê, e a vaga de volta ao
 * estoque (marcada por padrão). Os pontos voltam para o saldo do fã.
 */
export function RefuseDialog({
  redemption,
  onClose,
  onDone,
  onUncertain,
}: {
  redemption: Redemption | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onUncertain: () => void;
}) {
  return redemption ? <RefuseBody key={redemption.code} redemption={redemption} onClose={onClose} onDone={onDone} onUncertain={onUncertain} /> : null;
}

function RefuseBody({ redemption, onClose, onDone, onUncertain }: { redemption: Redemption; onClose: () => void; onDone: (message: string) => void; onUncertain: () => void }) {
  const mounted = useMountedRef();
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const checked = validateRefusal(reason);
    setReasonError(checked.error);
    if (checked.error) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setRedemptionStatus({ redemptionId: redemption.code, status: "refused", reason: checked.value, restock });
      if (!mounted.current) return;
      const refunded = result.refundedPoints > 0 ? ` ${formatNumber(result.refundedPoints)} pontos voltaram para o saldo do fã.` : "";
      onDone(`Pedido ${redemption.code} recusado.${refunded}`);
    } catch (failure) {
      if (!mounted.current) return;
      setError(actionErrorMessage(failure));
      if (mayHaveRunOnServer(failure)) onUncertain();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog
      open
      tone="danger"
      size="sm"
      busy={busy}
      onClose={() => !busy && onClose()}
      title={`Recusar ${redemption.code}?`}
      description={`${redemption.rewardTitle}. ${redemption.points > 0 ? refundText(redemption.points) : ""}`}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Motivo" optional error={reasonError ?? undefined} hint="O fã vê este texto.">
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={reason}
              maxLength={REFUSAL_REASON_MAX}
              disabled={busy}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <Checkbox label="Devolver a vaga ao estoque" checked={restock} disabled={busy} onChange={(event) => setRestock(event.target.checked)} />
          <p className="m-0 pl-7 text-[12.5px] leading-snug text-fg/60">{RESTOCK_HINT}</p>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>
            Voltar
          </Button>
          <Button type="submit" variant="danger" busy={busy}>
            {busy ? "Recusando..." : "Recusar pedido"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export type ContactsState = { status: "loading" } | { status: "ready"; contacts: RedemptionContact[] } | { status: "error"; message: string };

/**
 * O WhatsApp do fã (seção 35 da nota do app), com o link que abre a conversa
 * em outra aba, já com a mensagem do pedido. Sem número (o fã só resgatou
 * pelo app de antes), "Sem WhatsApp". A conta que saiu fica só com "Conta
 * excluída", sem esta linha.
 */
function WhatsappContact({ contact }: { contact: RedemptionContact }) {
  const number = formatWhatsapp(contact.whatsapp);
  const href = whatsappLink(contact.whatsapp, contact.redemptionId);
  if (!number || !href) return <span className="text-[13px] text-fg/55">Sem WhatsApp</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 self-start text-[13.5px] text-cyan underline-offset-2 hover:underline"
    >
      <span className="font-semibold">WhatsApp:</span>{" "}
      {/* O número nunca corta: na coluna estreita, ele desce inteiro, com o ícone. */}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {number}
        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      </span>
      <span className="sr-only"> (abre a conversa em outra aba)</span>
    </a>
  );
}

/**
 * Os contatos dos pedidos abertos escolhidos: o nome, o @, o e-mail e o
 * WhatsApp com o link da conversa. Vivem só aqui: quem abriu guarda o
 * resultado enquanto o diálogo está aberto e joga fora ao fechar, e nada vai
 * para o armazenamento do navegador.
 */
export function ContactsDialog({ request, onClose }: { request: { codes: string[]; state: ContactsState } | null; onClose: () => void }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const contacts = request?.state.status === "ready" ? request.state.contacts : [];
  const emails = contacts.map((contact) => contact.email).filter((email): email is string => Boolean(email));

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <Dialog
      open={Boolean(request)}
      size="lg"
      onClose={() => {
        setCopied("idle");
        onClose();
      }}
      title={request ? `Contatos de ${countLabel(request.codes.length, "pedido", "pedidos")}` : ""}
      description={CONTACTS_AUDIT_TEXT}
    >
      {request ? (
        <div className="flex flex-col gap-4">
          {request.state.status === "loading" ? (
            <p role="status" className="m-0 text-sm text-fg/70">
              Buscando os contatos...
            </p>
          ) : request.state.status === "error" ? (
            <Notice tone="error">{request.state.message}</Notice>
          ) : contacts.length === 0 ? (
            <p className="m-0 text-sm text-fg/70">Nenhum desses pedidos está aberto agora.</p>
          ) : (
            <ul aria-label="Contatos" className="m-0 flex max-h-[50vh] list-none flex-col overflow-y-auto rounded-xl border border-line p-0">
              {contacts.map((contact) => (
                <li key={contact.redemptionId} className="grid gap-1 border-t border-line px-4 py-3 first:border-t-0 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-4">
                  <span className="font-mono text-[13px] text-fg">{contact.redemptionId}</span>
                  <span className="min-w-0 text-[13.5px] text-fg/90">
                    {contact.name ?? "Sem nome"}
                    {contact.username ? <span className="text-fg/60"> · @{contact.username}</span> : null}
                  </span>
                  {isDeletedContact(contact) ? (
                    <span className="min-w-0 text-[13.5px] text-fg/55">Conta excluída</span>
                  ) : (
                    <span className="flex min-w-0 flex-col gap-1">
                      {contact.email ? (
                        <span className="break-all text-[13.5px] text-fg/90">{contact.email}</span>
                      ) : (
                        <span className="text-[13px] text-fg/55">Sem e-mail</span>
                      )}
                      <WhatsappContact contact={contact} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <span aria-live="polite" className="text-[13px] text-fg/70 empty:hidden">
            {copied === "copied" ? `${countLabel(emails.length, "e-mail copiado", "e-mails copiados")}.` : copied === "failed" ? "Não deu para copiar. Selecione os e-mails e copie à mão." : ""}
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} data-autofocus>
              Fechar
            </Button>
            {emails.length > 0 ? (
              <Button variant="secondary" onClick={() => void copyEmails()}>
                Copiar e-mails
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
