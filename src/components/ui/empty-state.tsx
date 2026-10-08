import { cx } from "@/components/ui/cx";

/** Lista ou cartão sem nada: uma frase curta própria e, se fizer sentido, a ação (para quem edita). */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-start gap-3 px-5 py-6", className)}>
      <p className="m-0 text-sm text-fg/65">{children}</p>
      {action}
    </div>
  );
}
