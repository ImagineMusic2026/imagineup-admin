import type { Metadata } from "next";

import { GrowthPage } from "@/components/crescimento/growth-page";

export const metadata: Metadata = { title: "Crescimento" };

export default function Page() {
  return <GrowthPage />;
}
