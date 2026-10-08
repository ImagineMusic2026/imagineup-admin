"use client";

import { useCallback, useEffect, useState } from "react";

import type { Loadable } from "@/components/ui/use-live-list";
import { errorMessage } from "@/lib/errors";

export type { Loadable };

export interface LoadResult<T> {
  /** Carregando só na primeira leitura (ou depois de um erro); o "Atualizar" mantém o dado na tela. */
  state: Loadable<T>;
  /** Lê de novo (o botão "Atualizar" e o "Tentar de novo"). */
  reload: () => void;
  /** Uma leitura nova está a caminho com o dado antigo na tela (o giro do botão). */
  reloading: boolean;
  /** Hora da última leitura que deu certo ("Atualizado às 14:32"). */
  loadedAt: Date | null;
  /** O "Atualizar" falhou: o dado antigo continua na tela, com este aviso. */
  refreshError: string | null;
}

interface Entry<T> {
  load: () => Promise<T>;
  value: Loadable<T>;
  loadedAt: Date | null;
  refreshError: string | null;
}

/**
 * Leitura única (nunca `onSnapshot`): lê ao abrir e quando a pessoa pede, com
 * a hora da última leitura. Toda tela nova usa este (decisão 19: nenhuma
 * escuta em tempo real).
 *
 * `load` precisa ser estável (`useCallback` com as dependências dela): uma
 * função nova é uma leitura nova, e o dado da função anterior sai da tela
 * (carregando). A resposta de uma leitura que ficou para trás (a função
 * mudou, ou a tela fechou) é ignorada.
 */
export function useLoad<T>(load: () => Promise<T>): LoadResult<T> {
  const [entry, setEntry] = useState<Entry<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reloadingFor, setReloadingFor] = useState<(() => Promise<T>) | null>(null);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (!active) return;
        setEntry({ load, value: { status: "ready", data }, loadedAt: new Date(), refreshError: null });
        setReloadingFor(null);
      },
      (error: unknown) => {
        if (!active) return;
        const message = errorMessage(error);
        setEntry((current) =>
          current && current.load === load && current.value.status === "ready"
            ? { ...current, refreshError: message }
            : { load, value: { status: "error", message }, loadedAt: null, refreshError: null },
        );
        setReloadingFor(null);
      },
    );
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const reload = useCallback(() => {
    setReloadingFor(() => load);
    setAttempt((value) => value + 1);
  }, [load]);

  const current = entry && entry.load === load ? entry : null;
  const reloading = reloadingFor === load;
  const state: Loadable<T> = !current || (reloading && current.value.status === "error") ? { status: "loading" } : current.value;
  return {
    state,
    reload,
    reloading: reloading && current?.value.status === "ready",
    loadedAt: current?.loadedAt ?? null,
    refreshError: reloading ? null : (current?.refreshError ?? null),
  };
}
