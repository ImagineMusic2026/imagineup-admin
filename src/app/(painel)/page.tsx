import type { Metadata } from "next";

import { HomePage } from "@/components/painel/section-page";

export const metadata: Metadata = { title: "Visão geral" };

export default function Page() {
  return <HomePage />;
}
