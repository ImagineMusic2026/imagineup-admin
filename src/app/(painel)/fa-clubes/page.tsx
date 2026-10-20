import type { Metadata } from "next";
import { Suspense } from "react";

import { FanClubsPage } from "@/components/fa-clubes/fan-clubs-page";

export const metadata: Metadata = { title: "Fã-clubes" };

export default function Page() {
  // A aba do endereço (`?aba=`, o "Revisar na fila" da ficha) vem do useSearchParams, que no Next 16 pede o Suspense.
  return (
    <Suspense>
      <FanClubsPage />
    </Suspense>
  );
}
