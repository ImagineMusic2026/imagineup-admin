import type { Metadata } from "next";

import { SectionPage } from "@/components/painel/section-page";

export const metadata: Metadata = { title: "Fãs" };

export default function Page() {
  return <SectionPage section="fans" />;
}
