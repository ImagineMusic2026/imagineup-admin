"use client";

import { useEffect, useRef } from "react";

/**
 * Verdadeiro enquanto o componente está na tela. Serve para ignorar a resposta
 * de um pedido que chegou depois de o formulário sumir (diálogo fechado), em
 * vez de ela mexer no que estiver aberto agora.
 */
export function useMountedRef(): React.RefObject<boolean> {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
