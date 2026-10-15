"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { actionErrorMessage, callableErrorMessage, mayHaveRunOnServer } from "@/lib/errors";

export interface ConfirmRequest {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  tone: "default" | "danger";
  action: () => Promise<unknown>;
  successMessage: string;
  /**
   * Falha sem motivo do servidor (pode ter gravado): o diálogo diz isso em
   * vez da frase do código, e a tela lê de novo. Sem ele, a mensagem de antes.
   */
  onUncertain?: () => void;
  /** A frase da falha incerta, quando a tela só lê de novo ao fechar (sem ela, a de sempre). */
  uncertainText?: string;
  /** Recusa do servidor (com a frase dele no diálogo): a tela pode ler de novo o que mudou por fora. */
  onError?: (failure: unknown) => void;
  /** Recusa que outra tentativa repetiria (o item mudou por fora): o botão de confirmar desliga. */
  blocksRetry?: (failure: unknown) => boolean;
  /** A resposta chegou com o diálogo já fora da tela (a permissão caiu no meio do pedido): a tela lê de novo. */
  onOrphan?: () => void;
}

/**
 * Confirmação com o pedido dentro: o erro aparece no próprio diálogo e o
 * foco começa no botão de voltar, que é a escolha segura. Depois de uma falha
 * incerta, o botão de confirmar vira "Tentar de novo" quando a tela manda a
 * frase de repetir (`uncertainText`); com a de sempre, que pede conferir a
 * lista antes, o rótulo fica. A recusa que bloqueia a nova tentativa tira o
 * botão de confirmar.
 *
 * A tela que fecha a confirmação sem passar pelo "Voltar" (a perda da
 * permissão, por exemplo) dá uma `key` por pedido: a instância nova começa
 * limpa, e a resposta que chega para a instância que saiu da tela é ignorada.
 */
export function ConfirmDialog({
  request,
  onClose,
  onDone,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const footer = useRef<HTMLDivElement>(null);
  const mounted = useMountedRef();
  // Cada fechamento abre uma rodada nova: a resposta de um pedido de uma rodada
  // anterior não fecha nem muda a confirmação que estiver aberta agora.
  const round = useRef(0);

  // O botão de confirmar saiu com o foco nele: o foco vai para o de voltar.
  useEffect(() => {
    if (blocked) footer.current?.querySelector<HTMLElement>("button")?.focus();
  }, [blocked]);

  function close() {
    round.current += 1;
    setError(null);
    setBusy(false);
    setRetry(false);
    setBlocked(false);
    onClose();
  }

  async function confirm() {
    if (!request || busy || blocked) return;
    const mine = round.current;
    setError(null);
    setBusy(true);
    try {
      await request.action();
    } catch (failure) {
      if (!mounted.current) {
        request.onOrphan?.();
        return;
      }
      if (round.current !== mine) return;
      if (request.onUncertain && mayHaveRunOnServer(failure)) {
        setError(request.uncertainText ?? actionErrorMessage(failure));
        setRetry(Boolean(request.uncertainText));
        request.onUncertain();
      } else {
        setError(callableErrorMessage(failure));
        request.onError?.(failure);
        if (request.blocksRetry?.(failure)) setBlocked(true);
      }
      setBusy(false);
      return;
    }
    if (!mounted.current) {
      request.onOrphan?.();
      return;
    }
    if (round.current !== mine) return;
    round.current += 1;
    setBusy(false);
    setRetry(false);
    onDone(request.successMessage);
  }

  return (
    <Dialog
      open={Boolean(request)}
      onClose={close}
      busy={busy}
      size="sm"
      tone={request?.tone ?? "default"}
      title={request?.title ?? ""}
      description={request?.body}
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div ref={footer} className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={busy} data-autofocus>
            {request?.cancelLabel ?? "Voltar"}
          </Button>
          {blocked ? null : (
            <Button variant={request?.tone === "danger" ? "danger" : "primary"} onClick={confirm} busy={busy}>
              {busy ? request?.busyLabel : retry ? "Tentar de novo" : request?.confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
