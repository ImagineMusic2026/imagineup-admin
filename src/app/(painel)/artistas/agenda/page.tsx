import type { Metadata } from "next";
import { Suspense } from "react";

import { AgendaPage } from "@/components/artistas/agenda-page";

export const metadata: Metadata = { title: "Agenda" };

export default function Page() {
  // O filtro da central vem do endereço (useSearchParams), que no Next 16 pede o Suspense.
  return (
    <Suspense>
      <AgendaPage />
    </Suspense>
  );
}
