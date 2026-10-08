"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

/**
 * Tabela densa em grade, no molde das listas de Artistas: o cabeçalho é só
 * visual (`aria-hidden`), e cada célula leva o próprio rótulo, visível no
 * celular (as linhas viram pilhas de cartões abaixo de `xl`) e só para o
 * leitor de tela na grade larga.
 *
 * Quando a tabela abre uma página (`rowHref`), a primeira coluna vira um link
 * que cobre a linha inteira: um foco só por linha, com o nome do link sendo o
 * da primeira célula. Botões dentro da linha ficam por cima do link.
 */

export interface Column<T> {
  key: string;
  /** Cabeçalho visível (pequeno, caixa alta). */
  header: string;
  /** Rótulo da célula no celular e para o leitor de tela; sem ele, o cabeçalho. `""` deixa sem rótulo. */
  label?: string;
  cell: (row: T) => React.ReactNode;
  /** Números à direita na grade larga. */
  align?: "start" | "end";
  className?: string;
}

/** Rótulo visível no celular (linhas empilhadas) e só para leitor de tela na tabela larga. */
export function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-fg/50 xl:sr-only">{children}</span>;
}

/** Pedido para levar o foco a uma linha (a primeira de uma página nova); o `nonce` repete o pedido. */
export interface RowFocusRequest {
  key: string;
  nonce: number;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  grid,
  empty,
  caption,
  rowHref,
  rowNotice,
  rowClassName,
  focusRequest = null,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Classes da grade larga, com o `xl:grid-cols-[...]` das colunas (a mesma em cabeçalho e linhas). */
  grid: string;
  /** O que aparece sem linhas (frase curta própria da lista). */
  empty: React.ReactNode;
  /** Nome da lista para o leitor de tela. */
  caption: string;
  rowHref?: (row: T) => string | null;
  /** Aviso de uma ação feita na linha, embaixo dela. */
  rowNotice?: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
  focusRequest?: RowFocusRequest | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(focusRequest.key)}"]`);
    row?.focus();
  }, [focusRequest]);

  if (rows.length === 0) {
    return <div className="px-5 py-6 text-sm text-fg/65">{empty}</div>;
  }

  return (
    <>
      <div aria-hidden="true" className={cx("hidden px-5 pt-3 pb-2 group-label text-fg/50", grid)}>
        {columns.map((column) => (
          <span key={column.key} className={cx("min-w-0 truncate", column.align === "end" && "text-right")}>
            {column.header}
          </span>
        ))}
      </div>
      <ul ref={listRef} aria-label={caption} className="m-0 list-none p-0">
        {rows.map((row) => {
          const key = rowKey(row);
          const href = rowHref?.(row) ?? null;
          const notice = rowNotice?.(row) ?? null;
          return (
            <li
              key={key}
              data-row-key={key}
              tabIndex={-1}
              className={cx(
                "relative border-t border-line px-5 py-4 outline-none first:border-t-0 focus-visible:bg-fg/[0.03] xl:first:border-t xl:py-3",
                href && "transition-colors hover:bg-fg/[0.03] has-[a:focus-visible]:bg-fg/[0.03]",
                grid,
                rowClassName?.(row),
              )}
            >
              {columns.map((column, index) => {
                const label = column.label ?? column.header;
                const content = column.cell(row);
                return (
                  <div
                    key={column.key}
                    className={cx(
                      "min-w-0 text-[13px] text-fg/85",
                      index > 0 && "mt-1.5 xl:mt-0",
                      column.align === "end" && "xl:text-right",
                      column.className,
                    )}
                  >
                    {index > 0 && label ? <CellLabel>{label}: </CellLabel> : null}
                    {index === 0 && href ? (
                      <Link href={href} className="rounded-sm outline-offset-4 after:absolute after:inset-0 after:content-['']">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </div>
                );
              })}
              {notice ? <div className="relative z-10 mt-3 xl:col-span-full xl:mt-0">{notice}</div> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * "Carregar mais": a região viva já existe antes de o aviso chegar ("Mais 25
 * carregados"), e o foco vai para a primeira linha nova (`focusRequest` da
 * tabela). Sem mais nada para carregar, o botão some.
 */
export function LoadMore({
  onClick,
  busy,
  hasMore,
  announcement,
  error,
}: {
  onClick: () => void;
  busy: boolean;
  hasMore: boolean;
  announcement: string;
  error?: string | null;
}) {
  return (
    <div className={cx("flex flex-col items-start gap-2", (hasMore || error) && "border-t border-line px-5 py-4")}>
      {error ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {hasMore ? (
        <Button size="sm" variant="secondary" busy={busy} onClick={onClick}>
          {busy ? "Carregando..." : "Carregar mais"}
        </Button>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
