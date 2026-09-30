"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { callableErrorMessage } from "@/lib/errors";

export interface ConfirmRequest {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  tone: "default" | "danger";
  action: () => Promise<unknown>;
  successMessage: string;
}

/**
 * Confirmação com o pedido dentro: o erro aparece no próprio diálogo e o
 * foco começa no botão de voltar, que é a escolha segura.
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
  // Cada fechamento abre uma rodada nova: a resposta de um pedido de uma rodada
  // anterior não fecha nem muda a confirmação que estiver aberta agora.
  const round = useRef(0);

  function close() {
    round.current += 1;
    setError(null);
    setBusy(false);
    onClose();
  }

  async function confirm() {
    if (!request || busy) return;
    const mine = round.current;
    setError(null);
    setBusy(true);
    try {
      await request.action();
    } catch (failure) {
      if (round.current !== mine) return;
      setError(callableErrorMessage(failure));
      setBusy(false);
      return;
    }
    if (round.current !== mine) return;
    round.current += 1;
    setBusy(false);
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={busy} data-autofocus>
            {request?.cancelLabel ?? "Voltar"}
          </Button>
          <Button variant={request?.tone === "danger" ? "danger" : "primary"} onClick={confirm} busy={busy}>
            {busy ? request?.busyLabel : request?.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
