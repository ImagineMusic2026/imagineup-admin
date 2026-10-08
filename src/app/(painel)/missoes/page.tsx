import type { Metadata } from "next";

import { MissionsPage } from "@/components/missoes/missions-page";

export const metadata: Metadata = { title: "Missões" };

export default function Page() {
  return <MissionsPage />;
}
