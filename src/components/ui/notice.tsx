import { CircleAlert, CircleCheck, Info } from "lucide-react";

import { cx } from "@/components/ui/cx";

type Tone = "error" | "success" | "info";

const TONES: Record<Tone, { box: string; icon: string; Icon: typeof Info }> = {
  error: { box: "border-danger/40 bg-danger/10", icon: "text-danger", Icon: CircleAlert },
  success: { box: "border-cyan/35 bg-cyan/10", icon: "text-cyan", Icon: CircleCheck },
  info: { box: "border-line-strong bg-fg/[0.04]", icon: "text-fg/70", Icon: Info },
};

/**
 * Aviso em bloco. Erro entra como `role="alert"` (lido na hora); sucesso e
 * informação como `role="status"`.
 *
 * Uma região `status` que já nasce preenchida muitas vezes não é lida. Quando
 * o aviso aparece junto com uma troca de tela, prefira `announce={false}` e
 * ligar o aviso ao que recebe o foco (`aria-describedby`), focar o próprio
 * aviso (`focusable` + `ref`) ou pôr o aviso numa região viva que já existia.
 */
export function Notice({
  tone = "error",
  title,
  children,
  className,
  id,
  announce = true,
  focusable = false,
  ref,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  id?: string;
  /** Falso quando o aviso já vive dentro de uma região viva ou é lido de outro jeito (evita leitura dupla). */
  announce?: boolean;
  /** Pode receber foco pelo código (`tabIndex={-1}`), para ser lido ao aparecer. */
  focusable?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      ref={ref}
      id={id}
      role={announce ? (tone === "error" ? "alert" : "status") : undefined}
      tabIndex={focusable ? -1 : undefined}
      className={cx(
        "flex gap-3 rounded-[10px] border px-3.5 py-3 text-[13.5px] leading-relaxed text-fg/90",
        focusable && "outline-none",
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cx("mt-0.5 size-[18px] shrink-0", icon)} />
      <div className="min-w-0">
        {title ? <p className="m-0 font-semibold text-fg">{title}</p> : null}
        {children ? <div className={cx(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}
