import { cx } from "@/components/ui/cx";

/** Lista de detalhes só para leitura (termo apagado em cima, valor embaixo), em uma ou duas colunas. */
export function DetailList({ columns = 2, className, children }: { columns?: 1 | 2 | 3; className?: string; children: React.ReactNode }) {
  return (
    <dl
      className={cx(
        "m-0 grid gap-x-6 gap-y-4",
        columns >= 2 && "sm:grid-cols-2",
        columns === 3 && "xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Detail({ term, wide = false, children }: { term: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("min-w-0", wide && "sm:col-span-full")}>
      <dt className="text-[12.5px] font-semibold text-fg/60">{term}</dt>
      <dd className="m-0 mt-1 text-sm leading-relaxed break-words text-fg">{children}</dd>
    </div>
  );
}

/** Valor que falta ("Sem cidade"), apagado. */
export function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-fg/55">{children}</span>;
}
