"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Missing } from "@/components/ui/detail-list";
import type { StatusStyle } from "@/components/ui/status-chip";
import { formatDay, formatNumber, formatTime } from "@/lib/format";
import { REDEMPTION_STATUS_LABELS, REWARD_STATUS_LABELS, type RedemptionStatus, type RewardStatus } from "@/lib/rewards";

export const REDEMPTION_STYLES: Record<RedemptionStatus, StatusStyle> = {
  requested: { label: REDEMPTION_STATUS_LABELS.requested, tone: "muted", dot: true },
  approved: { label: REDEMPTION_STATUS_LABELS.approved, tone: "neutral", dot: true },
  delivered: { label: REDEMPTION_STATUS_LABELS.delivered, tone: "cyan", dot: true },
  refused: { label: REDEMPTION_STATUS_LABELS.refused, tone: "danger", dot: true },
  canceled: { label: REDEMPTION_STATUS_LABELS.canceled, tone: "muted", dot: true },
};

export const REWARD_STYLES: Record<RewardStatus, StatusStyle> = {
  draft: { label: REWARD_STATUS_LABELS.draft, tone: "muted", dot: true },
  published: { label: REWARD_STATUS_LABELS.published, tone: "cyan", dot: true },
  closed: { label: REWARD_STATUS_LABELS.closed, tone: "danger", dot: true },
};

export function Points({ value }: { value: number }) {
  return <span className="font-semibold text-lime tabular-nums">{formatNumber(value)} pts</span>;
}

/** "7 out, 21:00" (o ano só quando é outro). */
export function When({ date, now }: { date: Date | null; now: Date }) {
  if (!date) return <Missing>Sem data</Missing>;
  return (
    <span className="tabular-nums">
      {formatDay(date, now)}, {formatTime(date)}
    </span>
  );
}

/**
 * O código do pedido com o botão de copiar. Sem a área de transferência, o
 * aviso diz para copiar à mão; o resultado vai numa região viva.
 */
export function CopyCode({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span className="relative z-10 inline-flex items-center gap-1.5">
      <span className="font-mono text-[13px] text-fg">{code}</span>
      <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-fg/75 transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:cursor-not-allowed disabled:opacity-35" aria-label={`Copiar ${code}`} title="Copiar" onClick={() => void copy()}>
        {state === "copied" ? <Check aria-hidden="true" className="size-4 text-cyan" /> : <Copy aria-hidden="true" className="size-4" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? `${code} copiado.` : state === "failed" ? "Não deu para copiar. Selecione o código e copie à mão." : ""}
      </span>
    </span>
  );
}
