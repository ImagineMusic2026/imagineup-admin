"use client";

import { useCallback, useEffect, useState } from "react";

import { firestoreErrorMessage } from "@/lib/errors";

export type Loadable<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

/**
 * Lista em tempo real. Depois de um erro o Firestore encerra a escuta de vez,
 * então `retry` abre uma escuta nova (ex.: regras ainda sendo publicadas).
 */
export function useLiveList<T>(
  subscribe: (onChange: (data: T) => void, onError: (error: unknown) => void) => () => void,
): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(
    () =>
      subscribe(
        (data) => setState({ status: "ready", data }),
        (error) => setState({ status: "error", message: firestoreErrorMessage(error) }),
      ),
    [subscribe, attempt],
  );
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  return [state, retry];
}
