import type { Metadata } from "next";

import { FanClubPage } from "@/components/fa-clubes/fan-club-page";

export const metadata: Metadata = { title: "Ficha do fã-clube" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FanClubPage clubId={id} />;
}
