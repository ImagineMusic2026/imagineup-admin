import type { Metadata } from "next";

import { RewardsPage } from "@/components/recompensas/rewards-page";

export const metadata: Metadata = { title: "Recompensas e resgates" };

export default function Page() {
  return <RewardsPage />;
}
