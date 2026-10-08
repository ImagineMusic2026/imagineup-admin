"use client";

import { useCallback, useState } from "react";

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
  loadMoreError: string | null;
  /** O "Atualizar": lê de novo do topo e troca a lista. */
  reload: () => void;
  reloading: boolean;
  loadedAt: Date | null;
  refreshError: string | null;
  /** Para a `DataTable` levar o foco à primeira linha nova. */
  focusRequest: RowFocusRequest | null;
  /** Para a região viva do `LoadMore` ("Mais 25 carregados"). */
  announcement: string;
}

interface Extra<T, C> {
  /** A primeira página a que estas se somam: um "Atualizar" troca a base e as extras saem. */
  base: PageOf<T, C>;
  items: T[];
  cursor: C | null;
  hasMore: boolean;
}

/**
 * Lista com "Carregar mais" por cursor, em leitura única: a primeira página
 * ao abrir e no "Atualizar" (que lê de novo do topo), as seguintes pelo botão.
 * `loadPage` precisa ser estável (`useCallback`): uma função nova (outro
 * filtro) começa uma lista nova.
 */
export function usePagedList<T, C>(
  loadPage: (after: C | null) => Promise<PageOf<T, C>>,
  rowKey: (item: T) => string,
  /** O que entrou, para o anúncio: `{ one: "fã carregado", many: "fãs carregados" }`. */
  loaded: { one: string; many: string } = { one: "item carregado", many: "itens carregados" },
): PagedList<T> {
  const first = useCallback(() => loadPage(null), [loadPage]);
  const load = useLoad(first);
  const [extra, setExtra] = useState<Extra<T, C> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<RowFocusRequest | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const base = load.state.status === "ready" ? load.state.data : null;
  const current = extra && base && extra.base === base ? extra : null;
  const items = base ? (current ? current.items : base.items) : [];
  const cursor = current ? current.cursor : (base?.cursor ?? null);
  const hasMore = current ? current.hasMore : (base?.hasMore ?? false);

  async function loadMore() {
    if (!base || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await loadPage(cursor);
      setExtra({ base, items: [...items, ...page.items], cursor: page.cursor, hasMore: page.hasMore });
      const firstNew = page.items[0];
      if (firstNew) setFocusRequest((previous) => ({ key: rowKey(firstNew), nonce: (previous?.nonce ?? 0) + 1 }));
      const count = page.items.length;
      setAnnouncement(count === 0 ? "Nada mais para carregar." : `Mais ${count} ${count === 1 ? loaded.one : loaded.many}.`);
    } catch (error) {
      setLoadMoreError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  const state: Loadable<T[]> =
    load.state.status === "ready" ? { status: "ready", data: items } : load.state;

  return {
    state,
    hasMore,
    loadMore: () => void loadMore(),
    loadingMore,
    loadMoreError,
    reload: load.reload,
    reloading: load.reloading,
    loadedAt: load.loadedAt,
    refreshError: load.refreshError,
    focusRequest,
    announcement,
  };
}
