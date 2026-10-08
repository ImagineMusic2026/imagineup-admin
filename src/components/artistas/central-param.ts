"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * O filtro por central do Mural e da Agenda, no endereço (`?central=nenho`):
 * dá para mandar o link e voltar pelo histórico. Precisa estar dentro de um
 * `<Suspense>` (o `useSearchParams` do Next 16).
 */
export function useCentralParam(): [string, (central: string) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const central = params.get("central") ?? "";
  function setCentral(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next) query.set("central", next);
    else query.delete("central");
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }
  return [central, setCentral];
}
