"use client";

import { DataFreshness, type TodayState } from "@/components/painel/data-freshness";
import { cx } from "@/components/ui/cx";
import { Notice } from "@/components/ui/notice";
import { PeriodPicker, type PeriodDays } from "@/components/ui/period-picker";
import { RefreshButton } from "@/components/ui/refresh-button";
import { formatPercent } from "@/lib/format";
import { lastClosedAt } from "@/lib/stats";
import type { StatsRead } from "@/lib/stats-data";

/** A barra de cima das abas de números: período, "Atualizar" e de quando são os números. */
export function StatsToolbar({
  period,
  onPeriod,
  now,
  read,
  today,
  onLoadToday,
  reload,
  reloading,
  loadedAt,
  refreshError,
}: {
  period?: PeriodDays;
  onPeriod?: (days: PeriodDays) => void;
  now: number;
  read: StatsRead | null;
  today?: TodayState;
  onLoadToday?: () => void;
  reload: () => void;
  reloading: boolean;
  loadedAt: Date | null;
  refreshError: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {period && onPeriod ? <PeriodPicker value={period} onChange={onPeriod} now={now} /> : <span />}
        <RefreshButton onClick={reload} busy={reloading} loadedAt={loadedAt} />
      </div>
      {read ? (
        <DataFreshness
          state={read.state}
          closedAt={lastClosedAt(read.days)}
          now={new Date(now)}
          today={today}
          onLoadToday={onLoadToday}
        />
      ) : null}
      {refreshError ? <Notice tone="error">Não deu para atualizar: {refreshError}</Notice> : null}
      {read && read.state.kind === "not-started" ? (
        <Notice tone="info">Os números ainda não começaram: o fechamento espera a carga dos cadastros.</Notice>
      ) : null}
    </div>
  );
}

/** Uma barra fina com a parte de cada item (decorativa: os números estão na tabela ao lado). */
export function ShareBar({ parts }: { parts: { key: string; share: number }[] }) {
  const tones = ["bg-cyan", "bg-fg/70", "bg-fg/40", "bg-fg/20"];
  return (
    <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-fg/[0.06]">
      {parts.map((part, index) => (
        <span
          key={part.key}
          className={cx("h-full", tones[Math.min(index, tones.length - 1)])}
          style={{ width: `${Math.max(0, part.share) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** "40%" ao lado de uma barrinha, para a coluna de parte das tabelas. */
export function ShareCell({ share }: { share: number }) {
  return (
    <span className="inline-flex items-center gap-2 xl:justify-end">
      <span aria-hidden="true" className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-fg/[0.08] xl:inline-block">
        <span className="block h-full bg-cyan" style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%` }} />
      </span>
      <span className="tabular-nums">{formatPercent(share)}</span>
    </span>
  );
}
