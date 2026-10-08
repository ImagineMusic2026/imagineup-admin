import type { Metadata } from "next";

import { RankingPage } from "@/components/ranking/ranking-page";

export const metadata: Metadata = { title: "Ranking e temporadas" };

export default function Page() {
  return <RankingPage />;
}
