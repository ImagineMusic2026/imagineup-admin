import type { Metadata } from "next";
import { Suspense } from "react";

import { LogsPage } from "@/components/logs/logs-page";

export const metadata: Metadata = { title: "Logs e auditoria" };

export default function Page() {
  // O alvo do "Abrir nos Logs" vem do endereço (useSearchParams), que no Next 16 pede o Suspense.
  return (
    <Suspense>
      <LogsPage />
    </Suspense>
  );
}
