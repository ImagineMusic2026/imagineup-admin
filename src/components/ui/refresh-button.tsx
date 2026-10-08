"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { formatTime } from "@/lib/format";

/**
 * "Atualizar" das telas sem escuta em tempo real, com a hora da última
 * leitura ("Atualizado às 14:32"). Enquanto lê, o dado antigo continua na
 * tela e o ícone gira.
 */
export function RefreshButton({
  onClick,
  busy,
  loadedAt,
  label = "Atualizar",
  className,
}: {
  onClick: () => void;
  busy: boolean;
  loadedAt: Date | null;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {loadedAt ? (
        <span className="text-[12.5px] text-fg/55 tabular-nums" aria-live="polite">
          Atualizado às {formatTime(loadedAt)}
        </span>
      ) : null}
      <Button size="sm" variant="secondary" aria-busy={busy || undefined} onClick={() => !busy && onClick()}>
        <RefreshCw aria-hidden="true" className={cx("size-3.5", busy && "animate-spin")} />
        {busy ? "Atualizando..." : label}
      </Button>
    </div>
  );
}
