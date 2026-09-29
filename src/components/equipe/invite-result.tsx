"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { CopyLink } from "@/components/ui/copy-link";
import { Notice } from "@/components/ui/notice";
import { formatDateTime, toDate } from "@/lib/staff";
import type { InviteLinkResult } from "@/lib/staff-api";

/**
 * Resultado de criar ou reenviar um convite, como no painel antigo: diz se o
 * e-mail saiu e sempre mostra o link com Copiar, porque a pessoa pode precisar
 * receber por outro canal.
 */
export function InviteResult({
  email,
  result,
  resent,
  onDone,
}: {
  email: string;
  result: InviteLinkResult;
  resent: boolean;
  onDone: () => void;
}) {
  const expiresAt = toDate(result.expiresAt);
  const noticeId = useId();

  // O aviso nasce junto com o link e o foco vai direto para o link: em vez de
  // região viva (que nasceria preenchida e poderia não ser lida), o aviso é a
  // descrição do campo e é lido ao focar.
  return (
    <div className="flex flex-col gap-5">
      {result.emailStatus === "sent" ? (
        <Notice id={noticeId} tone="success" announce={false}>
          {resent ? `Convite reenviado para ${email}. O link anterior parou de funcionar.` : `Convite enviado para ${email}.`}
        </Notice>
      ) : result.emailStatus === "failed" ? (
        <Notice id={noticeId} tone="error" announce={false}>
          {resent ? "O link novo foi gerado, mas o e-mail não saiu." : "O convite foi criado, mas o e-mail não saiu."} Copie o link e
          envie para a pessoa.
        </Notice>
      ) : (
        <Notice id={noticeId} tone="info" announce={false}>
          O envio de e-mail ainda não está configurado. Copie o link e envie para a pessoa.
        </Notice>
      )}

      {/* O formulário some ao criar: o foco vai para o link, que já fica selecionado. */}
      <CopyLink url={result.inviteUrl} autoFocus describedBy={noticeId} />

      <p className="m-0 text-[13px] leading-relaxed text-fg/65">
        {expiresAt ? `O link vale até ${formatDateTime(expiresAt)} e funciona uma vez só.` : "O link vale 7 dias e funciona uma vez só."}{" "}
        Ele dá acesso ao painel: mande só para {email}.
      </p>

      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
