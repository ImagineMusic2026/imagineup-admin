"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import type { RowFocusRequest } from "@/components/ui/data-table";
import { useLoad, type Loadable } from "@/components/ui/use-load";
import { errorMessage } from "@/lib/errors";

/** Uma página lida: os itens, o cursor da próxima e se há mais. */
export interface PageOf<T, C> {
  items: T[];
  cursor: C | null;
  hasMore: boolean;
}

export interface PagedList<T> {
  /** A lista com as páginas extras já juntas; carregando só na primeira leitura. */
  state: Loadable<T[]>;
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  /** O "Carregar mais" da lista na tela que falhou; a releitura que troca a lista leva ele embora. */
  loadMoreError: string | null;
  /** O "Atualizar": lê de novo do topo e troca a lista. */
  reload: () => void;
  reloading: boolean;
  loadedAt: Date | null;
  refreshError: string | null;
  /** Para a `DataTable` levar o foco à primeira linha nova, só no clique do "Carregar mais". */
  focusRequest: RowFocusRequest | null;
  /** Para a região viva do `LoadMore` ("Mais 25 carregados"). */
  announcement: string;
}

/**
 * As páginas extras de uma base e o que elas deixaram na tela. O erro, o
 * anúncio e o foco andam junto com a base: um `Atualizar` (ou outro filtro)
 * troca a base, e o que era da lista de antes sai com ela.
 */
interface Extra<T, C> {
  /** A primeira página a que estas se somam: um "Atualizar" troca a base e as extras saem. */
  base: PageOf<T, C>;
  items: T[];
  cursor: C | null;
  hasMore: boolean;
  error: string | null;
  announcement: string;
  focus: RowFocusRequest | null;
}

/**
 * Lista com "Carregar mais" por cursor, em leitura única: a primeira página
 * ao abrir e no "Atualizar" (que lê de novo do topo), as seguintes pelo botão.
 * `loadPage` precisa ser estável (`useCallback`): uma função nova (outro
 * filtro) começa uma lista nova. `refreshKey` lê de novo do topo como o
 * "Atualizar", com a lista na tela (as páginas extras saem).
 */
export function usePagedList<T, C>(
  loadPage: (after: C | null) => Promise<PageOf<T, C>>,
  rowKey: (item: T) => string,
  /** O que entrou, para o anúncio: `{ one: "fã carregado", many: "fãs carregados" }`. */
  loaded: { one: string; many: string } = { one: "item carregado", many: "itens carregados" },
  refreshKey?: unknown,
): PagedList<T> {
  const first = useCallback(() => loadPage(null), [loadPage]);
  const load = useLoad(first, refreshKey);
  const [extra, setExtra] = useState<Extra<T, C> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const base = load.state.status === "ready" ? load.state.data : null;
  const current = extra && base && extra.base === base ? extra : null;
  const items = base ? (current ? current.items : base.items) : [];
  const cursor = current ? current.cursor : (base?.cursor ?? null);
  const hasMore = current ? current.hasMore : (base?.hasMore ?? false);
  // A base que está na tela, para a página que chegou saber se ainda vale.
  const latestBase = useRef(base);
  useEffect(() => {
    latestBase.current = base;
  }, [base]);

  /**
   * Lê a página seguinte. Só o clique no botão (`fromClick`) leva o foco à
   * primeira linha nova: a nova tentativa da volta da conexão não tira o foco
   * de quem está digitando.
   */
  async function loadMore(fromClick: boolean) {
    if (!base || loadingMore || !hasMore) return;
    const from = { base, items, cursor, hasMore, focus: current?.focus ?? null };
    setLoadingMore(true);
    if (current?.error) setExtra({ ...current, error: null });
    try {
      const page = await loadPage(cursor);
      // A base mudou durante a leitura (um "Atualizar", outro filtro): a página
      // lida é de uma lista que já saiu da tela.
      if (latestBase.current !== base) return;
      const count = page.items.length;
      const firstNew = page.items[0];
      setExtra({
        ...from,
        items: [...from.items, ...page.items],
        cursor: page.cursor,
        hasMore: page.hasMore,
        error: null,
        announcement: count === 0 ? "Nada mais para carregar." : `Mais ${count} ${count === 1 ? loaded.one : loaded.many}.`,
        focus: fromClick && firstNew ? { key: rowKey(firstNew), nonce: (from.focus?.nonce ?? 0) + 1 } : from.focus,
      });
    } catch (error) {
      if (latestBase.current !== base) return;
      setExtra({ ...from, error: errorMessage(error), announcement: "" });
    } finally {
      setLoadingMore(false);
    }
  }

  const loadMoreError = current?.error ?? null;

  // O "Carregar mais" que falhou (sem rede, por exemplo) tenta de novo quando a
  // conexão volta, como a primeira página no useLoad. Com uma releitura a
  // caminho, não: a lista vai trocar, e a página lida sairia com a base.
  const retryMore = useEffectEvent(() => void loadMore(false));
  useEffect(() => {
    if (!loadMoreError || loadingMore || load.reloading) return;
    const retry = () => retryMore();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [loadMoreError, loadingMore, load.reloading]);

  const state: Loadable<T[]> =
    load.state.status === "ready" ? { status: "ready", data: items } : load.state;

  return {
    state,
    hasMore,
    loadMore: () => void loadMore(true),
    loadingMore,
    loadMoreError,
    reload: load.reload,
    reloading: load.reloading,
    loadedAt: load.loadedAt,
    refreshError: load.refreshError,
    focusRequest: current?.focus ?? null,
    announcement: current?.announcement ?? "",
  };
}
