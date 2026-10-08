"use client";

import { useId } from "react";

import { cx } from "@/components/ui/cx";
import { rangeEndingYesterday } from "@/lib/day";
import { formatDayRange } from "@/lib/format";

export const PERIOD_OPTIONS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_OPTIONS)[number];
export const DEFAULT_PERIOD: PeriodDays = 30;

/**
 * Período das telas de números: 7, 30 ou 90 dias terminando ontem, padrão
 * 30. Rádios nativos com o visual de botões segmentados (as setas trocam a
 * escolha), e a faixa por extenso ao lado ("de 8 set a 7 out").
 */
export function PeriodPicker({
  value,
  onChange,
  now,
  label = "Período",
  disabled = false,
}: {
  value: PeriodDays;
  onChange: (days: PeriodDays) => void;
  /** O relógio da tela (ms), para a faixa por extenso. */
  now: number;
  label?: string;
  disabled?: boolean;
}) {
  const name = useId();
  const range = rangeEndingYesterday(value, now);
  const rangeId = `${name}-faixa`;
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-0 p-0" disabled={disabled} aria-describedby={rangeId}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex rounded-[10px] border border-line-strong bg-raised p-0.5">
        {PERIOD_OPTIONS.map((days) => {
          const checked = value === days;
          return (
            <label
              key={days}
              className={cx(
                "relative cursor-pointer rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pink",
                checked ? "bg-fg/[0.12] text-fg" : "text-fg/65 hover:text-fg",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={days}
                checked={checked}
                onChange={() => onChange(days)}
                aria-label={`${days} dias`}
                className="sr-only"
              />
              <span aria-hidden="true">{days} dias</span>
            </label>
          );
        })}
      </div>
      <span id={rangeId} className="text-[13px] text-fg/60">
        {formatDayRange(range.from, range.to, new Date(now))}
      </span>
    </fieldset>
  );
}
