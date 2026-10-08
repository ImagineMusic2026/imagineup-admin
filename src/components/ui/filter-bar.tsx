"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { SelectInput } from "@/components/ui/field";

/** A fileira de filtros de uma lista, com "Limpar filtros" quando algum está escolhido. */
export function FilterBar({
  label,
  active,
  onClear,
  children,
  className,
}: {
  /** Nome do grupo para o leitor de tela ("Filtros dos pedidos"). */
  label: string;
  active: boolean;
  onClear: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex flex-wrap items-end gap-2", className)}>
      {children}
      {active ? (
        <Button variant="ghost" size="sm" className="h-9" onClick={onClear}>
          <X aria-hidden="true" className="size-3.5" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
  /** Desligada, com o motivo (o filtro que não combina com outro). */
  disabledReason?: string | null;
}

/** Um filtro compacto: rótulo pequeno em cima e o `<select>` nativo baixo. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hint,
  className,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Por que o filtro está desligado, embaixo dele. */
  hint?: string | null;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-dica`;
  return (
    <div className={cx("flex min-w-[150px] flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[12px] font-semibold text-fg/65">
        {label}
      </label>
      <SelectInput
        id={id}
        value={value}
        disabled={disabled}
        describedBy={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-lg pl-3 text-[13.5px]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={Boolean(option.disabledReason)}>
            {option.disabledReason ? `${option.label} (${option.disabledReason})` : option.label}
          </option>
        ))}
      </SelectInput>
      {hint ? (
        <p id={hintId} className="m-0 max-w-[260px] text-[12px] leading-snug text-fg/55">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Até 5 opções como botões de alternar (`aria-pressed`), uma escolhida por vez. */
export function FilterChips({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors",
              pressed ? "border-fg/40 bg-fg/[0.12] text-fg" : "border-line-strong text-fg/70 hover:border-fg/30 hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
