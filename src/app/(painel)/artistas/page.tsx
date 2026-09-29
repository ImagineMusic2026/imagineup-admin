import type { Metadata } from "next";

import { SectionPage } from "@/components/painel/section-page";

export const metadata: Metadata = { title: "Artistas e centrais" };

export default function Page() {
  return <SectionPage section="artists" />;
}
