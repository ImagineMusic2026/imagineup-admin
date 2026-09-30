"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/** Cartão de seção com título (h2 focável) e uma legenda à direita. */
export function SectionCard({
  id,
  title,
  meta,
  children,
}: {
  id: string;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id={id} tabIndex={-1} className="m-0 font-display text-base font-semibold outline-none">
          {title}
        </h2>
        {meta ? <p className="m-0 text-[13px] text-fg/60">{meta}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Erro de leitura com "Tentar de novo". O botão some ao tentar, então o foco
 * vai para o título da seção, e o "Carregando..." é lido em seguida.
 */
export function LoadError({ message, headingId, onRetry }: { message: string; headingId: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-5">
      <Notice tone="error" className="self-stretch">
        {message}
      </Notice>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          onRetry();
          requestAnimationFrame(() => document.getElementById(headingId)?.focus());
        }}
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Tentar de novo
      </Button>
    </div>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <p role="status" className="m-0 flex items-center gap-2 px-5 py-6 text-sm text-fg/65">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </p>
  );
}
