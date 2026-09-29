/**
 * Cabeçalho das páginas do painel: título grande em Sora e subtítulo apagado,
 * como no design. O h1 recebe o foco quando um diálogo fecha e o botão que o
 * abriu não existe mais.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1
          id="titulo-da-pagina"
          tabIndex={-1}
          className="m-0 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg outline-none sm:text-[30px]"
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-1.5 mb-0 text-sm leading-relaxed text-fg/60">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
