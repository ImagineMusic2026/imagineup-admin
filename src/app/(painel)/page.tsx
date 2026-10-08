import type { Metadata } from "next";

import { HomePage } from "@/components/painel/section-page";
import { OverviewPage } from "@/components/visao-geral/overview-page";

export const metadata: Metadata = { title: "Visão geral" };

export default function Page() {
  return <HomePage overview={<OverviewPage />} />;
}
