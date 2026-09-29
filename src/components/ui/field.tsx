"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { cx } from "@/components/ui/cx";

interface FieldControlProps {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/**
 * Rótulo, dica e erro ligados ao controle por `htmlFor` e `aria-describedby`.
 * O controle vem por render-prop para receber o id certo.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-dica`;
  const errorId = `${id}-erro`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-fg/85">
        {label}
        {optional ? <span className="font-normal text-fg/60"> (opcional)</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="m-0 text-[12.5px] font-medium leading-snug text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="m-0 text-[12.5px] leading-snug text-fg/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const INPUT_CLASS = cx(
  "h-11 w-full rounded-[10px] border border-line-strong bg-sunken px-3.5 text-[15px] text-fg outline-none transition-colors",
  "placeholder:text-fg/50 hover:border-fg/25",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "read-only:border-line read-only:bg-ink read-only:text-fg/80",
  "aria-[invalid=true]:border-danger",
);

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  describedBy?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function TextInput({ invalid, describedBy, className, ...props }: TextInputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cx(INPUT_CLASS, className)}
    />
  );
}

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  invalid?: boolean;
  describedBy?: string;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * Senha com botão de mostrar (estado em `aria-pressed`, rótulo fixo) e aviso de
 * Caps Lock numa região viva que já existe antes de o aviso aparecer.
 */
export function PasswordInput({ id, invalid, describedBy, className, disabled, onKeyDown, onKeyUp, onBlur, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const capsId = `${id}-caps`;
  const describedByAll = [describedBy, capsLock ? capsId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div className="relative">
        <input
          {...props}
          id={id}
          type={visible ? "text" : "password"}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByAll}
          onKeyDown={(event) => {
            setCapsLock(event.getModifierState("CapsLock"));
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            setCapsLock(event.getModifierState("CapsLock"));
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
          className={cx(INPUT_CLASS, "pr-12", className)}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label="Mostrar senha"
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[10px] text-fg/65 transition-colors hover:text-fg disabled:opacity-50"
        >
          {visible ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
        </button>
      </div>
      <p id={capsId} aria-live="polite" className="m-0 text-[12.5px] font-medium text-cyan [&:not(:empty)]:mt-1.5">
        {capsLock ? "Caps Lock ligado." : ""}
      </p>
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2.5 text-sm text-fg/85", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input type="checkbox" {...props} className="size-[18px] shrink-0 cursor-[inherit] accent-pink-strong" />
      <span>{label}</span>
    </label>
  );
}
