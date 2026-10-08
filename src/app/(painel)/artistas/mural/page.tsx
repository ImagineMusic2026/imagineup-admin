import type { Metadata } from "next";
import { Suspense } from "react";

import { MuralPage } from "@/components/artistas/mural-page";

export const metadata: Metadata = { title: "Mural" };

export default function Page() {
  // O filtro da central vem do endereço (useSearchParams), que no Next 16 pede o Suspense.
  return (
    <Suspense>
      <MuralPage />
    </Suspense>
  );
}
