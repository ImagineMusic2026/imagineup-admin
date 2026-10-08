"use client";

import { CalendarCheck, Clock, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { errorMessage } from "@/lib/errors";
import { formatDay, formatTime } from "@/lib/format";
import type { CloseState, StatsDay } from "@/lib/stats";
import { getTodayStats } from "@/lib/stats-data";

/**
 * De quando são os números da tela, pelo estado do fechamento das 00:20
 * (`getStatsDays`), e o botão "Ver hoje até agora" (os shards de hoje, só sob
 * pedido, nunca sozinho). Sem atualização automática.
 */

export type TodayState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; loadedAt: Date }
  | { status: "error"; message: string };

/**
 * O "Ver hoje até agora" de uma tela: lê os shards de hoje só quando a pessoa
 * pede (até 65 leituras), e de novo no "Atualizar hoje".
 */
export function useTodayStats(): { state: TodayState; day: StatsDay | null; load: () => void } {
  const [today, setToday] = useState<{ state: TodayState; day: StatsDay | null }>({ state: { status: "idle" }, day: null });

  async function load() {
    setToday((current) => ({ ...current, state: { status: "loading" } }));
    try {
      const day = await getTodayStats(Date.now());
      setToday({ state: { status: "ready", loadedAt: new Date() }, day });
    } catch (error) {
      setToday((current) => ({ ...current, state: { status: "error", message: errorMessage(error) } }));
    }
  }

  return { state: today.state, day: today.state.status === "ready" ? today.day : null, load: () => void load() };
}

/** A frase do estado do fechamento. */
export function freshnessText(state: CloseState, closedAt: Date | null, now: Date): string {
  switch (state.kind) {
    case "not-started":
      return "Os números ainda não começaram: o fechamento espera a carga dos cadastros.";
    case "ok":
      return `Números fechados até ontem, ${formatDay(state.lastClosedDay, now)}.${closedAt ? ` Fechamento às ${formatTime(closedAt)}.` : ""}`;
    case "yesterday-open":
      return "Ontem ainda não fechou: os números de ontem são parciais.";
    case "late":
      return `Fechamento atrasado desde ${formatDay(state.firstOpenDay, now)}. Os dias depois disso aparecem como não fechados.`;
  }
}

export function DataFreshness({
  state,
  closedAt,
  now,
  today,
  onLoadToday,
}: {
  state: CloseState;
  /** O `closedAt` mais novo dos dias lidos. */
  closedAt: Date | null;
  now: Date;
  today?: TodayState;
  /** Lê os shards de hoje (o primeiro clique e o "Atualizar hoje"); sem ele, a tela não oferece o hoje. */
  onLoadToday?: () => void;
}) {
  const warn = state.kind === "late" || state.kind === "not-started";
  const Icon = warn ? TriangleAlert : state.kind === "yesterday-open" ? Clock : CalendarCheck;
  const loading = today?.status === "loading";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className={cx("m-0 flex items-start gap-2 text-[13px] leading-snug", warn ? "text-danger" : "text-fg/70")}>
        <Icon aria-hidden="true" className="mt-px size-4 shrink-0" />
        {freshnessText(state, closedAt, now)}
      </p>
      {state.kind !== "not-started" && today && onLoadToday ? (
        <div className="flex flex-wrap items-center gap-2">
          {today.status === "ready" ? (
            <span className="text-[13px] text-fg/70 tabular-nums">Hoje até {formatTime(today.loadedAt)} (parcial)</span>
          ) : null}
          <Button size="sm" variant="secondary" busy={loading} onClick={onLoadToday}>
            <RefreshCw aria-hidden="true" className={cx("size-3.5", loading && "hidden")} />
            {loading ? "Lendo hoje..." : today.status === "ready" ? "Atualizar hoje" : "Ver hoje até agora"}
          </Button>
          <span aria-live="polite" className="text-[12.5px] text-danger empty:hidden">
            {today.status === "error" ? today.message : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
