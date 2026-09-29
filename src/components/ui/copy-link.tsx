"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { INPUT_CLASS } from "@/components/ui/field";
import { cx } from "@/components/ui/cx";

type CopyState = "idle" | "copied" | "manual";

/**
 * Link somente leitura com botão Copiar. Sem a API da área de transferência
 * (http fora do localhost, permissão negada), tenta o comando antigo; se nem
 * ele funcionar, deixa o link selecionado e explica como copiar.
 */
export function CopyLink({
  url,
  label = "Link do convite",
  autoFocus = false,
  describedBy,
}: {
  url: string;
  label?: string;
  autoFocus?: boolean;
  /** Ids extras lidos junto com o link (ex.: o aviso que apareceu com ele). */
  describedBy?: string;
}) {
  const id = useId();
  const statusId = `${id}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function settle(next: CopyState) {
    setState(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (next === "copied") timerRef.current = window.setTimeout(() => setState("idle"), 2500);
  }

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(url);
      settle("copied");
    } catch {
      const input = inputRef.current;
      input?.focus();
      input?.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      settle(copied ? "copied" : "manual");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-fg/85">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={id}
          type="text"
          readOnly
          value={url}
          aria-describedby={describedBy ? `${describedBy} ${statusId}` : statusId}
          data-autofocus={autoFocus || undefined}
          onFocus={(event) => event.currentTarget.select()}
          className={cx(INPUT_CLASS, "min-w-0 flex-1 font-mono text-[13px]")}
        />
        <Button variant="secondary" size="lg" onClick={copy} className="sm:w-[120px]">
          {state === "copied" ? <Check aria-hidden="true" className="size-4 text-cyan" /> : <Copy aria-hidden="true" className="size-4" />}
          {state === "copied" ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p id={statusId} aria-live="polite" className="m-0 text-[12.5px] text-fg/65 empty:-mt-1.5">
        {state === "copied" ? "Link copiado." : state === "manual" ? "Não deu para copiar sozinho. O link está selecionado: use Ctrl+C (ou Cmd+C)." : ""}
      </p>
    </div>
  );
}
