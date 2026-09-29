import { LoaderCircle } from "lucide-react";
import Link from "next/link";

import { cx } from "@/components/ui/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// Rosa cheio com texto branco usa o pink-strong (5,03:1); o hover escurece,
// nunca clareia, para não perder contraste.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-pink-strong text-white hover:bg-[#b80d4c] active:bg-[#a30b43]",
  secondary: "border border-line-strong bg-fg/[0.04] text-fg hover:border-fg/30 hover:bg-fg/[0.08]",
  ghost: "text-fg/75 hover:bg-fg/[0.06] hover:text-fg",
  danger: "bg-danger-strong text-white hover:bg-[#a82e18] active:bg-[#912713]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-10 gap-2 rounded-[10px] px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cx(
    "inline-flex shrink-0 select-none items-center justify-center font-semibold whitespace-nowrap transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-busy:cursor-progress",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mostra o giro e bloqueia o botão; o texto do botão diz o que está acontecendo. */
  busy?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * Ocupado não usa `disabled`: um botão desabilitado solta o foco para o body
 * (ruim dentro de um diálogo). Com `aria-disabled` o foco fica nele, o leitor
 * de tela ouve "ocupado" e o clique (inclusive o envio do formulário pelo
 * Enter) é ignorado aqui.
 */
export function Button({ variant = "secondary", size = "md", busy = false, className, children, type, onClick, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      {...props}
      aria-disabled={busy || props["aria-disabled"] || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={buttonClass(variant, size, className)}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ButtonLink({ variant = "secondary", size = "md", className, ...props }: ButtonLinkProps) {
  return <Link {...props} className={buttonClass(variant, size, typeof className === "string" ? className : undefined)} />;
}
