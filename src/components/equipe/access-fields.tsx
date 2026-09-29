"use client";

import { Check } from "lucide-react";
import { useId } from "react";

import { cx } from "@/components/ui/cx";
import { ROLES, ROLE_IDS, SECTIONS, SECTION_IDS, type Role, type SectionId } from "@/lib/staff";

/** Nível de acesso em três cartões (rádios nativos, setas trocam a escolha). */
export function RolePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 p-0 text-[13px] font-semibold text-fg/85">Nível de acesso</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLE_IDS.map((role) => {
          const checked = value === role;
          return (
            <label
              key={role}
              className={cx(
                "relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 pr-9 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pink",
                checked ? "border-pink/70 bg-pink/[0.09]" : "border-line-strong bg-raised hover:border-fg/25",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={role}
                checked={checked}
                onChange={() => onChange(role)}
                aria-labelledby={`${name}-${role}`}
                aria-describedby={`${name}-${role}-descricao`}
                className="sr-only"
              />
              <span id={`${name}-${role}`} className="text-sm font-semibold text-fg">
                {ROLES[role].label}
              </span>
              <span id={`${name}-${role}-descricao`} className="text-[12.5px] leading-snug text-fg/65">
                {ROLES[role].description}
              </span>
              <span
                aria-hidden="true"
                className={cx(
                  "absolute top-3 right-3 grid size-[18px] place-items-center rounded-full border",
                  checked ? "border-pink bg-pink-strong text-white" : "border-fg/30",
                )}
              >
                {checked ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Seções liberadas. Admin vê tudo: as caixas ficam marcadas e travadas.
 * Editor e Leitor precisam de pelo menos uma.
 */
export function SectionsPicker({
  role,
  value,
  onChange,
  error,
  disabled = false,
  firstCheckboxRef,
}: {
  role: Role;
  value: SectionId[];
  onChange: (sections: SectionId[]) => void;
  error?: string | null;
  disabled?: boolean;
  firstCheckboxRef?: React.Ref<HTMLInputElement>;
}) {
  const baseId = useId();
  const hintId = `${baseId}-dica`;
  const errorId = `${baseId}-erro`;
  const isAdmin = role === "admin";
  const selected = new Set(isAdmin ? SECTION_IDS : value);

  function toggle(id: SectionId, checked: boolean) {
    const next = new Set(value);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(SECTION_IDS.filter((section) => next.has(section)));
  }

  return (
    <fieldset className="relative m-0 min-w-0 border-0 p-0" disabled={disabled} aria-describedby={hintId}>
      <legend className="mb-1.5 p-0 text-[13px] font-semibold text-fg/85">Seções</legend>
      {!isAdmin ? (
        <div className="absolute top-0 right-0 flex gap-3 text-[12.5px] font-semibold">
          <button
            type="button"
            onClick={() => onChange([...SECTION_IDS])}
            className="rounded text-pink underline-offset-4 hover:underline"
          >
            Marcar todas
          </button>
          <button type="button" onClick={() => onChange([])} className="rounded text-fg/70 underline-offset-4 hover:text-fg hover:underline">
            Limpar
          </button>
        </div>
      ) : null}
      <p id={hintId} className="m-0 mb-2.5 text-[12.5px] leading-snug text-fg/60">
        {isAdmin ? "Admin vê todas as seções e gerencia a Equipe." : "Marque o que a pessoa pode ver no painel."}
      </p>
      <div
        className={cx(
          "grid gap-1 rounded-xl border p-2 sm:grid-cols-2",
          error ? "border-danger/60" : "border-line-strong",
          "bg-raised",
        )}
      >
        {SECTIONS.map((section, index) => (
          <label
            key={section.id}
            className={cx(
              "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg/90 transition-colors hover:bg-fg/[0.05]",
              (isAdmin || disabled) && "cursor-not-allowed hover:bg-transparent",
            )}
          >
            {/* O erro fica em cada caixa: o foco vai para a primeira ao enviar, e o
                leitor de tela não lê a descrição do grupo ao entrar nele. */}
            <input
              ref={index === 0 ? firstCheckboxRef : undefined}
              type="checkbox"
              checked={selected.has(section.id)}
              disabled={isAdmin}
              onChange={(event) => toggle(section.id, event.target.checked)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="size-[18px] shrink-0 accent-pink-strong"
            />
            <span className={cx(isAdmin && "text-fg/70")}>{section.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="mt-2 mb-0 text-[12.5px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
