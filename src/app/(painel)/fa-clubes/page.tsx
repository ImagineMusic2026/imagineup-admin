import type { Metadata } from "next";

import { FanClubsPage } from "@/components/fa-clubes/fan-clubs-page";

export const metadata: Metadata = { title: "Fã-clubes" };

export default function Page() {
  return <FanClubsPage />;
}
