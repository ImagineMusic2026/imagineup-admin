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

/** A última leitura guardada, da função que a fez. */
export interface LoadEntry<T> {
  load: () => Promise<T>;
  value: Loadable<T>;
  loadedAt: Date | null;
  refreshError: string | null;
}

/**
 * Se a leitura tenta de novo quando a conexão volta: só quando a última
 * leitura desta função falhou (o erro, ou o "Atualizar" que falhou) e nenhuma
 * releitura está a caminho. O evento `online` é um só: se a rede ainda não
 * estiver de pé quando ele dispara, a tela fica no erro até o "Tentar de novo".
 */
export function retriesWhenOnline<T>(entry: LoadEntry<T> | null, load: () => Promise<T>, reloadingFor: (() => Promise<T>) | null): boolean {
  if (!entry || entry.load !== load || reloadingFor === load) return false;
  return entry.value.status === "error" || entry.refreshError !== null;
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
 *
 * `refreshKey`: quando muda, lê de novo como o "Atualizar", com o dado na
 * tela (para a tela que relê depois de uma ação sem passar por "Carregando").
 */
export function useLoad<T>(load: () => Promise<T>, refreshKey?: unknown): LoadResult<T> {
  const [entry, setEntry] = useState<LoadEntry<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reloadingFor, setReloadingFor] = useState<(() => Promise<T>) | null>(null);
  const [seenKey, setSeenKey] = useState(refreshKey);
  if (!Object.is(seenKey, refreshKey)) {
    setSeenKey(refreshKey);
    setReloadingFor(() => load);
    setAttempt((value) => value + 1);
  }

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

  // A leitura falhou (sem rede, por exemplo): quando a conexão volta, ela tenta
  // de novo sozinha, como o "Tentar de novo". Antes, a volta da rede trocava o
  // `member` da equipe e relia toda tela que dependia dele; agora o `member` só
  // muda quando um campo muda.
  const failed = retriesWhenOnline(entry, load, reloadingFor);
  useEffect(() => {
    if (!failed) return;
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, [failed, reload]);

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
